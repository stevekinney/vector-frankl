/**
 * SIMD-accelerated distance metrics for high-performance vector similarity calculations
 */

import { SIMDOperations } from './simd-operations.js';
import type { DistanceMetric } from '../core/types.js';

export interface SIMDDistanceConfig {
  /** Enable SIMD optimizations */
  enableSIMD?: boolean;
  /** Vector size threshold for SIMD operations */
  simdThreshold?: number;
  /** Cache computation results */
  enableCaching?: boolean;
  /** Maximum cache size */
  maxCacheSize?: number;
}

export interface SIMDDistanceCalculator {
  name: DistanceMetric;
  calculate: (a: Float32Array, b: Float32Array) => number;
  batchCalculate?: (vectors: Float32Array[], query: Float32Array) => Float32Array;
  requiresNormalized?: boolean;
  simdAccelerated: boolean;
}

/**
 * High-performance SIMD distance metrics
 */
export class SIMDDistanceMetrics {
  private simdOps: SIMDOperations;
  private config: Required<SIMDDistanceConfig>;
  private cache = new Map<string, number>();
  private calculators = new Map<DistanceMetric, SIMDDistanceCalculator>();

  constructor(config: SIMDDistanceConfig = {}) {
    this.config = {
      enableSIMD: config.enableSIMD ?? true,
      simdThreshold: config.simdThreshold || 16,
      enableCaching: config.enableCaching ?? false,
      maxCacheSize: config.maxCacheSize || 1000
    };

    this.simdOps = new SIMDOperations({
      enableSIMD: this.config.enableSIMD,
      simdThreshold: this.config.simdThreshold,
      enableProfiling: false
    });

    this.initializeCalculators();
  }

  /**
   * Initialize all distance calculators
   */
  private initializeCalculators(): void {
    // Cosine similarity (SIMD-accelerated)
    this.calculators.set('cosine', {
      name: 'cosine',
      calculate: (a, b) => this.cosineDistance(a, b),
      batchCalculate: (vectors, query) => this.batchCosineDistance(vectors, query),
      requiresNormalized: false,
      simdAccelerated: true
    });

    // Euclidean distance (SIMD-accelerated)
    this.calculators.set('euclidean', {
      name: 'euclidean',
      calculate: (a, b) => this.simdOps.euclideanDistance(a, b),
      batchCalculate: (vectors, query) => this.batchEuclideanDistance(vectors, query),
      requiresNormalized: false,
      simdAccelerated: true
    });

    // Manhattan distance (SIMD-accelerated)
    this.calculators.set('manhattan', {
      name: 'manhattan',
      calculate: (a, b) => this.simdOps.manhattanDistance(a, b),
      batchCalculate: (vectors, query) => this.batchManhattanDistance(vectors, query),
      requiresNormalized: false,
      simdAccelerated: true
    });

    // Dot product (SIMD-accelerated)
    this.calculators.set('dot', {
      name: 'dot',
      calculate: (a, b) => -this.simdOps.dotProduct(a, b), // Negative for distance
      batchCalculate: (vectors, query) => this.batchDotProduct(vectors, query),
      requiresNormalized: false,
      simdAccelerated: true
    });

    // Hamming distance (optimized but not SIMD)
    this.calculators.set('hamming', {
      name: 'hamming',
      calculate: (a, b) => this.hammingDistance(a, b),
      requiresNormalized: false,
      simdAccelerated: false
    });

    // Jaccard distance (optimized but not SIMD)
    this.calculators.set('jaccard', {
      name: 'jaccard',
      calculate: (a, b) => this.jaccardDistance(a, b),
      requiresNormalized: false,
      simdAccelerated: false
    });
  }

  /**
   * Get distance calculator for a specific metric
   */
  getCalculator(metric: DistanceMetric): SIMDDistanceCalculator {
    const calculator = this.calculators.get(metric);
    if (!calculator) {
      throw new Error(`Unknown distance metric: ${metric}`);
    }
    return calculator;
  }

  /**
   * Get list of available metrics
   */
  getAvailableMetrics(): DistanceMetric[] {
    return Array.from(this.calculators.keys());
  }

  /**
   * Get SIMD-accelerated metrics
   */
  getSIMDAcceleratedMetrics(): DistanceMetric[] {
    return Array.from(this.calculators.entries())
      .filter(([_, calc]) => calc.simdAccelerated)
      .map(([metric, _]) => metric);
  }

  /**
   * Calculate distance with optional caching
   */
  calculateDistance(
    a: Float32Array, 
    b: Float32Array, 
    metric: DistanceMetric
  ): number {
    const calculator = this.getCalculator(metric);
    
    if (this.config.enableCaching) {
      const cacheKey = this.generateCacheKey(a, b, metric);
      const cached = this.cache.get(cacheKey);
      if (cached !== undefined) {
        return cached;
      }
      
      const result = calculator.calculate(a, b);
      this.addToCache(cacheKey, result);
      return result;
    }

    return calculator.calculate(a, b);
  }

  /**
   * Batch calculate distances
   */
  batchCalculateDistances(
    vectors: Float32Array[],
    query: Float32Array,
    metric: DistanceMetric
  ): Float32Array {
    const calculator = this.getCalculator(metric);
    
    if (calculator.batchCalculate) {
      return calculator.batchCalculate(vectors, query);
    }

    // Fallback to individual calculations
    const results = new Float32Array(vectors.length);
    for (let i = 0; i < vectors.length; i++) {
      const vector = vectors[i];
      if (vector) {
        results[i] = calculator.calculate(vector, query);
      }
    }
    return results;
  }

  /**
   * Convert distance to similarity score
   */
  distanceToScore(distance: number, metric: DistanceMetric): number {
    switch (metric) {
      case 'cosine':
        // Cosine distance is in range [0, 2], convert to similarity [0, 1]
        return 1 - (distance / 2);
      
      case 'dot':
        // Dot product is negative distance, convert back
        return -distance;
      
      case 'euclidean':
      case 'manhattan':
        // Convert distance to similarity using exponential decay
        return Math.exp(-distance);
      
      case 'hamming':
      case 'jaccard':
        // These are already in [0, 1] range
        return 1 - distance;
      
      default:
        // Generic conversion
        return 1 / (1 + distance);
    }
  }

  // SIMD-accelerated distance implementations

  /**
   * SIMD-accelerated cosine distance
   */
  private cosineDistance(a: Float32Array, b: Float32Array): number {
    const dotProduct = this.simdOps.dotProduct(a, b);
    
    // Calculate magnitudes using SIMD
    const magA = Math.sqrt(this.simdOps.dotProduct(a, a));
    const magB = Math.sqrt(this.simdOps.dotProduct(b, b));
    
    const magnitude = magA * magB;
    if (magnitude === 0) return 1; // Maximum distance
    
    const similarity = dotProduct / magnitude;
    return 1 - similarity; // Convert similarity to distance
  }

  /**
   * Batch cosine distance calculation
   */
  private batchCosineDistance(vectors: Float32Array[], query: Float32Array): Float32Array {
    const results = new Float32Array(vectors.length);
    
    // Pre-calculate query magnitude
    const queryMagnitude = Math.sqrt(this.simdOps.dotProduct(query, query));
    
    // Use SIMD for batch dot products
    const dotProducts = this.simdOps.batchDotProduct(vectors, query);
    
    for (let i = 0; i < vectors.length; i++) {
      const vector = vectors[i];
      if (vector) {
        const vectorMagnitude = Math.sqrt(this.simdOps.dotProduct(vector, vector));
        const magnitude = queryMagnitude * vectorMagnitude;
        
        if (magnitude === 0) {
          results[i] = 1; // Maximum distance
        } else {
          const dotProduct = dotProducts[i];
          if (dotProduct !== undefined) {
            const similarity = dotProduct / magnitude;
            results[i] = 1 - similarity;
          }
        }
      }
    }
    
    return results;
  }

  /**
   * Batch Euclidean distance calculation
   */
  private batchEuclideanDistance(vectors: Float32Array[], query: Float32Array): Float32Array {
    const results = new Float32Array(vectors.length);
    
    for (let i = 0; i < vectors.length; i++) {
      const vector = vectors[i];
      if (vector) {
        results[i] = this.simdOps.euclideanDistance(vector, query);
      }
    }
    
    return results;
  }

  /**
   * Batch Manhattan distance calculation
   */
  private batchManhattanDistance(vectors: Float32Array[], query: Float32Array): Float32Array {
    const results = new Float32Array(vectors.length);
    
    for (let i = 0; i < vectors.length; i++) {
      const vector = vectors[i];
      if (vector) {
        results[i] = this.simdOps.manhattanDistance(vector, query);
      }
    }
    
    return results;
  }

  /**
   * Batch dot product calculation
   */
  private batchDotProduct(vectors: Float32Array[], query: Float32Array): Float32Array {
    const dotProducts = this.simdOps.batchDotProduct(vectors, query);
    
    // Convert to negative for distance
    for (let i = 0; i < dotProducts.length; i++) {
      const value = dotProducts[i];
      if (value !== undefined) {
        dotProducts[i] = -value;
      }
    }
    
    return dotProducts;
  }

  // Non-SIMD optimized implementations

  /**
   * Optimized Hamming distance for binary/integer vectors
   */
  private hammingDistance(a: Float32Array, b: Float32Array): number {
    let distance = 0;
    
    // Use bitwise operations for integer-like values
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) {
        distance++;
      }
    }
    
    return distance / a.length; // Normalize by vector length
  }

  /**
   * Optimized Jaccard distance
   */
  private jaccardDistance(a: Float32Array, b: Float32Array): number {
    let intersection = 0;
    let union = 0;
    
    for (let i = 0; i < a.length; i++) {
      const aVal = a[i];
      const bVal = b[i];
      if (aVal !== undefined && bVal !== undefined) {
        const minVal = Math.min(aVal, bVal);
        const maxVal = Math.max(aVal, bVal);
        
        intersection += minVal;
        union += maxVal;
      }
    }
    
    if (union === 0) return 0;
    return 1 - (intersection / union);
  }

  // Cache management

  private generateCacheKey(a: Float32Array, b: Float32Array, metric: DistanceMetric): string {
    // Simple hash-based cache key
    const aHash = this.hashVector(a);
    const bHash = this.hashVector(b);
    return `${metric}:${aHash}:${bHash}`;
  }

  private hashVector(vector: Float32Array): string {
    // Simple polynomial hash for caching
    let hash = 0;
    for (let i = 0; i < Math.min(vector.length, 8); i++) {
      const value = vector[i];
      if (value !== undefined) {
        hash = (hash * 31 + Math.floor(value * 1000)) % 2147483647;
      }
    }
    return hash.toString(36);
  }

  private addToCache(key: string, value: number): void {
    if (this.cache.size >= this.config.maxCacheSize) {
      // Simple LRU: remove oldest entry
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, value);
  }

  /**
   * Clear distance calculation cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    size: number;
    maxSize: number;
    hitRate: number;
  } {
    // This would require additional tracking for hit rate
    return {
      size: this.cache.size,
      maxSize: this.config.maxCacheSize,
      hitRate: 0 // Would need to track hits/misses
    };
  }

  /**
   * Benchmark SIMD vs non-SIMD performance
   */
  benchmark(
    vectorLength: number = 1000, 
    vectorCount: number = 100,
    metric: DistanceMetric = 'cosine'
  ): {
    simdTime: number;
    scalarTime: number;
    speedup: number;
    operationsPerSecond: number;
  } {
    // Generate test data
    const vectors: Float32Array[] = [];
    for (let i = 0; i < vectorCount; i++) {
      const vector = new Float32Array(vectorLength);
      for (let j = 0; j < vectorLength; j++) {
        vector[j] = Math.random() * 2 - 1;
      }
      vectors.push(vector);
    }
    
    const query = new Float32Array(vectorLength);
    for (let i = 0; i < vectorLength; i++) {
      query[i] = Math.random() * 2 - 1;
    }

    // Benchmark SIMD version
    const simdStart = performance.now();
    this.batchCalculateDistances(vectors, query, metric);
    const simdEnd = performance.now();
    const simdTime = simdEnd - simdStart;

    // Benchmark scalar version (disable SIMD temporarily)
    const originalSIMD = this.config.enableSIMD;
    this.config.enableSIMD = false;
    this.simdOps = new SIMDOperations({ enableSIMD: false });
    this.initializeCalculators();

    const scalarStart = performance.now();
    this.batchCalculateDistances(vectors, query, metric);
    const scalarEnd = performance.now();
    const scalarTime = scalarEnd - scalarStart;

    // Restore SIMD settings
    this.config.enableSIMD = originalSIMD;
    this.simdOps = new SIMDOperations({ enableSIMD: originalSIMD });
    this.initializeCalculators();

    return {
      simdTime,
      scalarTime,
      speedup: scalarTime / simdTime,
      operationsPerSecond: vectorCount / (simdTime / 1000)
    };
  }
}

/**
 * Create a SIMD distance calculator function
 */
export function createSIMDDistanceCalculator(
  metric: DistanceMetric,
  config?: SIMDDistanceConfig
): (a: Float32Array, b: Float32Array) => number {
  const metrics = new SIMDDistanceMetrics(config);
  const calculator = metrics.getCalculator(metric);
  return calculator.calculate;
}

/**
 * Singleton instance for global SIMD distance metrics
 */
export const simdDistanceMetrics = new SIMDDistanceMetrics();