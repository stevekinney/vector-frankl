import { VectorDatabase } from '@/core/database.js';
import { DimensionMismatchError, QuotaSafetyMarginError } from '@/core/errors.js';
import { InputValidator } from '@/core/input-validator.js';
import { VectorStorage } from '@/core/storage.js';
import type {
  BatchOptions,
  DatabaseConfig,
  DistanceMetric,
  SearchOptions,
  SearchResult,
  StorageAdapter,
  StorageAdapterFactory,
  VectorData,
  VectorFormat,
} from '@/core/types.js';
import { debugMethod, withContext } from '@/debug/hooks.js';
import { SearchEngine } from '@/search/search-engine.js';
import {
  EvictionManager,
  type EvictionConfig,
  type EvictionResult,
} from '@/storage/eviction-policy.js';
import { StorageQuotaMonitor, type QuotaWarning } from '@/storage/quota-monitor.js';
import { log } from '@/utilities/logger.js';
import { VectorFormatHandler } from '@/vectors/formats.js';
import { VectorOperations } from '@/vectors/operations.js';

/**
 * Main API class for the vector database
 */
export class VectorDB {
  private database: VectorDatabase | null;
  private storage: StorageAdapter;
  private searchEngine: SearchEngine;
  private quotaMonitor: StorageQuotaMonitor;
  private evictionManager: EvictionManager;
  private dimension: number;
  private distanceMetric: DistanceMetric;
  private initialized = false;
  private autoEviction = false;
  private quotaWarningListener: ((warning: QuotaWarning) => void) | null = null;

  constructor(
    private name: string,
    dimension: number,
    options?: Partial<DatabaseConfig> & {
      distanceMetric?: DistanceMetric;
      useIndex?: boolean;
      indexConfig?: {
        m?: number;
        efConstruction?: number;
        maxLevel?: number;
      };
      useWorkers?: boolean;
      autoEviction?: boolean;
      quotaConfig?: {
        safetyMargin?: number;
        checkInterval?: number;
      };
      storage?: StorageAdapter;
      storageFactory?: StorageAdapterFactory;
    },
  ) {
    // Validate inputs with comprehensive checks
    this.name = InputValidator.validateDatabaseName(name);
    this.dimension = InputValidator.validateDimension(dimension);
    this.distanceMetric = options?.distanceMetric || 'cosine';
    this.autoEviction = options?.autoEviction ?? true;

    if (options?.storage) {
      // Use the provided storage adapter directly
      this.storage = options.storage;
      this.database = null;
    } else if (options?.storageFactory) {
      // Use the factory to create a storage adapter; pass the validated name
      this.storage = options.storageFactory(this.name);
      this.database = null;
    } else {
      // Default: create IndexedDB-backed storage; pass the validated name
      this.database = new VectorDatabase({
        name: this.name,
        version: options?.version ?? 1,
        ...(options?.persistence !== undefined && { persistence: options.persistence }),
      });
      this.storage = new VectorStorage(this.database);
    }

    this.evictionManager = new EvictionManager(this.storage);
    this.quotaMonitor = StorageQuotaMonitor.getInstance(options?.quotaConfig);

    this.searchEngine = new SearchEngine(this.storage, dimension, this.distanceMetric, {
      ...(options?.useIndex !== undefined && { useIndex: options.useIndex }),
      ...(options?.indexConfig !== undefined && { indexConfig: options.indexConfig }),
      ...(options?.useWorkers !== undefined && { useWorkers: options.useWorkers }),
      ...(this.database && { database: this.database }),
      indexId: `${this.name}-main`,
    });

    // Set up quota monitoring
    this.setupQuotaMonitoring();
  }

  /**
   * Initialize the database.
   *
   * When indexing is enabled and a persistence backend is available, any
   * previously saved HNSW index is loaded and validated against current storage
   * automatically so that `getIndexStats().nodeCount` reflects the stored vector
   * count immediately after reopening without requiring an explicit
   * `rebuildIndex()` call.  A stale or empty snapshot triggers a rebuild.
   */
  @debugMethod('database.init', 'basic', { profileEnabled: true, memoryTracking: true })
  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }

    await this.storage.init();
    this.initialized = true;

    // Restore persisted HNSW index when indexing is enabled.
    // rebuildIndex() tries the cache first (with validation) and falls back to
    // building from storage when no valid snapshot exists.
    await this.searchEngine.rebuildIndex();
  }

  /**
   * Ensure database is initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.init();
    }
  }

  /**
   * Add a single vector
   */
  @debugMethod('database.addVector', 'basic', {
    profileEnabled: true,
    captureArgs: false,
  })
  async addVector(
    id: string,
    vector: VectorFormat,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    // Validate all inputs
    const validatedId = InputValidator.validateVectorId(id);
    const validatedMetadata = InputValidator.validateMetadata(metadata);

    // Validate vector format using existing validation
    VectorFormatHandler.validate(vector, this.dimension);

    return withContext(
      {
        namespace: this.name,
        operationType: 'addVector',
        vectorDimensions: this.dimension,
        vectorCount: 1,
        metadata: { hasMetadata: !!validatedMetadata },
      },
      async () => {
        await this.ensureInitialized();

        // Assert quota is safe before any allocation.  Throws QuotaSafetyMarginError
        // when quota is critically low and eviction cannot free enough space.
        // This must be called BEFORE writing to prevent dangling partial records.
        await this.assertQuotaAvailable();

        // Validate dimension
        if (vector.length !== this.dimension) {
          throw new DimensionMismatchError(this.dimension, vector.length);
        }

        // Prepare vector for storage
        const vectorData = await VectorOperations.prepareForStorage(
          validatedId,
          vector,
          validatedMetadata,
          { normalize: false },
        );

        await this.storage.put(vectorData);

        // Add to index if using HNSW
        await this.searchEngine.addVectorToIndex(vectorData);
      },
    );
  }

  /**
   * Add multiple vectors in a batch.
   *
   * **Atomicity model — partial success with index safety:**
   * Storage writes use IndexedDB transactions and are best-effort within each
   * sub-batch; if any write fails a {@link BatchOperationError} is thrown after
   * the batch completes. Index updates are attempted after all storage writes
   * succeed. If an index update fails mid-batch the index is marked dirty and
   * all subsequent searches fall back to brute-force until
   * {@link rebuildIndex} is called — stale index state is never used silently.
   */
  @debugMethod('database.addBatch', 'basic', {
    profileEnabled: true,
    memoryTracking: true,
  })
  async addBatch(
    vectors: Array<{
      id: string;
      vector: VectorFormat;
      metadata?: Record<string, unknown>;
    }>,
    options?: BatchOptions,
  ): Promise<void> {
    await this.ensureInitialized();

    // Assert quota is safe before any allocation.  Throws QuotaSafetyMarginError
    // when quota is critically low and eviction cannot free enough space.
    // Must be called BEFORE preparing/writing vectors to prevent dangling IDs.
    await this.assertQuotaAvailable();

    // Validate and prepare all vectors (matching addVector's validation pattern)
    const preparedVectors = await Promise.all(
      vectors.map(async ({ id, vector, metadata }) => {
        const validatedId = InputValidator.validateVectorId(id);
        const validatedMetadata = InputValidator.validateMetadata(metadata);
        VectorFormatHandler.validate(vector, this.dimension);

        if (vector.length !== this.dimension) {
          throw new DimensionMismatchError(this.dimension, vector.length);
        }

        return VectorOperations.prepareForStorage(
          validatedId,
          vector,
          validatedMetadata,
          {
            normalize: false,
          },
        );
      }),
    );

    await this.storage.putBatch(preparedVectors, options);

    // Add each vector to the HNSW index.
    // If any index update fails, mark the index dirty so future searches fall
    // back to brute-force rather than returning stale index results.
    try {
      for (const vectorData of preparedVectors) {
        await this.searchEngine.addVectorToIndex(vectorData);
      }
    } catch (error) {
      this.searchEngine.markIndexDirty();
      log.error('Index update failed during addBatch — index marked dirty', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get a vector by ID
   */
  @debugMethod('database.getVector', 'detailed')
  async getVector(id: string): Promise<VectorData | null> {
    // Validate input
    const validatedId = InputValidator.validateVectorId(id);

    await this.ensureInitialized();

    try {
      return await this.storage.get(validatedId);
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Delete a vector
   */
  @debugMethod('database.deleteVector', 'basic', { profileEnabled: true })
  async deleteVector(id: string): Promise<void> {
    // Validate input
    const validatedId = InputValidator.validateVectorId(id);

    await this.ensureInitialized();
    await this.storage.delete(validatedId);

    // Remove from index if using HNSW
    await this.searchEngine.removeVectorFromIndex(validatedId);
  }

  /**
   * Search for similar vectors
   */
  async search(
    queryVector: VectorFormat,
    k: number = 10,
    options?: SearchOptions,
  ): Promise<SearchResult[]> {
    // Validate inputs
    const validatedK = InputValidator.validateK(k);
    const validatedOptions = InputValidator.validateSearchOptions(options);

    // Validate vector format and dimension
    VectorFormatHandler.validate(queryVector, this.dimension);

    await this.ensureInitialized();

    // Validate dimension
    if (queryVector.length !== this.dimension) {
      throw new DimensionMismatchError(this.dimension, queryVector.length);
    }

    // Convert to Float32Array
    const query = VectorFormatHandler.toFloat32Array(queryVector);

    // Use the search engine
    return this.searchEngine.search(query, validatedK, validatedOptions as SearchOptions);
  }

  /**
   * Search for vectors within a distance threshold
   */
  async searchRange(
    queryVector: VectorFormat,
    maxDistance: number,
    options?: SearchOptions & { maxResults?: number },
  ): Promise<SearchResult[]> {
    // Validate inputs
    InputValidator.validateDistance(maxDistance);
    // Extract maxResults before passing to validateSearchOptions (it only validates SearchOptions keys).
    const { maxResults, ...searchOptions } = options ?? {};
    const validatedOptions = InputValidator.validateSearchOptions(searchOptions);

    // Validate vector format and dimension
    VectorFormatHandler.validate(queryVector, this.dimension);

    await this.ensureInitialized();

    // Validate dimension
    if (queryVector.length !== this.dimension) {
      throw new DimensionMismatchError(this.dimension, queryVector.length);
    }

    // Convert to Float32Array
    const query = VectorFormatHandler.toFloat32Array(queryVector);

    // Use the search engine
    return this.searchEngine.searchRange(query, maxDistance, {
      ...(validatedOptions as SearchOptions),
      ...(maxResults !== undefined && { maxResults }),
    });
  }

  /**
   * Stream search results
   */
  async *searchStream(
    queryVector: VectorFormat,
    options?: SearchOptions & {
      batchSize?: number;
      maxResults?: number;
      progressive?: boolean;
    },
  ): AsyncGenerator<SearchResult[], void, unknown> {
    // Validate vector format and dimension
    VectorFormatHandler.validate(queryVector, this.dimension);

    await this.ensureInitialized();

    // Validate dimension
    if (queryVector.length !== this.dimension) {
      throw new DimensionMismatchError(this.dimension, queryVector.length);
    }

    // Convert to Float32Array
    const query = VectorFormatHandler.toFloat32Array(queryVector);

    // Use the search engine
    yield* this.searchEngine.searchStream(query, options);
  }

  /**
   * Set the distance metric for search
   */
  setDistanceMetric(metric: DistanceMetric): void {
    this.distanceMetric = metric;
    this.searchEngine.setDistanceMetric(metric);
  }

  /**
   * Enable or disable HNSW indexing
   */
  async setIndexing(enabled: boolean): Promise<void> {
    await this.ensureInitialized();
    this.searchEngine.setIndexing(enabled, this.distanceMetric);

    if (enabled) {
      // Rebuild index from existing vectors
      await this.searchEngine.rebuildIndex();
    }
  }

  /**
   * Rebuild the search index
   */
  async rebuildIndex(): Promise<void> {
    await this.ensureInitialized();
    await this.searchEngine.rebuildIndex();
  }

  /**
   * Get index statistics
   */
  getIndexStats(): {
    enabled: boolean;
    nodeCount: number;
    levels?: number[];
    avgConnections?: number;
  } {
    return this.searchEngine.getIndexStats();
  }

  /**
   * Assert that sufficient quota is available before a write operation.
   *
   * When the quota monitor reports a critical or emergency level:
   * 1. If `autoEviction` is enabled, eviction runs and is fully **awaited**
   *    before this method returns.
   * 2. A forced re-check is performed after eviction.
   * 3. If quota remains at a critical level after eviction (or eviction is
   *    disabled), a `QuotaSafetyMarginError` is thrown so the caller aborts
   *    before writing any partial data.
   *
   * Callers must invoke this method **before** writing any record to storage.
   * The write must not proceed if this method throws.
   */
  private async assertQuotaAvailable(): Promise<void> {
    const quotaEstimate = await this.quotaMonitor.checkQuota(true);

    // No quota API available — cannot enforce; proceed optimistically
    if (!quotaEstimate) return;

    const { usageRatio, available, quota } = quotaEstimate;

    // Safety margin: reject writes when less than 5% of quota remains
    const HARD_REJECT_RATIO = 0.95;

    if (usageRatio < HARD_REJECT_RATIO) return;

    // Quota is critically low.  Try auto-eviction first if enabled.
    if (this.autoEviction) {
      const targetBytes =
        usageRatio >= 0.98
          ? Math.floor(quota * 0.2) // Emergency: free 20%
          : Math.floor(quota * 0.1); // Critical: free 10%

      log.info(
        `Pre-write quota guard: usage at ${(usageRatio * 100).toFixed(1)}%. Attempting eviction to free ${this.formatBytes(targetBytes)}.`,
      );

      try {
        const suggestion = await this.evictionManager.suggestStrategy(targetBytes);
        const result = await this.evictionManager.evict(suggestion.config);

        log.info(
          `Pre-write eviction completed: freed ${this.formatBytes(result.freedBytes)} by removing ${result.evictedCount} vectors`,
        );

        if (result.evictedCount > 0) {
          await this.searchEngine.rebuildIndex();
        }
      } catch (evictionError) {
        log.error('Pre-write eviction failed', {
          error:
            evictionError instanceof Error
              ? evictionError.message
              : String(evictionError),
        });
      }

      // Re-check quota after eviction
      const postEviction = await this.quotaMonitor.checkQuota(true);
      if (postEviction && postEviction.usageRatio >= HARD_REJECT_RATIO) {
        throw new QuotaSafetyMarginError(0, postEviction.available);
      }
      return;
    }

    // Auto-eviction is disabled and we are over the threshold — reject write
    throw new QuotaSafetyMarginError(0, available);
  }

  /**
   * Set up quota monitoring with automatic eviction
   */
  private setupQuotaMonitoring(): void {
    this.quotaWarningListener = async (warning: QuotaWarning) => {
      log.warn(`Storage quota warning: ${warning.message}`);

      if (
        this.autoEviction &&
        (warning.type === 'critical' || warning.type === 'emergency')
      ) {
        try {
          // Calculate target bytes to free
          const targetBytes =
            warning.type === 'emergency'
              ? Math.floor(warning.quota * 0.2) // Free 20% of quota
              : Math.floor(warning.quota * 0.1); // Free 10% of quota

          log.info(
            `Attempting automatic eviction to free ${this.formatBytes(targetBytes)}`,
          );

          const suggestion = await this.evictionManager.suggestStrategy(targetBytes);
          const result = await this.evictionManager.evict(suggestion.config);

          log.info(
            `Automatic eviction completed: freed ${this.formatBytes(result.freedBytes)} by removing ${result.evictedCount} vectors`,
          );

          // Update search index after eviction
          if (result.evictedCount > 0) {
            await this.searchEngine.rebuildIndex();
          }
        } catch (error) {
          log.error('Automatic eviction failed', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    };
    this.quotaMonitor.addListener(this.quotaWarningListener);
  }

  /**
   * Get current storage quota information
   */
  async getStorageQuota(): Promise<{
    usage: number;
    quota: number;
    usageRatio: number;
    available: number;
    breakdown?: {
      totalUsage: number;
      vectorDatabases: Array<{
        name: string;
        estimatedSize: number;
        vectorCount: number;
      }>;
      otherOriginData: number;
    };
  } | null> {
    const quotaInfo = await this.quotaMonitor.forceCheck();

    if (!quotaInfo) {
      return null;
    }

    const breakdown = await this.quotaMonitor.getStorageBreakdown();

    return {
      ...quotaInfo,
      breakdown,
    };
  }

  /**
   * Get usage trend information
   */
  getUsageTrend(): {
    trend: 'increasing' | 'decreasing' | 'stable' | 'insufficient_data';
    rate?: number;
    confidence: number;
  } {
    return this.quotaMonitor.getUsageTrend();
  }

  /**
   * Manually trigger eviction
   */
  async evictVectors(config?: Partial<EvictionConfig>): Promise<EvictionResult> {
    await this.ensureInitialized();

    const evictionConfig: EvictionConfig = {
      strategy: 'hybrid',
      preservePermanent: true,
      ...config,
    };

    const result = await this.evictionManager.evict(evictionConfig);

    // Update search index after eviction
    if (result.evictedCount > 0) {
      await this.searchEngine.rebuildIndex();
    }

    return result;
  }

  /**
   * Get eviction statistics and recommendations
   */
  async getEvictionStats(): Promise<{
    stats: {
      totalVectors: number;
      totalEstimatedBytes: number;
      permanentVectors: number;
      oldestAccess: number;
      averageAccessCount: number;
      expiredVectors: number;
    };
    suggestion?: {
      strategy: EvictionConfig['strategy'];
      config: EvictionConfig;
      reasoning: string;
    };
  }> {
    await this.ensureInitialized();

    const stats = await this.evictionManager.getEvictionStats();

    // Only provide suggestion if there are vectors to potentially evict
    let suggestion:
      | {
          strategy: EvictionConfig['strategy'];
          config: EvictionConfig;
          reasoning: string;
        }
      | undefined = undefined;

    if (stats.totalVectors > 0) {
      // Suggest freeing 10% of current usage
      const targetBytes = Math.floor(stats.totalEstimatedBytes * 0.1);
      suggestion = await this.evictionManager.suggestStrategy(targetBytes);
    }

    return { stats, ...(suggestion && { suggestion }) };
  }

  /**
   * Enable or disable automatic eviction
   */
  setAutoEviction(enabled: boolean): void {
    this.autoEviction = enabled;
  }

  /**
   * Check if automatic eviction is enabled
   */
  isAutoEvictionEnabled(): boolean {
    return this.autoEviction;
  }

  /**
   * Add a quota warning listener
   */
  onQuotaWarning(callback: (warning: QuotaWarning) => void): void {
    this.quotaMonitor.addListener(callback);
  }

  /**
   * Remove a quota warning listener
   */
  offQuotaWarning(callback: (warning: QuotaWarning) => void): void {
    this.quotaMonitor.removeListener(callback);
  }

  /**
   * Format bytes in human-readable format
   */
  private formatBytes(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(1)} ${units[unitIndex]}`;
  }

  /**
   * Get database statistics
   */
  async getStats(): Promise<{
    vectorCount: number;
    dimension: number;
    initialized: boolean;
  }> {
    await this.ensureInitialized();

    const vectorCount = await this.storage.count();

    return {
      vectorCount,
      dimension: this.dimension,
      initialized: this.initialized,
    };
  }

  /**
   * Clear all vectors
   */
  async clear(): Promise<void> {
    await this.ensureInitialized();
    await this.storage.clear();
    await this.searchEngine.clearIndex();
  }

  /**
   * Close the database
   */
  async close(): Promise<void> {
    if (this.quotaWarningListener) {
      this.quotaMonitor.removeListener(this.quotaWarningListener);
      this.quotaWarningListener = null;
    }
    await this.searchEngine.cleanup();
    await this.storage.close();
    this.initialized = false;
  }

  /**
   * Delete the entire database
   */
  async delete(): Promise<void> {
    if (this.quotaWarningListener) {
      this.quotaMonitor.removeListener(this.quotaWarningListener);
      this.quotaWarningListener = null;
    }
    await this.searchEngine.cleanup();
    await this.storage.destroy();
    this.initialized = false;
  }

  /**
   * Check if a vector exists
   */
  async exists(id: string): Promise<boolean> {
    // Validate input
    const validatedId = InputValidator.validateVectorId(id);

    await this.ensureInitialized();
    return this.storage.exists(validatedId);
  }

  /**
   * Get multiple vectors by IDs
   */
  async getMany(ids: string[]): Promise<VectorData[]> {
    // Validate input
    const validatedIds = InputValidator.validateVectorIds(ids);

    await this.ensureInitialized();
    return this.storage.getMany(validatedIds);
  }

  /**
   * Delete multiple vectors.
   *
   * **Atomicity model — partial success with index safety:**
   * Storage deletions run inside a single IndexedDB transaction. Vectors that
   * cannot be deleted (e.g. they do not exist) are silently skipped; the
   * returned count reflects only the vectors that were actually removed. Index
   * entries for successfully deleted vectors are removed after the storage
   * transaction commits. If any index removal fails the index is marked dirty
   * and future indexed searches fall back to brute-force until
   * {@link rebuildIndex} is called.
   */
  async deleteMany(ids: string[]): Promise<number> {
    const validatedIds = InputValidator.validateVectorIds(ids);

    await this.ensureInitialized();
    const count = await this.storage.deleteMany(validatedIds);

    // Remove each deleted vector from the HNSW index.
    // If any removal fails, mark the index dirty so future searches fall back
    // to brute-force rather than returning phantom index results.
    try {
      for (const id of validatedIds) {
        await this.searchEngine.removeVectorFromIndex(id);
      }
    } catch (error) {
      this.searchEngine.markIndexDirty();
      log.error('Index update failed during deleteMany — index marked dirty', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    return count;
  }

  /**
   * Get all vectors (use with caution on large datasets)
   */
  async getAllVectors(): Promise<VectorData[]> {
    await this.ensureInitialized();
    return this.storage.getAll();
  }

  /**
   * Update a vector's data
   */
  async updateVector(
    id: string,
    vector: VectorFormat,
    options?: {
      updateMagnitude?: boolean;
      updateTimestamp?: boolean;
    },
  ): Promise<void> {
    const validatedId = InputValidator.validateVectorId(id);
    VectorFormatHandler.validate(vector, this.dimension);

    await this.ensureInitialized();

    // Validate dimension
    if (vector.length !== this.dimension) {
      throw new DimensionMismatchError(this.dimension, vector.length);
    }

    // Convert to Float32Array
    const float32Vector = VectorFormatHandler.toFloat32Array(vector);

    await this.storage.updateVector(validatedId, float32Vector, options);

    // Update HNSW index: remove old entry and re-add with new vector
    await this.searchEngine.removeVectorFromIndex(validatedId);
    const updatedVector = await this.storage.get(validatedId);
    if (updatedVector) {
      await this.searchEngine.addVectorToIndex(updatedVector);
    }
  }

  /**
   * Update a vector's metadata
   */
  async updateMetadata(
    id: string,
    metadata: Record<string, unknown>,
    options?: {
      merge?: boolean;
      updateTimestamp?: boolean;
    },
  ): Promise<void> {
    // Validate inputs
    const validatedId = InputValidator.validateVectorId(id);
    const validatedMetadata = InputValidator.validateMetadata(metadata);

    await this.ensureInitialized();
    await this.storage.updateMetadata(validatedId, validatedMetadata, options);

    await this.searchEngine.rebuildIndex({ loadFromCache: false });
  }

  /**
   * Update multiple vectors.
   *
   * **Atomicity model — partial success with index safety:**
   * Storage updates are applied per vector inside IndexedDB transactions
   * (chunked by `batchSize`). Vectors whose updates fail are recorded in the
   * returned error list; the caller can inspect `succeeded` / `failed` counts
   * to determine the final storage state. The HNSW index is rebuilt from
   * storage after all updates are applied so it reflects the final storage
   * state. If the index rebuild fails, the index is marked dirty and future
   * indexed searches fall back to brute-force until {@link rebuildIndex} is
   * called explicitly.
   */
  async updateBatch(
    updates: Array<{
      id: string;
      vector?: VectorFormat;
      metadata?: Record<string, unknown>;
    }>,
    options?: BatchOptions,
  ): Promise<{
    succeeded: number;
    failed: number;
    errors: Array<{ id: string; error: Error }>;
  }> {
    await this.ensureInitialized();

    // Validate and convert vectors
    const processedUpdates = updates.map((update) => {
      const validatedId = InputValidator.validateVectorId(update.id);
      const processed: {
        id: string;
        vector?: Float32Array;
        metadata?: Record<string, unknown>;
      } = { id: validatedId };

      if (update.vector) {
        VectorFormatHandler.validate(update.vector, this.dimension);
        if (update.vector.length !== this.dimension) {
          throw new DimensionMismatchError(this.dimension, update.vector.length);
        }
        processed.vector = VectorFormatHandler.toFloat32Array(update.vector);
      }

      if (update.metadata !== undefined) {
        processed.metadata = InputValidator.validateMetadata(update.metadata);
      }

      return processed;
    });

    const result = await this.storage.updateBatch(processedUpdates, options);

    // Rebuild the index from the post-update storage state.
    // If rebuild fails, mark dirty so future searches fall back to brute-force.
    try {
      await this.searchEngine.rebuildIndex({ loadFromCache: false });
    } catch (error) {
      this.searchEngine.markIndexDirty();
      log.error('Index rebuild failed after updateBatch — index marked dirty', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    return result;
  }
}
