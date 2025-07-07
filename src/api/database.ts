import { VectorDatabase } from '@/core/database.js';
import { DimensionMismatchError } from '@/core/errors.js';
import { InputValidator } from '@/core/input-validator.js';
import { VectorStorage } from '@/core/storage.js';
import type {
  BatchOptions,
  DatabaseConfig,
  DistanceMetric,
  SearchOptions,
  SearchResult,
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
import { VectorFormatHandler } from '@/vectors/formats.js';
import { VectorOperations } from '@/vectors/operations.js';

/**
 * Main API class for the vector database
 */
export class VectorDB {
  private database: VectorDatabase;
  private storage: VectorStorage;
  private searchEngine: SearchEngine;
  private quotaMonitor: StorageQuotaMonitor;
  private evictionManager: EvictionManager;
  private dimension: number;
  private distanceMetric: DistanceMetric;
  private initialized = false;
  private autoEviction = false;

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
      autoEviction?: boolean;
      quotaConfig?: {
        safetyMargin?: number;
        checkInterval?: number;
      };
    },
  ) {
    // Validate inputs with comprehensive checks
    this.name = InputValidator.validateDatabaseName(name);
    this.dimension = InputValidator.validateDimension(dimension);
    this.distanceMetric = options?.distanceMetric || 'cosine';
    this.autoEviction = options?.autoEviction ?? true;

    this.database = new VectorDatabase({
      name,
      version: options?.version ?? 1,
      ...(options?.persistence !== undefined && { persistence: options.persistence }),
    });

    this.storage = new VectorStorage(this.database);
    this.evictionManager = new EvictionManager(this.storage);
    this.quotaMonitor = StorageQuotaMonitor.getInstance(options?.quotaConfig);

    this.searchEngine = new SearchEngine(this.storage, dimension, this.distanceMetric, {
      ...(options?.useIndex !== undefined && { useIndex: options.useIndex }),
      ...(options?.indexConfig !== undefined && { indexConfig: options.indexConfig }),
      database: this.database,
      indexId: `${this.name}-main`,
    });

    // Set up quota monitoring
    this.setupQuotaMonitoring();
  }

  /**
   * Initialize the database
   */
  @debugMethod('database.init', 'basic', { profileEnabled: true, memoryTracking: true })
  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }

    await this.database.init();
    this.initialized = true;
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

        // Check quota before adding
        await this.quotaMonitor.checkQuota();

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
   * Add multiple vectors
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

    // Validate all vectors
    const preparedVectors = await Promise.all(
      vectors.map(async ({ id, vector, metadata }) => {
        if (vector.length !== this.dimension) {
          throw new DimensionMismatchError(this.dimension, vector.length);
        }

        return VectorOperations.prepareForStorage(id, vector, metadata, {
          normalize: false,
        });
      }),
    );

    await this.storage.putBatch(preparedVectors, options);
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
    await this.ensureInitialized();

    // Validate dimension
    if (queryVector.length !== this.dimension) {
      throw new DimensionMismatchError(this.dimension, queryVector.length);
    }

    // Convert to Float32Array
    const query = VectorFormatHandler.toFloat32Array(queryVector);

    // Use the search engine
    return this.searchEngine.searchRange(query, maxDistance, options);
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
   * Set up quota monitoring with automatic eviction
   */
  private setupQuotaMonitoring(): void {
    this.quotaMonitor.addListener(async (warning: QuotaWarning) => {
      console.warn(`Storage quota warning: ${warning.message}`);

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

          console.log(
            `Attempting automatic eviction to free ${this.formatBytes(targetBytes)}`,
          );

          const suggestion = await this.evictionManager.suggestStrategy(targetBytes);
          const result = await this.evictionManager.evict(suggestion.config);

          console.log(
            `Automatic eviction completed: freed ${this.formatBytes(result.freedBytes)} by removing ${result.evictedCount} vectors`,
          );

          // Update search index after eviction
          if (result.evictedCount > 0) {
            await this.searchEngine.rebuildIndex();
          }
        } catch (error) {
          console.error('Automatic eviction failed:', error);
        }
      }
    });
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
  }

  /**
   * Close the database
   */
  async close(): Promise<void> {
    await this.database.close();
    this.initialized = false;
  }

  /**
   * Delete the entire database
   */
  async delete(): Promise<void> {
    await this.database.delete();
    this.initialized = false;
  }

  /**
   * Check if a vector exists
   */
  async exists(id: string): Promise<boolean> {
    await this.ensureInitialized();
    return this.storage.exists(id);
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
   * Delete multiple vectors
   */
  async deleteMany(ids: string[]): Promise<number> {
    await this.ensureInitialized();
    return this.storage.deleteMany(ids);
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
    await this.ensureInitialized();

    // Validate dimension
    if (vector.length !== this.dimension) {
      throw new DimensionMismatchError(this.dimension, vector.length);
    }

    // Convert to Float32Array
    const float32Vector = VectorFormatHandler.toFloat32Array(vector);

    await this.storage.updateVector(id, float32Vector, options);
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
    await this.ensureInitialized();
    await this.storage.updateMetadata(id, metadata, options);
  }

  /**
   * Update multiple vectors
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
      const processed: {
        id: string;
        vector?: Float32Array;
        metadata?: Record<string, unknown>;
      } = { id: update.id };

      if (update.vector) {
        if (update.vector.length !== this.dimension) {
          throw new DimensionMismatchError(this.dimension, update.vector.length);
        }
        processed.vector = VectorFormatHandler.toFloat32Array(update.vector);
      }

      if (update.metadata !== undefined) {
        processed.metadata = update.metadata;
      }

      return processed;
    });

    return this.storage.updateBatch(processedUpdates, options);
  }
}
