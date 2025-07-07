import { VectorFormatHandler } from './formats.js';
import { DimensionMismatchError } from '@/core/errors.js';
import type { VectorFormat, VectorData } from '@/core/types.js';
import { SIMDOperations } from '../simd/simd-operations.js';
import { WASMOperations } from '../wasm/wasm-operations.js';

/**
 * Vector mathematical operations with WebAssembly and SIMD acceleration
 */
export class VectorOperations {
  private static simdOps = new SIMDOperations();
  private static wasmOps = new WASMOperations();
  private static simdThreshold = 16; // Use SIMD for vectors with 16+ elements
  private static wasmThreshold = 64; // Use WASM for vectors with 64+ elements
  private static isWasmInitialized = false;

  /**
   * Enable or disable SIMD optimizations
   */
  static setSIMDEnabled(enabled: boolean): void {
    this.simdOps = new SIMDOperations({ enableSIMD: enabled });
  }

  /**
   * Set SIMD threshold for automatic optimization selection
   */
  static setSIMDThreshold(threshold: number): void {
    this.simdThreshold = threshold;
  }

  /**
   * Check if SIMD optimizations are supported and enabled
   */
  static isSIMDEnabled(): boolean {
    return this.simdOps.isSIMDEnabled();
  }

  /**
   * Initialize WebAssembly operations
   */
  static async initWASM(): Promise<void> {
    if (!this.isWasmInitialized) {
      await this.wasmOps.init();
      this.isWasmInitialized = true;
    }
  }

  /**
   * Enable or disable WebAssembly optimizations
   */
  static async setWASMEnabled(enabled: boolean): Promise<void> {
    this.wasmOps = new WASMOperations({ enableWASM: enabled });
    if (enabled) {
      await this.initWASM();
    }
  }

  /**
   * Set WebAssembly threshold for automatic optimization selection
   */
  static setWASMThreshold(threshold: number): void {
    this.wasmThreshold = threshold;
  }

  /**
   * Check if WebAssembly optimizations are supported and enabled
   */
  static isWASMEnabled(): boolean {
    return this.wasmOps.getCapabilities().wasmAvailable;
  }

  /**
   * Get performance capabilities
   */
  static getCapabilities() {
    return {
      wasm: this.wasmOps.getCapabilities(),
      simd: this.simdOps.getCapabilities()
    };
  }
  /**
   * Calculate the magnitude (L2 norm) of a vector (synchronous version)
   */
  static magnitudeSync(vector: Float32Array): number {
    // Use SIMD or scalar optimization for synchronous calculation
    if (vector.length >= this.simdThreshold) {
      return Math.sqrt(this.simdOps.dotProduct(vector, vector));
    }
    
    // Fallback to scalar implementation for small vectors
    let sum = 0;
    for (let i = 0; i < vector.length; i++) {
      sum += vector[i]! * vector[i]!;
    }
    return Math.sqrt(sum);
  }

  /**
   * Calculate the magnitude (L2 norm) of a vector (async version for WASM)
   */
  static async magnitude(vector: Float32Array): Promise<number> {
    // Only use async for WASM operations that require it
    if (vector.length >= this.wasmThreshold && this.isWasmInitialized) {
      try {
        return await this.wasmOps.magnitude(vector);
      } catch {
        // Fall through to synchronous calculation
      }
    }
    
    // Use synchronous version for all other cases
    return this.magnitudeSync(vector);
  }

  /**
   * Normalize a vector (convert to unit vector) - synchronous version
   */
  static normalizeSync(vector: Float32Array): Float32Array {
    // Use SIMD or scalar optimization for synchronous calculation
    if (vector.length >= this.simdThreshold) {
      return this.simdOps.normalize(vector);
    }
    
    // Fallback to scalar implementation for small vectors
    const mag = this.magnitudeSync(vector);
    
    if (mag === 0) {
      // Return zero vector if magnitude is 0
      return new Float32Array(vector.length);
    }

    const normalized = new Float32Array(vector.length);
    for (let i = 0; i < vector.length; i++) {
      normalized[i] = vector[i]! / mag;
    }
    
    return normalized;
  }

  /**
   * Normalize a vector (convert to unit vector) - async version for WASM
   */
  static async normalize(vector: Float32Array): Promise<Float32Array> {
    // Only use async for WASM operations that require it
    if (vector.length >= this.wasmThreshold && this.isWasmInitialized) {
      try {
        return await this.wasmOps.normalize(vector);
      } catch {
        // Fall through to synchronous calculation
      }
    }
    
    // Use synchronous version for all other cases
    return this.normalizeSync(vector);
  }

  /**
   * Normalize a vector in place
   */
  static async normalizeInPlace(vector: Float32Array): Promise<Float32Array> {
    const mag = await this.magnitude(vector);
    
    if (mag === 0) {
      // Set to zero vector if magnitude is 0
      vector.fill(0);
      return vector;
    }

    for (let i = 0; i < vector.length; i++) {
      vector[i]! /= mag;
    }
    
    return vector;
  }

  /**
   * Check if a vector is normalized (magnitude ≈ 1) - synchronous version
   */
  static isNormalizedSync(vector: Float32Array, epsilon = 1e-6): boolean {
    const mag = this.magnitudeSync(vector);
    return Math.abs(mag - 1) < epsilon;
  }

  /**
   * Check if a vector is normalized (magnitude ≈ 1) - async version
   */
  static async isNormalized(vector: Float32Array, epsilon = 1e-6): Promise<boolean> {
    const mag = await this.magnitude(vector);
    return Math.abs(mag - 1) < epsilon;
  }

  /**
   * Dot product of two vectors - synchronous version
   */
  static dotProductSync(vectorA: Float32Array, vectorB: Float32Array): number {
    if (vectorA.length !== vectorB.length) {
      throw new DimensionMismatchError(vectorA.length, vectorB.length);
    }

    // Use SIMD or scalar optimization for synchronous calculation
    if (vectorA.length >= this.simdThreshold) {
      return this.simdOps.dotProduct(vectorA, vectorB);
    }

    // Fallback to scalar implementation for small vectors
    let sum = 0;
    for (let i = 0; i < vectorA.length; i++) {
      sum += vectorA[i]! * vectorB[i]!;
    }
    
    return sum;
  }

  /**
   * Dot product of two vectors - async version for WASM
   */
  static async dotProduct(vectorA: Float32Array, vectorB: Float32Array): Promise<number> {
    if (vectorA.length !== vectorB.length) {
      throw new DimensionMismatchError(vectorA.length, vectorB.length);
    }

    // Only use async for WASM operations that require it
    if (vectorA.length >= this.wasmThreshold && this.isWasmInitialized) {
      try {
        return await this.wasmOps.dotProduct(vectorA, vectorB);
      } catch {
        // Fall through to synchronous calculation
      }
    }

    // Use synchronous version for all other cases
    return this.dotProductSync(vectorA, vectorB);
  }

  /**
   * Add two vectors - synchronous version
   */
  static addSync(vectorA: Float32Array, vectorB: Float32Array): Float32Array {
    if (vectorA.length !== vectorB.length) {
      throw new DimensionMismatchError(vectorA.length, vectorB.length);
    }

    // Use SIMD or scalar optimization for synchronous calculation
    if (vectorA.length >= this.simdThreshold) {
      return this.simdOps.vectorAdd(vectorA, vectorB);
    }

    // Fallback to scalar implementation for small vectors
    const result = new Float32Array(vectorA.length);
    for (let i = 0; i < vectorA.length; i++) {
      result[i] = vectorA[i]! + vectorB[i]!;
    }
    
    return result;
  }

  /**
   * Add two vectors - async version for WASM
   */
  static async add(vectorA: Float32Array, vectorB: Float32Array): Promise<Float32Array> {
    if (vectorA.length !== vectorB.length) {
      throw new DimensionMismatchError(vectorA.length, vectorB.length);
    }

    // Only use async for WASM operations that require it
    if (vectorA.length >= this.wasmThreshold && this.isWasmInitialized) {
      try {
        return await this.wasmOps.vectorAdd(vectorA, vectorB);
      } catch {
        // Fall through to synchronous calculation
      }
    }

    // Use synchronous version for all other cases
    return this.addSync(vectorA, vectorB);
  }

  /**
   * Subtract vectorB from vectorA
   */
  static async subtract(vectorA: Float32Array, vectorB: Float32Array): Promise<Float32Array> {
    if (vectorA.length !== vectorB.length) {
      throw new DimensionMismatchError(vectorA.length, vectorB.length);
    }

    // Three-tier optimization: WASM → SIMD → Scalar
    if (vectorA.length >= this.wasmThreshold && this.isWasmInitialized) {
      try {
        return await this.wasmOps.vectorSubtract(vectorA, vectorB);
      } catch {
        // Fall through to SIMD
      }
    }

    if (vectorA.length >= this.simdThreshold) {
      return this.simdOps.vectorSubtract(vectorA, vectorB);
    }

    // Fallback to scalar implementation for small vectors
    const result = new Float32Array(vectorA.length);
    for (let i = 0; i < vectorA.length; i++) {
      result[i] = vectorA[i]! - vectorB[i]!;
    }
    
    return result;
  }

  /**
   * Scale a vector by a scalar
   */
  static async scale(vector: Float32Array, scalar: number): Promise<Float32Array> {
    // Three-tier optimization: WASM → SIMD → Scalar
    if (vector.length >= this.wasmThreshold && this.isWasmInitialized) {
      try {
        return await this.wasmOps.scalarMultiply(vector, scalar);
      } catch {
        // Fall through to SIMD
      }
    }

    if (vector.length >= this.simdThreshold) {
      return this.simdOps.scalarMultiply(vector, scalar);
    }

    // Fallback to scalar implementation for small vectors
    const result = new Float32Array(vector.length);
    for (let i = 0; i < vector.length; i++) {
      result[i] = vector[i]! * scalar;
    }
    
    return result;
  }

  /**
   * Calculate the mean of multiple vectors
   */
  static mean(vectors: Float32Array[]): Float32Array {
    if (vectors.length === 0) {
      throw new Error('Cannot calculate mean of empty vector array');
    }

    const dimension = vectors[0]!.length;
    const result = new Float32Array(dimension);

    // Sum all vectors
    for (const vector of vectors) {
      if (vector.length !== dimension) {
        throw new DimensionMismatchError(dimension, vector.length);
      }
      
      for (let i = 0; i < dimension; i++) {
        result[i]! += vector[i]!;
      }
    }

    // Divide by count
    const count = vectors.length;
    for (let i = 0; i < dimension; i++) {
      result[i]! /= count;
    }

    return result;
  }

  /**
   * Calculate the variance of vectors along each dimension
   */
  static variance(vectors: Float32Array[], mean?: Float32Array): Float32Array {
    if (vectors.length === 0) {
      throw new Error('Cannot calculate variance of empty vector array');
    }

    const dimension = vectors[0]!.length;
    const meanVector = mean || this.mean(vectors);
    const result = new Float32Array(dimension);

    for (const vector of vectors) {
      if (vector.length !== dimension) {
        throw new DimensionMismatchError(dimension, vector.length);
      }
      
      for (let i = 0; i < dimension; i++) {
        const diff = vector[i]! - meanVector[i]!;
        result[i]! += diff * diff;
      }
    }

    const count = vectors.length;
    for (let i = 0; i < dimension; i++) {
      result[i]! /= count;
    }

    return result;
  }

  /**
   * Calculate the standard deviation of vectors along each dimension
   */
  static standardDeviation(vectors: Float32Array[], mean?: Float32Array): Float32Array {
    const variance = this.variance(vectors, mean);
    const result = new Float32Array(variance.length);
    
    for (let i = 0; i < variance.length; i++) {
      result[i] = Math.sqrt(variance[i]!);
    }

    return result;
  }

  /**
   * Check if two vectors are equal within an epsilon
   */
  static equals(vectorA: Float32Array, vectorB: Float32Array, epsilon = 1e-6): boolean {
    if (vectorA.length !== vectorB.length) {
      return false;
    }

    for (let i = 0; i < vectorA.length; i++) {
      if (Math.abs(vectorA[i]! - vectorB[i]!) > epsilon) {
        return false;
      }
    }

    return true;
  }

  /**
   * Create a random vector with values in the specified range
   */
  static random(dimension: number, min = -1, max = 1): Float32Array {
    const vector = new Float32Array(dimension);
    const range = max - min;
    
    for (let i = 0; i < dimension; i++) {
      vector[i] = Math.random() * range + min;
    }

    return vector;
  }

  /**
   * Create a random unit vector
   */
  static randomUnit(dimension: number): Float32Array {
    const vector = this.random(dimension);
    return this.normalizeSync(vector);
  }

  /**
   * Prepare a vector for storage
   */
  static async prepareForStorage(
    id: string,
    vector: VectorFormat,
    metadata?: Record<string, unknown>,
    options?: {
      normalize?: boolean;
      format?: string;
    }
  ): Promise<VectorData> {
    // Convert to Float32Array
    const float32Vector = VectorFormatHandler.toFloat32Array(vector);
    
    // Normalize if requested
    const finalVector = options?.normalize 
      ? await this.normalize(float32Vector)
      : float32Vector;
    
    // Calculate magnitude
    const magnitude = await this.magnitude(finalVector);
    
    return {
      id,
      vector: finalVector,
      magnitude,
      timestamp: Date.now(),
      ...(metadata && { metadata }),
      ...(options?.format && { format: options.format }),
      ...(options?.normalize && { normalized: options.normalize })
    };
  }
}