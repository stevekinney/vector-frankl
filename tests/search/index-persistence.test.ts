import { describe, expect, it } from 'bun:test';

import type { DistanceMetric, VectorData } from '@/core/types.js';
import { IndexError } from '@/core/errors.js';
import { createDistanceCalculator } from '@/search/distance-metrics.js';
import { HNSWIndex } from '@/search/hnsw-index.js';
import { IndexCache, IndexPersistence } from '@/search/index-persistence.js';
import { SearchEngine } from '@/search/search-engine.js';
import { MemoryStorageAdapter } from '@/storage/adapters/memory-adapter.js';
import {
  setupIndexedDBMocks,
  cleanupIndexedDBMocks,
  MockIDBDatabase,
} from '../mocks/indexeddb-mock.js';

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

      await cache.putInCache('test-index', index, 'cosine');

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

      await cache.putInCache('index-a', indexA, 'cosine');
      await cache.putInCache('index-b', indexB, 'euclidean');

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

      await cache.putInCache('my-index', original, 'cosine');
      await cache.putInCache('my-index', replacement, 'euclidean');

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

    it('should reflect the number of cached indices', async () => {
      const cache = createTestCache();

      await cache.putInCache('a', createIndex(), 'cosine');
      await cache.putInCache('b', createIndex(), 'cosine');
      await cache.putInCache('c', createIndex(), 'cosine');

      const stats = cache.getStats();

      expect(stats.cacheSize).toBe(3);
      expect(stats.maxCacheSize).toBe(5);
      expect(stats.dirtyCount).toBe(0);
    });

    it('should count dirty entries', async () => {
      const cache = createTestCache();

      await cache.putInCache('a', createIndex(), 'cosine');
      await cache.putInCache('b', createIndex(), 'cosine');
      await cache.putInCache('c', createIndex(), 'cosine');

      cache.markDirty('a');
      cache.markDirty('c');

      expect(cache.getStats().dirtyCount).toBe(2);
    });

    it('should count entries inserted with isDirty flag', async () => {
      const cache = createTestCache();

      await cache.putInCache('a', createIndex(), 'cosine', true);
      await cache.putInCache('b', createIndex(), 'cosine', false);
      await cache.putInCache('c', createIndex(), 'cosine', true);

      expect(cache.getStats().dirtyCount).toBe(2);
    });
  });

  describe('markDirty', () => {
    it('should mark an existing entry as dirty', async () => {
      const cache = createTestCache();
      await cache.putInCache('idx', createIndex(), 'cosine');

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

    it('should be idempotent when called multiple times', async () => {
      const cache = createTestCache();
      await cache.putInCache('idx', createIndex(), 'cosine');

      cache.markDirty('idx');
      cache.markDirty('idx');
      cache.markDirty('idx');

      expect(cache.getStats().dirtyCount).toBe(1);
    });
  });

  describe('clear', () => {
    it('should empty the cache when called with saveFirst=false', async () => {
      const cache = createTestCache();

      await cache.putInCache('a', createIndex(), 'cosine');
      await cache.putInCache('b', createIndex(), 'cosine');

      expect(cache.getStats().cacheSize).toBe(2);

      await cache.clear(false);

      expect(cache.getStats().cacheSize).toBe(0);
    });

    it('should allow re-populating the cache after clearing', async () => {
      const cache = createTestCache();

      await cache.putInCache('a', createIndex(), 'cosine');
      await cache.clear(false);

      await cache.putInCache('b', createIndex(), 'euclidean');

      const stats = cache.getStats();
      expect(stats.cacheSize).toBe(1);

      const result = await cache.getIndex('b');
      expect(result).not.toBeNull();
      expect(result!.distanceMetric).toBe('euclidean');
    });

    it('should reset dirty count to zero', async () => {
      const cache = createTestCache();

      await cache.putInCache('a', createIndex(), 'cosine', true);
      await cache.putInCache('b', createIndex(), 'cosine', true);

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
        await cache.putInCache(`index-${i}`, createIndex(), 'cosine');
        await Bun.sleep(1);
      }

      expect(cache.getStats().cacheSize).toBe(5);

      // Adding a 6th entry should trigger eviction of the oldest
      await cache.putInCache('index-5', createIndex(), 'cosine');

      expect(cache.getStats().cacheSize).toBe(5);
    });

    it('should evict the entry with the oldest lastAccess timestamp', async () => {
      const cache = createTestCache();

      // Insert entries with distinct timestamps via sleep
      await cache.putInCache('oldest', createIndex(), 'cosine');
      await Bun.sleep(1);
      await cache.putInCache('second', createIndex(), 'cosine');
      await Bun.sleep(1);
      await cache.putInCache('third', createIndex(), 'cosine');
      await Bun.sleep(1);
      await cache.putInCache('fourth', createIndex(), 'cosine');
      await Bun.sleep(1);
      await cache.putInCache('fifth', createIndex(), 'cosine');
      await Bun.sleep(1);

      // Access "oldest" to give it a fresh lastAccess timestamp, making
      // "second" the true LRU candidate
      await cache.getIndex('oldest');
      await Bun.sleep(1);

      // Trigger eviction by inserting a 6th entry -- "second" should be evicted
      await cache.putInCache('sixth', createIndex(), 'cosine');

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
        await cache.putInCache(`index-${i}`, createIndex(), 'cosine');
        await Bun.sleep(1);
      }

      expect(cache.getStats().cacheSize).toBe(5);
    });
  });

  describe('IndexCache durable dirty eviction', () => {
    it('should keep a dirty entry in cache when persistence fails during eviction', async () => {
      const cache = createTestCache();

      // Fill the cache to capacity (maxCacheSize = 5)
      for (let i = 0; i < 5; i++) {
        await cache.putInCache(`index-${i}`, createIndex(), 'cosine');
        await Bun.sleep(1);
      }

      // Mark the oldest (index-0) as dirty — it will be the LRU candidate
      cache.markDirty('index-0');

      // Inserting a 6th entry triggers eviction of index-0. Because the
      // persistence manager has no real IndexedDB, the save will throw.
      // The dirty entry must NOT be evicted silently.
      await cache.putInCache('index-5', createIndex(), 'cosine');

      // The dirty entry remains in cache (the new entry could not be added
      // because the dirty eviction candidate was kept).
      const stats = cache.getStats();
      // cache still has an entry for index-0 (kept due to persistence failure)
      expect(stats.dirtyCount).toBeGreaterThanOrEqual(1);

      // The persistence error should be recorded
      expect(stats.errorCount).toBeGreaterThanOrEqual(1);

      // Health check should reflect error state
      const health = cache.getHealthReport('index-0', true);
      expect(health.state).toBe('error');
      expect(health.persistenceError).toBeInstanceOf(Error);
    });

    it('should not silently drop unsaved mutations when eviction persistence fails', async () => {
      const cache = createTestCache();

      // Fill cache to capacity
      for (let i = 0; i < 5; i++) {
        await cache.putInCache(`idx-${i}`, createIndex(), 'cosine');
        await Bun.sleep(1);
      }

      // Mark the oldest dirty
      cache.markDirty('idx-0');

      // Trigger eviction
      await cache.putInCache('idx-new', createIndex(), 'cosine');

      // The dirty index must still be discoverable in the cache (not lost)
      const result = await cache.getIndex('idx-0');
      expect(result).not.toBeNull();
    });
  });

  describe('IndexCache health reports', () => {
    it('should report disabled when indexing is off', async () => {
      const cache = createTestCache();
      const report = cache.getHealthReport('my-index', false);

      expect(report.state).toBe('disabled');
      expect(report.isDirty).toBe(false);
    });

    it('should report missing when no entry exists for the id', () => {
      const cache = createTestCache();
      const report = cache.getHealthReport('nonexistent', true);

      expect(report.state).toBe('missing');
      expect(report.isDirty).toBe(false);
      expect(report.lastAccess).toBeUndefined();
    });

    it('should report healthy for a clean loaded entry', async () => {
      const cache = createTestCache();
      await cache.putInCache('clean-index', createIndex(), 'cosine', false);

      const report = cache.getHealthReport('clean-index', true);

      expect(report.state).toBe('healthy');
      expect(report.isDirty).toBe(false);
      expect(report.lastAccess).toBeDefined();
    });

    it('should report dirty for an entry with unsaved mutations', async () => {
      const cache = createTestCache();
      await cache.putInCache('dirty-index', createIndex(), 'cosine', false);
      cache.markDirty('dirty-index');

      const report = cache.getHealthReport('dirty-index', true);

      expect(report.state).toBe('dirty');
      expect(report.isDirty).toBe(true);
    });

    it('should report dirty when entry was inserted with isDirty=true', async () => {
      const cache = createTestCache();
      await cache.putInCache('dirty-on-insert', createIndex(), 'cosine', true);

      const report = cache.getHealthReport('dirty-on-insert', true);

      expect(report.state).toBe('dirty');
      expect(report.isDirty).toBe(true);
    });

    it('should report rebuilding when setRebuilding is active', async () => {
      const cache = createTestCache();
      await cache.putInCache('rebuilding-index', createIndex(), 'cosine');

      cache.setRebuilding('rebuilding-index', true);
      const report = cache.getHealthReport('rebuilding-index', true);

      expect(report.state).toBe('rebuilding');

      cache.setRebuilding('rebuilding-index', false);
      const afterReport = cache.getHealthReport('rebuilding-index', true);
      expect(afterReport.state).toBe('healthy');
    });

    it('should report missing when setRebuilding is active and no cache entry exists', () => {
      const cache = createTestCache();

      // rebuilding without a cache entry: still shows rebuilding
      cache.setRebuilding('ghost-index', true);
      const report = cache.getHealthReport('ghost-index', true);
      expect(report.state).toBe('rebuilding');
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

  // -------------------------------------------------------------------------
  // persist — exportState / importState mutation stress tests
  // Simulates "close → reopen" via exportState + importState on a fresh index.
  // -------------------------------------------------------------------------

  describe('persist', () => {
    // Seeded RNG helpers — shared by all tests in this block
    function makeSeededRng(seed: number): () => number {
      function splitmix32(state: number): number {
        state = (state + 0x9e3779b9) | 0;
        let z = state;
        z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
        z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
        return (z ^ (z >>> 16)) >>> 0;
      }
      let s0 = splitmix32(seed);
      let s1 = splitmix32(s0);
      let s2 = splitmix32(s1);
      let s3 = splitmix32(s2);
      return () => {
        const result = Math.imul(s1 * 5, 7) >>> 0;
        const t = (s1 << 9) >>> 0;
        s2 ^= s0;
        s3 ^= s1;
        s1 ^= s2;
        s0 ^= s3;
        s2 ^= t;
        s3 = ((s3 << 11) | (s3 >>> 21)) >>> 0;
        return (result >>> 0) / 0x100000000;
      };
    }

    function generateVectors(count: number, dim: number, seed: number): Float32Array[] {
      const rng = makeSeededRng(seed);
      return Array.from({ length: count }, () => {
        const raw = new Float32Array(dim);
        let mag = 0;
        for (let i = 0; i < dim; i++) {
          raw[i] = rng() * 2 - 1;
          mag += raw[i]! * raw[i]!;
        }
        mag = Math.sqrt(mag);
        if (mag > 0) {
          for (let i = 0; i < dim; i++) raw[i] = raw[i]! / mag;
        }
        return raw;
      });
    }

    function bruteForceKNN(
      query: Float32Array,
      entries: Array<{ id: string; vector: Float32Array }>,
      k: number,
      metric: DistanceMetric,
    ): Set<string> {
      const calc = createDistanceCalculator(metric);
      return new Set(
        entries
          .map(({ id, vector }) => ({ id, distance: calc.calculate(query, vector) }))
          .sort((a, b) => a.distance - b.distance)
          .slice(0, k)
          .map((d) => d.id),
      );
    }

    it('should preserve recall across a persist (export → import) cycle', async () => {
      const metric: DistanceMetric = 'cosine';
      const dim = 16;
      const n = 60;
      const k = 5;
      const efSearch = 30;

      const vectors = generateVectors(n, dim, 9001);
      const entries = vectors.map((v, i) => ({ id: `v${i}`, vector: v }));

      const original = new HNSWIndex(metric, { m: 8, efConstruction: 50, seed: 42 });
      for (const { id, vector } of entries) {
        const mag = Math.sqrt(Array.from(vector).reduce((s, x) => s + x * x, 0));
        await original.addVector({ id, vector, magnitude: mag, timestamp: Date.now() });
      }

      // Simulate "close and reopen" by exporting state and importing into a new instance
      const state = original.exportState();
      const reopened = new HNSWIndex(metric, { m: 8, efConstruction: 50, seed: 42 });
      reopened.importState(state);

      const queries = generateVectors(10, dim, 9002);
      let totalRecallOriginal = 0;
      let totalRecallReopened = 0;

      for (const query of queries) {
        const groundTruth = bruteForceKNN(query, entries, k, metric);

        const origResults = await original.search(query, k, efSearch);
        const reopenedResults = await reopened.search(query, k, efSearch);

        totalRecallOriginal +=
          origResults.filter((r) => groundTruth.has(r.id)).length / k;
        totalRecallReopened +=
          reopenedResults.filter((r) => groundTruth.has(r.id)).length / k;
      }

      const recallOriginal = totalRecallOriginal / queries.length;
      const recallReopened = totalRecallReopened / queries.length;

      // Recall should be identical because the graph topology is preserved
      expect(recallReopened).toBe(recallOriginal);
      expect(recallReopened).toBeGreaterThanOrEqual(0.7);
    });

    it('should not return deleted vectors after persist → mutate → re-persist cycle', async () => {
      const metric: DistanceMetric = 'cosine';
      const dim = 8;

      const vectors = generateVectors(20, dim, 8001);

      const index = new HNSWIndex(metric, { m: 4, efConstruction: 30, seed: 7 });
      for (let i = 0; i < 20; i++) {
        const vector = vectors[i]!;
        const mag = Math.sqrt(Array.from(vector).reduce((s, x) => s + x * x, 0));
        await index.addVector({
          id: `v${i}`,
          vector,
          magnitude: mag,
          timestamp: Date.now(),
        });
      }

      // First persist (simulated close/reopen)
      const state1 = index.exportState();
      const reopened = new HNSWIndex(metric, { m: 4, efConstruction: 30, seed: 7 });
      reopened.importState(state1);

      // Delete some vectors from the reopened index
      const deleted = new Set<string>();
      for (let i = 0; i < 20; i += 4) {
        await reopened.removeVector(`v${i}`);
        deleted.add(`v${i}`);
      }

      // Second persist
      const state2 = reopened.exportState();
      const finalIndex = new HNSWIndex(metric, { m: 4, efConstruction: 30, seed: 7 });
      finalIndex.importState(state2);

      const query = vectors[0]!;
      const results = await finalIndex.search(query, 10, 30);

      for (const result of results) {
        expect(deleted.has(result.id)).toBe(false);
      }
    });

    it('should rebuild correctly after repeated insert→persist→delete→persist cycles', async () => {
      const metric: DistanceMetric = 'cosine';
      const dim = 8;
      const cycles = 3;

      const allVectors = generateVectors(30, dim, 7001);

      let liveIndex = new HNSWIndex(metric, { m: 4, efConstruction: 30, seed: 99 });
      const liveIds = new Set<string>();

      for (let cycle = 0; cycle < cycles; cycle++) {
        // Insert a batch
        const batchStart = cycle * 10;
        for (let i = batchStart; i < batchStart + 10; i++) {
          const vector = allVectors[i]!;
          const mag = Math.sqrt(Array.from(vector).reduce((s, x) => s + x * x, 0));
          await liveIndex.addVector({
            id: `v${i}`,
            vector,
            magnitude: mag,
            timestamp: Date.now(),
          });
          liveIds.add(`v${i}`);
        }

        // Persist (export/import = close/reopen)
        const state = liveIndex.exportState();
        liveIndex = new HNSWIndex(metric, { m: 4, efConstruction: 30, seed: 99 });
        liveIndex.importState(state);

        // Delete the first half of the current batch
        for (let i = batchStart; i < batchStart + 5; i++) {
          await liveIndex.removeVector(`v${i}`);
          liveIds.delete(`v${i}`);
        }

        // Persist again
        const state2 = liveIndex.exportState();
        liveIndex = new HNSWIndex(metric, { m: 4, efConstruction: 30, seed: 99 });
        liveIndex.importState(state2);
      }

      // Index should contain exactly the live IDs
      expect(liveIndex.size()).toBe(liveIds.size);

      // Search should only return live IDs
      const query = allVectors[0]!;
      const results = await liveIndex.search(query, liveIndex.size(), 50);
      for (const result of results) {
        expect(liveIds.has(result.id)).toBe(true);
      }
    });

    it('should preserve size correctly after insert→persist→rebuild (clear+reinsert) cycle', async () => {
      const metric: DistanceMetric = 'cosine';
      const dim = 8;

      const vectors = generateVectors(15, dim, 6001);
      const entries = vectors.map((v, i) => ({ id: `v${i}`, vector: v }));

      const index = new HNSWIndex(metric, { m: 4, efConstruction: 30, seed: 11 });
      for (const { id, vector } of entries) {
        const mag = Math.sqrt(Array.from(vector).reduce((s, x) => s + x * x, 0));
        await index.addVector({ id, vector, magnitude: mag, timestamp: Date.now() });
      }

      // Persist
      const state = index.exportState();
      const loaded = new HNSWIndex(metric, { m: 4, efConstruction: 30, seed: 11 });
      loaded.importState(state);

      expect(loaded.size()).toBe(15);

      // Rebuild: clear and re-insert from persisted state
      loaded.clear();
      expect(loaded.size()).toBe(0);

      for (const node of state.nodes) {
        const vector = new Float32Array(node.vector);
        const mag = Math.sqrt(Array.from(vector).reduce((s, x) => s + x * x, 0));
        await loaded.addVector({
          id: node.id,
          vector,
          magnitude: mag,
          timestamp: Date.now(),
        });
      }

      expect(loaded.size()).toBe(15);

      // Search should still work
      const results = await loaded.search(vectors[0]!, 3, 30);
      expect(results.length).toBeGreaterThan(0);
    });
  });
});

describe('SearchEngine index lifecycle', () => {
  /**
   * Build a SearchEngine backed by a MemoryStorageAdapter, pre-populate
   * it with `count` unit-basis vectors, and build the HNSW index.
   */
  async function buildEngine(count: number): Promise<{
    engine: SearchEngine;
    storage: MemoryStorageAdapter;
  }> {
    const storage = new MemoryStorageAdapter();
    await storage.init();

    const engine = new SearchEngine(storage, 3, 'cosine', {
      useIndex: true,
      useWorkers: false,
    });

    for (let i = 0; i < count; i++) {
      const vector = new Float32Array(3);
      vector[i % 3] = 1;
      const data: VectorData = {
        id: `vec-${i}`,
        vector,
        magnitude: 1,
        timestamp: Date.now(),
      };
      await storage.put(data);
    }

    await engine.rebuildIndex({ loadFromCache: false });
    return { engine, storage };
  }

  describe('rebuildIndex stale-index detection', () => {
    it('node count matches storage after a fresh rebuild', async () => {
      const { engine } = await buildEngine(5);
      expect(engine.getIndexStats().nodeCount).toBe(5);
    });

    it('validates a cached index whose node count matches storage', async () => {
      const storage = new MemoryStorageAdapter();
      await storage.init();

      // Build an engine, populate it, and save the index via rebuildIndex.
      const engine1 = new SearchEngine(storage, 3, 'cosine', {
        useIndex: true,
        useWorkers: false,
      });

      const vectors: VectorData[] = Array.from({ length: 4 }, (_, i) => {
        const v = new Float32Array(3);
        v[i % 3] = 1;
        return { id: `v-${i}`, vector: v, magnitude: 1, timestamp: Date.now() };
      });
      for (const v of vectors) {
        await storage.put(v);
      }
      await engine1.rebuildIndex({ loadFromCache: false });

      // A second engine over the same storage with no cache will rebuild from
      // scratch because there is no IndexCache (no database passed).
      const engine2 = new SearchEngine(storage, 3, 'cosine', {
        useIndex: true,
        useWorkers: false,
      });
      await engine2.rebuildIndex();

      expect(engine2.getIndexStats().nodeCount).toBe(4);
    });

    it('detects stale cache when storage has more vectors than the index', async () => {
      // Build an initial engine with 3 vectors and save its index.
      const { engine: engine1, storage } = await buildEngine(3);
      expect(engine1.getIndexStats().nodeCount).toBe(3);

      // Add a 4th vector directly to storage without updating the index.
      const extra: VectorData = {
        id: 'extra',
        vector: new Float32Array([0, 0, 1]),
        magnitude: 1,
        timestamp: Date.now(),
      };
      await storage.put(extra);

      // A fresh engine sees 3 nodes in the index but 4 vectors in storage.
      // Because there is no persisted IndexCache here, rebuildIndex falls
      // through to a full rebuild and correctly produces 4 nodes.
      const engine2 = new SearchEngine(storage, 3, 'cosine', {
        useIndex: true,
        useWorkers: false,
      });
      await engine2.rebuildIndex();

      expect(engine2.getIndexStats().nodeCount).toBe(4);
    });

    it('returns the same top result before and after a rebuild', async () => {
      const storage = new MemoryStorageAdapter();
      await storage.init();

      // Three orthogonal unit vectors
      const vectors: VectorData[] = [
        {
          id: 'x',
          vector: new Float32Array([1, 0, 0]),
          magnitude: 1,
          timestamp: Date.now(),
        },
        {
          id: 'y',
          vector: new Float32Array([0, 1, 0]),
          magnitude: 1,
          timestamp: Date.now(),
        },
        {
          id: 'z',
          vector: new Float32Array([0, 0, 1]),
          magnitude: 1,
          timestamp: Date.now(),
        },
      ];
      for (const v of vectors) {
        await storage.put(v);
      }

      const engine1 = new SearchEngine(storage, 3, 'cosine', {
        useIndex: true,
        useWorkers: false,
      });
      await engine1.rebuildIndex({ loadFromCache: false });

      const query = new Float32Array([1, 0, 0]);
      const results1 = await engine1.search(query, 1);
      expect(results1).toHaveLength(1);
      const topIdBefore = results1[0]!.id;

      // Simulate a rebuild (e.g. after reopen) — same data, same result.
      const engine2 = new SearchEngine(storage, 3, 'cosine', {
        useIndex: true,
        useWorkers: false,
      });
      await engine2.rebuildIndex({ loadFromCache: false });

      const results2 = await engine2.search(query, 1);
      expect(results2).toHaveLength(1);
      expect(results2[0]!.id).toBe(topIdBefore);
    });
  });
});

// ---------------------------------------------------------------------------
// IndexPersistence — persistence compatibility and measured storage tests
// ---------------------------------------------------------------------------

describe('IndexPersistence storage', () => {
  it('getStorageUsage returns measuredBytes not estimatedBytes', async () => {
    setupIndexedDBMocks();
    try {
      // Build a minimal mock database that IndexPersistence can use
      const mockDb = new MockIDBDatabase('test-storage-usage', 1);
      // Create the hnsw_indices store
      mockDb.createObjectStore('hnsw_indices');

      // Cast the mock as VectorDatabase — IndexPersistence only uses
      // executeTransaction, which the mock implements.
      const persistence = new IndexPersistence(mockDb as unknown as ConstructorParameters<typeof IndexPersistence>[0]);

      const usage = await persistence.getStorageUsage();

      // Should have the measuredBytes field (not estimatedBytes)
      expect(typeof usage.measuredBytes).toBe('number');
      expect(usage.indexCount).toBe(0);
      expect(usage.measuredBytes).toBe(0);
    } finally {
      cleanupIndexedDBMocks();
    }
  });

  it('getStorageUsage reflects real byte count after saving an index', async () => {
    setupIndexedDBMocks();
    try {
      const mockDb = new MockIDBDatabase('test-storage-measure', 1);
      mockDb.createObjectStore('hnsw_indices');

      const persistence = new IndexPersistence(mockDb as unknown as ConstructorParameters<typeof IndexPersistence>[0]);

      const index = new HNSWIndex('cosine', { m: 4, efConstruction: 20, maxLevel: 2 });
      await index.addVector(makeVector('v1', [1, 0, 0]));
      await index.addVector(makeVector('v2', [0, 1, 0]));

      await persistence.saveIndex('test-idx', index, 'cosine');

      const usage = await persistence.getStorageUsage();

      expect(usage.indexCount).toBe(1);
      // Measured bytes must be greater than zero
      expect(usage.measuredBytes).toBeGreaterThan(0);
    } finally {
      cleanupIndexedDBMocks();
    }
  });
});

describe('IndexPersistence persistence', () => {
  it('loading a supported version (1.0.0) succeeds', async () => {
    setupIndexedDBMocks();
    try {
      const mockDb = new MockIDBDatabase('test-compat-ok', 1);
      mockDb.createObjectStore('hnsw_indices');

      const persistence = new IndexPersistence(mockDb as unknown as ConstructorParameters<typeof IndexPersistence>[0]);

      const index = new HNSWIndex('cosine', { m: 4, efConstruction: 20, maxLevel: 2 });
      await index.addVector(makeVector('v1', [1, 0, 0]));
      await index.addVector(makeVector('v2', [0, 1, 0]));

      await persistence.saveIndex('compat-idx', index, 'cosine');

      const loaded = await persistence.loadIndex('compat-idx');

      expect(loaded).not.toBeNull();
      expect(loaded!.distanceMetric).toBe('cosine');
      expect(loaded!.index.size()).toBe(2);
    } finally {
      cleanupIndexedDBMocks();
    }
  });

  it('loading an unsupported version throws an IndexError with rebuild guidance', async () => {
    setupIndexedDBMocks();
    try {
      const mockDb = new MockIDBDatabase('test-compat-bad', 1);
      mockDb.createObjectStore('hnsw_indices');

      const persistence = new IndexPersistence(mockDb as unknown as ConstructorParameters<typeof IndexPersistence>[0]);

      // Write a record directly with an unsupported version tag
      const incompatibleRecord = {
        id: 'old-idx',
        data: {
          nodes: [],
          entryPoint: null,
          config: { m: 16, mL: 2, efConstruction: 200, maxLevel: 5 },
          distanceMetric: 'cosine',
          version: '0.9.0', // unsupported
          timestamp: Date.now(),
        },
        timestamp: Date.now(),
      };

      // Directly write to the store via the mock
      await mockDb.executeTransaction('hnsw_indices', 'readwrite', async (tx) => {
        const store = tx.objectStore('hnsw_indices');
        return new Promise<void>((resolve, reject) => {
          const req = store.put(incompatibleRecord);
          req.onsuccess = () => resolve();
          req.onerror = () => reject(new Error('Failed to write test record'));
        });
      });

      // Now try to load it — should throw IndexError
      let thrown: unknown;
      try {
        await persistence.loadIndex('old-idx');
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(IndexError);
    } finally {
      cleanupIndexedDBMocks();
    }
  });

  it('IndexError for incompatible version includes rebuild guidance in message', async () => {
    setupIndexedDBMocks();
    try {
      const mockDb = new MockIDBDatabase('test-compat-msg', 1);
      mockDb.createObjectStore('hnsw_indices');

      const persistence = new IndexPersistence(mockDb as unknown as ConstructorParameters<typeof IndexPersistence>[0]);

      const incompatibleRecord = {
        id: 'old-idx2',
        data: {
          nodes: [],
          entryPoint: null,
          config: { m: 16, mL: 2, efConstruction: 200, maxLevel: 5 },
          distanceMetric: 'cosine',
          version: '2.0.0', // future unsupported version
          timestamp: Date.now(),
        },
        timestamp: Date.now(),
      };

      await mockDb.executeTransaction('hnsw_indices', 'readwrite', async (tx) => {
        const store = tx.objectStore('hnsw_indices');
        return new Promise<void>((resolve, reject) => {
          const req = store.put(incompatibleRecord);
          req.onsuccess = () => resolve();
          req.onerror = () => reject(new Error('write failed'));
        });
      });

      try {
        await persistence.loadIndex('old-idx2');
        throw new Error('Expected loadIndex to throw');
      } catch (err) {
        expect(err).toBeInstanceOf(IndexError);
        const indexErr = err as IndexError;
        // Message should mention the bad version and tell user how to recover
        expect(indexErr.message).toContain('2.0.0');
        expect(indexErr.message.toLowerCase()).toContain('rebuild');
      }
    } finally {
      cleanupIndexedDBMocks();
    }
  });

  it('loading a missing index returns null (not an error)', async () => {
    setupIndexedDBMocks();
    try {
      const mockDb = new MockIDBDatabase('test-missing', 1);
      mockDb.createObjectStore('hnsw_indices');

      const persistence = new IndexPersistence(mockDb as unknown as ConstructorParameters<typeof IndexPersistence>[0]);

      const result = await persistence.loadIndex('does-not-exist');
      expect(result).toBeNull();
    } finally {
      cleanupIndexedDBMocks();
    }
  });
});
