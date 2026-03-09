import { describe, expect, it } from 'bun:test';

import type { VectorData } from '@/core/types.js';
import { HNSWIndex } from '@/search/hnsw-index.js';
import { IndexCache } from '@/search/index-persistence.js';

function makeVector(
  id: string,
  values: number[],
  metadata?: Record<string, unknown>,
): VectorData {
  const vector = new Float32Array(values);
  const magnitude = Math.sqrt(values.reduce((sum, v) => sum + v * v, 0));
  const result: VectorData = {
    id,
    vector,
    magnitude,
    timestamp: Date.now(),
  };
  if (metadata) {
    result.metadata = metadata;
  }
  return result;
}

/**
 * Create an IndexCache with a stubbed-out VectorDatabase.
 *
 * IndexCache only touches VectorDatabase indirectly through IndexPersistence,
 * and persistence operations (loadIndex, saveIndex) require IndexedDB which is
 * unavailable in Bun. We pass a minimal stub so the constructor succeeds, and
 * test only the in-memory cache behavior via putInCache / getIndex cache-hit
 * path / markDirty / getStats / clear / eviction.
 */
function createTestCache(): IndexCache {
  // VectorDatabase constructor checks for IndexedDB and throws, so we bypass
  // it by casting a plain object. The persistence manager will exist but any
  // actual load/save calls will fail -- which is fine since we only test cache
  // hit paths and in-memory bookkeeping.
  const stubDatabase = {} as ConstructorParameters<typeof IndexCache>[0];
  return new IndexCache(stubDatabase);
}

function createIndex(distanceMetric: 'cosine' | 'euclidean' = 'cosine'): HNSWIndex {
  return new HNSWIndex(distanceMetric, { m: 4, efConstruction: 20, maxLevel: 2 });
}

describe('IndexCache', () => {
  describe('putInCache and getIndex', () => {
    it('should return a cached index on cache hit', async () => {
      const cache = createTestCache();
      const index = createIndex();
      await index.addVector(makeVector('v1', [1, 0, 0]));

      cache.putInCache('test-index', index, 'cosine');

      const result = await cache.getIndex('test-index');

      expect(result).not.toBeNull();
      expect(result!.index).toBe(index);
      expect(result!.distanceMetric).toBe('cosine');
    });

    it('should return null for an index not in cache when persistence fails', async () => {
      const cache = createTestCache();

      // getIndex on a cache miss tries to load from persistence, which will
      // fail because we have no real IndexedDB. The error surfaces as null.
      const result = await cache.getIndex('nonexistent').catch(() => null);

      expect(result).toBeNull();
    });

    it('should store multiple distinct indices', async () => {
      const cache = createTestCache();

      const indexA = createIndex('cosine');
      const indexB = createIndex('euclidean');

      cache.putInCache('index-a', indexA, 'cosine');
      cache.putInCache('index-b', indexB, 'euclidean');

      const resultA = await cache.getIndex('index-a');
      const resultB = await cache.getIndex('index-b');

      expect(resultA!.index).toBe(indexA);
      expect(resultA!.distanceMetric).toBe('cosine');
      expect(resultB!.index).toBe(indexB);
      expect(resultB!.distanceMetric).toBe('euclidean');
    });

    it('should overwrite an existing entry when put with the same id', async () => {
      const cache = createTestCache();

      const original = createIndex('cosine');
      const replacement = createIndex('euclidean');

      cache.putInCache('my-index', original, 'cosine');
      cache.putInCache('my-index', replacement, 'euclidean');

      const result = await cache.getIndex('my-index');

      expect(result!.index).toBe(replacement);
      expect(result!.distanceMetric).toBe('euclidean');
    });
  });

  describe('getStats', () => {
    it('should report zero for an empty cache', () => {
      const cache = createTestCache();
      const stats = cache.getStats();

      expect(stats.cacheSize).toBe(0);
      expect(stats.maxCacheSize).toBe(5);
      expect(stats.dirtyCount).toBe(0);
    });

    it('should reflect the number of cached indices', () => {
      const cache = createTestCache();

      cache.putInCache('a', createIndex(), 'cosine');
      cache.putInCache('b', createIndex(), 'cosine');
      cache.putInCache('c', createIndex(), 'cosine');

      const stats = cache.getStats();

      expect(stats.cacheSize).toBe(3);
      expect(stats.maxCacheSize).toBe(5);
      expect(stats.dirtyCount).toBe(0);
    });

    it('should count dirty entries', () => {
      const cache = createTestCache();

      cache.putInCache('a', createIndex(), 'cosine');
      cache.putInCache('b', createIndex(), 'cosine');
      cache.putInCache('c', createIndex(), 'cosine');

      cache.markDirty('a');
      cache.markDirty('c');

      expect(cache.getStats().dirtyCount).toBe(2);
    });

    it('should count entries inserted with isDirty flag', () => {
      const cache = createTestCache();

      cache.putInCache('a', createIndex(), 'cosine', true);
      cache.putInCache('b', createIndex(), 'cosine', false);
      cache.putInCache('c', createIndex(), 'cosine', true);

      expect(cache.getStats().dirtyCount).toBe(2);
    });
  });

  describe('markDirty', () => {
    it('should mark an existing entry as dirty', () => {
      const cache = createTestCache();
      cache.putInCache('idx', createIndex(), 'cosine');

      expect(cache.getStats().dirtyCount).toBe(0);

      cache.markDirty('idx');

      expect(cache.getStats().dirtyCount).toBe(1);
    });

    it('should be a no-op for a nonexistent index', () => {
      const cache = createTestCache();

      // Should not throw
      cache.markDirty('does-not-exist');

      expect(cache.getStats().dirtyCount).toBe(0);
    });

    it('should be idempotent when called multiple times', () => {
      const cache = createTestCache();
      cache.putInCache('idx', createIndex(), 'cosine');

      cache.markDirty('idx');
      cache.markDirty('idx');
      cache.markDirty('idx');

      expect(cache.getStats().dirtyCount).toBe(1);
    });
  });

  describe('clear', () => {
    it('should empty the cache when called with saveFirst=false', async () => {
      const cache = createTestCache();

      cache.putInCache('a', createIndex(), 'cosine');
      cache.putInCache('b', createIndex(), 'cosine');

      expect(cache.getStats().cacheSize).toBe(2);

      await cache.clear(false);

      expect(cache.getStats().cacheSize).toBe(0);
    });

    it('should allow re-populating the cache after clearing', async () => {
      const cache = createTestCache();

      cache.putInCache('a', createIndex(), 'cosine');
      await cache.clear(false);

      cache.putInCache('b', createIndex(), 'euclidean');

      const stats = cache.getStats();
      expect(stats.cacheSize).toBe(1);

      const result = await cache.getIndex('b');
      expect(result).not.toBeNull();
      expect(result!.distanceMetric).toBe('euclidean');
    });

    it('should reset dirty count to zero', async () => {
      const cache = createTestCache();

      cache.putInCache('a', createIndex(), 'cosine', true);
      cache.putInCache('b', createIndex(), 'cosine', true);

      expect(cache.getStats().dirtyCount).toBe(2);

      await cache.clear(false);

      expect(cache.getStats().dirtyCount).toBe(0);
    });
  });

  describe('LRU eviction', () => {
    // evictLeastRecentlyUsed compares lastAccess timestamps with strict <,
    // so entries must have distinct timestamps for eviction to work. We use
    // Bun.sleep(1) between insertions to guarantee at least 1ms separation.

    it('should evict the least recently used entry when cache exceeds max size', async () => {
      const cache = createTestCache();

      // Fill the cache to capacity (maxCacheSize = 5)
      for (let i = 0; i < 5; i++) {
        cache.putInCache(`index-${i}`, createIndex(), 'cosine');
        await Bun.sleep(1);
      }

      expect(cache.getStats().cacheSize).toBe(5);

      // Adding a 6th entry should trigger eviction of the oldest
      cache.putInCache('index-5', createIndex(), 'cosine');

      expect(cache.getStats().cacheSize).toBe(5);
    });

    it('should evict the entry with the oldest lastAccess timestamp', async () => {
      const cache = createTestCache();

      // Insert entries with distinct timestamps via sleep
      cache.putInCache('oldest', createIndex(), 'cosine');
      await Bun.sleep(1);
      cache.putInCache('second', createIndex(), 'cosine');
      await Bun.sleep(1);
      cache.putInCache('third', createIndex(), 'cosine');
      await Bun.sleep(1);
      cache.putInCache('fourth', createIndex(), 'cosine');
      await Bun.sleep(1);
      cache.putInCache('fifth', createIndex(), 'cosine');
      await Bun.sleep(1);

      // Access "oldest" to give it a fresh lastAccess timestamp, making
      // "second" the true LRU candidate
      await cache.getIndex('oldest');
      await Bun.sleep(1);

      // Trigger eviction by inserting a 6th entry -- "second" should be evicted
      cache.putInCache('sixth', createIndex(), 'cosine');

      expect(cache.getStats().cacheSize).toBe(5);

      // "oldest" should still be in cache because we touched it recently
      const oldestResult = await cache.getIndex('oldest');
      expect(oldestResult).not.toBeNull();
      expect(oldestResult!.index).toBeDefined();
    });

    it('should maintain max cache size after multiple insertions beyond capacity', async () => {
      const cache = createTestCache();

      // Insert 10 entries into a cache with max size 5
      for (let i = 0; i < 10; i++) {
        cache.putInCache(`index-${i}`, createIndex(), 'cosine');
        await Bun.sleep(1);
      }

      expect(cache.getStats().cacheSize).toBe(5);
    });
  });

  describe('HNSWIndex serialization round-trip', () => {
    it('should export and import a single-vector index', async () => {
      const index = createIndex();
      await index.addVector(makeVector('v1', [1, 0, 0]));

      const state = index.exportState();
      expect(state.nodes).toHaveLength(1);
      expect(state.entryPoint).toBe('v1');

      const restored = createIndex();
      restored.importState(state);

      expect(restored.size()).toBe(1);
    });

    it('should preserve search behavior after round-trip', async () => {
      const index = createIndex();
      await index.addVector(makeVector('v1', [1, 0, 0]));
      await index.addVector(makeVector('v2', [0, 1, 0]));
      await index.addVector(makeVector('v3', [0, 0, 1]));

      const state = index.exportState();

      const restored = createIndex();
      restored.importState(state);

      const query = new Float32Array([1, 0, 0]);
      const results = await restored.search(query, 1);

      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe('v1');
    });

    it('should preserve metadata through the round-trip', async () => {
      const index = createIndex();
      await index.addVector(makeVector('v1', [1, 0, 0], { category: 'test', score: 99 }));

      const state = index.exportState();
      const node = state.nodes.find((n) => n.id === 'v1');
      expect(node?.metadata).toEqual({ category: 'test', score: 99 });

      const restored = createIndex();
      restored.importState(state);

      const results = await restored.search(new Float32Array([1, 0, 0]), 1);
      expect(results[0]!.metadata).toEqual({ category: 'test', score: 99 });
    });

    it('should round-trip an empty index', () => {
      const index = createIndex();
      const state = index.exportState();

      expect(state.nodes).toHaveLength(0);
      expect(state.entryPoint).toBeNull();

      const restored = createIndex();
      restored.importState(state);

      expect(restored.size()).toBe(0);
    });

    it('should preserve node count and connections after round-trip', async () => {
      const index = createIndex();

      for (let i = 0; i < 8; i++) {
        const values = [0, 0, 0];
        values[i % 3] = 1;
        await index.addVector(makeVector(`v${i}`, values));
      }

      const originalStats = index.getStats();
      const state = index.exportState();

      const restored = createIndex();
      restored.importState(state);

      const restoredStats = restored.getStats();

      expect(restoredStats.nodeCount).toBe(originalStats.nodeCount);
      expect(restoredStats.avgConnections).toBe(originalStats.avgConnections);
    });
  });
});
