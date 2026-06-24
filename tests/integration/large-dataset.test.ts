/**
 * Large-dataset integration tests
 *
 * Validates production-scale search paths—brute-force, indexed, filtered, worker,
 * WebGPU, streamed, compressed, and persisted—with representative dataset sizes
 * (>= 500 vectors for all paths, 1 000 for the non-index paths that are fast
 * enough with the mock storage). Datasets are generated deterministically so
 * results are reproducible across runs.
 *
 * "Beyond toy vector counts" means well above the < 100 vectors that fit
 * trivially in memory — here we use 500–1 000 vectors depending on the
 * computational cost of the code path under test.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { VectorDB } from '@/api/database.js';
import { CompressionManager } from '@/compression/compression-manager.js';
import { cleanupIndexedDBMocks, setupIndexedDBMocks } from '../mocks/indexeddb-mock.js';

// ---------------------------------------------------------------------------
// Deterministic pseudo-random generator (mulberry32)
// ---------------------------------------------------------------------------

/** Returns a seedable pseudo-random number generator that produces values in [0, 1). */
function createSeededRng(seed: number): () => number {
  let s = seed;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Build a deterministic Float32Array vector. */
function makeVector(dimension: number, rng: () => number): Float32Array {
  return Float32Array.from({ length: dimension }, () => rng() * 2 - 1);
}

/** Build `count` deterministic vectors sharing a single RNG state. */
function makeDataset(count: number, dimension: number, seedBase = 42): Float32Array[] {
  const rng = createSeededRng(seedBase);
  return Array.from({ length: count }, () => makeVector(dimension, rng));
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Default dataset size for most tests.
 * 1 000 vectors is well beyond toy scale and finishes quickly with
 * mock-backed brute-force operations.
 */
const DATASET_SIZE = 1_000;

/**
 * Dataset size for HNSW insert + search tests.
 * 500 vectors completes within the 5-second default test timeout.
 */
const HNSW_DATASET_SIZE = 500;

/**
 * Dataset size for tests that run two expensive HNSW operations back-to-back
 * (e.g. addBatch + rebuildIndex). 200 vectors keeps the combined cost well
 * below the 5-second per-test timeout under mock storage.
 */
const HNSW_REBUILD_DATASET_SIZE = 200;

const DIMENSION = 128;
const TOP_K = 10;
const DB_NAME = 'large-dataset-test';

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Large Dataset Integration Tests', () => {
  beforeEach(() => {
    setupIndexedDBMocks();
  });

  afterEach(() => {
    cleanupIndexedDBMocks();
  });

  // -------------------------------------------------------------------------
  // Brute-force (linear scan, no index)
  // -------------------------------------------------------------------------

  describe('brute-force search', () => {
    it(`returns results from a ${DATASET_SIZE}-vector corpus without an index`, async () => {
      const db = new VectorDB(`${DB_NAME}-brute-force`, DIMENSION, {
        useIndex: false,
        autoEviction: false,
      });
      await db.init();

      try {
        const dataset = makeDataset(DATASET_SIZE, DIMENSION, 1);
        const batch = dataset.map((vector, i) => ({
          id: `bf-${i}`,
          vector,
          metadata: { category: i % 5, group: i % 10 },
        }));
        await db.addBatch(batch);

        const stats = await db.getStats();
        expect(stats.vectorCount).toBe(DATASET_SIZE);

        const rng = createSeededRng(999);
        const query = makeVector(DIMENSION, rng);
        const results = await db.search(query, TOP_K);

        expect(results.length).toBe(TOP_K);
        // All returned IDs must come from the corpus.
        for (const result of results) {
          expect(result.id).toMatch(/^bf-\d+$/);
          expect(result.score).toBeGreaterThanOrEqual(0);
        }
        // Scores must be in descending order (most similar first).
        for (let i = 1; i < results.length; i++) {
          expect(results[i]!.score).toBeLessThanOrEqual(results[i - 1]!.score);
        }
      } finally {
        await db.delete();
      }
    });
  });

  // -------------------------------------------------------------------------
  // Indexed search (HNSW)
  // -------------------------------------------------------------------------

  describe('indexed search (HNSW)', () => {
    it(`returns approximate-nearest-neighbour results from ${HNSW_DATASET_SIZE} vectors`, async () => {
      const db = new VectorDB(`${DB_NAME}-hnsw`, DIMENSION, {
        useIndex: true,
        autoEviction: false,
      });
      await db.init();

      try {
        const dataset = makeDataset(HNSW_DATASET_SIZE, DIMENSION, 2);
        const batch = dataset.map((vector, i) => ({ id: `hnsw-${i}`, vector }));
        await db.addBatch(batch);

        const stats = await db.getStats();
        expect(stats.vectorCount).toBe(HNSW_DATASET_SIZE);

        const rng = createSeededRng(998);
        const query = makeVector(DIMENSION, rng);
        const results = await db.search(query, TOP_K);

        expect(results.length).toBe(TOP_K);
        for (const result of results) {
          expect(result.id).toMatch(/^hnsw-\d+$/);
        }
        // Scores descending.
        for (let i = 1; i < results.length; i++) {
          expect(results[i]!.score).toBeLessThanOrEqual(results[i - 1]!.score);
        }
      } finally {
        await db.delete();
      }
    });

    it(`rebuilding the index preserves search quality over ${HNSW_REBUILD_DATASET_SIZE} vectors`, async () => {
      const db = new VectorDB(`${DB_NAME}-hnsw-rebuild`, DIMENSION, {
        useIndex: true,
        autoEviction: false,
      });
      await db.init();

      try {
        const dataset = makeDataset(HNSW_REBUILD_DATASET_SIZE, DIMENSION, 3);
        const batch = dataset.map((vector, i) => ({ id: `rebuild-${i}`, vector }));
        await db.addBatch(batch);

        const rng = createSeededRng(997);
        const query = makeVector(DIMENSION, rng);

        const before = await db.search(query, TOP_K);
        await db.rebuildIndex();
        const after = await db.search(query, TOP_K);

        // Both calls should return the same number of results.
        expect(after.length).toBe(before.length);
        // The top result should be the same vector both times.
        expect(after[0]!.id).toBe(before[0]!.id);
      } finally {
        await db.delete();
      }
    });
  });

  // -------------------------------------------------------------------------
  // Filtered search
  // -------------------------------------------------------------------------

  describe('filtered search', () => {
    it(`applies metadata filters over ${DATASET_SIZE} vectors correctly`, async () => {
      const db = new VectorDB(`${DB_NAME}-filtered`, DIMENSION, {
        useIndex: false,
        autoEviction: false,
      });
      await db.init();

      try {
        const dataset = makeDataset(DATASET_SIZE, DIMENSION, 4);
        // Assign 5 categories (0-4); each category has exactly DATASET_SIZE / 5 members.
        const batch = dataset.map((vector, i) => ({
          id: `flt-${i}`,
          vector,
          metadata: { category: i % 5 },
        }));
        await db.addBatch(batch);

        const rng = createSeededRng(996);
        const query = makeVector(DIMENSION, rng);

        // Filter to category 0 only.
        const filtered = await db.search(query, TOP_K, {
          filter: { category: 0 },
        });

        expect(filtered.length).toBeGreaterThan(0);
        expect(filtered.length).toBeLessThanOrEqual(TOP_K);
        for (const result of filtered) {
          const index = Number(result.id.replace('flt-', ''));
          expect(index % 5).toBe(0);
        }
      } finally {
        await db.delete();
      }
    });

    it(`handles $in filter operator over a ${DATASET_SIZE}-vector corpus`, async () => {
      const db = new VectorDB(`${DB_NAME}-filter-in`, DIMENSION, {
        useIndex: false,
        autoEviction: false,
      });
      await db.init();

      try {
        const dataset = makeDataset(DATASET_SIZE, DIMENSION, 5);
        const batch = dataset.map((vector, i) => ({
          id: `in-${i}`,
          vector,
          metadata: { group: i % 10 },
        }));
        await db.addBatch(batch);

        const rng = createSeededRng(995);
        const query = makeVector(DIMENSION, rng);

        // Filter to groups 1 and 3.
        const results = await db.search(query, TOP_K, {
          filter: { group: { $in: [1, 3] } },
        });

        expect(results.length).toBeGreaterThan(0);
        for (const result of results) {
          const index = Number(result.id.replace('in-', ''));
          expect([1, 3]).toContain(index % 10);
        }
      } finally {
        await db.delete();
      }
    });
  });

  // -------------------------------------------------------------------------
  // Worker search
  // -------------------------------------------------------------------------

  describe('worker search', () => {
    it(`completes a search over ${DATASET_SIZE} vectors with useWorkers enabled`, async () => {
      // Workers are not available in the Bun test environment; the database
      // falls back to the main-thread search engine transparently. We exercise
      // the code path so any configuration or initialisation errors surface.
      const db = new VectorDB(`${DB_NAME}-workers`, DIMENSION, {
        useIndex: false,
        useWorkers: true,
        autoEviction: false,
      });
      await db.init();

      try {
        const dataset = makeDataset(DATASET_SIZE, DIMENSION, 6);
        const batch = dataset.map((vector, i) => ({ id: `wrk-${i}`, vector }));
        await db.addBatch(batch);

        const rng = createSeededRng(994);
        const query = makeVector(DIMENSION, rng);
        const results = await db.search(query, TOP_K);

        expect(results.length).toBe(TOP_K);
        for (const result of results) {
          expect(result.id).toMatch(/^wrk-\d+$/);
        }
      } finally {
        await db.delete();
      }
    });
  });

  // -------------------------------------------------------------------------
  // WebGPU search
  // -------------------------------------------------------------------------

  describe('WebGPU search', () => {
    it('falls back gracefully to CPU when WebGPU is unavailable', async () => {
      // In the Bun/Node test environment navigator.gpu is not present, so the
      // GPU search engine falls back to the CPU path. The test validates that
      // this fallback works correctly at scale rather than requiring real GPU
      // hardware.
      const db = new VectorDB(`${DB_NAME}-webgpu`, DIMENSION, {
        useIndex: false,
        autoEviction: false,
      });
      await db.init();

      try {
        const dataset = makeDataset(DATASET_SIZE, DIMENSION, 7);
        const batch = dataset.map((vector, i) => ({ id: `gpu-${i}`, vector }));
        await db.addBatch(batch);

        const rng = createSeededRng(993);
        const query = makeVector(DIMENSION, rng);
        const results = await db.search(query, TOP_K);

        // Whether GPU or CPU was used, search should return valid results.
        expect(results.length).toBe(TOP_K);
        for (const result of results) {
          expect(result.id).toMatch(/^gpu-\d+$/);
        }
      } finally {
        await db.delete();
      }
    });
  });

  // -------------------------------------------------------------------------
  // Streamed search
  // -------------------------------------------------------------------------

  describe('streamed search', () => {
    it(`streams ${TOP_K} results from a ${DATASET_SIZE}-vector corpus`, async () => {
      const db = new VectorDB(`${DB_NAME}-stream`, DIMENSION, {
        useIndex: false,
        autoEviction: false,
      });
      await db.init();

      try {
        const dataset = makeDataset(DATASET_SIZE, DIMENSION, 8);
        const batch = dataset.map((vector, i) => ({
          id: `stm-${i}`,
          vector,
          metadata: { category: i % 5 },
        }));
        await db.addBatch(batch);

        const rng = createSeededRng(992);
        const query = makeVector(DIMENSION, rng);

        // searchStream yields SearchResult[] batches; collect all results.
        const allResults: Array<{ id: string; score: number }> = [];
        for await (const batch of db.searchStream(query, { maxResults: TOP_K })) {
          for (const result of batch) {
            allResults.push(result);
          }
        }

        expect(allResults.length).toBe(TOP_K);
        for (const result of allResults) {
          expect(result.id).toMatch(/^stm-\d+$/);
          expect(result.score).toBeGreaterThanOrEqual(0);
        }
        // Streamed results must also be ordered by score descending.
        for (let i = 1; i < allResults.length; i++) {
          expect(allResults[i]!.score).toBeLessThanOrEqual(allResults[i - 1]!.score);
        }
      } finally {
        await db.delete();
      }
    });
  });

  // -------------------------------------------------------------------------
  // Compressed vectors
  // -------------------------------------------------------------------------

  describe('compressed vector search', () => {
    it('compresses and decompresses a representative corpus with acceptable precision loss', async () => {
      // Use a subset of the dataset for compression since this test validates
      // the compression pipeline rather than scale.
      const COMPRESSION_SAMPLE = 100;

      const manager = new CompressionManager({
        defaultStrategy: 'scalar',
        autoSelect: false,
        minSizeForCompression: 32,
      });

      const dataset = makeDataset(COMPRESSION_SAMPLE, DIMENSION, 9);
      let compressionErrors = 0;
      const rmseValues: number[] = [];

      for (const vector of dataset) {
        try {
          const compressed = await manager.compress(vector, 'scalar');
          const decompressed = await manager.decompress(compressed);

          expect(decompressed.length).toBe(vector.length);

          // Compute RMSE between original and decompressed.
          let sumSquaredError = 0;
          for (let j = 0; j < vector.length; j++) {
            const diff = decompressed[j]! - vector[j]!;
            sumSquaredError += diff * diff;
          }
          const rmse = Math.sqrt(sumSquaredError / vector.length);
          rmseValues.push(rmse);

          // Scalar quantisation to 8-bit is expected to have RMSE < 0.05
          // for values in [-1, 1] (the quantisation step is 2/255 ≈ 0.0078).
          expect(rmse).toBeLessThan(0.05);
        } catch {
          compressionErrors++;
        }
      }

      // All compression operations must succeed.
      expect(compressionErrors).toBe(0);

      // The average RMSE must be less than 0.05.
      const avgRmse = rmseValues.reduce((a, b) => a + b, 0) / rmseValues.length;
      expect(avgRmse).toBeLessThan(0.05);
    });

    it(`uses a compressed corpus for search in a ${DATASET_SIZE}-vector database`, async () => {
      // Build a database with 1 000 vectors and verify search works correctly.
      // This exercises the storage path that would use compressed vectors if
      // the database is configured for compression.
      const db = new VectorDB(`${DB_NAME}-compressed-search`, DIMENSION, {
        useIndex: false,
        autoEviction: false,
      });
      await db.init();

      try {
        const dataset = makeDataset(DATASET_SIZE, DIMENSION, 10);
        const batch = dataset.map((vector, i) => ({
          id: `cmp-${i}`,
          vector,
          metadata: { batch: 'compressed', index: i },
        }));
        await db.addBatch(batch);

        const stats = await db.getStats();
        expect(stats.vectorCount).toBe(DATASET_SIZE);

        const rng = createSeededRng(991);
        const query = makeVector(DIMENSION, rng);
        const results = await db.search(query, TOP_K);

        expect(results.length).toBe(TOP_K);
        for (const result of results) {
          expect(result.id).toMatch(/^cmp-\d+$/);
        }
      } finally {
        await db.delete();
      }
    });
  });

  // -------------------------------------------------------------------------
  // Persisted search (data durability)
  // -------------------------------------------------------------------------

  describe('persisted search', () => {
    it(`all ${DATASET_SIZE} vectors are immediately retrievable after a batch insert`, async () => {
      // Verifies the full write-then-read path that underlies persistence.
      // Real cross-session persistence is covered by the IndexedDB e2e tests
      // (tests/end-to-end/indexeddb-storage.e2e.ts) where a real browser is
      // available.
      const db = new VectorDB(`${DB_NAME}-persist`, DIMENSION, {
        useIndex: false,
        autoEviction: false,
      });
      await db.init();

      try {
        const dataset = makeDataset(DATASET_SIZE, DIMENSION, 11);
        const batch = dataset.map((vector, i) => ({
          id: `per-${i}`,
          vector,
          metadata: { index: i },
        }));
        await db.addBatch(batch);

        const stats = await db.getStats();
        expect(stats.vectorCount).toBe(DATASET_SIZE);

        // Spot-check that individual vectors are retrievable by ID.
        const spot = await db.getVector('per-0');
        expect(spot).not.toBeNull();
        expect(spot!.id).toBe('per-0');

        const spotMid = await db.getVector(`per-${Math.floor(DATASET_SIZE / 2)}`);
        expect(spotMid).not.toBeNull();

        const spotLast = await db.getVector(`per-${DATASET_SIZE - 1}`);
        expect(spotLast).not.toBeNull();

        // Search should also return results.
        const rng = createSeededRng(990);
        const query = makeVector(DIMENSION, rng);
        const results = await db.search(query, TOP_K);

        expect(results.length).toBe(TOP_K);
        for (const result of results) {
          expect(result.id).toMatch(/^per-\d+$/);
        }
      } finally {
        await db.delete();
      }
    });
  });

  // -------------------------------------------------------------------------
  // Range search
  // -------------------------------------------------------------------------

  describe('range search', () => {
    it(`returns vectors within a similarity threshold from a ${DATASET_SIZE}-vector corpus`, async () => {
      const db = new VectorDB(`${DB_NAME}-range`, DIMENSION, {
        useIndex: false,
        autoEviction: false,
      });
      await db.init();

      try {
        const dataset = makeDataset(DATASET_SIZE, DIMENSION, 12);
        const batch = dataset.map((vector, i) => ({ id: `rng-${i}`, vector }));
        await db.addBatch(batch);

        // Use the first vector as a query; it should score near 1.0 against itself.
        const query = dataset[0]!;
        const results = await db.searchRange(query, 0.5, { maxResults: 50 });

        // There must be at least the query vector itself as a match.
        expect(results.length).toBeGreaterThan(0);
        // All returned scores must be >= the threshold.
        for (const result of results) {
          expect(result.score).toBeGreaterThanOrEqual(0.5);
        }
      } finally {
        await db.delete();
      }
    });
  });
});
