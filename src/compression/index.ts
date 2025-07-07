/**
 * Vector compression module
 * 
 * Provides efficient compression algorithms for vector data storage,
 * including scalar quantization, product quantization, and binary quantization.
 */

// Import types that are used in this file
import type { CompressionConfig, CompressedVector } from './base-compressor.js';
import type { CompressionRecommendation } from './compression-manager.js';

// Base compression interfaces and utilities
export {
  BaseCompressor,
  type CompressionMetadata,
  type CompressionConfig,
  type CompressionQuality,
  type CompressedVector
} from './base-compressor.js';

// Compression utilities
export {
  calculateVectorStatistics,
  calculateBatchStatistics,
  calculateQuantizationBounds,
  quantizeValue,
  dequantizeValue,
  calculateOptimalBits,
  estimateMemoryUsage,
  createQuantizedArray,
  packQuantizedValues,
  unpackQuantizedValues,
  type VectorStatistics,
  type DimensionStatistics,
  type QuantizationBounds
} from './compression-utils.js';

// Scalar quantization
export {
  ScalarQuantizer,
  type ScalarQuantizationConfig,
  type QuantizationStrategy
} from './scalar-quantizer.js';

// Product quantization
export {
  ProductQuantizer,
  type PQConfig,
  type PQCodebook,
  type PQMetadata,
  type PQInitMethod
} from './product-quantizer.js';

// Compression management
export {
  CompressionManager,
  type CompressionManagerConfig,
  type CompressionRecommendation
} from './compression-manager.js';

/**
 * Convenience function to compress a vector with auto-selected strategy
 */
export async function compressVector(
  vector: Float32Array,
  config?: CompressionConfig
): Promise<CompressedVector> {
  const { CompressionManager } = await import('./compression-manager.js');
  const manager = new CompressionManager({
    defaultStrategy: 'scalar',
    autoSelect: true,
    minSizeForCompression: 64,
    targetCompressionRatio: 2.0,
    maxPrecisionLoss: 0.05,
    validateQuality: true
  });
  return manager.compress(vector, undefined, config);
}

/**
 * Convenience function to decompress a vector
 */
export async function decompressVector(compressed: CompressedVector): Promise<Float32Array> {
  const { CompressionManager } = await import('./compression-manager.js');
  const manager = new CompressionManager();
  return manager.decompress(compressed);
}

/**
 * Get compression recommendation for a vector
 */
export async function getCompressionRecommendation(vector: Float32Array): Promise<CompressionRecommendation> {
  const { CompressionManager } = await import('./compression-manager.js');
  const manager = new CompressionManager();
  return manager.getRecommendation(vector);
}

/**
 * Compare compression strategies for a vector
 */
export async function compareCompressionStrategies(vector: Float32Array) {
  const { CompressionManager } = await import('./compression-manager.js');
  const manager = new CompressionManager();
  return manager.compareStrategies(vector);
}