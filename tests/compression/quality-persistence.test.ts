/**
 * Compression quality, persistence, and corruption tests.
 *
 * Covers:
 * - Round-trip through MemoryStorageAdapter (the production-supported in-memory adapter)
 * - Search quality loss within documented tolerances after compression
 * - Predictable failure on corrupted compressed payloads
 */

import { beforeEach, describe, expect, it } from 'bun:test';
import type { CompressedVector } from '@/compression/base-compressor.js';
import { CompressionManager } from '@/compression/compression-manager.js';
import { ScalarQuantizer } from '@/compression/scalar-quantizer.js';
import { ProductQuantizer } from '@/compression/product-quantizer.js';
import type { VectorData } from '@/core/types.js';
import { MemoryStorageAdapter } from '@/storage/adapters/memory-adapter.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRandomVector(dimension: number, seed = 0): Float32Array {
  const vec = new Float32Array(dimension);
  // Deterministic PRNG so tests are reproducible
  let s = seed + 1;
  for (let i = 0; i < dimension; i++) {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    vec[i] = (s >>> 0) / 0xffffffff - 0.5;
  }
  return vec;
}

/**
 * Create a normalised vector from a cluster centre with added noise.
 * Low sigma (0.1) keeps clusters tight so even 32 centroids give near-lossless
 * compression — this models real-world embedding distributions.
 */
function makeClusteredVector(
  dimension: number,
  clusterId: number,
  seed: number,
  sigma = 0.1,
): Float32Array {
  const vec = new Float32Array(dimension);
  for (let i = 0; i < dimension; i++) {
    const base = Math.sin((clusterId * 999983 + i * 7) * 0.0001);
    let s = clusterId * 10000 + seed * 31 + i + 1;
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    vec[i] = base + ((s >>> 0) / 0xffffffff - 0.5) * sigma;
  }
  let norm = 0;
  for (let i = 0; i < dimension; i++) norm += vec[i]! * vec[i]!;
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < dimension; i++) vec[i]! /= norm;
  }
  return vec;
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Build a small trained ProductQuantizer for use in quality tests.
 * Config: 128-D, 4 subspaces, 32 centroids, 60 training vectors.
 * Training time: ~5–10ms.
 */
async function makeFastTrainedPQ(): Promise<{
  pq: ProductQuantizer;
  trainingVectors: Float32Array[];
  testVectors: Float32Array[];
}> {
  const dimension = 128;
  const clusters = 5;
  const perCluster = 14; // 5 × 14 = 70 total; split 60 train / 10 test

  const all: Float32Array[] = [];
  for (let c = 0; c < clusters; c++) {
    for (let v = 0; v < perCluster; v++) {
      all.push(makeClusteredVector(dimension, c, v));
    }
  }

  const trainingVectors = all.slice(0, 60);
  const testVectors = all.slice(60);

  const pq = new ProductQuantizer({
    subspaces: 4,
    centroidsPerSubspace: 32,
    validateQuality: false,
    maxIterations: 5,
  });

  await pq.trainCodebook(trainingVectors);
  return { pq, trainingVectors, testVectors };
}

// ---------------------------------------------------------------------------
// Round-trip through storage adapter
// ---------------------------------------------------------------------------

describe('compression round trip', () => {
  let adapter: MemoryStorageAdapter;
  let scalarManager: CompressionManager;

  beforeEach(async () => {
    adapter = new MemoryStorageAdapter();
    await adapter.init();

    scalarManager = new CompressionManager({
      defaultStrategy: 'scalar',
      autoSelect: false,
      minSizeForCompression: 64,
      maxPrecisionLoss: 0.05,
      validateQuality: false,
    });
  });

  it('scalar quantization round trip preserves vector dimension and approximate values', async () => {
    const original = makeRandomVector(128, 1);

    const compressed = await scalarManager.compress(original, 'scalar');
    const decompressed = await scalarManager.decompress(compressed);

    expect(decompressed.length).toBe(original.length);

    // Cosine similarity must stay above 0.95 (documented scalar tolerance)
    const sim = cosineSimilarity(original, decompressed);
    expect(sim).toBeGreaterThan(0.95);
  });

  it('product quantization round trip preserves vector dimension and approximate values', async () => {
    const { pq, trainingVectors } = await makeFastTrainedPQ();
    const original = trainingVectors[0]!;

    const compressed = await pq.compress(original);
    const decompressed = await pq.decompress(compressed);

    expect(decompressed.length).toBe(128);

    // On tight-cluster structured data PQ achieves ≥0.97 cosine similarity
    const sim = cosineSimilarity(original, decompressed);
    expect(sim).toBeGreaterThan(0.97);
  });

  it('compressed payload stores and retrieves cleanly through MemoryStorageAdapter', async () => {
    const original = makeRandomVector(128, 42);
    const compressed = await scalarManager.compress(original, 'scalar');

    // Store the raw compressed bytes alongside the original vector record
    const record: VectorData = {
      id: 'compressed-vec',
      vector: original,
      magnitude: Math.sqrt(Array.from(original).reduce((s, v) => s + v * v, 0)),
      timestamp: Date.now(),
      metadata: {
        compressedData: Array.from(new Uint8Array(compressed.data)),
        compressionMetadata: compressed.metadata,
        dimension: compressed.dimension,
      },
    };

    await adapter.put(record);
    const retrieved = await adapter.get('compressed-vec');

    expect(retrieved.id).toBe('compressed-vec');
    expect(retrieved.metadata).toBeDefined();

    const storedBytes = retrieved.metadata!['compressedData'] as number[];
    const storedBuffer = new Uint8Array(storedBytes).buffer;
    const restoredCompressed: CompressedVector = {
      data: storedBuffer,
      metadata: retrieved.metadata![
        'compressionMetadata'
      ] as CompressedVector['metadata'],
      dimension: retrieved.metadata!['dimension'] as number,
      config: compressed.config,
    };

    const decompressed = await scalarManager.decompress(restoredCompressed);
    expect(decompressed.length).toBe(original.length);
    const sim = cosineSimilarity(original, decompressed);
    expect(sim).toBeGreaterThan(0.95);
  });

  it('multiple vectors round-trip through the adapter independently', async () => {
    const dimension = 128;
    const count = 10;

    const originals = Array.from({ length: count }, (_, i) =>
      makeRandomVector(dimension, i * 17 + 3),
    );

    // Compress and store all vectors
    for (let i = 0; i < count; i++) {
      const original = originals[i]!;
      const compressed = await scalarManager.compress(original, 'scalar');

      await adapter.put({
        id: `vec-${i}`,
        vector: original,
        magnitude: Math.sqrt(Array.from(original).reduce((s, v) => s + v * v, 0)),
        timestamp: Date.now(),
        metadata: {
          compressedData: Array.from(new Uint8Array(compressed.data)),
          compressionMetadata: compressed.metadata,
          dimension: compressed.dimension,
        },
      });
    }

    // Retrieve and decompress all, verify each independently
    for (let i = 0; i < count; i++) {
      const retrieved = await adapter.get(`vec-${i}`);
      const storedBytes = retrieved.metadata!['compressedData'] as number[];
      const storedBuffer = new Uint8Array(storedBytes).buffer;
      const restoredCompressed: CompressedVector = {
        data: storedBuffer,
        metadata: retrieved.metadata![
          'compressionMetadata'
        ] as CompressedVector['metadata'],
        dimension: retrieved.metadata!['dimension'] as number,
        config: {},
      };

      const decompressed = await scalarManager.decompress(restoredCompressed);
      const sim = cosineSimilarity(originals[i]!, decompressed);
      expect(sim).toBeGreaterThan(0.95);
    }
  });
});

// ---------------------------------------------------------------------------
// Search quality loss within documented tolerances
// ---------------------------------------------------------------------------

describe('compression quality', () => {
  it('scalar quantization cosine similarity loss stays within 5% tolerance', async () => {
    const quantizer = new ScalarQuantizer({
      strategy: 'uniform',
      bits: 8,
      validateQuality: false,
      maxPrecisionLoss: 0.1,
    });

    const dimension = 384;
    const vectors = Array.from({ length: 20 }, (_, i) => makeRandomVector(dimension, i));

    let totalLoss = 0;

    for (const vec of vectors) {
      const compressed = await quantizer.compress(vec);
      const decompressed = await quantizer.decompress(compressed);
      const sim = cosineSimilarity(vec, decompressed);
      totalLoss += 1 - sim;
    }

    const avgLoss = totalLoss / vectors.length;

    // Documented tolerance: scalar quantization causes ≤5% cosine similarity loss on average
    expect(avgLoss).toBeLessThan(0.05);
  });

  it('product quantization cosine similarity loss stays within 2% tolerance on structured data', async () => {
    const { pq, testVectors } = await makeFastTrainedPQ();

    let totalLoss = 0;

    for (const vec of testVectors) {
      const compressed = await pq.compress(vec);
      const decompressed = await pq.decompress(compressed);
      const sim = cosineSimilarity(vec, decompressed);
      totalLoss += 1 - sim;
    }

    const avgLoss = totalLoss / testVectors.length;

    // On tight-cluster structured data with 32 centroids PQ stays within 2% loss
    expect(avgLoss).toBeLessThan(0.02);
  });

  it('scalar compression ratio is at least 2x for 8-bit quantization', async () => {
    const quantizer = new ScalarQuantizer({
      strategy: 'uniform',
      bits: 8,
      adaptiveBits: false,
      validateQuality: false,
    });

    const vec = makeRandomVector(256, 99);
    const compressed = await quantizer.compress(vec);

    // 256 float32 = 1024 bytes original; 8-bit quantization ≈ 256 bytes data
    expect(compressed.metadata.compressionRatio).toBeGreaterThanOrEqual(2.0);
  });

  it('scalar decompression preserves vector ordering for nearest-neighbor search', async () => {
    const quantizer = new ScalarQuantizer({
      strategy: 'uniform',
      bits: 8,
      validateQuality: false,
      maxPrecisionLoss: 0.1,
    });

    const dimension = 128;
    const query = makeRandomVector(dimension, 7);

    // The first candidate shares a seed with the query (maximally similar);
    // the others are from very different seeds so the gap survives quantization.
    const candidates = [
      makeRandomVector(dimension, 7),
      makeRandomVector(dimension, 5000),
      makeRandomVector(dimension, 6000),
      makeRandomVector(dimension, 7000),
    ];

    // Compress all candidates
    const decompressedCandidates: Float32Array[] = [];
    for (const candidate of candidates) {
      const compressed = await quantizer.compress(candidate);
      decompressedCandidates.push(await quantizer.decompress(compressed));
    }

    const originalScores = candidates.map((c) => cosineSimilarity(query, c));
    const decompressedScores = decompressedCandidates.map((c) =>
      cosineSimilarity(query, c),
    );

    const originalNearest = originalScores.indexOf(Math.max(...originalScores));
    const decompressedNearest = decompressedScores.indexOf(
      Math.max(...decompressedScores),
    );

    // Top-1 nearest neighbor must match after compression
    expect(decompressedNearest).toBe(originalNearest);
  });
});

// ---------------------------------------------------------------------------
// Corrupted payloads fail predictably
// ---------------------------------------------------------------------------

describe('corrupt compressed payloads', () => {
  let manager: CompressionManager;

  beforeEach(() => {
    manager = new CompressionManager({
      defaultStrategy: 'scalar',
      autoSelect: false,
      minSizeForCompression: 64,
      validateQuality: false,
    });
  });

  it('truncated payload causes an error on decompress', async () => {
    const original = makeRandomVector(128, 5);
    const compressed = await manager.compress(original, 'scalar');

    // Truncate to half — corrupts the quantized data section
    const truncated: CompressedVector = {
      ...compressed,
      data: compressed.data.slice(0, Math.floor(compressed.data.byteLength / 2)),
    };

    expect(manager.decompress(truncated)).rejects.toThrow();
  });

  it('zero-byte payload causes an error on decompress', async () => {
    const original = makeRandomVector(128, 5);
    const compressed = await manager.compress(original, 'scalar');

    const empty: CompressedVector = {
      ...compressed,
      data: new ArrayBuffer(0),
    };

    expect(manager.decompress(empty)).rejects.toThrow();
  });

  it('overwritten metadata header is handled gracefully', async () => {
    const original = makeRandomVector(128, 5);
    const compressed = await manager.compress(original, 'scalar');

    // Overwrite the first 128 bytes (metadata header) with 0xDE bytes
    const corrupted = compressed.data.slice(0);
    const view = new Uint8Array(corrupted);
    for (let i = 0; i < Math.min(128, view.length); i++) {
      view[i] = 0xde;
    }

    const corruptedCompressed: CompressedVector = {
      ...compressed,
      data: corrupted,
    };

    // Either throws or returns a Float32Array — must not hang
    try {
      const result = await manager.decompress(corruptedCompressed);
      expect(result).toBeInstanceOf(Float32Array);
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
    }
  });

  it('completely random payload is handled without hanging', async () => {
    const original = makeRandomVector(128, 5);
    const compressed = await manager.compress(original, 'scalar');

    // Fill entire buffer with pseudo-random bytes
    const random = new ArrayBuffer(compressed.data.byteLength);
    const view = new Uint8Array(random);
    let s = 0xdeadbeef;
    for (let i = 0; i < view.length; i++) {
      s = (s * 1664525 + 1013904223) & 0xffffffff;
      view[i] = s & 0xff;
    }

    const randomCompressed: CompressedVector = {
      ...compressed,
      data: random,
    };

    try {
      const result = await manager.decompress(randomCompressed);
      expect(result).toBeInstanceOf(Float32Array);
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
    }
  });

  it('scalar quantizer directly rejects a truncated payload', async () => {
    const quantizer = new ScalarQuantizer({
      strategy: 'uniform',
      bits: 8,
      validateQuality: false,
    });

    const original = makeRandomVector(128, 5);
    const compressed = await quantizer.compress(original);

    // Keep only 64 bytes — less than the 128-byte metadata header
    const truncated: CompressedVector = {
      ...compressed,
      data: compressed.data.slice(0, 64),
    };

    expect(quantizer.decompress(truncated)).rejects.toThrow();
  });
});
