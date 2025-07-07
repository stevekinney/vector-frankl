import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { ProductQuantizer } from '@/compression/product-quantizer.js';

describe('ProductQuantizer', () => {
  let quantizer: ProductQuantizer;
  let trainingVectors: Float32Array[];

  beforeEach(() => {
    quantizer = new ProductQuantizer({
      subspaces: 4,
      centroidsPerSubspace: 16, // Small for testing
      maxIterations: 10,
      validateQuality: false, // Disable for faster testing
      maxPrecisionLoss: 0.3, // More lenient for testing
    });

    // Create test training vectors (64-dimensional)
    trainingVectors = Array.from({ length: 50 }, (_, i) => {
      const vector = new Float32Array(64);
      for (let j = 0; j < 64; j++) {
        vector[j] = Math.sin(i * 0.1 + j * 0.05) + Math.random() * 0.1;
      }
      return vector;
    });
  });

  afterEach(() => {
    // Cleanup if needed
  });

  describe('Configuration and Initialization', () => {
    it('should create with default configuration', () => {
      const defaultQuantizer = new ProductQuantizer();
      const config = defaultQuantizer.getPQConfig();

      expect(config.subspaces).toBe(8);
      expect(config.centroidsPerSubspace).toBe(256);
      expect(config.maxIterations).toBe(50);
      expect(config.initMethod).toBe('kmeans++');
    });

    it('should create with custom configuration', () => {
      const customQuantizer = new ProductQuantizer({
        subspaces: 16,
        centroidsPerSubspace: 128,
        maxIterations: 20,
        initMethod: 'random',
      });

      const config = customQuantizer.getPQConfig();
      expect(config.subspaces).toBe(16);
      expect(config.centroidsPerSubspace).toBe(128);
      expect(config.maxIterations).toBe(20);
      expect(config.initMethod).toBe('random');
    });

    it('should provide correct algorithm name', () => {
      const name = quantizer.getAlgorithmName();
      expect(name).toBe('product-4x16');
    });

    it('should estimate compressed size', () => {
      const vector = new Float32Array(64);
      const estimate = quantizer.estimateCompressedSize(vector);

      expect(estimate).toBeGreaterThan(0);
      expect(estimate).toBeLessThan(vector.length * 4); // Should be smaller than original
    });
  });

  describe('Codebook Training', () => {
    it('should train codebook successfully', async () => {
      expect(quantizer.isCodebookTrained()).toBe(false);

      await quantizer.trainCodebook(trainingVectors);

      expect(quantizer.isCodebookTrained()).toBe(true);

      const codebook = quantizer.getCodebookInfo();
      expect(codebook).not.toBeNull();
      expect(codebook!.centroids).toHaveLength(4); // 4 subspaces
      expect(codebook!.centroids[0]).toHaveLength(16); // 16 centroids per subspace
    });

    it('should handle different initialization methods', async () => {
      const randomQuantizer = new ProductQuantizer({
        subspaces: 2,
        centroidsPerSubspace: 8,
        initMethod: 'random',
        maxIterations: 5,
      });

      await randomQuantizer.trainCodebook(trainingVectors);
      expect(randomQuantizer.isCodebookTrained()).toBe(true);

      const kmeansQuantizer = new ProductQuantizer({
        subspaces: 2,
        centroidsPerSubspace: 8,
        initMethod: 'kmeans++',
        maxIterations: 5,
      });

      await kmeansQuantizer.trainCodebook(trainingVectors);
      expect(kmeansQuantizer.isCodebookTrained()).toBe(true);
    });

    it('should provide training statistics', async () => {
      await quantizer.trainCodebook(trainingVectors);

      const codebook = quantizer.getCodebookInfo();
      expect(codebook!.trainingStats.iterations).toBeGreaterThan(0);
      expect(codebook!.trainingStats.trainingTime).toBeGreaterThan(0);
      expect(codebook!.trainingStats.convergence).toBeGreaterThanOrEqual(0);
    });

    it('should handle insufficient training vectors', async () => {
      const smallTrainingSet = trainingVectors.slice(0, 5); // Too few for 16 centroids

      expect(quantizer.trainCodebook(smallTrainingSet)).rejects.toThrow();
    });

    it('should handle empty training set', async () => {
      expect(quantizer.trainCodebook([])).rejects.toThrow();
    });

    it('should handle dimension mismatches in training', async () => {
      const mismatchedVectors = [
        new Float32Array(64),
        new Float32Array(32), // Different dimension
        new Float32Array(64),
      ];

      expect(quantizer.trainCodebook(mismatchedVectors)).rejects.toThrow();
    });

    it('should limit training vectors when specified', async () => {
      const limitedQuantizer = new ProductQuantizer({
        subspaces: 2,
        centroidsPerSubspace: 4,
        trainingVectors: 10, // Limit to 10 vectors
        maxIterations: 5,
      });

      await limitedQuantizer.trainCodebook(trainingVectors); // 50 vectors provided
      expect(limitedQuantizer.isCodebookTrained()).toBe(true);
    });
  });

  describe('Compression and Decompression', () => {
    beforeEach(async () => {
      await quantizer.trainCodebook(trainingVectors);
    });

    it('should compress and decompress vectors', async () => {
      const testVector = trainingVectors[0]!;

      const compressed = await quantizer.compress(testVector);
      const decompressed = await quantizer.decompress(compressed);

      expect(decompressed).toBeInstanceOf(Float32Array);
      expect(decompressed.length).toBe(testVector!.length);

      // Should be approximately similar (PQ is lossy)
      let similarity = 0;
      for (let i = 0; i < testVector!.length; i++) {
        similarity += testVector![i]! * decompressed[i]!;
      }
      expect(similarity).toBeGreaterThan(0); // Should maintain some similarity
    });

    it('should provide compression metadata', async () => {
      const testVector = trainingVectors[0]!;
      const compressed = await quantizer.compress(testVector);

      expect(compressed.metadata).toBeDefined();
      expect(compressed.metadata.originalSize).toBe(testVector!.length * 4);
      expect(compressed.metadata.compressedSize).toBeLessThan(
        compressed.metadata.originalSize,
      );
      expect(compressed.metadata.compressionRatio).toBeGreaterThan(1);
      expect(compressed.metadata.algorithm).toContain('product');
    });

    it('should achieve reasonable compression ratios', async () => {
      const testVector = trainingVectors[0]!;
      const compressed = await quantizer.compress(testVector);

      // Should achieve significant compression
      expect(compressed.metadata.compressionRatio).toBeGreaterThan(2);
      expect(compressed.metadata.compressionRatio).toBeLessThan(100); // Reasonable upper bound for PQ
    });

    it('should handle vectors not in training set', async () => {
      // Create a new vector not in training set
      const newVector = new Float32Array(64);
      for (let i = 0; i < 64; i++) {
        newVector[i] = Math.cos(i * 0.1) + Math.random() * 0.2;
      }

      const compressed = await quantizer.compress(newVector);
      const decompressed = await quantizer.decompress(compressed);

      expect(decompressed.length).toBe(newVector.length);
    });

    it('should fail compression without trained codebook', async () => {
      const untrainedQuantizer = new ProductQuantizer();
      const testVector = new Float32Array(64);

      expect(untrainedQuantizer.compress(testVector)).rejects.toThrow();
    });
  });

  describe('Asymmetric Distance Computation', () => {
    beforeEach(async () => {
      await quantizer.trainCodebook(trainingVectors);
    });

    it('should compute asymmetric Euclidean distance', async () => {
      const queryVector = trainingVectors[0]!;
      const targetVector = trainingVectors[1]!;

      const compressed = await quantizer.compress(targetVector);
      const codes = new Uint8Array(compressed.data, 256, 4); // Extract codes

      const distance = quantizer.asymmetricDistance(queryVector, codes, 'euclidean');

      expect(distance).toBeGreaterThanOrEqual(0);
      expect(isFinite(distance)).toBe(true);
    });

    it('should compute asymmetric cosine distance', async () => {
      const queryVector = trainingVectors[0]!;
      const targetVector = trainingVectors[1]!;

      const compressed = await quantizer.compress(targetVector);
      const codes = new Uint8Array(compressed.data, 256, 4); // Extract codes

      const distance = quantizer.asymmetricDistance(queryVector, codes, 'cosine');

      expect(distance).toBeGreaterThanOrEqual(0);
      expect(isFinite(distance)).toBe(true);
    });

    it('should be faster than full decompression', async () => {
      const queryVector = trainingVectors[0]!;
      const targetVector = trainingVectors[1]!;
      const compressed = await quantizer.compress(targetVector);
      const codes = new Uint8Array(compressed.data, 256, 4);

      // Time asymmetric distance
      const asymmetricStart = performance.now();
      quantizer.asymmetricDistance(queryVector!, codes);
      const asymmetricTime = performance.now() - asymmetricStart;

      // Time full decompression approach
      const fullStart = performance.now();
      const decompressed = await quantizer.decompress(compressed);
      let _fullDist = 0;
      for (let i = 0; i < queryVector!.length; i++) {
        const diff = queryVector![i]! - decompressed[i]!;
        _fullDist += diff * diff;
      }
      _fullDist = Math.sqrt(_fullDist);
      const fullTime = performance.now() - fullStart;

      // Asymmetric should be faster or at least not significantly slower
      expect(asymmetricTime).toBeLessThan(fullTime * 2);
    });

    it('should require trained codebook for distance computation', async () => {
      const untrainedQuantizer = new ProductQuantizer();
      const queryVector = new Float32Array(64);
      const codes = new Uint8Array(4);

      expect(() => {
        untrainedQuantizer.asymmetricDistance(queryVector, codes);
      }).toThrow();
    });
  });

  describe('Configuration Management', () => {
    it('should allow configuration updates', () => {
      quantizer.updatePQConfig({
        subspaces: 8,
        centroidsPerSubspace: 32,
      });

      const config = quantizer.getPQConfig();
      expect(config.subspaces).toBe(8);
      expect(config.centroidsPerSubspace).toBe(32);
      expect(quantizer.isCodebookTrained()).toBe(false); // Should invalidate training
    });

    it('should preserve existing config when updating', () => {
      const originalConfig = quantizer.getPQConfig();

      quantizer.updatePQConfig({ subspaces: 6 });

      const updatedConfig = quantizer.getPQConfig();
      expect(updatedConfig.subspaces).toBe(6);
      expect(updatedConfig.centroidsPerSubspace).toBe(
        originalConfig.centroidsPerSubspace!,
      );
    });
  });

  describe('Compression Statistics', () => {
    it('should provide accurate compression statistics', () => {
      const stats = quantizer.getCompressionStats(64);

      expect(stats.theoreticalRatio).toBeGreaterThan(1);
      expect(stats.bitsPerCode).toBeGreaterThan(0);
      expect(stats.codesPerVector).toBe(4); // 4 subspaces
      expect(stats.totalBits).toBeGreaterThan(0);
    });

    it('should scale statistics with vector dimension', () => {
      const stats128 = quantizer.getCompressionStats(128);
      const stats256 = quantizer.getCompressionStats(256);

      expect(stats256.theoreticalRatio).toBeGreaterThan(stats128.theoreticalRatio);
    });
  });

  describe('Error Handling', () => {
    it('should handle very small vectors', async () => {
      const smallQuantizer = new ProductQuantizer({
        subspaces: 2,
        centroidsPerSubspace: 4,
        maxIterations: 5,
      });

      const smallVectors = Array.from({ length: 10 }, () => new Float32Array([1, 2]));

      await smallQuantizer.trainCodebook(smallVectors);

      const compressed = await smallQuantizer.compress(smallVectors[0]!);
      const decompressed = await smallQuantizer.decompress(compressed);

      expect(decompressed.length).toBe(2);
    });

    it('should handle large vectors efficiently', async () => {
      const largeQuantizer = new ProductQuantizer({
        subspaces: 8,
        centroidsPerSubspace: 16,
        maxIterations: 5,
        maxPrecisionLoss: 0.3,
      });

      const largeVectors = Array.from({ length: 20 }, () => {
        const vector = new Float32Array(512);
        for (let i = 0; i < 512; i++) {
          vector[i] = Math.random();
        }
        return vector;
      });

      const start = performance.now();
      await largeQuantizer.trainCodebook(largeVectors);
      const trainingTime = performance.now() - start;

      expect(trainingTime).toBeLessThan(5000); // Should complete in reasonable time

      const compressed = await largeQuantizer.compress(largeVectors[0]!);
      expect(compressed.metadata.compressionRatio).toBeGreaterThan(1);
    });

    it('should handle vectors with extreme values', async () => {
      const extremeVectors = Array.from({ length: 20 }, () => {
        const vector = new Float32Array(32);
        for (let i = 0; i < 32; i++) {
          vector[i] = (Math.random() - 0.5) * 1000; // Large range
        }
        return vector;
      });

      await quantizer.trainCodebook(extremeVectors);

      const compressed = await quantizer.compress(extremeVectors[0]!);
      const decompressed = await quantizer.decompress(compressed);

      expect(decompressed.length).toBe(extremeVectors[0]!.length);
      expect(isFinite(decompressed[0]!)).toBe(true);
    });

    it('should handle uniform vectors gracefully', async () => {
      const uniformVectors = Array.from({ length: 20 }, () => {
        const vector = new Float32Array(32);
        vector.fill(1.0); // All same value
        return vector;
      });

      await quantizer.trainCodebook(uniformVectors);

      const compressed = await quantizer.compress(uniformVectors[0]!);
      const decompressed = await quantizer.decompress(compressed);

      // Should be close to original uniform values
      for (let i = 0; i < decompressed.length; i++) {
        expect(Math.abs(decompressed[i]! - 1.0)).toBeLessThan(0.5);
      }
    });
  });

  describe('Edge Cases', () => {
    it('should handle single subspace configuration', async () => {
      const singleSubspaceQuantizer = new ProductQuantizer({
        subspaces: 1,
        centroidsPerSubspace: 16,
        maxIterations: 5,
        maxPrecisionLoss: 0.3,
      });

      await singleSubspaceQuantizer.trainCodebook(trainingVectors);

      const compressed = await singleSubspaceQuantizer.compress(trainingVectors[0]!);
      const decompressed = await singleSubspaceQuantizer.decompress(compressed);

      expect(decompressed.length).toBe(trainingVectors[0]!.length);
    });

    it('should handle maximum subspaces configuration', async () => {
      const maxSubspaceQuantizer = new ProductQuantizer({
        subspaces: 64, // One per dimension
        centroidsPerSubspace: 4,
        maxIterations: 3,
        maxPrecisionLoss: 0.3,
      });

      await maxSubspaceQuantizer.trainCodebook(trainingVectors);

      const compressed = await maxSubspaceQuantizer.compress(trainingVectors[0]!);
      const decompressed = await maxSubspaceQuantizer.decompress(compressed);

      expect(decompressed.length).toBe(trainingVectors[0]!.length);
    });

    it('should handle convergence in few iterations', async () => {
      const quickQuantizer = new ProductQuantizer({
        subspaces: 2,
        centroidsPerSubspace: 4,
        maxIterations: 2,
        convergenceThreshold: 0.1, // Easy to converge
      });

      await quickQuantizer.trainCodebook(trainingVectors);

      const codebook = quickQuantizer.getCodebookInfo();
      expect(codebook!.trainingStats.iterations).toBeLessThanOrEqual(2);
    });
  });
});
