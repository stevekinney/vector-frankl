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
});
