import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { SharedMemoryManager } from '../../src/workers/shared-memory.js';
import { setupIndexedDBMocks, cleanupIndexedDBMocks } from '../mocks/indexeddb-mock.js';

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
        expect(() => new SharedMemoryManager()).toThrow('SharedArrayBuffer is not supported');
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
        enableStats: true
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
        enableStats: true
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
      expect(buffer.byteLength).toBeGreaterThanOrEqual(expectedDataSize + layout.headerSize);
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
        new Float32Array([9, 10, 11, 12])
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

      const vectors = [
        new Float32Array([1, 2, 3]),
        new Float32Array([4, 5, 6])
      ];

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
        new Float32Array([7, 8])
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
        enableStats: true
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
      await new Promise(resolve => setTimeout(resolve, 1));

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
          queryVectors: [new Float32Array([5, 6])]
        },
        {
          vectors: [new Float32Array([7, 8])],
          queryVectors: [new Float32Array([9, 10]), new Float32Array([11, 12])]
        }
      ];

      const result = manager.createBatchLayout(batches, {
        interleaveData: true,
        alignVectors: true
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
  });
});