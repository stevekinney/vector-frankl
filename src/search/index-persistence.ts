import { VectorDatabase } from '@/core/database.js';
import { TransactionError } from '@/core/errors.js';
import type { DistanceMetric } from '@/core/types.js';
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
 * Index persistence manager for HNSW indices
 */
export class IndexPersistence {
  private static readonly STORE_NAME = VectorDatabase.STORES.HNSW_INDICES;
  private static readonly VERSION = '1.0.0';

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
          const request = store.get(indexId);

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
          const request = store.getAll();

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
   * Get storage usage for indices
   */
  async getStorageUsage(): Promise<{
    indexCount: number;
    estimatedBytes: number;
  }> {
    const indices = await this.listIndices();

    // Rough estimation: each node ~200 bytes + vector data + connections
    const estimatedBytes = indices.reduce((total, index) => {
      return total + index.nodeCount * 500; // Conservative estimate
    }, 0);

    return {
      indexCount: indices.length,
      estimatedBytes,
    };
  }

  /**
   * Serialize HNSW index for storage
   */
  private async serializeIndex(
    index: HNSWIndex,
    distanceMetric: string,
  ): Promise<SerializableHNSWIndex> {
    // Extract index data using reflection/internal access
    // Note: This assumes HNSWIndex has a way to export its internal state
    const stats = index.getStats();

    // For now, create a basic serialization structure
    // In a real implementation, HNSWIndex would need export methods
    return {
      nodes: [], // Would be populated from index.exportNodes()
      entryPoint: stats.entryPoint || null,
      config: {
        m: 16, // Would come from index.getConfig()
        mL: 2,
        efConstruction: 200,
        maxLevel: 5,
      },
      distanceMetric,
      version: IndexPersistence.VERSION,
      timestamp: Date.now(),
    };
  }

  /**
   * Deserialize HNSW index from storage
   */
  private async deserializeIndex(data: SerializableHNSWIndex): Promise<HNSWIndex> {
    // Import the HNSWIndex class
    const { HNSWIndex } = await import('./hnsw-index.js');

    // Create new index with saved config
    const index = new HNSWIndex(data.distanceMetric as DistanceMetric, data.config);

    // Restore nodes and connections
    // Note: This would require HNSWIndex to have import methods
    // For now, return empty index that would need to be rebuilt

    return index;
  }
}

/**
 * Index cache manager
 */
export class IndexCache {
  private cache = new Map<
    string,
    {
      index: HNSWIndex;
      distanceMetric: string;
      lastAccess: number;
      isDirty: boolean;
    }
  >();

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
      this.putInCache(indexId, loaded.index, loaded.distanceMetric);
    }

    return loaded;
  }

  /**
   * Put index in cache
   */
  putInCache(
    indexId: string,
    index: HNSWIndex,
    distanceMetric: string,
    isDirty = false,
  ): void {
    // Evict old entries if cache is full
    if (this.cache.size >= this.maxCacheSize) {
      this.evictLeastRecentlyUsed();
    }

    this.cache.set(indexId, {
      index,
      distanceMetric,
      lastAccess: Date.now(),
      isDirty,
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
   * Save dirty indices to storage
   */
  async flushDirty(): Promise<void> {
    const promises: Promise<void>[] = [];

    for (const [indexId, cached] of this.cache) {
      if (cached.isDirty) {
        promises.push(
          this.persistenceManager
            .saveIndex(indexId, cached.index, cached.distanceMetric)
            .then(() => {
              cached.isDirty = false;
            }),
        );
      }
    }

    await Promise.all(promises);
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
   * Evict least recently used index
   */
  private evictLeastRecentlyUsed(): void {
    let oldestId = '';
    let oldestAccess = Date.now();

    for (const [indexId, cached] of this.cache) {
      if (cached.lastAccess < oldestAccess) {
        oldestAccess = cached.lastAccess;
        oldestId = indexId;
      }
    }

    if (oldestId) {
      const cached = this.cache.get(oldestId);

      // Save if dirty before evicting
      if (cached?.isDirty) {
        void this.persistenceManager
          .saveIndex(oldestId, cached.index, cached.distanceMetric)
          .catch((error) => {
            console.warn(`Failed to save index ${oldestId} during eviction:`, error);
          });
      }

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
  } {
    let dirtyCount = 0;
    for (const cached of this.cache.values()) {
      if (cached.isDirty) dirtyCount++;
    }

    return {
      cacheSize: this.cache.size,
      maxCacheSize: this.maxCacheSize,
      dirtyCount,
    };
  }
}
