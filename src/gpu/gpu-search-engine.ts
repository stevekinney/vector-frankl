/**
 * GPU-accelerated vector search engine using WebGPU compute shaders
 */

import { WebGPUManager } from './webgpu-manager.js';
import type { 
  VectorData, 
  SearchResult, 
  DistanceMetric,
  SearchOptions 
} from '../core/types.js';

export interface GPUSearchConfig {
  /** Minimum dataset size to use GPU acceleration */
  gpuThreshold?: number;
  /** Enable automatic GPU/CPU fallback */
  enableFallback?: boolean;
  /** Batch size for GPU operations */
  batchSize?: number;
  /** Enable performance profiling */
  enableProfiling?: boolean;
  /** WebGPU configuration */
  webGPUConfig?: {
    powerPreference?: 'low-power' | 'high-performance';
    debug?: boolean;
    maxBufferSize?: number;
  };
}

export interface GPUSearchStats {
  /** Whether GPU was used for the search */
  usedGPU: boolean;
  /** Processing time in milliseconds */
  processingTime?: number;
  /** Memory usage information */
  memoryUsage?: {
    bufferSize: number;
    transferred: number;
  };
  /** GPU capabilities used */
  gpuCapabilities?: {
    maxBufferSize: number;
    maxWorkgroupSize: number;
  };
}

/**
 * High-performance vector search engine with GPU acceleration
 */
export class GPUSearchEngine {
  private webGPUManager: WebGPUManager;
  private config: Required<GPUSearchConfig>;
  private isGPUAvailable = false;
  private initializationPromise: Promise<void> | null = null;

  constructor(config: GPUSearchConfig = {}) {
    this.config = {
      gpuThreshold: config.gpuThreshold || 1000,
      enableFallback: config.enableFallback ?? true,
      batchSize: config.batchSize || 1024,
      enableProfiling: config.enableProfiling ?? false,
      webGPUConfig: config.webGPUConfig || {}
    };

    this.webGPUManager = new WebGPUManager({
      ...this.config.webGPUConfig,
      enableProfiling: this.config.enableProfiling
    });
  }

  /**
   * Initialize GPU resources
   */
  async init(): Promise<void> {
    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    this.initializationPromise = this.initializeGPU();
    return this.initializationPromise;
  }

  /**
   * Check if GPU acceleration is available
   */
  isGPUReady(): boolean {
    return this.isGPUAvailable && this.webGPUManager.isAvailable();
  }

  /**
   * Get GPU capabilities
   */
  getGPUCapabilities() {
    return this.webGPUManager.getCapabilities();
  }

  /**
   * Perform similarity search with automatic GPU/CPU selection
   */
  async search(
    vectors: VectorData[],
    queryVector: Float32Array,
    k: number,
    metric: DistanceMetric = 'cosine',
    options?: SearchOptions
  ): Promise<{ results: SearchResult[]; stats: GPUSearchStats }> {
    const startTime = this.config.enableProfiling ? performance.now() : 0;

    // Determine if we should use GPU
    const shouldUseGPU = this.shouldUseGPUAcceleration(vectors.length, metric);
    let stats: GPUSearchStats = { usedGPU: false };

    try {
      if (shouldUseGPU) {
        const gpuResults = await this.searchWithGPU(vectors, queryVector, k, metric, options);
        stats = {
          usedGPU: true,
          ...(gpuResults.stats.processingTime !== undefined && { processingTime: gpuResults.stats.processingTime }),
          ...(gpuResults.stats.memoryUsage !== undefined && { memoryUsage: gpuResults.stats.memoryUsage }),
          ...(this.webGPUManager.getCapabilities() && { gpuCapabilities: this.webGPUManager.getCapabilities()! })
        };
        return { results: gpuResults.results, stats };
      }
    } catch (error) {
      console.warn('GPU search failed, falling back to CPU:', error);
      if (!this.config.enableFallback) {
        throw error;
      }
    }

    // Fallback to CPU search
    const cpuResults = await this.searchWithCPU(vectors, queryVector, k, metric, options);
    
    if (this.config.enableProfiling) {
      stats.processingTime = performance.now() - startTime;
    }

    return { results: cpuResults, stats };
  }

  /**
   * Batch search with GPU acceleration
   */
  async batchSearch(
    vectors: VectorData[],
    queryVectors: Float32Array[],
    k: number,
    metric: DistanceMetric = 'cosine',
    options?: SearchOptions
  ): Promise<{ results: SearchResult[][]; stats: GPUSearchStats[] }> {
    // Check if we should use GPU for batch operations
    const shouldUseGPU = this.shouldUseGPUAcceleration(vectors.length * queryVectors.length, metric);
    
    if (shouldUseGPU) {
      try {
        return await this.batchSearchWithGPU(vectors, queryVectors, k, metric, options);
      } catch (error) {
        console.warn('GPU batch search failed, falling back to CPU:', error);
        if (!this.config.enableFallback) {
          throw error;
        }
      }
    }

    // Fallback to CPU batch search
    const results: SearchResult[][] = [];
    const stats: GPUSearchStats[] = [];

    for (const queryVector of queryVectors) {
      const searchResult = await this.search(vectors, queryVector, k, metric, options);
      results.push(searchResult.results);
      stats.push(searchResult.stats);
    }

    return { results, stats };
  }

  /**
   * Cleanup GPU resources
   */
  async cleanup(): Promise<void> {
    await this.webGPUManager.cleanup();
    this.isGPUAvailable = false;
    this.initializationPromise = null;
  }

  // Private methods

  /**
   * Initialize GPU resources
   */
  private async initializeGPU(): Promise<void> {
    try {
      await this.webGPUManager.init();
      this.isGPUAvailable = true;
      console.log('GPU acceleration initialized successfully');
    } catch (error) {
      console.warn('Failed to initialize GPU acceleration:', error);
      this.isGPUAvailable = false;
      
      if (!this.config.enableFallback) {
        throw error;
      }
    }
  }

  /**
   * Determine if GPU acceleration should be used
   */
  private shouldUseGPUAcceleration(dataSize: number, metric: DistanceMetric): boolean {
    if (!this.isGPUAvailable) {
      return false;
    }

    // Check if metric is supported on GPU
    const supportedMetrics: DistanceMetric[] = ['cosine', 'euclidean', 'manhattan', 'dot'];
    if (!supportedMetrics.includes(metric)) {
      return false;
    }

    // Check if dataset is large enough to benefit from GPU
    return dataSize >= this.config.gpuThreshold;
  }

  /**
   * Perform search using GPU acceleration
   */
  private async searchWithGPU(
    vectors: VectorData[],
    queryVector: Float32Array,
    k: number,
    metric: DistanceMetric,
    options?: SearchOptions
  ): Promise<{ results: SearchResult[]; stats: GPUSearchStats }> {
    // Extract vector data
    const vectorsData = vectors.map(v => v.vector);
    
    // Compute similarities on GPU
    const computeResult = await this.webGPUManager.computeSimilarity(
      vectorsData,
      queryVector,
      metric
    );

    // Convert GPU results to search results
    const results: SearchResult[] = [];
    const scores = computeResult.scores;

    for (let i = 0; i < vectors.length; i++) {
      const score = scores[i]!;
      const distance = this.scoreToDistance(score, metric);
      const vectorData = vectors[i]!;
      
      const result: SearchResult = {
        id: vectorData.id,
        score,
        distance
      };
      if (options?.includeMetadata && vectorData.metadata !== undefined) {
        result.metadata = vectorData.metadata;
      }
      if (options?.includeVector) {
        result.vector = vectorData.vector;
      }
      results.push(result);
    }

    // Sort by score (highest first) and take top k
    results.sort((a, b) => b.score - a.score);
    const topK = results.slice(0, k);

    const stats: GPUSearchStats = {
      usedGPU: true
    };
    if (computeResult.processingTime !== undefined) {
      stats.processingTime = computeResult.processingTime;
    }
    if (computeResult.memoryUsage !== undefined) {
      stats.memoryUsage = computeResult.memoryUsage;
    }
    const capabilities = this.webGPUManager.getCapabilities();
    if (capabilities) {
      stats.gpuCapabilities = capabilities;
    }

    return { results: topK, stats };
  }

  /**
   * Perform batch search using GPU acceleration
   */
  private async batchSearchWithGPU(
    vectors: VectorData[],
    queryVectors: Float32Array[],
    k: number,
    metric: DistanceMetric,
    options?: SearchOptions
  ): Promise<{ results: SearchResult[][]; stats: GPUSearchStats[] }> {
    const vectorsData = vectors.map(v => v.vector);
    
    // Compute batch similarities on GPU
    const computeResults = await this.webGPUManager.computeBatchSimilarity(
      vectorsData,
      queryVectors,
      metric
    );

    const results: SearchResult[][] = [];
    const stats: GPUSearchStats[] = [];

    for (let q = 0; q < queryVectors.length; q++) {
      const computeResult = computeResults[q]!;
      const scores = computeResult.scores;
      
      const queryResults: SearchResult[] = [];
      
      for (let i = 0; i < vectors.length; i++) {
        const score = scores[i]!;
        const distance = this.scoreToDistance(score, metric);
        const vectorData = vectors[i]!;
        
        const result: SearchResult = {
          id: vectorData.id,
          score,
          distance
        };
        if (options?.includeMetadata && vectorData.metadata !== undefined) {
          result.metadata = vectorData.metadata;
        }
        if (options?.includeVector) {
          result.vector = vectorData.vector;
        }
        queryResults.push(result);
      }

      // Sort by score and take top k
      queryResults.sort((a, b) => b.score - a.score);
      results.push(queryResults.slice(0, k));

      const stat: GPUSearchStats = {
        usedGPU: true
      };
      if (computeResult.processingTime !== undefined) {
        stat.processingTime = computeResult.processingTime;
      }
      if (computeResult.memoryUsage !== undefined) {
        stat.memoryUsage = computeResult.memoryUsage;
      }
      const capabilities = this.webGPUManager.getCapabilities();
      if (capabilities) {
        stat.gpuCapabilities = capabilities;
      }
      stats.push(stat);
    }

    return { results, stats };
  }

  /**
   * Fallback CPU search implementation
   */
  private async searchWithCPU(
    vectors: VectorData[],
    queryVector: Float32Array,
    k: number,
    metric: DistanceMetric,
    options?: SearchOptions
  ): Promise<SearchResult[]> {
    // Simple CPU implementation for fallback
    const results: SearchResult[] = [];

    for (const vector of vectors) {
      const distance = this.calculateDistance(queryVector, vector.vector, metric);
      const score = this.distanceToScore(distance, metric);

      const result: SearchResult = {
        id: vector.id,
        score,
        distance
      };
      if (options?.includeMetadata && vector.metadata !== undefined) {
        result.metadata = vector.metadata;
      }
      if (options?.includeVector) {
        result.vector = vector.vector;
      }
      results.push(result);
    }

    // Sort by score and take top k
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, k);
  }

  /**
   * Calculate distance between two vectors
   */
  private calculateDistance(a: Float32Array, b: Float32Array, metric: DistanceMetric): number {
    switch (metric) {
      case 'cosine':
        return this.cosineDistance(a, b);
      case 'euclidean':
        return this.euclideanDistance(a, b);
      case 'manhattan':
        return this.manhattanDistance(a, b);
      case 'dot':
        return -this.dotProduct(a, b); // Negative for similarity
      case 'hamming':
      case 'jaccard':
        // For unsupported CPU fallback metrics, return a default distance
        return 1.0;
      default:
        throw new Error(`Unsupported metric: ${metric}`);
    }
  }

  /**
   * Convert distance to similarity score
   */
  private distanceToScore(distance: number, metric: DistanceMetric): number {
    switch (metric) {
      case 'cosine':
        return 1 - (distance / 2);
      case 'dot':
        return -distance;
      case 'euclidean':
      case 'manhattan':
        return Math.exp(-distance);
      default:
        return 1 / (1 + distance);
    }
  }

  /**
   * Convert score back to distance
   */
  private scoreToDistance(score: number, metric: DistanceMetric): number {
    switch (metric) {
      case 'cosine':
        return (1 - score) * 2;
      case 'dot':
        return -score;
      case 'euclidean':
      case 'manhattan':
        return -Math.log(score);
      default:
        return (1 / score) - 1;
    }
  }

  // Distance calculation methods
  private cosineDistance(a: Float32Array, b: Float32Array): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i]! * b[i]!;
      normA += a[i]! * a[i]!;
      normB += b[i]! * b[i]!;
    }

    const magnitude = Math.sqrt(normA * normB);
    return magnitude > 0 ? 1 - (dotProduct / magnitude) : 1;
  }

  private euclideanDistance(a: Float32Array, b: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      const diff = a[i]! - b[i]!;
      sum += diff * diff;
    }
    return Math.sqrt(sum);
  }

  private manhattanDistance(a: Float32Array, b: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      sum += Math.abs(a[i]! - b[i]!);
    }
    return sum;
  }

  private dotProduct(a: Float32Array, b: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      sum += a[i]! * b[i]!;
    }
    return sum;
  }
}