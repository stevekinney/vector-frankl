/**
 * GPU acceleration utilities
 * Import via: vector-frankl/gpu
 */
import { GPUSearchEngine } from './gpu/gpu-search-engine.js';
import { WebGPUManager, webGPUManager } from './gpu/webgpu-manager.js';

export type { GPUSearchConfig, GPUSearchStats } from './gpu/gpu-search-engine.js';
export type {
  GPUCapabilities,
  GPUComputeResult,
  WebGPUConfig,
} from './gpu/webgpu-manager.js';
export { GPUSearchEngine, WebGPUManager, webGPUManager };
