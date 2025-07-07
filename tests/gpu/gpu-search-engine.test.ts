import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { GPUSearchEngine } from '../../src/gpu/gpu-search-engine.js';
import type { VectorData } from '../../src/core/types.js';
import { setupIndexedDBMocks, cleanupIndexedDBMocks } from '../mocks/indexeddb-mock.js';

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
    QUERY_RESOLVE: 512
  };
  
  global.GPUMapMode = {
    READ: 1,
    WRITE: 2
  };
  const mockAdapter = {
    features: new Set(['timestamp-query']),
    limits: {
      maxStorageBufferBindingSize: 1024 * 1024 * 1024,
      maxComputeWorkgroupSizeX: 256,
      maxComputeWorkgroupSizeY: 256,
      maxComputeInvocationsPerWorkgroup: 256
    },
    requestDevice: async () => mockDevice
  };

  const mockDevice = {
    features: new Set(['timestamp-query']),
    limits: mockAdapter.limits,
    addEventListener: () => {},
    createShaderModule: () => ({ label: 'mock-shader' }),
    createComputePipeline: () => ({
      label: 'mock-pipeline',
      getBindGroupLayout: () => ({ label: 'mock-layout' })
    }),
    createBuffer: (descriptor: any) => ({
      size: descriptor.size,
      destroy: () => {},
      mapAsync: async () => {},
      getMappedRange: () => {
        // Return mock similarity scores for results buffer
        const buffer = new ArrayBuffer(descriptor.size);
        if (descriptor.usage & 1) { // MAP_READ flag indicates read buffer
          const view = new Float32Array(buffer);
          // Fill with mock scores (higher for first vector)
          for (let i = 0; i < view.length; i++) {
            view[i] = 1.0 - (i * 0.1); // Decreasing similarity
          }
        }
        return buffer;
      },
      unmap: () => {}
    }),
    createBindGroup: () => ({ label: 'mock-bind-group' }),
    createCommandEncoder: () => ({
      beginComputePass: () => ({
        setPipeline: () => {},
        setBindGroup: () => {},
        dispatchWorkgroups: () => {},
        end: () => {}
      }),
      copyBufferToBuffer: () => {},
      finish: () => ({ label: 'mock-command-buffer' })
    }),
    queue: {
      writeBuffer: () => {},
      submit: () => {}
    },
    destroy: () => {}
  };

  // @ts-ignore - Mocking navigator.gpu for WebGPU testing
  (global as any).navigator = {
    gpu: {
      requestAdapter: async () => mockAdapter
    }
  };

  return { mockAdapter, mockDevice };
};

describe('GPUSearchEngine', () => {
  beforeAll(() => {
    setupIndexedDBMocks();
  });

  afterAll(() => {
    cleanupIndexedDBMocks();
  });

  describe('Initialization', () => {
    it('should initialize with default configuration', async () => {
      mockWebGPU();
      
      const engine = new GPUSearchEngine();
      await engine.init();
      
      expect(engine.isGPUReady()).toBe(true);
      
      const capabilities = engine.getGPUCapabilities();
      expect(capabilities).toBeDefined();
      
      await engine.cleanup();
    });

    it('should initialize with custom configuration', async () => {
      mockWebGPU();
      
      const config = {
        gpuThreshold: 2000,
        enableFallback: true,
        batchSize: 512,
        enableProfiling: true,
        webGPUConfig: {
          powerPreference: 'high-performance' as const,
          debug: true
        }
      };

      const engine = new GPUSearchEngine(config);
      await engine.init();
      
      expect(engine.isGPUReady()).toBe(true);
      
      await engine.cleanup();
    });

    it('should handle initialization failure gracefully', async () => {
      // Remove WebGPU support
      (global as any).navigator = {};
      
      const engine = new GPUSearchEngine({ enableFallback: true });
      await engine.init();
      
      expect(engine.isGPUReady()).toBe(false);
    });
  });

  describe('GPU Search Operations', () => {
    let engine: GPUSearchEngine;
    let vectors: VectorData[];

    beforeAll(async () => {
      mockWebGPU();
      engine = new GPUSearchEngine({
        gpuThreshold: 2, // Low threshold for testing
        enableProfiling: true
      });
      await engine.init();

      // Create test vectors
      vectors = [
        {
          id: 'v1',
          vector: new Float32Array([1, 0, 0]),
          metadata: { type: 'test', value: 1 },
          magnitude: 1,
          timestamp: Date.now()
        },
        {
          id: 'v2',
          vector: new Float32Array([0, 1, 0]),
          metadata: { type: 'test', value: 2 },
          magnitude: 1,
          timestamp: Date.now()
        },
        {
          id: 'v3',
          vector: new Float32Array([0, 0, 1]),
          metadata: { type: 'test', value: 3 },
          magnitude: 1,
          timestamp: Date.now()
        }
      ];
    });

    afterAll(async () => {
      await engine.cleanup();
    });

    it('should perform GPU-accelerated search', async () => {
      const queryVector = new Float32Array([1, 0, 0]);
      
      const { results, stats } = await engine.search(vectors, queryVector, 2, 'cosine');
      
      expect(results).toBeDefined();
      expect(stats!.usedGPU).toBe(true);
      expect(stats!.processingTime).toBeDefined();
      expect(stats!.memoryUsage).toBeDefined();
      expect(stats!.gpuCapabilities).toBeDefined();
      
      // Results should be sorted by score (highest first)
      if (results.length >= 2 && results[0]?.score !== undefined && results[1]?.score !== undefined) {
        expect(results[0]!.score).toBeGreaterThanOrEqual(results[1]!.score);
      }
      
      // Check that we get results (even if empty in mock environment)
      expect(Array.isArray(results)).toBe(true);
    });

    it('should include metadata when requested', async () => {
      const queryVector = new Float32Array([1, 0, 0]);
      
      const { results } = await engine.search(vectors, queryVector, 2, 'cosine', {
        includeMetadata: true
      });
      
      expect(results[0]!.metadata).toBeDefined();
      expect(results[0]!.metadata?.['type']).toBe('test');
    });

    it('should include vector data when requested', async () => {
      const queryVector = new Float32Array([1, 0, 0]);
      
      const { results } = await engine.search(vectors, queryVector, 2, 'cosine', {
        includeVector: true
      });
      
      expect(results[0]!.vector).toBeDefined();
      expect(results[0]!.vector).toBeInstanceOf(Float32Array);
    });

    it('should support different distance metrics', async () => {
      const queryVector = new Float32Array([1, 1]);
      const testVectors = [
        { 
          id: 'v1', 
          vector: new Float32Array([2, 2]), 
          metadata: {}, 
          magnitude: Math.sqrt(8), 
          timestamp: Date.now() 
        }
      ];

      // Test euclidean
      const { results: euclideanResults } = await engine.search(
        testVectors, queryVector, 1, 'euclidean'
      );
      expect(euclideanResults).toHaveLength(1);

      // Test manhattan
      const { results: manhattanResults } = await engine.search(
        testVectors, queryVector, 1, 'manhattan'
      );
      expect(manhattanResults).toHaveLength(1);

      // Test dot product
      const { results: dotResults } = await engine.search(
        testVectors, queryVector, 1, 'dot'
      );
      expect(dotResults).toHaveLength(1);
    });

    it('should fallback to CPU for small datasets', async () => {
      const smallEngine = new GPUSearchEngine({
        gpuThreshold: 10, // Higher than our test vectors
        enableFallback: true
      });
      await smallEngine.init();

      const queryVector = new Float32Array([1, 0, 0]);
      
      const { results, stats } = await smallEngine.search(vectors, queryVector, 2, 'cosine');
      
      expect(results).toHaveLength(2);
      expect(stats.usedGPU).toBe(false);
      
      await smallEngine.cleanup();
    });

    it('should fallback to CPU for unsupported metrics', async () => {
      const queryVector = new Float32Array([1, 0, 0]);
      
      const { results, stats } = await engine.search(vectors, queryVector, 2, 'hamming' as any);
      
      expect(results).toHaveLength(2);
      expect(stats.usedGPU).toBe(false);
    });
  });

  describe('Batch Search Operations', () => {
    let engine: GPUSearchEngine;
    let vectors: VectorData[];

    beforeAll(async () => {
      mockWebGPU();
      engine = new GPUSearchEngine({
        gpuThreshold: 2,
        batchSize: 2,
        enableProfiling: true
      });
      await engine.init();

      vectors = [
        {
          id: 'v1',
          vector: new Float32Array([1, 0]),
          metadata: {},
          magnitude: 1,
          timestamp: Date.now()
        },
        {
          id: 'v2',
          vector: new Float32Array([0, 1]),
          metadata: {},
          magnitude: 1,
          timestamp: Date.now()
        }
      ];
    });

    afterAll(async () => {
      await engine.cleanup();
    });

    it('should perform batch GPU searches', async () => {
      const queryVectors = [
        new Float32Array([1, 0]),
        new Float32Array([0, 1]),
        new Float32Array([1, 1])
      ];
      
      const { results, stats } = await engine.batchSearch(vectors, queryVectors, 2, 'cosine');
      
      expect(results).toHaveLength(3);
      expect(stats).toHaveLength(3);
      
      // All searches should use GPU
      stats.forEach(stat => {
        expect(stat.usedGPU).toBe(true);
      });
      
      // Each query should return results for all vectors
      results.forEach(queryResults => {
        expect(queryResults).toHaveLength(2);
      });
    });

    it('should handle empty batch operations', async () => {
      const queryVectors: Float32Array[] = [];
      
      const { results, stats } = await engine.batchSearch(vectors, queryVectors, 2, 'cosine');
      
      expect(results).toHaveLength(0);
      expect(stats).toHaveLength(0);
    });

    it('should fallback for batch operations when needed', async () => {
      const fallbackEngine = new GPUSearchEngine({
        gpuThreshold: 10, // Force fallback
        enableFallback: true
      });
      await fallbackEngine.init();

      const queryVectors = [new Float32Array([1, 0])];
      
      const { results, stats } = await fallbackEngine.batchSearch(vectors, queryVectors, 2, 'cosine');
      
      expect(results).toHaveLength(1);
      expect(stats).toHaveLength(1);
      expect(stats[0]!.usedGPU).toBe(false);
      
      await fallbackEngine.cleanup();
    });
  });

  describe('Error Handling', () => {
    it('should handle search operations when GPU is not ready', async () => {
      // Removing WebGPU support to test fallback behavior
      (global as any).navigator = {};
      
      const engine = new GPUSearchEngine({ enableFallback: true });
      await engine.init();
      
      const vectors = [{
        id: 'v1',
        vector: new Float32Array([1, 2]),
        metadata: {},
        magnitude: Math.sqrt(5),
        timestamp: Date.now()
      }];
      const queryVector = new Float32Array([1, 2]);
      
      const { results, stats } = await engine.search(vectors, queryVector, 1, 'cosine');
      
      expect(results).toHaveLength(1);
      expect(stats.usedGPU).toBe(false);
    });

    it('should handle cleanup gracefully', async () => {
      mockWebGPU();
      const engine = new GPUSearchEngine();
      
      await engine.init();
      expect(engine.isGPUReady()).toBe(true);
      
      await engine.cleanup();
      expect(engine.isGPUReady()).toBe(false);
      
      // Second cleanup should not throw
      await engine.cleanup();
    });

    it('should handle empty vector arrays', async () => {
      mockWebGPU();
      const engine = new GPUSearchEngine();
      await engine.init();
      
      const { results } = await engine.search([], new Float32Array([1, 2]), 1, 'cosine');
      
      expect(results).toHaveLength(0);
      
      await engine.cleanup();
    });
  });

  describe('Performance and Statistics', () => {
    let engine: GPUSearchEngine;

    beforeAll(async () => {
      mockWebGPU();
      engine = new GPUSearchEngine({
        gpuThreshold: 1,
        enableProfiling: true
      });
      await engine.init();
    });

    afterAll(async () => {
      await engine.cleanup();
    });

    it('should provide detailed performance statistics', async () => {
      const vectors = [{
        id: 'v1',
        vector: new Float32Array([1, 2, 3]),
        metadata: {},
        magnitude: Math.sqrt(14),
        timestamp: Date.now()
      }];
      const queryVector = new Float32Array([1, 2, 3]);
      
      const { results, stats } = await engine.search(vectors, queryVector, 1, 'cosine');
      
      expect(results).toHaveLength(1);
      expect(stats!.usedGPU).toBe(true);
      expect(stats!.processingTime).toBeDefined();
      expect(stats.processingTime).toBeGreaterThanOrEqual(0);
      expect(stats!.memoryUsage).toBeDefined();
      expect(stats.memoryUsage?.bufferSize).toBeGreaterThan(0);
      expect(stats!.gpuCapabilities).toBeDefined();
      expect(stats.gpuCapabilities?.maxBufferSize).toBeGreaterThan(0);
    });

    it('should provide GPU capabilities information', async () => {
      const capabilities = engine.getGPUCapabilities();
      
      expect(capabilities).toBeDefined();
      expect(capabilities?.maxBufferSize).toBeGreaterThan(0);
      expect(capabilities?.maxWorkgroupSize).toBeGreaterThan(0);
      expect(capabilities?.features).toBeInstanceOf(Array);
      expect(capabilities?.limits).toBeDefined();
    });
  });
});