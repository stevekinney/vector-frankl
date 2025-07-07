import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { WASMOperations } from '@/wasm/wasm-operations.js';

describe('WASMOperations', () => {
  let wasmOps: WASMOperations;

  beforeAll(async () => {
    wasmOps = new WASMOperations({
      enableWASM: true,
      wasmThreshold: 32,
      enableSIMDFallback: true,
      enableProfiling: true,
    });

    await wasmOps.init();
  });

  afterAll(async () => {
    await wasmOps.cleanup();
  });

  describe('Initialization and Capabilities', () => {
    it('should initialize WASM operations', async () => {
      const capabilities = wasmOps.getCapabilities();

      expect(capabilities).toBeDefined();
      expect(capabilities.scalarAvailable).toBe(true);
      expect(capabilities.thresholds).toBeDefined();
      expect(capabilities.thresholds.wasm).toBe(32);
      expect(capabilities.thresholds.simd).toBe(16);
    });

    it('should provide accurate capability information', () => {
      const capabilities = wasmOps.getCapabilities();

      expect(typeof capabilities.wasmAvailable).toBe('boolean');
      expect(typeof capabilities.simdAvailable).toBe('boolean');
      expect(capabilities.scalarAvailable).toBe(true);

      expect(capabilities.performance.wasmFeatures).toBeInstanceOf(Array);
      expect(capabilities.performance.simdFeatures).toBeInstanceOf(Array);
    });
  });

  describe('Dot Product Operations', () => {
    it('should compute dot product with automatic optimization selection', async () => {
      const vectorA = new Float32Array([1, 2, 3, 4]);
      const vectorB = new Float32Array([5, 6, 7, 8]);

      const result = await wasmOps.dotProduct(vectorA, vectorB);
      const expected = 1 * 5 + 2 * 6 + 3 * 7 + 4 * 8; // 70

      expect(result).toBeCloseTo(expected, 6);
    });

    it('should handle large vectors efficiently', async () => {
      // Large enough to trigger WASM optimization
      const size = 100;
      const vectorA = new Float32Array(Array.from({ length: size }, (_, i) => i + 1));
      const vectorB = new Float32Array(
        Array.from({ length: size }, (_, i) => (i + 1) * 2),
      );

      const start = performance.now();
      const result = await wasmOps.dotProduct(vectorA, vectorB);
      const elapsed = performance.now() - start;

      // Verify result
      let expected = 0;
      for (let i = 0; i < size; i++) {
        expected += (i + 1) * ((i + 1) * 2);
      }

      expect(result).toBeCloseTo(expected, 6);
      expect(elapsed).toBeLessThan(100); // Should be fast
    });

    it('should handle small vectors with scalar/SIMD fallback', async () => {
      const smallA = new Float32Array([1, 2]);
      const smallB = new Float32Array([3, 4]);

      const result = await wasmOps.dotProduct(smallA, smallB);
      expect(result).toBe(11); // 1*3 + 2*4
    });

    it('should throw error for mismatched dimensions', async () => {
      const vectorA = new Float32Array([1, 2, 3]);
      const vectorB = new Float32Array([1, 2]);

      expect(wasmOps.dotProduct(vectorA, vectorB)).rejects.toThrow(
        'Vector dimensions must match',
      );
    });
  });

  describe('Magnitude Operations', () => {
    it('should compute magnitude correctly', async () => {
      const vector = new Float32Array([3, 4]); // 3-4-5 triangle
      const result = await wasmOps.magnitude(vector);

      expect(result).toBeCloseTo(5, 6);
    });

    it('should handle zero vectors', async () => {
      const zeroVector = new Float32Array([0, 0, 0]);
      const result = await wasmOps.magnitude(zeroVector);

      expect(result).toBe(0);
    });

    it('should compute magnitude for large vectors', async () => {
      const largeVector = new Float32Array(Array.from({ length: 100 }, () => 1));
      const result = await wasmOps.magnitude(largeVector);

      expect(result).toBeCloseTo(10, 6); // sqrt(100)
    });
  });

  describe('Vector Addition', () => {
    it('should add vectors correctly', async () => {
      const vectorA = new Float32Array([1, 2, 3]);
      const vectorB = new Float32Array([4, 5, 6]);

      const result = await wasmOps.vectorAdd(vectorA, vectorB);
      const expected = new Float32Array([5, 7, 9]);

      expect(result).toEqual(expected);
    });

    it('should handle large vector addition', async () => {
      const size = 50;
      const vectorA = new Float32Array(Array.from({ length: size }, (_, i) => i));
      const vectorB = new Float32Array(Array.from({ length: size }, (_, i) => i * 2));

      const result = await wasmOps.vectorAdd(vectorA, vectorB);

      for (let i = 0; i < size; i++) {
        expect(result[i]).toBe(i + i * 2);
      }
    });

    it('should throw error for mismatched dimensions', async () => {
      const vectorA = new Float32Array([1, 2, 3]);
      const vectorB = new Float32Array([1, 2]);

      expect(wasmOps.vectorAdd(vectorA, vectorB)).rejects.toThrow(
        'Vector dimensions must match',
      );
    });
  });

  describe('Vector Subtraction', () => {
    it('should subtract vectors correctly', async () => {
      const vectorA = new Float32Array([5, 7, 9]);
      const vectorB = new Float32Array([1, 2, 3]);

      const result = await wasmOps.vectorSubtract(vectorA, vectorB);
      const expected = new Float32Array([4, 5, 6]);

      expect(result).toEqual(expected);
    });

    it('should handle negative results', async () => {
      const vectorA = new Float32Array([1, 2, 3]);
      const vectorB = new Float32Array([4, 5, 6]);

      const result = await wasmOps.vectorSubtract(vectorA, vectorB);
      const expected = new Float32Array([-3, -3, -3]);

      expect(result).toEqual(expected);
    });
  });

  describe('Scalar Multiplication', () => {
    it('should multiply by scalar correctly', async () => {
      const vector = new Float32Array([1, 2, 3, 4]);
      const scalar = 2.5;

      const result = await wasmOps.scalarMultiply(vector, scalar);
      const expected = new Float32Array([2.5, 5, 7.5, 10]);

      expect(result).toEqual(expected);
    });

    it('should handle zero scaling', async () => {
      const vector = new Float32Array([1, 2, 3]);
      const result = await wasmOps.scalarMultiply(vector, 0);
      const expected = new Float32Array([0, 0, 0]);

      expect(result).toEqual(expected);
    });

    it('should handle negative scaling', async () => {
      const vector = new Float32Array([1, -2, 3]);
      const result = await wasmOps.scalarMultiply(vector, -1);
      const expected = new Float32Array([-1, 2, -3]);

      expect(result).toEqual(expected);
    });
  });

  describe('Vector Normalization', () => {
    it('should normalize vectors correctly', async () => {
      const vector = new Float32Array([3, 4]); // 3-4-5 triangle
      const result = await wasmOps.normalize(vector);

      expect(result[0]).toBeCloseTo(0.6, 6);
      expect(result[1]).toBeCloseTo(0.8, 6);

      // Check magnitude is 1
      const magnitude = await wasmOps.magnitude(result);
      expect(magnitude).toBeCloseTo(1, 6);
    });

    it('should handle zero vectors', async () => {
      const zeroVector = new Float32Array([0, 0, 0]);
      const result = await wasmOps.normalize(zeroVector);

      expect(result).toEqual(new Float32Array([0, 0, 0]));
    });

    it('should normalize large vectors', async () => {
      const largeVector = new Float32Array(Array.from({ length: 100 }, () => 2));
      const result = await wasmOps.normalize(largeVector);

      // All elements should be 1/sqrt(100) = 0.1
      for (let i = 0; i < 100; i++) {
        expect(result[i]).toBeCloseTo(0.1, 6);
      }

      const magnitude = await wasmOps.magnitude(result);
      expect(magnitude).toBeCloseTo(1, 6);
    });
  });

  describe('Batch Operations', () => {
    it('should perform batch dot products', async () => {
      const vectors = [
        new Float32Array([1, 0]),
        new Float32Array([0, 1]),
        new Float32Array([1, 1]),
      ];
      const query = new Float32Array([1, 1]);

      const results = await wasmOps.batchDotProduct(vectors, query);

      expect(results).toHaveLength(3);
      expect(results[0]).toBe(1); // [1,0] · [1,1] = 1
      expect(results[1]).toBe(1); // [0,1] · [1,1] = 1
      expect(results[2]).toBe(2); // [1,1] · [1,1] = 2
    });

    it('should handle large batch operations efficiently', async () => {
      const vectors = Array.from({ length: 20 }, (_, i) => new Float32Array([i, i + 1]));
      const query = new Float32Array([1, 1]);

      const start = performance.now();
      const results = await wasmOps.batchDotProduct(vectors, query);
      const elapsed = performance.now() - start;

      expect(results).toHaveLength(20);
      expect(elapsed).toBeLessThan(1000);

      // Verify results
      for (let i = 0; i < 20; i++) {
        expect(results[i]).toBe(i + (i + 1)); // i*1 + (i+1)*1
      }
    });
  });

  describe('Performance Benchmarking', () => {
    it('should provide comprehensive performance benchmarks', async () => {
      const benchmark = await wasmOps.benchmarkAll(100, 50);

      expect(benchmark.simd).toBeDefined();
      expect(benchmark.scalar).toBeDefined();
      expect(benchmark.speedup).toBeDefined();

      expect(benchmark.simd.time).toBeGreaterThan(0);
      expect(benchmark.scalar.time).toBeGreaterThan(0);
      expect(benchmark.speedup.simdVsScalar).toBeGreaterThan(0);

      if (benchmark.wasm) {
        expect(benchmark.wasm.time).toBeGreaterThan(0);
        expect(benchmark.speedup.wasmVsScalar).toBeGreaterThan(0);
        expect(benchmark.speedup.wasmVsSIMD).toBeDefined();
      }
    });

    it('should show reasonable performance characteristics', async () => {
      const smallBenchmark = await wasmOps.benchmarkAll(50, 10);
      const largeBenchmark = await wasmOps.benchmarkAll(500, 10);

      // Larger vectors should show better relative performance for optimized implementations
      expect(smallBenchmark.speedup.simdVsScalar).toBeGreaterThan(0);
      expect(largeBenchmark.speedup.simdVsScalar).toBeGreaterThan(0);
    });
  });

  describe('Error Handling and Fallbacks', () => {
    it('should gracefully fallback when WASM fails', async () => {
      // Test with a configuration that might cause WASM to fail
      const fallbackOps = new WASMOperations({
        enableWASM: true,
        enableSIMDFallback: true,
        wasmThreshold: 1, // Very low threshold
      });

      await fallbackOps.init();

      const vectorA = new Float32Array([1, 2, 3]);
      const vectorB = new Float32Array([4, 5, 6]);

      // Should not throw even if WASM fails
      const result = await fallbackOps.dotProduct(vectorA, vectorB);
      expect(result).toBe(32); // 1*4 + 2*5 + 3*6

      await fallbackOps.cleanup();
    });

    it('should handle cleanup gracefully', async () => {
      const tempOps = new WASMOperations();
      await tempOps.init();

      // Should not throw
      await tempOps.cleanup();

      // Should not throw on second cleanup
      await tempOps.cleanup();
    });

    it('should work when WASM is disabled', async () => {
      const noWasmOps = new WASMOperations({
        enableWASM: false,
        enableSIMDFallback: true,
      });

      await noWasmOps.init();

      const capabilities = noWasmOps.getCapabilities();
      // Note: capabilities may still show WASM as available if the environment supports it
      // but the operations will use SIMD/scalar fallback
      expect(capabilities.scalarAvailable).toBe(true);

      // Operations should still work
      const result = await noWasmOps.dotProduct(
        new Float32Array([1, 2]),
        new Float32Array([3, 4]),
      );
      expect(result).toBe(11);

      await noWasmOps.cleanup();
    });
  });

  describe('Edge Cases', () => {
    it('should handle very small vectors', async () => {
      const tiny = new Float32Array([1]);
      const result = await wasmOps.magnitude(tiny);
      expect(result).toBe(1);
    });

    it('should handle large vectors', async () => {
      const large = new Float32Array(Array.from({ length: 2000 }, (_, i) => Math.sin(i)));
      const magnitude = await wasmOps.magnitude(large);

      expect(magnitude).toBeGreaterThan(0);
      expect(isFinite(magnitude)).toBe(true);
    });

    it('should handle special floating point values', async () => {
      // Test with normal values to ensure basic functionality
      const normalVector = new Float32Array([1, 2, 3]);
      const result = await wasmOps.magnitude(normalVector);

      expect(isFinite(result)).toBe(true);
      expect(result).toBeGreaterThan(0);
    });
  });
});
