/**
 * SharedArrayBuffer memory management and zero-copy operations
 */

import type { DistanceMetric } from '../core/types.js';

export interface SharedMemoryConfig {
  /** Maximum memory pool size in bytes */
  maxPoolSize?: number;
  /** Initial buffer size for new allocations */
  initialBufferSize?: number;
  /** Memory alignment for optimal performance */
  alignment?: number;
  /** Enable memory statistics tracking */
  enableStats?: boolean;
}

export interface MemoryBlock {
  buffer: SharedArrayBuffer;
  offset: number;
  size: number;
  inUse: boolean;
  created: number;
  lastUsed: number;
}

export interface SharedMemoryLayout {
  /** Total vectors in the buffer */
  vectorCount: number;
  /** Vector dimension */
  dimension: number;
  /** Bytes per vector element */
  bytesPerElement: number;
  /** Total buffer size */
  bufferSize: number;
  /** Header size for metadata */
  headerSize: number;
  /** Offset where vector data starts */
  dataOffset: number;
}

export interface SharedMemoryStats {
  totalAllocated: number;
  totalUsed: number;
  activeBlocks: number;
  poolHits: number;
  poolMisses: number;
  fragmentationRatio: number;
}

/**
 * Manages SharedArrayBuffer memory pools for zero-copy vector operations
 */
export class SharedMemoryManager {
  private memoryPool: MemoryBlock[] = [];
  private config: Required<SharedMemoryConfig>;
  private stats: SharedMemoryStats = {
    totalAllocated: 0,
    totalUsed: 0,
    activeBlocks: 0,
    poolHits: 0,
    poolMisses: 0,
    fragmentationRatio: 0,
  };

  constructor(config: SharedMemoryConfig = {}) {
    this.config = {
      maxPoolSize: config.maxPoolSize || 100 * 1024 * 1024, // 100MB default
      initialBufferSize: config.initialBufferSize || 1024 * 1024, // 1MB default
      alignment: config.alignment || 8,
      enableStats: config.enableStats ?? true,
    };

    // Check SharedArrayBuffer support
    if (typeof SharedArrayBuffer === 'undefined') {
      throw new Error('SharedArrayBuffer is not supported in this environment');
    }
  }

  /**
   * Allocate a shared memory block for vector storage
   */
  allocateVectorBuffer(
    vectorCount: number,
    dimension: number,
    bytesPerElement: number = 4,
  ): { buffer: SharedArrayBuffer; layout: SharedMemoryLayout } {
    const headerSize = this.align(64); // 64 bytes for header metadata
    const dataSize = vectorCount * dimension * bytesPerElement;
    const totalSize = headerSize + dataSize;

    // Try to find existing block from pool
    let block = this.findAvailableBlock(totalSize);

    if (!block) {
      // Create new block
      const bufferSize = Math.max(totalSize, this.config.initialBufferSize);
      block = this.createBlock(bufferSize);
      this.stats.poolMisses++;
    } else {
      this.stats.poolHits++;
    }

    // Mark as in use
    block.inUse = true;
    block.lastUsed = Date.now();

    // Create layout information
    const layout: SharedMemoryLayout = {
      vectorCount,
      dimension,
      bytesPerElement,
      bufferSize: block.size,
      headerSize,
      dataOffset: headerSize,
    };

    // Initialize header with metadata
    this.initializeHeader(block.buffer, layout);

    this.updateStats();
    return { buffer: block.buffer, layout };
  }

  /**
   * Release a shared memory block back to the pool
   */
  releaseBuffer(buffer: SharedArrayBuffer): void {
    const block = this.memoryPool.find((b) => b.buffer === buffer);
    if (block) {
      block.inUse = false;
      block.lastUsed = Date.now();
      this.updateStats();
    }
  }

  /**
   * Copy vectors to shared memory with optimal layout
   */
  copyVectorsToSharedMemory(
    vectors: Float32Array[],
    buffer: SharedArrayBuffer,
    layout: SharedMemoryLayout,
    options: {
      normalize?: boolean;
      quantize?: boolean;
      quantizationBits?: number;
    } = {},
  ): void {
    if (vectors.length > layout.vectorCount) {
      throw new Error('Not enough space in shared buffer for all vectors');
    }

    const dataView = new DataView(buffer, layout.dataOffset);
    let offset = 0;

    for (let i = 0; i < vectors.length; i++) {
      let vector = vectors[i];
      if (!vector) continue;

      // Apply preprocessing if requested
      if (options.normalize) {
        vector = this.normalizeVector(vector);
      }

      if (options.quantize) {
        // Quantize to reduce memory usage
        const quantized = this.quantizeVector(vector, options.quantizationBits || 8);
        for (let j = 0; j < quantized.length; j++) {
          dataView.setInt8(offset + j, quantized[j]!);
        }
        offset += quantized.length;
      } else {
        // Store as float32
        for (let j = 0; j < vector.length; j++) {
          dataView.setFloat32(offset + j * 4, vector[j]!, true); // little endian
        }
        offset += vector.length * 4;
      }
    }
  }

  /**
   * Create optimized memory layout for batch operations
   */
  createBatchLayout(
    batches: { vectors: Float32Array[]; queryVectors: Float32Array[] }[],
    options: {
      interleaveData?: boolean;
      alignVectors?: boolean;
      separateQueryData?: boolean;
    } = {},
  ): {
    buffer: SharedArrayBuffer;
    layout: {
      batches: Array<{
        vectorsOffset: number;
        queriesOffset: number;
        vectorCount: number;
        queryCount: number;
      }>;
      totalSize: number;
    };
  } {
    const totalVectors = batches.reduce((sum, batch) => sum + batch.vectors.length, 0);
    const totalQueries = batches.reduce(
      (sum, batch) => sum + batch.queryVectors.length,
      0,
    );

    if (batches.length === 0 || !batches[0] || !batches[0].vectors[0]) {
      throw new Error('Invalid batch data provided');
    }
    const dimension = batches[0].vectors[0].length;
    const bytesPerVector = dimension * 4; // Float32

    // Calculate layout
    const headerSize = this.align(128);
    let currentOffset = headerSize;

    const batchLayouts = batches.map((batch) => {
      const vectorsOffset = currentOffset;
      const vectorsSize = batch.vectors.length * bytesPerVector;
      currentOffset += vectorsSize;

      if (options.alignVectors) {
        currentOffset = this.align(currentOffset);
      }

      const queriesOffset = currentOffset;
      const queriesSize = batch.queryVectors.length * bytesPerVector;
      currentOffset += queriesSize;

      if (options.alignVectors) {
        currentOffset = this.align(currentOffset);
      }

      return {
        vectorsOffset,
        queriesOffset,
        vectorCount: batch.vectors.length,
        queryCount: batch.queryVectors.length,
      };
    });

    const totalSize = currentOffset;
    const { buffer } = this.allocateVectorBuffer(totalVectors + totalQueries, dimension);

    // Copy data to shared memory
    const dataView = new DataView(buffer, headerSize);

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const layout = batchLayouts[i];
      if (!batch || !layout) continue;

      // Copy vectors
      for (let j = 0; j < batch.vectors.length; j++) {
        const vector = batch.vectors[j];
        if (!vector) continue;
        const offset = layout.vectorsOffset - headerSize + j * bytesPerVector;
        for (let k = 0; k < vector.length; k++) {
          dataView.setFloat32(offset + k * 4, vector[k]!, true);
        }
      }

      // Copy queries
      for (let j = 0; j < batch.queryVectors.length; j++) {
        const query = batch.queryVectors[j];
        if (!query) continue;
        const offset = layout.queriesOffset - headerSize + j * bytesPerVector;
        for (let k = 0; k < query.length; k++) {
          dataView.setFloat32(offset + k * 4, query[k]!, true);
        }
      }
    }

    return {
      buffer,
      layout: {
        batches: batchLayouts,
        totalSize,
      },
    };
  }

  /**
   * Create memory-mapped vector view for efficient access
   */
  createVectorView(
    buffer: SharedArrayBuffer,
    layout: SharedMemoryLayout,
    vectorIndex: number,
  ): Float32Array {
    const vectorSize = layout.dimension * layout.bytesPerElement;
    const vectorOffset = layout.dataOffset + vectorIndex * vectorSize;

    return new Float32Array(buffer, vectorOffset, layout.dimension);
  }

  /**
   * Batch create multiple vector views
   */
  createBatchVectorViews(
    buffer: SharedArrayBuffer,
    layout: SharedMemoryLayout,
    startIndex: number = 0,
    count?: number,
  ): Float32Array[] {
    const actualCount = count || layout.vectorCount - startIndex;
    const views: Float32Array[] = [];

    for (let i = 0; i < actualCount; i++) {
      views.push(this.createVectorView(buffer, layout, startIndex + i));
    }

    return views;
  }

  /**
   * Efficient similarity search using shared memory
   */
  async sharedMemoryBatchSearch(
    vectors: Float32Array[],
    queries: Float32Array[],
    k: number,
    metric: DistanceMetric,
    options: {
      chunkSize?: number;
      normalize?: boolean;
      quantize?: boolean;
    } = {},
  ): Promise<Array<Array<{ index: number; distance: number; score: number }>>> {
    const chunkSize = options.chunkSize || 1000;
    const results: Array<Array<{ index: number; distance: number; score: number }>> = [];

    // Process in chunks to manage memory efficiently
    for (let i = 0; i < queries.length; i += chunkSize) {
      const queryChunk = queries.slice(i, i + chunkSize);

      // Create shared memory layout for this chunk
      const { buffer, layout } = this.createBatchLayout(
        [
          {
            vectors,
            queryVectors: queryChunk,
          },
        ],
        {
          interleaveData: true,
          alignVectors: true,
        },
      );

      // This would be processed by workers in parallel
      const chunkResults = await this.processChunkInWorkers(
        buffer,
        layout.batches[0]!, // Use the first batch layout
        k,
        metric,
        { topK: options.chunkSize || 1000, threshold: 0.5 }, // Map options to expected format
      );

      results.push(...chunkResults);

      // Release buffer
      this.releaseBuffer(buffer);
    }

    return results;
  }

  /**
   * Get memory usage statistics
   */
  getStats(): SharedMemoryStats {
    return { ...this.stats };
  }

  /**
   * Cleanup unused memory blocks
   */
  cleanup(maxAge: number = 60000): void {
    const now = Date.now();
    const initialLength = this.memoryPool.length;

    this.memoryPool = this.memoryPool.filter((block) => {
      if (block.inUse) {
        return true; // Keep in-use blocks
      }

      const age = now - block.lastUsed;
      return age <= maxAge; // Keep recent blocks
    });

    const removedCount = initialLength - this.memoryPool.length;
    if (removedCount > 0 && this.config.enableStats) {
      console.debug(`Cleaned up ${removedCount} memory blocks`);
    }

    this.updateStats();
  }

  /**
   * Force garbage collection of all unused blocks
   */
  forceCleanup(): void {
    this.memoryPool = this.memoryPool.filter((block) => block.inUse);
    this.updateStats();
  }

  // Private methods

  private findAvailableBlock(minSize: number): MemoryBlock | null {
    return this.memoryPool.find((block) => !block.inUse && block.size >= minSize) || null;
  }

  private createBlock(size: number): MemoryBlock {
    const alignedSize = this.align(size);
    const buffer = new SharedArrayBuffer(alignedSize);

    const block: MemoryBlock = {
      buffer,
      offset: 0,
      size: alignedSize,
      inUse: false,
      created: Date.now(),
      lastUsed: Date.now(),
    };

    this.memoryPool.push(block);
    return block;
  }

  private initializeHeader(buffer: SharedArrayBuffer, layout: SharedMemoryLayout): void {
    const headerView = new DataView(buffer, 0, layout.headerSize);

    // Magic number for validation
    headerView.setUint32(0, 0xdeadbeef, true);

    // Layout information
    headerView.setUint32(4, layout.vectorCount, true);
    headerView.setUint32(8, layout.dimension, true);
    headerView.setUint32(12, layout.bytesPerElement, true);
    headerView.setUint32(16, layout.bufferSize, true);
    headerView.setUint32(20, layout.headerSize, true);
    headerView.setUint32(24, layout.dataOffset, true);

    // Timestamp
    headerView.setFloat64(32, Date.now(), true);
  }

  private align(value: number): number {
    return Math.ceil(value / this.config.alignment) * this.config.alignment;
  }

  private normalizeVector(vector: Float32Array): Float32Array {
    const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    if (magnitude === 0) return vector;

    const normalized = new Float32Array(vector.length);
    for (let i = 0; i < vector.length; i++) {
      normalized[i] = vector[i]! / magnitude;
    }
    return normalized;
  }

  private quantizeVector(vector: Float32Array, bits: number): Int8Array {
    if (bits !== 8) {
      throw new Error('Only 8-bit quantization is currently supported');
    }

    // Find min and max values
    let min = Infinity;
    let max = -Infinity;

    for (const val of vector) {
      min = Math.min(min, val);
      max = Math.max(max, val);
    }

    // Calculate scale factor
    const range = Math.max(Math.abs(min), Math.abs(max));
    const scale = range > 0 ? 127 / range : 1;

    // Quantize
    const quantized = new Int8Array(vector.length);
    for (let i = 0; i < vector.length; i++) {
      quantized[i] = Math.round(Math.max(-128, Math.min(127, vector[i]! * scale)));
    }

    return quantized;
  }

  private async processChunkInWorkers(
    _buffer: SharedArrayBuffer,
    _layout: {
      vectorsOffset: number;
      queriesOffset: number;
      vectorCount: number;
      queryCount: number;
    },
    _k: number,
    _metric: DistanceMetric,
    _options: { topK?: number; threshold?: number },
  ): Promise<Array<Array<{ index: number; distance: number; score: number }>>> {
    // This would delegate to the worker pool
    // For now, return empty results as placeholder
    return [];
  }

  private updateStats(): void {
    if (!this.config.enableStats) return;

    this.stats.totalAllocated = this.memoryPool.reduce(
      (sum, block) => sum + block.size,
      0,
    );
    this.stats.totalUsed = this.memoryPool
      .filter((block) => block.inUse)
      .reduce((sum, block) => sum + block.size, 0);
    this.stats.activeBlocks = this.memoryPool.filter((block) => block.inUse).length;

    // Calculate fragmentation ratio
    const largestFreeBlock = this.memoryPool
      .filter((block) => !block.inUse)
      .reduce((max, block) => Math.max(max, block.size), 0);
    const totalFree = this.stats.totalAllocated - this.stats.totalUsed;

    this.stats.fragmentationRatio = totalFree > 0 ? largestFreeBlock / totalFree : 0;
  }
}

/**
 * Singleton instance for global shared memory management
 */
export const sharedMemoryManager = new SharedMemoryManager();
