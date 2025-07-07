/**
 * Compression strategy management and automatic selection
 */

import type { CompressionStrategy } from '@/core/types.js';
import { BaseCompressor, type CompressedVector, type CompressionConfig } from './base-compressor.js';
import { ScalarQuantizer } from './scalar-quantizer.js';
import { ProductQuantizer } from './product-quantizer.js';
import { calculateVectorStatistics, type VectorStatistics } from './compression-utils.js';

export interface CompressionManagerConfig {
  /** Default compression strategy */
  defaultStrategy?: CompressionStrategy;
  /** Auto-select strategy based on vector characteristics */
  autoSelect?: boolean;
  /** Minimum vector size to enable compression */
  minSizeForCompression?: number;
  /** Target compression ratio */
  targetCompressionRatio?: number;
  /** Maximum acceptable precision loss */
  maxPrecisionLoss?: number;
  /** Enable compression quality validation */
  validateQuality?: boolean;
  /** Performance vs quality trade-off (0=speed, 1=quality) */
  qualityBias?: number;
  /** Available memory budget for compression operations */
  memoryBudget?: number;
  /** Enable adaptive threshold learning */
  adaptiveThresholds?: boolean;
}

export interface CompressionRecommendation {
  /** Recommended strategy */
  strategy: CompressionStrategy;
  /** Estimated compression ratio */
  estimatedRatio: number;
  /** Estimated precision loss */
  estimatedPrecisionLoss: number;
  /** Reasoning for recommendation */
  reasoning: string;
  /** Confidence score (0-1) */
  confidence: number;
  /** Alternative strategies with scores */
  alternatives?: Array<{
    strategy: CompressionStrategy;
    score: number;
    reason: string;
  }>;
  /** Expected compression time in ms */
  estimatedCompressionTime?: number;
  /** Expected memory usage in bytes */
  estimatedMemoryUsage?: number;
}

interface VectorAnalysis {
  size: number;
  stats: VectorStatistics;
  sparsity: number;
  entropy: number;
  complexity: number;
  clustering: {
    numClusters: number;
    uniqueValues: number;
    clusterRatio: number;
  };
  patterns: {
    binaryLike: boolean;
    periodic: boolean;
    periodicScore: number;
  };
  dynamicRange: number;
  variance: number;
}

interface PerformanceStats {
  compressionTimes: number[];
  ratios: number[];
  qualityScores: number[];
  memoryUsage: number[];
}

/**
 * Manages compression strategies and automatic selection
 */
export class CompressionManager {
  private config: Required<CompressionManagerConfig>;
  private compressors: Map<CompressionStrategy, BaseCompressor>;
  private performanceStats: Map<CompressionStrategy, PerformanceStats>;
  private adaptiveThresholds: {
    sparsityThreshold: number;
    complexityThreshold: number;
    dimensionThreshold: number;
    entropyThreshold: number;
  };

  constructor(config: CompressionManagerConfig = {}) {
    this.config = {
      defaultStrategy: config.defaultStrategy ?? 'scalar',
      autoSelect: config.autoSelect ?? true,
      minSizeForCompression: config.minSizeForCompression ?? 64,
      targetCompressionRatio: config.targetCompressionRatio ?? 2.0,
      maxPrecisionLoss: config.maxPrecisionLoss ?? 0.05,
      validateQuality: config.validateQuality ?? true,
      qualityBias: config.qualityBias ?? 0.5,
      memoryBudget: config.memoryBudget ?? 100 * 1024 * 1024, // 100MB default
      adaptiveThresholds: config.adaptiveThresholds ?? true
    };

    this.compressors = new Map();
    this.performanceStats = new Map();
    this.adaptiveThresholds = {
      sparsityThreshold: 0.8,
      complexityThreshold: 0.8, // As a fraction
      dimensionThreshold: 512,  // Higher threshold for PQ
      entropyThreshold: 4.0     // Higher threshold for PQ
    };
    
    this.initializeCompressors();
    this.initializePerformanceTracking();
  }

  /**
   * Initialize available compressors
   */
  private initializeCompressors(): void {
    // Scalar quantization compressor
    this.compressors.set('scalar', new ScalarQuantizer({
      targetRatio: this.config.targetCompressionRatio,
      maxPrecisionLoss: this.config.maxPrecisionLoss,
      validateQuality: this.config.validateQuality
    }));

    // Product quantization compressor
    this.compressors.set('product', new ProductQuantizer({
      targetRatio: this.config.targetCompressionRatio,
      maxPrecisionLoss: this.config.maxPrecisionLoss,
      validateQuality: this.config.validateQuality,
      subspaces: 8,
      centroidsPerSubspace: 256
    }));

    // Note: Binary quantization will be added in future phases
  }

  /**
   * Initialize performance tracking for all strategies
   */
  private initializePerformanceTracking(): void {
    for (const [strategy] of this.compressors) {
      this.performanceStats.set(strategy, {
        compressionTimes: [],
        ratios: [],
        qualityScores: [],
        memoryUsage: []
      });
    }
  }

  /**
   * Compress a vector using the specified or auto-selected strategy
   */
  async compress(
    vector: Float32Array,
    strategy?: CompressionStrategy,
    config?: CompressionConfig,
    trainingVectors?: Float32Array[]
  ): Promise<CompressedVector> {
    // Check if compression is worthwhile
    if (vector.length < this.config.minSizeForCompression) {
      throw new Error(
        `Vector too small for compression: ${vector.length} < ${this.config.minSizeForCompression}`
      );
    }

    // Auto-select strategy if not specified
    const selectedStrategy = strategy || (
      this.config.autoSelect
        ? this.autoSelectStrategy(vector).strategy
        : this.config.defaultStrategy
    );

    const compressor = this.getCompressor(selectedStrategy);
    
    // Update compressor config if provided
    if (config) {
      compressor.updateConfig(config);
    }

    // Handle Product Quantization training requirement
    if (selectedStrategy === 'product' && compressor instanceof ProductQuantizer) {
      if (!compressor.isCodebookTrained()) {
        if (!trainingVectors || trainingVectors.length === 0) {
          // Fall back to scalar quantization if no training vectors available
          console.warn('Product quantization selected but no training vectors provided, falling back to scalar quantization');
          return this.compress(vector, 'scalar', config);
        }
        await compressor.trainCodebook(trainingVectors);
      }
    }

    return compressor.compress(vector);
  }

  /**
   * Decompress a vector
   */
  async decompress(compressed: CompressedVector): Promise<Float32Array> {
    const algorithmName = compressed.metadata.algorithm.split(':')[0]?.split('-')[0];
    if (!algorithmName) {
      throw new Error('Invalid compression algorithm in metadata');
    }
    const strategy = this.mapAlgorithmToStrategy(algorithmName);
    
    const compressor = this.getCompressor(strategy);
    return compressor.decompress(compressed);
  }

  /**
   * Auto-select the best compression strategy for a vector using advanced analysis
   */
  autoSelectStrategy(vector: Float32Array): CompressionRecommendation {
    const analysis = this.analyzeVector(vector);
    const candidates = this.evaluateAllStrategies(vector, analysis);
    
    // Sort candidates by composite score
    candidates.sort((a, b) => b.score - a.score);
    
    const best = candidates[0];
    if (!best) {
      throw new Error('No compression strategy candidates found');
    }
    const alternatives = candidates.slice(1).map(c => ({
      strategy: c.strategy,
      score: c.score,
      reason: c.reasoning
    }));

    // Update adaptive thresholds if enabled
    if (this.config.adaptiveThresholds) {
      this.updateAdaptiveThresholds(analysis);
    }

    return {
      strategy: best.strategy,
      estimatedRatio: best.estimatedRatio,
      estimatedPrecisionLoss: best.estimatedPrecisionLoss,
      reasoning: best.reasoning,
      confidence: best.score,
      alternatives,
      estimatedCompressionTime: best.estimatedTime,
      estimatedMemoryUsage: best.estimatedMemory
    };
  }

  /**
   * Analyze vector characteristics comprehensively
   */
  private analyzeVector(vector: Float32Array): VectorAnalysis {
    const stats = calculateVectorStatistics(vector);
    const sparsity = this.calculateSparsity(vector);
    const entropy = this.calculateEntropy(vector);
    const complexity = this.calculateComplexity(vector);
    const clustering = this.analyzeValueClustering(vector);
    const patterns = this.detectPatterns(vector);
    
    return {
      size: vector.length,
      stats,
      sparsity,
      entropy,
      complexity,
      clustering,
      patterns,
      dynamicRange: stats.range,
      variance: stats.std * stats.std
    };
  }

  /**
   * Evaluate all available strategies for a vector
   */
  private evaluateAllStrategies(vector: Float32Array, analysis: VectorAnalysis) {
    const candidates: Array<{
      strategy: CompressionStrategy;
      score: number;
      estimatedRatio: number;
      estimatedPrecisionLoss: number;
      estimatedTime: number;
      estimatedMemory: number;
      reasoning: string;
    }> = [];

    for (const [strategy] of this.compressors) {
      const evaluation = this.evaluateStrategy(strategy, vector, analysis);
      candidates.push(evaluation);
    }

    return candidates;
  }

  /**
   * Evaluate a specific strategy for a vector
   */
  private evaluateStrategy(strategy: CompressionStrategy, vector: Float32Array, analysis: VectorAnalysis) {
    const stats = this.performanceStats.get(strategy);
    const baseScore = this.calculateBaseScore(strategy, analysis);
    const performanceBonus = this.calculatePerformanceBonus(strategy, stats);
    const memoryPenalty = this.calculateMemoryPenalty(strategy, vector.length);
    
    const score = Math.max(0, Math.min(1, baseScore + performanceBonus - memoryPenalty));
    
    return {
      strategy,
      score,
      estimatedRatio: this.estimateCompressionRatio(vector, strategy),
      estimatedPrecisionLoss: this.estimatePrecisionLoss(vector, strategy),
      estimatedTime: this.estimateCompressionTime(strategy, vector.length),
      estimatedMemory: this.estimateMemoryUsage(strategy, vector.length),
      reasoning: this.generateReasoning(strategy, analysis, score)
    };
  }

  /**
   * Calculate base score for a strategy based on vector characteristics
   */
  private calculateBaseScore(strategy: CompressionStrategy, analysis: VectorAnalysis): number {
    let score = 0.3; // lower baseline
    
    switch (strategy) {
      case 'scalar':
        // Scalar quantization is the default choice - give it a strong baseline
        score = 0.7; // High baseline for scalar
        // Additional bonuses for scalar-friendly characteristics
        if (analysis.size <= this.adaptiveThresholds.dimensionThreshold) score += 0.1;
        if (analysis.complexity <= this.adaptiveThresholds.complexityThreshold) score += 0.1;
        if (this.config.qualityBias < 0.5) score += 0.05; // Speed preference
        if (analysis.sparsity < 0.3) score += 0.05; // Dense vectors
        break;
        
      case 'product':
        // Product quantization only for clearly beneficial cases
        score = 0.3; // Lower baseline
        if (analysis.size >= this.adaptiveThresholds.dimensionThreshold) score += 0.4;
        if (analysis.entropy >= this.adaptiveThresholds.entropyThreshold) score += 0.2;
        if (analysis.complexity > this.adaptiveThresholds.complexityThreshold) score += 0.2;
        if (this.config.qualityBias > 0.7) score += 0.1; // Strong quality preference
        if (analysis.clustering.numClusters > 6) score += 0.1; // Very complex structure
        break;
        
      case 'binary':
        // Binary quantization would be good for:
        // - Very sparse vectors
        // - Binary-like patterns
        if (analysis.sparsity >= this.adaptiveThresholds.sparsityThreshold) score += 0.4;
        if (analysis.patterns.binaryLike) score += 0.3;
        score -= 0.5; // Not implemented yet
        break;
    }
    
    return Math.max(0, Math.min(1, score));
  }

  /**
   * Calculate performance bonus based on historical data
   */
  private calculatePerformanceBonus(_strategy: CompressionStrategy, stats: PerformanceStats | undefined): number {
    if (!stats || stats.ratios.length === 0) return 0;
    
    const avgRatio = stats.ratios.reduce((a, b) => a + b, 0) / stats.ratios.length;
    const avgQuality = stats.qualityScores.reduce((a, b) => a + b, 0) / stats.qualityScores.length;
    const avgTime = stats.compressionTimes.reduce((a, b) => a + b, 0) / stats.compressionTimes.length;
    
    let bonus = 0;
    
    // Reward good compression ratios
    if (avgRatio > this.config.targetCompressionRatio) bonus += 0.1;
    
    // Reward good quality
    if (avgQuality > 0.8) bonus += 0.1;
    
    // Reward fast compression (if speed is preferred)
    if (this.config.qualityBias < 0.5 && avgTime < 50) bonus += 0.05;
    
    return bonus;
  }

  /**
   * Calculate memory penalty if strategy exceeds budget
   */
  private calculateMemoryPenalty(strategy: CompressionStrategy, vectorSize: number): number {
    const estimatedMemory = this.estimateMemoryUsage(strategy, vectorSize);
    if (estimatedMemory > this.config.memoryBudget) {
      return 0.2; // Significant penalty for exceeding budget
    }
    return 0;
  }

  /**
   * Generate human-readable reasoning for strategy selection
   */
  private generateReasoning(strategy: CompressionStrategy, analysis: VectorAnalysis, score: number): string {
    const reasons: string[] = [];
    
    if (analysis.size < 128) {
      reasons.push('small vector size');
    } else if (analysis.size >= 512) {
      reasons.push('large vector size');
    }
    
    if (analysis.sparsity > 0.7) {
      reasons.push('high sparsity');
    } else if (analysis.sparsity < 0.2) {
      reasons.push('dense structure');
    }
    
    if (analysis.complexity > this.adaptiveThresholds.complexityThreshold) {
      reasons.push('high complexity');
    }
    
    if (analysis.entropy > this.adaptiveThresholds.entropyThreshold) {
      reasons.push('high entropy');
    }
    
    const confidenceLevel = score > 0.8 ? 'high' : score > 0.6 ? 'medium' : 'low';
    const primaryReason = reasons.length > 0 ? reasons.join(', ') : 'general characteristics';
    
    return `${strategy} quantization selected (${confidenceLevel} confidence) due to ${primaryReason}`;
  }

  /**
   * Get compression recommendation for a vector
   */
  getRecommendation(vector: Float32Array): CompressionRecommendation {
    return this.autoSelectStrategy(vector);
  }

  /**
   * Estimate compression ratio for a vector with given strategy
   */
  estimateCompressionRatio(
    vector: Float32Array,
    strategy: CompressionStrategy
  ): number {
    const compressor = this.getCompressor(strategy);
    const originalSize = vector.length * 4; // Float32 = 4 bytes
    const estimatedCompressedSize = compressor.estimateCompressedSize(vector);
    
    return originalSize / estimatedCompressedSize;
  }

  /**
   * Compare compression strategies for a vector
   */
  compareStrategies(vector: Float32Array): Map<CompressionStrategy, CompressionRecommendation> {
    const comparisons = new Map<CompressionStrategy, CompressionRecommendation>();
    
    for (const [strategy] of this.compressors) {
      const ratio = this.estimateCompressionRatio(vector, strategy);
      
      comparisons.set(strategy, {
        strategy,
        estimatedRatio: ratio,
        estimatedPrecisionLoss: this.estimatePrecisionLoss(vector, strategy),
        reasoning: this.getStrategyDescription(strategy),
        confidence: 0.5 // Default confidence
      });
    }
    
    return comparisons;
  }

  /**
   * Batch compress multiple vectors
   */
  async compressBatch(
    vectors: Float32Array[],
    strategy?: CompressionStrategy,
    config?: CompressionConfig
  ): Promise<CompressedVector[]> {
    if (vectors.length === 0) {
      return [];
    }

    // Use first vector for strategy selection if auto-selecting
    const firstVector = vectors[0];
    if (!firstVector) {
      throw new Error('No vectors provided for compression');
    }
    
    const selectedStrategy = strategy || (
      this.config.autoSelect
        ? this.autoSelectStrategy(firstVector).strategy
        : this.config.defaultStrategy
    );

    const compressor = this.getCompressor(selectedStrategy);
    
    // Update compressor config if provided
    if (config) {
      compressor.updateConfig(config);
    }

    // Handle Product Quantization training for batch
    if (selectedStrategy === 'product' && compressor instanceof ProductQuantizer) {
      if (!compressor.isCodebookTrained()) {
        // Use all vectors for training in batch mode
        await compressor.trainCodebook(vectors);
      }
    }

    // Use batch compression if available
    if (compressor instanceof ScalarQuantizer) {
      return compressor.compressBatch(vectors);
    }

    // Fallback to individual compression
    const results: CompressedVector[] = [];
    for (const vector of vectors) {
      if (vector.length >= this.config.minSizeForCompression) {
        results.push(await compressor.compress(vector));
      } else {
        throw new Error(`Vector too small for compression: ${vector.length}`);
      }
    }
    
    return results;
  }

  /**
   * Get compressor for strategy
   */
  private getCompressor(strategy: CompressionStrategy): BaseCompressor {
    const compressor = this.compressors.get(strategy);
    if (!compressor) {
      throw new Error(`Unsupported compression strategy: ${strategy}`);
    }
    return compressor;
  }

  /**
   * Map algorithm name back to strategy
   */
  private mapAlgorithmToStrategy(algorithmName: string): CompressionStrategy {
    if (algorithmName.startsWith('scalar')) return 'scalar';
    if (algorithmName.startsWith('product')) return 'product';
    if (algorithmName.startsWith('binary')) return 'binary';
    
    return 'scalar'; // default fallback
  }

  /**
   * Calculate complexity metric for a vector
   */
  private calculateComplexity(vector: Float32Array): number {
    let variations = 0;
    for (let i = 1; i < vector.length; i++) {
      const diff = Math.abs(vector[i]! - vector[i - 1]!);
      if (diff > 1e-6) variations++;
    }
    return variations / (vector.length - 1);
  }

  /**
   * Analyze value clustering in vector
   */
  private analyzeValueClustering(vector: Float32Array) {
    const values = Array.from(vector).sort((a, b) => a - b);
    const uniqueValues = [...new Set(values)];
    
    // Simple clustering analysis
    let clusters = 1;
    const threshold = (values[values.length - 1]! - values[0]!) / 10;
    
    for (let i = 1; i < uniqueValues.length; i++) {
      if (uniqueValues[i]! - uniqueValues[i - 1]! > threshold) {
        clusters++;
      }
    }
    
    return {
      numClusters: clusters,
      uniqueValues: uniqueValues.length,
      clusterRatio: clusters / uniqueValues.length
    };
  }

  /**
   * Detect patterns in vector values
   */
  private detectPatterns(vector: Float32Array) {
    const values = Array.from(vector);
    const uniqueValues = [...new Set(values)];
    
    // Check if values are binary-like (only 2-3 distinct values)
    const binaryLike = uniqueValues.length <= 3;
    
    // Check for periodic patterns
    let periodicScore = 0;
    for (let period = 2; period <= Math.min(16, vector.length / 4); period++) {
      let matches = 0;
      for (let i = period; i < vector.length; i++) {
        if (Math.abs(vector[i]! - vector[i - period]!) < 1e-6) {
          matches++;
        }
      }
      periodicScore = Math.max(periodicScore, matches / (vector.length - period));
    }
    
    return {
      binaryLike,
      periodic: periodicScore > 0.8,
      periodicScore
    };
  }

  /**
   * Estimate compression time for a strategy
   */
  private estimateCompressionTime(strategy: CompressionStrategy, vectorSize: number): number {
    const stats = this.performanceStats.get(strategy);
    if (stats && stats.compressionTimes.length > 0) {
      const avgTime = stats.compressionTimes.reduce((a, b) => a + b, 0) / stats.compressionTimes.length;
      return avgTime * (vectorSize / 256); // Scale by vector size
    }
    
    // Fallback estimates
    switch (strategy) {
      case 'scalar': return vectorSize * 0.01; // Very fast
      case 'product': return vectorSize * 0.1;  // Slower due to training
      case 'binary': return vectorSize * 0.005; // Fastest
      default: return vectorSize * 0.05;
    }
  }

  /**
   * Estimate memory usage for a strategy
   */
  private estimateMemoryUsage(strategy: CompressionStrategy, vectorSize: number): number {
    switch (strategy) {
      case 'scalar':
        return vectorSize * 1.5; // Original + quantized data
      case 'product': {
        // Codebook size for PQ
        const subspaces = 8;
        const centroids = 256;
        const subspaceDim = Math.ceil(vectorSize / subspaces);
        return subspaces * centroids * subspaceDim * 4; // Float32
      }
      case 'binary':
        return vectorSize * 0.5; // Much smaller
      default:
        return vectorSize * 2;
    }
  }

  /**
   * Update adaptive thresholds based on vector analysis
   */
  private updateAdaptiveThresholds(analysis: VectorAnalysis): void {
    // Simple adaptive learning - adjust thresholds based on recent data
    const learningRate = 0.1;
    
    // Adjust sparsity threshold
    if (analysis.sparsity > this.adaptiveThresholds.sparsityThreshold) {
      this.adaptiveThresholds.sparsityThreshold += 
        (analysis.sparsity - this.adaptiveThresholds.sparsityThreshold) * learningRate;
    }
    
    // Adjust complexity threshold
    if (analysis.complexity !== this.adaptiveThresholds.complexityThreshold) {
      this.adaptiveThresholds.complexityThreshold += 
        (analysis.complexity - this.adaptiveThresholds.complexityThreshold) * learningRate;
    }
    
    // Adjust entropy threshold
    if (analysis.entropy !== this.adaptiveThresholds.entropyThreshold) {
      this.adaptiveThresholds.entropyThreshold += 
        (analysis.entropy - this.adaptiveThresholds.entropyThreshold) * learningRate;
    }
  }

  /**
   * Record performance metrics for a compression operation
   */
  recordPerformance(
    strategy: CompressionStrategy,
    compressionTime: number,
    ratio: number,
    qualityScore: number,
    memoryUsage: number
  ): void {
    const stats = this.performanceStats.get(strategy);
    if (stats) {
      stats.compressionTimes.push(compressionTime);
      stats.ratios.push(ratio);
      stats.qualityScores.push(qualityScore);
      stats.memoryUsage.push(memoryUsage);
      
      // Keep only recent data (last 100 operations)
      const maxHistory = 100;
      if (stats.compressionTimes.length > maxHistory) {
        stats.compressionTimes.shift();
        stats.ratios.shift();
        stats.qualityScores.shift();
        stats.memoryUsage.shift();
      }
    }
  }

  /**
   * Calculate vector sparsity (fraction of near-zero values)
   */
  private calculateSparsity(vector: Float32Array): number {
    const threshold = 1e-6;
    let zeroCount = 0;
    
    for (let i = 0; i < vector.length; i++) {
      if (Math.abs(vector[i]!) < threshold) {
        zeroCount++;
      }
    }
    
    return zeroCount / vector.length;
  }

  /**
   * Calculate approximate entropy of vector values
   */
  private calculateEntropy(vector: Float32Array): number {
    // Simplified entropy calculation using binning
    const bins = 32;
    const stats = calculateVectorStatistics(vector);
    const binSize = stats.range / bins;
    const binCounts = new Array(bins).fill(0);
    
    for (let i = 0; i < vector.length; i++) {
      const binIndex = Math.min(bins - 1, Math.floor((vector[i]! - stats.min) / binSize));
      binCounts[binIndex]++;
    }
    
    let entropy = 0;
    for (const count of binCounts) {
      if (count > 0) {
        const probability = count / vector.length;
        entropy -= probability * Math.log2(probability);
      }
    }
    
    return entropy;
  }

  /**
   * Estimate precision loss for a strategy
   */
  private estimatePrecisionLoss(vector: Float32Array, strategy: CompressionStrategy): number {
    // Simplified estimation based on strategy characteristics
    switch (strategy) {
      case 'scalar':
        return 0.02; // ~2% precision loss typical for 8-bit scalar quantization
      case 'product': {
        // PQ precision loss depends on vector dimension and subspace configuration
        const subspaces = 8;
        const subspaceDim = Math.ceil(vector.length / subspaces);
        return Math.min(0.08, 0.02 + (subspaceDim / 1000)); // Higher loss for larger subspaces
      }
      case 'binary':
        return 0.1;  // ~10% precision loss for binary quantization
      default:
        return 0.05;
    }
  }

  /**
   * Get description for a strategy
   */
  private getStrategyDescription(strategy: CompressionStrategy): string {
    switch (strategy) {
      case 'scalar':
        return 'Uniform quantization of all vector components to reduced bit precision';
      case 'product':
        return 'Divides vectors into subspaces and quantizes each using learned centroids via k-means';
      case 'binary':
        return 'Binarization of vector components for maximum compression';
      default:
        return 'Unknown compression strategy';
    }
  }

  /**
   * Update manager configuration
   */
  updateConfig(config: Partial<CompressionManagerConfig>): void {
    this.config = { ...this.config, ...config };
    
    // Update compressor configs if needed
    for (const compressor of this.compressors.values()) {
      compressor.updateConfig({
        targetRatio: this.config.targetCompressionRatio,
        maxPrecisionLoss: this.config.maxPrecisionLoss,
        validateQuality: this.config.validateQuality
      });
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): CompressionManagerConfig {
    return { ...this.config };
  }

  /**
   * Get available compression strategies
   */
  getAvailableStrategies(): CompressionStrategy[] {
    return Array.from(this.compressors.keys());
  }
}