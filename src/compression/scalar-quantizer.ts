/**
 * Scalar quantization compression for vector data
 */

import { BaseCompressor, type CompressedVector, type CompressionConfig } from './base-compressor.js';
import {
  calculateVectorStatistics,
  calculateQuantizationBounds,
  quantizeValue,
  dequantizeValue,
  calculateOptimalBits,
  estimateMemoryUsage,
  packQuantizedValues,
  unpackQuantizedValues,
  type QuantizationBounds
} from './compression-utils.js';

export type QuantizationStrategy = 'uniform' | 'per-dimension' | 'percentile';

export interface ScalarQuantizationConfig extends CompressionConfig {
  /** Quantization strategy */
  strategy?: QuantizationStrategy;
  /** Number of bits for quantization (4, 8, 12, 16) */
  bits?: number;
  /** Percentile range for outlier handling */
  percentileRange?: [number, number];
  /** Auto-adjust bits based on precision requirements */
  adaptiveBits?: boolean;
  /** Use SIMD acceleration when available */
  useSIMD?: boolean;
}

// Removed unused interface _ScalarQuantizationMetadata

/**
 * Scalar quantization compressor
 */
export class ScalarQuantizer extends BaseCompressor {
  private scalarConfig: Required<ScalarQuantizationConfig>;

  constructor(config: ScalarQuantizationConfig = {}) {
    super(config);
    
    this.scalarConfig = {
      ...this.config,
      strategy: config.strategy ?? 'uniform',
      bits: config.bits ?? 8,
      percentileRange: config.percentileRange ?? [0.01, 0.99],
      adaptiveBits: config.adaptiveBits ?? true,
      useSIMD: config.useSIMD ?? true
    };
  }

  getAlgorithmName(): string {
    return `scalar-${this.scalarConfig.strategy}-${this.scalarConfig.bits}bit`;
  }

  estimateCompressedSize(vector: Float32Array): number {
    const bits = this.scalarConfig.adaptiveBits
      ? calculateOptimalBits(vector, this.scalarConfig.maxPrecisionLoss)
      : this.scalarConfig.bits;
      
    return estimateMemoryUsage(vector.length, bits, true) + 64; // 64 bytes for metadata
  }

  async compress(vector: Float32Array): Promise<CompressedVector> {
    const startTime = performance.now();
    
    // Calculate optimal bits if adaptive
    const bits = this.scalarConfig.adaptiveBits
      ? calculateOptimalBits(vector, this.scalarConfig.maxPrecisionLoss)
      : this.scalarConfig.bits;

    // Calculate statistics and bounds
    const statistics = calculateVectorStatistics(vector);
    const bounds = this.calculateBounds([vector]);

    // Quantize the vector
    const quantizedValues = await this.quantizeVector(vector, bounds, bits);
    
    // Pack into compressed buffer
    const compressedData = this.packCompressedData(quantizedValues, bounds, bits, statistics);
    
    // Calculate compression metadata
    const originalSize = vector.length * 4; // Float32 = 4 bytes
    const compressedSize = compressedData.byteLength;
    
    // Validate quality if enabled
    let precisionLoss = 0;
    if (this.config.validateQuality) {
      const decompressed = await this.decompressData(compressedData);
      const quality = await this.validateCompressionQuality(vector, decompressed);
      precisionLoss = 1 - quality.qualityScore;
      
      if (precisionLoss > this.config.maxPrecisionLoss) {
        throw new Error(
          `Compression quality too low: ${precisionLoss.toFixed(3)} > ${this.config.maxPrecisionLoss}`
        );
      }
    }

    const metadata = this.createMetadata(
      originalSize,
      compressedSize,
      this.config.level,
      precisionLoss
    );

    const compressionTime = performance.now() - startTime;
    
    return {
      data: compressedData,
      metadata: {
        ...metadata,
        algorithm: `${this.getAlgorithmName()}:${compressionTime.toFixed(2)}ms`
      },
      dimension: vector.length,
      config: this.getConfig()
    };
  }

  async decompress(compressed: CompressedVector): Promise<Float32Array> {
    return this.decompressData(compressed.data);
  }

  /**
   * Calculate quantization bounds based on strategy
   */
  private calculateBounds(vectors: Float32Array[]): QuantizationBounds {
    // Map strategy to match expected parameter types
    const strategyMap: Record<string, 'global' | 'per-dimension' | 'percentile'> = {
      'uniform': 'global',
      'per-dimension': 'per-dimension',
      'percentile': 'percentile'
    };
    
    return calculateQuantizationBounds(
      vectors,
      strategyMap[this.scalarConfig.strategy] || 'global',
      this.scalarConfig.percentileRange
    );
  }

  /**
   * Quantize a vector using specified bounds and bits
   */
  private async quantizeVector(
    vector: Float32Array,
    bounds: QuantizationBounds,
    bits: number
  ): Promise<number[]> {
    const quantized: number[] = [];
    
    if (this.scalarConfig.strategy === 'per-dimension' && bounds.dimensionBounds) {
      // Per-dimension quantization
      for (let i = 0; i < vector.length; i++) {
        const dimBounds = bounds.dimensionBounds?.[i];
        if (!dimBounds) {
          throw new Error(`Missing dimension bounds for dimension ${i}`);
        }
        const vectorValue = vector[i];
        if (vectorValue === undefined) {
          throw new Error(`Vector value at index ${i} is undefined`);
        }
        const quantizedValue = quantizeValue(
          vectorValue,
          dimBounds.min,
          dimBounds.max,
          bits
        );
        quantized.push(quantizedValue);
      }
    } else {
      // Global quantization
      const { globalMin, globalMax } = bounds;
      
      if (this.scalarConfig.useSIMD && vector.length >= 16) {
        // Use SIMD acceleration for large vectors
        quantized.push(...this.quantizeVectorSIMD(vector, globalMin, globalMax, bits));
      } else {
        // Scalar quantization
        for (let i = 0; i < vector.length; i++) {
          const vectorValue = vector[i];
          if (vectorValue === undefined) {
            throw new Error(`Vector value at index ${i} is undefined`);
          }
          const quantizedValue = quantizeValue(vectorValue, globalMin, globalMax, bits);
          quantized.push(quantizedValue);
        }
      }
    }
    
    return quantized;
  }

  /**
   * SIMD-accelerated quantization (simplified implementation)
   */
  private quantizeVectorSIMD(
    vector: Float32Array,
    min: number,
    max: number,
    bits: number
  ): number[] {
    const quantized: number[] = [];
    const levels = (1 << bits) - 1;
    const range = max - min;
    const invRange = range === 0 ? 0 : 1 / range;
    
    // Process in chunks of 4 for SIMD-like operations
    for (let i = 0; i < vector.length; i += 4) {
      const chunkSize = Math.min(4, vector.length - i);
      
      for (let j = 0; j < chunkSize; j++) {
        const value = vector[i + j];
        if (value === undefined) {
          throw new Error(`Vector value at index ${i + j} is undefined`);
        }
        const normalized = (value - min) * invRange;
        const quantizedValue = Math.max(0, Math.min(levels, Math.round(normalized * levels)));
        quantized.push(quantizedValue);
      }
    }
    
    return quantized;
  }

  /**
   * Pack compressed data into buffer
   */
  private packCompressedData(
    quantizedValues: number[],
    bounds: QuantizationBounds,
    bits: number,
    statistics: ReturnType<typeof calculateVectorStatistics>
  ): ArrayBuffer {
    // Calculate buffer sizes
    const dimension = quantizedValues.length;
    const dataSize = Math.ceil(dimension * bits / 8);
    const metadataSize = 128; // Fixed size for metadata
    const totalSize = dataSize + metadataSize;
    
    const buffer = new ArrayBuffer(totalSize);
    const metadataView = new DataView(buffer, 0, metadataSize);
    
    // Pack metadata (first 128 bytes)
    let offset = 0;
    
    // Header: version (4) + strategy (4) + bits (4) + dimension (4)
    metadataView.setUint32(offset, 1, true); offset += 4; // version
    metadataView.setUint32(offset, this.encodeStrategy(this.scalarConfig.strategy), true); offset += 4;
    metadataView.setUint32(offset, bits, true); offset += 4;
    metadataView.setUint32(offset, dimension, true); offset += 4;
    
    // Bounds: globalMin (4) + globalMax (4)
    metadataView.setFloat32(offset, bounds.globalMin, true); offset += 4;
    metadataView.setFloat32(offset, bounds.globalMax, true); offset += 4;
    
    // Statistics: min (4) + max (4) + mean (4) + std (4)
    metadataView.setFloat32(offset, statistics.min, true); offset += 4;
    metadataView.setFloat32(offset, statistics.max, true); offset += 4;
    metadataView.setFloat32(offset, statistics.mean, true); offset += 4;
    metadataView.setFloat32(offset, statistics.std, true); offset += 4;
    
    // Pack quantized data
    const quantizedBuffer = new ArrayBuffer(dataSize);
    packQuantizedValues(quantizedValues, bits, quantizedBuffer);
    
    // Copy quantized data to the main buffer
    const targetView = new Uint8Array(buffer, metadataSize);
    const sourceView = new Uint8Array(quantizedBuffer);
    targetView.set(sourceView);
    
    return buffer;
  }

  /**
   * Decompress data from buffer
   */
  private async decompressData(buffer: ArrayBuffer): Promise<Float32Array> {
    const metadataView = new DataView(buffer, 0, 128);
    
    // Read metadata
    let offset = 0;
    /* const version = */ metadataView.getUint32(offset, true); offset += 4;
    const strategyCode = metadataView.getUint32(offset, true); offset += 4;
    const bits = metadataView.getUint32(offset, true); offset += 4;
    const dimension = metadataView.getUint32(offset, true); offset += 4;
    
    const globalMin = metadataView.getFloat32(offset, true); offset += 4;
    const globalMax = metadataView.getFloat32(offset, true); offset += 4;
    
    // Skip statistics for now
    offset += 16;
    
    // Unpack quantized data
    const dataBuffer = buffer.slice(128);
    const quantizedValues = unpackQuantizedValues(dataBuffer, dimension, bits);
    
    // Dequantize values
    const result = new Float32Array(dimension);
    const strategy = this.decodeStrategy(strategyCode);
    
    if (strategy === 'uniform' || strategy === 'percentile') {
      // Global dequantization
      for (let i = 0; i < dimension; i++) {
        const quantizedValue = quantizedValues[i];
        if (quantizedValue === undefined) {
          throw new Error(`Quantized value at index ${i} is undefined`);
        }
        result[i] = dequantizeValue(quantizedValue, globalMin, globalMax, bits);
      }
    }
    
    return result;
  }

  /**
   * Encode strategy to number
   */
  private encodeStrategy(strategy: QuantizationStrategy): number {
    switch (strategy) {
      case 'uniform': return 0;
      case 'per-dimension': return 1;
      case 'percentile': return 2;
      default: return 0;
    }
  }

  /**
   * Decode strategy from number
   */
  private decodeStrategy(code: number): QuantizationStrategy {
    switch (code) {
      case 0: return 'uniform';
      case 1: return 'per-dimension';
      case 2: return 'percentile';
      default: return 'uniform';
    }
  }

  /**
   * Update scalar quantization configuration
   */
  updateScalarConfig(config: Partial<ScalarQuantizationConfig>): void {
    this.scalarConfig = { ...this.scalarConfig, ...config };
    this.updateConfig(config);
  }

  /**
   * Get scalar configuration
   */
  getScalarConfig(): ScalarQuantizationConfig {
    return { ...this.scalarConfig };
  }

  /**
   * Batch compress multiple vectors with shared statistics
   */
  async compressBatch(vectors: Float32Array[]): Promise<CompressedVector[]> {
    if (vectors.length === 0) {
      return [];
    }

    // Calculate shared bounds for better compression
    const bounds = this.calculateBounds(vectors);
    const firstVector = vectors[0];
    if (!firstVector) {
      throw new Error('No vectors provided for batch compression');
    }
    const bits = this.scalarConfig.adaptiveBits
      ? calculateOptimalBits(firstVector, this.scalarConfig.maxPrecisionLoss)
      : this.scalarConfig.bits;

    const results: CompressedVector[] = [];
    
    for (const vector of vectors) {
      const quantizedValues = await this.quantizeVector(vector, bounds, bits);
      const statistics = calculateVectorStatistics(vector);
      const compressedData = this.packCompressedData(quantizedValues, bounds, bits, statistics);
      
      const originalSize = vector.length * 4;
      const compressedSize = compressedData.byteLength;
      
      const metadata = this.createMetadata(
        originalSize,
        compressedSize,
        this.config.level,
        0 // Skip quality validation for batch operations
      );

      results.push({
        data: compressedData,
        metadata,
        dimension: vector.length,
        config: this.getConfig()
      });
    }
    
    return results;
  }
}