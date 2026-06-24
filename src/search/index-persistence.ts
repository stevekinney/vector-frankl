import { VectorDatabase } from '@/core/database.js';
import { IndexError, TransactionError } from '@/core/errors.js';
import type { DistanceMetric } from '@/core/types.js';
import { log } from '@/utilities/logger.js';
import type { HNSWIndex } from './hnsw-index.js';

/**
 * Serializable representation of HNSW index
 */
interface SerializableHNSWNode {
  id: string;
  vector: number[]; // Convert Float32Array to regular array for JSON
  metadata?: Record<string, unknown>;
  level: number;
  connections: Record<number, string[]>; // level -> connected node IDs
}

interface SerializableHNSWIndex {
  nodes: SerializableHNSWNode[];
  entryPoint: string | null;
  config: {
    m: number;
    mL: number;
    efConstruction: number;
    maxLevel: number;
    seed?: number;
  };
  distanceMetric: string;
  version: string;
  timestamp: number;
}

/**
 * Health states an index entry can be in, queryable without performing a search.
 *
 * - `healthy`       — loaded, clean, and ready for search.
 * - `dirty`         — in-memory mutations exist that have not yet been persisted.
 * - `stale`         — the entry was loaded from storage but the in-memory copy has
 *                     not been refreshed since the last known storage write.
 * - `missing`       — no entry exists in cache or storage for the given index ID.
 * - `incompatible`  — a persisted entry was found but its serialization version is
 *                     not supported; a rebuild is required.
 * - `rebuilding`    — the index is currently being rebuilt from raw storage.
 * - `disabled`      — indexing is turned off for this search engine instance.
 * - `error`         — a prior persistence or load attempt failed; the entry may be
 *                     partially valid and should be treated with caution.
 */
export type IndexHealthState =
  | 'healthy'
  | 'dirty'
  | 'stale'
  | 'missing'
  | 'incompatible'
  | 'rebuilding'
  | 'disabled'
  | 'error';

/** Full health report for a single cached index entry. */
export type IndexHealthReport = {
  /** The index ID this report describes. */
  indexId: string;
  /** Current health state. */
  state: IndexHealthState;
  /** True when the in-memory copy has unsaved mutations. */
  isDirty: boolean;
  /** Last successful access timestamp (ms since epoch), or undefined if never accessed. */
  lastAccess: number | undefined;
  /** Human-readable description of what the state means and how to recover. */
  message: string;
  /** The error that caused the `error` state, if applicable. */
  persistenceError?: Error | undefined;
};

/**
 * Index persistence manager for HNSW indices
 */
export class IndexPersistence {
  private static readonly STORE_NAME = VectorDatabase.STORES.HNSW_INDICES;
  private static readonly VERSION = '1.0.0';

  /**
   * Supported serialization versions that this implementation can load.
   * Versions outside this set will produce an explicit rebuild error rather
   * than silently returning bad data.
   */
  private static readonly SUPPORTED_VERSIONS = new Set(['1.0.0']);

  constructor(private database: VectorDatabase) {}

  /**
   * Save HNSW index to IndexedDB
   */
  async saveIndex(
    indexId: string,
    index: HNSWIndex,
    distanceMetric: string,
  ): Promise<void> {
    const serializedIndex = await this.serializeIndex(index, distanceMetric);

    await this.database.executeTransaction(
      IndexPersistence.STORE_NAME,
      'readwrite',
      async (transaction) => {
        const store = transaction.objectStore(IndexPersistence.STORE_NAME);

        return new Promise<void>((resolve, reject) => {
          const request = store.put({
            id: indexId,
            data: serializedIndex,
            timestamp: Date.now(),
          });

          request.onsuccess = () => resolve();
          request.onerror = () =>
            reject(
              new TransactionError(
                'save index',
                `Failed to save index: ${indexId}`,
                request.error || undefined,
              ),
            );
        });
      },
    );
  }

  /**
   * Load HNSW index from IndexedDB
   */
  async loadIndex(indexId: string): Promise<{
    index: HNSWIndex;
    distanceMetric: string;
  } | null> {
    const result = await this.database.executeTransaction(
      IndexPersistence.STORE_NAME,
      'readonly',
      async (transaction) => {
        const store = transaction.objectStore(IndexPersistence.STORE_NAME);

        return new Promise<
          { id: string; data: SerializableHNSWIndex; timestamp: number } | undefined
        >((resolve, reject) => {
          const request = store.get<{
            id: string;
            data: SerializableHNSWIndex;
            timestamp: number;
          }>(indexId);

          request.onsuccess = () => resolve(request.result);
          request.onerror = () =>
            reject(
              new TransactionError(
                'load index',
                `Failed to load index: ${indexId}`,
                request.error || undefined,
              ),
            );
        });
      },
    );

    if (!result || !result.data) {
      return null;
    }

    const serializedIndex = result.data as SerializableHNSWIndex;

    // Reject indexes whose serialization format is not supported by this version.
    if (
      serializedIndex.version &&
      !IndexPersistence.SUPPORTED_VERSIONS.has(serializedIndex.version)
    ) {
      throw new IndexError(
        'HNSW',
        'load',
        `Index '${indexId}' was serialized with version '${serializedIndex.version}' which is not supported ` +
          `(supported: ${[...IndexPersistence.SUPPORTED_VERSIONS].join(', ')}). ` +
          `Delete the stored index and rebuild it from scratch to recover.`,
      );
    }

    const index = await this.deserializeIndex(serializedIndex);

    return {
      index,
      distanceMetric: serializedIndex.distanceMetric,
    };
  }

  /**
   * Delete index from IndexedDB
   */
  async deleteIndex(indexId: string): Promise<void> {
    await this.database.executeTransaction(
      IndexPersistence.STORE_NAME,
      'readwrite',
      async (transaction) => {
        const store = transaction.objectStore(IndexPersistence.STORE_NAME);

        return new Promise<void>((resolve, reject) => {
          const request = store.delete(indexId);

          request.onsuccess = () => resolve();
          request.onerror = () =>
            reject(
              new TransactionError(
                'delete index',
                `Failed to delete index: ${indexId}`,
                request.error || undefined,
              ),
            );
        });
      },
    );
  }

  /**
   * List all saved indices
   */
  async listIndices(): Promise<
    Array<{
      id: string;
      timestamp: number;
      nodeCount: number;
      distanceMetric: string;
    }>
  > {
    const result = await this.database.executeTransaction(
      IndexPersistence.STORE_NAME,
      'readonly',
      async (transaction) => {
        const store = transaction.objectStore(IndexPersistence.STORE_NAME);

        return new Promise<
          Array<{ id: string; data: SerializableHNSWIndex; timestamp: number }>
        >((resolve, reject) => {
          const request = store.getAll<{
            id: string;
            data: SerializableHNSWIndex;
            timestamp: number;
          }>();

          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () =>
            reject(
              new TransactionError(
                'list indices',
                'Failed to list indices',
                request.error || undefined,
              ),
            );
        });
      },
    );

    return result.map((item) => ({
      id: item.id,
      timestamp: item.timestamp,
      nodeCount: item.data.nodes.length,
      distanceMetric: item.data.distanceMetric,
    }));
  }

  /**
   * Get storage usage for indices.
   *
   * Bytes are measured from the actual JSON-serialized representation of each
   * stored record, not from a fixed per-node estimate.
   */
  async getStorageUsage(): Promise<{
    indexCount: number;
    /** Measured byte count of all serialized index records. */
    measuredBytes: number;
  }> {
    const result = await this.database.executeTransaction(
      IndexPersistence.STORE_NAME,
      'readonly',
      async (transaction) => {
        const store = transaction.objectStore(IndexPersistence.STORE_NAME);

        return new Promise<
          Array<{ id: string; data: SerializableHNSWIndex; timestamp: number }>
        >((resolve, reject) => {
          const request = store.getAll<{
            id: string;
            data: SerializableHNSWIndex;
            timestamp: number;
          }>();

          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () =>
            reject(
              new TransactionError(
                'get storage usage',
                'Failed to read index records',
                request.error || undefined,
              ),
            );
        });
      },
    );

    // Measure bytes from the serialized representation of each record.
    let measuredBytes = 0;
    for (const record of result) {
      try {
        const serialized = JSON.stringify(record);
        // TextEncoder gives the actual UTF-8 byte count, which matches what
        // IndexedDB stores for structured-clone / JSON payloads.
        measuredBytes += new TextEncoder().encode(serialized).byteLength;
      } catch {
        // If a record cannot be serialized, skip it — don't accumulate bad data.
      }
    }

    return {
      indexCount: result.length,
      measuredBytes,
    };
  }

  /**
   * Serialize HNSW index for storage
   */
  private async serializeIndex(
    index: HNSWIndex,
    distanceMetric: string,
  ): Promise<SerializableHNSWIndex> {
    const exported = index.exportState();

    const nodes: SerializableHNSWNode[] = exported.nodes.map((node) => {
      const connections: Record<number, string[]> = {};
      for (const [level, ids] of node.connections) {
        connections[level] = ids;
      }
      const serialized: SerializableHNSWNode = {
        id: node.id,
        vector: node.vector,
        level: node.level,
        connections,
      };
      if (node.metadata) {
        serialized.metadata = node.metadata;
      }
      return serialized;
    });

    return {
      nodes,
      entryPoint: exported.entryPoint,
      config: exported.config,
      distanceMetric,
      version: IndexPersistence.VERSION,
      timestamp: Date.now(),
    };
  }

  /**
   * Deserialize HNSW index from storage
   */
  private async deserializeIndex(data: SerializableHNSWIndex): Promise<HNSWIndex> {
    const { HNSWIndex } = await import('./hnsw-index.js');

    const index = new HNSWIndex(data.distanceMetric as DistanceMetric, data.config);

    // Convert serialized nodes back to import format
    const nodes = data.nodes.map((node) => {
      const connections: Array<[number, string[]]> = Object.entries(node.connections).map(
        ([level, ids]) => [Number(level), ids],
      );
      const imported: {
        id: string;
        vector: number[];
        metadata?: Record<string, unknown>;
        level: number;
        connections: Array<[number, string[]]>;
      } = {
        id: node.id,
        vector: node.vector,
        level: node.level,
        connections,
      };
      if (node.metadata) {
        imported.metadata = node.metadata;
      }
      return imported;
    });

    index.importState({
      nodes,
      entryPoint: data.entryPoint,
    });

    return index;
  }
}

/** Internal shape of a single cache slot. */
type CacheEntry = {
  index: HNSWIndex;
  distanceMetric: string;
  lastAccess: number;
  isDirty: boolean;
  /** Set when a persistence attempt failed; the entry stays in cache. */
  persistenceError: Error | undefined;
};

/**
 * Index cache manager.
 *
 * Wraps `IndexPersistence` with an in-memory LRU cache.  When the cache
 * exceeds its size limit, the least-recently-used entry is evicted.  If that
 * entry has unsaved mutations (`isDirty`), eviction **awaits** the save; on
 * failure the entry is **kept in cache** with a retryable `persistenceError`
 * flag rather than dropping the mutations silently.
 */
export class IndexCache {
  private cache = new Map<string, CacheEntry>();

  private maxCacheSize = 5; // Maximum number of cached indices
  private persistenceManager: IndexPersistence;

  constructor(database: VectorDatabase) {
    this.persistenceManager = new IndexPersistence(database);
  }

  /**
   * Get index from cache or load from storage
   */
  async getIndex(indexId: string): Promise<{
    index: HNSWIndex;
    distanceMetric: string;
  } | null> {
    const cached = this.cache.get(indexId);

    if (cached) {
      cached.lastAccess = Date.now();
      return {
        index: cached.index,
        distanceMetric: cached.distanceMetric,
      };
    }

    // Load from storage
    const loaded = await this.persistenceManager.loadIndex(indexId);

    if (loaded) {
      await this.putInCache(indexId, loaded.index, loaded.distanceMetric);
    }

    return loaded;
  }

  /**
   * Put index in cache.
   *
   * Returns a Promise that resolves once any necessary eviction has been
   * durably persisted (or the eviction was skipped because no dirty entry
   * needed flushing).  Callers that do not need to sequence on eviction may
   * ignore the returned Promise.
   */
  async putInCache(
    indexId: string,
    index: HNSWIndex,
    distanceMetric: string,
    isDirty = false,
  ): Promise<void> {
    // Evict old entries if cache is full
    if (this.cache.size >= this.maxCacheSize) {
      await this.evictLeastRecentlyUsed();
    }

    this.cache.set(indexId, {
      index,
      distanceMetric,
      lastAccess: Date.now(),
      isDirty,
      persistenceError: undefined,
    });
  }

  /**
   * Mark index as dirty (needs saving)
   */
  markDirty(indexId: string): void {
    const cached = this.cache.get(indexId);
    if (cached) {
      cached.isDirty = true;
    }
  }

  /**
   * Save all dirty indices to storage.
   *
   * On success each entry's `isDirty` flag is cleared.  Errors are propagated
   * via `Promise.allSettled` — a single failure does not abort the others, but
   * the returned Promise rejects after all saves complete if any of them failed.
   */
  async flushDirty(): Promise<void> {
    const results = await Promise.allSettled(
      Array.from(this.cache.entries())
        .filter(([, cached]) => cached.isDirty)
        .map(([indexId, cached]) =>
          this.persistenceManager
            .saveIndex(indexId, cached.index, cached.distanceMetric)
            .then(() => {
              cached.isDirty = false;
              cached.persistenceError = undefined;
            })
            .catch((error) => {
              cached.persistenceError =
                error instanceof Error ? error : new Error(String(error));
              throw error;
            }),
        ),
    );

    const failures = results.filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );
    if (failures.length > 0) {
      const messages = failures.map((f) => String(f.reason)).join('; ');
      throw new Error(
        `flushDirty: ${failures.length} index(es) failed to persist: ${messages}`,
      );
    }
  }

  /**
   * Clear cache
   */
  async clear(saveFirst = true): Promise<void> {
    if (saveFirst) {
      await this.flushDirty();
    }
    this.cache.clear();
  }

  /**
   * Remove an index from cache and persistence.
   */
  async deleteIndex(indexId: string): Promise<void> {
    this.cache.delete(indexId);
    await this.persistenceManager.deleteIndex(indexId);
  }

  /**
   * Evict the least-recently-used cache entry.
   *
   * If the candidate entry is dirty, the eviction **awaits** persistence.
   * On failure the entry is **left in cache** with `persistenceError` set so
   * callers can detect and retry the save without the mutations being dropped.
   */
  private async evictLeastRecentlyUsed(): Promise<void> {
    let oldestId = '';
    let oldestAccess = Date.now();

    for (const [indexId, cached] of this.cache) {
      if (cached.lastAccess < oldestAccess) {
        oldestAccess = cached.lastAccess;
        oldestId = indexId;
      }
    }

    if (!oldestId) return;

    const cached = this.cache.get(oldestId);
    if (!cached) return;

    if (cached.isDirty) {
      try {
        await this.persistenceManager.saveIndex(
          oldestId,
          cached.index,
          cached.distanceMetric,
        );
        cached.isDirty = false;
        cached.persistenceError = undefined;
        // Persistence succeeded — safe to remove from cache.
        this.cache.delete(oldestId);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        log.warn(`Failed to save index ${oldestId} during eviction — keeping in cache`, {
          error: err.message,
        });
        // Mark the entry with the error but do NOT evict it.  Unsaved
        // mutations must not be dropped silently.
        cached.persistenceError = err;
      }
    } else {
      // Clean entry: evict immediately.
      this.cache.delete(oldestId);
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    cacheSize: number;
    maxCacheSize: number;
    dirtyCount: number;
    errorCount: number;
  } {
    let dirtyCount = 0;
    let errorCount = 0;
    for (const cached of this.cache.values()) {
      if (cached.isDirty) dirtyCount++;
      if (cached.persistenceError) errorCount++;
    }

    return {
      cacheSize: this.cache.size,
      maxCacheSize: this.maxCacheSize,
      dirtyCount,
      errorCount,
    };
  }

  /**
   * Signal that the named index is currently being rebuilt.
   *
   * The `SearchEngine` calls this before starting and after finishing a rebuild
   * so that health checks can surface the `rebuilding` state accurately.
   */
  setRebuilding(indexId: string, rebuilding: boolean): void {
    if (rebuilding) {
      this.rebuildingIds.add(indexId);
    } else {
      this.rebuildingIds.delete(indexId);
    }
  }

  /** Set of index IDs that are currently being rebuilt. */
  private rebuildingIds = new Set<string>();

  /**
   * Return a health report for the named index without performing a search.
   *
   * The report includes the current `IndexHealthState` and a human-readable
   * message explaining what it means and how to recover.
   */
  getHealthReport(indexId: string, indexingEnabled: boolean): IndexHealthReport {
    if (!indexingEnabled) {
      return {
        indexId,
        state: 'disabled',
        isDirty: false,
        lastAccess: undefined,
        message: 'Indexing is disabled for this search engine instance.',
      };
    }

    if (this.rebuildingIds.has(indexId)) {
      const cached = this.cache.get(indexId);
      return {
        indexId,
        state: 'rebuilding',
        isDirty: cached?.isDirty ?? false,
        lastAccess: cached?.lastAccess,
        message: 'The index is currently being rebuilt from storage.',
      };
    }

    const cached = this.cache.get(indexId);

    if (!cached) {
      return {
        indexId,
        state: 'missing',
        isDirty: false,
        lastAccess: undefined,
        message:
          'No index entry exists in the cache. Call rebuildIndex() to populate it, or ' +
          'perform a search to trigger an automatic load.',
      };
    }

    if (cached.persistenceError) {
      return {
        indexId,
        state: 'error',
        isDirty: cached.isDirty,
        lastAccess: cached.lastAccess,
        message:
          `A previous persistence attempt failed: ${cached.persistenceError.message}. ` +
          'Call flushDirty() to retry.',
        persistenceError: cached.persistenceError,
      };
    }

    if (cached.isDirty) {
      return {
        indexId,
        state: 'dirty',
        isDirty: true,
        lastAccess: cached.lastAccess,
        message:
          'The index has unsaved mutations. Call saveIndex() or flushDirty() to persist them.',
      };
    }

    return {
      indexId,
      state: 'healthy',
      isDirty: false,
      lastAccess: cached.lastAccess,
      message: 'The index is loaded and up to date.',
    };
  }
}
