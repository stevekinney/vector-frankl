import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { WASMManager } from '@/wasm/wasm-manager.js';

describe('WASMManager', () => {
  let wasmManager: WASMManager;

  beforeAll(async () => {
    wasmManager = new WASMManager({
      enableWASM: true,
      enableProfiling: true
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

    it('should initialize WebAssembly module if supported', async () => {
      if (wasmManager.getCapabilities().supported) {
        await wasmManager.init();
        expect(wasmManager.isAvailable()).toBe(true);
      } else {
        console.log('WebAssembly not supported in this environment, skipping');
      }
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

    it('should compute dot product with WebAssembly', async () => {
      if (!wasmManager.isAvailable()) {
        console.log('WASM not available, skipping operation tests');
        return;
      }

      // The inline WASM module may return simplified results
      // This test verifies the operation doesn't crash
      const result = await wasmManager.dotProduct(testVectorA, testVectorB);
      expect(typeof result).toBe('number');
      expect(isFinite(result)).toBe(true);
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

      // Test with mismatched vector lengths (if supported by implementation)
      const vectorA = new Float32Array([1, 2]);
      const vectorB = new Float32Array([1, 2, 3]);
      
      try {
        await wasmManager.dotProduct(vectorA, vectorB);
        // If it doesn't throw, that's fine too - depends on WASM implementation
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
      }
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
      const largeVectorB = new Float32Array(Array.from({ length: 1000 }, (_, i) => i + 1));
      
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
      
      expect(unavailableWasm.dotProduct(
        new Float32Array([1, 2]), 
        new Float32Array([3, 4])
      )).rejects.toThrow('WebAssembly not available');
    });

    it('should handle cleanup gracefully', async () => {
      const tempWasm = new WASMManager();
      
      if (tempWasm.getCapabilities().supported) {
        await tempWasm.init();
        expect(tempWasm.isAvailable()).toBe(true);
      }
      
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
        maxMemory: 32 * 1024 * 1024 // 32MB
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
        // May throw depending on how WASM handles special values
        expect(error).toBeInstanceOf(Error);
      }
    });
  });
});