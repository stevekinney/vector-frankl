/**
 * Base compression interface for vector data
 */

export interface CompressionMetadata {
  /** Original vector size in bytes */
  originalSize: number;
  /** Compressed data size in bytes */
  compressedSize: number;
  /** Compression ratio (originalSize / compressedSize) */
  compressionRatio: number;
  /** Compression algorithm used */
  algorithm: string;
  /** Compression level (0-10) */
  level: number;
  /** Estimated precision loss (0-1) */
  precisionLoss: number;
  /** Timestamp of compression */
  timestamp: number;
}

export interface CompressionConfig {
  /** Compression level (0 = fastest, 10 = best compression) */
  level?: number;
  /** Target compression ratio (if achievable) */
  targetRatio?: number;
  /** Maximum acceptable precision loss (0-1) */
  maxPrecisionLoss?: number;
  /** Enable quality validation */
  validateQuality?: boolean;
}

export interface CompressionQuality {
  /** Signal-to-noise ratio */
  snr: number;
  /** Mean squared error */
  mse: number;
  /** Cosine similarity preservation */
  cosineSimilarity: number;
  /** Euclidean distance preservation */
  euclideanError: number;
  /** Overall quality score (0-1) */
  qualityScore: number;
}

export interface CompressedVector {
  /** Compressed data buffer */
  data: ArrayBuffer;
  /** Compression metadata */
  metadata: CompressionMetadata;
  /** Original vector dimension */
  dimension: number;
  /** Compression configuration used */
  config: CompressionConfig;
}

/**
 * Base abstract class for vector compression algorithms
 */
export abstract class BaseCompressor {
  protected config: Required<CompressionConfig>;

  constructor(config: CompressionConfig = {}) {
    this.config = {
      level: config.level ?? 5,
      targetRatio: config.targetRatio ?? 2.0,
      maxPrecisionLoss: config.maxPrecisionLoss ?? 0.05,
      validateQuality: config.validateQuality ?? true,
    };
  }

  /**
   * Compress a vector
   */
  abstract compress(vector: Float32Array): Promise<CompressedVector>;

  /**
   * Decompress a vector
   */
  abstract decompress(compressed: CompressedVector): Promise<Float32Array>;

  /**
   * Get compression algorithm name
   */
  abstract getAlgorithmName(): string;

  /**
   * Estimate compressed size before compression
   */
  abstract estimateCompressedSize(vector: Float32Array): number;

  /**
   * Validate compression quality
   */
  protected async validateCompressionQuality(
    original: Float32Array,
    decompressed: Float32Array,
  ): Promise<CompressionQuality> {
    const mse = this.calculateMSE(original, decompressed);
    const snr = this.calculateSNR(original, decompressed);
    const cosineSimilarity = this.calculateCosineSimilarity(original, decompressed);
    const euclideanError = this.calculateEuclideanError(original, decompressed);

    // Calculate overall quality score (weighted combination)
    const qualityScore =
      0.3 * Math.max(0, 1 - mse) +
      0.3 * Math.max(0, Math.min(1, snr / 20)) +
      0.4 * cosineSimilarity;

    return {
      snr,
      mse,
      cosineSimilarity,
      euclideanError,
      qualityScore,
    };
  }

  /**
   * Calculate Mean Squared Error
   */
  private calculateMSE(original: Float32Array, decompressed: Float32Array): number {
    if (original.length !== decompressed.length) {
      throw new Error('Array lengths must match for MSE calculation');
    }

    let sum = 0;
    for (let i = 0; i < original.length; i++) {
      const diff = original[i]! - decompressed[i]!; // Safe after length check
      sum += diff * diff;
    }
    return sum / original.length;
  }

  /**
   * Calculate Signal-to-Noise Ratio
   */
  private calculateSNR(original: Float32Array, decompressed: Float32Array): number {
    const mse = this.calculateMSE(original, decompressed);
    if (mse === 0) return Infinity;

    let signalPower = 0;
    for (let i = 0; i < original.length; i++) {
      const value = original[i]!; // Safe since MSE already validated array length
      signalPower += value * value;
    }
    signalPower /= original.length;

    return 10 * Math.log10(signalPower / mse);
  }

  /**
   * Calculate cosine similarity
   */
  private calculateCosineSimilarity(
    original: Float32Array,
    decompressed: Float32Array,
  ): number {
    if (original.length !== decompressed.length) {
      throw new Error('Array lengths must match for cosine similarity calculation');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < original.length; i++) {
      const a = original[i]!; // Safe after length check
      const b = decompressed[i]!; // Safe after length check
      dotProduct += a * b;
      normA += a * a;
      normB += b * b;
    }

    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Calculate Euclidean distance error
   */
  private calculateEuclideanError(
    original: Float32Array,
    decompressed: Float32Array,
  ): number {
    if (original.length !== decompressed.length) {
      throw new Error('Array lengths must match for Euclidean error calculation');
    }

    let sum = 0;
    for (let i = 0; i < original.length; i++) {
      const diff = original[i]! - decompressed[i]!; // Safe after length check
      sum += diff * diff;
    }
    return Math.sqrt(sum);
  }

  /**
   * Create compression metadata
   */
  protected createMetadata(
    originalSize: number,
    compressedSize: number,
    level: number,
    precisionLoss: number,
  ): CompressionMetadata {
    return {
      originalSize,
      compressedSize,
      compressionRatio: originalSize / compressedSize,
      algorithm: this.getAlgorithmName(),
      level,
      precisionLoss,
      timestamp: Date.now(),
    };
  }

  /**
   * Get current configuration
   */
  getConfig(): CompressionConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<CompressionConfig>): void {
    this.config = { ...this.config, ...config };
  }
}
