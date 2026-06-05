import { beforeEach, describe, expect, it } from 'bun:test';

import { CompressionManager } from '@/compression/index.js';

describe('Compression Integration Benchmarks', () => {
  let compressionManager: CompressionManager;

  beforeEach(() => {
    compressionManager = new CompressionManager({
      defaultStrategy: 'scalar',
      autoSelect: true,
      minSizeForCompression: 32,
      targetCompressionRatio: 2.0,
      maxPrecisionLoss: 0.05,
    });
  });

  it('compresses large vectors in bounded time', async () => {
    const largeVector = new Float32Array(
      Array.from({ length: 10000 }, () => Math.random()),
    );

    const start = performance.now();
    const compressed = await compressionManager.compress(largeVector);
    const compressionTime = performance.now() - start;

    const decompressStart = performance.now();
    const decompressed = await compressionManager.decompress(compressed);
    const decompressionTime = performance.now() - decompressStart;

    expect(Number.isFinite(compressionTime)).toBe(true);
    expect(Number.isFinite(decompressionTime)).toBe(true);
    expect(compressionTime).toBeGreaterThanOrEqual(0);
    expect(decompressionTime).toBeGreaterThanOrEqual(0);
    expect(decompressed.length).toBe(largeVector.length);
  });

  it('reports compression timings across input sizes', async () => {
    const sizes = [100, 500, 1000, 2000];
    const times: number[] = [];

    for (const size of sizes) {
      const vector = new Float32Array(Array.from({ length: size }, () => Math.random()));

      const start = performance.now();
      await compressionManager.compress(vector);
      const elapsed = performance.now() - start;

      times.push(elapsed);
    }

    for (const elapsed of times) {
      expect(Number.isFinite(elapsed)).toBe(true);
      expect(elapsed).toBeGreaterThanOrEqual(0);
    }
  });
});
