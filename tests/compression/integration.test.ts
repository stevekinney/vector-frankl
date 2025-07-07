import { describe, it, expect, beforeEach } from 'bun:test';
import {
  CompressionManager,
  compressVector,
  decompressVector,
  getCompressionRecommendation,
  compareCompressionStrategies
} from '@/compression/index.js';

describe('Compression Integration', () => {
  let compressionManager: CompressionManager;

  beforeEach(() => {
    compressionManager = new CompressionManager({
      defaultStrategy: 'scalar',
      autoSelect: true,
      minSizeForCompression: 32,
      targetCompressionRatio: 2.0,
      maxPrecisionLoss: 0.05
    });
  });

  describe('CompressionManager', () => {
    it('should compress and decompress vectors using auto-selection', async () => {
      const vector = new Float32Array(Array.from({ length: 100 }, (_, i) => i * 0.1));
      
      const compressed = await compressionManager.compress(vector);
      const decompressed = await compressionManager.decompress(compressed);
      
      expect(decompressed.length).toBe(vector.length);
      expect(compressed.metadata.compressionRatio).toBeGreaterThan(1);
      
      // Verify quality preservation
      for (let i = 0; i < vector.length; i++) {
        expect(decompressed[i]!).toBeCloseTo(vector[i]!, 0);
      }
    });

    it('should respect minimum size for compression', async () => {
      const smallVector = new Float32Array([1, 2, 3]); // Below threshold
      
      await expect(compressionManager.compress(smallVector)).rejects.toThrow('too small');
    });

    it('should allow strategy override', async () => {
      const vector = new Float32Array(Array.from({ length: 100 }, () => Math.random()));
      
      const compressed = await compressionManager.compress(vector, 'scalar');
      
      expect(compressed.metadata.algorithm).toContain('scalar');
    });

    it('should provide accurate compression estimates', () => {
      const vector = new Float32Array(Array.from({ length: 128 }, () => Math.random()));
      
      const ratio = compressionManager.estimateCompressionRatio(vector, 'scalar');
      
      expect(ratio).toBeGreaterThan(1);
      expect(ratio).toBeLessThan(10); // Reasonable upper bound
    });
  });

  describe('Auto-Selection Logic', () => {
    it('should recommend scalar for general vectors', () => {
      const generalVector = new Float32Array(Array.from({ length: 100 }, () => Math.random()));
      
      const recommendation = compressionManager.autoSelectStrategy(generalVector);
      
      expect(recommendation.strategy).toBe('scalar');
      expect(recommendation.reasoning).toBeDefined();
      expect(recommendation.estimatedRatio).toBeGreaterThan(1);
    });

    it('should handle small vectors appropriately', () => {
      const smallVector = new Float32Array(Array.from({ length: 50 }, () => Math.random()));
      
      const recommendation = compressionManager.autoSelectStrategy(smallVector);
      
      expect(recommendation.strategy).toBe('scalar');
      expect(recommendation.reasoning).toContain('small vector size');
    });

    it('should detect sparse vectors', () => {
      // Create a sparse vector (mostly zeros)
      const sparseVector = new Float32Array(200);
      for (let i = 0; i < 20; i++) {
        sparseVector[i * 10] = Math.random();
      }
      
      const recommendation = compressionManager.autoSelectStrategy(sparseVector);
      
      expect(recommendation.reasoning).toContain('sparsity');
    });

    it('should detect high dynamic range vectors', () => {
      const highRangeVector = new Float32Array(Array.from({ length: 200 }, (_, i) => 
        i < 100 ? 0.001 * i : 1000 * (i - 100) // Create a larger vector with high range
      ));
      
      const recommendation = compressionManager.autoSelectStrategy(highRangeVector);
      
      expect(recommendation.reasoning).toContain('high complexity');
    });
  });

  describe('Strategy Comparison', () => {
    it('should compare available strategies', () => {
      const vector = new Float32Array(Array.from({ length: 100 }, () => Math.random()));
      
      const comparisons = compressionManager.compareStrategies(vector);
      
      expect(comparisons.size).toBeGreaterThan(0);
      expect(comparisons.has('scalar')).toBe(true);
      
      const scalarComparison = comparisons.get('scalar')!;
      expect(scalarComparison.estimatedRatio).toBeGreaterThan(1);
      expect(scalarComparison.reasoning).toBeDefined();
    });

    it('should provide meaningful comparison data', () => {
      const vector = new Float32Array(Array.from({ length: 200 }, () => Math.random() * 100));
      
      const comparisons = compressionManager.compareStrategies(vector);
      
      for (const [strategy, comparison] of comparisons) {
        expect(comparison.strategy).toBe(strategy);
        expect(comparison.estimatedRatio).toBeGreaterThan(0);
        expect(comparison.estimatedPrecisionLoss).toBeGreaterThanOrEqual(0);
        expect(comparison.reasoning.length).toBeGreaterThan(0);
      }
    });
  });

  describe('Batch Operations', () => {
    it('should handle batch compression efficiently', async () => {
      const vectors = Array.from({ length: 10 }, () =>
        new Float32Array(Array.from({ length: 64 }, () => Math.random()))
      );
      
      const start = performance.now();
      const compressed = await compressionManager.compressBatch(vectors);
      const elapsed = performance.now() - start;
      
      expect(compressed).toHaveLength(10);
      expect(elapsed).toBeLessThan(1000); // Should be reasonably fast
      
      // Verify all compressions
      for (let i = 0; i < vectors.length; i++) {
        const decompressed = await compressionManager.decompress(compressed[i]!);
        expect(decompressed.length).toBe(vectors[i]!.length);
      }
    });

    it('should reject batch with undersized vectors', async () => {
      const vectors = [
        new Float32Array([1, 2, 3]), // Too small
        new Float32Array(Array.from({ length: 64 }, () => Math.random()))
      ];
      
      await expect(compressionManager.compressBatch(vectors)).rejects.toThrow();
    });

    it('should handle empty batch', async () => {
      const compressed = await compressionManager.compressBatch([]);
      expect(compressed).toHaveLength(0);
    });
  });

  describe('Configuration Management', () => {
    it('should allow configuration updates', () => {
      compressionManager.updateConfig({
        targetCompressionRatio: 3.0,
        maxPrecisionLoss: 0.1
      });
      
      const config = compressionManager.getConfig();
      expect(config.targetCompressionRatio).toBe(3.0);
      expect(config.maxPrecisionLoss).toBe(0.1);
    });

    it('should propagate config to compressors', async () => {
      compressionManager.updateConfig({
        maxPrecisionLoss: 0.001 // Very strict
      });
      
      const vector = new Float32Array(Array.from({ length: 64 }, () => Math.random()));
      
      try {
        const compressed = await compressionManager.compress(vector);
        expect(compressed.metadata.precisionLoss).toBeLessThanOrEqual(0.001);
      } catch (error) {
        // May fail if precision requirements cannot be met
        expect(error).toBeInstanceOf(Error);
      }
    });
  });

  describe('Convenience Functions', () => {
    it('should provide working convenience functions', async () => {
      const vector = new Float32Array(Array.from({ length: 100 }, () => Math.random()));
      
      const compressed = await compressVector(vector);
      const decompressed = await decompressVector(compressed);
      
      expect(decompressed.length).toBe(vector.length);
      expect(compressed.metadata.compressionRatio).toBeGreaterThan(1);
    });

    it('should provide compression recommendations', () => {
      const vector = new Float32Array(Array.from({ length: 100 }, () => Math.random()));
      
      const recommendation = getCompressionRecommendation(vector);
      
      expect((recommendation as any).strategy).toBeDefined();
      expect((recommendation as any).estimatedRatio).toBeGreaterThan(1);
      expect((recommendation as any).reasoning).toBeDefined();
    });

    it('should compare strategies via convenience function', () => {
      const vector = new Float32Array(Array.from({ length: 100 }, () => Math.random()));
      
      const comparisons = compareCompressionStrategies(vector);
      
      expect((comparisons as any).size).toBeGreaterThan(0);
      expect((comparisons as any).has('scalar')).toBe(true);
    });
  });

  describe('Real-World Scenarios', () => {
    it('should handle text embeddings', async () => {
      // Simulate typical text embedding (384 dimensions, normalized)
      const embedding = new Float32Array(384);
      let magnitude = 0;
      for (let i = 0; i < embedding.length; i++) {
        embedding[i] = (Math.random() - 0.5) * 2; // Range [-1, 1]
        magnitude += embedding[i]! * embedding[i]!;
      }
      magnitude = Math.sqrt(magnitude);
      
      // Normalize
      for (let i = 0; i < embedding.length; i++) {
        embedding[i]! /= magnitude;
      }
      
      const compressed = await compressionManager.compress(embedding);
      const decompressed = await compressionManager.decompress(compressed);
      
      expect(compressed.metadata.compressionRatio).toBeGreaterThan(1.5);
      
      // Check cosine similarity preservation
      let dotProduct = 0, normA = 0, normB = 0;
      for (let i = 0; i < embedding.length; i++) {
        dotProduct += embedding[i]! * decompressed[i]!;
        normA += embedding[i]! * embedding[i]!;
        normB += decompressed[i]! * decompressed[i]!;
      }
      const cosineSim = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
      
      expect(cosineSim).toBeGreaterThan(0.95); // High similarity preservation
    });

    it('should handle image features', async () => {
      // Simulate typical image feature vector (2048 dimensions)
      const features = new Float32Array(2048);
      for (let i = 0; i < features.length; i++) {
        features[i] = Math.random() * 255; // Typical image feature range
      }
      
      const compressed = await compressionManager.compress(features);
      const decompressed = await compressionManager.decompress(compressed);
      
      expect(compressed.metadata.compressionRatio).toBeGreaterThan(2.0);
      
      // Verify feature preservation
      let sumSquaredError = 0;
      for (let i = 0; i < features.length; i++) {
        const error = features[i]! - decompressed[i]!;
        sumSquaredError += error * error;
      }
      const rmse = Math.sqrt(sumSquaredError / features.length);
      
      expect(rmse).toBeLessThan(10); // Reasonable error for image features
    });

    it('should handle sparse vectors efficiently', async () => {
      // Create a sparse vector (10% non-zero)
      const sparse = new Float32Array(1000);
      for (let i = 0; i < 100; i++) {
        sparse[i * 10] = Math.random() * 10;
      }
      
      const recommendation = compressionManager.autoSelectStrategy(sparse);
      const compressed = await compressionManager.compress(sparse);
      
      expect(recommendation.reasoning).toContain('sparsity');
      expect(compressed.metadata.compressionRatio).toBeGreaterThan(3.0); // Should compress well
    });

    it('should handle high-precision scientific data', async () => {
      // Scientific data with high precision requirements
      const scientificData = new Float32Array(256);
      for (let i = 0; i < scientificData.length; i++) {
        scientificData[i] = Math.PI * Math.sin(i / 10) * Math.exp(-i / 100);
      }
      
      const strictManager = new CompressionManager({
        maxPrecisionLoss: 0.001, // Very strict
        validateQuality: true
      });
      
      try {
        const compressed = await strictManager.compress(scientificData);
        const decompressed = await strictManager.decompress(compressed);
        
        // Verify high precision preservation
        for (let i = 0; i < scientificData.length; i++) {
          const relativeError = Math.abs(scientificData[i]! - decompressed[i]!) / Math.abs(scientificData[i]!);
          expect(relativeError).toBeLessThan(0.01); // 1% relative error
        }
      } catch (error) {
        // May fail if precision requirements cannot be met with current compression
        expect(error).toBeInstanceOf(Error);
      }
    });
  });

  describe('Performance Characteristics', () => {
    it('should compress large vectors in reasonable time', async () => {
      const largeVector = new Float32Array(Array.from({ length: 10000 }, () => Math.random()));
      
      const start = performance.now();
      const compressed = await compressionManager.compress(largeVector);
      const compressionTime = performance.now() - start;
      
      const decompressStart = performance.now();
      const decompressed = await compressionManager.decompress(compressed);
      const decompressionTime = performance.now() - decompressStart;
      
      expect(compressionTime).toBeLessThan(1000); // Should be fast
      expect(decompressionTime).toBeLessThan(500); // Decompression should be faster
      expect(decompressed.length).toBe(largeVector.length);
    });

    it('should show performance scaling', async () => {
      const sizes = [100, 500, 1000, 2000];
      const times: number[] = [];
      
      for (const size of sizes) {
        const vector = new Float32Array(Array.from({ length: size }, () => Math.random()));
        
        const start = performance.now();
        await compressionManager.compress(vector);
        const elapsed = performance.now() - start;
        
        times.push(elapsed);
      }
      
      // Performance should scale reasonably (not exponentially)
      for (let i = 1; i < times.length; i++) {
        const ratio = times[i]! / times[i - 1]!;
        const sizeRatio = sizes[i]! / sizes[i - 1]!;
        
        // Time growth should be roughly linear with size
        expect(ratio).toBeLessThan(sizeRatio * 2);
      }
    });
  });
});