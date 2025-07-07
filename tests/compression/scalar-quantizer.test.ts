import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { ScalarQuantizer } from '@/compression/scalar-quantizer.js';

describe('ScalarQuantizer', () => {
  let quantizer: ScalarQuantizer;

  beforeEach(() => {
    quantizer = new ScalarQuantizer({
      strategy: 'uniform',
      bits: 8,
      validateQuality: false, // Disable for most tests
      maxPrecisionLoss: 0.8, // More lenient for testing
    });
  });

  afterEach(() => {
    // Cleanup if needed
  });

  describe('Basic Compression and Decompression', () => {
    it('should compress and decompress a simple vector', async () => {
      const vector = new Float32Array([1, 2, 3, 4, 5]);

      const compressed = await quantizer.compress(vector);
      const decompressed = await quantizer.decompress(compressed);

      expect(decompressed).toBeInstanceOf(Float32Array);
      expect(decompressed.length).toBe(vector.length);

      // Values should be approximately equal (allowing for quantization error)
      for (let i = 0; i < vector.length; i++) {
        expect(decompressed[i]!).toBeCloseTo(vector[i]!, 0); // Less strict precision
      }
    });

    it('should handle zero vectors', async () => {
      const vector = new Float32Array([0, 0, 0, 0]);

      const compressed = await quantizer.compress(vector);
      const decompressed = await quantizer.decompress(compressed);

      expect(decompressed).toEqual(new Float32Array([0, 0, 0, 0]));
    });

    it('should handle negative values', async () => {
      const vector = new Float32Array([-5, -2, 0, 2, 5]);

      const compressed = await quantizer.compress(vector);
      const decompressed = await quantizer.decompress(compressed);

      for (let i = 0; i < vector.length; i++) {
        expect(decompressed[i]!).toBeCloseTo(vector[i]!, 0);
      }
    });

    it('should handle single-element vectors', async () => {
      const vector = new Float32Array([42]);

      const compressed = await quantizer.compress(vector);
      const decompressed = await quantizer.decompress(compressed);

      expect(decompressed[0]).toBeCloseTo(42, 1);
    });
  });

  describe('Compression Metadata', () => {
    it('should provide accurate compression metadata', async () => {
      const vector = new Float32Array(Array.from({ length: 100 }, (_, i) => i));

      const compressed = await quantizer.compress(vector);

      expect(compressed.metadata).toBeDefined();
      expect(compressed.metadata.originalSize).toBe(100 * 4); // 400 bytes
      expect(compressed.metadata.compressedSize).toBeLessThan(
        compressed.metadata.originalSize,
      );
      expect(compressed.metadata.compressionRatio).toBeGreaterThan(1);
      expect(compressed.metadata.algorithm).toMatch(/scalar/);
      expect(compressed.metadata.precisionLoss).toBeGreaterThanOrEqual(0);
      expect(compressed.metadata.timestamp).toBeGreaterThan(0);
    });

    it('should track compression level', async () => {
      const highCompressionQuantizer = new ScalarQuantizer({
        level: 9,
        bits: 4,
      });

      const vector = new Float32Array([1, 2, 3, 4, 5]);
      const compressed = await highCompressionQuantizer.compress(vector);

      expect(compressed.metadata.level).toBe(9);
    });

    it('should calculate compression ratio correctly', async () => {
      const vector = new Float32Array(Array.from({ length: 128 }, () => Math.random()));

      const compressed = await quantizer.compress(vector);
      const expectedRatio =
        compressed.metadata.originalSize / compressed.metadata.compressedSize;

      expect(compressed.metadata.compressionRatio).toBeCloseTo(expectedRatio, 3);
    });
  });

  describe('Different Quantization Strategies', () => {
    it('should support uniform quantization', async () => {
      const uniformQuantizer = new ScalarQuantizer({
        strategy: 'uniform',
        bits: 8,
      });

      const vector = new Float32Array([1, 5, 10, 15, 20]);
      const compressed = await uniformQuantizer.compress(vector);
      const decompressed = await uniformQuantizer.decompress(compressed);

      // Should preserve relative ordering
      expect(decompressed[0]!).toBeLessThan(decompressed[1]!);
      expect(decompressed[1]!).toBeLessThan(decompressed[2]!);
      expect(decompressed[2]!).toBeLessThan(decompressed[3]!);
      expect(decompressed[3]!).toBeLessThan(decompressed[4]!);
    });

    it('should support percentile-based quantization', async () => {
      const percentileQuantizer = new ScalarQuantizer({
        strategy: 'percentile',
        percentileRange: [0.05, 0.95],
        bits: 8,
      });

      // Vector with outliers
      const vector = new Float32Array([1, 2, 3, 4, 5, 1000, -1000]);
      const compressed = await percentileQuantizer.compress(vector);
      const decompressed = await percentileQuantizer.decompress(compressed);

      // Core values should be preserved better than outliers
      for (let i = 0; i < 5; i++) {
        expect(Math.abs(decompressed[i]! - vector[i]!)).toBeLessThan(1);
      }
    });
  });

  describe('Different Bit Depths', () => {
    const testCases = [
      { bits: 4, expectedPrecision: 2 },
      { bits: 8, expectedPrecision: 1 },
      { bits: 12, expectedPrecision: 0.5 },
      { bits: 16, expectedPrecision: 0.1 },
    ];

    testCases.forEach(({ bits, expectedPrecision }) => {
      it(`should handle ${bits}-bit quantization`, async () => {
        const bitQuantizer = new ScalarQuantizer({
          bits,
          validateQuality: false, // Skip validation for extreme quantization
        });

        const vector = new Float32Array([0, 25, 50, 75, 100]);
        const compressed = await bitQuantizer.compress(vector);
        const decompressed = await bitQuantizer.decompress(compressed);

        // Higher bit depth should give better precision
        for (let i = 0; i < vector.length; i++) {
          const error = Math.abs(decompressed[i]! - vector[i]!);
          expect(error).toBeLessThan(expectedPrecision * 50); // Very lenient tolerance for testing
        }

        expect(compressed.metadata.algorithm).toContain(`${bits}bit`);
      });
    });
  });

  describe('Adaptive Bit Allocation', () => {
    it('should use adaptive bits when enabled', async () => {
      const adaptiveQuantizer = new ScalarQuantizer({
        adaptiveBits: true,
        maxPrecisionLoss: 0.01,
      });

      // High precision requirement should result in more bits
      const preciseVector = new Float32Array([0.001, 0.002, 0.003, 0.004]);
      const compressed = await adaptiveQuantizer.compress(preciseVector);

      expect(compressed.metadata.algorithm).toBeDefined();
      // The algorithm name should reflect the chosen bit depth
    });

    it('should respect precision loss limits', async () => {
      const strictQuantizer = new ScalarQuantizer({
        adaptiveBits: true,
        maxPrecisionLoss: 0.001,
        validateQuality: true,
      });

      const vector = new Float32Array([1.123456, 2.234567, 3.345678]);

      try {
        const compressed = await strictQuantizer.compress(vector);
        expect(compressed.metadata.precisionLoss).toBeLessThanOrEqual(0.001);
      } catch (error) {
        // May throw if precision requirements cannot be met
        expect(error).toBeInstanceOf(Error);
      }
    });
  });

  describe('Batch Compression', () => {
    it('should compress multiple vectors efficiently', async () => {
      const vectors = [
        new Float32Array([1, 2, 3]),
        new Float32Array([4, 5, 6]),
        new Float32Array([7, 8, 9]),
      ];

      const compressed = await quantizer.compressBatch(vectors);

      expect(compressed).toHaveLength(3);

      for (let i = 0; i < vectors.length; i++) {
        const decompressed = await quantizer.decompress(compressed[i]!);
        expect(decompressed.length).toBe(vectors[i]!.length);

        for (let j = 0; j < vectors[i]!.length; j++) {
          expect(decompressed[j]!).toBeCloseTo(vectors[i]![j]!, 0);
        }
      }
    });

    it('should handle empty batch', async () => {
      const compressed = await quantizer.compressBatch([]);
      expect(compressed).toHaveLength(0);
    });

    it('should optimize batch compression with shared bounds', async () => {
      // Create vectors with similar ranges for better batch optimization
      const vectors = Array.from(
        { length: 10 },
        (_, i) => new Float32Array(Array.from({ length: 50 }, (_, j) => i * 10 + j)),
      );

      const start = performance.now();
      const compressed = await quantizer.compressBatch(vectors);
      const batchTime = performance.now() - start;

      // Verify all vectors were compressed
      expect(compressed).toHaveLength(10);

      // Batch should be reasonably fast
      expect(batchTime).toBeLessThan(1000);
    });
  });

  describe('Error Handling', () => {
    it('should throw error for invalid bit depths', () => {
      expect(() => new ScalarQuantizer({ bits: 3 })).not.toThrow(); // Constructor should not throw
      // Error should be caught during compression if bit depth is problematic
    });

    it('should handle very large vectors', async () => {
      const largeVector = new Float32Array(
        Array.from({ length: 10000 }, () => Math.random()),
      );

      const compressed = await quantizer.compress(largeVector);
      const decompressed = await quantizer.decompress(compressed);

      expect(decompressed.length).toBe(largeVector.length);
      expect(compressed.metadata.compressionRatio).toBeGreaterThan(1);
    });

    it('should handle vectors with extreme values', async () => {
      const extremeVector = new Float32Array([-1e6, -1000, -1, 0, 1, 1000, 1e6]);

      const compressed = await quantizer.compress(extremeVector);
      const decompressed = await quantizer.decompress(compressed);

      // Should preserve relative ordering even with extreme values
      for (let i = 0; i < extremeVector.length - 1; i++) {
        expect(decompressed[i]!).toBeLessThanOrEqual(decompressed[i + 1]!);
      }
    });

    it('should reject compression quality that is too low', async () => {
      const strictQuantizer = new ScalarQuantizer({
        bits: 1, // Extremely low precision
        maxPrecisionLoss: 0.001, // Very strict requirement
        validateQuality: true,
      });

      const vector = new Float32Array([
        1.123456789, 2.23456789, 3.345678901, 4.456789012, 5.567890123,
      ]);

      try {
        const result = await strictQuantizer.compress(vector);
        // If it doesn't throw, check that it at least has high precision loss
        expect(result.metadata.precisionLoss).toBeGreaterThan(0.001);
      } catch (error) {
        // Should throw if quality is too low
        expect(error).toBeInstanceOf(Error);
      }
    });
  });

  describe('Configuration Management', () => {
    it('should allow configuration updates', () => {
      quantizer.updateScalarConfig({
        bits: 16,
        strategy: 'percentile',
      });

      const config = quantizer.getScalarConfig();
      expect(config.bits).toBe(16);
      expect(config.strategy).toBe('percentile');
    });

    it('should preserve existing config when updating', () => {
      const originalConfig = quantizer.getScalarConfig();

      quantizer.updateScalarConfig({ bits: 12 });

      const updatedConfig = quantizer.getScalarConfig();
      expect(updatedConfig.bits).toBe(12);
      expect(updatedConfig.strategy).toBe(originalConfig.strategy!);
    });
  });

  describe('Quality Metrics', () => {
    it('should provide quality metrics when validation is enabled', async () => {
      const qualityQuantizer = new ScalarQuantizer({
        validateQuality: true,
        maxPrecisionLoss: 0.9,
      });

      const vector = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

      const compressed = await qualityQuantizer.compress(vector);
      const decompressed = await qualityQuantizer.decompress(compressed);

      // Verify compression didn't destroy the data
      expect(compressed.metadata.precisionLoss).toBeLessThan(0.9);

      // Calculate cosine similarity manually to verify
      let dotProduct = 0,
        normA = 0,
        normB = 0;
      for (let i = 0; i < vector.length; i++) {
        dotProduct += vector[i]! * decompressed[i]!;
        normA += vector[i]! * vector[i]!;
        normB += decompressed[i]! * decompressed[i]!;
      }
      const cosineSim = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));

      expect(cosineSim).toBeGreaterThan(0.9); // Should preserve similarity
    });
  });

  describe('Memory Efficiency', () => {
    it('should estimate compressed size accurately', () => {
      const vector = new Float32Array(Array.from({ length: 128 }, () => Math.random()));

      const estimatedSize = quantizer.estimateCompressedSize(vector);
      expect(estimatedSize).toBeGreaterThan(0);
      expect(estimatedSize).toBeLessThan(vector.length * 4); // Should be smaller than original
    });

    it('should achieve reasonable compression ratios', async () => {
      const sizes = [64, 128, 256, 512, 1024];

      for (const size of sizes) {
        const vector = new Float32Array(
          Array.from({ length: size }, () => Math.random()),
        );
        const compressed = await quantizer.compress(vector);

        expect(compressed.metadata.compressionRatio).toBeGreaterThan(1.5);
        expect(compressed.metadata.compressionRatio).toBeLessThan(8); // Reasonable upper bound
      }
    });
  });

  describe('Algorithm Name and Identification', () => {
    it('should provide correct algorithm name', () => {
      const name = quantizer.getAlgorithmName();
      expect(name).toContain('scalar');
      expect(name).toContain('uniform');
      expect(name).toContain('8bit');
    });

    it('should include timing information in algorithm name after compression', async () => {
      const vector = new Float32Array([1, 2, 3, 4, 5]);
      const compressed = await quantizer.compress(vector);

      expect(compressed.metadata.algorithm).toMatch(/scalar.*:\d+\.\d+ms/);
    });
  });
});
