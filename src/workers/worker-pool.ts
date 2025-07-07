/**
 * Web Worker pool management for parallel vector operations
 */

import type { DistanceMetric, VectorData } from '../core/types.js';
import { SharedMemoryManager } from './shared-memory.js';

export interface WorkerTask {
  taskId: string;
  operation: string;
  data: unknown;
  transferables?: Transferable[];
}

export interface WorkerResponse {
  taskId: string;
  result?: unknown;
  error?: string;
}

export interface PoolConfig {
  maxWorkers?: number;
  workerScript?: string;
  timeout?: number;
  retries?: number;
  sharedMemoryConfig?: {
    maxPoolSize?: number;
    enableOptimizations?: boolean;
    chunkSize?: number;
  };
}

/**
 * Manages a pool of Web Workers for parallel vector operations
 */
export class WorkerPool {
  private workers: Worker[] = [];
  private busyWorkers = new Set<Worker>();
  private taskQueue: Array<{ task: WorkerTask; resolve: (value: any) => void; reject: (reason?: any) => void }> = [];
  private activeTasks = new Map<string, { resolve: (value: any) => void; reject: (reason?: any) => void; timeout?: ReturnType<typeof setTimeout> }>();
  private maxWorkers: number;
  private workerScript: string;
  private defaultTimeout: number;
  // @ts-expect-error - retries field may be used in future retry logic
  private _retries: number;
  private isInitialized = false;
  private sharedMemoryManager: SharedMemoryManager | null = null;
  private enableSharedMemoryOptimizations = false;

  constructor(config: PoolConfig = {}) {
    this.maxWorkers = config.maxWorkers || navigator.hardwareConcurrency || 4;
    this.workerScript = config.workerScript || '/src/workers/vector-worker.js';
    this.defaultTimeout = config.timeout || 30000; // 30 seconds
    this._retries = config.retries || 2;
    
    // Initialize shared memory manager if enabled
    if (config.sharedMemoryConfig?.enableOptimizations && typeof SharedArrayBuffer !== 'undefined') {
      this.sharedMemoryManager = new SharedMemoryManager(config.sharedMemoryConfig);
      this.enableSharedMemoryOptimizations = true;
    }
  }

  /**
   * Initialize the worker pool
   */
  async init(): Promise<void> {
    if (this.isInitialized) return;

    // Check if Web Workers are supported
    if (typeof Worker === 'undefined') {
      throw new Error('Web Workers are not supported in this environment');
    }

    // Create workers
    for (let i = 0; i < this.maxWorkers; i++) {
      try {
        const worker = this.createWorker(i);
        this.workers.push(worker);
      } catch (error) {
        console.warn(`Failed to create worker ${i}:`, error);
      }
    }

    if (this.workers.length === 0) {
      throw new Error('Failed to create any workers');
    }

    this.isInitialized = true;
    console.log(`Worker pool initialized with ${this.workers.length} workers`);
  }

  /**
   * Create a single worker
   */
  private createWorker(id: number): Worker {
    const worker = new Worker(this.workerScript, { 
      type: 'module',
      name: `vector-worker-${id}`
    });

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      this.handleWorkerMessage(worker, event.data);
    };

    worker.onerror = (error) => {
      console.error(`Worker ${id} error:`, error);
      this.handleWorkerError(worker, error);
    };

    return worker;
  }

  /**
   * Handle worker message responses
   */
  private handleWorkerMessage(worker: Worker, response: WorkerResponse): void {
    const { taskId, result, error } = response;
    const task = this.activeTasks.get(taskId);

    if (!task) {
      console.warn(`Received response for unknown task: ${taskId}`);
      return;
    }

    // Clear timeout
    if (task.timeout) {
      clearTimeout(task.timeout);
    }

    // Remove from active tasks
    this.activeTasks.delete(taskId);
    this.busyWorkers.delete(worker);

    // Resolve or reject the task
    if (error) {
      task.reject(new Error(error));
    } else {
      task.resolve(result);
    }

    // Process next task in queue
    this.processQueue();
  }

  /**
   * Handle worker errors
   */
  private handleWorkerError(worker: Worker, error: ErrorEvent): void {
    console.error('Worker error:', error);

    // Find and reject all tasks assigned to this worker
    for (const [taskId, task] of this.activeTasks.entries()) {
      if (this.busyWorkers.has(worker)) {
        task.reject(new Error(`Worker error: ${error.message}`));
        this.activeTasks.delete(taskId);
      }
    }

    this.busyWorkers.delete(worker);

    // Try to recreate the worker
    try {
      worker.terminate();
      const newWorker = this.createWorker(this.workers.indexOf(worker));
      this.workers[this.workers.indexOf(worker)] = newWorker;
    } catch (recreateError) {
      console.error('Failed to recreate worker:', recreateError);
    }
  }

  /**
   * Execute a task on an available worker
   */
  async execute<T = unknown>(
    operation: string, 
    data: unknown, 
    transferables: Transferable[] = [],
    timeout?: number
  ): Promise<T> {
    if (!this.isInitialized) {
      await this.init();
    }

    const taskId = crypto.randomUUID();
    const task: WorkerTask = { taskId, operation, data, transferables };

    return new Promise<T>((resolve, reject) => {
      const taskInfo = { task, resolve: resolve as any, reject: reject as any };
      
      const availableWorker = this.getAvailableWorker();
      
      if (availableWorker) {
        this.sendToWorker(availableWorker, taskInfo, timeout);
      } else {
        this.taskQueue.push(taskInfo);
      }
    });
  }

  /**
   * Get an available worker
   */
  private getAvailableWorker(): Worker | null {
    return this.workers.find(worker => !this.busyWorkers.has(worker)) || null;
  }

  /**
   * Send task to worker
   */
  private sendToWorker(
    worker: Worker, 
    taskInfo: { task: WorkerTask; resolve: (value: any) => void; reject: (reason?: any) => void },
    customTimeout?: number
  ): void {
    const { task, resolve, reject } = taskInfo;
    
    this.busyWorkers.add(worker);
    
    // Set up timeout
    const timeoutMs = customTimeout || this.defaultTimeout;
    const timeout = setTimeout(() => {
      this.activeTasks.delete(task.taskId);
      this.busyWorkers.delete(worker);
      reject(new Error(`Task timeout after ${timeoutMs}ms`));
      this.processQueue();
    }, timeoutMs);
    
    this.activeTasks.set(task.taskId, { resolve, reject, timeout });
    
    // Send task to worker
    worker.postMessage(task, task.transferables || []);
  }

  /**
   * Process the task queue
   */
  private processQueue(): void {
    if (this.taskQueue.length === 0) return;
    
    const availableWorker = this.getAvailableWorker();
    if (availableWorker) {
      const taskInfo = this.taskQueue.shift()!;
      this.sendToWorker(availableWorker, taskInfo);
    }
  }

  /**
   * Perform parallel similarity search
   */
  async parallelSimilaritySearch(
    vectors: VectorData[],
    queryVector: Float32Array,
    k: number,
    metric: DistanceMetric = 'cosine',
    filter?: (metadata: Record<string, unknown>) => boolean
  ): Promise<Array<{ id: string; distance: number; score: number; metadata?: Record<string, unknown> }>> {
    if (vectors.length === 0) return [];

    // Determine chunk size based on vector count and worker count
    const chunkSize = Math.ceil(vectors.length / this.workers.length);
    const chunks = this.chunkArray(vectors, chunkSize);

    // Execute search on each chunk in parallel
    const promises = chunks.map(chunk => 
      this.execute('similarity_search', {
        vectors: chunk,
        queryVector,
        k: Math.ceil(k * 1.5), // Get more results per chunk to ensure quality
        metric,
        filter
      })
    );

    const results = await Promise.all(promises);
    
    // Merge and sort results from all chunks
    const allResults = results.flat() as Array<{ id: string; distance: number; score: number; metadata?: Record<string, unknown> }>;
    allResults.sort((a, b) => b.score - a.score);
    
    return allResults.slice(0, k);
  }

  /**
   * Perform batch similarity calculations
   */
  async batchSimilarity(
    vectors: VectorData[],
    queries: Float32Array[],
    metric: DistanceMetric = 'cosine'
  ): Promise<number[][]> {
    if (queries.length === 0 || vectors.length === 0) return [];

    // Distribute queries across workers
    const chunkSize = Math.ceil(queries.length / this.workers.length);
    const queryChunks = this.chunkArray(queries, chunkSize);

    const promises = queryChunks.map(queryChunk =>
      this.execute('batch_similarity', {
        vectors,
        queries: queryChunk,
        metric
      })
    );

    const results = await Promise.all(promises);
    return results.flat() as number[][];
  }

  /**
   * Normalize vectors in parallel
   */
  async normalizeVectors(vectors: Float32Array[]): Promise<Float32Array[]> {
    if (vectors.length === 0) return [];

    const chunkSize = Math.ceil(vectors.length / this.workers.length);
    const chunks = this.chunkArray(vectors, chunkSize);

    const promises = chunks.map(chunk =>
      this.execute('vector_normalize', { vectors: chunk })
    );

    const results = await Promise.all(promises);
    return results.flat() as Float32Array[];
  }

  /**
   * Perform vector quantization in parallel
   */
  async quantizeVectors(
    vectors: Float32Array[],
    bits: number = 8
  ): Promise<{ quantized: Int8Array[]; scales: number[] }> {
    if (vectors.length === 0) return { quantized: [], scales: [] };

    const chunkSize = Math.ceil(vectors.length / this.workers.length);
    const chunks = this.chunkArray(vectors, chunkSize);

    const promises = chunks.map(chunk =>
      this.execute('vector_quantization', { vectors: chunk, bits })
    );

    const results = await Promise.all(promises);
    
    // Merge results
    const quantized: Int8Array[] = [];
    const scales: number[] = [];
    
    for (const result of results) {
      const typedResult = result as { quantized: Int8Array[]; scales: number[] };
      quantized.push(...typedResult.quantized);
      scales.push(...typedResult.scales);
    }
    
    return { quantized, scales };
  }

  /**
   * Use SharedArrayBuffer for zero-copy operations when available
   */
  async sharedMemorySearch(
    vectors: Float32Array[],
    queryVector: Float32Array,
    k: number,
    metric: DistanceMetric = 'cosine'
  ): Promise<Array<{ index: number; distance: number; score: number }>> {
    if (typeof SharedArrayBuffer === 'undefined') {
      throw new Error('SharedArrayBuffer is not available');
    }

    // Use enhanced shared memory manager if available
    if (this.enableSharedMemoryOptimizations && this.sharedMemoryManager) {
      return this.optimizedSharedMemorySearch(vectors, queryVector, k, metric);
    }

    // Fallback to basic implementation
    return this.basicSharedMemorySearch(vectors, queryVector, k, metric);
  }

  /**
   * Optimized shared memory search using memory manager
   */
  private async optimizedSharedMemorySearch(
    vectors: Float32Array[],
    queryVector: Float32Array,
    k: number,
    metric: DistanceMetric
  ): Promise<Array<{ index: number; distance: number; score: number }>> {
    if (!this.sharedMemoryManager) {
      throw new Error('Shared memory manager not initialized');
    }

    const dimension = queryVector.length;
    const { buffer, layout } = this.sharedMemoryManager.allocateVectorBuffer(
      vectors.length + 1, // +1 for query vector
      dimension
    );

    try {
      // Copy vectors to shared memory with optimizations
      this.sharedMemoryManager.copyVectorsToSharedMemory(
        vectors,
        buffer,
        { ...layout, vectorCount: vectors.length },
        {
          normalize: metric === 'cosine',
          quantize: vectors.length > 10000 // Quantize for very large datasets
        }
      );

      // Copy query vector to the end
      const queryOffset = layout.dataOffset + vectors.length * dimension * 4;
      const queryView = new Float32Array(buffer, queryOffset, dimension);
      queryView.set(queryVector);

      // Create optimal work distribution
      const chunkSize = Math.ceil(vectors.length / this.workers.length);
      const promises = this.workers.map((_, i) => {
        const startIdx = i * chunkSize;
        const endIdx = Math.min((i + 1) * chunkSize, vectors.length);
        
        if (startIdx >= endIdx) return Promise.resolve([]);
        
        return this.execute('shared_similarity_search', {
          sharedBuffer: buffer,
          vectorCount: vectors.length,
          dimension,
          queryOffset: queryOffset,
          k: Math.ceil(k * 1.5),
          metric,
          startIdx,
          endIdx,
          layout: layout
        });
      });

      const results = await Promise.all(promises);
      const allResults = results.flat() as Array<{ index: number; distance: number; score: number }>;
      allResults.sort((a, b) => b.score - a.score);
      
      return allResults.slice(0, k);

    } finally {
      // Release shared memory back to pool
      this.sharedMemoryManager.releaseBuffer(buffer);
    }
  }

  /**
   * Basic shared memory search implementation
   */
  private async basicSharedMemorySearch(
    vectors: Float32Array[],
    queryVector: Float32Array,
    k: number,
    metric: DistanceMetric
  ): Promise<Array<{ index: number; distance: number; score: number }>> {
    const dimension = queryVector.length;
    const bufferSize = vectors.length * dimension * 4; // 4 bytes per float
    const sharedBuffer = new SharedArrayBuffer(bufferSize);
    const sharedArray = new Float32Array(sharedBuffer);

    // Copy vectors to shared memory
    let offset = 0;
    for (const vector of vectors) {
      sharedArray.set(vector, offset);
      offset += dimension;
    }

    // Distribute work across workers
    const chunkSize = Math.ceil(vectors.length / this.workers.length);
    const promises = this.workers.map((_, i) => {
      const startIdx = i * chunkSize;
      const endIdx = Math.min((i + 1) * chunkSize, vectors.length);
      
      if (startIdx >= endIdx) return Promise.resolve([]);
      
      return this.execute('shared_similarity_search', {
        sharedBuffer,
        vectorCount: vectors.length,
        dimension,
        queryVector,
        k: Math.ceil(k * 1.5),
        metric,
        startIdx,
        endIdx
      });
    });

    const results = await Promise.all(promises);
    const allResults = results.flat() as Array<{ index: number; distance: number; score: number }>;
    allResults.sort((a, b) => b.score - a.score);
    
    return allResults.slice(0, k);
  }

  /**
   * Get worker pool statistics
   */
  getStats(): {
    totalWorkers: number;
    busyWorkers: number;
    queueLength: number;
    activeTasks: number;
    sharedMemoryEnabled: boolean;
    sharedMemoryStats?: {
      totalAllocated: number;
      totalUsed: number;
      activeBlocks: number;
      fragmentationRatio: number;
    };
  } {
    const stats = {
      totalWorkers: this.workers.length,
      busyWorkers: this.busyWorkers.size,
      queueLength: this.taskQueue.length,
      activeTasks: this.activeTasks.size,
      sharedMemoryEnabled: this.enableSharedMemoryOptimizations
    };

    if (this.sharedMemoryManager) {
      const memStats = this.sharedMemoryManager.getStats();
      return {
        ...stats,
        sharedMemoryStats: {
          totalAllocated: memStats.totalAllocated,
          totalUsed: memStats.totalUsed,
          activeBlocks: memStats.activeBlocks,
          fragmentationRatio: memStats.fragmentationRatio
        }
      };
    }

    return stats;
  }

  /**
   * Terminate all workers and clean up
   */
  async terminate(): Promise<void> {
    // Clear all timeouts
    for (const task of this.activeTasks.values()) {
      if (task.timeout) {
        clearTimeout(task.timeout);
      }
    }

    // Reject all pending tasks
    for (const task of this.activeTasks.values()) {
      task.reject(new Error('Worker pool terminated'));
    }

    for (const taskInfo of this.taskQueue) {
      taskInfo.reject(new Error('Worker pool terminated'));
    }

    // Terminate all workers
    for (const worker of this.workers) {
      worker.terminate();
    }

    // Clear state
    this.workers = [];
    this.busyWorkers.clear();
    this.taskQueue = [];
    this.activeTasks.clear();
    this.isInitialized = false;

    // Cleanup shared memory
    if (this.sharedMemoryManager) {
      this.sharedMemoryManager.forceCleanup();
    }
  }

  /**
   * Enable or disable shared memory optimizations
   */
  setSharedMemoryOptimizations(enabled: boolean, config?: {
    maxPoolSize?: number;
    enableOptimizations?: boolean;
    chunkSize?: number;
  }): void {
    if (enabled && typeof SharedArrayBuffer !== 'undefined') {
      if (!this.sharedMemoryManager) {
        this.sharedMemoryManager = new SharedMemoryManager(config);
      }
      this.enableSharedMemoryOptimizations = true;
    } else {
      this.enableSharedMemoryOptimizations = false;
      if (this.sharedMemoryManager) {
        this.sharedMemoryManager.forceCleanup();
      }
    }
  }

  /**
   * Cleanup shared memory periodically
   */
  cleanupSharedMemory(maxAge?: number): void {
    if (this.sharedMemoryManager) {
      this.sharedMemoryManager.cleanup(maxAge);
    }
  }

  /**
   * Utility method to chunk arrays
   */
  private chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }
}