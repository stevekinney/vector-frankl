/**
 * Utility functions for vector compression
 */

export interface VectorStatistics {
  /** Minimum value in the vector */
  min: number;
  /** Maximum value in the vector */
  max: number;
  /** Mean value */
  mean: number;
  /** Standard deviation */
  std: number;
  /** Range (max - min) */
  range: number;
  /** Per-dimension statistics */
  dimensions?: DimensionStatistics[];
}

export interface DimensionStatistics {
  /** Dimension index */
  index: number;
  /** Minimum value for this dimension */
  min: number;
  /** Maximum value for this dimension */
  max: number;
  /** Mean value for this dimension */
  mean: number;
  /** Standard deviation for this dimension */
  std: number;
}

export interface QuantizationBounds {
  /** Global minimum value */
  globalMin: number;
  /** Global maximum value */
  globalMax: number;
  /** Per-dimension bounds */
  dimensionBounds?: Array<{ min: number; max: number }>;
  /** Percentile-based bounds */
  percentileBounds?: { min: number; max: number };
}

/**
 * Calculate comprehensive statistics for a vector
 */
export function calculateVectorStatistics(vector: Float32Array): VectorStatistics {
  const length = vector.length;
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;

  // First pass: min, max, mean
  for (let i = 0; i < length; i++) {
    const value = vector[i]!; // Safe since we're within bounds
    min = Math.min(min, value);
    max = Math.max(max, value);
    sum += value;
  }

  const mean = sum / length;

  // Second pass: standard deviation
  let variance = 0;
  for (let i = 0; i < length; i++) {
    const diff = vector[i]! - mean; // Safe since we're within bounds
    variance += diff * diff;
  }
  const std = Math.sqrt(variance / length);

  return {
    min,
    max,
    mean,
    std,
    range: max - min,
  };
}

/**
 * Calculate statistics for multiple vectors (batch processing)
 */
export function calculateBatchStatistics(vectors: Float32Array[]): VectorStatistics {
  if (vectors.length === 0) {
    throw new Error('Cannot calculate statistics for empty vector array');
  }

  const firstVector = vectors[0];
  if (!firstVector) {
    throw new Error('No vectors provided for batch statistics');
  }
  const dimension = firstVector.length;
  const totalElements = vectors.length * dimension;

  let globalMin = Infinity;
  let globalMax = -Infinity;
  let globalSum = 0;

  // Per-dimension statistics
  const dimensionStats: DimensionStatistics[] = [];
  for (let d = 0; d < dimension; d++) {
    dimensionStats[d] = {
      index: d,
      min: Infinity,
      max: -Infinity,
      mean: 0,
      std: 0,
    };
  }

  // First pass: collect min/max/sum for global and per-dimension
  for (const vector of vectors) {
    if (vector.length !== dimension) {
      throw new Error('All vectors must have the same dimension');
    }

    for (let d = 0; d < dimension; d++) {
      const value = vector[d]!; // Safe since we're within bounds

      // Global statistics
      globalMin = Math.min(globalMin, value);
      globalMax = Math.max(globalMax, value);
      globalSum += value;

      // Per-dimension statistics
      const dimStat = dimensionStats[d]!; // Safe since we allocated array
      dimStat.min = Math.min(dimStat.min, value);
      dimStat.max = Math.max(dimStat.max, value);
      dimStat.mean += value;
    }
  }

  // Calculate means
  const globalMean = globalSum / totalElements;
  for (let d = 0; d < dimension; d++) {
    const dimStat = dimensionStats[d]!; // Safe since we allocated array
    dimStat.mean /= vectors.length;
  }

  // Second pass: calculate standard deviations
  let globalVariance = 0;
  const dimensionVariances = new Array(dimension).fill(0);

  for (const vector of vectors) {
    for (let d = 0; d < dimension; d++) {
      const value = vector[d]!; // Safe since we're within bounds

      // Global variance
      const globalDiff = value - globalMean;
      globalVariance += globalDiff * globalDiff;

      // Per-dimension variance
      const dimMean = dimensionStats[d]!.mean; // Safe since we allocated array
      const dimDiff = value - dimMean;
      dimensionVariances[d]! += dimDiff * dimDiff; // Safe since we allocated array
    }
  }

  const globalStd = Math.sqrt(globalVariance / totalElements);
  for (let d = 0; d < dimension; d++) {
    const dimStat = dimensionStats[d]!; // Safe since we allocated array
    dimStat.std = Math.sqrt(dimensionVariances[d]! / vectors.length); // Safe since we allocated array
  }

  return {
    min: globalMin,
    max: globalMax,
    mean: globalMean,
    std: globalStd,
    range: globalMax - globalMin,
    dimensions: dimensionStats,
  };
}

/**
 * Calculate quantization bounds using different strategies
 */
export function calculateQuantizationBounds(
  vectors: Float32Array[],
  strategy: 'global' | 'per-dimension' | 'percentile' = 'global',
  percentileRange: [number, number] = [0.01, 0.99],
): QuantizationBounds {
  const stats = calculateBatchStatistics(vectors);

  const bounds: QuantizationBounds = {
    globalMin: stats.min,
    globalMax: stats.max,
  };

  if (strategy === 'per-dimension' && stats.dimensions) {
    bounds.dimensionBounds = stats.dimensions.map((dim) => ({
      min: dim.min,
      max: dim.max,
    }));
  }

  if (strategy === 'percentile') {
    const allValues: number[] = [];
    for (const vector of vectors) {
      for (let i = 0; i < vector.length; i++) {
        allValues.push(vector[i]!); // Safe since we're within bounds
      }
    }

    allValues.sort((a, b) => a - b);
    const lowerIndex = Math.floor(allValues.length * percentileRange[0]);
    const upperIndex = Math.floor(allValues.length * percentileRange[1]);

    bounds.percentileBounds = {
      min: allValues[lowerIndex]!,
      max: allValues[upperIndex]!,
    };
  }

  return bounds;
}

/**
 * Quantize a float32 value to n-bit integer
 */
export function quantizeValue(
  value: number,
  min: number,
  max: number,
  bits: number,
): number {
  const levels = (1 << bits) - 1; // 2^bits - 1
  const range = max - min;

  if (range === 0) return 0;

  const normalized = (value - min) / range;
  const quantized = Math.round(normalized * levels);

  return Math.max(0, Math.min(levels, quantized));
}

/**
 * Dequantize an n-bit integer back to float32
 */
export function dequantizeValue(
  quantized: number,
  min: number,
  max: number,
  bits: number,
): number {
  const levels = (1 << bits) - 1;
  const range = max - min;

  if (range === 0) return min;

  const normalized = quantized / levels;
  return min + normalized * range;
}

/**
 * Calculate optimal bit allocation for given precision loss
 */
export function calculateOptimalBits(
  vector: Float32Array,
  targetPrecisionLoss: number,
): number {
  const stats = calculateVectorStatistics(vector);

  // Determine bits based on precision requirements
  let bits: number;

  if (targetPrecisionLoss < 0.001) {
    bits = 16;
  } else if (targetPrecisionLoss < 0.01) {
    bits = 12;
  } else if (targetPrecisionLoss < 0.05) {
    bits = 8;
  } else {
    bits = 4;
  }

  // Adjust based on dynamic range
  const dynamicRange = stats.range;
  if (dynamicRange > 1000) {
    bits = Math.max(bits, 12);
  } else if (dynamicRange > 100) {
    bits = Math.max(bits, 8);
  }

  return Math.max(4, Math.min(16, bits));
}

/**
 * Estimate memory usage for compressed vector
 */
export function estimateMemoryUsage(
  dimension: number,
  bits: number,
  includeBounds: boolean = true,
): number {
  // Vector data: dimension * bits / 8 bytes
  let bytes = Math.ceil((dimension * bits) / 8);

  // Add bounds storage (min/max values)
  if (includeBounds) {
    bytes += 8; // 2 * Float32 (4 bytes each)
  }

  // Add padding for alignment
  bytes = Math.ceil(bytes / 4) * 4;

  return bytes;
}

/**
 * Create typed array for quantized data
 */
export function createQuantizedArray(dimension: number, bits: number): ArrayBuffer {
  const totalBits = dimension * bits;
  const totalBytes = Math.ceil(totalBits / 8);

  return new ArrayBuffer(totalBytes);
}

/**
 * Pack quantized values into bit-packed buffer
 */
export function packQuantizedValues(
  values: number[],
  bits: number,
  buffer: ArrayBuffer,
): void {
  const view = new Uint8Array(buffer);
  let bitOffset = 0;

  for (const value of values) {
    // Pack value into buffer starting at bitOffset, spanning as many bytes as needed
    let remaining = bits;
    let currentBit = bitOffset;

    while (remaining > 0) {
      const byteIndex = Math.floor(currentBit / 8);
      const bitPosInByte = currentBit % 8;
      const availableInByte = 8 - bitPosInByte;
      const bitsToWrite = Math.min(remaining, availableInByte);

      // Extract the relevant bits from value (MSB-first)
      const shift = remaining - bitsToWrite;
      const mask = (1 << bitsToWrite) - 1;
      const fragment = (value >> shift) & mask;

      // Place fragment into the correct position within the byte
      if (byteIndex < view.length) {
        view[byteIndex]! |= fragment << (availableInByte - bitsToWrite);
      }

      remaining -= bitsToWrite;
      currentBit += bitsToWrite;
    }

    bitOffset += bits;
  }
}

/**
 * Unpack quantized values from bit-packed buffer
 */
export function unpackQuantizedValues(
  buffer: ArrayBuffer,
  dimension: number,
  bits: number,
): number[] {
  const view = new Uint8Array(buffer);
  const values: number[] = [];
  let bitOffset = 0;

  for (let i = 0; i < dimension; i++) {
    let value = 0;
    let remaining = bits;
    let currentBit = bitOffset;

    while (remaining > 0) {
      const byteIndex = Math.floor(currentBit / 8);
      const bitPosInByte = currentBit % 8;
      const availableInByte = 8 - bitPosInByte;
      const bitsToRead = Math.min(remaining, availableInByte);

      // Read fragment from the correct position within the byte
      const shift = availableInByte - bitsToRead;
      const mask = (1 << bitsToRead) - 1;
      const fragment = byteIndex < view.length ? (view[byteIndex]! >> shift) & mask : 0;

      // Place fragment into value (MSB-first)
      value = (value << bitsToRead) | fragment;

      remaining -= bitsToRead;
      currentBit += bitsToRead;
    }

    values.push(value);
    bitOffset += bits;
  }

  return values;
}
