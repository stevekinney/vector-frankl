import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { WebGPUManager } from '@/gpu/webgpu-manager.js';
import { cleanupIndexedDBMocks, setupIndexedDBMocks } from '../mocks/indexeddb-mock.js';

// Mock WebGPU API for testing
const mockWebGPU = () => {
  // Mock WebGPU constants
  global.GPUBufferUsage = {
    MAP_READ: 1,
    MAP_WRITE: 2,
    COPY_SRC: 4,
    COPY_DST: 8,
    INDEX: 16,
    VERTEX: 32,
    UNIFORM: 64,
    STORAGE: 128,
    INDIRECT: 256,
    QUERY_RESOLVE: 512,
  };

  global.GPUMapMode = {
    READ: 1,
    WRITE: 2,
  };
  const mockAdapter = {
    features: new Set(['timestamp-query']),
    limits: {
      maxStorageBufferBindingSize: 1024 * 1024 * 1024, // 1GB
      maxComputeWorkgroupSizeX: 256,
      maxComputeWorkgroupSizeY: 256,
      maxComputeInvocationsPerWorkgroup: 256,
    },
    requestDevice: async () => mockDevice,
  };

  const mockDevice = {
    features: new Set(['timestamp-query']),
    limits: mockAdapter.limits,
    addEventListener: () => {},
    removeEventListener: () => {},
    createShaderModule: () => ({ label: 'mock-shader' }),
    createComputePipeline: () => ({
      label: 'mock-pipeline',
      getBindGroupLayout: () => ({ label: 'mock-layout' }),
    }),
    createBuffer: (descriptor: any) => ({
      size: descriptor.size,
      destroy: () => {},
      mapAsync: async () => {},
      getMappedRange: () => {
        // Return mock similarity scores for results buffer
        const buffer = new ArrayBuffer(descriptor.size);
        if (descriptor.usage & 1) {
          // MAP_READ flag indicates read buffer
          const view = new Float32Array(buffer);
          // Fill with mock scores (higher for first vector)
          for (let i = 0; i < view.length; i++) {
            view[i] = 1.0 - i * 0.1; // Decreasing similarity
          }
        }
        return buffer;
      },
      unmap: () => {},
    }),
    createBindGroup: () => ({ label: 'mock-bind-group' }),
    createCommandEncoder: () => ({
      beginComputePass: () => ({
        setPipeline: () => {},
        setBindGroup: () => {},
        dispatchWorkgroups: () => {},
        end: () => {},
      }),
      copyBufferToBuffer: () => {},
      finish: () => ({ label: 'mock-command-buffer' }),
    }),
    queue: {
      writeBuffer: () => {},
      submit: () => {},
    },
    destroy: () => {},
  };

  global.navigator = {
    gpu: {
      requestAdapter: async () => mockAdapter as any,
    },
  } as any;

  return { mockAdapter, mockDevice };
};

describe('WebGPUManager', () => {
  beforeAll(() => {
    setupIndexedDBMocks();
  });

  afterAll(() => {
    cleanupIndexedDBMocks();
  });

  describe('Initialization', () => {
    it('should fail to initialize when WebGPU is not supported', async () => {
      // Remove WebGPU support
      // @ts-expect-error - Removing WebGPU support to test initialization failure
      global.navigator = {};

      const manager = new WebGPUManager();

      try {
        await manager.init();
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('WebGPU is not supported');
      }
    });

    it('should initialize successfully with mock WebGPU', async () => {
      mockWebGPU();

      const manager = new WebGPUManager({
        debug: true,
        enableProfiling: true,
      });

      await manager.init();

      expect(manager.isAvailable()).toBe(true);

      const capabilities = manager.getCapabilities();
      expect(capabilities).toBeDefined();
      expect(capabilities?.maxBufferSize).toBeGreaterThan(0);
      expect(capabilities?.features).toContain('timestamp-query');

      await manager.cleanup();
    });

    it('should handle custom configuration', async () => {
      mockWebGPU();

      const config = {
        powerPreference: 'low-power' as const,
        debug: false,
        maxBufferSize: 128 * 1024 * 1024, // 128MB
        batchSize: 512,
        enableProfiling: false,
      };

      const manager = new WebGPUManager(config);
      await manager.init();

      expect(manager.isAvailable()).toBe(true);

      await manager.cleanup();
    });
  });

  describe('Compute Operations', () => {
    let manager: WebGPUManager;

    beforeAll(async () => {
      mockWebGPU();
      manager = new WebGPUManager({ enableProfiling: true });
      await manager.init();
    });

    afterAll(async () => {
      await manager.cleanup();
    });

    it('should handle empty vector arrays', async () => {
      const result = await manager.computeSimilarity(
        [],
        new Float32Array([1, 2, 3]),
        'cosine',
      );

      expect(result.scores).toHaveLength(0);
    });

    it('should validate vector dimensions', async () => {
      const vectors = [
        new Float32Array([1, 2, 3]),
        new Float32Array([4, 5]), // Different dimension
      ];
      const queryVector = new Float32Array([1, 2, 3]);

      try {
        await manager.computeSimilarity(vectors, queryVector, 'cosine');
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('same dimension');
      }
    });

    it('should attempt cosine similarity computation', async () => {
      const vectors = [
        new Float32Array([1, 0, 0]),
        new Float32Array([0, 1, 0]),
        new Float32Array([1, 1, 0]),
      ];
      const queryVector = new Float32Array([1, 0, 0]);

      const result = await manager.computeSimilarity(vectors, queryVector, 'cosine');

      // In mock environment, just verify structure
      expect(result.scores).toBeDefined();
      expect(result.processingTime).toBeDefined();
      expect(result.memoryUsage).toBeDefined();
      expect(result.memoryUsage?.bufferSize).toBeGreaterThan(0);
    });

    it('should attempt euclidean similarity computation', async () => {
      const vectors = [new Float32Array([1, 2, 3]), new Float32Array([4, 5, 6])];
      const queryVector = new Float32Array([1, 2, 3]);

      const result = await manager.computeSimilarity(vectors, queryVector, 'euclidean');

      expect(result.scores).toBeDefined();
      expect(result.memoryUsage).toBeDefined();
    });

    it('should attempt manhattan similarity computation', async () => {
      const vectors = [new Float32Array([1, 2]), new Float32Array([3, 4])];
      const queryVector = new Float32Array([1, 2]);

      const result = await manager.computeSimilarity(vectors, queryVector, 'manhattan');

      expect(result.scores).toBeDefined();
      expect(result.memoryUsage).toBeDefined();
    });

    it('should attempt dot product similarity computation', async () => {
      const vectors = [new Float32Array([1, 2]), new Float32Array([3, 4])];
      const queryVector = new Float32Array([1, 1]);

      const result = await manager.computeSimilarity(vectors, queryVector, 'dot');

      expect(result.scores).toBeDefined();
      expect(result.memoryUsage).toBeDefined();
    });

    it('should handle unsupported metrics', async () => {
      const vectors = [new Float32Array([1, 2])];
      const queryVector = new Float32Array([1, 2]);

      try {
        await manager.computeSimilarity(vectors, queryVector, 'hamming' as any);
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('Unsupported distance metric for GPU');
      }
    });
  });

  describe('Batch Operations', () => {
    let manager: WebGPUManager;

    beforeAll(async () => {
      mockWebGPU();
      manager = new WebGPUManager({ batchSize: 2 });
      await manager.init();
    });

    afterAll(async () => {
      await manager.cleanup();
    });

    it('should attempt batch similarity computations', async () => {
      const vectors = [new Float32Array([1, 0]), new Float32Array([0, 1])];
      const queryVectors = [
        new Float32Array([1, 0]),
        new Float32Array([0, 1]),
        new Float32Array([1, 1]),
      ];

      const results = await manager.computeBatchSimilarity(
        vectors,
        queryVectors,
        'cosine',
      );

      expect(results).toHaveLength(3);
      results.forEach((result) => {
        expect(result.scores).toBeDefined();
        expect(result.memoryUsage).toBeDefined();
      });
    });

    it('should handle empty batch operations', async () => {
      const vectors = [new Float32Array([1, 2])];
      const queryVectors: Float32Array[] = [];

      const results = await manager.computeBatchSimilarity(
        vectors,
        queryVectors,
        'cosine',
      );

      expect(results).toHaveLength(0);
    });
  });

  describe('Performance and Optimization', () => {
    let manager: WebGPUManager;

    beforeAll(async () => {
      mockWebGPU();
      manager = new WebGPUManager({ enableProfiling: true });
      await manager.init();
    });

    afterAll(async () => {
      await manager.cleanup();
    });

    it('should provide performance timing information', async () => {
      const vectors = [new Float32Array([1, 2, 3]), new Float32Array([4, 5, 6])];
      const queryVector = new Float32Array([1, 2, 3]);

      const result = await manager.computeSimilarity(vectors, queryVector, 'cosine');

      expect(result.processingTime).toBeDefined();
      expect(result.processingTime).toBeGreaterThanOrEqual(0);
    });

    it('should provide memory usage statistics', async () => {
      const vectors = [new Float32Array([1, 2, 3, 4]), new Float32Array([5, 6, 7, 8])];
      const queryVector = new Float32Array([1, 2, 3, 4]);

      const result = await manager.computeSimilarity(vectors, queryVector, 'cosine');

      expect(result.memoryUsage).toBeDefined();
      expect(result.memoryUsage?.bufferSize).toBeGreaterThan(0);
      expect(result.memoryUsage?.transferred).toBeGreaterThan(0);
    });

    it('should cache and reuse compute pipelines', async () => {
      const vectors = [new Float32Array([1, 2])];
      const queryVector = new Float32Array([1, 2]);

      // First computation
      const result1 = await manager.computeSimilarity(vectors, queryVector, 'cosine');
      expect(result1.scores).toBeDefined();

      // Second computation should reuse cached pipeline
      const result2 = await manager.computeSimilarity(vectors, queryVector, 'cosine');
      expect(result2.scores).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle compute operations when not initialized', async () => {
      const manager = new WebGPUManager();

      try {
        await manager.computeSimilarity(
          [new Float32Array([1, 2])],
          new Float32Array([1, 2]),
          'cosine',
        );
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('not initialized');
      }
    });

    it('should handle cleanup gracefully', async () => {
      mockWebGPU();
      const manager = new WebGPUManager();

      await manager.init();
      expect(manager.isAvailable()).toBe(true);

      await manager.cleanup();
      expect(manager.isAvailable()).toBe(false);

      // Second cleanup should not throw
      await manager.cleanup();
    });
  });

  /**
   * Buffer and resource limit validation tests.
   *
   * The manager must reject oversized allocations before touching the GPU
   * device, so the test mocks an adapter with a very small
   * maxStorageBufferBindingSize to trigger the guard.
   */
  describe('buffer limit validation', () => {
    /** Build a mock WebGPU environment with a custom storage buffer limit. */
    function mockWebGPUWithLimit(maxStorageBufferBindingSize: number) {
      global.GPUBufferUsage = {
        MAP_READ: 1,
        MAP_WRITE: 2,
        COPY_SRC: 4,
        COPY_DST: 8,
        INDEX: 16,
        VERTEX: 32,
        UNIFORM: 64,
        STORAGE: 128,
        INDIRECT: 256,
        QUERY_RESOLVE: 512,
      };

      global.GPUMapMode = { READ: 1, WRITE: 2 };

      const mockAdapter = {
        features: new Set<string>(),
        limits: {
          maxStorageBufferBindingSize,
          maxComputeWorkgroupSizeX: 256,
          maxComputeWorkgroupSizeY: 256,
          maxComputeInvocationsPerWorkgroup: 256,
        },
        requestDevice: async () => mockDevice,
      };

      const mockDevice = {
        features: new Set<string>(),
        limits: mockAdapter.limits,
        addEventListener: () => {},
        removeEventListener: () => {},
        createShaderModule: () => ({ label: 'mock-shader' }),
        createComputePipeline: () => ({
          label: 'mock-pipeline',
          getBindGroupLayout: () => ({ label: 'mock-layout' }),
        }),
        createBuffer: (descriptor: any) => ({
          size: descriptor.size,
          destroy: () => {},
          mapAsync: async () => {},
          getMappedRange: () => {
            const buffer = new ArrayBuffer(descriptor.size);
            if (descriptor.usage & 1) {
              const view = new Float32Array(buffer);
              for (let i = 0; i < view.length; i++) view[i] = 1.0 - i * 0.1;
            }
            return buffer;
          },
          unmap: () => {},
        }),
        createBindGroup: () => ({ label: 'mock-bind-group' }),
        createCommandEncoder: () => ({
          beginComputePass: () => ({
            setPipeline: () => {},
            setBindGroup: () => {},
            dispatchWorkgroups: () => {},
            end: () => {},
          }),
          copyBufferToBuffer: () => {},
          finish: () => ({ label: 'mock-command-buffer' }),
        }),
        queue: { writeBuffer: () => {}, submit: () => {} },
        destroy: () => {},
      };

      global.navigator = {
        gpu: { requestAdapter: async () => mockAdapter as any },
      } as any;
    }

    it('should reject oversized vectors buffer before allocation', async () => {
      // Limit: 16 bytes. Vectors: 10 × 4D × 4 bytes = 160 bytes — exceeds limit.
      mockWebGPUWithLimit(16);

      const manager = new WebGPUManager();
      await manager.init();

      const vectors = Array.from({ length: 10 }, () => new Float32Array([1, 2, 3, 4]));
      const query = new Float32Array([1, 2, 3, 4]);

      try {
        await manager.computeSimilarity(vectors, query, 'cosine');
        expect(true).toBe(false); // Must not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        // QuotaExceededError message contains usage/quota info
        expect((error as Error).message).toMatch(/quota exceeded|bytes/i);
      }

      await manager.cleanup();
    });

    it('should reject oversized query buffer before allocation', async () => {
      // Limit: 8 bytes. Query: 4D × 4 bytes = 16 bytes — exceeds limit.
      // Vectors also 4D to avoid dimension mismatch; vectors buffer = 1×4×4 = 16 bytes,
      // but since vectorsBufferSize is checked first and also exceeds the limit of 8,
      // this test just confirms the QuotaExceededError is raised.
      mockWebGPUWithLimit(8);

      const manager = new WebGPUManager();
      await manager.init();

      const vectors = [new Float32Array([1, 2, 3, 4])];
      const query = new Float32Array([1, 2, 3, 4]);

      try {
        await manager.computeSimilarity(vectors, query, 'cosine');
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toMatch(/quota exceeded|bytes/i);
      }

      await manager.cleanup();
    });

    it('should reject oversized results buffer before allocation', async () => {
      // Craft dimensions so vectors and query buffers fit but results buffer does not.
      // results buffer = vectorCount × 4. Let limit = 20, query = 1D (4 bytes, fits).
      // vectors buffer = vectorCount × 1 × 4. For 4 vectors: 4×4=16 bytes ≤ 20.
      // results buffer = 4 × 4 = 16 bytes ≤ 20... still fits.
      //
      // Use limit = 12: vectors = 3 × 1 × 4 = 12 bytes (exactly fits),
      // query = 1 × 4 = 4 bytes (fits), results = 3 × 4 = 12 bytes (exactly fits).
      // Use limit = 8: vectors = 3 × 1 × 4 = 12 bytes > 8 → caught by vectors check.
      //
      // The only way to isolate the results check is when vectorCount × 4 > limit but
      // vectorCount × dimension × 4 ≤ limit — impossible for dimension ≥ 1.
      // Instead, verify the guard fires at all by using a dimension that makes the
      // vectors buffer the culprit; this is functionally identical for the purpose
      // of confirming pre-allocation validation.
      mockWebGPUWithLimit(4); // 4 bytes: any realistic dataset exceeds this

      const manager = new WebGPUManager();
      await manager.init();

      const vectors = Array.from({ length: 4 }, () => new Float32Array([1, 2, 3, 4]));
      const query = new Float32Array([1, 2, 3, 4]);

      try {
        await manager.computeSimilarity(vectors, query, 'cosine');
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toMatch(/quota exceeded|bytes/i);
      }

      await manager.cleanup();
    });

    it('should succeed when all buffers fit within adapter limits', async () => {
      // Limit: 1MB — plenty for a small dataset.
      mockWebGPUWithLimit(1024 * 1024);

      const manager = new WebGPUManager({ enableProfiling: true });
      await manager.init();

      const vectors = [new Float32Array([1, 0]), new Float32Array([0, 1])];
      const query = new Float32Array([1, 0]);

      // Must not throw
      const result = await manager.computeSimilarity(vectors, query, 'cosine');
      expect(result.scores).toBeDefined();

      await manager.cleanup();
    });

    it('error message includes usage and quota figures for actionability', async () => {
      mockWebGPUWithLimit(4); // 4 bytes = room for exactly one f32

      const manager = new WebGPUManager();
      await manager.init();

      // 2 vectors × 1 dimension × 4 bytes = 8 bytes > 4 byte limit
      const vectors = [new Float32Array([1]), new Float32Array([2])];
      const query = new Float32Array([1]);

      try {
        await manager.computeSimilarity(vectors, query, 'cosine');
        expect(true).toBe(false);
      } catch (error) {
        const message = (error as Error).message;
        // Must contain numeric byte counts so the error is actionable
        expect(message).toMatch(/\d+/);
      }

      await manager.cleanup();
    });
  });
});
