/**
 * Test to verify GPU modules compile without type errors
 */

import { describe, it, expect } from 'bun:test';
import { GPUSearchEngine } from '../../src/gpu/gpu-search-engine.js';
import { WebGPUManager } from '../../src/gpu/webgpu-manager.js';
import type { VectorData } from '../../src/core/types.js';

describe('GPU Module Type Checking', () => {
  it('should instantiate GPUSearchEngine without type errors', () => {
    const engine = new GPUSearchEngine({
      gpuThreshold: 1000,
      enableFallback: true,
      batchSize: 1024,
      enableProfiling: false,
      webGPUConfig: {
        powerPreference: 'high-performance',
        debug: false,
        maxBufferSize: 256 * 1024 * 1024
      }
    });
    
    expect(engine).toBeDefined();
  });

  it('should instantiate WebGPUManager without type errors', () => {
    const manager = new WebGPUManager({
      powerPreference: 'high-performance',
      debug: false,
      maxBufferSize: 256 * 1024 * 1024,
      batchSize: 1024,
      enableProfiling: false
    });
    
    expect(manager).toBeDefined();
  });

  it('should handle distance metrics including dot product', async () => {
    const engine = new GPUSearchEngine();
    
    // Create test data
    const vectors: VectorData[] = [
      {
        id: '1',
        vector: new Float32Array([1, 2, 3]),
        magnitude: Math.sqrt(14),
        timestamp: Date.now()
      }
    ];
    
    const queryVector = new Float32Array([4, 5, 6]);
    
    // Test that all metrics are accepted without type errors
    const metrics = ['cosine', 'euclidean', 'manhattan', 'dot', 'hamming', 'jaccard'] as const;
    
    for (const metric of metrics) {
      // This should compile without errors
      const promise = engine.search(vectors, queryVector, 1, metric);
      expect(promise).toBeDefined();
    }
  });
});