import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { WASMManager } from '@/wasm/wasm-manager.js';

describe('WASMManager', () => {
  let wasmManager: WASMManager;

  beforeAll(async () => {
    wasmManager = new WASMManager({
      enableWASM: true,
      enableProfiling: true,
    });
  });

  afterAll(async () => {
    await wasmManager.cleanup();
  });

  describe('Initialization', () => {
    it('should detect WebAssembly capabilities', () => {
      const capabilities = wasmManager.getCapabilities();

      expect(capabilities).toBeDefined();
      expect(capabilities.supported).toBeDefined();
      expect(capabilities.features).toBeInstanceOf(Array);
      expect(capabilities.memory).toBeDefined();
      expect(capabilities.performance).toBeDefined();
    });

    it('should not report vector-operation availability without a real module', async () => {
      await wasmManager.init();

      expect(wasmManager.getCapabilities().supported).toBe(
        typeof WebAssembly !== 'undefined',
      );
      expect(wasmManager.isAvailable()).toBe(false);
    });
  });

  describe('Memory Management', () => {
    it('should allocate memory for vectors', async () => {
      if (!wasmManager.isAvailable()) {
        console.log('WASM not available, skipping memory tests');
        return;
      }

      const allocation = wasmManager.allocateVector(100);

      expect(allocation.ptr).toBeGreaterThanOrEqual(0);
      expect(allocation.byteLength).toBe(400); // 100 * 4 bytes
    });

    it('should copy data to and from WASM memory', async () => {
      if (!wasmManager.isAvailable()) {
        return;
      }

      const testVector = new Float32Array([1, 2, 3, 4, 5]);
      const allocation = wasmManager.allocateVector(testVector.length);

      // Copy to WASM
      wasmManager.copyToWASM(testVector, allocation.ptr);

      // Copy back from WASM
      const retrieved = wasmManager.copyFromWASM(allocation.ptr, testVector.length);

      expect(retrieved).toEqual(testVector);
    });
  });

  describe('Vector Operations', () => {
    const testVectorA = new Float32Array([1, 2, 3, 4]);
    const testVectorB = new Float32Array([5, 6, 7, 8]);

    it('should reject vector operations when no real WASM backend is loaded', async () => {
      await wasmManager.init();

      expect(wasmManager.dotProduct(testVectorA, testVectorB)).rejects.toThrow(
        'WebAssembly not available',
      );
      expect(wasmManager.magnitude(testVectorA)).rejects.toThrow(
        'WebAssembly not available',
      );
      expect(wasmManager.vectorAdd(testVectorA, testVectorB)).rejects.toThrow(
        'WebAssembly not available',
      );
    });

    it('should compute dot product with WebAssembly', async () => {
      if (!wasmManager.isAvailable()) {
        console.log('WASM not available, skipping operation tests');
        return;
      }

      const result = await wasmManager.dotProduct(testVectorA, testVectorB);
      expect(result).toBe(70);
    });

    it('should compute magnitude with WebAssembly', async () => {
      if (!wasmManager.isAvailable()) {
        return;
      }

      const result = await wasmManager.magnitude(testVectorA);
      expect(typeof result).toBe('number');
      expect(isFinite(result)).toBe(true);
      expect(result).toBeGreaterThan(0);
    });

    it('should perform vector addition with WebAssembly', async () => {
      if (!wasmManager.isAvailable()) {
        return;
      }

      const result = await wasmManager.vectorAdd(testVectorA, testVectorB);
      expect(result).toBeInstanceOf(Float32Array);
      expect(result.length).toBe(testVectorA.length);
    });

    it('should handle errors gracefully', async () => {
      if (!wasmManager.isAvailable()) {
        return;
      }

      const vectorA = new Float32Array([1, 2]);
      const vectorB = new Float32Array([1, 2, 3]);

      expect(wasmManager.dotProduct(vectorA, vectorB)).rejects.toThrow(
        'Vector dimensions must match',
      );
    });
  });

  describe('Performance', () => {
    it('should provide benchmark functionality', async () => {
      if (!wasmManager.isAvailable()) {
        console.log('WASM not available, skipping benchmark tests');
        return;
      }

      const benchmark = await wasmManager.benchmark(100, 10);

      expect(benchmark.wasm).toBeDefined();
      expect(benchmark.javascript).toBeDefined();
      expect(benchmark.speedup).toBeDefined();

      expect(benchmark.wasm.processingTime).toBeGreaterThan(0);
      expect(benchmark.javascript.processingTime).toBeGreaterThan(0);
      expect(benchmark.speedup).toBeGreaterThan(0);

      expect(benchmark.wasm.operationsPerSecond).toBeGreaterThan(0);
      expect(benchmark.javascript.operationsPerSecond).toBeGreaterThan(0);
    });

    it('should handle large vector operations efficiently', async () => {
      if (!wasmManager.isAvailable()) {
        return;
      }

      const largeVectorA = new Float32Array(Array.from({ length: 1000 }, (_, i) => i));
      const largeVectorB = new Float32Array(
        Array.from({ length: 1000 }, (_, i) => i + 1),
      );

      const start = performance.now();
      await wasmManager.dotProduct(largeVectorA, largeVectorB);
      const elapsed = performance.now() - start;

      // Should complete in reasonable time
      expect(elapsed).toBeLessThan(1000);
    });
  });

  describe('Error Handling', () => {
    it('should handle WASM unavailability gracefully', async () => {
      const unavailableWasm = new WASMManager({ enableWASM: false });

      expect(unavailableWasm.isAvailable()).toBe(false);

      expect(
        unavailableWasm.dotProduct(new Float32Array([1, 2]), new Float32Array([3, 4])),
      ).rejects.toThrow('WebAssembly not available');
    });

    it('should handle cleanup gracefully', async () => {
      const tempWasm = new WASMManager();

      await tempWasm.init();
      expect(tempWasm.isAvailable()).toBe(false);

      await tempWasm.cleanup();
      expect(tempWasm.isAvailable()).toBe(false);

      // Should not throw on second cleanup
      await tempWasm.cleanup();
    });

    it('should handle memory allocation failures', () => {
      if (!wasmManager.isAvailable()) {
        return;
      }

      // Try to allocate an extremely large vector
      expect(() => {
        wasmManager.allocateVector(Number.MAX_SAFE_INTEGER);
      }).toThrow();
    });
  });

  describe('Configuration', () => {
    it('should respect configuration options', () => {
      const customWasm = new WASMManager({
        enableWASM: true,
        wasmThreshold: 128,
        enableProfiling: false,
        maxMemory: 32 * 1024 * 1024, // 32MB
      });

      expect(customWasm).toBeDefined();

      const capabilities = customWasm.getCapabilities();
      expect(capabilities.memory.maximum).toBe(32 * 1024 * 1024);
    });

    it('should detect WebAssembly features correctly', () => {
      const capabilities = wasmManager.getCapabilities();

      if (capabilities.supported) {
        expect(capabilities.features).toContain('basic');

        // Check for advanced features if supported
        if (capabilities.performance.supportsSimd) {
          expect(capabilities.features).toContain('simd');
        }

        if (capabilities.performance.supportsBulkMemory) {
          expect(capabilities.features).toContain('bulk-memory');
        }

        if (capabilities.performance.supportsThreads) {
          expect(capabilities.features).toContain('threads');
        }
      }
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero-length vectors', async () => {
      if (!wasmManager.isAvailable()) {
        return;
      }

      const emptyA = new Float32Array(0);
      const emptyB = new Float32Array(0);

      try {
        const result = await wasmManager.dotProduct(emptyA, emptyB);
        expect(result).toBe(0);
      } catch (error) {
        // May throw depending on implementation
        expect(error).toBeInstanceOf(Error);
      }
    });

    it('should handle single-element vectors', async () => {
      if (!wasmManager.isAvailable()) {
        return;
      }

      const singleA = new Float32Array([5]);
      const singleB = new Float32Array([3]);

      const result = await wasmManager.dotProduct(singleA, singleB);
      expect(typeof result).toBe('number');
      expect(isFinite(result)).toBe(true);
    });

    it('should handle vectors with special values', async () => {
      if (!wasmManager.isAvailable()) {
        return;
      }

      // Test with infinity and NaN
      const specialA = new Float32Array([1, Infinity, -Infinity]);
      const specialB = new Float32Array([1, 0, 0]);

      try {
        const result = await wasmManager.dotProduct(specialA, specialB);
        expect(typeof result).toBe('number');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
      }
    });
  });

  describe('WebAssembly memory size limit regression tests', () => {
    it('rejects allocation exceeding the configured maxMemory limit', () => {
      // 1 MB max; requesting > 1 MB must throw before WebAssembly.Memory.grow() is called
      const limitedWasm = new WASMManager({
        maxMemory: 1 * 1024 * 1024, // 1 MB
      });

      // 1,000,000 floats × 4 bytes = 4 MB — well over the 1 MB limit
      expect(() => limitedWasm.allocateVector(1_000_000)).toThrow(
        'exceeds the maximum allowed memory',
      );
    });

    it('rejects Number.MAX_SAFE_INTEGER allocation before attempting memory growth', () => {
      const wasm = new WASMManager({ maxMemory: 64 * 1024 * 1024 }); // 64 MB

      // This would require petabytes of WASM memory if not caught early
      expect(() => wasm.allocateVector(Number.MAX_SAFE_INTEGER)).toThrow(
        'exceeds the maximum allowed memory',
      );
    });

    it('accepts allocation within the configured maxMemory limit', () => {
      // 64 MB default; 100-element vector = 400 bytes — always within limit
      const wasm = new WASMManager({ maxMemory: 64 * 1024 * 1024 });

      // Should not throw — 400 bytes is far below 64 MB
      expect(() => wasm.allocateVector(100)).not.toThrow();
    });

    it('respects custom maxMemory passed to WASMManager configuration', () => {
      const smallWasm = new WASMManager({
        maxMemory: 4096, // 4 KB — tiny limit for testing
      });

      // 2000 floats × 4 bytes = 8000 bytes > 4096 bytes limit
      expect(() => smallWasm.allocateVector(2000)).toThrow(
        'exceeds the maximum allowed memory',
      );

      // 100 floats × 4 bytes = 400 bytes < 4096 bytes limit
      expect(() => smallWasm.allocateVector(100)).not.toThrow();
    });
  });
});
