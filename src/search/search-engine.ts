import { VectorDatabase } from '@/core/database.js';
import {
  DimensionMismatchError,
  SearchAbortedError,
  SearchTimeoutError,
} from '@/core/errors.js';
import type {
  DistanceMetric as DistanceMetricType,
  MetadataFilter,
  SearchOptions,
  SearchResult,
  StorageAdapter,
  VectorData,
} from '@/core/types.js';
import { GPUSearchEngine, type GPUSearchConfig } from '@/gpu/gpu-search-engine.js';
import { log } from '@/utilities/logger.js';
import { VectorOperations } from '@/vectors/operations.js';
import { WorkerPool } from '@/workers/worker-pool.js';
import { createDistanceCalculator, DistanceCalculator } from './distance-metrics.js';
import { HNSWIndex } from './hnsw-index.js';
import { IndexCache, type IndexHealthReport } from './index-persistence.js';
import { MetadataFilterCompiler } from './metadata-filter.js';

/**
 * Search engine for vector similarity search
 */
export class SearchEngine {
  private distanceCalculator: DistanceCalculator;
  private dimension: number;
  private hnswIndex: HNSWIndex | null = null;
  private useIndex = false;
  private indexCache: IndexCache | null = null;
  private indexId: string;
  private workerPool: WorkerPool | null = null;
  private useWorkers = false;
  private parallelThreshold = 1000; // Use workers for datasets larger than this
  private gpuSearchEngine: GPUSearchEngine | null = null;
  private useGPU = false;
  private gpuThreshold = 5000; // Use GPU for datasets larger than this

  /**
   * When true, the HNSW index may not reflect current storage state.
   * Indexed search is suppressed until the index is explicitly rebuilt or cleared.
   * Set by markIndexDirty() after a storage–index synchronization failure.
   */
  private indexDirty = false;

  constructor(
    private storage: StorageAdapter,
    dimension: number,
    distanceMetric: DistanceMetricType = 'cosine',
    options?: {
      useIndex?: boolean;
      indexConfig?: {
        m?: number;
        efConstruction?: number;
        maxLevel?: number;
      };
      database?: unknown; // VectorDatabase instance for index persistence
      indexId?: string;
      useWorkers?: boolean;
      workerConfig?: {
        maxWorkers?: number;
        workerScript?: string;
        timeout?: number;
        parallelThreshold?: number;
        sharedMemoryConfig?: {
          maxPoolSize?: number;
          enableOptimizations?: boolean;
          chunkSize?: number;
        };
      };
      useGPU?: boolean;
      gpuConfig?: GPUSearchConfig;
    },
  ) {
    this.dimension = dimension;
    this.distanceCalculator = createDistanceCalculator(distanceMetric);
    this.useIndex = options?.useIndex ?? false;
    this.indexId = options?.indexId || 'default';
    this.useWorkers = options?.useWorkers ?? true;
    this.parallelThreshold = options?.workerConfig?.parallelThreshold ?? 1000;
    this.useGPU = options?.useGPU ?? false;
    this.gpuThreshold = options?.gpuConfig?.gpuThreshold ?? 5000;

    if (options?.database) {
      this.indexCache = new IndexCache(options.database as VectorDatabase);
    }

    if (this.useIndex) {
      this.hnswIndex = new HNSWIndex(distanceMetric, options?.indexConfig);
    }

    // Initialize worker pool if workers are enabled
    if (this.useWorkers && typeof Worker !== 'undefined') {
      this.workerPool = new WorkerPool(options?.workerConfig);
    }

    // Initialize GPU search engine if GPU is enabled
    if (this.useGPU && typeof navigator !== 'undefined' && 'gpu' in navigator) {
      this.gpuSearchEngine = new GPUSearchEngine(options?.gpuConfig);
    }
  }

  /**
   * Throw SearchAbortedError if the signal is already aborted.
   */
  private throwIfAborted(signal?: SearchOptions['signal']): void {
    if (signal?.aborted) {
      throw new SearchAbortedError();
    }
  }

  /**
   * Wrap a search promise with timeout and/or abort-signal enforcement.
   *
   * - `timeout` races the search against a timer. If the timer fires first,
   *   the search resolves with SearchTimeoutError.
   * - `signal` is polled before the promise settles via a rejection race.
   *   When the signal is already aborted at call time, the error is thrown
   *   synchronously by throwIfAborted before we even reach here.
   */
  private withCancellation<T>(promise: Promise<T>, options?: SearchOptions): Promise<T> {
    const { timeout, signal } = options ?? {};

    if (!timeout && !signal) {
      return promise;
    }

    const racers: Promise<T>[] = [promise];

    if (timeout !== undefined) {
      racers.push(
        new Promise<T>((_resolve, reject) => {
          setTimeout(() => reject(new SearchTimeoutError(timeout)), timeout);
        }),
      );
    }

    if (signal !== undefined) {
      racers.push(
        new Promise<T>((_resolve, reject) => {
          // Poll the signal — VectorAbortSignal only exposes `.aborted`, not an
          // `addEventListener`. We resolve the race quickly by checking every frame
          // via a tight polling loop that terminates once the outer promise settles.
          let done = false;
          promise
            .then(() => {
              done = true;
            })
            .catch(() => {
              done = true;
            });

          const poll = () => {
            if (done) return;
            if (signal.aborted) {
              reject(new SearchAbortedError());
              return;
            }
            // Check every ~10 ms while the search is running.
            setTimeout(poll, 10);
          };
          // If already aborted, fire immediately on the next tick.
          setTimeout(poll, 0);
        }),
      );
    }

    return Promise.race(racers);
  }

  /**
   * Search for k most similar vectors.
   *
   * When the HNSW index is marked dirty (due to a failed storage–index
   * synchronization), this method silently falls back to brute-force search
   * so that stale index state is never used. Call {@link rebuildIndex} to
   * restore indexed performance.
   */
  async search(
    queryVector: Float32Array,
    k: number = 10,
    options?: SearchOptions,
  ): Promise<SearchResult[]> {
    // Validate dimension
    if (queryVector.length !== this.dimension) {
      throw new DimensionMismatchError(this.dimension, queryVector.length);
    }

    // Reject immediately if the caller already aborted.
    this.throwIfAborted(options?.signal);

    if (this.indexDirty) {
      log.warn(
        'Index is dirty due to a prior synchronization failure — using brute-force search until index is rebuilt',
      );
    }

    // Use HNSW index if available, no metadata filter, and index is clean
    const coreSearch =
      this.useIndex && this.hnswIndex && !options?.filter && !this.indexDirty
        ? this.searchWithIndex(queryVector, k, options)
        : this.searchBruteForce(queryVector, k, options);

    return this.withCancellation(coreSearch, options);
  }

  /**
   * Search using HNSW index
   */
  private async searchWithIndex(
    queryVector: Float32Array,
    k: number,
    options?: SearchOptions,
  ): Promise<SearchResult[]> {
    if (!this.hnswIndex) {
      throw new Error('HNSW index not initialized');
    }

    const metric = this.distanceCalculator.getMetricInfo();
    const processedQuery = metric?.requiresNormalized
      ? VectorOperations.normalizeSync(queryVector)
      : queryVector;

    // Search using HNSW index
    const indexResults = await this.hnswIndex.search(processedQuery, k);

    // Check abort signal after the async index search.
    this.throwIfAborted(options?.signal);

    // Convert to search results
    const results = await Promise.all(
      indexResults.map(async (result) => {
        const searchResult: SearchResult = {
          id: result.id,
          score: this.distanceToScore(result.distance, metric?.name || 'cosine'),
          distance: result.distance,
        };
        if (options?.includeMetadata && result.metadata) {
          searchResult.metadata = result.metadata;
        }
        if (options?.includeVector) {
          const vector = await this.getVectorById(result.id);
          if (vector) {
            searchResult.vector = vector;
          }
        }
        return searchResult;
      }),
    );

    return results;
  }

  /**
   * Brute force search (fallback)
   */
  private async searchBruteForce(
    queryVector: Float32Array,
    k: number,
    options?: SearchOptions,
  ): Promise<SearchResult[]> {
    // Normalize query if needed for cosine similarity
    const metric = this.distanceCalculator.getMetricInfo();
    const processedQuery = metric?.requiresNormalized
      ? VectorOperations.normalizeSync(queryVector)
      : queryVector;

    // Get candidates (all vectors for now, will be optimized with indexing)
    const candidates = await this.getCandidates(options?.filter);

    // Check abort signal after the async storage fetch.
    this.throwIfAborted(options?.signal);

    if (candidates.length === 0) {
      return [];
    }

    // Use GPU acceleration for very large datasets
    if (this.gpuSearchEngine && candidates.length >= this.gpuThreshold) {
      return this.searchWithGPU(
        processedQuery,
        candidates,
        k,
        metric || { name: 'cosine' },
        options,
      );
    }

    // Use parallel processing for large datasets
    if (this.workerPool && candidates.length >= this.parallelThreshold) {
      return this.searchWithWorkers(processedQuery, candidates, k, options);
    }

    // Calculate distances sequentially for smaller datasets
    const scoredCandidates = this.scoreVectors(
      processedQuery,
      candidates,
      metric || { name: 'cosine' },
    );

    // Sort by distance ascending; use id as a stable tie-breaker.
    scoredCandidates.sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id));
    const topK = scoredCandidates.slice(0, k);

    // Convert to search results
    return topK.map((candidate) => {
      const searchResult: SearchResult = {
        id: candidate.id,
        score: this.distanceToScore(candidate.distance, metric?.name || 'cosine'),
        distance: candidate.distance,
      };
      if (options?.includeMetadata && candidate.metadata) {
        searchResult.metadata = candidate.metadata;
      }
      if (options?.includeVector && candidate.vector) {
        searchResult.vector = candidate.vector;
      }
      return searchResult;
    });
  }

  /**
   * Search using GPU acceleration
   */
  private async searchWithGPU(
    queryVector: Float32Array,
    candidates: VectorData[],
    k: number,
    metric: { name: string; requiresNormalized?: boolean },
    options?: SearchOptions,
  ): Promise<SearchResult[]> {
    if (!this.gpuSearchEngine) {
      throw new Error('GPU search engine not initialized');
    }

    try {
      // Initialize GPU if not already done
      await this.gpuSearchEngine.init();

      if (!this.gpuSearchEngine.isGPUReady()) {
        log.warn('GPU not ready, falling back to workers or sequential search');
        return this.fallbackFromGPU(queryVector, candidates, k, options);
      }

      // Use GPU acceleration
      const { results } = await this.gpuSearchEngine.search(
        candidates,
        queryVector,
        k,
        metric.name as DistanceMetricType,
        options,
      );

      return results;
    } catch (error) {
      log.warn('GPU search failed, falling back', {
        error: error instanceof Error ? error.message : String(error),
      });
      return this.fallbackFromGPU(queryVector, candidates, k, options);
    }
  }

  /**
   * Fallback from GPU to workers or sequential search
   */
  private async fallbackFromGPU(
    queryVector: Float32Array,
    candidates: VectorData[],
    k: number,
    options?: SearchOptions,
  ): Promise<SearchResult[]> {
    // Try workers first
    if (this.workerPool && candidates.length >= this.parallelThreshold) {
      return this.searchWithWorkers(queryVector, candidates, k, options);
    }

    // Final fallback to sequential search
    return this.searchSequential(queryVector, candidates, k, options);
  }

  /**
   * Search using Web Workers for parallel processing
   */
  private async searchWithWorkers(
    queryVector: Float32Array,
    candidates: VectorData[],
    k: number,
    options?: SearchOptions,
  ): Promise<SearchResult[]> {
    if (!this.workerPool) {
      throw new Error('Worker pool not initialized');
    }

    // Initialize worker pool if not already done
    try {
      await this.workerPool.init();
    } catch (error) {
      log.warn('Failed to initialize worker pool, falling back to sequential search', {
        error: error instanceof Error ? error.message : String(error),
      });
      return this.searchSequential(queryVector, candidates, k, options);
    }

    const metric = this.distanceCalculator.getMetricInfo();

    // Compile filter function if needed
    let filterFn: ((metadata: Record<string, unknown>) => boolean) | undefined;
    if (options?.filter) {
      filterFn = MetadataFilterCompiler.compile(options.filter);
    }

    try {
      // Check abort signal before dispatching worker tasks.
      this.throwIfAborted(options?.signal);

      // Use parallel similarity search
      const results = await this.workerPool.parallelSimilaritySearch(
        candidates,
        queryVector,
        k,
        metric?.name as DistanceMetricType,
        filterFn,
      );

      // Check abort signal after workers finish.
      this.throwIfAborted(options?.signal);

      // Convert to search results format
      return results.map((result) => {
        const searchResult: SearchResult = {
          id: result.id,
          score: result.score,
          distance: result.distance,
        };
        if (options?.includeMetadata && result.metadata) {
          searchResult.metadata = result.metadata;
        }
        if (options?.includeVector) {
          const candidate = candidates.find((c) => c.id === result.id);
          if (candidate?.vector) {
            searchResult.vector = candidate.vector;
          }
        }
        return searchResult;
      });
    } catch (error) {
      log.warn('Worker search failed, falling back to sequential search', {
        error: error instanceof Error ? error.message : String(error),
      });
      return this.searchSequential(queryVector, candidates, k, options);
    }
  }

  /**
   * Sequential search fallback
   */
  private searchSequential(
    queryVector: Float32Array,
    candidates: VectorData[],
    k: number,
    options?: SearchOptions,
  ): SearchResult[] {
    const metric = this.distanceCalculator.getMetricInfo();
    const scoredCandidates = this.scoreVectors(
      queryVector,
      candidates,
      metric || { name: 'cosine' },
    );

    // Sort by distance ascending; use id as a stable tie-breaker.
    scoredCandidates.sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id));
    const topK = scoredCandidates.slice(0, k);

    // Convert to search results
    return topK.map((candidate) => {
      const searchResult: SearchResult = {
        id: candidate.id,
        score: this.distanceToScore(candidate.distance, metric?.name || 'cosine'),
        distance: candidate.distance,
      };
      if (options?.includeMetadata && candidate.metadata) {
        searchResult.metadata = candidate.metadata;
      }
      if (options?.includeVector && candidate.vector) {
        searchResult.vector = candidate.vector;
      }
      return searchResult;
    });
  }

  /**
   * Search for vectors within a distance threshold.
   *
   * All vectors whose distance to the query is at most `maxDistance` are
   * collected first, then sorted by distance ascending with vector id as a
   * stable tie-breaker. When `options.maxResults` is set the nearest N
   * results are returned — independent of insertion order.
   */
  async searchRange(
    queryVector: Float32Array,
    maxDistance: number,
    options?: SearchOptions & { maxResults?: number },
  ): Promise<SearchResult[]> {
    // Validate dimension
    if (queryVector.length !== this.dimension) {
      throw new DimensionMismatchError(this.dimension, queryVector.length);
    }

    // Reject immediately if the caller already aborted.
    this.throwIfAborted(options?.signal);

    const rangeSearch = this.searchRangeCore(queryVector, maxDistance, options);
    return this.withCancellation(rangeSearch, options);
  }

  /**
   * Core implementation of range search (without cancellation wrapping).
   */
  private async searchRangeCore(
    queryVector: Float32Array,
    maxDistance: number,
    options?: SearchOptions & { maxResults?: number },
  ): Promise<SearchResult[]> {
    const metric = this.distanceCalculator.getMetricInfo();
    const processedQuery = metric?.requiresNormalized
      ? VectorOperations.normalizeSync(queryVector)
      : queryVector;

    // Get candidates
    const candidates = await this.getCandidates(options?.filter);
    const results: SearchResult[] = [];

    for (const candidate of candidates) {
      // Process vector if needed
      const processedVector = metric?.requiresNormalized
        ? VectorOperations.normalizeSync(candidate.vector)
        : candidate.vector;

      // Calculate distance
      const distance = this.distanceCalculator.calculate(processedQuery, processedVector);

      // Collect all matches — do NOT break early; maxResults is applied after
      // sorting so that the nearest vectors are returned regardless of insertion
      // order.
      if (distance <= maxDistance) {
        const searchResult: SearchResult = {
          id: candidate.id,
          score: this.distanceToScore(distance, metric?.name || 'cosine'),
          distance,
        };
        if (options?.includeMetadata && candidate.metadata) {
          searchResult.metadata = candidate.metadata;
        }
        if (options?.includeVector && candidate.vector) {
          searchResult.vector = candidate.vector;
        }
        results.push(searchResult);
      }
    }

    // Sort by distance ascending; use id as a stable tie-breaker so that
    // equal-distance results are returned in a consistent, documented order.
    results.sort(
      (a, b) => (a.distance ?? 0) - (b.distance ?? 0) || a.id.localeCompare(b.id),
    );

    // Apply maxResults limit after sorting to guarantee nearest results are kept.
    return options?.maxResults != null ? results.slice(0, options.maxResults) : results;
  }

  /**
   * Stream search results
   */
  async *searchStream(
    queryVector: Float32Array,
    options?: SearchOptions & {
      batchSize?: number;
      maxResults?: number;
      progressive?: boolean;
    },
  ): AsyncGenerator<SearchResult[], void, unknown> {
    // Reject immediately if already aborted.
    this.throwIfAborted(options?.signal);

    const batchSize = options?.batchSize || 10;
    const maxResults = options?.maxResults || Infinity;

    // For progressive search, start with smaller candidate sets
    if (options?.progressive) {
      yield* this.progressiveSearch(queryVector, batchSize, maxResults, options);
      return;
    }

    // Regular streaming search — run via search() which already enforces
    // timeout and signal.
    const results = await this.search(queryVector, maxResults, options);

    // Yield results in batches, checking signal between each batch.
    for (let i = 0; i < results.length; i += batchSize) {
      this.throwIfAborted(options?.signal);
      yield results.slice(i, i + batchSize);
    }
  }

  /**
   * Progressive search that improves quality over time
   */
  private async *progressiveSearch(
    queryVector: Float32Array,
    batchSize: number,
    maxResults: number,
    options?: SearchOptions,
  ): AsyncGenerator<SearchResult[], void, unknown> {
    const candidates = await this.getCandidates(options?.filter);
    const totalCandidates = candidates.length;

    // Start with a sample and progressively search more
    const sampleSizes = [
      Math.min(100, totalCandidates),
      Math.min(1000, totalCandidates),
      Math.min(10000, totalCandidates),
      totalCandidates,
    ];

    const seenIds = new Set<string>();
    let yielded = 0;

    for (const sampleSize of sampleSizes) {
      if (yielded >= maxResults) break;

      // Get sample of candidates
      const sample = candidates.slice(0, sampleSize);

      // Search within sample
      const results = await this.searchInCandidates(
        queryVector,
        sample,
        Math.min(batchSize * 2, maxResults - yielded),
        options,
      );

      // Filter out already seen results
      const newResults = results.filter((r) => !seenIds.has(r.id));

      if (newResults.length > 0) {
        // Mark as seen
        newResults.forEach((r) => seenIds.add(r.id));

        // Yield batch
        const batch = newResults.slice(0, Math.min(batchSize, maxResults - yielded));
        yield batch;
        yielded += batch.length;
      }

      // If we've searched everything, stop
      if (sampleSize === totalCandidates) break;
    }
  }

  /**
   * Get candidate vectors based on filter
   */
  private async getCandidates(filter?: MetadataFilter): Promise<VectorData[]> {
    if (!filter) {
      return this.storage.getAll();
    }

    // Compile the filter for efficient matching
    const matcher = MetadataFilterCompiler.compile(filter);

    // For now, get all and filter in memory
    // TODO: Optimize with metadata indices
    const allVectors = await this.storage.getAll();
    return allVectors.filter((vector) => matcher(vector.metadata || {}));
  }

  /**
   * Score vectors against query
   */
  private scoreVectors(
    query: Float32Array,
    candidates: VectorData[],
    metric: { name: string; requiresNormalized?: boolean },
  ): Array<VectorData & { distance: number }> {
    return candidates.map((candidate) => {
      // Process vector if needed
      const processedVector = metric?.requiresNormalized
        ? VectorOperations.normalizeSync(candidate.vector)
        : candidate.vector;

      // Calculate distance
      const distance = this.distanceCalculator.calculate(query, processedVector);

      return { ...candidate, distance };
    });
  }

  /**
   * Search within a specific set of candidates
   */
  private async searchInCandidates(
    queryVector: Float32Array,
    candidates: VectorData[],
    k: number,
    options?: SearchOptions,
  ): Promise<SearchResult[]> {
    const metric = this.distanceCalculator.getMetricInfo();
    const processedQuery = metric?.requiresNormalized
      ? VectorOperations.normalizeSync(queryVector)
      : queryVector;

    const scoredCandidates = this.scoreVectors(
      processedQuery,
      candidates,
      metric || { name: 'cosine' },
    );

    // Sort by distance ascending; use id as a stable tie-breaker.
    scoredCandidates.sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id));
    const topK = scoredCandidates.slice(0, k);

    return topK.map((candidate) => {
      const searchResult: SearchResult = {
        id: candidate.id,
        score: this.distanceToScore(candidate.distance, metric?.name || 'cosine'),
        distance: candidate.distance,
      };
      if (options?.includeMetadata && candidate.metadata) {
        searchResult.metadata = candidate.metadata;
      }
      if (options?.includeVector && candidate.vector) {
        searchResult.vector = candidate.vector;
      }
      return searchResult;
    });
  }

  /**
   * Convert distance to similarity score
   */
  private distanceToScore(distance: number, metricName: string): number {
    switch (metricName) {
      case 'cosine':
        // Cosine distance is in range [0, 2], convert to similarity [0, 1].
        // Clamp to [0, 1] to guard against floating-point drift with unit vectors.
        return Math.min(1, Math.max(0, 1 - distance / 2));

      case 'dot':
        // Dot product is negative distance, convert back
        return -distance;

      case 'euclidean':
      case 'manhattan':
        // Convert distance to similarity using exponential decay
        return Math.exp(-distance);

      case 'hamming':
        // Hamming returns raw count (0 to N), normalize by vector dimension
        if (this.dimension > 0) {
          return 1 - distance / this.dimension;
        }
        return 1 / (1 + distance);

      case 'jaccard':
        // Jaccard distance is already in [0, 1] range
        return 1 - distance;

      default:
        // Generic conversion
        return 1 / (1 + distance);
    }
  }

  /**
   * Add vector to index (if using HNSW)
   */
  async addVectorToIndex(vectorData: VectorData): Promise<void> {
    if (this.useIndex && this.hnswIndex) {
      await this.hnswIndex.addVector(vectorData);
    }
  }

  /**
   * Remove vector from index (if using HNSW)
   */
  async removeVectorFromIndex(id: string): Promise<void> {
    if (this.useIndex && this.hnswIndex) {
      await this.hnswIndex.removeVector(id);
    }
  }

  /**
   * Clear the active index and any persisted snapshot for this search engine.
   */
  async clearIndex(): Promise<void> {
    if (this.hnswIndex) {
      this.hnswIndex.clear();
    }

    if (this.indexCache) {
      await this.indexCache.deleteIndex(this.indexId);
    }
  }

  /**
   * Mark the HNSW index as dirty.
   *
   * Call this after any operation where storage writes succeeded but the
   * corresponding index mutation failed. While dirty, {@link search} falls
   * back to brute-force so stale index state is never used. Call
   * {@link rebuildIndex} to restore indexed performance.
   */
  markIndexDirty(): void {
    this.indexDirty = true;
    log.warn('Search index marked dirty — indexed search disabled until rebuild');
  }

  /**
   * Returns true if the index is dirty and brute-force search is in use.
   */
  isIndexDirty(): boolean {
    return this.indexDirty;
  }

  /**
   * Rebuild the index from storage, optionally loading a persisted snapshot first.
   *
   * When loading from cache, the cached index is validated against the current
   * storage vector count. If the counts differ (stale or incompatible index) the
   * index is rebuilt from scratch so results remain consistent.
   *
   * Clears the dirty flag on success so indexed search resumes.
   */
  async rebuildIndex(options: { loadFromCache?: boolean } = {}): Promise<void> {
    if (!this.useIndex || !this.hnswIndex) {
      return;
    }

    // Try to load from cache/persistence first
    if (options.loadFromCache !== false && this.indexCache) {
      const cached = await this.indexCache.getIndex(this.indexId);
      if (cached) {
        // Validate cached index against current storage state
        const allVectors = await this.storage.getAll();
        if (cached.index.size() === allVectors.length) {
          this.hnswIndex = cached.index;
          this.indexDirty = false;
          return;
        }

        // Stale index — node count doesn't match storage. Discard and rebuild.
        log.warn(
          `Persisted HNSW index has ${cached.index.size()} nodes but storage has ${allVectors.length} vectors; rebuilding`,
          { indexId: this.indexId },
        );

        // Clear the stale persisted entry so it doesn't get reused
        await this.indexCache.deleteIndex(this.indexId);

        // Clear existing index and rebuild from the already-fetched vectors
        this.hnswIndex.clear();
        for (const vectorData of allVectors) {
          await this.hnswIndex.addVector(vectorData);
        }
        await this.saveIndex();
        return;
      }
    }

    // Signal that a rebuild is in progress so health checks reflect it.
    this.indexCache?.setRebuilding(this.indexId, true);

    try {
      // Clear existing index
      this.hnswIndex.clear();

      // Get all vectors from storage
      const allVectors = await this.storage.getAll();

      // Add each vector to the index
      for (const vectorData of allVectors) {
        await this.hnswIndex.addVector(vectorData);
      }

      // Save rebuilt index
      await this.saveIndex();
    } finally {
      this.indexCache?.setRebuilding(this.indexId, false);
    }

    // Index is now consistent with storage
    this.indexDirty = false;
  }

  /**
   * Enable/disable indexing
   */
  setIndexing(enabled: boolean, distanceMetric?: DistanceMetricType): void {
    this.useIndex = enabled;

    if (enabled && !this.hnswIndex) {
      this.hnswIndex = new HNSWIndex(distanceMetric || 'cosine');
    } else if (!enabled) {
      this.hnswIndex = null;
    }
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
    if (!this.useIndex || !this.hnswIndex) {
      return { enabled: false, nodeCount: 0 };
    }

    const stats = this.hnswIndex.getStats();
    return {
      enabled: true,
      nodeCount: stats.nodeCount,
      levels: stats.levels,
      avgConnections: stats.avgConnections,
    };
  }

  /**
   * Return a health report for the active index without performing a search.
   *
   * Consumers can use this to detect dirty, stale, missing, incompatible,
   * rebuilding, disabled, or error states before deciding whether to run a
   * search, trigger a rebuild, or surface a warning to end users.
   *
   * When no index cache is configured (i.e. no `database` was passed to the
   * constructor), the state is either `disabled` (indexing off) or `healthy`
   * (pure in-memory index with no persistence layer).
   */
  getIndexHealth(): IndexHealthReport {
    if (!this.indexCache) {
      // No persistence layer at all.
      if (!this.useIndex) {
        return {
          indexId: this.indexId,
          state: 'disabled',
          isDirty: false,
          lastAccess: undefined,
          message: 'Indexing is disabled for this search engine instance.',
        };
      }
      // In-memory only index — always healthy if present.
      return {
        indexId: this.indexId,
        state: this.hnswIndex ? 'healthy' : 'missing',
        isDirty: false,
        lastAccess: undefined,
        message: this.hnswIndex
          ? 'In-memory index is loaded and ready (no persistence configured).'
          : 'No in-memory index is present. Call rebuildIndex() to populate it.',
      };
    }

    return this.indexCache.getHealthReport(this.indexId, this.useIndex);
  }

  /**
   * Get vector by ID (helper for index results)
   */
  private async getVectorById(id: string): Promise<Float32Array | undefined> {
    try {
      const vectorData = await this.storage.get(id);
      return vectorData?.vector;
    } catch {
      return undefined;
    }
  }

  /**
   * Save index to persistent storage
   */
  async saveIndex(): Promise<void> {
    if (!this.useIndex || !this.hnswIndex || !this.indexCache) {
      return;
    }

    const distanceMetric = this.distanceCalculator.getMetricInfo().name || 'cosine';
    await this.indexCache.putInCache(this.indexId, this.hnswIndex, distanceMetric, true);
    await this.indexCache.flushDirty();
  }

  /**
   * Load index from persistent storage
   */
  async loadIndex(): Promise<boolean> {
    if (!this.useIndex || !this.indexCache) {
      return false;
    }

    const cached = await this.indexCache.getIndex(this.indexId);
    if (cached) {
      this.hnswIndex = cached.index;
      this.distanceCalculator = createDistanceCalculator(
        cached.distanceMetric as DistanceMetricType,
      );
      return true;
    }

    return false;
  }

  /**
   * Change distance metric
   */
  setDistanceMetric(metric: DistanceMetricType): void {
    this.distanceCalculator = createDistanceCalculator(metric);

    // Recreate index with new metric if enabled
    if (this.useIndex) {
      this.hnswIndex = new HNSWIndex(metric);
    }
  }

  /**
   * Enable or disable parallel processing with workers
   */
  setWorkerPoolEnabled(
    enabled: boolean,
    config?: {
      maxWorkers?: number;
      workerScript?: string;
      timeout?: number;
      parallelThreshold?: number;
    },
  ): void {
    this.useWorkers = enabled;

    if (enabled && !this.workerPool && typeof Worker !== 'undefined') {
      this.workerPool = new WorkerPool(config);
      if (config?.parallelThreshold) {
        this.parallelThreshold = config.parallelThreshold;
      }
    } else if (!enabled && this.workerPool) {
      void this.workerPool.terminate();
      this.workerPool = null;
    }
  }

  /**
   * Get worker pool statistics
   */
  getWorkerStats(): {
    enabled: boolean;
    initialized: boolean;
    stats?: {
      totalWorkers: number;
      busyWorkers: number;
      queueLength: number;
      activeTasks: number;
      sharedMemoryEnabled: boolean;
      sharedMemoryStats?: {
        totalAllocated: number;
        totalUsed: number;
        activeBlocks: number;
        fragmentationRatio: number;
      };
    };
  } {
    return {
      enabled: this.useWorkers,
      initialized: this.workerPool !== null,
      ...(this.workerPool && { stats: this.workerPool.getStats() }),
    };
  }

  /**
   * Get GPU acceleration statistics
   */
  getGPUStats(): {
    enabled: boolean;
    initialized: boolean;
    available: boolean;
    capabilities?: {
      maxBufferSize: number;
      maxWorkgroupSize: number;
      features: string[];
    };
  } {
    const capabilities = this.gpuSearchEngine?.getGPUCapabilities();
    return {
      enabled: this.useGPU,
      initialized: this.gpuSearchEngine !== null,
      available: this.gpuSearchEngine?.isGPUReady() ?? false,
      ...(capabilities && { capabilities }),
    };
  }

  /**
   * Batch normalize vectors using workers if available
   */
  async normalizeVectorsBatch(vectors: Float32Array[]): Promise<Float32Array[]> {
    if (this.workerPool && vectors.length >= 100) {
      try {
        await this.workerPool.init();
        return await this.workerPool.normalizeVectors(vectors);
      } catch (error) {
        log.warn('Worker normalization failed, falling back to sequential', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Fallback to sequential normalization
    return vectors.map((vector) => VectorOperations.normalizeSync(vector));
  }

  /**
   * Batch similarity calculation using workers
   */
  async batchSimilarity(
    vectors: VectorData[],
    queries: Float32Array[],
    metric: DistanceMetricType = 'cosine',
  ): Promise<number[][]> {
    if (this.workerPool && vectors.length * queries.length >= 10000) {
      try {
        await this.workerPool.init();
        return await this.workerPool.batchSimilarity(vectors, queries, metric);
      } catch (error) {
        log.warn('Worker batch similarity failed, falling back to sequential', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Fallback to sequential processing
    const calculator = createDistanceCalculator(metric);
    const results: number[][] = [];

    for (const query of queries) {
      const similarities: number[] = [];
      for (const vector of vectors) {
        const distance = calculator.calculate(query, vector.vector);
        const score = this.distanceToScore(distance, metric);
        similarities.push(score);
      }
      results.push(similarities);
    }

    return results;
  }

  /**
   * Use SharedArrayBuffer for zero-copy operations when available
   */
  async sharedMemorySearch(
    vectors: Float32Array[],
    queryVector: Float32Array,
    k: number,
    metric: DistanceMetricType = 'cosine',
  ): Promise<Array<{ index: number; distance: number; score: number }>> {
    if (!this.workerPool || typeof SharedArrayBuffer === 'undefined') {
      throw new Error('SharedArrayBuffer support or worker pool not available');
    }

    try {
      await this.workerPool.init();
      return await this.workerPool.sharedMemorySearch(vectors, queryVector, k, metric);
    } catch (error) {
      throw new Error(`Shared memory search failed: ${error}`, { cause: error });
    }
  }

  /**
   * Enable or disable GPU acceleration
   */
  setGPUAcceleration(enabled: boolean, config?: GPUSearchConfig): void {
    this.useGPU = enabled;

    if (
      enabled &&
      !this.gpuSearchEngine &&
      typeof navigator !== 'undefined' &&
      'gpu' in navigator
    ) {
      this.gpuSearchEngine = new GPUSearchEngine(config);
      if (config?.gpuThreshold) {
        this.gpuThreshold = config.gpuThreshold;
      }
    } else if (!enabled && this.gpuSearchEngine) {
      void this.gpuSearchEngine.cleanup();
      this.gpuSearchEngine = null;
    }
  }

  /**
   * Enable or disable shared memory optimizations
   */
  setSharedMemoryOptimizations(
    enabled: boolean,
    config?: {
      maxPoolSize?: number;
      enableOptimizations?: boolean;
      chunkSize?: number;
    },
  ): void {
    if (this.workerPool) {
      this.workerPool.setSharedMemoryOptimizations(enabled, config);
    }
  }

  /**
   * Cleanup shared memory periodically
   */
  cleanupSharedMemory(maxAge?: number): void {
    if (this.workerPool) {
      this.workerPool.cleanupSharedMemory(maxAge);
    }
  }

  /**
   * Clean up resources
   */
  async cleanup(): Promise<void> {
    if (this.workerPool) {
      await this.workerPool.terminate();
      this.workerPool = null;
    }

    if (this.gpuSearchEngine) {
      await this.gpuSearchEngine.cleanup();
      this.gpuSearchEngine = null;
    }
  }
}
