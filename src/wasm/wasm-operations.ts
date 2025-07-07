/**
 * WebAssembly-accelerated vector operations
 */

import { WASMManager } from './wasm-manager.js';
import { SIMDOperations } from '../simd/simd-operations.js';

export interface WASMOperationsConfig {
  /** Enable WebAssembly optimizations */
  enableWASM?: boolean;
  /** Vector size threshold for WASM operations */
  wasmThreshold?: number;
  /** Enable SIMD fallback */
  enableSIMDFallback?: boolean;
  /** Enable performance profiling */
  enableProfiling?: boolean;
  /** WASM module configuration */
  wasmConfig?: {
    maxMemory?: number;
    modulePath?: string;
  };
}

export interface WASMOperationsCapabilities {
  /** Whether WASM is supported and available */
  wasmAvailable: boolean;
  /** Whether SIMD fallback is available */
  simdAvailable: boolean;
  /** Scalar fallback always available */
  scalarAvailable: boolean;
  /** Optimal vector size thresholds */
  thresholds: {
    wasm: number;
    simd: number;
  };
  /** Performance characteristics */
  performance: {
    wasmFeatures: string[];
    simdFeatures: string[];
  };
}

/**
 * High-performance vector operations with WebAssembly acceleration
 */
export class WASMOperations {
  private wasmManager: WASMManager;
  private simdOps: SIMDOperations;
  private config: Required<WASMOperationsConfig>;
  private isInitialized = false;

  constructor(config: WASMOperationsConfig = {}) {
    this.config = {
      enableWASM: config.enableWASM ?? true,
      wasmThreshold: config.wasmThreshold || 64,
      enableSIMDFallback: config.enableSIMDFallback ?? true,
      enableProfiling: config.enableProfiling ?? false,
      wasmConfig: config.wasmConfig || {}
    };

    this.wasmManager = new WASMManager({
      enableWASM: this.config.enableWASM,
      wasmThreshold: this.config.wasmThreshold,
      enableProfiling: this.config.enableProfiling,
      ...this.config.wasmConfig
    });

    this.simdOps = new SIMDOperations({
      enableSIMD: this.config.enableSIMDFallback,
      enableProfiling: this.config.enableProfiling
    });
  }

  /**
   * Initialize WebAssembly and SIMD operations
   */
  async init(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      await this.wasmManager.init();
      if (this.config.enableProfiling) {
        console.log('WASM operations initialized successfully');
      }
    } catch (error) {
      console.warn('WASM initialization failed, falling back to SIMD/scalar:', error);
    }

    this.isInitialized = true;
  }

  /**
   * Get operation capabilities
   */
  getCapabilities(): WASMOperationsCapabilities {
    const wasmCaps = this.wasmManager.getCapabilities();
    const simdCaps = this.simdOps.getCapabilities();

    return {
      wasmAvailable: wasmCaps.supported && this.wasmManager.isAvailable(),
      simdAvailable: simdCaps.supported,
      scalarAvailable: true,
      thresholds: {
        wasm: this.config.wasmThreshold,
        simd: 16 // SIMD threshold from SIMDOperations
      },
      performance: {
        wasmFeatures: wasmCaps.features,
        simdFeatures: simdCaps.instructionSets
      }
    };
  }

  /**
   * Determine the best implementation for given vector size
   */
  private getBestImplementation(vectorLength: number): 'wasm' | 'simd' | 'scalar' {
    if (vectorLength >= this.config.wasmThreshold && this.wasmManager.isAvailable()) {
      return 'wasm';
    }
    
    if (vectorLength >= 16 && this.config.enableSIMDFallback && this.simdOps.getCapabilities().supported) {
      return 'simd';
    }

    return 'scalar';
  }

  /**
   * High-performance dot product with automatic optimization selection
   */
  async dotProduct(vectorA: Float32Array, vectorB: Float32Array): Promise<number> {
    if (vectorA.length !== vectorB.length) {
      throw new Error('Vector dimensions must match');
    }

    const implementation = this.getBestImplementation(vectorA.length);
    const startTime = this.config.enableProfiling ? performance.now() : 0;

    let result: number;

    try {
      switch (implementation) {
        case 'wasm':
          result = await this.wasmManager.dotProduct(vectorA, vectorB);
          break;
        
        case 'simd':
          result = this.simdOps.dotProduct(vectorA, vectorB);
          break;
        
        case 'scalar':
        default:
          result = this.scalarDotProduct(vectorA, vectorB);
          break;
      }

      if (this.config.enableProfiling) {
        const endTime = performance.now();
        console.debug(`Dot product (${implementation}): ${endTime - startTime}ms for ${vectorA.length} elements`);
      }

      return result;
    } catch (error) {
      console.warn(`${implementation} dot product failed, falling back:`, error);
      
      // Progressive fallback
      if (implementation === 'wasm' && this.config.enableSIMDFallback) {
        return this.simdOps.dotProduct(vectorA, vectorB);
      }
      
      return this.scalarDotProduct(vectorA, vectorB);
    }
  }

  /**
   * High-performance vector magnitude calculation
   */
  async magnitude(vector: Float32Array): Promise<number> {
    const implementation = this.getBestImplementation(vector.length);
    const startTime = this.config.enableProfiling ? performance.now() : 0;

    let result: number;

    try {
      switch (implementation) {
        case 'wasm':
          result = await this.wasmManager.magnitude(vector);
          break;
        
        case 'simd':
          // Use SIMD for dot product with self, then sqrt
          result = Math.sqrt(this.simdOps.dotProduct(vector, vector));
          break;
        
        case 'scalar':
        default:
          result = this.scalarMagnitude(vector);
          break;
      }

      if (this.config.enableProfiling) {
        const endTime = performance.now();
        console.debug(`Magnitude (${implementation}): ${endTime - startTime}ms for ${vector.length} elements`);
      }

      return result;
    } catch (error) {
      console.warn(`${implementation} magnitude failed, falling back:`, error);
      
      if (implementation === 'wasm' && this.config.enableSIMDFallback) {
        return Math.sqrt(this.simdOps.dotProduct(vector, vector));
      }
      
      return this.scalarMagnitude(vector);
    }
  }

  /**
   * High-performance vector addition
   */
  async vectorAdd(vectorA: Float32Array, vectorB: Float32Array): Promise<Float32Array> {
    if (vectorA.length !== vectorB.length) {
      throw new Error('Vector dimensions must match');
    }

    const implementation = this.getBestImplementation(vectorA.length);
    const startTime = this.config.enableProfiling ? performance.now() : 0;

    let result: Float32Array;

    try {
      switch (implementation) {
        case 'wasm':
          result = await this.wasmManager.vectorAdd(vectorA, vectorB);
          break;
        
        case 'simd':
          result = this.simdOps.vectorAdd(vectorA, vectorB);
          break;
        
        case 'scalar':
        default:
          result = this.scalarVectorAdd(vectorA, vectorB);
          break;
      }

      if (this.config.enableProfiling) {
        const endTime = performance.now();
        console.debug(`Vector add (${implementation}): ${endTime - startTime}ms for ${vectorA.length} elements`);
      }

      return result;
    } catch (error) {
      console.warn(`${implementation} vector add failed, falling back:`, error);
      
      if (implementation === 'wasm' && this.config.enableSIMDFallback) {
        return this.simdOps.vectorAdd(vectorA, vectorB);
      }
      
      return this.scalarVectorAdd(vectorA, vectorB);
    }
  }

  /**
   * High-performance vector subtraction
   */
  async vectorSubtract(vectorA: Float32Array, vectorB: Float32Array): Promise<Float32Array> {
    if (vectorA.length !== vectorB.length) {
      throw new Error('Vector dimensions must match');
    }

    const implementation = this.getBestImplementation(vectorA.length);
    
    try {
      switch (implementation) {
        case 'wasm': {
          // For now, implement as addition of negated vector
          const negB = await this.scalarMultiply(vectorB, -1);
          return await this.wasmManager.vectorAdd(vectorA, negB);
        }
        
        case 'simd':
          return this.simdOps.vectorSubtract(vectorA, vectorB);
        
        case 'scalar':
        default:
          return this.scalarVectorSubtract(vectorA, vectorB);
      }
    } catch (error) {
      console.warn(`${implementation} vector subtract failed, falling back:`, error);
      
      if (implementation === 'wasm' && this.config.enableSIMDFallback) {
        return this.simdOps.vectorSubtract(vectorA, vectorB);
      }
      
      return this.scalarVectorSubtract(vectorA, vectorB);
    }
  }

  /**
   * High-performance scalar multiplication
   */
  async scalarMultiply(vector: Float32Array, scalar: number): Promise<Float32Array> {
    const implementation = this.getBestImplementation(vector.length);
    
    try {
      switch (implementation) {
        case 'simd':
          return this.simdOps.scalarMultiply(vector, scalar);
        
        case 'wasm':
        case 'scalar':
        default:
          return this.scalarScalarMultiply(vector, scalar);
      }
    } catch (error) {
      console.warn(`${implementation} scalar multiply failed, falling back:`, error);
      return this.scalarScalarMultiply(vector, scalar);
    }
  }

  /**
   * High-performance vector normalization
   */
  async normalize(vector: Float32Array): Promise<Float32Array> {
    const mag = await this.magnitude(vector);
    
    if (mag === 0) {
      return new Float32Array(vector.length);
    }

    return await this.scalarMultiply(vector, 1 / mag);
  }

  /**
   * Batch operations for multiple vectors
   */
  async batchDotProduct(vectors: Float32Array[], query: Float32Array): Promise<Float32Array> {
    const results = new Float32Array(vectors.length);
    
    // Use parallel processing for large batches
    if (vectors.length > 10 && this.wasmManager.isAvailable()) {
      const promises = vectors.map(async (vector, index) => {
        const result = await this.dotProduct(vector, query);
        results[index] = result;
      });
      
      await Promise.all(promises);
    } else {
      // Sequential processing for smaller batches
      for (let i = 0; i < vectors.length; i++) {
        const vector = vectors[i];
        if (vector) {
          results[i] = await this.dotProduct(vector, query);
        }
      }
    }

    return results;
  }

  // Scalar fallback implementations

  private scalarDotProduct(vectorA: Float32Array, vectorB: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < vectorA.length; i++) {
      sum += (vectorA[i] ?? 0) * (vectorB[i] ?? 0);
    }
    return sum;
  }

  private scalarMagnitude(vector: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < vector.length; i++) {
      sum += (vector[i] ?? 0) * (vector[i] ?? 0);
    }
    return Math.sqrt(sum);
  }

  private scalarVectorAdd(vectorA: Float32Array, vectorB: Float32Array): Float32Array {
    const result = new Float32Array(vectorA.length);
    for (let i = 0; i < vectorA.length; i++) {
      result[i] = (vectorA[i] ?? 0) + (vectorB[i] ?? 0);
    }
    return result;
  }

  private scalarVectorSubtract(vectorA: Float32Array, vectorB: Float32Array): Float32Array {
    const result = new Float32Array(vectorA.length);
    for (let i = 0; i < vectorA.length; i++) {
      result[i] = (vectorA[i] ?? 0) - (vectorB[i] ?? 0);
    }
    return result;
  }

  private scalarScalarMultiply(vector: Float32Array, scalar: number): Float32Array {
    const result = new Float32Array(vector.length);
    for (let i = 0; i < vector.length; i++) {
      result[i] = (vector[i] ?? 0) * scalar;
    }
    return result;
  }

  /**
   * Performance benchmark across all implementations
   */
  async benchmarkAll(
    vectorLength: number = 1000,
    iterations: number = 100
  ): Promise<{
    wasm?: { time: number; ops: number };
    simd: { time: number; ops: number };
    scalar: { time: number; ops: number };
    speedup: {
      wasmVsScalar?: number;
      simdVsScalar: number;
      wasmVsSIMD?: number;
    };
  }> {
    const vectorA = new Float32Array(Array.from({ length: vectorLength }, () => Math.random()));
    const vectorB = new Float32Array(Array.from({ length: vectorLength }, () => Math.random()));

    const results: {
      wasm?: { time: number; ops: number };
      simd?: { time: number; ops: number };
      scalar?: { time: number; ops: number };
      speedup?: {
        wasmVsScalar?: number;
        simdVsScalar?: number;
        wasmVsSIMD?: number;
      };
    } = {};

    // Benchmark WASM if available
    if (this.wasmManager.isAvailable()) {
      const wasmStart = performance.now();
      for (let i = 0; i < iterations; i++) {
        await this.wasmManager.dotProduct(vectorA, vectorB);
      }
      const wasmEnd = performance.now();
      results.wasm = {
        time: wasmEnd - wasmStart,
        ops: iterations / ((wasmEnd - wasmStart) / 1000)
      };
    }

    // Benchmark SIMD
    const simdStart = performance.now();
    for (let i = 0; i < iterations; i++) {
      this.simdOps.dotProduct(vectorA, vectorB);
    }
    const simdEnd = performance.now();
    results.simd = {
      time: simdEnd - simdStart,
      ops: iterations / ((simdEnd - simdStart) / 1000)
    };

    // Benchmark Scalar
    const scalarStart = performance.now();
    for (let i = 0; i < iterations; i++) {
      this.scalarDotProduct(vectorA, vectorB);
    }
    const scalarEnd = performance.now();
    results.scalar = {
      time: scalarEnd - scalarStart,
      ops: iterations / ((scalarEnd - scalarStart) / 1000)
    };

    // Calculate speedups
    results.speedup = {
      simdVsScalar: results.scalar.time / results.simd.time
    };

    if (results.wasm) {
      results.speedup.wasmVsScalar = results.scalar.time / results.wasm.time;
      results.speedup.wasmVsSIMD = results.simd.time / results.wasm.time;
    }

    return results as {
      wasm?: { time: number; ops: number };
      simd: { time: number; ops: number };
      scalar: { time: number; ops: number };
      speedup: {
        wasmVsScalar?: number;
        simdVsScalar: number;
        wasmVsSIMD?: number;
      };
    };
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    await this.wasmManager.cleanup();
    this.isInitialized = false;
  }
}

/**
 * Singleton instance for global WASM operations
 */
export const wasmOperations = new WASMOperations();