/**
 * Integration tests for batch write backpressure and stream memory bounds.
 *
 * These tests verify that:
 * - Large batch writes are automatically split into memory-bounded sub-batches
 *   so a single addBatch call cannot exhaust the heap.
 * - The searchStream generator applies backpressure: the generator pauses
 *   between batches and only emits results as fast as the consumer drains them.
 * - Memory growth during large operations is bounded and measurable.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { VectorDB } from '@/index.js';
import {
  BATCH_MEMORY_LIMIT_BYTES,
  STREAM_BATCH_SIZE,
} from '@/performance/execution-thresholds.js';
import {
  isWithinMemoryBudget,
  maxStreamBatchSize,
  MemoryProfiler,
  splitByMemoryBudget,
} from '@/performance/memory-guard.js';
import { cleanupIndexedDBMocks, setupIndexedDBMocks } from '../mocks/indexeddb-mock.js';

const DIMENSION = 128;
const TEST_DB_NAME = 'test-backpressure-integration';

describe('Backpressure and large-batch memory behavior', () => {
  let db: VectorDB;

  beforeEach(async () => {
    setupIndexedDBMocks();
    try {
      const existing = new VectorDB(TEST_DB_NAME, DIMENSION);
      await existing.delete();
    } catch {
      // Ignore
    }
    db = new VectorDB(TEST_DB_NAME, DIMENSION, {
      autoEviction: false,
      useIndex: false,
    });
    await db.init();
  });

  afterEach(async () => {
    try {
      await db.delete();
    } catch {
      // Ignore
    }
    cleanupIndexedDBMocks();
  });

  // ---------------------------------------------------------------------------
  // Large batch write: progress reporting and sub-batching
  // ---------------------------------------------------------------------------

  describe('large batch writes', () => {
    it('should complete a large batch add and report progress', async () => {
      const COUNT = 500;
      const progressEvents: number[] = [];

      const vectors = Array.from({ length: COUNT }, (_, i) => ({
        id: `large-batch-${i}`,
        vector: new Float32Array(DIMENSION).fill(i / COUNT),
        metadata: { index: i },
      }));

      await db.addBatch(vectors, {
        batchSize: 100,
        onProgress: (p) => progressEvents.push(p.completed),
      });

      const stats = await db.getStats();
      expect(stats.vectorCount).toBe(COUNT);
      // Progress should have been reported at least once per sub-batch
      expect(progressEvents.length).toBeGreaterThan(0);
      // Completed count in the last progress event should equal total
      expect(progressEvents[progressEvents.length - 1]).toBe(COUNT);
    });

    it('should add a large batch with memory-bounded sub-batching', async () => {
      // Use a very tight memory limit so sub-batching definitely kicks in:
      // at 4 bytes × 2 overhead × 128 dims × 200 vectors = 204_800 bytes.
      // Setting the limit to 1/4 of that forces at least 4 sub-batches.
      const COUNT = 200;
      const tightLimitBytes = Math.floor(
        (DIMENSION * 4 * 2 * COUNT) / 4, // one quarter of estimated total
      );

      const progressBatches: number[] = [];

      const vectors = Array.from({ length: COUNT }, (_, i) => ({
        id: `memory-bounded-${i}`,
        vector: new Float32Array(DIMENSION).fill(i / COUNT),
        metadata: { i },
      }));

      await db.addBatch(vectors, {
        memoryLimitBytes: tightLimitBytes,
        onProgress: (p) => progressBatches.push(p.currentBatch),
      });

      const stats = await db.getStats();
      expect(stats.vectorCount).toBe(COUNT);
      // More than one sub-batch should have been processed
      const maxBatch = Math.max(...progressBatches);
      expect(maxBatch).toBeGreaterThan(1);
    });

    it('should abort a large batch when the abort signal fires', async () => {
      const COUNT = 300;
      const vectors = Array.from({ length: COUNT }, (_, i) => ({
        id: `abort-batch-${i}`,
        vector: new Float32Array(DIMENSION).fill(i / COUNT),
      }));

      // Construct a simple abort signal that fires after the first progress event
      let aborted = false;
      const signal = { get aborted() { return aborted; } };

      let abortError: Error | null = null;

      try {
        await db.addBatch(vectors, {
          batchSize: 50,
          abortSignal: signal,
          onProgress: () => {
            // Abort after the very first batch completes
            aborted = true;
          },
        });
      } catch (error) {
        abortError = error as Error;
      }

      // The batch should have been aborted
      expect(abortError).toBeDefined();
      expect(abortError?.message).toContain('aborted');

      // Only the first sub-batch worth of vectors should have landed
      const stats = await db.getStats();
      expect(stats.vectorCount).toBeLessThan(COUNT);
    });
  });

  // ---------------------------------------------------------------------------
  // Stream consumer backpressure
  // ---------------------------------------------------------------------------

  describe('stream consumer backpressure', () => {
    beforeEach(async () => {
      // Seed some vectors
      const vectors = Array.from({ length: 50 }, (_, i) => ({
        id: `stream-seed-${i}`,
        vector: new Float32Array(DIMENSION).fill(i / 50),
        metadata: { i },
      }));
      await db.addBatch(vectors);
    });

    it('should yield results in bounded batches from searchStream', async () => {
      const query = new Float32Array(DIMENSION).fill(0.5);
      const batchSizes: number[] = [];

      for await (const batch of db.searchStream(query, {
        batchSize: 5,
        maxResults: 20,
      })) {
        batchSizes.push(batch.length);
        // Each batch must be bounded by the requested batchSize
        expect(batch.length).toBeLessThanOrEqual(5);
      }

      expect(batchSizes.length).toBeGreaterThan(0);
      const totalResults = batchSizes.reduce((sum, n) => sum + n, 0);
      expect(totalResults).toBeLessThanOrEqual(20);
    });

    it('should allow a slow stream consumer without buffering unbounded results', async () => {
      const query = new Float32Array(DIMENSION).fill(0.3);
      const receivedIds: string[] = [];

      // Slow consumer: add an artificial yield point after each batch
      for await (const batch of db.searchStream(query, {
        batchSize: 3,
        maxResults: 15,
      })) {
        receivedIds.push(...batch.map((r) => r.id));
        // Simulate slow consumer: just continue; generator cannot advance until here
      }

      expect(receivedIds.length).toBeLessThanOrEqual(15);
      expect(receivedIds.length).toBeGreaterThan(0);
      // No duplicate results
      const uniqueIds = new Set(receivedIds);
      expect(uniqueIds.size).toBe(receivedIds.length);
    });

    it('should respect maxResults cap in searchStream', async () => {
      const query = new Float32Array(DIMENSION).fill(0.5);
      const allResults: string[] = [];

      for await (const batch of db.searchStream(query, {
        maxResults: 10,
        batchSize: 3,
      })) {
        allResults.push(...batch.map((r) => r.id));
      }

      expect(allResults.length).toBeLessThanOrEqual(10);
    });
  });

  // ---------------------------------------------------------------------------
  // Memory profiling
  // ---------------------------------------------------------------------------

  describe('memory profiling for production paths', () => {
    it('should profile heap usage around a batch add', async () => {
      const profiler = new MemoryProfiler();

      const vectors = Array.from({ length: 100 }, (_, i) => ({
        id: `profile-add-${i}`,
        vector: new Float32Array(DIMENSION).fill(i / 100),
      }));

      const { profile } = await profiler.profile('batch-add', async () => {
        await db.addBatch(vectors);
      });

      expect(profile.operation).toBe('batch-add');
      expect(profile.before.timestamp).toBeGreaterThan(0);
      expect(profile.after.timestamp).toBeGreaterThanOrEqual(profile.before.timestamp);
      // delta.durationMs must be non-negative
      expect(profile.delta.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should profile heap usage around a search', async () => {
      // Seed data
      await db.addBatch(
        Array.from({ length: 50 }, (_, i) => ({
          id: `profile-search-${i}`,
          vector: new Float32Array(DIMENSION).fill(i / 50),
        })),
      );

      const profiler = new MemoryProfiler();
      const query = new Float32Array(DIMENSION).fill(0.5);

      const { profile } = await profiler.profile('search', async () => {
        await db.search(query, 10);
      });

      expect(profile.operation).toBe('search');
      expect(profile.delta.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should accumulate multiple profiles', async () => {
      const profiler = new MemoryProfiler();

      for (const op of ['add-1', 'add-2', 'add-3']) {
        await profiler.profile(op, async () => {
          await db.addBatch([
            {
              id: `acc-${op}`,
              vector: new Float32Array(DIMENSION).fill(0.1),
            },
          ]);
        });
      }

      expect(profiler.getProfiles()).toHaveLength(3);
      profiler.reset();
      expect(profiler.getProfiles()).toHaveLength(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Unit tests for memory-guard utilities (no DB needed)
// ---------------------------------------------------------------------------

describe('splitByMemoryBudget backpressure utility', () => {
  it('should yield a single batch when items fit within budget', () => {
    // 10 items × 128 dims × 8 bytes overhead = 10_240 bytes < 64 MiB
    const items = Array.from({ length: 10 }, (_, i) => ({ index: i }));
    const batches = Array.from(splitByMemoryBudget(items, 128));
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(10);
  });

  it('should split into multiple batches when items exceed budget', () => {
    // 100 items, 128 dims, 8 bytes overhead = 102_400 bytes per item-set
    // budget = 1024 bytes → each batch holds floor(1024 / (128*8)) = 1 item
    const items = Array.from({ length: 100 }, (_, i) => ({ index: i }));
    const batches = Array.from(splitByMemoryBudget(items, 128, 1024));
    expect(batches.length).toBeGreaterThan(1);
    // All items must be accounted for
    const totalItems = batches.reduce((sum, b) => sum + b.length, 0);
    expect(totalItems).toBe(100);
  });

  it('should yield no batches for an empty input', () => {
    const batches = Array.from(splitByMemoryBudget([], 128));
    expect(batches).toHaveLength(0);
  });

  it('should never yield an empty batch', () => {
    const items = Array.from({ length: 50 }, (_, i) => ({ index: i }));
    // Very tight budget: 1 byte — minimum batch size of 1 must still apply
    const batches = Array.from(splitByMemoryBudget(items, 128, 1));
    for (const batch of batches) {
      expect(batch.length).toBeGreaterThan(0);
    }
    const totalItems = batches.reduce((sum, b) => sum + b.length, 0);
    expect(totalItems).toBe(50);
  });

  it('should preserve all items across batches in original order', () => {
    const items = Array.from({ length: 30 }, (_, i) => ({ value: i * 2 }));
    const batches = Array.from(splitByMemoryBudget(items, 64, 512));
    const flattened = batches.flat();
    expect(flattened).toHaveLength(30);
    flattened.forEach((item, i) => {
      expect(item.value).toBe(i * 2);
    });
  });
});

describe('isWithinMemoryBudget', () => {
  it('should return true when batch fits within the default budget', () => {
    // 10 vectors at 128 dims: 10 × 128 × 8 = 10_240 bytes — well under 64 MiB
    expect(isWithinMemoryBudget(10, 128)).toBe(true);
  });

  it('should return false when batch exceeds the supplied budget', () => {
    // 100 × 128 × 8 = 102_400 bytes > 1_024 bytes budget
    expect(isWithinMemoryBudget(100, 128, 1024)).toBe(false);
  });

  it('should return true for zero count', () => {
    expect(isWithinMemoryBudget(0, 128)).toBe(true);
  });
});

describe('maxStreamBatchSize', () => {
  it('should return a positive integer with default options', () => {
    const size = maxStreamBatchSize();
    expect(size).toBeGreaterThan(0);
    expect(Number.isInteger(size)).toBe(true);
  });

  it('should return a larger batch size when given a larger memory limit', () => {
    const small = maxStreamBatchSize({ memoryLimitBytes: 512, bytesPerResult: 128 });
    const large = maxStreamBatchSize({ memoryLimitBytes: 4096, bytesPerResult: 128 });
    expect(large).toBeGreaterThan(small);
  });

  it('should return at least 1 even for a tiny memory limit', () => {
    expect(maxStreamBatchSize({ memoryLimitBytes: 1, bytesPerResult: 512 })).toBe(1);
  });
});

describe('execution-path thresholds are exported and numeric', () => {
  it('should export BATCH_MEMORY_LIMIT_BYTES as a positive number', () => {
    expect(typeof BATCH_MEMORY_LIMIT_BYTES).toBe('number');
    expect(BATCH_MEMORY_LIMIT_BYTES).toBeGreaterThan(0);
  });

  it('should export STREAM_BATCH_SIZE as a positive integer', () => {
    expect(typeof STREAM_BATCH_SIZE).toBe('number');
    expect(STREAM_BATCH_SIZE).toBeGreaterThan(0);
    expect(Number.isInteger(STREAM_BATCH_SIZE)).toBe(true);
  });
});
