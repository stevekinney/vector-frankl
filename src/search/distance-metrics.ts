import { InvalidFormatError } from '@/core/errors.js';

/**
 * Interface for distance metric implementations
 */
export interface DistanceMetric {
  name: string;
  calculate(vectorA: Float32Array, vectorB: Float32Array): number;
  requiresNormalized?: boolean;
  supportsFormat?: string;
}

/**
 * Registry for distance metrics
 */
export class DistanceMetrics {
  private static instance: DistanceMetrics;
  private metrics = new Map<string, DistanceMetric>();

  private constructor() {
    // Register default metrics
    this.registerDefaults();
  }

  /**
   * Get singleton instance
   */
  static getInstance(): DistanceMetrics {
    if (!DistanceMetrics.instance) {
      DistanceMetrics.instance = new DistanceMetrics();
    }
    return DistanceMetrics.instance;
  }

  /**
   * Register a distance metric
   */
  register(metric: DistanceMetric): void {
    this.metrics.set(metric.name, metric);
  }

  /**
   * Get a distance metric by name
   */
  get(name: string): DistanceMetric {
    const metric = this.metrics.get(name);
    if (!metric) {
      throw new InvalidFormatError(
        `Unknown distance metric: ${name}`,
        Array.from(this.metrics.keys())
      );
    }
    return metric;
  }

  /**
   * List all available metrics
   */
  list(): string[] {
    return Array.from(this.metrics.keys());
  }

  /**
   * Register default distance metrics
   */
  private registerDefaults(): void {
    // Cosine similarity (1 - dot product for normalized vectors)
    this.register({
      name: 'cosine',
      requiresNormalized: true,
      calculate(vectorA: Float32Array, vectorB: Float32Array): number {
        let dotProduct = 0;
        for (let i = 0; i < vectorA.length; i++) {
          dotProduct += vectorA[i]! * vectorB[i]!;
        }
        // Return distance (0 = identical, 2 = opposite)
        return 1 - dotProduct;
      }
    });

    // Euclidean distance (L2 norm)
    this.register({
      name: 'euclidean',
      calculate(vectorA: Float32Array, vectorB: Float32Array): number {
        let sum = 0;
        for (let i = 0; i < vectorA.length; i++) {
          const diff = vectorA[i]! - vectorB[i]!;
          sum += diff * diff;
        }
        return Math.sqrt(sum);
      }
    });

    // Manhattan distance (L1 norm)
    this.register({
      name: 'manhattan',
      calculate(vectorA: Float32Array, vectorB: Float32Array): number {
        let sum = 0;
        for (let i = 0; i < vectorA.length; i++) {
          sum += Math.abs(vectorA[i]! - vectorB[i]!);
        }
        return sum;
      }
    });

    // Hamming distance (for binary vectors)
    this.register({
      name: 'hamming',
      supportsFormat: 'binary',
      calculate(vectorA: Float32Array, vectorB: Float32Array): number {
        let distance = 0;
        for (let i = 0; i < vectorA.length; i++) {
          // Treat as binary (0 or 1)
          const bitA = vectorA[i]! > 0 ? 1 : 0;
          const bitB = vectorB[i]! > 0 ? 1 : 0;
          if (bitA !== bitB) {
            distance++;
          }
        }
        return distance;
      }
    });

    // Jaccard distance (for sparse/binary vectors)
    this.register({
      name: 'jaccard',
      supportsFormat: 'sparse',
      calculate(vectorA: Float32Array, vectorB: Float32Array): number {
        let intersection = 0;
        let union = 0;

        for (let i = 0; i < vectorA.length; i++) {
          const a = vectorA[i]! > 0 ? 1 : 0;
          const b = vectorB[i]! > 0 ? 1 : 0;
          
          if (a || b) {
            union++;
            if (a && b) {
              intersection++;
            }
          }
        }

        if (union === 0) {
          return 0; // Both vectors are zero vectors
        }

        // Jaccard distance = 1 - Jaccard similarity
        return 1 - (intersection / union);
      }
    });

    // Dot product (not a distance, but useful for scoring)
    this.register({
      name: 'dot',
      calculate(vectorA: Float32Array, vectorB: Float32Array): number {
        let dotProduct = 0;
        for (let i = 0; i < vectorA.length; i++) {
          dotProduct += vectorA[i]! * vectorB[i]!;
        }
        // Return negative to maintain "lower is better" convention
        return -dotProduct;
      }
    });
  }
}

/**
 * Optimized distance calculations with SIMD when available
 */
export class OptimizedDistanceMetrics {
  /**
   * Euclidean distance with loop unrolling
   */
  static euclideanOptimized(vectorA: Float32Array, vectorB: Float32Array): number {
    const length = vectorA.length;
    let sum = 0;
    let i = 0;

    // Process 4 elements at a time
    const unrollLimit = length - 3;
    for (; i < unrollLimit; i += 4) {
      const diff0 = vectorA[i]! - vectorB[i]!;
      const diff1 = vectorA[i + 1]! - vectorB[i + 1]!;
      const diff2 = vectorA[i + 2]! - vectorB[i + 2]!;
      const diff3 = vectorA[i + 3]! - vectorB[i + 3]!;
      
      sum += diff0 * diff0 + diff1 * diff1 + diff2 * diff2 + diff3 * diff3;
    }

    // Process remaining elements
    for (; i < length; i++) {
      const diff = vectorA[i]! - vectorB[i]!;
      sum += diff * diff;
    }

    return Math.sqrt(sum);
  }

  /**
   * Cosine similarity with loop unrolling
   */
  static cosineOptimized(vectorA: Float32Array, vectorB: Float32Array): number {
    const length = vectorA.length;
    let dotProduct = 0;
    let i = 0;

    // Process 4 elements at a time
    const unrollLimit = length - 3;
    for (; i < unrollLimit; i += 4) {
      dotProduct += vectorA[i]! * vectorB[i]! +
                   vectorA[i + 1]! * vectorB[i + 1]! +
                   vectorA[i + 2]! * vectorB[i + 2]! +
                   vectorA[i + 3]! * vectorB[i + 3]!;
    }

    // Process remaining elements
    for (; i < length; i++) {
      dotProduct += vectorA[i]! * vectorB[i]!;
    }

    return 1 - dotProduct;
  }
}

/**
 * Helper class for distance calculations
 */
export class DistanceCalculator {
  private metric: DistanceMetric;
  private useOptimized: boolean;

  constructor(metricName: string, options?: { optimize?: boolean }) {
    this.metric = DistanceMetrics.getInstance().get(metricName);
    this.useOptimized = options?.optimize ?? true;
  }

  /**
   * Calculate distance between two vectors
   */
  calculate(vectorA: Float32Array, vectorB: Float32Array): number {
    if (vectorA.length !== vectorB.length) {
      throw new Error(
        `Vector dimension mismatch: ${vectorA.length} vs ${vectorB.length}`
      );
    }

    // Use optimized version if available
    if (this.useOptimized) {
      switch (this.metric.name) {
        case 'euclidean':
          return OptimizedDistanceMetrics.euclideanOptimized(vectorA, vectorB);
        case 'cosine':
          return OptimizedDistanceMetrics.cosineOptimized(vectorA, vectorB);
      }
    }

    return this.metric.calculate(vectorA, vectorB);
  }

  /**
   * Calculate distances from query to multiple vectors
   */
  calculateBatch(
    query: Float32Array, 
    vectors: Float32Array[], 
    options?: { parallel?: boolean }
  ): number[] {
    if (options?.parallel && vectors.length > 1000) {
      // For large batches, consider chunking
      return this.calculateBatchChunked(query, vectors);
    }

    return vectors.map(vector => this.calculate(query, vector));
  }

  /**
   * Calculate batch distances in chunks for better performance
   */
  private calculateBatchChunked(
    query: Float32Array,
    vectors: Float32Array[],
    chunkSize = 1000
  ): number[] {
    const results: number[] = new Array(vectors.length);
    
    for (let i = 0; i < vectors.length; i += chunkSize) {
      const chunk = vectors.slice(i, i + chunkSize);
      const chunkResults = chunk.map(vector => this.calculate(query, vector));
      
      for (let j = 0; j < chunkResults.length; j++) {
        results[i + j] = chunkResults[j]!;
      }
    }

    return results;
  }

  /**
   * Find k nearest neighbors
   */
  findNearest(
    query: Float32Array,
    vectors: Array<{ id: string; vector: Float32Array }>,
    k: number
  ): Array<{ id: string; distance: number }> {
    // Calculate all distances
    const distances = vectors.map(item => ({
      id: item.id,
      distance: this.calculate(query, item.vector)
    }));

    // Sort by distance and return top k
    distances.sort((a, b) => a.distance - b.distance);
    return distances.slice(0, k);
  }
}

/**
 * Export convenience functions
 */
export function createDistanceCalculator(
  metricName: string,
  options?: { optimize?: boolean }
): DistanceCalculator {
  return new DistanceCalculator(metricName, options);
}

export function registerCustomMetric(metric: DistanceMetric): void {
  DistanceMetrics.getInstance().register(metric);
}

export function listAvailableMetrics(): string[] {
  return DistanceMetrics.getInstance().list();
}