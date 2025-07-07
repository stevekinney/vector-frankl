import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { VectorOperations } from '@/vectors/operations.js';

describe('VectorOperations SIMD Integration', () => {
  const smallVector = new Float32Array([1, 2, 3, 4]); // Below threshold
  const largeVector = new Float32Array(Array.from({ length: 32 }, (_, i) => i + 1)); // Above threshold

  beforeAll(() => {
    // Ensure SIMD is enabled for testing
    VectorOperations.setSIMDEnabled(true);
    VectorOperations.setSIMDThreshold(16); // Standard threshold
  });

  afterAll(() => {
    // Reset to defaults
    VectorOperations.setSIMDEnabled(true);
    VectorOperations.setSIMDThreshold(16);
  });

  describe('SIMD Configuration', () => {
    it('should enable/disable SIMD optimizations', () => {
      VectorOperations.setSIMDEnabled(false);
      expect(VectorOperations.isSIMDEnabled()).toBe(false);
      
      VectorOperations.setSIMDEnabled(true);
      expect(VectorOperations.isSIMDEnabled()).toBe(true);
    });

    it('should set SIMD threshold', () => {
      VectorOperations.setSIMDThreshold(32);
      
      // Test with vector below new threshold
      const result = VectorOperations.magnitude(largeVector);
      expect(result).toBeGreaterThan(0);
      
      // Reset
      VectorOperations.setSIMDThreshold(16);
    });
  });

  describe('Magnitude with SIMD', () => {
    it('should calculate magnitude for small vectors (scalar)', () => {
      const result = VectorOperations.magnitude(smallVector);
      const expected = Math.sqrt(1 + 4 + 9 + 16); // sqrt(30)
      expect(result).toBeCloseTo(expected, 6);
    });

    it('should calculate magnitude for large vectors (SIMD)', () => {
      const result = VectorOperations.magnitude(largeVector);
      const expected = Math.sqrt(largeVector.reduce((sum, val) => sum + val * val, 0));
      expect(result).toBeCloseTo(expected, 6);
    });
  });

  describe('Normalization with SIMD', () => {
    it('should normalize small vectors (scalar)', async () => {
      const result = await VectorOperations.normalize(smallVector);
      const magnitude = await VectorOperations.magnitude(result);
      expect(magnitude).toBeCloseTo(1, 6);
    });

    it('should normalize large vectors (SIMD)', async () => {
      const result = await VectorOperations.normalize(largeVector);
      const magnitude = await VectorOperations.magnitude(result);
      expect(magnitude).toBeCloseTo(1, 6);
    });

    it('should handle zero vectors', async () => {
      const zeroVector = new Float32Array([0, 0, 0, 0]);
      const result = await VectorOperations.normalize(zeroVector);
      expect(result).toEqual(new Float32Array([0, 0, 0, 0]));
    });
  });

  describe('Dot Product with SIMD', () => {
    it('should calculate dot product for small vectors (scalar)', async () => {
      const vectorA = new Float32Array([1, 2, 3, 4]);
      const vectorB = new Float32Array([5, 6, 7, 8]);
      const result = await VectorOperations.dotProduct(vectorA, vectorB);
      const expected = 1*5 + 2*6 + 3*7 + 4*8; // 70
      expect(result).toBe(expected);
    });

    it('should calculate dot product for large vectors (SIMD)', async () => {
      const vectorA = new Float32Array(Array.from({ length: 32 }, (_, i) => i + 1));
      const vectorB = new Float32Array(Array.from({ length: 32 }, (_, i) => (i + 1) * 2));
      const result = await VectorOperations.dotProduct(vectorA, vectorB);
      
      // Manual calculation
      let expected = 0;
      for (let i = 0; i < 32; i++) {
        expected += (i + 1) * ((i + 1) * 2);
      }
      expect(result).toBe(expected);
    });

    it('should throw error for mismatched dimensions', () => {
      const vectorA = new Float32Array([1, 2, 3]);
      const vectorB = new Float32Array([1, 2]);
      expect(() => VectorOperations.dotProduct(vectorA, vectorB)).toThrow();
    });
  });

  describe('Vector Addition with SIMD', () => {
    it('should add small vectors (scalar)', async () => {
      const vectorA = new Float32Array([1, 2, 3, 4]);
      const vectorB = new Float32Array([5, 6, 7, 8]);
      const result = await VectorOperations.add(vectorA, vectorB);
      const expected = new Float32Array([6, 8, 10, 12]);
      expect(result).toEqual(expected);
    });

    it('should add large vectors (SIMD)', async () => {
      const vectorA = new Float32Array(Array.from({ length: 32 }, (_, i) => i + 1));
      const vectorB = new Float32Array(Array.from({ length: 32 }, (_, i) => (i + 1) * 2));
      const result = await VectorOperations.add(vectorA, vectorB);
      
      for (let i = 0; i < 32; i++) {
        expect(result[i]!).toBe((i + 1) + (i + 1) * 2);
      }
    });

    it('should throw error for mismatched dimensions', () => {
      const vectorA = new Float32Array([1, 2, 3]);
      const vectorB = new Float32Array([1, 2]);
      expect(() => VectorOperations.add(vectorA, vectorB)).toThrow();
    });
  });

  describe('Vector Subtraction with SIMD', () => {
    it('should subtract small vectors (scalar)', async () => {
      const vectorA = new Float32Array([5, 6, 7, 8]);
      const vectorB = new Float32Array([1, 2, 3, 4]);
      const result = await VectorOperations.subtract(vectorA, vectorB);
      const expected = new Float32Array([4, 4, 4, 4]);
      expect(result).toEqual(expected);
    });

    it('should subtract large vectors (SIMD)', async () => {
      const vectorA = new Float32Array(Array.from({ length: 32 }, (_, i) => (i + 1) * 3));
      const vectorB = new Float32Array(Array.from({ length: 32 }, (_, i) => i + 1));
      const result = await VectorOperations.subtract(vectorA, vectorB);
      
      for (let i = 0; i < 32; i++) {
        expect(result[i]!).toBe((i + 1) * 3 - (i + 1));
      }
    });

    it('should throw error for mismatched dimensions', () => {
      const vectorA = new Float32Array([1, 2, 3]);
      const vectorB = new Float32Array([1, 2]);
      expect(() => VectorOperations.subtract(vectorA, vectorB)).toThrow();
    });
  });

  describe('Vector Scaling with SIMD', () => {
    it('should scale small vectors (scalar)', async () => {
      const vector = new Float32Array([1, 2, 3, 4]);
      const scalar = 2.5;
      const result = await VectorOperations.scale(vector, scalar);
      const expected = new Float32Array([2.5, 5, 7.5, 10]);
      expect(result).toEqual(expected);
    });

    it('should scale large vectors (SIMD)', async () => {
      const vector = new Float32Array(Array.from({ length: 32 }, (_, i) => i + 1));
      const scalar = 3;
      const result = await VectorOperations.scale(vector, scalar);
      
      for (let i = 0; i < 32; i++) {
        expect(result[i]!).toBe((i + 1) * 3);
      }
    });

    it('should handle zero scaling', async () => {
      const vector = new Float32Array([1, 2, 3, 4]);
      const result = await VectorOperations.scale(vector, 0);
      const expected = new Float32Array([0, 0, 0, 0]);
      expect(result).toEqual(expected);
    });
  });

  describe('SIMD vs Scalar Consistency', () => {
    it('should produce identical results for magnitude calculation', async () => {
      const testVector = new Float32Array(Array.from({ length: 32 }, () => Math.random()));
      
      // Force scalar calculation
      VectorOperations.setSIMDThreshold(1000);
      const scalarResult = await VectorOperations.magnitude(testVector);
      
      // Force SIMD calculation
      VectorOperations.setSIMDThreshold(16);
      const simdResult = await VectorOperations.magnitude(testVector);
      
      expect(simdResult).toBeCloseTo(scalarResult, 6);
    });

    it('should produce identical results for dot product calculation', async () => {
      const vectorA = new Float32Array(Array.from({ length: 32 }, () => Math.random()));
      const vectorB = new Float32Array(Array.from({ length: 32 }, () => Math.random()));
      
      // Force scalar calculation
      VectorOperations.setSIMDThreshold(1000);
      const scalarResult = await VectorOperations.dotProduct(vectorA, vectorB);
      
      // Force SIMD calculation
      VectorOperations.setSIMDThreshold(16);
      const simdResult = await VectorOperations.dotProduct(vectorA, vectorB);
      
      expect(simdResult).toBeCloseTo(scalarResult, 6);
    });

    it('should produce identical results for vector operations', async () => {
      const vectorA = new Float32Array(Array.from({ length: 32 }, () => Math.random()));
      const vectorB = new Float32Array(Array.from({ length: 32 }, () => Math.random()));
      const scalar = Math.random() * 10;
      
      // Force scalar calculation
      VectorOperations.setSIMDThreshold(1000);
      const scalarAdd = await VectorOperations.add(vectorA, vectorB);
      const scalarSub = await VectorOperations.subtract(vectorA, vectorB);
      const scalarScale = await VectorOperations.scale(vectorA, scalar);
      
      // Force SIMD calculation
      VectorOperations.setSIMDThreshold(16);
      const simdAdd = await VectorOperations.add(vectorA, vectorB);
      const simdSub = await VectorOperations.subtract(vectorA, vectorB);
      const simdScale = await VectorOperations.scale(vectorA, scalar);
      
      // Compare results
      for (let i = 0; i < 32; i++) {
        expect(simdAdd[i]!).toBeCloseTo(scalarAdd[i]!, 6);
        expect(simdSub[i]!).toBeCloseTo(scalarSub[i]!, 6);
        expect(simdScale[i]!).toBeCloseTo(scalarScale[i]!, 6);
      }
    });
  });

  describe('Performance Characteristics', () => {
    it('should handle large vectors efficiently', async () => {
      const largeVectorA = new Float32Array(Array.from({ length: 1000 }, () => Math.random()));
      const largeVectorB = new Float32Array(Array.from({ length: 1000 }, () => Math.random()));
      
      const start = performance.now();
      
      // Perform multiple operations
      for (let i = 0; i < 100; i++) {
        await VectorOperations.dotProduct(largeVectorA, largeVectorB);
        await VectorOperations.add(largeVectorA, largeVectorB);
        await VectorOperations.magnitude(largeVectorA);
      }
      
      const elapsed = performance.now() - start;
      
      // Should complete in reasonable time (less than 1 second)
      expect(elapsed).toBeLessThan(1000);
    });

    it('should handle edge cases gracefully', async () => {
      // Empty vectors
      const emptyA = new Float32Array(0);
      const emptyB = new Float32Array(0);
      expect(await VectorOperations.dotProduct(emptyA, emptyB)).toBe(0);
      
      // Single element vectors
      const singleA = new Float32Array([5]);
      const singleB = new Float32Array([3]);
      expect(await VectorOperations.dotProduct(singleA, singleB)).toBe(15);
      
      // Very large vectors
      const hugeSizes = [2048, 4096];
      for (const size of hugeSizes) {
        const hugeA = new Float32Array(Array.from({ length: size }, (_, i) => i));
        const hugeB = new Float32Array(Array.from({ length: size }, (_, i) => i + 1));
        
        const result = await VectorOperations.dotProduct(hugeA, hugeB);
        expect(result).toBeGreaterThan(0);
        expect(isFinite(result)).toBe(true);
      }
    });
  });
});