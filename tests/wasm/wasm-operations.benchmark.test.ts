import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { WASMOperations } from '@/wasm/wasm-operations.js';

describe('WASMOperations Benchmarks', () => {
  let wasmOps: WASMOperations;

  beforeAll(async () => {
    wasmOps = new WASMOperations({
      enableWASM: true,
      wasmThreshold: 32,
      enableSIMDFallback: true,
      enableProfiling: true,
    });

    await wasmOps.init();
  });

  afterAll(async () => {
    await wasmOps.cleanup();
  });

  it('provides comprehensive performance benchmarks', async () => {
    const benchmark = await wasmOps.benchmarkAll(100, 50);

    expect(benchmark.simd).toBeDefined();
    expect(benchmark.scalar).toBeDefined();
    expect(benchmark.speedup).toBeDefined();

    expect(Number.isFinite(benchmark.simd.time)).toBe(true);
    expect(Number.isFinite(benchmark.scalar.time)).toBe(true);
    expect(Number.isFinite(benchmark.speedup.simdVsScalar)).toBe(true);
    expect(benchmark.simd.time).toBeGreaterThanOrEqual(0);
    expect(benchmark.scalar.time).toBeGreaterThanOrEqual(0);
    expect(benchmark.speedup.simdVsScalar).toBeGreaterThanOrEqual(0);

    if (benchmark.wasm) {
      expect(Number.isFinite(benchmark.wasm.time)).toBe(true);
      expect(Number.isFinite(benchmark.speedup.wasmVsScalar)).toBe(true);
      expect(benchmark.wasm.time).toBeGreaterThanOrEqual(0);
      expect(benchmark.speedup.wasmVsScalar).toBeGreaterThanOrEqual(0);
      expect(benchmark.speedup.wasmVsSIMD).toBeDefined();
    }
  });

  it('reports speedup values for multiple vector sizes', async () => {
    const smallBenchmark = await wasmOps.benchmarkAll(50, 10);
    const largeBenchmark = await wasmOps.benchmarkAll(500, 10);

    expect(Number.isFinite(smallBenchmark.speedup.simdVsScalar)).toBe(true);
    expect(Number.isFinite(largeBenchmark.speedup.simdVsScalar)).toBe(true);
    expect(smallBenchmark.speedup.simdVsScalar).toBeGreaterThanOrEqual(0);
    expect(largeBenchmark.speedup.simdVsScalar).toBeGreaterThanOrEqual(0);
  });
});
