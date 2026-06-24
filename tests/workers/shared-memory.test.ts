import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';

import type { DistanceMetric } from '../../src/core/types.js';
import { SharedMemoryManager } from '../../src/workers/shared-memory.js';
import { cleanupIndexedDBMocks, setupIndexedDBMocks } from '../mocks/indexeddb-mock.js';

// ---------------------------------------------------------------------------
// Brute-force reference implementation for parity checks
// ---------------------------------------------------------------------------

function normalize(v: Float32Array): Float32Array {
  const mag = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  if (mag === 0) return v;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i]! / mag;
  return out;
}

function computeDistance(
  a: Float32Array,
  b: Float32Array,
  metric: DistanceMetric,
): number {
  switch (metric) {
    case 'cosine': {
      const na = normalize(a);
      const nb = normalize(b);
      let dot = 0;
      for (let i = 0; i < na.length; i++) dot += na[i]! * nb[i]!;
      return 1 - dot;
    }
    case 'euclidean': {
      let sum = 0;
      for (let i = 0; i < a.length; i++) {
        const d = a[i]! - b[i]!;
        sum += d * d;
      }
      return Math.sqrt(sum);
    }
    case 'manhattan': {
      let sum = 0;
      for (let i = 0; i < a.length; i++) sum += Math.abs(a[i]! - b[i]!);
      return sum;
    }
    case 'dot': {
      let dot = 0;
      for (let i = 0; i < a.length; i++) dot += a[i]! * b[i]!;
      return -dot;
    }
    case 'hamming': {
      let dist = 0;
      for (let i = 0; i < a.length; i++) {
        const ba = a[i]! > 0 ? 1 : 0;
        const bb = b[i]! > 0 ? 1 : 0;
        if (ba !== bb) dist++;
      }
      return dist;
    }
    case 'jaccard': {
      let intersection = 0;
      let union = 0;
      for (let i = 0; i < a.length; i++) {
        const ba = a[i]! > 0 ? 1 : 0;
        const bb = b[i]! > 0 ? 1 : 0;
        if (ba || bb) {
          union++;
          if (ba && bb) intersection++;
        }
      }
      return union === 0 ? 0 : 1 - intersection / union;
    }
    default:
      throw new Error(`Unknown metric: ${metric}`);
  }
}

function bruteForceSearch(
  vectors: Float32Array[],
  query: Float32Array,
  k: number,
  metric: DistanceMetric,
): Array<{ index: number; distance: number }> {
  const distances = vectors.map((v, index) => ({
    index,
    distance: computeDistance(query, v, metric),
  }));
  distances.sort((a, b) => a.distance - b.distance);
  return distances.slice(0, k);
}

describe('SharedMemoryManager', () => {
  beforeAll(() => {
    setupIndexedDBMocks();
  });

  afterAll(() => {
    cleanupIndexedDBMocks();
  });

  describe('Initialization', () => {
    it('should initialize with default configuration', () => {
      // Skip if SharedArrayBuffer is not available
      if (typeof SharedArrayBuffer === 'undefined') {
        expect(() => new SharedMemoryManager()).toThrow(
          'SharedArrayBuffer is not supported',
        );
        return;
      }

      const manager = new SharedMemoryManager();
      expect(manager).toBeDefined();

      const stats = manager.getStats();
      expect(stats.totalAllocated).toBe(0);
      expect(stats.totalUsed).toBe(0);
      expect(stats.activeBlocks).toBe(0);
    });

    it('should initialize with custom configuration', () => {
      if (typeof SharedArrayBuffer === 'undefined') {
        return; // Skip test if SharedArrayBuffer not supported
      }

      const config = {
        maxPoolSize: 50 * 1024 * 1024, // 50MB
        initialBufferSize: 512 * 1024, // 512KB
        alignment: 16,
        enableStats: true,
      };

      const manager = new SharedMemoryManager(config);
      expect(manager).toBeDefined();
    });
  });

  describe('Memory Allocation', () => {
    let manager: SharedMemoryManager;

    beforeEach(() => {
      if (typeof SharedArrayBuffer === 'undefined') {
        return;
      }
      manager = new SharedMemoryManager({
        maxPoolSize: 10 * 1024 * 1024,
        enableStats: true,
      });
    });

    it('should allocate vector buffer with correct layout', () => {
      if (typeof SharedArrayBuffer === 'undefined') {
        return;
      }

      const vectorCount = 100;
      const dimension = 384;
      const { buffer, layout } = manager.allocateVectorBuffer(vectorCount, dimension);

      expect(buffer).toBeInstanceOf(SharedArrayBuffer);
      expect(layout.vectorCount).toBe(vectorCount);
      expect(layout.dimension).toBe(dimension);
      expect(layout.bytesPerElement).toBe(4); // Float32
      expect(layout.headerSize).toBeGreaterThan(0);
      expect(layout.dataOffset).toBe(layout.headerSize);

      // Verify buffer size is sufficient
      const expectedDataSize = vectorCount * dimension * 4;
      expect(buffer.byteLength).toBeGreaterThanOrEqual(
        expectedDataSize + layout.headerSize,
      );
    });

    it('should reuse buffers from memory pool', () => {
      if (typeof SharedArrayBuffer === 'undefined') {
        return;
      }

      // Allocate a buffer
      const { buffer: buffer1 } = manager.allocateVectorBuffer(50, 128);

      // Release it
      manager.releaseBuffer(buffer1);

      // Allocate a similar sized buffer - should reuse
      const { buffer: buffer2 } = manager.allocateVectorBuffer(40, 128);

      // They should be the same buffer
      expect(buffer2).toBe(buffer1);

      const stats = manager.getStats();
      expect(stats.poolHits).toBe(1);
    });

    it('should track memory statistics correctly', () => {
      if (typeof SharedArrayBuffer === 'undefined') {
        return;
      }

      const { buffer } = manager.allocateVectorBuffer(100, 256);

      const stats = manager.getStats();
      expect(stats.totalAllocated).toBeGreaterThan(0);
      expect(stats.totalUsed).toBeGreaterThan(0);
      expect(stats.activeBlocks).toBe(1);

      manager.releaseBuffer(buffer);

      const statsAfter = manager.getStats();
      expect(statsAfter.totalUsed).toBe(0);
      expect(statsAfter.activeBlocks).toBe(0);
    });
  });

  describe('Vector Operations', () => {
    let manager: SharedMemoryManager;

    beforeEach(() => {
      if (typeof SharedArrayBuffer === 'undefined') {
        return;
      }
      manager = new SharedMemoryManager();
    });

    it('should copy vectors to shared memory', () => {
      if (typeof SharedArrayBuffer === 'undefined') {
        return;
      }

      const vectors = [
        new Float32Array([1, 2, 3, 4]),
        new Float32Array([5, 6, 7, 8]),
        new Float32Array([9, 10, 11, 12]),
      ];

      const { buffer, layout } = manager.allocateVectorBuffer(3, 4);

      manager.copyVectorsToSharedMemory(vectors, buffer, layout);

      // Verify data was copied correctly
      const dataView = new Float32Array(buffer, layout.dataOffset);

      for (let i = 0; i < vectors.length; i++) {
        for (let j = 0; j < 4; j++) {
          const expectedValue = vectors[i]![j]!;
          const actualValue = dataView[i * 4 + j]!;
          expect(actualValue).toBeCloseTo(expectedValue, 5);
        }
      }
    });

    it('should create vector views for efficient access', () => {
      if (typeof SharedArrayBuffer === 'undefined') {
        return;
      }

      const vectors = [new Float32Array([1, 2, 3]), new Float32Array([4, 5, 6])];

      const { buffer, layout } = manager.allocateVectorBuffer(2, 3);
      manager.copyVectorsToSharedMemory(vectors, buffer, layout);

      // Create view for first vector
      const view0 = manager.createVectorView(buffer, layout, 0);
      expect(view0[0]).toBeCloseTo(1, 5);
      expect(view0[1]).toBeCloseTo(2, 5);
      expect(view0[2]).toBeCloseTo(3, 5);

      // Create view for second vector
      const view1 = manager.createVectorView(buffer, layout, 1);
      expect(view1[0]).toBeCloseTo(4, 5);
      expect(view1[1]).toBeCloseTo(5, 5);
      expect(view1[2]).toBeCloseTo(6, 5);
    });

    it('should create batch vector views', () => {
      if (typeof SharedArrayBuffer === 'undefined') {
        return;
      }

      const vectors = [
        new Float32Array([1, 2]),
        new Float32Array([3, 4]),
        new Float32Array([5, 6]),
        new Float32Array([7, 8]),
      ];

      const { buffer, layout } = manager.allocateVectorBuffer(4, 2);
      manager.copyVectorsToSharedMemory(vectors, buffer, layout);

      // Create views for middle 2 vectors
      const views = manager.createBatchVectorViews(buffer, layout, 1, 2);

      expect(views).toHaveLength(2);
      expect(views[0]![0]).toBeCloseTo(3, 5);
      expect(views[0]![1]).toBeCloseTo(4, 5);
      expect(views[1]![0]).toBeCloseTo(5, 5);
      expect(views[1]![1]).toBeCloseTo(6, 5);
    });
  });

  describe('Memory Cleanup', () => {
    let manager: SharedMemoryManager;

    beforeEach(() => {
      if (typeof SharedArrayBuffer === 'undefined') {
        return;
      }
      manager = new SharedMemoryManager({
        enableStats: true,
      });
    });

    it('should cleanup old unused blocks', async () => {
      if (typeof SharedArrayBuffer === 'undefined') {
        return;
      }

      // Allocate and release a buffer
      const { buffer } = manager.allocateVectorBuffer(10, 10);
      manager.releaseBuffer(buffer);

      // Initially should have 1 block
      expect(manager.getStats().totalAllocated).toBeGreaterThan(0);

      // Add a small delay to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 1));

      // Cleanup with very short max age should remove it
      manager.cleanup(0);

      // Should have cleaned up
      expect(manager.getStats().totalAllocated).toBe(0);
    });

    it('should force cleanup all unused blocks', () => {
      if (typeof SharedArrayBuffer === 'undefined') {
        return;
      }

      // Allocate multiple buffers
      const buffer1 = manager.allocateVectorBuffer(10, 10);
      manager.allocateVectorBuffer(20, 20);

      // Release one
      manager.releaseBuffer(buffer1.buffer);

      // Force cleanup should remove unused ones
      manager.forceCleanup();

      const stats = manager.getStats();
      expect(stats.activeBlocks).toBe(1); // Only the still-in-use buffer
    });
  });

  describe('Batch Operations', () => {
    let manager: SharedMemoryManager;

    beforeEach(() => {
      if (typeof SharedArrayBuffer === 'undefined') {
        return;
      }
      manager = new SharedMemoryManager();
    });

    it('should create optimized batch layout', () => {
      if (typeof SharedArrayBuffer === 'undefined') {
        return;
      }

      const batches = [
        {
          vectors: [new Float32Array([1, 2]), new Float32Array([3, 4])],
          queryVectors: [new Float32Array([5, 6])],
        },
        {
          vectors: [new Float32Array([7, 8])],
          queryVectors: [new Float32Array([9, 10]), new Float32Array([11, 12])],
        },
      ];

      const result = manager.createBatchLayout(batches, {
        interleaveData: true,
        alignVectors: true,
      });

      expect(result.buffer).toBeInstanceOf(SharedArrayBuffer);
      expect(result.layout.batches).toHaveLength(2);

      // Check first batch layout
      const batch0 = result.layout.batches[0];
      expect(batch0).toBeDefined();
      expect(batch0!.vectorCount).toBe(2);
      expect(batch0!.queryCount).toBe(1);
      expect(batch0!.vectorsOffset).toBeGreaterThan(0);
      expect(batch0!.queriesOffset).toBeGreaterThan(batch0!.vectorsOffset);

      // Check second batch layout
      const batch1 = result.layout.batches[1];
      expect(batch1).toBeDefined();
      expect(batch1!.vectorCount).toBe(1);
      expect(batch1!.queryCount).toBe(2);
    });

    it('should return top results for shared memory batch search', async () => {
      if (typeof SharedArrayBuffer === 'undefined') {
        return;
      }

      const results = await manager.sharedMemoryBatchSearch(
        [
          new Float32Array([1, 0]),
          new Float32Array([0, 1]),
          new Float32Array([0.5, 0.5]),
        ],
        [new Float32Array([1, 0]), new Float32Array([0, 1])],
        2,
        'cosine',
      );

      expect(results).toHaveLength(2);
      expect(results[0]).toHaveLength(2);
      expect(results[0]![0]).toMatchObject({ index: 0, distance: 0, score: 1 });
      expect(results[1]).toHaveLength(2);
      expect(results[1]![0]).toMatchObject({ index: 1, distance: 0, score: 1 });
    });
  });

  describe('sharedMemoryBatchSearch — non-empty results and brute force parity', () => {
    let manager: SharedMemoryManager;

    beforeEach(() => {
      if (typeof SharedArrayBuffer === 'undefined') {
        return;
      }
      manager = new SharedMemoryManager();
    });

    it('sharedMemoryBatchSearch returns non-empty results for non-empty inputs', async () => {
      if (typeof SharedArrayBuffer === 'undefined') {
        return;
      }

      const vectors = [
        new Float32Array([1, 0, 0]),
        new Float32Array([0, 1, 0]),
        new Float32Array([0, 0, 1]),
        new Float32Array([0.5, 0.5, 0]),
      ];
      const queries = [new Float32Array([1, 0, 0]), new Float32Array([0, 1, 0])];

      const results = await manager.sharedMemoryBatchSearch(
        vectors,
        queries,
        2,
        'cosine',
      );

      // Must return one result set per query
      expect(results.length).toBe(queries.length);

      // Each query must have non-empty results
      for (const queryResults of results) {
        expect(queryResults.length).toBeGreaterThan(0);
        expect(queryResults.length).toBeLessThanOrEqual(2);

        // Each result must have the required fields with valid values
        for (const result of queryResults) {
          expect(typeof result.index).toBe('number');
          expect(typeof result.distance).toBe('number');
          expect(typeof result.score).toBe('number');
          expect(isFinite(result.distance)).toBe(true);
          expect(isFinite(result.score)).toBe(true);
          expect(result.index).toBeGreaterThanOrEqual(0);
          expect(result.index).toBeLessThan(vectors.length);
        }
      }
    });

    it('sharedMemoryBatchSearch matches brute force for cosine metric (2D)', async () => {
      if (typeof SharedArrayBuffer === 'undefined') {
        return;
      }

      const vectors = [
        new Float32Array([1, 0]),
        new Float32Array([0, 1]),
        new Float32Array([0.6, 0.8]),
        new Float32Array([-1, 0]),
      ];
      const queries = [new Float32Array([1, 0.1]), new Float32Array([0.3, 0.7])];
      const k = 3;

      const smResults = await manager.sharedMemoryBatchSearch(
        vectors,
        queries,
        k,
        'cosine',
      );
      expect(smResults.length).toBe(queries.length);

      for (let qi = 0; qi < queries.length; qi++) {
        const bf = bruteForceSearch(vectors, queries[qi]!, k, 'cosine');
        const sm = smResults[qi]!;

        expect(sm.length).toBe(bf.length);

        // Top result indices must match
        expect(sm[0]!.index).toBe(bf[0]!.index);

        // Distances must match within floating-point tolerance
        for (let ri = 0; ri < bf.length; ri++) {
          expect(sm[ri]!.index).toBe(bf[ri]!.index);
          expect(sm[ri]!.distance).toBeCloseTo(bf[ri]!.distance, 4);
        }
      }
    });

    it('sharedMemoryBatchSearch matches brute force for euclidean metric (4D)', async () => {
      if (typeof SharedArrayBuffer === 'undefined') {
        return;
      }

      const vectors = [
        new Float32Array([1, 2, 3, 4]),
        new Float32Array([5, 6, 7, 8]),
        new Float32Array([0, 0, 0, 0]),
        new Float32Array([1, 1, 1, 1]),
        new Float32Array([2, 3, 4, 5]),
      ];
      const queries = [new Float32Array([1, 2, 3, 4]), new Float32Array([3, 3, 3, 3])];
      const k = 3;

      const smResults = await manager.sharedMemoryBatchSearch(
        vectors,
        queries,
        k,
        'euclidean',
      );

      for (let qi = 0; qi < queries.length; qi++) {
        const bf = bruteForceSearch(vectors, queries[qi]!, k, 'euclidean');
        const sm = smResults[qi]!;

        expect(sm.length).toBe(bf.length);
        for (let ri = 0; ri < bf.length; ri++) {
          expect(sm[ri]!.index).toBe(bf[ri]!.index);
          expect(sm[ri]!.distance).toBeCloseTo(bf[ri]!.distance, 4);
        }
      }
    });

    it('sharedMemoryBatchSearch matches brute force for manhattan metric (3D)', async () => {
      if (typeof SharedArrayBuffer === 'undefined') {
        return;
      }

      const vectors = [
        new Float32Array([0, 0, 0]),
        new Float32Array([1, 1, 1]),
        new Float32Array([2, 0, 0]),
        new Float32Array([0, 2, 0]),
      ];
      const queries = [new Float32Array([0.5, 0.5, 0.5])];
      const k = 4;

      const smResults = await manager.sharedMemoryBatchSearch(
        vectors,
        queries,
        k,
        'manhattan',
      );

      const bf = bruteForceSearch(vectors, queries[0]!, k, 'manhattan');
      const sm = smResults[0]!;

      expect(sm.length).toBe(bf.length);
      for (let ri = 0; ri < bf.length; ri++) {
        expect(sm[ri]!.index).toBe(bf[ri]!.index);
        expect(sm[ri]!.distance).toBeCloseTo(bf[ri]!.distance, 4);
      }
    });

    it('sharedMemoryBatchSearch matches brute force for dot metric (3D)', async () => {
      if (typeof SharedArrayBuffer === 'undefined') {
        return;
      }

      const vectors = [
        new Float32Array([1, 0, 0]),
        new Float32Array([0, 1, 0]),
        new Float32Array([0.5, 0.5, 0.7]),
        new Float32Array([0.9, 0.1, 0.3]),
      ];
      const queries = [new Float32Array([0.8, 0.2, 0.5])];
      const k = 2;

      const smResults = await manager.sharedMemoryBatchSearch(vectors, queries, k, 'dot');

      const bf = bruteForceSearch(vectors, queries[0]!, k, 'dot');
      const sm = smResults[0]!;

      expect(sm.length).toBe(bf.length);
      for (let ri = 0; ri < bf.length; ri++) {
        expect(sm[ri]!.index).toBe(bf[ri]!.index);
        expect(sm[ri]!.distance).toBeCloseTo(bf[ri]!.distance, 4);
      }
    });

    it('sharedMemoryBatchSearch matches brute force for hamming metric (binary vectors)', async () => {
      if (typeof SharedArrayBuffer === 'undefined') {
        return;
      }

      const vectors = [
        new Float32Array([1, 0, 1, 0]),
        new Float32Array([1, 1, 1, 0]),
        new Float32Array([0, 0, 0, 0]),
        new Float32Array([1, 1, 1, 1]),
      ];
      const queries = [new Float32Array([1, 0, 1, 0])];
      const k = 3;

      const smResults = await manager.sharedMemoryBatchSearch(
        vectors,
        queries,
        k,
        'hamming',
      );

      const bf = bruteForceSearch(vectors, queries[0]!, k, 'hamming');
      const sm = smResults[0]!;

      expect(sm.length).toBe(bf.length);
      for (let ri = 0; ri < bf.length; ri++) {
        expect(sm[ri]!.index).toBe(bf[ri]!.index);
        expect(sm[ri]!.distance).toBeCloseTo(bf[ri]!.distance, 4);
      }
    });

    it('sharedMemoryBatchSearch matches brute force for jaccard metric (sparse vectors)', async () => {
      if (typeof SharedArrayBuffer === 'undefined') {
        return;
      }

      const vectors = [
        new Float32Array([1, 1, 0, 0]),
        new Float32Array([0, 1, 1, 0]),
        new Float32Array([1, 0, 0, 1]),
        new Float32Array([0, 0, 1, 1]),
      ];
      const queries = [new Float32Array([1, 1, 0, 0])];
      const k = 4;

      const smResults = await manager.sharedMemoryBatchSearch(
        vectors,
        queries,
        k,
        'jaccard',
      );

      const bf = bruteForceSearch(vectors, queries[0]!, k, 'jaccard');
      const sm = smResults[0]!;

      expect(sm.length).toBe(bf.length);
      for (let ri = 0; ri < bf.length; ri++) {
        expect(sm[ri]!.index).toBe(bf[ri]!.index);
        expect(sm[ri]!.distance).toBeCloseTo(bf[ri]!.distance, 4);
      }
    });

    it('sharedMemoryBatchSearch brute force parity holds for higher-dimensional vectors', async () => {
      if (typeof SharedArrayBuffer === 'undefined') {
        return;
      }

      // 16-dimensional vectors
      const dim = 16;
      const seed = (i: number, j: number) => ((i * 7 + j * 13) % 17) / 17;
      const vectors = Array.from(
        { length: 10 },
        (_, i) => new Float32Array(Array.from({ length: dim }, (__, j) => seed(i, j))),
      );
      const queries = Array.from(
        { length: 3 },
        (_, i) =>
          new Float32Array(Array.from({ length: dim }, (__, j) => seed(i + 10, j))),
      );
      const k = 5;

      for (const metric of ['cosine', 'euclidean', 'manhattan'] as DistanceMetric[]) {
        const smResults = await manager.sharedMemoryBatchSearch(
          vectors,
          queries,
          k,
          metric,
        );

        expect(smResults.length).toBe(queries.length);

        for (let qi = 0; qi < queries.length; qi++) {
          const bf = bruteForceSearch(vectors, queries[qi]!, k, metric);
          const sm = smResults[qi]!;

          expect(sm.length).toBe(k);

          // Top-1 must match
          expect(sm[0]!.index).toBe(bf[0]!.index);

          // All k results must match index and distance
          for (let ri = 0; ri < k; ri++) {
            expect(sm[ri]!.index).toBe(bf[ri]!.index);
            expect(sm[ri]!.distance).toBeCloseTo(bf[ri]!.distance, 3);
          }
        }
      }
    });

    it('sharedMemoryBatchSearch handles multiple query chunks with parity', async () => {
      if (typeof SharedArrayBuffer === 'undefined') {
        return;
      }

      const vectors = [
        new Float32Array([1, 0]),
        new Float32Array([0, 1]),
        new Float32Array([0.5, 0.5]),
      ];
      // 5 queries — exceeds default chunk size? No, default is 1000 so all in one chunk.
      // Use chunkSize=2 to force multiple chunks.
      const queries = [
        new Float32Array([1, 0]),
        new Float32Array([0, 1]),
        new Float32Array([0.7, 0.3]),
        new Float32Array([0.3, 0.7]),
        new Float32Array([0.5, 0.5]),
      ];
      const k = 2;

      const smResults = await manager.sharedMemoryBatchSearch(
        vectors,
        queries,
        k,
        'cosine',
        {
          chunkSize: 2,
        },
      );

      expect(smResults.length).toBe(queries.length);

      for (let qi = 0; qi < queries.length; qi++) {
        const bf = bruteForceSearch(vectors, queries[qi]!, k, 'cosine');
        const sm = smResults[qi]!;

        expect(sm.length).toBe(bf.length);
        expect(sm[0]!.index).toBe(bf[0]!.index);
        expect(sm[0]!.distance).toBeCloseTo(bf[0]!.distance, 4);
      }
    });
  });

  describe('Worker buffer memory limit regression tests', () => {
    it('rejects allocation exceeding the configured pool memory limit', () => {
      if (typeof SharedArrayBuffer === 'undefined') {
        return;
      }

      // Configure a tight 1 MB pool to verify the guard fires before allocation
      const tightManager = new SharedMemoryManager({
        maxPoolSize: 1 * 1024 * 1024, // 1 MB
        enableStats: true,
      });

      // Requesting ~2 MB should exceed the 1 MB pool limit — rejected before SharedArrayBuffer is created
      expect(() => {
        tightManager.allocateVectorBuffer(1, 500_000); // 500k × 4 bytes = ~2 MB
      }).toThrow('would exceed the pool memory limit');
    });

    it('rejects sequential allocations that cumulatively exceed the pool limit', () => {
      if (typeof SharedArrayBuffer === 'undefined') {
        return;
      }

      const tightManager = new SharedMemoryManager({
        maxPoolSize: 2 * 1024 * 1024, // 2 MB
        enableStats: true,
      });

      // First ~1 MB allocation fits
      tightManager.allocateVectorBuffer(1, 250_000); // 250k × 4 bytes ≈ 1 MB

      // Second ~1.5 MB allocation pushes total over 2 MB limit
      expect(() => {
        tightManager.allocateVectorBuffer(1, 375_000); // 375k × 4 bytes ≈ 1.5 MB
      }).toThrow('would exceed the pool memory limit');
    });

    it('rejects allocation when the request alone exceeds the pool size', () => {
      if (typeof SharedArrayBuffer === 'undefined') {
        return;
      }

      // 1-byte pool (a nonsensically small limit) — any vector allocation must fail
      const microManager = new SharedMemoryManager({ maxPoolSize: 1 });
      expect(() => {
        microManager.allocateVectorBuffer(1, 1); // 1×1×4 + header > 1 byte
      }).toThrow('would exceed the pool memory limit');
    });
  });
});
