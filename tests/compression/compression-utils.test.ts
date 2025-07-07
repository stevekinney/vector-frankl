import { describe, expect, it } from 'bun:test';

import {
  calculateBatchStatistics,
  calculateOptimalBits,
  calculateQuantizationBounds,
  calculateVectorStatistics,
  createQuantizedArray,
  dequantizeValue,
  estimateMemoryUsage,
  packQuantizedValues,
  quantizeValue,
  unpackQuantizedValues,
} from '../../src/compression/compression-utils.js';

describe('Compression Utils', () => {
  describe('Vector Statistics', () => {
    it('should calculate basic statistics for a vector', () => {
      const vector = new Float32Array([1, 2, 3, 4, 5]);
      const stats = calculateVectorStatistics(vector);

      expect(stats.min).toBe(1);
      expect(stats.max).toBe(5);
      expect(stats.mean).toBe(3);
      expect(stats.range).toBe(4);
      expect(stats.std).toBeCloseTo(Math.sqrt(2), 3);
    });

    it('should handle single-element vectors', () => {
      const vector = new Float32Array([42]);
      const stats = calculateVectorStatistics(vector);

      expect(stats.min).toBe(42);
      expect(stats.max).toBe(42);
      expect(stats.mean).toBe(42);
      expect(stats.range).toBe(0);
      expect(stats.std).toBe(0);
    });

    it('should handle negative values', () => {
      const vector = new Float32Array([-5, -3, -1, 1, 3, 5]);
      const stats = calculateVectorStatistics(vector);

      expect(stats.min).toBe(-5);
      expect(stats.max).toBe(5);
      expect(stats.mean).toBe(0);
      expect(stats.range).toBe(10);
    });

    it('should handle zero vectors', () => {
      const vector = new Float32Array([0, 0, 0, 0]);
      const stats = calculateVectorStatistics(vector);

      expect(stats.min).toBe(0);
      expect(stats.max).toBe(0);
      expect(stats.mean).toBe(0);
      expect(stats.range).toBe(0);
      expect(stats.std).toBe(0);
    });
  });

  describe('Batch Statistics', () => {
    it('should calculate statistics for multiple vectors', () => {
      const vectors = [
        new Float32Array([1, 2, 3]),
        new Float32Array([4, 5, 6]),
        new Float32Array([7, 8, 9]),
      ];

      const stats = calculateBatchStatistics(vectors);

      expect(stats.min).toBe(1);
      expect(stats.max).toBe(9);
      expect(stats.mean).toBe(5);
      expect(stats.range).toBe(8);
      expect(stats.dimensions).toHaveLength(3);
    });

    it('should provide per-dimension statistics', () => {
      const vectors = [
        new Float32Array([1, 10, 100]),
        new Float32Array([2, 20, 200]),
        new Float32Array([3, 30, 300]),
      ];

      const stats = calculateBatchStatistics(vectors);

      // Dimension 0: [1, 2, 3]
      expect(stats.dimensions![0]!.min).toBe(1);
      expect(stats.dimensions![0]!.max).toBe(3);
      expect(stats.dimensions![0]!.mean).toBe(2);

      // Dimension 1: [10, 20, 30]
      expect(stats.dimensions![1]!.min).toBe(10);
      expect(stats.dimensions![1]!.max).toBe(30);
      expect(stats.dimensions![1]!.mean).toBe(20);

      // Dimension 2: [100, 200, 300]
      expect(stats.dimensions![2]!.min).toBe(100);
      expect(stats.dimensions![2]!.max).toBe(300);
      expect(stats.dimensions![2]!.mean).toBe(200);
    });

    it('should handle empty vector array', () => {
      expect(() => calculateBatchStatistics([])).toThrow();
    });

    it('should handle dimension mismatches', () => {
      const vectors = [
        new Float32Array([1, 2, 3]),
        new Float32Array([4, 5]), // Different dimension
      ];

      expect(() => calculateBatchStatistics(vectors)).toThrow();
    });
  });

  describe('Quantization Bounds', () => {
    const vectors = [
      new Float32Array([1, 2, 3]),
      new Float32Array([4, 5, 6]),
      new Float32Array([7, 8, 9]),
    ];

    it('should calculate global bounds', () => {
      const bounds = calculateQuantizationBounds(vectors, 'global');

      expect(bounds.globalMin).toBe(1);
      expect(bounds.globalMax).toBe(9);
      expect(bounds.dimensionBounds).toBeUndefined();
      expect(bounds.percentileBounds).toBeUndefined();
    });

    it('should calculate per-dimension bounds', () => {
      const bounds = calculateQuantizationBounds(vectors, 'per-dimension');

      expect(bounds.globalMin).toBe(1);
      expect(bounds.globalMax).toBe(9);
      expect(bounds.dimensionBounds).toHaveLength(3);

      expect(bounds.dimensionBounds![0]!).toEqual({ min: 1, max: 7 });
      expect(bounds.dimensionBounds![1]!).toEqual({ min: 2, max: 8 });
      expect(bounds.dimensionBounds![2]!).toEqual({ min: 3, max: 9 });
    });

    it('should calculate percentile bounds', () => {
      const bounds = calculateQuantizationBounds(vectors, 'percentile', [0.1, 0.9]);

      expect(bounds.globalMin).toBe(1);
      expect(bounds.globalMax).toBe(9);
      expect(bounds.percentileBounds).toBeDefined();
      expect(bounds.percentileBounds!.min).toBeGreaterThanOrEqual(1);
      expect(bounds.percentileBounds!.max).toBeLessThanOrEqual(9);
    });
  });

  describe('Value Quantization', () => {
    it('should quantize values correctly', () => {
      // Test 8-bit quantization of 0-10 range
      expect(quantizeValue(0, 0, 10, 8)).toBe(0);
      expect(quantizeValue(5, 0, 10, 8)).toBe(128); // Middle value
      expect(quantizeValue(10, 0, 10, 8)).toBe(255);
    });

    it('should handle edge cases', () => {
      // Value outside range should be clamped
      expect(quantizeValue(-1, 0, 10, 8)).toBe(0);
      expect(quantizeValue(11, 0, 10, 8)).toBe(255);

      // Zero range
      expect(quantizeValue(5, 5, 5, 8)).toBe(0);
    });

    it('should work with different bit depths', () => {
      const testCases = [
        { bits: 1, levels: 1 },
        { bits: 2, levels: 3 },
        { bits: 4, levels: 15 },
        { bits: 8, levels: 255 },
      ];

      testCases.forEach(({ bits, levels }) => {
        const quantized = quantizeValue(1, 0, 1, bits);
        expect(quantized).toBeLessThanOrEqual(levels);
        expect(quantized).toBeGreaterThanOrEqual(0);
      });
    });
  });

  describe('Value Dequantization', () => {
    it('should dequantize values correctly', () => {
      // Test 8-bit dequantization
      expect(dequantizeValue(0, 0, 10, 8)).toBeCloseTo(0, 3);
      expect(dequantizeValue(127, 0, 10, 8)).toBeCloseTo(4.98, 1);
      expect(dequantizeValue(255, 0, 10, 8)).toBeCloseTo(10, 3);
    });

    it('should be inverse of quantization', () => {
      const original = 7.3;
      const quantized = quantizeValue(original, 0, 10, 8);
      const dequantized = dequantizeValue(quantized, 0, 10, 8);

      expect(dequantized).toBeCloseTo(original, 1);
    });

    it('should handle zero range', () => {
      expect(dequantizeValue(100, 5, 5, 8)).toBe(5);
    });
  });

  describe('Optimal Bits Calculation', () => {
    it('should calculate reasonable bit depths', () => {
      const preciseVector = new Float32Array([1.001, 1.002, 1.003]);
      const roughVector = new Float32Array([1, 10, 100]);

      const preciseBits = calculateOptimalBits(preciseVector, 0.001);
      const roughBits = calculateOptimalBits(roughVector, 0.1);

      expect(preciseBits).toBeGreaterThan(roughBits);
      expect(preciseBits).toBeGreaterThanOrEqual(4);
      expect(preciseBits).toBeLessThanOrEqual(16);
    });

    it('should consider target precision loss', () => {
      const vector = new Float32Array([1, 2, 3, 4, 5]);

      const highPrecision = calculateOptimalBits(vector, 0.001);
      const lowPrecision = calculateOptimalBits(vector, 0.1);

      expect(highPrecision).toBeGreaterThanOrEqual(lowPrecision);
    });

    it('should consider dynamic range', () => {
      const smallRange = new Float32Array([1, 1.1, 1.2]);
      const largeRange = new Float32Array([1, 100, 1000]);

      const smallBits = calculateOptimalBits(smallRange, 0.05);
      const largeBits = calculateOptimalBits(largeRange, 0.05);

      expect(largeBits).toBeGreaterThanOrEqual(smallBits);
    });
  });

  describe('Memory Usage Estimation', () => {
    it('should estimate memory usage correctly', () => {
      // 100 dimensions * 8 bits = 800 bits = 100 bytes
      const usage = estimateMemoryUsage(100, 8, false);
      expect(usage).toBe(100);
    });

    it('should include bounds when requested', () => {
      const withoutBounds = estimateMemoryUsage(100, 8, false);
      const withBounds = estimateMemoryUsage(100, 8, true);

      expect(withBounds).toBeGreaterThan(withoutBounds);
      expect(withBounds - withoutBounds).toBe(8); // 2 * Float32
    });

    it('should handle non-byte-aligned bit counts', () => {
      // 100 dimensions * 6 bits = 600 bits = 75 bytes
      const usage = estimateMemoryUsage(100, 6, false);
      expect(usage).toBe(76); // Rounded up to 4-byte alignment
    });
  });

  describe('Quantized Array Creation', () => {
    it('should create appropriately sized arrays', () => {
      const buffer = createQuantizedArray(100, 8);
      expect(buffer.byteLength).toBe(100); // 100 * 8 bits / 8 = 100 bytes
    });

    it('should handle non-byte-aligned sizes', () => {
      const buffer = createQuantizedArray(10, 6);
      expect(buffer.byteLength).toBe(8); // 10 * 6 bits = 60 bits = 8 bytes (rounded up)
    });
  });

  describe('Value Packing and Unpacking', () => {
    it('should pack and unpack 8-bit values correctly', () => {
      const values = [0, 127, 255, 64, 192];
      const buffer = createQuantizedArray(values.length, 8);

      packQuantizedValues(values, 8, buffer);
      const unpacked = unpackQuantizedValues(buffer, values.length, 8);

      expect(unpacked).toEqual(values);
    });

    it('should pack and unpack 4-bit values correctly', () => {
      const values = [0, 7, 15, 3, 12];
      const buffer = createQuantizedArray(values.length, 4);

      packQuantizedValues(values, 4, buffer);
      const unpacked = unpackQuantizedValues(buffer, values.length, 4);

      expect(unpacked).toEqual(values);
    });

    it('should handle odd bit sizes', () => {
      const values = [0, 1, 2, 3, 4, 5, 6, 7]; // 3-bit values
      const buffer = createQuantizedArray(values.length, 3);

      packQuantizedValues(values, 3, buffer);
      const unpacked = unpackQuantizedValues(buffer, values.length, 3);

      expect(unpacked).toEqual(values);
    });

    it('should handle single bit values', () => {
      const values = [0, 1, 1, 0, 1];
      const buffer = createQuantizedArray(values.length, 1);

      packQuantizedValues(values, 1, buffer);
      const unpacked = unpackQuantizedValues(buffer, values.length, 1);

      expect(unpacked).toEqual(values);
    });

    it('should handle large arrays efficiently', () => {
      const values = Array.from({ length: 1000 }, (_, i) => i % 256);
      const buffer = createQuantizedArray(values.length, 8);

      const start = performance.now();
      packQuantizedValues(values, 8, buffer);
      const unpacked = unpackQuantizedValues(buffer, values.length, 8);
      const elapsed = performance.now() - start;

      expect(unpacked).toEqual(values);
      expect(elapsed).toBeLessThan(100); // Should be fast
    });

    it('should maintain precision across pack/unpack cycles', () => {
      const testCases = [
        { bits: 1, maxValue: 1 },
        { bits: 2, maxValue: 3 },
        { bits: 4, maxValue: 15 },
        { bits: 8, maxValue: 255 },
        { bits: 12, maxValue: 4095 },
      ];

      testCases.forEach(({ bits, maxValue }) => {
        const values = Array.from({ length: 20 }, (_, i) => i % (maxValue + 1));
        const buffer = createQuantizedArray(values.length, bits);

        packQuantizedValues(values, bits, buffer);
        const unpacked = unpackQuantizedValues(buffer, values.length, bits);

        expect(unpacked).toEqual(values);
      });
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle empty arrays', () => {
      const buffer = createQuantizedArray(0, 8);
      expect(buffer.byteLength).toBe(0);

      packQuantizedValues([], 8, buffer);
      const unpacked = unpackQuantizedValues(buffer, 0, 8);
      expect(unpacked).toEqual([]);
    });

    it('should handle maximum bit depths', () => {
      const values = [0, 32767, 65535]; // 16-bit values
      const buffer = createQuantizedArray(values.length, 16);

      packQuantizedValues(values, 16, buffer);
      const unpacked = unpackQuantizedValues(buffer, values.length, 16);

      expect(unpacked).toEqual(values);
    });

    it('should handle buffer boundaries correctly', () => {
      // Test case that stresses byte boundaries
      const values = [7, 6, 5, 4, 3, 2, 1, 0, 7, 6]; // 3-bit values
      const buffer = createQuantizedArray(values.length, 3);

      packQuantizedValues(values, 3, buffer);
      const unpacked = unpackQuantizedValues(buffer, values.length, 3);

      expect(unpacked).toEqual(values);
    });
  });
});
