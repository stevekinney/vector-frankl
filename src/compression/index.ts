/**
 * Vector compression module
 *
 * Provides efficient compression algorithms for vector data storage,
 * including scalar quantization, product quantization, and binary quantization.
 */

// Import types that are used in this file
import type { CompressedVector, CompressionConfig } from './base-compressor.js';
import type { CompressionRecommendation } from './compression-manager.js';

// Base compression interfaces and utilities
export {
  BaseCompressor,
  type CompressedVector,
  type CompressionConfig,
  type CompressionMetadata,
  type CompressionQuality,
} from './base-compressor.js';

// Compression utilities
export {
  calculateBatchStatistics,
  calculateOptimalBits,
  calculateQuantizationBounds,
  calculateVectorStatistics,
  createQuantizedArray,
  dequantizeValue,
  type DimensionStatistics,
  estimateMemoryUsage,
  packQuantizedValues,
  type QuantizationBounds,
  quantizeValue,
  unpackQuantizedValues,
  type VectorStatistics,
} from './compression-utils.js';

// Scalar quantization
export {
  type QuantizationStrategy,
  type ScalarQuantizationConfig,
  ScalarQuantizer,
} from './scalar-quantizer.js';

// Product quantization
export {
  type PQCodebook,
  type PQConfig,
  type PQInitMethod,
  type PQMetadata,
  ProductQuantizer,
} from './product-quantizer.js';

// Compression management
export {
  CompressionManager,
  type CompressionManagerConfig,
  type CompressionRecommendation,
} from './compression-manager.js';

/**
 * Convenience function to compress a vector with auto-selected strategy
 */
export async function compressVector(
  vector: Float32Array,
  config?: CompressionConfig,
): Promise<CompressedVector> {
  const { CompressionManager } = await import('./compression-manager.js');
  const manager = new CompressionManager({
    defaultStrategy: 'scalar',
    autoSelect: true,
    minSizeForCompression: 64,
    targetCompressionRatio: 2.0,
    maxPrecisionLoss: 0.05,
    validateQuality: true,
  });
  return manager.compress(vector, undefined, config);
}

/**
 * Convenience function to decompress a vector
 */
export async function decompressVector(
  compressed: CompressedVector,
): Promise<Float32Array> {
  const { CompressionManager } = await import('./compression-manager.js');
  const manager = new CompressionManager();
  return manager.decompress(compressed);
}

/**
 * Get compression recommendation for a vector
 */
export async function getCompressionRecommendation(
  vector: Float32Array,
): Promise<CompressionRecommendation> {
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
