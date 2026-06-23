import { describe, expect, it } from 'bun:test';

import type { DistanceMetric, VectorData } from '@/core/types.js';
import { createDistanceCalculator } from '@/search/distance-metrics.js';
import { HNSWIndex } from '@/search/hnsw-index.js';

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

// ---------------------------------------------------------------------------
// Deterministic PRNG — splitmix32 → xoshiro128** (same as HNSWIndex internals)
// ---------------------------------------------------------------------------

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

/** Generate `count` normalised unit vectors of `dimension` using a seeded RNG. */
function generateDataset(count: number, dimension: number, seed: number): Float32Array[] {
  const rng = makeSeededRng(seed);
  return Array.from({ length: count }, () => {
    const raw = new Float32Array(dimension);
    let mag = 0;
    for (let i = 0; i < dimension; i++) {
      raw[i] = rng() * 2 - 1;
      mag += raw[i]! * raw[i]!;
    }
    mag = Math.sqrt(mag);
    if (mag > 0) {
      for (let i = 0; i < dimension; i++) raw[i] = raw[i]! / mag;
    }
    return raw;
  });
}

/** Brute-force k-NN — returns IDs of the k nearest neighbours. */
function bruteForceKNN(
  query: Float32Array,
  entries: Array<{ id: string; vector: Float32Array }>,
  k: number,
  metric: DistanceMetric,
): Set<string> {
  const calc = createDistanceCalculator(metric);
  const ranked = entries
    .map(({ id, vector }) => ({ id, distance: calc.calculate(query, vector) }))
    .sort((a, b) => a.distance - b.distance);
  return new Set(ranked.slice(0, k).map((d) => d.id));
}

describe('HNSWIndex', () => {
  /**
   * Classification: Experimental
   *
   * These tests document the verified support level for this implementation.
   * Tests that expose known limitations are explicitly labelled to prevent
   * production reliance before the gaps are closed.
   */
  describe('classification: experimental', () => {
    it('should return correct nearest neighbor for well-separated vectors (basic recall)', async () => {
      // Regression anchor: HNSW must at minimum return the exact nearest
      // neighbor for orthogonal unit vectors where the search space is trivial.
      const index = new HNSWIndex('cosine', { m: 16, efConstruction: 200 });
      const stored: VectorData[] = [];

      for (let i = 0; i < 10; i++) {
        const values = new Array<number>(10).fill(0);
        values[i] = 1; // one-hot
        const v = makeVector(`v${i}`, values);
        stored.push(v);
        await index.addVector(v);
      }

      // Each query should find itself as the nearest neighbor
      for (let i = 0; i < 10; i++) {
        const query = new Float32Array(10).fill(0);
        query[i] = 1;
        const results = await index.search(query, 1);
        expect(results[0]?.id).toBe(`v${i}`);
      }
    });

    it('should achieve ≥ 80% recall against brute-force on 100 random 16-D vectors', async () => {
      // Minimum recall bar for the experimental classification.
      // 80% is deliberately conservative — it confirms the index is functional,
      // not that it meets a production quality bar. Production recall targets
      // (tracked separately in ROADMAP) require per-dataset benchmarks across
      // dataset sizes, dimensions, metrics, and parameter settings.
      const dim = 16;
      const n = 100;
      const k = 5;

      const index = new HNSWIndex('cosine', { m: 16, efConstruction: 200 });
      const stored: VectorData[] = [];

      // Deterministic pseudo-random vectors via a simple LCG
      let seed = 12345;
      const rng = (): number => {
        seed = (seed * 1664525 + 1013904223) & 0xffffffff;
        return (seed >>> 0) / 0x100000000;
      };

      for (let i = 0; i < n; i++) {
        const values = Array.from({ length: dim }, () => rng() * 2 - 1);
        const v = makeVector(`v${i}`, values);
        stored.push(v);
        await index.addVector(v);
      }

      let totalRecall = 0;
      const queryCount = 20;

      for (let q = 0; q < queryCount; q++) {
        const queryValues = Array.from({ length: dim }, () => rng() * 2 - 1);
        const query = new Float32Array(queryValues);

        const hnswResults = await index.search(query, k);
        const hnswIds = new Set(hnswResults.map((r) => r.id));
        const bruteIds = bruteForceKNN(query, stored, k, 'cosine');

        const intersect = [...bruteIds].filter((id) => hnswIds.has(id)).length;
        totalRecall += intersect / k;
      }

      const avgRecall = totalRecall / queryCount;
      // 80% recall is the minimum bar for the experimental classification.
      expect(avgRecall).toBeGreaterThanOrEqual(0.8);
    });

    it('should not return deleted vectors — known limitation: graph may degrade after deletion', async () => {
      // This test verifies the hard correctness requirement: a deleted vector
      // must never appear in results, even if the graph structure degrades.
      // The graph-reconnection problem (deleted high-degree nodes leaving
      // unreachable regions) is a known limitation documented on the class.
      const index = new HNSWIndex('cosine', { m: 4, efConstruction: 50 });

      const stored: VectorData[] = [];
      for (let i = 0; i < 10; i++) {
        const values = new Array<number>(4).fill(0);
        values[i % 4] = 1;
        const v = makeVector(`v${i}`, values);
        stored.push(v);
        await index.addVector(v);
      }

      // Delete v0
      await index.removeVector('v0');

      // v0 must not appear in any result
      for (let q = 0; q < 5; q++) {
        const values = new Array<number>(4).fill(0);
        values[q % 4] = 1;
        const query = new Float32Array(values);
        const results = await index.search(query, 5);
        const ids = results.map((r) => r.id);
        expect(ids).not.toContain('v0');
      }
    });

    it('should keep size() consistent after insertions and deletions', async () => {
      const index = new HNSWIndex('cosine', { m: 4, efConstruction: 50 });

      for (let i = 0; i < 5; i++) {
        await index.addVector(makeVector(`v${i}`, [i + 1, 0, 0, 0]));
      }

      expect(index.size()).toBe(5);

      await index.removeVector('v2');
      expect(index.size()).toBe(4);

      await index.removeVector('v0');
      expect(index.size()).toBe(3);
    });

    it('should return an empty result set on a freshly cleared index', async () => {
      const index = new HNSWIndex('cosine');

      for (let i = 0; i < 5; i++) {
        await index.addVector(makeVector(`v${i}`, [i + 1, 0, 0]));
      }

      index.clear();

      const results = await index.search(new Float32Array([1, 0, 0]), 3);
      expect(results).toHaveLength(0);
      expect(index.size()).toBe(0);
    });

    it('should preserve recall after a rebuild from exported state', async () => {
      // Rebuild correctness anchor: exporting and re-importing state must
      // reproduce equivalent search behavior for the trivial case.
      const original = new HNSWIndex('cosine', { m: 4, efConstruction: 50 });
      const stored: VectorData[] = [];

      for (let i = 0; i < 8; i++) {
        const values = new Array<number>(4).fill(0);
        values[i % 4] = i % 4 === 0 ? 1 : 0.5;
        const v = makeVector(`v${i}`, values);
        stored.push(v);
        await original.addVector(v);
      }

      const state = original.exportState();

      const rebuilt = new HNSWIndex('cosine', { m: 4, efConstruction: 50 });
      rebuilt.importState(state);

      const query = new Float32Array([1, 0, 0, 0]);
      const originalResults = await original.search(query, 3);
      const rebuiltResults = await rebuilt.search(query, 3);

      // Top result must agree
      expect(rebuiltResults[0]?.id).toBe(originalResults[0]!.id);
    });
  });

  describe('exportState / importState round-trip', () => {
    it('should export and import an empty index', () => {
      const index = new HNSWIndex('cosine');
      const state = index.exportState();

      expect(state.nodes).toHaveLength(0);
      expect(state.entryPoint).toBeNull();

      const restored = new HNSWIndex('cosine');
      restored.importState(state);

      expect(restored.size()).toBe(0);
    });

    it('should round-trip a populated index', async () => {
      const index = new HNSWIndex('cosine', { m: 4, efConstruction: 50, maxLevel: 3 });

      const vectors = [
        makeVector('v1', [1, 0, 0, 0]),
        makeVector('v2', [0, 1, 0, 0]),
        makeVector('v3', [0, 0, 1, 0]),
        makeVector('v4', [0, 0, 0, 1]),
        makeVector('v5', [1, 1, 0, 0], { label: 'mixed' }),
      ];

      for (const v of vectors) {
        await index.addVector(v);
      }

      // Export
      const state = index.exportState();
      expect(state.nodes).toHaveLength(5);
      expect(state.entryPoint).not.toBeNull();

      // Import into a fresh index
      const restored = new HNSWIndex('cosine', { m: 4, efConstruction: 50, maxLevel: 3 });
      restored.importState(state);

      expect(restored.size()).toBe(5);

      // Search should still work after import
      const query = new Float32Array([1, 0, 0, 0]);
      const results = await restored.search(query, 3);

      expect(results.length).toBeGreaterThan(0);
      // The closest vector to [1,0,0,0] should be v1
      expect(results[0]!.id).toBe('v1');
    });

    it('should preserve metadata through export/import', async () => {
      const index = new HNSWIndex('cosine');

      await index.addVector(
        makeVector('with-meta', [1, 2, 3], { category: 'test', count: 42 }),
      );

      const state = index.exportState();
      const node = state.nodes.find((n) => n.id === 'with-meta');
      expect(node?.metadata).toEqual({ category: 'test', count: 42 });

      const restored = new HNSWIndex('cosine');
      restored.importState(state);

      const results = await restored.search(new Float32Array([1, 2, 3]), 1);
      expect(results[0]!.metadata).toEqual({ category: 'test', count: 42 });
    });

    it('should preserve connections through export/import', async () => {
      const index = new HNSWIndex('cosine', { m: 4, efConstruction: 50 });

      // Add enough vectors to build meaningful connections
      for (let i = 0; i < 10; i++) {
        const values = [0, 0, 0, 0];
        values[i % 4] = 1;
        await index.addVector(makeVector(`v${i}`, values));
      }

      const originalStats = index.getStats();
      const state = index.exportState();

      const restored = new HNSWIndex('cosine', { m: 4, efConstruction: 50 });
      restored.importState(state);

      const restoredStats = restored.getStats();
      expect(restoredStats.nodeCount).toBe(originalStats.nodeCount);
      expect(restoredStats.avgConnections).toBe(originalStats.avgConnections);
    });
  });

  // -------------------------------------------------------------------------
  // delete — deleted vectors must never appear in search results
  // -------------------------------------------------------------------------

  describe('delete', () => {
    it('should not return a deleted vector in subsequent searches', async () => {
      const index = new HNSWIndex('cosine', { m: 4, efConstruction: 50, seed: 1 });

      await index.addVector(makeVector('keep-a', [1, 0, 0, 0]));
      await index.addVector(makeVector('keep-b', [0.9, 0.1, 0, 0]));
      await index.addVector(makeVector('remove', [1, 0, 0, 0])); // very close to query

      await index.removeVector('remove');

      const query = new Float32Array([1, 0, 0, 0]);
      const results = await index.search(query, 10);
      const ids = results.map((r) => r.id);

      expect(ids).not.toContain('remove');
    });

    it('should not return any of several deleted vectors', async () => {
      const index = new HNSWIndex('cosine', { m: 8, efConstruction: 50, seed: 2 });

      for (let i = 0; i < 20; i++) {
        await index.addVector(
          makeVector(`v${i}`, [
            i % 4 === 0 ? 1 : 0,
            i % 4 === 1 ? 1 : 0,
            i % 4 === 2 ? 1 : 0,
            i % 4 === 3 ? 1 : 0,
          ]),
        );
      }

      // Delete even-indexed vectors
      for (let i = 0; i < 20; i += 2) {
        await index.removeVector(`v${i}`);
      }

      const query = new Float32Array([1, 0, 0, 0]);
      const results = await index.search(query, 20);
      const ids = new Set(results.map((r) => r.id));

      for (let i = 0; i < 20; i += 2) {
        expect(ids.has(`v${i}`)).toBe(false);
      }
    });

    it('should reduce size by one after deleting an existing vector', async () => {
      const index = new HNSWIndex('cosine', { m: 4, efConstruction: 50, seed: 3 });

      await index.addVector(makeVector('a', [1, 0, 0]));
      await index.addVector(makeVector('b', [0, 1, 0]));
      await index.addVector(makeVector('c', [0, 0, 1]));

      expect(index.size()).toBe(3);

      await index.removeVector('b');

      expect(index.size()).toBe(2);
    });

    it('should be a no-op when deleting a vector that does not exist', async () => {
      const index = new HNSWIndex('cosine', { m: 4, efConstruction: 50, seed: 4 });

      await index.addVector(makeVector('a', [1, 0, 0]));

      // Should not throw
      await index.removeVector('nonexistent');

      expect(index.size()).toBe(1);
    });

    it('should handle deleting the entry point', async () => {
      const index = new HNSWIndex('cosine', { m: 4, efConstruction: 50, seed: 5 });

      await index.addVector(makeVector('first', [1, 0, 0]));
      await index.addVector(makeVector('second', [0, 1, 0]));
      await index.addVector(makeVector('third', [0, 0, 1]));

      const entryPoint = index.getStats().entryPoint;
      if (entryPoint !== null) {
        await index.removeVector(entryPoint);
      }

      // Search should still work after entry-point removal
      const results = await index.search(new Float32Array([1, 0, 0]), 2);
      if (entryPoint !== null) {
        const ids = results.map((r) => r.id);
        expect(ids).not.toContain(entryPoint);
      }
    });
  });

  // -------------------------------------------------------------------------
  // update — remove old entry and insert updated vector for the same id
  // -------------------------------------------------------------------------

  describe('update', () => {
    it('should reflect the new vector after an update', async () => {
      const index = new HNSWIndex('cosine', { m: 4, efConstruction: 50, seed: 10 });

      // Insert an initial vector pointing in one direction
      await index.addVector(makeVector('target', [1, 0, 0, 0]));
      await index.addVector(makeVector('other', [0, 1, 0, 0]));

      // "Update" = remove old + add new
      await index.removeVector('target');
      await index.addVector(makeVector('target', [0, 1, 0, 0])); // now points in y direction

      // The updated target should appear in results for y-axis query
      const results = await index.search(new Float32Array([0, 1, 0, 0]), 2);
      const ids = results.map((r) => r.id);

      expect(ids).toContain('target');
    });

    it('should not return stale vector data after multiple updates', async () => {
      const index = new HNSWIndex('cosine', { m: 4, efConstruction: 50, seed: 11 });
      const dim = 4;

      for (let i = 0; i < 10; i++) {
        const values = Array.from({ length: dim }, (_, j) => (j === i % dim ? 1 : 0));
        await index.addVector(makeVector(`v${i}`, values));
      }

      // Cycle through 5 update rounds: remove then re-insert with rotated direction
      for (let round = 0; round < 5; round++) {
        for (let i = 0; i < 10; i++) {
          await index.removeVector(`v${i}`);
          const values = Array.from({ length: dim }, (_, j) =>
            j === (i + round + 1) % dim ? 1 : 0,
          );
          await index.addVector(makeVector(`v${i}`, values));
        }
      }

      // After all updates the index should still have 10 entries
      expect(index.size()).toBe(10);

      // Search should return results without errors
      const results = await index.search(new Float32Array([1, 0, 0, 0]), 5);
      expect(results.length).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // rebuild — clear and rebuild from scratch
  // -------------------------------------------------------------------------

  describe('rebuild', () => {
    it('should produce a valid index after clear + re-insert', async () => {
      const index = new HNSWIndex('cosine', { m: 8, efConstruction: 50, seed: 20 });

      const dim = 4;
      const vectors = generateDataset(20, dim, 1001);
      const entries = vectors.map((v, i) => ({ id: `v${i}`, vector: v }));

      // First population
      for (const { id, vector } of entries) {
        const mag = Math.sqrt(Array.from(vector).reduce((s, x) => s + x * x, 0));
        await index.addVector({ id, vector, magnitude: mag, timestamp: Date.now() });
      }

      // Clear and rebuild with same data
      index.clear();
      expect(index.size()).toBe(0);

      for (const { id, vector } of entries) {
        const mag = Math.sqrt(Array.from(vector).reduce((s, x) => s + x * x, 0));
        await index.addVector({ id, vector, magnitude: mag, timestamp: Date.now() });
      }

      expect(index.size()).toBe(20);

      // Search should work
      const results = await index.search(vectors[0]!, 5);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.id).toBe('v0');
    });

    it('should preserve recall after rebuild', async () => {
      const metric: DistanceMetric = 'cosine';
      const dim = 16;
      const n = 50;
      const k = 5;
      const efSearch = 50;

      const vectors = generateDataset(n, dim, 2001);
      const entries = vectors.map((v, i) => ({ id: `v${i}`, vector: v }));

      const buildIndex = async () => {
        const idx = new HNSWIndex(metric, { m: 8, efConstruction: 50, seed: 42 });
        for (const { id, vector } of entries) {
          const mag = Math.sqrt(Array.from(vector).reduce((s, x) => s + x * x, 0));
          await idx.addVector({ id, vector, magnitude: mag, timestamp: Date.now() });
        }
        return idx;
      };

      const original = await buildIndex();
      const rebuilt = await buildIndex();

      // Both indexes should produce the same recall on the same queries
      const queries = generateDataset(10, dim, 2002);
      let totalRecallOriginal = 0;
      let totalRecallRebuilt = 0;

      for (const query of queries) {
        const groundTruth = bruteForceKNN(query, entries, k, metric);

        const origResults = await original.search(query, k, efSearch);
        const rebuiltResults = await rebuilt.search(query, k, efSearch);

        const origHits = origResults.filter((r) => groundTruth.has(r.id)).length;
        const rebuiltHits = rebuiltResults.filter((r) => groundTruth.has(r.id)).length;

        totalRecallOriginal += origHits / k;
        totalRecallRebuilt += rebuiltHits / k;
      }

      const recallOriginal = totalRecallOriginal / queries.length;
      const recallRebuilt = totalRecallRebuilt / queries.length;

      // Both builds are deterministic so recall should match exactly
      expect(recallRebuilt).toBe(recallOriginal);
      // And recall should be reasonable (≥ 70% on this small dataset)
      expect(recallRebuilt).toBeGreaterThanOrEqual(0.7);
    });
  });

  // -------------------------------------------------------------------------
  // recall — HNSW vs brute-force ground truth (inline regression guard)
  // -------------------------------------------------------------------------

  describe('recall', () => {
    it('should achieve ≥80% recall@10 on a small cosine dataset', async () => {
      const metric: DistanceMetric = 'cosine';
      const dim = 32;
      const n = 200;
      const k = 10;
      const efSearch = 50;
      const queryCount = 20;
      const recallTarget = 0.8;

      const vectors = generateDataset(n, dim, 3001);
      const entries = vectors.map((v, i) => ({ id: `v${i}`, vector: v }));

      const index = new HNSWIndex(metric, { m: 8, efConstruction: 50, seed: 42 });
      for (const { id, vector } of entries) {
        const mag = Math.sqrt(Array.from(vector).reduce((s, x) => s + x * x, 0));
        await index.addVector({ id, vector, magnitude: mag, timestamp: Date.now() });
      }

      const queries = generateDataset(queryCount, dim, 3002);
      let totalRecall = 0;

      for (const query of queries) {
        const groundTruth = bruteForceKNN(query, entries, k, metric);
        const results = await index.search(query, k, efSearch);
        const hits = results.filter((r) => groundTruth.has(r.id)).length;
        totalRecall += hits / k;
      }

      const recall = totalRecall / queryCount;
      expect(recall).toBeGreaterThanOrEqual(recallTarget);
    });

    it('should achieve ≥80% recall@10 on a small euclidean dataset', async () => {
      const metric: DistanceMetric = 'euclidean';
      const dim = 32;
      const n = 200;
      const k = 10;
      const efSearch = 50;
      const queryCount = 20;
      const recallTarget = 0.8;

      const vectors = generateDataset(n, dim, 4001);
      const entries = vectors.map((v, i) => ({ id: `v${i}`, vector: v }));

      const index = new HNSWIndex(metric, { m: 8, efConstruction: 50, seed: 42 });
      for (const { id, vector } of entries) {
        const mag = Math.sqrt(Array.from(vector).reduce((s, x) => s + x * x, 0));
        await index.addVector({ id, vector, magnitude: mag, timestamp: Date.now() });
      }

      const queries = generateDataset(queryCount, dim, 4002);
      let totalRecall = 0;

      for (const query of queries) {
        const groundTruth = bruteForceKNN(query, entries, k, metric);
        const results = await index.search(query, k, efSearch);
        const hits = results.filter((r) => groundTruth.has(r.id)).length;
        totalRecall += hits / k;
      }

      const recall = totalRecall / queryCount;
      expect(recall).toBeGreaterThanOrEqual(recallTarget);
    });

    it('should never include deleted vectors in recall measurement', async () => {
      const metric: DistanceMetric = 'cosine';
      const dim = 16;
      const k = 5;
      const efSearch = 30;

      const vectors = generateDataset(30, dim, 5001);
      const index = new HNSWIndex(metric, { m: 8, efConstruction: 50, seed: 42 });

      for (let i = 0; i < 30; i++) {
        const vector = vectors[i]!;
        const mag = Math.sqrt(Array.from(vector).reduce((s, x) => s + x * x, 0));
        await index.addVector({
          id: `v${i}`,
          vector,
          magnitude: mag,
          timestamp: Date.now(),
        });
      }

      // Delete a subset of vectors
      const deleted = new Set<string>();
      for (let i = 0; i < 30; i += 3) {
        await index.removeVector(`v${i}`);
        deleted.add(`v${i}`);
      }

      const queries = generateDataset(10, dim, 5002);
      for (const query of queries) {
        const results = await index.search(query, k, efSearch);
        for (const result of results) {
          expect(deleted.has(result.id)).toBe(false);
        }
      }
    });
  });
});
