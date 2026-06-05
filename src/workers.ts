/**
 * Web Worker pool utilities
 * Import via: vector-frankl/workers
 */
import { getSharedMemoryManager, SharedMemoryManager } from './workers/shared-memory.js';
import { WorkerPool } from './workers/worker-pool.js';

export type {
  MemoryBlock,
  SharedMemoryConfig,
  SharedMemoryLayout,
  SharedMemoryStats,
} from './workers/shared-memory.js';
export type { PoolConfig, WorkerResponse, WorkerTask } from './workers/worker-pool.js';
export { getSharedMemoryManager, SharedMemoryManager, WorkerPool };
