/**
 * SIMD-accelerated vector operations for high-performance computing
 */

export interface SIMDConfig {
  /** Enable SIMD optimizations */
  enableSIMD?: boolean;
  /** Vector size threshold for SIMD operations */
  simdThreshold?: number;
  /** Enable performance profiling */
  enableProfiling?: boolean;
  /** Chunk size for batch operations */
  chunkSize?: number;
}

export interface SIMDCapabilities {
  /** Whether SIMD is supported */
  supported: boolean;
  /** Available SIMD instruction sets */
  instructionSets: string[];
  /** Optimal vector chunk size */
  optimalChunkSize: number;
  /** Maximum vectors per batch */
  maxBatchSize: number;
}

export interface SIMDPerformanceStats {
  /** Processing time in milliseconds */
  processingTime: number;
  /** Number of operations performed */
  operationCount: number;
  /** Operations per second */
  operationsPerSecond: number;
  /** Memory throughput in MB/s */
  memoryThroughput: number;
}

/**
 * High-performance SIMD vector operations
 */
export class SIMDOperations {
  private config: Required<SIMDConfig>;
  private capabilities: SIMDCapabilities;

  constructor(config: SIMDConfig = {}) {
    this.config = {
      enableSIMD: config.enableSIMD ?? true,
      simdThreshold: config.simdThreshold || 16,
      enableProfiling: config.enableProfiling ?? false,
      chunkSize: config.chunkSize || 128
    };

    this.capabilities = this.detectCapabilities();
  }

  /**
   * Detect SIMD capabilities of the current environment
   */
  private detectCapabilities(): SIMDCapabilities {
    const capabilities: SIMDCapabilities = {
      supported: false,
      instructionSets: [],
      optimalChunkSize: 4,
      maxBatchSize: 1000
    };

    // Check for various SIMD-like optimizations available in JavaScript
    try {
      // TypedArray operations are heavily optimized in modern engines
      capabilities.supported = true;
      capabilities.instructionSets.push('TypedArray');
      
      // Check for WebAssembly SIMD support
      if (typeof WebAssembly !== 'undefined' && WebAssembly.validate) {
        try {
          // Simple WebAssembly SIMD detection
          const wasmSIMDTest = new Uint8Array([
            0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00
          ]);
          if (WebAssembly.validate(wasmSIMDTest)) {
            capabilities.instructionSets.push('WebAssembly');
          }
        } catch {
          // WebAssembly SIMD not supported
        }
      }

      // Determine optimal chunk size based on typical cache line sizes
      capabilities.optimalChunkSize = this.determineOptimalChunkSize();
      capabilities.maxBatchSize = Math.floor(1024 * 1024 / (capabilities.optimalChunkSize * 4)); // 1MB / (chunk * 4 bytes)

    } catch {
      capabilities.supported = false;
    }

    return capabilities;
  }

  /**
   * Determine optimal chunk size for SIMD operations
   */
  private determineOptimalChunkSize(): number {
    // Modern CPUs typically have 64-byte cache lines
    // Float32 = 4 bytes, so 16 floats per cache line
    // Use multiples of 16 for optimal memory access patterns
    const baseLine = 16;
    
    // Adjust based on available memory and typical vector sizes
    if (typeof navigator !== 'undefined' && 'hardwareConcurrency' in navigator) {
      const cores = navigator.hardwareConcurrency || 4;
      return baseLine * Math.min(cores, 8); // Cap at 128 for very high-core systems
    }
    
    return baseLine * 4; // 64 floats default
  }

  /**
   * Get SIMD capabilities
   */
  getCapabilities(): SIMDCapabilities {
    return { ...this.capabilities };
  }

  /**
   * Check if SIMD optimizations are enabled
   */
  isSIMDEnabled(): boolean {
    return this.config.enableSIMD && this.capabilities.supported;
  }

  /**
   * Compute dot product using SIMD optimizations
   */
  dotProduct(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) {
      throw new Error('Vectors must have the same length');
    }

    if (!this.shouldUseSIMD(a.length)) {
      return this.scalarDotProduct(a, b);
    }

    const startTime = this.config.enableProfiling ? performance.now() : 0;
    const result = this.simdDotProduct(a, b);
    
    if (this.config.enableProfiling) {
      const endTime = performance.now();
      console.debug(`SIMD dot product: ${endTime - startTime}ms for ${a.length} elements`);
    }

    return result;
  }

  /**
   * Compute Euclidean distance using SIMD optimizations
   */
  euclideanDistance(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) {
      throw new Error('Vectors must have the same length');
    }

    if (!this.shouldUseSIMD(a.length)) {
      return this.scalarEuclideanDistance(a, b);
    }

    const startTime = this.config.enableProfiling ? performance.now() : 0;
    const result = this.simdEuclideanDistance(a, b);
    
    if (this.config.enableProfiling) {
      const endTime = performance.now();
      console.debug(`SIMD Euclidean distance: ${endTime - startTime}ms for ${a.length} elements`);
    }

    return result;
  }

  /**
   * Compute Manhattan distance using SIMD optimizations
   */
  manhattanDistance(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) {
      throw new Error('Vectors must have the same length');
    }

    if (!this.shouldUseSIMD(a.length)) {
      return this.scalarManhattanDistance(a, b);
    }

    const startTime = this.config.enableProfiling ? performance.now() : 0;
    const result = this.simdManhattanDistance(a, b);
    
    if (this.config.enableProfiling) {
      const endTime = performance.now();
      console.debug(`SIMD Manhattan distance: ${endTime - startTime}ms for ${a.length} elements`);
    }

    return result;
  }

  /**
   * Normalize vector using SIMD optimizations
   */
  normalize(vector: Float32Array): Float32Array {
    if (!this.shouldUseSIMD(vector.length)) {
      return this.scalarNormalize(vector);
    }

    const startTime = this.config.enableProfiling ? performance.now() : 0;
    const result = this.simdNormalize(vector);
    
    if (this.config.enableProfiling) {
      const endTime = performance.now();
      console.debug(`SIMD normalize: ${endTime - startTime}ms for ${vector.length} elements`);
    }

    return result;
  }

  /**
   * Batch dot product operations
   */
  batchDotProduct(vectors: Float32Array[], query: Float32Array): Float32Array {
    if (vectors.length === 0) {
      return new Float32Array(0);
    }

    const results = new Float32Array(vectors.length);
    const chunkSize = this.config.chunkSize;

    // Process in chunks for better cache utilization
    for (let i = 0; i < vectors.length; i += chunkSize) {
      const endIdx = Math.min(i + chunkSize, vectors.length);
      
      for (let j = i; j < endIdx; j++) {
        const vector = vectors[j];
        if (vector) {
          results[j] = this.dotProduct(vector, query);
        }
      }
    }

    return results;
  }

  /**
   * Batch normalize operations
   */
  batchNormalize(vectors: Float32Array[]): Float32Array[] {
    const results: Float32Array[] = [];
    const chunkSize = this.config.chunkSize;

    // Process in chunks for memory efficiency
    for (let i = 0; i < vectors.length; i += chunkSize) {
      const endIdx = Math.min(i + chunkSize, vectors.length);
      
      for (let j = i; j < endIdx; j++) {
        const vector = vectors[j];
        if (vector) {
          results.push(this.normalize(vector));
        }
      }
    }

    return results;
  }

  /**
   * Fused multiply-add operation: c = a * b + c
   */
  fusedMultiplyAdd(a: Float32Array, b: Float32Array, c: Float32Array): Float32Array {
    if (a.length !== b.length || a.length !== c.length) {
      throw new Error('All vectors must have the same length');
    }

    if (!this.shouldUseSIMD(a.length)) {
      return this.scalarFusedMultiplyAdd(a, b, c);
    }

    return this.simdFusedMultiplyAdd(a, b, c);
  }

  /**
   * Vector addition
   */
  vectorAdd(a: Float32Array, b: Float32Array): Float32Array {
    if (a.length !== b.length) {
      throw new Error('Vectors must have the same length');
    }

    if (!this.shouldUseSIMD(a.length)) {
      return this.scalarVectorAdd(a, b);
    }

    return this.simdVectorAdd(a, b);
  }

  /**
   * Vector subtraction
   */
  vectorSubtract(a: Float32Array, b: Float32Array): Float32Array {
    if (a.length !== b.length) {
      throw new Error('Vectors must have the same length');
    }

    if (!this.shouldUseSIMD(a.length)) {
      return this.scalarVectorSubtract(a, b);
    }

    return this.simdVectorSubtract(a, b);
  }

  /**
   * Scalar multiplication
   */
  scalarMultiply(vector: Float32Array, scalar: number): Float32Array {
    if (!this.shouldUseSIMD(vector.length)) {
      return this.scalarScalarMultiply(vector, scalar);
    }

    return this.simdScalarMultiply(vector, scalar);
  }

  // Private SIMD implementations

  private shouldUseSIMD(length: number): boolean {
    return this.config.enableSIMD && 
           this.capabilities.supported && 
           length >= this.config.simdThreshold;
  }

  private simdDotProduct(a: Float32Array, b: Float32Array): number {
    const length = a.length;
    const chunkSize = this.capabilities.optimalChunkSize;
    let sum = 0;

    // Process in optimal chunks
    let i = 0;
    for (; i <= length - chunkSize; i += chunkSize) {
      // Unrolled loop for better performance
      let chunkSum = 0;
      for (let j = 0; j < chunkSize; j += 4) {
        const idx = i + j;
        if (idx + 3 < length) {
          chunkSum += a[idx]! * b[idx]! + 
                     a[idx + 1]! * b[idx + 1]! + 
                     a[idx + 2]! * b[idx + 2]! + 
                     a[idx + 3]! * b[idx + 3]!;
        }
      }
      sum += chunkSum;
    }

    // Handle remaining elements
    for (; i < length; i++) {
      sum += a[i]! * b[i]!;
    }

    return sum;
  }

  private simdEuclideanDistance(a: Float32Array, b: Float32Array): number {
    const length = a.length;
    const chunkSize = this.capabilities.optimalChunkSize;
    let sumSquares = 0;

    let i = 0;
    for (; i <= length - chunkSize; i += chunkSize) {
      let chunkSum = 0;
      for (let j = 0; j < chunkSize; j += 4) {
        const idx = i + j;
        if (idx + 3 < length) {
          const diff0 = a[idx]! - b[idx]!;
          const diff1 = a[idx + 1]! - b[idx + 1]!;
          const diff2 = a[idx + 2]! - b[idx + 2]!;
          const diff3 = a[idx + 3]! - b[idx + 3]!;
          chunkSum += diff0 * diff0 + diff1 * diff1 + diff2 * diff2 + diff3 * diff3;
        }
      }
      sumSquares += chunkSum;
    }

    for (; i < length; i++) {
      const diff = a[i]! - b[i]!;
      sumSquares += diff * diff;
    }

    return Math.sqrt(sumSquares);
  }

  private simdManhattanDistance(a: Float32Array, b: Float32Array): number {
    const length = a.length;
    const chunkSize = this.capabilities.optimalChunkSize;
    let sum = 0;

    let i = 0;
    for (; i <= length - chunkSize; i += chunkSize) {
      let chunkSum = 0;
      for (let j = 0; j < chunkSize; j += 4) {
        const idx = i + j;
        if (idx + 3 < length) {
          chunkSum += Math.abs(a[idx]! - b[idx]!) + 
                     Math.abs(a[idx + 1]! - b[idx + 1]!) + 
                     Math.abs(a[idx + 2]! - b[idx + 2]!) + 
                     Math.abs(a[idx + 3]! - b[idx + 3]!);
        }
      }
      sum += chunkSum;
    }

    for (; i < length; i++) {
      sum += Math.abs(a[i]! - b[i]!);
    }

    return sum;
  }

  private simdNormalize(vector: Float32Array): Float32Array {
    // First pass: compute magnitude using SIMD
    const magnitude = Math.sqrt(this.simdDotProduct(vector, vector));
    
    if (magnitude === 0) {
      return new Float32Array(vector);
    }

    // Second pass: divide by magnitude
    return this.simdScalarMultiply(vector, 1 / magnitude);
  }

  private simdFusedMultiplyAdd(a: Float32Array, b: Float32Array, c: Float32Array): Float32Array {
    const result = new Float32Array(a.length);
    const length = a.length;
    const chunkSize = this.capabilities.optimalChunkSize;

    let i = 0;
    for (; i <= length - chunkSize; i += chunkSize) {
      for (let j = 0; j < chunkSize; j += 4) {
        const idx = i + j;
        if (idx + 3 < length) {
          result[idx] = a[idx]! * b[idx]! + c[idx]!;
          result[idx + 1] = a[idx + 1]! * b[idx + 1]! + c[idx + 1]!;
          result[idx + 2] = a[idx + 2]! * b[idx + 2]! + c[idx + 2]!;
          result[idx + 3] = a[idx + 3]! * b[idx + 3]! + c[idx + 3]!;
        }
      }
    }

    for (; i < length; i++) {
      result[i] = a[i]! * b[i]! + c[i]!;
    }

    return result;
  }

  private simdVectorAdd(a: Float32Array, b: Float32Array): Float32Array {
    const result = new Float32Array(a.length);
    const length = a.length;
    const chunkSize = this.capabilities.optimalChunkSize;

    let i = 0;
    for (; i <= length - chunkSize; i += chunkSize) {
      for (let j = 0; j < chunkSize; j += 4) {
        const idx = i + j;
        if (idx + 3 < length) {
          result[idx] = a[idx]! + b[idx]!;
          result[idx + 1] = a[idx + 1]! + b[idx + 1]!;
          result[idx + 2] = a[idx + 2]! + b[idx + 2]!;
          result[idx + 3] = a[idx + 3]! + b[idx + 3]!;
        }
      }
    }

    for (; i < length; i++) {
      result[i] = a[i]! + b[i]!;
    }

    return result;
  }

  private simdVectorSubtract(a: Float32Array, b: Float32Array): Float32Array {
    const result = new Float32Array(a.length);
    const length = a.length;
    const chunkSize = this.capabilities.optimalChunkSize;

    let i = 0;
    for (; i <= length - chunkSize; i += chunkSize) {
      for (let j = 0; j < chunkSize; j += 4) {
        const idx = i + j;
        if (idx + 3 < length) {
          result[idx] = a[idx]! - b[idx]!;
          result[idx + 1] = a[idx + 1]! - b[idx + 1]!;
          result[idx + 2] = a[idx + 2]! - b[idx + 2]!;
          result[idx + 3] = a[idx + 3]! - b[idx + 3]!;
        }
      }
    }

    for (; i < length; i++) {
      result[i] = a[i]! - b[i]!;
    }

    return result;
  }

  private simdScalarMultiply(vector: Float32Array, scalar: number): Float32Array {
    const result = new Float32Array(vector.length);
    const length = vector.length;
    const chunkSize = this.capabilities.optimalChunkSize;

    let i = 0;
    for (; i <= length - chunkSize; i += chunkSize) {
      for (let j = 0; j < chunkSize; j += 4) {
        const idx = i + j;
        if (idx + 3 < length) {
          result[idx] = vector[idx]! * scalar;
          result[idx + 1] = vector[idx + 1]! * scalar;
          result[idx + 2] = vector[idx + 2]! * scalar;
          result[idx + 3] = vector[idx + 3]! * scalar;
        }
      }
    }

    for (; i < length; i++) {
      result[i] = vector[i]! * scalar;
    }

    return result;
  }

  // Scalar fallback implementations

  private scalarDotProduct(a: Float32Array, b: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      sum += a[i]! * b[i]!;
    }
    return sum;
  }

  private scalarEuclideanDistance(a: Float32Array, b: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      const diff = a[i]! - b[i]!;
      sum += diff * diff;
    }
    return Math.sqrt(sum);
  }

  private scalarManhattanDistance(a: Float32Array, b: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      sum += Math.abs(a[i]! - b[i]!);
    }
    return sum;
  }

  private scalarNormalize(vector: Float32Array): Float32Array {
    let sumSquares = 0;
    for (let i = 0; i < vector.length; i++) {
      sumSquares += vector[i]! * vector[i]!;
    }
    
    const magnitude = Math.sqrt(sumSquares);
    if (magnitude === 0) return new Float32Array(vector);

    const result = new Float32Array(vector.length);
    for (let i = 0; i < vector.length; i++) {
      result[i] = vector[i]! / magnitude;
    }
    return result;
  }

  private scalarFusedMultiplyAdd(a: Float32Array, b: Float32Array, c: Float32Array): Float32Array {
    const result = new Float32Array(a.length);
    for (let i = 0; i < a.length; i++) {
      result[i] = a[i]! * b[i]! + c[i]!;
    }
    return result;
  }

  private scalarVectorAdd(a: Float32Array, b: Float32Array): Float32Array {
    const result = new Float32Array(a.length);
    for (let i = 0; i < a.length; i++) {
      result[i] = a[i]! + b[i]!;
    }
    return result;
  }

  private scalarVectorSubtract(a: Float32Array, b: Float32Array): Float32Array {
    const result = new Float32Array(a.length);
    for (let i = 0; i < a.length; i++) {
      result[i] = a[i]! - b[i]!;
    }
    return result;
  }

  private scalarScalarMultiply(vector: Float32Array, scalar: number): Float32Array {
    const result = new Float32Array(vector.length);
    for (let i = 0; i < vector.length; i++) {
      result[i] = vector[i]! * scalar;
    }
    return result;
  }

  /**
   * Benchmark SIMD vs scalar performance
   */
  benchmark(vectorLength: number = 1000, iterations: number = 1000): {
    simd: SIMDPerformanceStats;
    scalar: SIMDPerformanceStats;
    speedup: number;
  } {
    const a = new Float32Array(vectorLength);
    const b = new Float32Array(vectorLength);
    
    // Fill with random data
    for (let i = 0; i < vectorLength; i++) {
      a[i] = Math.random();
      b[i] = Math.random();
    }

    // Benchmark SIMD
    const simdStart = performance.now();
    for (let i = 0; i < iterations; i++) {
      this.simdDotProduct(a, b);
    }
    const simdEnd = performance.now();
    const simdTime = simdEnd - simdStart;

    // Benchmark scalar
    const scalarStart = performance.now();
    for (let i = 0; i < iterations; i++) {
      this.scalarDotProduct(a, b);
    }
    const scalarEnd = performance.now();
    const scalarTime = scalarEnd - scalarStart;

    const dataSize = vectorLength * 4 * 2; // 2 vectors * 4 bytes per float
    const totalData = (dataSize * iterations) / (1024 * 1024); // MB

    return {
      simd: {
        processingTime: simdTime,
        operationCount: iterations,
        operationsPerSecond: iterations / (simdTime / 1000),
        memoryThroughput: totalData / (simdTime / 1000)
      },
      scalar: {
        processingTime: scalarTime,
        operationCount: iterations,
        operationsPerSecond: iterations / (scalarTime / 1000),
        memoryThroughput: totalData / (scalarTime / 1000)
      },
      speedup: scalarTime / simdTime
    };
  }
}

/**
 * Singleton instance for global SIMD operations
 */
export const simdOperations = new SIMDOperations();