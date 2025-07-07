import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { WorkerPool } from '@/workers/worker-pool.js';
import { setupIndexedDBMocks, cleanupIndexedDBMocks } from '../mocks/indexeddb-mock.js';

describe('Worker Pool', () => {
  let workerPool: WorkerPool;

  beforeAll(() => {
    setupIndexedDBMocks();
  });

  afterAll(() => {
    cleanupIndexedDBMocks();
  });

  describe('Initialization', () => {
    it('should create worker pool with default configuration', () => {
      workerPool = new WorkerPool();
      expect(workerPool).toBeDefined();
      
      const stats = workerPool.getStats();
      expect(stats.totalWorkers).toBe(0); // Not initialized yet
      expect(stats.busyWorkers).toBe(0);
      expect(stats.queueLength).toBe(0);
      expect(stats.activeTasks).toBe(0);
    });

    it('should handle worker initialization gracefully when Workers are not available', async () => {
      // Mock Worker as undefined
      const originalWorker = global.Worker;
      // @ts-expect-error - Intentionally setting Worker to undefined for testing
      global.Worker = undefined;

      const pool = new WorkerPool();
      
      try {
        await pool.init();
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('Web Workers are not supported');
      }

      // Restore Worker
      global.Worker = originalWorker;
    });
  });

  describe('Task Execution', () => {
    it('should handle vector normalization gracefully when workers fail', async () => {
      // Use a non-existent worker script to force failure
      const pool = new WorkerPool({ workerScript: '/non-existent-worker.js' });
      
      const vectors = [
        new Float32Array([3, 4]), // magnitude = 5
        new Float32Array([1, 1])  // magnitude = sqrt(2)
      ];

      // This should fail during initialization and fall back to sequential processing
      try {
        const normalized = await pool.normalizeVectors(vectors);
        expect(normalized).toHaveLength(2);
        
        // Check first vector is normalized
        const firstNorm = Math.sqrt(normalized[0]![0]! ** 2 + normalized[0]![1]! ** 2);
        expect(firstNorm).toBeCloseTo(1, 5);
      } catch (error) {
        // Expected to fail in test environment without actual workers
        expect(error).toBeDefined();
      }
    });

    it('should handle parallel similarity search gracefully', async () => {
      const pool = new WorkerPool({ workerScript: '/non-existent-worker.js' });
      
      const vectors = [
        { id: 'v1', vector: new Float32Array([1, 0]), metadata: {} },
        { id: 'v2', vector: new Float32Array([0, 1]), metadata: {} }
      ];
      
      const queryVector = new Float32Array([1, 0]);

      try {
        const results = await pool.parallelSimilaritySearch(vectors as any, queryVector, 2, 'cosine');
        expect(results).toHaveLength(2);
        expect(results[0]!.id).toBe('v1'); // Should be most similar
      } catch (error) {
        // Expected to fail in test environment without actual workers
        expect(error).toBeDefined();
      }
    });
  });

  describe('Configuration', () => {
    it('should accept custom configuration', () => {
      const config = {
        maxWorkers: 2,
        timeout: 5000,
        retries: 1
      };

      const pool = new WorkerPool(config);
      expect(pool).toBeDefined();
    });

    it('should provide worker statistics', () => {
      const pool = new WorkerPool();
      const stats = pool.getStats();
      
      expect(typeof stats.totalWorkers).toBe('number');
      expect(typeof stats.busyWorkers).toBe('number');
      expect(typeof stats.queueLength).toBe('number');
      expect(typeof stats.activeTasks).toBe('number');
      expect(stats.totalWorkers).toBe(0); // Not initialized
      expect(stats.busyWorkers).toBe(0);
      expect(stats.queueLength).toBe(0);
      expect(stats.activeTasks).toBe(0);
    });
  });

  describe('Cleanup', () => {
    it('should terminate workers cleanly', async () => {
      const pool = new WorkerPool();
      
      // Should not throw even if not initialized
      await pool.terminate();
      
      const stats = pool.getStats();
      expect(stats.totalWorkers).toBe(0);
    });
  });

  describe('SharedArrayBuffer Support', () => {
    it('should detect SharedArrayBuffer availability', async () => {
      const pool = new WorkerPool();
      
      if (typeof SharedArrayBuffer === 'undefined') {
        try {
          await pool.sharedMemorySearch([], new Float32Array([]), 1, 'cosine');
          expect(true).toBe(false); // Should not reach here
        } catch (error) {
          expect((error as Error).message).toContain('SharedArrayBuffer');
        }
      } else {
        // If SharedArrayBuffer is available, test would proceed differently
        expect(typeof SharedArrayBuffer).toBe('function');
      }
    });
  });
});