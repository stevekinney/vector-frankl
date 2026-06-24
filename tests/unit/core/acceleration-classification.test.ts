/**
 * Tests for acceleration path classification.
 *
 * These tests are the verification gate required by ROADMAP.md §Acceleration:
 * every claim about an acceleration path must map to implemented, observable behavior.
 *
 * Run with: bun test tests/unit/core/acceleration-classification.test.ts
 * Or filtered: bun test tests/ -t acceleration
 */

import { beforeAll, describe, expect, it } from 'bun:test';

import {
  ACCELERATION_CLASSIFICATIONS,
  getByStatus,
  getClassification,
} from '@/acceleration-classification.js';
import { SIMDOperations } from '@/simd/simd-operations.js';
import { WASMManager } from '@/wasm/wasm-manager.js';
import { WASMOperations } from '@/wasm/wasm-operations.js';
import { GPUSearchEngine } from '@/gpu/gpu-search-engine.js';
import { WorkerPool } from '@/workers/worker-pool.js';

// ──────────────────────────────────────────────────────────────────────────────
// Acceleration classification table
// ──────────────────────────────────────────────────────────────────────────────

describe('acceleration classification table', () => {
  it('classifies all five acceleration paths', () => {
    const names = ACCELERATION_CLASSIFICATIONS.map((c) => c.name);
    expect(names).toContain('SIMD');
    expect(names).toContain('WebAssembly');
    expect(names).toContain('WebGPU');
    expect(names).toContain('Workers');
    expect(names).toContain('SharedMemory');
    expect(ACCELERATION_CLASSIFICATIONS).toHaveLength(5);
  });

  it('assigns status production or experimental to each path', () => {
    for (const classification of ACCELERATION_CLASSIFICATIONS) {
      expect(['production', 'experimental']).toContain(classification.status);
      expect(classification.rationale.length).toBeGreaterThan(0);
    }
  });

  it('classifies SIMD as production', () => {
    const simd = getClassification('SIMD');
    expect(simd).toBeDefined();
    expect(simd!.status).toBe('production');
  });

  it('classifies WebAssembly as experimental', () => {
    const wasm = getClassification('WebAssembly');
    expect(wasm).toBeDefined();
    expect(wasm!.status).toBe('experimental');
  });

  it('classifies WebGPU as experimental', () => {
    const webgpu = getClassification('WebGPU');
    expect(webgpu).toBeDefined();
    expect(webgpu!.status).toBe('experimental');
  });

  it('classifies Workers as production', () => {
    const workers = getClassification('Workers');
    expect(workers).toBeDefined();
    expect(workers!.status).toBe('production');
  });

  it('classifies SharedMemory as experimental', () => {
    const sharedMemory = getClassification('SharedMemory');
    expect(sharedMemory).toBeDefined();
    expect(sharedMemory!.status).toBe('experimental');
  });

  it('has exactly 2 production paths (SIMD, Workers)', () => {
    const production = getByStatus('production');
    const names = production.map((c) => c.name).sort();
    expect(names).toEqual(['SIMD', 'Workers']);
  });

  it('has exactly 3 experimental paths (WebAssembly, WebGPU, SharedMemory)', () => {
    const experimental = getByStatus('experimental');
    const names = experimental.map((c) => c.name).sort();
    expect(names).toEqual(['SharedMemory', 'WebAssembly', 'WebGPU']);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// SIMD — Production-supported: must be usable and produce correct results
// ──────────────────────────────────────────────────────────────────────────────

describe('acceleration: SIMD (production)', () => {
  let simd: SIMDOperations;

  beforeAll(() => {
    simd = new SIMDOperations({ enableSIMD: true });
  });

  it('reports as supported on every modern JS runtime', () => {
    const capabilities = simd.getCapabilities();
    expect(capabilities.supported).toBe(true);
  });

  it('computes a correct dot product', () => {
    const a = new Float32Array([1, 2, 3, 4]);
    const b = new Float32Array([4, 3, 2, 1]);
    // 1×4 + 2×3 + 3×2 + 4×1 = 4 + 6 + 6 + 4 = 20
    expect(simd.dotProduct(a, b)).toBeCloseTo(20, 5);
  });

  it('computes a correct Euclidean distance', () => {
    const a = new Float32Array([0, 0]);
    const b = new Float32Array([3, 4]);
    // sqrt(9 + 16) = 5
    expect(simd.euclideanDistance(a, b)).toBeCloseTo(5, 5);
  });

  it('normalizes a vector to unit length', () => {
    const v = new Float32Array([3, 4]); // magnitude = 5
    const normalized = simd.normalize(v);
    const mag = Math.sqrt(normalized[0]! ** 2 + normalized[1]! ** 2);
    expect(mag).toBeCloseTo(1, 5);
  });

  it('falls back gracefully when enableSIMD is false', () => {
    const scalarOps = new SIMDOperations({ enableSIMD: false });
    const a = new Float32Array([1, 2, 3]);
    const b = new Float32Array([4, 5, 6]);
    // 1×4 + 2×5 + 3×6 = 4 + 10 + 18 = 32
    expect(scalarOps.dotProduct(a, b)).toBeCloseTo(32, 5);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// WebAssembly — Experimental: platform API detected but no module bundled
// ──────────────────────────────────────────────────────────────────────────────

describe('acceleration: WebAssembly (experimental)', () => {
  let manager: WASMManager;

  beforeAll(() => {
    manager = new WASMManager({ enableWASM: true });
  });

  it('detects WebAssembly platform support', () => {
    const capabilities = manager.getCapabilities();
    // WebAssembly is available in Bun and modern browsers
    expect(typeof capabilities.supported).toBe('boolean');
    // Basic feature check is consistent with platform
    if (capabilities.supported) {
      expect(capabilities.features).toContain('basic');
    }
  });

  it('isAvailable() returns false without a compiled module', async () => {
    await manager.init();
    // No modulePath supplied, so the WASM backend is never loaded
    expect(manager.isAvailable()).toBe(false);
  });

  it('rejects operation calls when no real backend is loaded', async () => {
    const a = new Float32Array([1, 2, 3]);
    const b = new Float32Array([4, 5, 6]);
    let threw = false;
    try {
      await manager.dotProduct(a, b);
    } catch (err) {
      threw = true;
      expect((err as Error).message).toContain('WebAssembly not available');
    }
    expect(threw).toBe(true);
  });

  it('enableWASM:false skips initialization entirely', async () => {
    const disabled = new WASMManager({ enableWASM: false });
    await disabled.init();
    expect(disabled.isAvailable()).toBe(false);
  });
});

describe('acceleration: WASMOperations (experimental)', () => {
  it('constructs without throwing', () => {
    const ops = new WASMOperations({ enableWASM: true, enableSIMDFallback: true });
    expect(ops).toBeDefined();
  });

  it('exposes getCapabilities() describing all three layers', () => {
    const ops = new WASMOperations();
    const caps = ops.getCapabilities();
    expect(typeof caps.wasmAvailable).toBe('boolean');
    expect(typeof caps.simdAvailable).toBe('boolean');
    expect(caps.scalarAvailable).toBe(true);
  });

  it('WASMOperations.init() is the correct initialization method (not initialize())', async () => {
    const ops = new WASMOperations();
    // init() is the real method; initialize() must not exist
    expect(typeof ops.init).toBe('function');
    expect(typeof (ops as unknown as Record<string, unknown>)['initialize']).not.toBe(
      'function',
    );
    await ops.init(); // must not throw
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// WebGPU — Experimental: full WGSL implementation, browser-only
// ──────────────────────────────────────────────────────────────────────────────

describe('acceleration: WebGPU (experimental)', () => {
  it('constructs with GPUSearchConfig (not a WebGPU device directly)', () => {
    const engine = new GPUSearchEngine({
      gpuThreshold: 500,
      enableFallback: true,
      batchSize: 128,
    });
    expect(engine).toBeDefined();
  });

  it('isGPUReady() returns false when navigator.gpu is absent', () => {
    const engine = new GPUSearchEngine({ enableFallback: true });
    // In Bun/Node there is no navigator.gpu
    if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
      expect(engine.isGPUReady()).toBe(false);
    }
    // If running in a browser with WebGPU, it may be ready — that is also valid
  });

  it('init() resolves without throwing when WebGPU is absent', async () => {
    const engine = new GPUSearchEngine({ enableFallback: true });
    // init() must not reject — it swallows the "no WebGPU" error and sets isGPUReady() = false
    await engine.init();
    // After init with no WebGPU available, GPU is not ready
    if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
      expect(engine.isGPUReady()).toBe(false);
    }
  });

  it('falls back to CPU search when GPU is unavailable', async () => {
    const engine = new GPUSearchEngine({ enableFallback: true });

    const vectors = Array.from({ length: 3 }, (_, i) => ({
      id: `v${i}`,
      vector: new Float32Array([i, i + 1, i + 2, i + 3]),
      magnitude: 1,
      timestamp: 0,
    }));
    const query = new Float32Array([0, 1, 2, 3]);

    // Should succeed via fallback even without real GPU
    const results = await engine.search(vectors, query, 2, 'cosine');
    expect(results).toBeDefined();
    expect(results.results).toBeInstanceOf(Array);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Workers — Production-supported (browser only)
// ──────────────────────────────────────────────────────────────────────────────

describe('acceleration: Workers (production, browser only)', () => {
  it('constructs a WorkerPool without throwing', () => {
    const pool = new WorkerPool({ maxWorkers: 2 });
    expect(pool).toBeDefined();
  });

  it('reports zero active tasks before initialization', () => {
    const pool = new WorkerPool();
    const stats = pool.getStats();
    expect(stats.totalWorkers).toBe(0);
    expect(stats.activeTasks).toBe(0);
  });

  it('throws a clear error when Worker API is absent', async () => {
    const originalWorker = (globalThis as Record<string, unknown>)['Worker'];
    // @ts-expect-error -- simulating absent Worker API for this assertion
    globalThis['Worker'] = undefined;

    const pool = new WorkerPool({ maxWorkers: 2 });
    let threw = false;
    try {
      await pool.init();
    } catch (err) {
      threw = true;
      expect((err as Error).message).toContain('Web Workers are not supported');
    }
    expect(threw).toBe(true);

    (globalThis as Record<string, unknown>)['Worker'] = originalWorker;
  });

  it('init() is idempotent when called twice', async () => {
    // Use a pool that will fail (no Worker in Bun) — calling twice should be consistent
    const pool = new WorkerPool({ maxWorkers: 1 });

    if (typeof Worker === 'undefined') {
      // Both attempts should reject, not produce inconsistent state
      let threw = false;
      try {
        await pool.init();
      } catch (err) {
        threw = true;
        expect(err).toBeInstanceOf(Error);
      }
      expect(threw).toBe(true);
    } else {
      // In a browser environment: second call is a no-op
      await pool.init();
      await pool.init(); // should not throw
      await pool.terminate();
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Shared Memory — Experimental: requires cross-origin isolation
// ──────────────────────────────────────────────────────────────────────────────

describe('acceleration: SharedMemory (experimental)', () => {
  it('WorkerPool.sharedMemoryEnabled is false by default', () => {
    const pool = new WorkerPool();
    const stats = pool.getStats();
    expect(stats.sharedMemoryEnabled).toBe(false);
  });

  it('SharedArrayBuffer availability is a runtime condition, not a build-time constant', () => {
    // We simply assert the classification is documented; SharedArrayBuffer requires COOP/COEP headers
    const classification = getClassification('SharedMemory');
    expect(classification!.status).toBe('experimental');
    expect(classification!.rationale).toMatch(/SharedArrayBuffer/);
  });

  it('WorkerPool.sharedMemorySearch() throws when SharedArrayBuffer is absent', async () => {
    if (typeof SharedArrayBuffer !== 'undefined') {
      // If SAB is available, this test does not apply — skip gracefully
      return;
    }

    const pool = new WorkerPool();
    const vectors = [new Float32Array([1, 0]), new Float32Array([0, 1])];
    const query = new Float32Array([1, 0]);

    let threw = false;
    try {
      await pool.sharedMemorySearch(vectors, query, 1);
    } catch (err) {
      threw = true;
      expect((err as Error).message).toContain('SharedArrayBuffer is not available');
    }
    expect(threw).toBe(true);
  });
});
