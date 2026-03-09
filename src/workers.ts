/**
 * Web Worker pool utilities
 * Import via: vector-frankl/workers
 */
export {
  WorkerPool,
  type WorkerTask,
  type WorkerResponse,
  type PoolConfig,
} from './workers/worker-pool.js';
export {
  SharedMemoryManager,
  getSharedMemoryManager,
  type SharedMemoryConfig,
  type MemoryBlock,
  type SharedMemoryLayout,
  type SharedMemoryStats,
} from './workers/shared-memory.js';
