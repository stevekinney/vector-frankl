/**
 * Vector compression utilities
 * Import via: vector-frankl/compression
 */
import { BaseCompressor } from './compression/base-compressor.js';
import {
  compareCompressionStrategies,
  compressVector,
  decompressVector,
  getCompressionRecommendation,
} from './compression/index.js';
import { CompressionManager } from './compression/compression-manager.js';
import { ProductQuantizer } from './compression/product-quantizer.js';
import { ScalarQuantizer } from './compression/scalar-quantizer.js';

export type {
  CompressedVector,
  CompressionConfig,
  CompressionMetadata,
  CompressionQuality,
} from './compression/base-compressor.js';
export type {
  CompressionManagerConfig,
  CompressionRecommendation,
} from './compression/compression-manager.js';
export type {
  PQCodebook,
  PQConfig,
  PQInitMethod,
} from './compression/product-quantizer.js';
export type {
  QuantizationStrategy,
  ScalarQuantizationConfig,
} from './compression/scalar-quantizer.js';
export {
  BaseCompressor,
  compareCompressionStrategies,
  CompressionManager,
  compressVector,
  decompressVector,
  getCompressionRecommendation,
  ProductQuantizer,
  ScalarQuantizer,
};
