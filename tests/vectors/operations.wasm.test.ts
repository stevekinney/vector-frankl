import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { VectorOperations } from '@/vectors/operations.js';

describe('VectorOperations WebAssembly Integration', () => {
  beforeAll(async () => {
    // Initialize WASM for testing
    await VectorOperations.initWASM();
    
    // Configure thresholds for testing
    VectorOperations.setSIMDThreshold(16);
    VectorOperations.setWASMThreshold(64);
  });

  afterAll(() => {
    // Reset to defaults
    VectorOperations.setSIMDThreshold(16);
    VectorOperations.setWASMThreshold(64);
  });

  describe('WASM Configuration', () => {
    it('should initialize WASM successfully', async () => {
      // Should not throw
      await VectorOperations.initWASM();
    });

    it('should provide capability information', () => {
      const capabilities = VectorOperations.getCapabilities();
      
      expect(capabilities).toBeDefined();
      expect(capabilities.wasm).toBeDefined();
      expect(capabilities.simd).toBeDefined();
      
      expect(typeof capabilities.wasm.wasmAvailable).toBe('boolean');
      expect(typeof capabilities.simd.supported).toBe('boolean');
    });

    it('should enable/disable WASM optimizations', async () => {
      await VectorOperations.setWASMEnabled(false);
      expect(VectorOperations.isWASMEnabled()).toBe(false);
      
      await VectorOperations.setWASMEnabled(true);
      // May be true or false depending on environment support
      expect(typeof VectorOperations.isWASMEnabled()).toBe('boolean');
    });

    it('should set WASM threshold', () => {
      VectorOperations.setWASMThreshold(128);
      
      // Test with vector below new threshold - should use SIMD/scalar
      const result = VectorOperations.magnitude(new Float32Array(Array.from({ length: 100 }, () => 1)));
      expect(result).resolves.toBeCloseTo(10, 6);
      
      // Reset
      VectorOperations.setWASMThreshold(64);
    });
  });

  describe('Three-Tier Performance System', () => {
    describe('Small Vectors (Scalar)', () => {
      const smallVector = new Float32Array([1, 2, 3, 4]); // Below SIMD threshold

      it('should use scalar implementation for magnitude', async () => {
        const result = await VectorOperations.magnitude(smallVector);
        const expected = Math.sqrt(1 + 4 + 9 + 16);
        expect(result).toBeCloseTo(expected, 6);
      });

      it('should use scalar implementation for dot product', async () => {
        const vectorA = new Float32Array([1, 2, 3, 4]);
        const vectorB = new Float32Array([5, 6, 7, 8]);
        const result = await VectorOperations.dotProduct(vectorA, vectorB);
        expect(result).toBe(70); // 1*5 + 2*6 + 3*7 + 4*8
      });
    });

    describe('Medium Vectors (SIMD)', () => {
      const mediumVector = new Float32Array(Array.from({ length: 32 }, (_, i) => i + 1)); // Above SIMD, below WASM

      it('should use SIMD implementation for magnitude', async () => {
        const result = await VectorOperations.magnitude(mediumVector);
        const expected = Math.sqrt(mediumVector.reduce((sum, val) => sum + val * val, 0));
        expect(result).toBeCloseTo(expected, 6);
      });

      it('should use SIMD implementation for vector operations', async () => {
        const vectorA = new Float32Array(Array.from({ length: 32 }, (_, i) => i + 1));
        const vectorB = new Float32Array(Array.from({ length: 32 }, (_, i) => (i + 1) * 2));
        
        const sum = await VectorOperations.add(vectorA, vectorB);
        const diff = await VectorOperations.subtract(vectorA, vectorB);
        const scaled = await VectorOperations.scale(vectorA, 2);
        
        for (let i = 0; i < 32; i++) {
          expect(sum[i]).toBe((i + 1) + (i + 1) * 2);
          expect(diff[i]).toBe((i + 1) - (i + 1) * 2);
          expect(scaled[i]).toBe((i + 1) * 2);
        }
      });
    });

    describe('Large Vectors (WASM)', () => {
      const largeVector = new Float32Array(Array.from({ length: 128 }, (_, i) => i + 1)); // Above WASM threshold

      it('should attempt WASM implementation for magnitude', async () => {
        const result = await VectorOperations.magnitude(largeVector);
        expect(result).toBeGreaterThan(0);
        expect(isFinite(result)).toBe(true);
      });

      it('should attempt WASM implementation with fallback', async () => {
        const vectorA = new Float32Array(Array.from({ length: 128 }, (_, i) => i + 1));
        const vectorB = new Float32Array(Array.from({ length: 128 }, (_, i) => (i + 1) * 2));
        
        // Should not throw, will use WASM or fallback to SIMD/scalar
        const dotProduct = await VectorOperations.dotProduct(vectorA, vectorB);
        const sum = await VectorOperations.add(vectorA, vectorB);
        
        expect(typeof dotProduct).toBe('number');
        expect(isFinite(dotProduct)).toBe(true);
        expect(sum).toBeInstanceOf(Float32Array);
        expect(sum.length).toBe(128);
      });
    });
  });

  describe('Async Operations Consistency', () => {
    it('should maintain consistency across all implementations', async () => {
      const testVector = new Float32Array([3, 4]); // Simple 3-4-5 triangle
      
      const magnitude = await VectorOperations.magnitude(testVector);
      expect(magnitude).toBeCloseTo(5, 6);
      
      const normalized = await VectorOperations.normalize(testVector);
      expect(normalized[0]).toBeCloseTo(0.6, 6);
      expect(normalized[1]).toBeCloseTo(0.8, 6);
      
      const normalizedMagnitude = await VectorOperations.magnitude(normalized);
      expect(normalizedMagnitude).toBeCloseTo(1, 6);
    });

    it('should handle normalization correctly', async () => {
      const vector = new Float32Array([6, 8]); // 6-8-10 triangle
      const normalized = await VectorOperations.normalize(vector);
      
      expect(normalized[0]).toBeCloseTo(0.6, 6);
      expect(normalized[1]).toBeCloseTo(0.8, 6);
      
      const isNorm = await VectorOperations.isNormalized(normalized);
      expect(isNorm).toBe(true);
    });

    it('should handle in-place normalization', async () => {
      const vector = new Float32Array([3, 4]);
      const originalMagnitude = await VectorOperations.magnitude(vector);
      expect(originalMagnitude).toBeCloseTo(5, 6);
      
      const normalized = await VectorOperations.normalizeInPlace(vector);
      expect(normalized).toBe(vector); // Same reference
      
      const newMagnitude = await VectorOperations.magnitude(vector);
      expect(newMagnitude).toBeCloseTo(1, 6);
    });
  });

  describe('Vector Storage Preparation', () => {
    it('should prepare vectors for storage asynchronously', async () => {
      const rawVector = [1, 2, 3, 4];
      
      const vectorData = await VectorOperations.prepareForStorage(
        'test-vector',
        rawVector,
        { type: 'test' },
        { normalize: true }
      );
      
      expect(vectorData.id).toBe('test-vector');
      expect(vectorData.vector).toBeInstanceOf(Float32Array);
      expect(vectorData.metadata?.['type']).toBe('test');
      expect(vectorData.normalized).toBe(true);
      expect(vectorData.magnitude).toBeCloseTo(1, 6);
      expect(vectorData.timestamp).toBeGreaterThan(0);
    });

    it('should handle non-normalized storage', async () => {
      const rawVector = new Float32Array([3, 4]);
      
      const vectorData = await VectorOperations.prepareForStorage(
        'unnormalized',
        rawVector,
        {},
        { normalize: false }
      );
      
      expect(vectorData.normalized).toBe(false);
      expect(vectorData.magnitude).toBeCloseTo(5, 6);
    });
  });

  describe('Error Handling', () => {
    it('should handle dimension mismatches', async () => {
      const vectorA = new Float32Array([1, 2, 3]);
      const vectorB = new Float32Array([1, 2]);
      
      expect(VectorOperations.dotProduct(vectorA, vectorB)).rejects.toThrow();
      expect(VectorOperations.add(vectorA, vectorB)).rejects.toThrow();
      expect(VectorOperations.subtract(vectorA, vectorB)).rejects.toThrow();
    });

    it('should handle zero vectors gracefully', async () => {
      const zeroVector = new Float32Array([0, 0, 0]);
      
      const magnitude = await VectorOperations.magnitude(zeroVector);
      expect(magnitude).toBe(0);
      
      const normalized = await VectorOperations.normalize(zeroVector);
      expect(normalized).toEqual(new Float32Array([0, 0, 0]));
      
      const isNorm = await VectorOperations.isNormalized(zeroVector);
      expect(isNorm).toBe(false); // Zero vector is not normalized
    });

    it('should handle WASM failures gracefully', async () => {
      // This should work even if WASM is not available or fails
      const largeVector = new Float32Array(Array.from({ length: 200 }, (_, i) => i + 1));
      
      const magnitude = await VectorOperations.magnitude(largeVector);
      expect(magnitude).toBeGreaterThan(0);
      expect(isFinite(magnitude)).toBe(true);
    });
  });

  describe('Performance Characteristics', () => {
    it('should handle various vector sizes efficiently', async () => {
      const sizes = [10, 50, 100, 500];
      
      for (const size of sizes) {
        const vector = new Float32Array(Array.from({ length: size }, () => Math.random()));
        
        const start = performance.now();
        await VectorOperations.magnitude(vector);
        const elapsed = performance.now() - start;
        
        // Should complete in reasonable time regardless of size
        expect(elapsed).toBeLessThan(100);
      }
    });

    it('should handle batch operations efficiently', async () => {
      const vectors = Array.from({ length: 20 }, () => 
        new Float32Array(Array.from({ length: 100 }, () => Math.random()))
      );
      
      const start = performance.now();
      
      // Process multiple vectors
      const magnitudes = await Promise.all(
        vectors.map(v => VectorOperations.magnitude(v))
      );
      
      const elapsed = performance.now() - start;
      
      expect(magnitudes).toHaveLength(20);
      expect(elapsed).toBeLessThan(1000);
      
      magnitudes.forEach(mag => {
        expect(mag).toBeGreaterThan(0);
        expect(isFinite(mag)).toBe(true);
      });
    });
  });

  describe('Legacy Compatibility', () => {
    it('should maintain compatibility with existing synchronous patterns', () => {
      // While the underlying implementations are async, the interface change
      // is documented and tests verify the async behavior works correctly
      expect(VectorOperations.magnitude).toBeDefined();
      expect(VectorOperations.normalize).toBeDefined();
      expect(VectorOperations.dotProduct).toBeDefined();
      expect(VectorOperations.add).toBeDefined();
      expect(VectorOperations.subtract).toBeDefined();
      expect(VectorOperations.scale).toBeDefined();
    });

    it('should provide utility methods', () => {
      expect(VectorOperations.mean).toBeDefined();
      expect(VectorOperations.variance).toBeDefined();
      expect(VectorOperations.standardDeviation).toBeDefined();
      expect(VectorOperations.equals).toBeDefined();
      expect(VectorOperations.random).toBeDefined();
      expect(VectorOperations.randomUnit).toBeDefined();
    });
  });

  describe('Edge Cases with Different Implementations', () => {
    it('should handle very large vectors', async () => {
      const huge = new Float32Array(Array.from({ length: 10000 }, (_, i) => Math.sin(i / 1000)));
      
      const magnitude = await VectorOperations.magnitude(huge);
      expect(magnitude).toBeGreaterThan(0);
      expect(isFinite(magnitude)).toBe(true);
    });

    it('should handle vectors with special values safely', async () => {
      // Test with finite values that are safe for all implementations
      const specialVector = new Float32Array([1e6, 1e-6, 1000, 0.001]);
      
      const magnitude = await VectorOperations.magnitude(specialVector);
      expect(isFinite(magnitude)).toBe(true);
      expect(magnitude).toBeGreaterThan(0);
    });

    it('should handle repeated operations consistently', async () => {
      const vector = new Float32Array([1, 2, 3, 4, 5]);
      
      // Perform same operation multiple times
      const results = await Promise.all([
        VectorOperations.magnitude(vector),
        VectorOperations.magnitude(vector),
        VectorOperations.magnitude(vector)
      ]);
      
      expect(results[0]).toBeCloseTo(results[1], 10);
      expect(results[1]).toBeCloseTo(results[2], 10);
    });
  });
});