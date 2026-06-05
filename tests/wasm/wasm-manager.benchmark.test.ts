import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { WASMManager } from '@/wasm/wasm-manager.js';

describe('WASMManager Benchmarks', () => {
  let wasmManager: WASMManager;

  beforeAll(async () => {
    wasmManager = new WASMManager({
      enableWASM: true,
      enableProfiling: true,
    });

    if (wasmManager.getCapabilities().supported) {
      await wasmManager.init();
    }
  });

  afterAll(async () => {
    await wasmManager.cleanup();
  });

  it('provides benchmark results', async () => {
    if (!wasmManager.isAvailable()) {
      return;
    }

    const benchmark = await wasmManager.benchmark(100, 10);

    expect(benchmark.wasm).toBeDefined();
    expect(benchmark.javascript).toBeDefined();
    expect(benchmark.speedup).toBeDefined();

    expect(Number.isFinite(benchmark.wasm.processingTime)).toBe(true);
    expect(Number.isFinite(benchmark.javascript.processingTime)).toBe(true);
    expect(Number.isFinite(benchmark.speedup)).toBe(true);
    expect(benchmark.wasm.processingTime).toBeGreaterThanOrEqual(0);
    expect(benchmark.javascript.processingTime).toBeGreaterThanOrEqual(0);
    expect(benchmark.speedup).toBeGreaterThanOrEqual(0);

    expect(Number.isFinite(benchmark.wasm.operationsPerSecond)).toBe(true);
    expect(Number.isFinite(benchmark.javascript.operationsPerSecond)).toBe(true);
    expect(benchmark.wasm.operationsPerSecond).toBeGreaterThanOrEqual(0);
    expect(benchmark.javascript.operationsPerSecond).toBeGreaterThanOrEqual(0);
  });
});
