/**
 * Vector compression utilities
 * Import via: vector-frankl/compression
 */
export {
  CompressionManager,
  ScalarQuantizer,
  ProductQuantizer,
  BaseCompressor,
  compressVector,
  decompressVector,
  getCompressionRecommendation,
  compareCompressionStrategies,
  type CompressionConfig,
  type CompressionMetadata,
  type CompressionQuality,
  type CompressedVector,
  type CompressionManagerConfig,
  type CompressionRecommendation,
  type ScalarQuantizationConfig,
  type QuantizationStrategy,
  type PQConfig,
  type PQCodebook,
  type PQInitMethod,
} from './compression/index.js';
