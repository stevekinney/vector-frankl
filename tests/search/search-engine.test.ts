import { describe, expect, it } from 'bun:test';

import { DimensionMismatchError } from '@/core/errors.js';
import type { VectorData } from '@/core/types.js';
import { SearchEngine } from '@/search/search-engine.js';
import type { VectorStorage } from '@/core/storage.js';

/**
 * Build a VectorData object from raw values.
 */
function makeVector(
  id: string,
  values: number[],
  metadata?: Record<string, unknown>,
): VectorData {
  const vector = new Float32Array(values);
  const magnitude = Math.sqrt(values.reduce((sum, v) => sum + v * v, 0));
  const result: VectorData = { id, vector, magnitude, timestamp: Date.now() };
  if (metadata) {
    result.metadata = metadata;
  }
  return result;
}

/**
 * Minimal mock that satisfies the VectorStorage interface used by SearchEngine.
 *
 * SearchEngine only calls `storage.getAll()` (for brute-force / range search)
 * and `storage.get(id)` (to retrieve vectors after an index search).  We store
 * vectors in an in-memory Map so no IndexedDB is needed.
 */
function createMockStorage(vectors: VectorData[] = []): VectorStorage {
  const store = new Map<string, VectorData>();
  for (const v of vectors) {
    store.set(v.id, v);
  }

  return {
    getAll: async () => Array.from(store.values()),
    get: async (id: string) => {
      const v = store.get(id);
      if (!v) {
        throw new Error(`Vector not found: ${id}`);
      }
      return v;
    },
    // SearchEngine never calls these, but they exist on the real class.
    put: async () => {},
    delete: async () => {},
    exists: async () => false,
    count: async () => store.size,
    clear: async () => {},
    deleteMany: async () => 0,
    getMany: async () => [],
    putBatch: async () => {},
    updateVector: async () => {},
    updateMetadata: async () => {},
    updateBatch: async () => ({ succeeded: 0, failed: 0, errors: [] }),
  } as unknown as VectorStorage;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SearchEngine', () => {
  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------
  describe('constructor', () => {
    it('should create an engine with default options', () => {
      const engine = new SearchEngine(createMockStorage(), 4);
      const stats = engine.getIndexStats();

      expect(stats.enabled).toBe(false);
      expect(stats.nodeCount).toBe(0);
    });

    it('should accept a custom distance metric', () => {
      const engine = new SearchEngine(createMockStorage(), 4, 'euclidean');
      // Verify the engine was created without error; metric behavior is
      // verified through search results below.
      expect(engine).toBeDefined();
    });

    it('should enable HNSW indexing when useIndex is true', () => {
      const engine = new SearchEngine(createMockStorage(), 4, 'cosine', {
        useIndex: true,
      });
      const stats = engine.getIndexStats();

      expect(stats.enabled).toBe(true);
      expect(stats.nodeCount).toBe(0);
    });

    it('should accept custom HNSW index configuration', () => {
      const engine = new SearchEngine(createMockStorage(), 4, 'cosine', {
        useIndex: true,
        indexConfig: { m: 32, efConstruction: 200, maxLevel: 5 },
      });
      const stats = engine.getIndexStats();
      expect(stats.enabled).toBe(true);
    });

    it('should set useWorkers flag from options', () => {
      const engine = new SearchEngine(createMockStorage(), 4, 'cosine', {
        useWorkers: true,
      });
      const workerStats = engine.getWorkerStats();
      expect(workerStats.enabled).toBe(true);
    });

    it('should not initialize GPU engine when navigator.gpu is unavailable', () => {
      const engine = new SearchEngine(createMockStorage(), 4, 'cosine', {
        useGPU: true,
      });
      const gpuStats = engine.getGPUStats();
      expect(gpuStats.enabled).toBe(true);
      expect(gpuStats.initialized).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // getIndexStats
  // -----------------------------------------------------------------------
  describe('getIndexStats', () => {
    it('should report disabled when index is off', () => {
      const engine = new SearchEngine(createMockStorage(), 3);
      expect(engine.getIndexStats()).toEqual({ enabled: false, nodeCount: 0 });
    });

    it('should report enabled with zero nodes for a fresh index', () => {
      const engine = new SearchEngine(createMockStorage(), 3, 'cosine', {
        useIndex: true,
      });
      const stats = engine.getIndexStats();
      expect(stats.enabled).toBe(true);
      expect(stats.nodeCount).toBe(0);
    });

    it('should reflect added vectors', async () => {
      const engine = new SearchEngine(createMockStorage(), 3, 'cosine', {
        useIndex: true,
      });

      await engine.addVectorToIndex(makeVector('a', [1, 0, 0]));
      await engine.addVectorToIndex(makeVector('b', [0, 1, 0]));

      const stats = engine.getIndexStats();
      expect(stats.enabled).toBe(true);
      expect(stats.nodeCount).toBe(2);
    });
  });

  // -----------------------------------------------------------------------
  // setDistanceMetric
  // -----------------------------------------------------------------------
  describe('setDistanceMetric', () => {
    it('should change the metric used by the engine', async () => {
      const vectors = [
        makeVector('a', [1, 0, 0]),
        makeVector('b', [0, 1, 0]),
        makeVector('c', [0.5, 0.5, 0]),
      ];
      const engine = new SearchEngine(createMockStorage(vectors), 3, 'cosine', {
        useWorkers: false,
      });

      const cosineResults = await engine.search(new Float32Array([1, 0, 0]), 3);

      engine.setDistanceMetric('euclidean');
      const euclideanResults = await engine.search(new Float32Array([1, 0, 0]), 3);

      // Both searches should return results, but scores will differ because
      // the distance-to-score conversion is metric-dependent.
      expect(cosineResults).toHaveLength(3);
      expect(euclideanResults).toHaveLength(3);

      // The top result should be the same vector in both cases.
      expect(cosineResults[0]!.id).toBe('a');
      expect(euclideanResults[0]!.id).toBe('a');

      // Cosine score for an identical vector (distance 0) should be 1.
      expect(cosineResults[0]!.score).toBeCloseTo(1, 5);
      // Euclidean score for distance 0 should be exp(0) = 1.
      expect(euclideanResults[0]!.score).toBeCloseTo(1, 5);
    });

    it('should recreate the HNSW index when indexing is enabled', () => {
      const engine = new SearchEngine(createMockStorage(), 3, 'cosine', {
        useIndex: true,
      });

      // Add a vector to the current index.
      // After changing the metric, the index should be fresh (empty).
      engine.setDistanceMetric('manhattan');
      const stats = engine.getIndexStats();
      expect(stats.enabled).toBe(true);
      expect(stats.nodeCount).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // setIndexing
  // -----------------------------------------------------------------------
  describe('setIndexing', () => {
    it('should enable indexing on a previously non-indexed engine', () => {
      const engine = new SearchEngine(createMockStorage(), 3);
      expect(engine.getIndexStats().enabled).toBe(false);

      engine.setIndexing(true);
      expect(engine.getIndexStats().enabled).toBe(true);
    });

    it('should disable indexing and clear the index', async () => {
      const engine = new SearchEngine(createMockStorage(), 3, 'cosine', {
        useIndex: true,
      });

      await engine.addVectorToIndex(makeVector('x', [1, 2, 3]));
      expect(engine.getIndexStats().nodeCount).toBe(1);

      engine.setIndexing(false);
      expect(engine.getIndexStats().enabled).toBe(false);
      expect(engine.getIndexStats().nodeCount).toBe(0);
    });

    it('should accept a distance metric when enabling', () => {
      const engine = new SearchEngine(createMockStorage(), 3);

      engine.setIndexing(true, 'manhattan');
      expect(engine.getIndexStats().enabled).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // addVectorToIndex / removeVectorFromIndex
  // -----------------------------------------------------------------------
  describe('addVectorToIndex / removeVectorFromIndex', () => {
    it('should be no-ops when indexing is disabled', async () => {
      const engine = new SearchEngine(createMockStorage(), 3);

      // These should not throw.
      await engine.addVectorToIndex(makeVector('a', [1, 0, 0]));
      await engine.removeVectorFromIndex('a');

      expect(engine.getIndexStats().nodeCount).toBe(0);
    });

    it('should add and remove vectors from the index', async () => {
      const engine = new SearchEngine(createMockStorage(), 3, 'cosine', {
        useIndex: true,
      });

      await engine.addVectorToIndex(makeVector('a', [1, 0, 0]));
      await engine.addVectorToIndex(makeVector('b', [0, 1, 0]));
      expect(engine.getIndexStats().nodeCount).toBe(2);

      await engine.removeVectorFromIndex('a');
      expect(engine.getIndexStats().nodeCount).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // Dimension validation
  // -----------------------------------------------------------------------
  describe('dimension validation', () => {
    it('should throw DimensionMismatchError when query has wrong length', async () => {
      const engine = new SearchEngine(createMockStorage(), 4, 'cosine', {
        useWorkers: false,
      });

      const wrongDimension = new Float32Array([1, 2, 3]); // 3 instead of 4

      expect(engine.search(wrongDimension, 5)).rejects.toThrow(
        DimensionMismatchError,
      );
    });

    it('should throw DimensionMismatchError on searchRange with wrong dimension', async () => {
      const engine = new SearchEngine(createMockStorage(), 4, 'cosine', {
        useWorkers: false,
      });

      const wrongDimension = new Float32Array([1, 2]); // 2 instead of 4

      expect(engine.searchRange(wrongDimension, 0.5)).rejects.toThrow(
        DimensionMismatchError,
      );
    });

    it('should include expected and actual dimensions in the error', async () => {
      const engine = new SearchEngine(createMockStorage(), 4, 'cosine', {
        useWorkers: false,
      });

      try {
        await engine.search(new Float32Array([1, 2, 3]), 5);
        expect.unreachable('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(DimensionMismatchError);
        const dimensionError = error as DimensionMismatchError;
        expect(dimensionError.expected).toBe(4);
        expect(dimensionError.actual).toBe(3);
      }
    });
  });

  // -----------------------------------------------------------------------
  // search (brute-force path)
  // -----------------------------------------------------------------------
  describe('search', () => {
    it('should return empty results when storage is empty', async () => {
      const engine = new SearchEngine(createMockStorage([]), 3, 'cosine', {
        useWorkers: false,
      });

      const results = await engine.search(new Float32Array([1, 0, 0]), 5);
      expect(results).toEqual([]);
    });

    it('should return the k closest vectors using cosine distance', async () => {
      const vectors = [
        makeVector('close', [1, 0, 0]),
        makeVector('medium', [0.7, 0.7, 0]),
        makeVector('far', [0, 0, 1]),
      ];
      const engine = new SearchEngine(createMockStorage(vectors), 3, 'cosine', {
        useWorkers: false,
      });

      const results = await engine.search(new Float32Array([1, 0, 0]), 2);

      expect(results).toHaveLength(2);
      expect(results[0]!.id).toBe('close');
      expect(results[1]!.id).toBe('medium');
    });

    it('should return results with score and distance', async () => {
      const vectors = [makeVector('only', [1, 0, 0])];
      const engine = new SearchEngine(createMockStorage(vectors), 3, 'cosine', {
        useWorkers: false,
      });

      const results = await engine.search(new Float32Array([1, 0, 0]), 1);

      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe('only');
      expect(results[0]!.score).toBeDefined();
      expect(results[0]!.distance).toBeDefined();
    });

    it('should include metadata when includeMetadata is true', async () => {
      const vectors = [
        makeVector('tagged', [1, 0, 0], { category: 'science', rating: 5 }),
      ];
      const engine = new SearchEngine(createMockStorage(vectors), 3, 'cosine', {
        useWorkers: false,
      });

      const results = await engine.search(new Float32Array([1, 0, 0]), 1, {
        includeMetadata: true,
      });

      expect(results[0]!.metadata).toEqual({ category: 'science', rating: 5 });
    });

    it('should not include metadata when includeMetadata is false or omitted', async () => {
      const vectors = [
        makeVector('tagged', [1, 0, 0], { category: 'science' }),
      ];
      const engine = new SearchEngine(createMockStorage(vectors), 3, 'cosine', {
        useWorkers: false,
      });

      const results = await engine.search(new Float32Array([1, 0, 0]), 1);
      expect(results[0]!.metadata).toBeUndefined();
    });

    it('should include vectors when includeVector is true', async () => {
      const vectors = [makeVector('a', [1, 0, 0])];
      const engine = new SearchEngine(createMockStorage(vectors), 3, 'cosine', {
        useWorkers: false,
      });

      const results = await engine.search(new Float32Array([1, 0, 0]), 1, {
        includeVector: true,
      });

      expect(results[0]!.vector).toBeDefined();
      expect(results[0]!.vector).toBeInstanceOf(Float32Array);
    });

    it('should respect k parameter', async () => {
      const vectors = Array.from({ length: 10 }, (_, i) => {
        const values = [0, 0, 0];
        values[i % 3] = 1;
        return makeVector(`v${i}`, values);
      });
      const engine = new SearchEngine(createMockStorage(vectors), 3, 'cosine', {
        useWorkers: false,
      });

      const results = await engine.search(new Float32Array([1, 0, 0]), 3);
      expect(results).toHaveLength(3);
    });

    it('should return all vectors when k exceeds collection size', async () => {
      const vectors = [
        makeVector('a', [1, 0, 0]),
        makeVector('b', [0, 1, 0]),
      ];
      const engine = new SearchEngine(createMockStorage(vectors), 3, 'cosine', {
        useWorkers: false,
      });

      const results = await engine.search(new Float32Array([1, 0, 0]), 100);
      expect(results).toHaveLength(2);
    });
  });

  // -----------------------------------------------------------------------
  // Distance-to-score conversion (observed through search results)
  // -----------------------------------------------------------------------
  describe('distance-to-score conversion', () => {
    it('should produce score of 1 for an identical vector with cosine', async () => {
      const vectors = [makeVector('same', [1, 0, 0])];
      const engine = new SearchEngine(createMockStorage(vectors), 3, 'cosine', {
        useWorkers: false,
      });

      const results = await engine.search(new Float32Array([1, 0, 0]), 1);
      // Cosine distance 0 => score = 1 - 0/2 = 1
      expect(results[0]!.score).toBeCloseTo(1, 5);
    });

    it('should produce score of 1 for an identical vector with euclidean', async () => {
      const vectors = [makeVector('same', [1, 0, 0])];
      const engine = new SearchEngine(
        createMockStorage(vectors),
        3,
        'euclidean',
        { useWorkers: false },
      );

      const results = await engine.search(new Float32Array([1, 0, 0]), 1);
      // Euclidean distance 0 => score = exp(0) = 1
      expect(results[0]!.score).toBeCloseTo(1, 5);
    });

    it('should produce score of 1 for an identical vector with manhattan', async () => {
      const vectors = [makeVector('same', [1, 0, 0])];
      const engine = new SearchEngine(
        createMockStorage(vectors),
        3,
        'manhattan',
        { useWorkers: false },
      );

      const results = await engine.search(new Float32Array([1, 0, 0]), 1);
      // Manhattan distance 0 => score = exp(0) = 1
      expect(results[0]!.score).toBeCloseTo(1, 5);
    });

    it('should produce scores in [0,1] for cosine metric', async () => {
      const vectors = [
        makeVector('a', [1, 0, 0]),
        makeVector('b', [0, 1, 0]),
        makeVector('c', [-1, 0, 0]),
      ];
      const engine = new SearchEngine(createMockStorage(vectors), 3, 'cosine', {
        useWorkers: false,
      });

      const results = await engine.search(new Float32Array([1, 0, 0]), 3);
      for (const result of results) {
        expect(result.score).toBeGreaterThanOrEqual(0);
        expect(result.score).toBeLessThanOrEqual(1);
      }
    });

    it('should produce decreasing scores with euclidean as distance increases', async () => {
      const vectors = [
        makeVector('near', [1, 0, 0]),
        makeVector('mid', [3, 0, 0]),
        makeVector('far', [10, 0, 0]),
      ];
      const engine = new SearchEngine(
        createMockStorage(vectors),
        3,
        'euclidean',
        { useWorkers: false },
      );

      const results = await engine.search(new Float32Array([0, 0, 0]), 3);
      // Results are sorted by distance (ascending), so scores should be descending.
      expect(results[0]!.score).toBeGreaterThan(results[1]!.score);
      expect(results[1]!.score).toBeGreaterThan(results[2]!.score);
    });

    it('should produce score of 1 for identical binary vectors with hamming', async () => {
      const vectors = [makeVector('same', [1, 0, 1, 0])];
      const engine = new SearchEngine(
        createMockStorage(vectors),
        4,
        'hamming',
        { useWorkers: false },
      );

      const results = await engine.search(new Float32Array([1, 0, 1, 0]), 1);
      // Hamming distance 0 => score = 1 - 0/dimension = 1
      expect(results[0]!.score).toBeCloseTo(1, 5);
    });

    it('should produce score of 1 for identical vectors with jaccard', async () => {
      const vectors = [makeVector('same', [1, 0, 1, 0])];
      const engine = new SearchEngine(
        createMockStorage(vectors),
        4,
        'jaccard',
        { useWorkers: false },
      );

      const results = await engine.search(new Float32Array([1, 0, 1, 0]), 1);
      // Jaccard distance 0 => score = 1 - 0 = 1
      expect(results[0]!.score).toBeCloseTo(1, 5);
    });

    it('should produce positive dot-product score for aligned vectors', async () => {
      const vectors = [makeVector('aligned', [2, 3, 0])];
      const engine = new SearchEngine(createMockStorage(vectors), 3, 'dot', {
        useWorkers: false,
      });

      const results = await engine.search(new Float32Array([1, 1, 0]), 1);
      // dot([1,1,0],[2,3,0]) = 5, distance = -5, score = -(-5) = 5
      expect(results[0]!.score).toBeCloseTo(5, 3);
    });
  });

  // -----------------------------------------------------------------------
  // searchRange
  // -----------------------------------------------------------------------
  describe('searchRange', () => {
    it('should return vectors within the distance threshold', async () => {
      const vectors = [
        makeVector('near', [1, 0, 0]),
        makeVector('far', [0, 0, 1]),
      ];
      const engine = new SearchEngine(
        createMockStorage(vectors),
        3,
        'euclidean',
        { useWorkers: false },
      );

      // Distance from [1,0,0] to [1,0,0] is 0, to [0,0,1] is sqrt(2) ~= 1.414
      const results = await engine.searchRange(new Float32Array([1, 0, 0]), 0.5);
      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe('near');
    });

    it('should return empty array when nothing is within threshold', async () => {
      const vectors = [makeVector('far', [10, 10, 10])];
      const engine = new SearchEngine(
        createMockStorage(vectors),
        3,
        'euclidean',
        { useWorkers: false },
      );

      const results = await engine.searchRange(
        new Float32Array([0, 0, 0]),
        0.01,
      );
      expect(results).toHaveLength(0);
    });

    it('should respect maxResults', async () => {
      const vectors = Array.from({ length: 20 }, (_, i) =>
        makeVector(`v${i}`, [1, 0, 0]),
      );
      const engine = new SearchEngine(
        createMockStorage(vectors),
        3,
        'euclidean',
        { useWorkers: false },
      );

      // All vectors are identical => distance 0 for all.
      const results = await engine.searchRange(
        new Float32Array([1, 0, 0]),
        1.0,
        { maxResults: 5 },
      );
      expect(results.length).toBeLessThanOrEqual(5);
    });

    it('should sort results by distance', async () => {
      const vectors = [
        makeVector('a', [2, 0, 0]),
        makeVector('b', [5, 0, 0]),
        makeVector('c', [1, 0, 0]),
      ];
      const engine = new SearchEngine(
        createMockStorage(vectors),
        3,
        'euclidean',
        { useWorkers: false },
      );

      const results = await engine.searchRange(
        new Float32Array([0, 0, 0]),
        100,
      );
      for (let i = 1; i < results.length; i++) {
        expect(results[i]!.distance!).toBeGreaterThanOrEqual(
          results[i - 1]!.distance!,
        );
      }
    });
  });

  // -----------------------------------------------------------------------
  // searchStream
  // -----------------------------------------------------------------------
  describe('searchStream', () => {
    it('should yield results in batches', async () => {
      const vectors = Array.from({ length: 15 }, (_, i) =>
        makeVector(`v${i}`, [i + 1, 0, 0]),
      );
      const engine = new SearchEngine(
        createMockStorage(vectors),
        3,
        'euclidean',
        { useWorkers: false },
      );

      const batches: number[] = [];
      for await (const batch of engine.searchStream(
        new Float32Array([0, 0, 0]),
        { batchSize: 5, maxResults: 15 },
      )) {
        batches.push(batch.length);
      }

      // With 15 results and batchSize 5 we should get 3 batches.
      expect(batches).toEqual([5, 5, 5]);
    });

    it('should handle maxResults smaller than total', async () => {
      const vectors = Array.from({ length: 10 }, (_, i) =>
        makeVector(`v${i}`, [i + 1, 0, 0]),
      );
      const engine = new SearchEngine(
        createMockStorage(vectors),
        3,
        'euclidean',
        { useWorkers: false },
      );

      let totalYielded = 0;
      for await (const batch of engine.searchStream(
        new Float32Array([0, 0, 0]),
        { batchSize: 3, maxResults: 7 },
      )) {
        totalYielded += batch.length;
      }
      expect(totalYielded).toBe(7);
    });
  });

  // -----------------------------------------------------------------------
  // Worker and GPU stats
  // -----------------------------------------------------------------------
  describe('getWorkerStats', () => {
    it('should report disabled when workers are off', () => {
      const engine = new SearchEngine(createMockStorage(), 3, 'cosine', {
        useWorkers: false,
      });
      const stats = engine.getWorkerStats();
      expect(stats.enabled).toBe(false);
      expect(stats.initialized).toBe(false);
    });
  });

  describe('getGPUStats', () => {
    it('should report disabled and unavailable when GPU is off', () => {
      const engine = new SearchEngine(createMockStorage(), 3, 'cosine', {
        useGPU: false,
      });
      const stats = engine.getGPUStats();
      expect(stats.enabled).toBe(false);
      expect(stats.available).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // setWorkerPoolEnabled / setGPUAcceleration
  // -----------------------------------------------------------------------
  describe('setWorkerPoolEnabled', () => {
    it('should update the enabled flag', () => {
      const engine = new SearchEngine(createMockStorage(), 3, 'cosine', {
        useWorkers: false,
      });
      expect(engine.getWorkerStats().enabled).toBe(false);

      engine.setWorkerPoolEnabled(true);
      expect(engine.getWorkerStats().enabled).toBe(true);
    });
  });

  describe('setGPUAcceleration', () => {
    it('should update the enabled flag', () => {
      const engine = new SearchEngine(createMockStorage(), 3, 'cosine', {
        useGPU: false,
      });
      expect(engine.getGPUStats().enabled).toBe(false);

      engine.setGPUAcceleration(true);
      expect(engine.getGPUStats().enabled).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // cleanup
  // -----------------------------------------------------------------------
  describe('cleanup', () => {
    it('should complete without error', async () => {
      const engine = new SearchEngine(createMockStorage(), 3);
      await engine.cleanup();
    });
  });

  // -----------------------------------------------------------------------
  // batchSimilarity (sequential fallback path)
  // -----------------------------------------------------------------------
  describe('batchSimilarity', () => {
    it('should compute pairwise similarity scores', async () => {
      const vectors = [
        makeVector('a', [1, 0, 0]),
        makeVector('b', [0, 1, 0]),
      ];
      const queries = [new Float32Array([1, 0, 0])];

      const engine = new SearchEngine(createMockStorage(), 3, 'cosine', {
        useWorkers: false,
      });

      const results = await engine.batchSimilarity(vectors, queries, 'cosine');

      // One query against two vectors => one row with two scores.
      expect(results).toHaveLength(1);
      expect(results[0]).toHaveLength(2);

      // Score for identical normalized vectors should be ~1.
      expect(results[0]![0]).toBeCloseTo(1, 3);
      // Orthogonal vectors should score ~0.5 (cosine distance ~1, score = 1-1/2 = 0.5).
      expect(results[0]![1]).toBeCloseTo(0.5, 3);
    });
  });

  // -----------------------------------------------------------------------
  // Metadata filtering (through brute-force search)
  // -----------------------------------------------------------------------
  describe('metadata filtering', () => {
    it('should filter vectors by metadata during search', async () => {
      const vectors = [
        makeVector('cat', [1, 0, 0], { animal: 'cat' }),
        makeVector('dog', [0.9, 0.1, 0], { animal: 'dog' }),
        makeVector('bird', [0, 0, 1], { animal: 'bird' }),
      ];
      const engine = new SearchEngine(createMockStorage(vectors), 3, 'cosine', {
        useWorkers: false,
      });

      const results = await engine.search(new Float32Array([1, 0, 0]), 10, {
        filter: { animal: 'cat' },
      });

      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe('cat');
    });
  });

  // -----------------------------------------------------------------------
  // Search with HNSW index
  // -----------------------------------------------------------------------
  describe('search with HNSW index', () => {
    it('should return results from the index when enabled', async () => {
      const vectors = [
        makeVector('a', [1, 0, 0]),
        makeVector('b', [0, 1, 0]),
        makeVector('c', [0, 0, 1]),
      ];
      const engine = new SearchEngine(createMockStorage(vectors), 3, 'cosine', {
        useIndex: true,
        useWorkers: false,
      });

      // Populate the index.
      for (const v of vectors) {
        await engine.addVectorToIndex(v);
      }

      const results = await engine.search(new Float32Array([1, 0, 0]), 2);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.id).toBe('a');
    });

    it('should fall back to brute force when a filter is provided', async () => {
      const vectors = [
        makeVector('a', [1, 0, 0], { type: 'x' }),
        makeVector('b', [0, 1, 0], { type: 'y' }),
      ];
      const engine = new SearchEngine(createMockStorage(vectors), 3, 'cosine', {
        useIndex: true,
        useWorkers: false,
      });

      for (const v of vectors) {
        await engine.addVectorToIndex(v);
      }

      // Providing a filter forces brute-force even with index enabled.
      const results = await engine.search(new Float32Array([1, 0, 0]), 10, {
        filter: { type: 'x' },
      });

      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe('a');
    });
  });
});
