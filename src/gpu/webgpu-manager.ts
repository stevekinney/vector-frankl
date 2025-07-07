/**
 * WebGPU compute manager for accelerated vector similarity calculations
 */

import type { DistanceMetric } from '../core/types.js';

export interface WebGPUConfig {
  /** Preferred GPU adapter type */
  powerPreference?: 'low-power' | 'high-performance';
  /** Enable debug mode with validation */
  debug?: boolean;
  /** Maximum buffer size in bytes */
  maxBufferSize?: number;
  /** Batch size for compute operations */
  batchSize?: number;
  /** Enable performance profiling */
  enableProfiling?: boolean;
}

export interface GPUComputeResult {
  /** Similarity scores */
  scores: Float32Array;
  /** Processing time in milliseconds */
  processingTime?: number;
  /** Memory usage statistics */
  memoryUsage?: {
    bufferSize: number;
    transferred: number;
  };
}

export interface GPUCapabilities {
  /** Maximum buffer size supported */
  maxBufferSize: number;
  /** Maximum compute workgroup size */
  maxWorkgroupSize: number;
  /** Available compute units */
  computeUnits?: number;
  /** Supported features */
  features: string[];
  /** Memory limits */
  limits: {
    maxStorageBufferBindingSize: number;
    maxComputeWorkgroupSizeX: number;
    maxComputeWorkgroupSizeY: number;
    maxComputeInvocationsPerWorkgroup: number;
  };
}

/**
 * Manages WebGPU device and compute operations for vector similarity calculations
 */
export class WebGPUManager {
  private adapter: GPUAdapter | null = null;
  private device: GPUDevice | null = null;
  private isInitialized = false;
  private config: Required<WebGPUConfig>;
  private shaderCache = new Map<string, GPUComputePipeline>();
  private bufferPool: GPUBuffer[] = [];
  private capabilities: GPUCapabilities | null = null;

  constructor(config: WebGPUConfig = {}) {
    this.config = {
      powerPreference: config.powerPreference || 'high-performance',
      debug: config.debug ?? false,
      maxBufferSize: config.maxBufferSize || 256 * 1024 * 1024, // 256MB
      batchSize: config.batchSize || 1024,
      enableProfiling: config.enableProfiling ?? false
    };
  }

  /**
   * Initialize WebGPU adapter and device
   */
  async init(): Promise<void> {
    if (this.isInitialized) return;

    // Check WebGPU support
    if (!navigator.gpu) {
      throw new Error('WebGPU is not supported in this browser');
    }

    try {
      // Request adapter
      this.adapter = await navigator.gpu.requestAdapter({
        powerPreference: this.config.powerPreference,
        forceFallbackAdapter: false
      });

      if (!this.adapter) {
        throw new Error('Failed to get WebGPU adapter');
      }

      // Request device
      const requiredFeatures: string[] = [];
      const optionalFeatures: string[] = ['timestamp-query', 'pipeline-statistics-query'];
      
      // Add available optional features
      for (const feature of optionalFeatures) {
        if (this.adapter.features.has(feature)) {
          requiredFeatures.push(feature);
        }
      }

      this.device = await this.adapter.requestDevice({
        requiredFeatures,
        requiredLimits: {
          maxStorageBufferBindingSize: Math.min(
            this.adapter.limits.maxStorageBufferBindingSize,
            this.config.maxBufferSize
          )
        }
      });

      // Set up error handling
      this.device.addEventListener('uncapturederror', (event) => {
        console.error('WebGPU uncaptured error:', (event as GPUUncapturedErrorEvent).error);
      });

      // Cache capabilities
      this.capabilities = {
        maxBufferSize: this.adapter.limits.maxStorageBufferBindingSize,
        maxWorkgroupSize: this.adapter.limits.maxComputeWorkgroupSizeX,
        features: Array.from(this.adapter.features),
        limits: {
          maxStorageBufferBindingSize: this.adapter.limits.maxStorageBufferBindingSize,
          maxComputeWorkgroupSizeX: this.adapter.limits.maxComputeWorkgroupSizeX,
          maxComputeWorkgroupSizeY: this.adapter.limits.maxComputeWorkgroupSizeY,
          maxComputeInvocationsPerWorkgroup: this.adapter.limits.maxComputeInvocationsPerWorkgroup
        }
      };

      this.isInitialized = true;
      console.log('WebGPU initialized successfully');
      
      if (this.config.debug) {
        console.log('GPU Capabilities:', this.capabilities);
      }

    } catch (error) {
      throw new Error(`Failed to initialize WebGPU: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get GPU capabilities
   */
  getCapabilities(): GPUCapabilities | null {
    return this.capabilities;
  }

  /**
   * Check if WebGPU is available and initialized
   */
  isAvailable(): boolean {
    return this.isInitialized && this.device !== null;
  }

  /**
   * Compute similarity scores using GPU
   */
  async computeSimilarity(
    vectors: Float32Array[],
    queryVector: Float32Array,
    metric: DistanceMetric = 'cosine'
  ): Promise<GPUComputeResult> {
    if (!this.isAvailable()) {
      throw new Error('WebGPU is not initialized or available');
    }

    const startTime = this.config.enableProfiling ? performance.now() : 0;

    try {
      // Validate inputs
      if (vectors.length === 0) {
        return { scores: new Float32Array(0) };
      }

      const dimension = queryVector.length;
      const vectorCount = vectors.length;

      // Check if vectors have consistent dimensions
      for (const vector of vectors) {
        if (vector.length !== dimension) {
          throw new Error('All vectors must have the same dimension');
        }
      }

      // Calculate optimal workgroup size
      const workgroupSize = this.calculateOptimalWorkgroupSize(vectorCount);
      
      // Create or get compute pipeline
      const pipeline = await this.getComputePipeline(metric, workgroupSize);
      
      // Prepare data and compute
      const result = await this.executeComputePass(
        pipeline,
        vectors,
        queryVector,
        metric,
        workgroupSize
      );

      // Add profiling information
      if (this.config.enableProfiling) {
        result.processingTime = performance.now() - startTime;
      }

      return result;

    } catch (error) {
      throw new Error(`GPU compute failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Batch compute similarities for multiple queries
   */
  async computeBatchSimilarity(
    vectors: Float32Array[],
    queryVectors: Float32Array[],
    metric: DistanceMetric = 'cosine'
  ): Promise<GPUComputeResult[]> {
    if (!this.isAvailable()) {
      throw new Error('WebGPU is not initialized or available');
    }

    const results: GPUComputeResult[] = [];
    
    // Process queries in batches to manage memory usage
    const batchSize = this.config.batchSize;
    
    for (let i = 0; i < queryVectors.length; i += batchSize) {
      const queryBatch = queryVectors.slice(i, i + batchSize);
      
      // Process each query in the batch
      const batchPromises = queryBatch.map(query => 
        this.computeSimilarity(vectors, query, metric)
      );
      
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Cleanup GPU resources
   */
  async cleanup(): Promise<void> {
    // Destroy cached pipelines
    this.shaderCache.clear();

    // Release buffer pool
    for (const buffer of this.bufferPool) {
      buffer.destroy();
    }
    this.bufferPool = [];

    // Destroy device
    if (this.device) {
      this.device.destroy();
      this.device = null;
    }

    this.adapter = null;
    this.isInitialized = false;
    this.capabilities = null;
  }

  // Private methods

  /**
   * Calculate optimal workgroup size based on data size and GPU capabilities
   */
  private calculateOptimalWorkgroupSize(vectorCount: number): number {
    if (!this.capabilities) {
      return 64; // Default fallback
    }

    const maxWorkgroupSize = this.capabilities.limits.maxComputeWorkgroupSizeX;
    
    // Find the largest power of 2 that fits within limits and is efficient
    let workgroupSize = 64; // Good starting point for most GPUs
    
    while (workgroupSize <= maxWorkgroupSize && workgroupSize < vectorCount) {
      workgroupSize *= 2;
    }
    
    // Ensure we don't exceed GPU limits
    return Math.min(workgroupSize / 2, maxWorkgroupSize, 256); // 256 is usually optimal
  }

  /**
   * Get or create compute pipeline for a specific metric
   */
  private async getComputePipeline(
    metric: DistanceMetric,
    workgroupSize: number
  ): Promise<GPUComputePipeline> {
    const cacheKey = `${metric}_${workgroupSize}`;
    
    if (this.shaderCache.has(cacheKey)) {
      return this.shaderCache.get(cacheKey)!;
    }

    if (!this.device) {
      throw new Error('WebGPU device not available');
    }

    const shaderCode = this.generateComputeShader(metric, workgroupSize);
    
    const shaderModule = this.device.createShaderModule({
      label: `${metric}-similarity-shader`,
      code: shaderCode
    });

    const pipeline = this.device.createComputePipeline({
      label: `${metric}-similarity-pipeline`,
      layout: 'auto',
      compute: {
        module: shaderModule,
        entryPoint: 'main'
      }
    });

    this.shaderCache.set(cacheKey, pipeline);
    return pipeline;
  }

  /**
   * Execute the actual compute pass
   */
  private async executeComputePass(
    pipeline: GPUComputePipeline,
    vectors: Float32Array[],
    queryVector: Float32Array,
    _metric: DistanceMetric,
    workgroupSize: number
  ): Promise<GPUComputeResult> {
    if (!this.device) {
      throw new Error('WebGPU device not available');
    }

    const vectorCount = vectors.length;

    // Create input buffers
    const vectorsBuffer = this.createVectorsBuffer(vectors);
    const queryBuffer = this.createQueryBuffer(queryVector);
    const resultsBuffer = this.createResultsBuffer(vectorCount);

    // Create bind group
    const bindGroup = this.device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: vectorsBuffer } },
        { binding: 1, resource: { buffer: queryBuffer } },
        { binding: 2, resource: { buffer: resultsBuffer } }
      ]
    });

    // Create command encoder and compute pass
    const commandEncoder = this.device.createCommandEncoder();
    const computePass = commandEncoder.beginComputePass();
    
    computePass.setPipeline(pipeline);
    computePass.setBindGroup(0, bindGroup);
    
    // Dispatch compute shader
    const workgroupsX = Math.ceil(vectorCount / workgroupSize);
    computePass.dispatchWorkgroups(workgroupsX);
    computePass.end();

    // Submit commands
    this.device.queue.submit([commandEncoder.finish()]);

    // Read results
    const results = await this.readBuffer(resultsBuffer, vectorCount * 4);
    const scores = new Float32Array(results);

    // Cleanup buffers
    vectorsBuffer.destroy();
    queryBuffer.destroy();
    resultsBuffer.destroy();

    return {
      scores,
      memoryUsage: {
        bufferSize: vectorsBuffer.size + queryBuffer.size + resultsBuffer.size,
        transferred: results.byteLength
      }
    };
  }

  /**
   * Create GPU buffer for vectors data
   */
  private createVectorsBuffer(vectors: Float32Array[]): GPUBuffer {
    if (!this.device) {
      throw new Error('WebGPU device not available');
    }

    const totalSize = vectors.length * vectors[0]!.length * 4; // 4 bytes per float
    const buffer = this.device.createBuffer({
      size: totalSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });

    // Copy data to buffer
    let offset = 0;
    for (const vector of vectors) {
      this.device.queue.writeBuffer(buffer, offset, vector);
      offset += vector.byteLength;
    }

    return buffer;
  }

  /**
   * Create GPU buffer for query vector
   */
  private createQueryBuffer(queryVector: Float32Array): GPUBuffer {
    if (!this.device) {
      throw new Error('WebGPU device not available');
    }

    const buffer = this.device.createBuffer({
      size: queryVector.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });

    this.device.queue.writeBuffer(buffer, 0, queryVector);
    return buffer;
  }

  /**
   * Create GPU buffer for results
   */
  private createResultsBuffer(vectorCount: number): GPUBuffer {
    if (!this.device) {
      throw new Error('WebGPU device not available');
    }

    return this.device.createBuffer({
      size: vectorCount * 4, // 4 bytes per float32
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
    });
  }

  /**
   * Read data from GPU buffer
   */
  private async readBuffer(buffer: GPUBuffer, size: number): Promise<ArrayBuffer> {
    if (!this.device) {
      throw new Error('WebGPU device not available');
    }

    const readBuffer = this.device.createBuffer({
      size,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });

    const commandEncoder = this.device.createCommandEncoder();
    commandEncoder.copyBufferToBuffer(buffer, 0, readBuffer, 0, size);
    this.device.queue.submit([commandEncoder.finish()]);

    await readBuffer.mapAsync(GPUMapMode.READ);
    const result = readBuffer.getMappedRange().slice(0);
    readBuffer.unmap();
    readBuffer.destroy();

    return result;
  }

  /**
   * Generate WGSL compute shader code for specific distance metric
   */
  private generateComputeShader(metric: DistanceMetric, workgroupSize: number): string {
    const shaderCode = `
@group(0) @binding(0) var<storage, read> vectors: array<f32>;
@group(0) @binding(1) var<storage, read> query: array<f32>;
@group(0) @binding(2) var<storage, read_write> results: array<f32>;

const WORKGROUP_SIZE: u32 = ${workgroupSize}u;
const DIMENSION: u32 = arrayLength(&query);

@compute @workgroup_size(${workgroupSize})
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let vector_idx = global_id.x;
    let vector_count = arrayLength(&results);
    
    if (vector_idx >= vector_count) {
        return;
    }
    
    let vector_offset = vector_idx * DIMENSION;
    var similarity: f32;
    
    ${this.generateDistanceCalculation(metric)}
    
    results[vector_idx] = similarity;
}`;

    return shaderCode;
  }

  /**
   * Generate distance calculation code for specific metric
   */
  private generateDistanceCalculation(metric: DistanceMetric): string {
    switch (metric) {
      case 'cosine':
        return `
    var dot_product: f32 = 0.0;
    var query_norm: f32 = 0.0;
    var vector_norm: f32 = 0.0;
    
    for (var i: u32 = 0u; i < DIMENSION; i = i + 1u) {
        let q_val = query[i];
        let v_val = vectors[vector_offset + i];
        
        dot_product = dot_product + (q_val * v_val);
        query_norm = query_norm + (q_val * q_val);
        vector_norm = vector_norm + (v_val * v_val);
    }
    
    let magnitude = sqrt(query_norm * vector_norm);
    similarity = select(0.0, dot_product / magnitude, magnitude > 0.0);`;

      case 'euclidean':
        return `
    var sum_squared: f32 = 0.0;
    
    for (var i: u32 = 0u; i < DIMENSION; i = i + 1u) {
        let diff = query[i] - vectors[vector_offset + i];
        sum_squared = sum_squared + (diff * diff);
    }
    
    similarity = 1.0 / (1.0 + sqrt(sum_squared));`;

      case 'manhattan':
        return `
    var sum_abs: f32 = 0.0;
    
    for (var i: u32 = 0u; i < DIMENSION; i = i + 1u) {
        let diff = query[i] - vectors[vector_offset + i];
        sum_abs = sum_abs + abs(diff);
    }
    
    similarity = 1.0 / (1.0 + sum_abs);`;

      case 'dot':
        return `
    var dot_product: f32 = 0.0;
    
    for (var i: u32 = 0u; i < DIMENSION; i = i + 1u) {
        dot_product = dot_product + (query[i] * vectors[vector_offset + i]);
    }
    
    similarity = dot_product;`;

      default:
        throw new Error(`Unsupported distance metric for GPU: ${metric}`);
    }
  }
}

/**
 * Singleton instance for global WebGPU management
 */
export const webGPUManager = new WebGPUManager();