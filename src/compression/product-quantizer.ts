/**
 * Product Quantization (PQ) compression for high-dimensional vectors
 *
 * Product Quantization works by:
 * 1. Splitting vectors into M subspaces
 * 2. Learning K centroids per subspace via k-means
 * 3. Replacing subvectors with nearest centroid IDs
 * 4. Enabling fast asymmetric distance computation
 */

import {
  BaseCompressor,
  type CompressedVector,
  type CompressionConfig,
} from './base-compressor.js';
import { calculateVectorStatistics } from './compression-utils.js';

export type PQInitMethod = 'random' | 'kmeans++';

export interface PQConfig extends CompressionConfig {
  /** Number of subspaces (M) */
  subspaces?: number;
  /** Number of centroids per subspace (K) */
  centroidsPerSubspace?: number;
  /** Centroid initialization method */
  initMethod?: PQInitMethod;
  /** Maximum k-means iterations */
  maxIterations?: number;
  /** Convergence threshold for k-means */
  convergenceThreshold?: number;
  /** Number of training vectors to use (0 = use all) */
  trainingVectors?: number;
  /** Enable rotation optimization */
  enableRotation?: boolean;
  /** Use SIMD acceleration when available */
  useSIMD?: boolean;
}

export interface PQCodebook {
  /** Centroids for each subspace [subspace][centroid][dimension] */
  centroids: Float32Array[][];
  /** Subspace dimension */
  subspaceDim: number;
  /** Number of centroids per subspace */
  centroidsPerSubspace: number;
  /** Training statistics */
  trainingStats: {
    iterations: number;
    convergence: number;
    trainingTime: number;
    totalDistortion: number;
  };
}

export interface PQMetadata {
  /** Product quantization codebook */
  codebook: PQCodebook;
  /** PQ configuration used */
  config: Required<PQConfig>;
  /** Vector statistics from training */
  statistics: ReturnType<typeof calculateVectorStatistics>;
}

/**
 * Product Quantization compressor for high-dimensional vectors
 */
export class ProductQuantizer extends BaseCompressor {
  private pqConfig: Required<PQConfig>;
  private codebook: PQCodebook | null = null;
  private isTrained = false;

  constructor(config: PQConfig = {}) {
    super(config);

    this.pqConfig = {
      ...this.config,
      subspaces: config.subspaces ?? 8,
      centroidsPerSubspace: config.centroidsPerSubspace ?? 256,
      initMethod: config.initMethod ?? 'kmeans++',
      maxIterations: config.maxIterations ?? 50,
      convergenceThreshold: config.convergenceThreshold ?? 1e-6,
      trainingVectors: config.trainingVectors ?? 0,
      enableRotation: config.enableRotation ?? false,
      useSIMD: config.useSIMD ?? true,
    };
  }

  getAlgorithmName(): string {
    return `product-${this.pqConfig.subspaces}x${this.pqConfig.centroidsPerSubspace}`;
  }

  estimateCompressedSize(_vector: Float32Array): number {
    const bitsPerCode = Math.ceil(Math.log2(this.pqConfig.centroidsPerSubspace));
    const codesSize = Math.ceil((this.pqConfig.subspaces * bitsPerCode) / 8);

    // Only count the codes for size estimation (codebook is shared across many vectors)
    return codesSize + 64; // 64 bytes for minimal metadata
  }

  /**
   * Estimate codebook storage size
   */
  private estimateCodebookSize(dimension: number): number {
    const subspaceDim = Math.ceil(dimension / this.pqConfig.subspaces);
    const totalCentroids = this.pqConfig.subspaces * this.pqConfig.centroidsPerSubspace;
    return totalCentroids * subspaceDim * 4; // Float32 = 4 bytes
  }

  /**
   * Train the PQ codebook using k-means clustering
   */
  async trainCodebook(trainingVectors: Float32Array[]): Promise<void> {
    if (trainingVectors.length === 0) {
      throw new Error('Cannot train codebook with empty training set');
    }

    const startTime = performance.now();
    const firstVector = trainingVectors[0];
    if (!firstVector) {
      throw new Error('No training vectors provided');
    }
    const dimension = firstVector.length;
    const subspaceDim = Math.ceil(dimension / this.pqConfig.subspaces);

    // Validate all vectors have same dimension
    for (const vector of trainingVectors) {
      if (vector.length !== dimension) {
        throw new Error('All training vectors must have the same dimension');
      }
    }

    // Limit training vectors if specified
    let vectors = trainingVectors;
    if (
      this.pqConfig.trainingVectors > 0 &&
      trainingVectors.length > this.pqConfig.trainingVectors
    ) {
      vectors = this.sampleTrainingVectors(
        trainingVectors,
        this.pqConfig.trainingVectors,
      );
    }

    // Initialize codebook
    const centroids: Float32Array[][] = [];
    let totalDistortion = 0;
    let totalIterations = 0;

    // Train each subspace independently
    for (let m = 0; m < this.pqConfig.subspaces; m++) {
      const startDim = m * subspaceDim;
      const endDim = Math.min(startDim + subspaceDim, dimension);
      const actualSubspaceDim = endDim - startDim;

      // Extract subvectors for this subspace
      const subvectors = vectors.map((vector) => vector.slice(startDim, endDim));

      // Train k-means for this subspace
      const { centroids: subspaceCentroids, stats } = await this.trainSubspaceKMeans(
        subvectors,
        this.pqConfig.centroidsPerSubspace,
        actualSubspaceDim,
      );

      centroids.push(subspaceCentroids);
      totalDistortion += stats.distortion;
      totalIterations += stats.iterations;
    }

    const trainingTime = performance.now() - startTime;

    this.codebook = {
      centroids,
      subspaceDim,
      centroidsPerSubspace: this.pqConfig.centroidsPerSubspace,
      trainingStats: {
        iterations: Math.round(totalIterations / this.pqConfig.subspaces),
        convergence: totalDistortion,
        trainingTime,
        totalDistortion,
      },
    };

    this.isTrained = true;

    if (this.config.validateQuality) {
      console.log(
        `PQ codebook trained: ${this.pqConfig.subspaces} subspaces, ` +
          `${this.pqConfig.centroidsPerSubspace} centroids each, ` +
          `${trainingTime.toFixed(2)}ms`,
      );
    }
  }

  /**
   * Sample training vectors randomly
   */
  private sampleTrainingVectors(vectors: Float32Array[], count: number): Float32Array[] {
    const sampled: Float32Array[] = [];
    const indices = new Set<number>();

    while (indices.size < count && indices.size < vectors.length) {
      const index = Math.floor(Math.random() * vectors.length);
      if (!indices.has(index)) {
        indices.add(index);
        const selectedVector = vectors[index];
        if (selectedVector) {
          sampled.push(selectedVector);
        }
      }
    }

    return sampled;
  }

  /**
   * Train k-means clustering for a single subspace
   */
  private async trainSubspaceKMeans(
    subvectors: Float32Array[],
    k: number,
    dimension: number,
  ): Promise<{
    centroids: Float32Array[];
    stats: { iterations: number; distortion: number };
  }> {
    if (subvectors.length < k) {
      throw new Error(
        `Not enough training vectors (${subvectors.length}) for ${k} centroids`,
      );
    }

    // Initialize centroids
    let centroids = this.initializeCentroids(subvectors, k, dimension);
    let prevDistortion = Infinity;
    let iterations = 0;

    for (let iter = 0; iter < this.pqConfig.maxIterations; iter++) {
      // Assignment step: assign each vector to nearest centroid
      const assignments = new Array(subvectors.length);
      let totalDistortion = 0;

      for (let i = 0; i < subvectors.length; i++) {
        let minDist = Infinity;
        let bestCentroid = 0;

        for (let j = 0; j < k; j++) {
          const subvector = subvectors[i];
          const centroid = centroids[j];
          if (!subvector || !centroid) continue;
          const dist = this.euclideanDistance(subvector, centroid);
          if (dist < minDist) {
            minDist = dist;
            bestCentroid = j;
          }
        }

        assignments[i] = bestCentroid;
        totalDistortion += minDist * minDist;
      }

      // Update step: compute new centroids
      const newCentroids = this.updateCentroids(subvectors, assignments, k, dimension);

      // Check convergence
      const improvement = (prevDistortion - totalDistortion) / prevDistortion;
      if (improvement < this.pqConfig.convergenceThreshold) {
        centroids = newCentroids;
        iterations = iter + 1;
        break;
      }

      centroids = newCentroids;
      prevDistortion = totalDistortion;
      iterations = iter + 1;
    }

    return {
      centroids,
      stats: {
        iterations,
        distortion: prevDistortion,
      },
    };
  }

  /**
   * Initialize centroids using specified method
   */
  private initializeCentroids(
    vectors: Float32Array[],
    k: number,
    _dimension: number,
  ): Float32Array[] {
    if (this.pqConfig.initMethod === 'kmeans++') {
      return this.initializeCentroidsKMeansPlusPlus(vectors, k, _dimension);
    } else {
      return this.initializeCentroidsRandom(vectors, k, _dimension);
    }
  }

  /**
   * Initialize centroids using k-means++ method
   */
  private initializeCentroidsKMeansPlusPlus(
    vectors: Float32Array[],
    k: number,
    _dimension: number,
  ): Float32Array[] {
    const centroids: Float32Array[] = [];

    // Choose first centroid randomly
    const firstIndex = Math.floor(Math.random() * vectors.length);
    const firstVector = vectors[firstIndex];
    if (!firstVector) {
      throw new Error('No vectors available for k-means++ initialization');
    }
    centroids.push(new Float32Array(firstVector));

    // Choose remaining centroids using k-means++ logic
    for (let c = 1; c < k; c++) {
      const distances = new Array(vectors.length);
      let totalWeight = 0;

      // Calculate distance to nearest existing centroid
      for (let i = 0; i < vectors.length; i++) {
        let minDist = Infinity;
        for (const centroid of centroids) {
          const vector = vectors[i];
          if (!vector) continue;
          const dist = this.euclideanDistance(vector, centroid);
          minDist = Math.min(minDist, dist);
        }
        distances[i] = minDist * minDist;
        totalWeight += distances[i];
      }

      // Choose next centroid with probability proportional to squared distance
      let randomValue = Math.random() * totalWeight;
      for (let i = 0; i < vectors.length; i++) {
        randomValue -= distances[i];
        if (randomValue <= 0) {
          const selectedVector = vectors[i];
          if (selectedVector) {
            centroids.push(new Float32Array(selectedVector));
          }
          break;
        }
      }
    }

    return centroids;
  }

  /**
   * Initialize centroids randomly
   */
  private initializeCentroidsRandom(
    vectors: Float32Array[],
    k: number,
    _dimension: number,
  ): Float32Array[] {
    const centroids: Float32Array[] = [];
    const usedIndices = new Set<number>();

    while (centroids.length < k) {
      const index = Math.floor(Math.random() * vectors.length);
      if (!usedIndices.has(index)) {
        usedIndices.add(index);
        const selectedVector = vectors[index];
        if (selectedVector) {
          centroids.push(new Float32Array(selectedVector));
        }
      }
    }

    return centroids;
  }

  /**
   * Update centroids based on assignments
   */
  private updateCentroids(
    vectors: Float32Array[],
    assignments: number[],
    k: number,
    dimension: number,
  ): Float32Array[] {
    const centroids: Float32Array[] = [];
    const counts = new Array(k).fill(0);

    // Initialize centroids to zero
    for (let i = 0; i < k; i++) {
      centroids.push(new Float32Array(dimension));
    }

    // Accumulate vectors for each cluster
    for (let i = 0; i < vectors.length; i++) {
      const cluster = assignments[i];
      if (cluster === undefined) continue;
      counts[cluster]++;

      const vector = vectors[i];
      if (!vector) continue;

      for (let d = 0; d < dimension; d++) {
        const centroid = centroids[cluster];
        const vectorValue = vector[d];
        if (centroid && vectorValue !== undefined) {
          const centroidValue = centroid[d];
          if (centroidValue !== undefined) {
            centroid[d] = centroidValue + vectorValue;
          }
        }
      }
    }

    // Average to get new centroids
    for (let i = 0; i < k; i++) {
      const count = counts[i];
      if (count && count > 0) {
        const centroid = centroids[i];
        if (centroid) {
          for (let d = 0; d < dimension; d++) {
            const centroidValue = centroid[d];
            if (centroidValue !== undefined) {
              centroid[d] = centroidValue / count;
            }
          }
        }
      }
    }

    return centroids;
  }

  /**
   * Calculate Euclidean distance between two vectors
   */
  private euclideanDistance(a: Float32Array, b: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      const aValue = a[i];
      const bValue = b[i];
      if (aValue === undefined || bValue === undefined) continue;
      const diff = aValue - bValue;
      sum += diff * diff;
    }
    return Math.sqrt(sum);
  }

  /**
   * Encode a vector using the trained codebook
   */
  private encodeVector(vector: Float32Array): Uint8Array {
    if (!this.isTrained || !this.codebook) {
      throw new Error('Codebook must be trained before encoding');
    }

    const codes = new Uint8Array(this.pqConfig.subspaces);
    const subspaceDim = this.codebook.subspaceDim;

    for (let m = 0; m < this.pqConfig.subspaces; m++) {
      const startDim = m * subspaceDim;
      const endDim = Math.min(startDim + subspaceDim, vector.length);

      // Extract subvector
      const subvector = vector.slice(startDim, endDim);

      // Find nearest centroid
      let minDist = Infinity;
      let bestCode = 0;

      for (let k = 0; k < this.pqConfig.centroidsPerSubspace; k++) {
        const centroid = this.codebook.centroids[m]?.[k];
        if (!centroid) continue;
        const dist = this.euclideanDistance(subvector, centroid);

        if (dist < minDist) {
          minDist = dist;
          bestCode = k;
        }
      }

      codes[m] = bestCode;
    }

    return codes;
  }

  /**
   * Decode a vector from PQ codes (approximate reconstruction)
   */
  private decodeVector(codes: Uint8Array, originalDimension: number): Float32Array {
    if (!this.isTrained || !this.codebook) {
      throw new Error('Codebook must be trained before decoding');
    }

    const result = new Float32Array(originalDimension);
    const subspaceDim = this.codebook.subspaceDim;

    for (let m = 0; m < this.pqConfig.subspaces; m++) {
      const code = codes[m];
      if (code === undefined) continue;
      const centroid = this.codebook.centroids[m]?.[code];
      if (!centroid) {
        throw new Error(`Invalid centroid lookup: subspace ${m}, code ${code}`);
      }
      const startDim = m * subspaceDim;
      const endDim = Math.min(startDim + subspaceDim, originalDimension);

      // Copy centroid values to result
      for (let i = 0; i < endDim - startDim; i++) {
        const value = centroid[i];
        if (value !== undefined) {
          result[startDim + i] = value;
        }
      }
    }

    return result;
  }

  async compress(vector: Float32Array): Promise<CompressedVector> {
    if (!this.isTrained) {
      throw new Error(
        'Must train codebook before compression. Call trainCodebook() first.',
      );
    }

    const startTime = performance.now();

    // Encode vector to PQ codes
    const codes = this.encodeVector(vector);

    // Pack compressed data
    const compressedData = this.packCompressedData(codes, vector.length);

    // Calculate compression metadata
    const originalSize = vector.length * 4; // Float32 = 4 bytes
    // For PQ, only count the codes as compressed size (codebook is shared)
    const compressedSize = codes.length;

    // Validate quality if enabled
    let precisionLoss = 0;
    if (this.config.validateQuality) {
      const decompressed = this.decodeVector(codes, vector.length);
      const quality = await this.validateCompressionQuality(vector, decompressed);
      precisionLoss = 1 - quality.qualityScore;

      if (precisionLoss > this.config.maxPrecisionLoss) {
        throw new Error(
          `Compression quality too low: ${precisionLoss.toFixed(3)} > ${this.config.maxPrecisionLoss}`,
        );
      }
    }

    const metadata = this.createMetadata(
      originalSize,
      compressedSize,
      this.config.level,
      precisionLoss,
    );

    const compressionTime = performance.now() - startTime;

    return {
      data: compressedData,
      metadata: {
        ...metadata,
        algorithm: `${this.getAlgorithmName()}:${compressionTime.toFixed(2)}ms`,
      },
      dimension: vector.length,
      config: this.getConfig(),
    };
  }

  async decompress(compressed: CompressedVector): Promise<Float32Array> {
    return this.decompressData(compressed.data, compressed.dimension);
  }

  /**
   * Pack compressed data into buffer
   */
  private packCompressedData(codes: Uint8Array, originalDimension: number): ArrayBuffer {
    if (!this.codebook) {
      throw new Error('Codebook not available for packing');
    }

    // Calculate buffer sizes with proper alignment
    const codesSize = codes.length;
    const codebookSize = this.estimateCodebookSize(originalDimension);
    const metadataSize = 256; // Fixed size for metadata
    const alignedCodesSize = Math.ceil(codesSize / 4) * 4; // Align to 4 bytes
    const totalSize = metadataSize + alignedCodesSize + codebookSize;

    const buffer = new ArrayBuffer(totalSize);
    const metadataView = new DataView(buffer, 0, metadataSize);

    // Pack metadata (first 256 bytes)
    let offset = 0;

    // Header: version (4) + subspaces (4) + centroids (4) + dimension (4)
    metadataView.setUint32(offset, 1, true);
    offset += 4; // version
    metadataView.setUint32(offset, this.pqConfig.subspaces, true);
    offset += 4;
    metadataView.setUint32(offset, this.pqConfig.centroidsPerSubspace, true);
    offset += 4;
    metadataView.setUint32(offset, originalDimension, true);
    offset += 4;

    // Training stats: iterations (4) + convergence (4) + time (4) + distortion (4)
    metadataView.setUint32(offset, this.codebook.trainingStats.iterations, true);
    offset += 4;
    metadataView.setFloat32(offset, this.codebook.trainingStats.convergence, true);
    offset += 4;
    metadataView.setFloat32(offset, this.codebook.trainingStats.trainingTime, true);
    offset += 4;
    metadataView.setFloat32(offset, this.codebook.trainingStats.totalDistortion, true);
    offset += 4;

    // Pack codes with alignment
    const codesView = new Uint8Array(buffer, metadataSize, alignedCodesSize);
    codesView.set(codes);

    // Pack codebook (aligned)
    const codebookStart = metadataSize + alignedCodesSize;
    const codebookView = new Float32Array(buffer, codebookStart);
    let codebookOffset = 0;

    for (let m = 0; m < this.pqConfig.subspaces; m++) {
      for (let k = 0; k < this.pqConfig.centroidsPerSubspace; k++) {
        const centroid = this.codebook.centroids[m]?.[k];
        if (!centroid) continue;
        for (let d = 0; d < centroid.length; d++) {
          const value = centroid[d];
          if (value !== undefined) {
            codebookView[codebookOffset++] = value;
          }
        }
      }
    }

    return buffer;
  }

  /**
   * Decompress data from buffer
   */
  private decompressData(buffer: ArrayBuffer, originalDimension: number): Float32Array {
    const metadataView = new DataView(buffer, 0, 256);

    // Read metadata
    let offset = 0;
    // Skip version for now
    offset += 4;
    const subspaces = metadataView.getUint32(offset, true);
    offset += 4;
    const centroidsPerSubspace = metadataView.getUint32(offset, true);
    offset += 4;
    // Skip dimension for now
    offset += 4;

    // Skip training stats for now
    offset += 16;

    // Read codes
    const alignedCodesSize = Math.ceil(subspaces / 4) * 4;
    const codesView = new Uint8Array(buffer, 256, subspaces);
    const codes = new Uint8Array(codesView);

    // Read codebook with proper alignment
    const subspaceDim = Math.ceil(originalDimension / subspaces);
    const codebookStart = 256 + alignedCodesSize;
    const codebookView = new Float32Array(buffer, codebookStart);

    // Reconstruct codebook
    const centroids: Float32Array[][] = [];
    let codebookIndex = 0;

    for (let m = 0; m < subspaces; m++) {
      centroids[m] = [];
      for (let k = 0; k < centroidsPerSubspace; k++) {
        const actualSubspaceDim = Math.min(
          subspaceDim,
          originalDimension - m * subspaceDim,
        );
        const centroid = new Float32Array(actualSubspaceDim);
        for (let d = 0; d < actualSubspaceDim; d++) {
          const value = codebookView[codebookIndex++];
          if (value !== undefined) {
            centroid[d] = value;
          }
        }
        const subspaceCentroids = centroids[m];
        if (subspaceCentroids) {
          subspaceCentroids[k] = centroid;
        }
      }
    }

    // Reconstruct vector
    const result = new Float32Array(originalDimension);

    for (let m = 0; m < subspaces; m++) {
      const code = codes[m];
      if (code === undefined) continue;
      const centroid = centroids[m]?.[code];
      if (!centroid) {
        throw new Error(
          `Invalid centroid lookup during decompression: subspace ${m}, code ${code}`,
        );
      }
      const startDim = m * subspaceDim;
      const endDim = Math.min(startDim + subspaceDim, originalDimension);

      for (let i = 0; i < endDim - startDim; i++) {
        const value = centroid[i];
        if (value !== undefined) {
          result[startDim + i] = value;
        }
      }
    }

    return result;
  }

  /**
   * Compute asymmetric distance between query vector and compressed vector
   */
  asymmetricDistance(
    queryVector: Float32Array,
    codes: Uint8Array,
    metric: 'euclidean' | 'cosine' = 'euclidean',
  ): number {
    if (!this.isTrained || !this.codebook) {
      throw new Error('Codebook must be trained before distance computation');
    }

    const subspaceDim = this.codebook.subspaceDim;
    let totalDistance = 0;

    for (let m = 0; m < this.pqConfig.subspaces; m++) {
      const code = codes[m];
      if (code === undefined) continue;
      const centroid = this.codebook.centroids[m]?.[code];
      if (!centroid) {
        throw new Error(`Invalid centroid lookup: subspace ${m}, code ${code}`);
      }
      const startDim = m * subspaceDim;
      const endDim = Math.min(startDim + subspaceDim, queryVector.length);

      // Extract query subvector
      const querySubvector = queryVector.slice(startDim, endDim);

      // Compute distance for this subspace
      if (metric === 'euclidean') {
        const dist = this.euclideanDistance(querySubvector, centroid);
        totalDistance += dist * dist;
      } else if (metric === 'cosine') {
        // For cosine distance, we need to compute dot product and norms
        let dotProduct = 0;
        let queryNorm = 0;
        let centroidNorm = 0;

        for (let i = 0; i < querySubvector.length; i++) {
          const queryValue = querySubvector[i];
          const centroidValue = centroid[i];
          if (queryValue !== undefined && centroidValue !== undefined) {
            dotProduct += queryValue * centroidValue;
            queryNorm += queryValue * queryValue;
            centroidNorm += centroidValue * centroidValue;
          }
        }

        const similarity = dotProduct / (Math.sqrt(queryNorm) * Math.sqrt(centroidNorm));
        totalDistance += 1 - similarity; // Convert similarity to distance
      }
    }

    return metric === 'euclidean' ? Math.sqrt(totalDistance) : totalDistance;
  }

  /**
   * Get current PQ configuration
   */
  getPQConfig(): PQConfig {
    return { ...this.pqConfig };
  }

  /**
   * Update PQ configuration
   */
  updatePQConfig(config: Partial<PQConfig>): void {
    this.pqConfig = { ...this.pqConfig, ...config };
    this.updateConfig(config);
    // Note: Changing config invalidates trained codebook
    this.isTrained = false;
    this.codebook = null;
  }

  /**
   * Get codebook information
   */
  getCodebookInfo(): PQCodebook | null {
    return this.codebook ? { ...this.codebook } : null;
  }

  /**
   * Check if codebook is trained
   */
  isCodebookTrained(): boolean {
    return this.isTrained;
  }

  /**
   * Get compression statistics
   */
  getCompressionStats(vectorDimension: number): {
    theoreticalRatio: number;
    bitsPerCode: number;
    codesPerVector: number;
    totalBits: number;
  } {
    const bitsPerCode = Math.ceil(Math.log2(this.pqConfig.centroidsPerSubspace));
    const codesPerVector = this.pqConfig.subspaces;
    const totalBits = codesPerVector * bitsPerCode;
    const theoreticalRatio = (vectorDimension * 32) / totalBits; // 32 bits per Float32

    return {
      theoreticalRatio,
      bitsPerCode,
      codesPerVector,
      totalBits,
    };
  }
}
