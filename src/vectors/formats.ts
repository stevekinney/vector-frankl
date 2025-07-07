import { InvalidFormatError, DimensionMismatchError } from '@/core/errors.js';
import type { VectorFormat } from '@/core/types.js';

/**
 * Vector format detection and conversion utilities
 * Enhanced with comprehensive validation and error handling
 */
export class VectorFormatHandler {
  private static readonly SUPPORTED_FORMATS = [
    'float32',
    'float64',
    'int8',
    'uint8',
    'array',
    'binary'
  ] as const;

  /**
   * Detect the format of a vector with enhanced validation
   */
  static detectFormat(vector: VectorFormat): string {
    // Check for null/undefined
    if (vector === null || vector === undefined) {
      throw new InvalidFormatError('null_or_undefined', this.SUPPORTED_FORMATS as unknown as string[]);
    }

    // Check for empty vectors
    if (vector.length === 0) {
      throw new InvalidFormatError('empty_vector', this.SUPPORTED_FORMATS as unknown as string[]);
    }

    // Check for non-numeric arrays
    if (Array.isArray(vector)) {
      const hasNonNumeric = vector.some(v => typeof v !== 'number');
      if (hasNonNumeric) {
        throw new InvalidFormatError('array_with_non_numeric_values', this.SUPPORTED_FORMATS as unknown as string[]);
      }
      return 'array';
    }

    // Typed array detection with validation
    if (vector instanceof Float32Array) {
      this.validateTypedArray(vector, 'float32');
      return 'float32';
    }
    if (vector instanceof Float64Array) {
      this.validateTypedArray(vector, 'float64');
      return 'float64';
    }
    if (vector instanceof Int8Array) {
      this.validateTypedArray(vector, 'int8');
      return 'int8';
    }
    if (vector instanceof Uint8Array) {
      this.validateTypedArray(vector, 'uint8');
      // Check if it's binary (all 0 or 1) or quantized
      const isBinary = Array.from(vector).every(v => v === 0 || v === 1);
      return isBinary ? 'binary' : 'uint8';
    }
    
    throw new InvalidFormatError(`unsupported_type_${typeof vector}`, this.SUPPORTED_FORMATS as unknown as string[]);
  }

  /**
   * Convert vector to Float32Array (default storage format)
   */
  static toFloat32Array(vector: VectorFormat): Float32Array {
    const format = this.detectFormat(vector);

    switch (format) {
      case 'float32':
        return vector as Float32Array;
      
      case 'float64':
        return new Float32Array(vector as Float64Array);
      
      case 'array':
        return new Float32Array(vector as number[]);
      
      case 'int8': {
        const int8Vector = vector as Int8Array;
        const float32 = new Float32Array(int8Vector.length);
        // Assume int8 is quantized, scale back to [-1, 1]
        for (let i = 0; i < int8Vector.length; i++) {
          float32[i] = int8Vector[i]! / 127;
        }
        return float32;
      }
      
      case 'uint8': {
        const uint8Vector = vector as Uint8Array;
        const float32 = new Float32Array(uint8Vector.length);
        // Assume uint8 is quantized, scale back to [0, 1]
        for (let i = 0; i < uint8Vector.length; i++) {
          float32[i] = uint8Vector[i]! / 255;
        }
        return float32;
      }
      
      case 'binary': {
        // Binary vectors: 0 or 1 values
        return new Float32Array(vector as Uint8Array);
      }
      
      default:
        throw new InvalidFormatError(format, this.SUPPORTED_FORMATS as unknown as string[]);
    }
  }

  /**
   * Convert Float32Array to target format
   */
  static fromFloat32Array(vector: Float32Array, targetFormat: string): VectorFormat {
    switch (targetFormat) {
      case 'float32':
        return vector;
      
      case 'float64':
        return new Float64Array(vector);
      
      case 'array':
        return Array.from(vector);
      
      case 'int8': {
        const int8 = new Int8Array(vector.length);
        for (let i = 0; i < vector.length; i++) {
          // Clamp to [-1, 1] and scale to [-127, 127]
          const clamped = Math.max(-1, Math.min(1, vector[i]!));
          int8[i] = Math.round(clamped * 127);
        }
        return int8;
      }
      
      case 'uint8': {
        const uint8 = new Uint8Array(vector.length);
        for (let i = 0; i < vector.length; i++) {
          // Clamp to [0, 1] and scale to [0, 255]
          const clamped = Math.max(0, Math.min(1, vector[i]!));
          uint8[i] = Math.round(clamped * 255);
        }
        return uint8;
      }
      
      case 'binary': {
        const binary = new Uint8Array(vector.length);
        for (let i = 0; i < vector.length; i++) {
          binary[i] = vector[i]! > 0 ? 1 : 0;
        }
        return binary;
      }
      
      default:
        throw new InvalidFormatError(targetFormat, this.SUPPORTED_FORMATS as unknown as string[]);
    }
  }

  /**
   * Validate typed arrays for NaN/Infinity values - only in strict mode
   */
  private static validateTypedArray(_vector: Float32Array | Float64Array | Int8Array | Uint8Array, _format: string): void {
    // We'll handle invalid values in the validate method instead to allow more control
  }

  /**
   * Enhanced vector validation with comprehensive checks
   */
  static validate(vector: VectorFormat, expectedDimension?: number, options: {
    allowInfinity?: boolean;
    allowNaN?: boolean;
    maxDimension?: number;
    minDimension?: number;
    requireNormalized?: boolean;
    maxMemoryMB?: number;
  } = {}): void {
    const format = this.detectFormat(vector);
    
    const supportedFormats: readonly string[] = this.SUPPORTED_FORMATS;
    if (!supportedFormats.includes(format)) {
      throw new InvalidFormatError(format, [...this.SUPPORTED_FORMATS]);
    }

    // Dimension validation with security limits
    const actualDimension = vector.length;
    
    // Apply default security limits to prevent memory exhaustion
    const DEFAULT_MAX_DIMENSION = 100000; // 100k dimensions max
    const DEFAULT_MIN_DIMENSION = 1;
    const DEFAULT_MAX_MEMORY_MB = 512; // 512MB max per vector
    
    const maxDimension = options.maxDimension ?? DEFAULT_MAX_DIMENSION;
    const minDimension = options.minDimension ?? DEFAULT_MIN_DIMENSION;
    const maxMemoryMB = options.maxMemoryMB ?? DEFAULT_MAX_MEMORY_MB;
    
    if (expectedDimension !== undefined && actualDimension !== expectedDimension) {
      throw new DimensionMismatchError(expectedDimension, actualDimension);
    }

    if (actualDimension < minDimension) {
      throw new Error(`Vector dimension too small: minimum ${minDimension}, got ${actualDimension}`);
    }

    if (actualDimension > maxDimension) {
      throw new Error(`Vector dimension too large: maximum ${maxDimension}, got ${actualDimension}`);
    }

    // Memory consumption validation
    const byteSize = this.getByteSize(vector);
    const memorySizeMB = byteSize / (1024 * 1024);
    
    if (memorySizeMB > maxMemoryMB) {
      throw new Error(`Vector memory consumption too large: ${memorySizeMB.toFixed(2)}MB exceeds maximum ${maxMemoryMB}MB`);
    }

    // Value validation for floating point vectors
    if (format === 'float32' || format === 'float64' || format === 'array') {
      const values = Array.from(vector as Float32Array | Float64Array | number[]);
      
      if (!options.allowNaN && values.some(v => isNaN(v))) {
        throw new Error('Vector contains NaN values');
      }
      
      if (!options.allowInfinity && values.some(v => !isFinite(v) && !isNaN(v))) {
        throw new Error('Vector contains infinite values');
      }

      // Check if normalization is required
      if (options.requireNormalized) {
        const magnitude = Math.sqrt(values.reduce((sum, v) => sum + v * v, 0));
        const tolerance = 1e-6;
        if (Math.abs(magnitude - 1.0) > tolerance) {
          throw new Error(`Vector is not normalized: magnitude is ${magnitude.toFixed(6)}, expected 1.0`);
        }
      }
    }

    // Binary vector validation
    if (format === 'binary') {
      const invalidValues = Array.from(vector as Uint8Array).filter(v => v !== 0 && v !== 1);
      if (invalidValues.length > 0) {
        throw new Error(`Binary vector contains non-binary values: ${invalidValues.slice(0, 5).join(', ')}${invalidValues.length > 5 ? '...' : ''}`);
      }
    }
  }

  /**
   * Get the byte size of a vector
   */
  static getByteSize(vector: VectorFormat): number {
    const format = this.detectFormat(vector);
    const length = vector.length;

    switch (format) {
      case 'float32':
        return length * 4;
      case 'float64':
        return length * 8;
      case 'int8':
      case 'uint8':
      case 'binary':
        return length;
      case 'array':
        // Assume JavaScript numbers are 64-bit floats
        return length * 8;
      default:
        return 0;
    }
  }

  /**
   * Create a zero vector of specified format and dimension
   */
  static createZeroVector(dimension: number, format: string = 'float32'): VectorFormat {
    // Validate dimension to prevent memory exhaustion
    const DEFAULT_MAX_DIMENSION = 100000; // 100k dimensions max
    const DEFAULT_MIN_DIMENSION = 1;
    
    if (dimension < DEFAULT_MIN_DIMENSION) {
      throw new Error(`Vector dimension too small: minimum ${DEFAULT_MIN_DIMENSION}, got ${dimension}`);
    }
    
    if (dimension > DEFAULT_MAX_DIMENSION) {
      throw new Error(`Vector dimension too large: maximum ${DEFAULT_MAX_DIMENSION}, got ${dimension}`);
    }
    
    // Calculate memory usage and validate
    let bytesPerElement: number;
    switch (format) {
      case 'float32':
        bytesPerElement = 4;
        break;
      case 'float64':
        bytesPerElement = 8;
        break;
      case 'int8':
      case 'uint8':
      case 'binary':
        bytesPerElement = 1;
        break;
      case 'array':
        bytesPerElement = 8; // JavaScript numbers are 64-bit
        break;
      default:
        throw new InvalidFormatError(format, this.SUPPORTED_FORMATS as unknown as string[]);
    }
    
    const totalMemoryMB = (dimension * bytesPerElement) / (1024 * 1024);
    const DEFAULT_MAX_MEMORY_MB = 512; // 512MB max per vector
    
    if (totalMemoryMB > DEFAULT_MAX_MEMORY_MB) {
      throw new Error(`Vector memory consumption too large: ${totalMemoryMB.toFixed(2)}MB exceeds maximum ${DEFAULT_MAX_MEMORY_MB}MB`);
    }
    
    switch (format) {
      case 'float32':
        return new Float32Array(dimension);
      case 'float64':
        return new Float64Array(dimension);
      case 'int8':
        return new Int8Array(dimension);
      case 'uint8':
      case 'binary':
        return new Uint8Array(dimension);
      case 'array':
        return new Array(dimension).fill(0);
      default:
        throw new InvalidFormatError(format, this.SUPPORTED_FORMATS as unknown as string[]);
    }
  }

  /**
   * Clone a vector
   */
  static clone(vector: VectorFormat): VectorFormat {
    const format = this.detectFormat(vector);

    switch (format) {
      case 'float32':
        return new Float32Array(vector as Float32Array);
      case 'float64':
        return new Float64Array(vector as Float64Array);
      case 'int8':
        return new Int8Array(vector as Int8Array);
      case 'uint8':
      case 'binary':
        return new Uint8Array(vector as Uint8Array);
      case 'array':
        return [...(vector as number[])];
      default:
        throw new InvalidFormatError(format, this.SUPPORTED_FORMATS as unknown as string[]);
    }
  }

  /**
   * Normalize a vector to unit length
   */
  static normalize(vector: VectorFormat): VectorFormat {
    const float32Vector = this.toFloat32Array(vector);
    
    // Calculate magnitude
    let magnitude = 0;
    for (let i = 0; i < float32Vector.length; i++) {
      magnitude += float32Vector[i]! * float32Vector[i]!;
    }
    magnitude = Math.sqrt(magnitude);
    
    // Handle zero vector
    if (magnitude === 0) {
      throw new Error('Cannot normalize zero vector');
    }
    
    // Normalize
    const normalized = new Float32Array(float32Vector.length);
    for (let i = 0; i < float32Vector.length; i++) {
      normalized[i] = float32Vector[i]! / magnitude;
    }
    
    // Convert back to original format if needed
    const originalFormat = this.detectFormat(vector);
    return this.fromFloat32Array(normalized, originalFormat);
  }

  /**
   * Check if two vectors are approximately equal
   */
  static isEqual(a: VectorFormat, b: VectorFormat, tolerance: number = 1e-6): boolean {
    if (a.length !== b.length) {
      return false;
    }
    
    const arrayA = this.toFloat32Array(a);
    const arrayB = this.toFloat32Array(b);
    
    for (let i = 0; i < arrayA.length; i++) {
      if (Math.abs(arrayA[i]! - arrayB[i]!) > tolerance) {
        return false;
      }
    }
    
    return true;
  }

  /**
   * Get comprehensive information about a vector
   */
  static getVectorInfo(vector: VectorFormat): {
    format: string;
    dimension: number;
    byteSize: number;
    magnitude: number;
    isNormalized: boolean;
    hasInvalidValues: boolean;
    range: { min: number; max: number };
    stats: { mean: number; std: number };
  } {
    const format = this.detectFormat(vector);
    const dimension = vector.length;
    const byteSize = this.getByteSize(vector);
    const float32Vector = this.toFloat32Array(vector);
    
    // Calculate magnitude
    let magnitude = 0;
    for (let i = 0; i < float32Vector.length; i++) {
      magnitude += float32Vector[i]! * float32Vector[i]!;
    }
    magnitude = Math.sqrt(magnitude);
    
    // Check if normalized (within tolerance)
    const isNormalized = Math.abs(magnitude - 1.0) < 1e-6;
    
    // Check for invalid values
    const hasInvalidValues = Array.from(float32Vector).some(v => !isFinite(v));
    
    // Calculate range
    const values = Array.from(float32Vector);
    const min = Math.min(...values);
    const max = Math.max(...values);
    
    // Calculate statistics
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
    const std = Math.sqrt(variance);
    
    return {
      format,
      dimension,
      byteSize,
      magnitude,
      isNormalized,
      hasInvalidValues,
      range: { min, max },
      stats: { mean, std }
    };
  }

  /**
   * Auto-detect the best format for a vector based on its characteristics
   */
  static suggestOptimalFormat(vector: VectorFormat): {
    recommendedFormat: string;
    reasoning: string;
    compressionRatio?: number;
  } {
    const info = this.getVectorInfo(vector);
    
    // If already binary, keep as binary
    if (info.format === 'binary') {
      return {
        recommendedFormat: 'binary',
        reasoning: 'Already in optimal binary format'
      };
    }
    
    // Check if vector is effectively binary
    const float32Vector = this.toFloat32Array(vector);
    const isBinary = Array.from(float32Vector).every(v => v === 0 || v === 1);
    if (isBinary) {
      return {
        recommendedFormat: 'binary',
        reasoning: 'Vector contains only binary values (0 or 1)',
        compressionRatio: info.byteSize / info.dimension // 8x compression for float32
      };
    }
    
    // Check if values fit in uint8 range first (prefer uint8 over int8 for [0,1] range)
    const inUint8Range = Array.from(float32Vector).every(v => v >= 0 && v <= 1);
    const allPositive = Array.from(float32Vector).every(v => v >= 0);
    if (inUint8Range && allPositive && info.stats.std > 0.01) {
      return {
        recommendedFormat: 'uint8',
        reasoning: 'Values fit in [0, 1] range with sufficient precision for uint8 quantization',
        compressionRatio: info.byteSize / info.dimension // 4x compression for float32
      };
    }
    
    // Check if values fit in int8 range with minimal loss
    const inInt8Range = Array.from(float32Vector).every(v => v >= -1 && v <= 1);
    if (inInt8Range && info.stats.std > 0.01) {
      return {
        recommendedFormat: 'int8',
        reasoning: 'Values fit in [-1, 1] range with sufficient precision for int8 quantization',
        compressionRatio: info.byteSize / info.dimension // 4x compression for float32
      };
    }
    
    // Default to float32 for general use
    return {
      recommendedFormat: 'float32',
      reasoning: 'Values require full floating-point precision'
    };
  }
}