/**
 * Shared benchmark bodies for Vector Frankl.
 *
 * This module is the single source of truth for *how* each production metric is
 * measured: the dataset seeding, warmup/iteration counts, and the operation
 * under test. Both the baseline-capture script (`scripts/benchmark-production.ts`)
 * and the CI gate (`scripts/verify-benchmarks.ts`) import {@link runBenchmark}
 * so the numbers they produce are guaranteed comparable. Policy (what passes,
 * what is advisory, how results are reported) lives in the scripts; the
 * benchmark *behaviour* lives here and must not be duplicated.
 *
 * Previously each script encoded its own copy of every benchmark body, and the
 * copies drifted — e.g. "Large Dataset Single Insert" seeded 500 vectors in the
 * capture script but 200 in the gate — so the gate measured a different
 * operation than the one its baseline was captured from. Centralising the
 * bodies here makes that class of drift structurally impossible.
 */

import { VectorDB } from '../api/database.js';
import { MemoryStorageAdapter } from '../storage/adapters/memory-adapter.js';

/** Dataset profile a benchmark runs against. */
export type BenchmarkDataset = {
  /** Vector dimensionality. */
  dimensions: number;
  /** Number of stored vectors the metric is defined against. */
  size: number;
  /** Top-k value used for search benchmarks. */
  k?: number;
};

/**
 * Generate a random vector of the given dimension with components in [-1, 1).
 */
export function generateRandomVector(dimension: number): number[] {
  return Array.from({ length: dimension }, () => Math.random() * 2 - 1);
}

/**
 * Time `fn` over `iterations` calls and return ops/sec derived from the
 * *median* per-call duration.
 *
 * The mean of a handful of samples is dominated by a single outlier — one GC
 * pause or a CI scheduler hiccup in any iteration can halve the reported
 * throughput. The median of the per-iteration durations ignores a lone slow
 * sample, so the measurement is stable across noisy shared runners while still
 * moving for a genuine, sustained regression. (Whole-run slowdown — every
 * sample uniformly slower because the runner is overcommitted — is *not*
 * something the median can correct for; that is why throughput metrics are
 * treated as advisory rather than hard-gated. See `scripts/verify-benchmarks.ts`.)
 */
export async function measureOpsPerSec(
  fn: () => Promise<void> | void,
  warmup = 2,
  iterations = 5,
): Promise<number> {
  for (let i = 0; i < warmup; i++) {
    await fn();
  }

  const durations: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await fn();
    durations.push(performance.now() - start);
  }

  durations.sort((a, b) => a - b);
  const mid = Math.floor(durations.length / 2);
  const median =
    durations.length % 2 === 0
      ? ((durations[mid - 1] ?? 0) + (durations[mid] ?? 0)) / 2
      : (durations[mid] ?? 0);

  return median > 0 ? 1000 / median : 0;
}

/** Monotonic suffix for startup-benchmark database names (validator-safe). */
let startupRunCounter = 0;

/**
 * Run the benchmark for a named production metric against `dataset` and return
 * the measured value in that metric's unit (ops/sec, MB, or ratio).
 *
 * The `name` must match a production target / baseline entry name. Unknown
 * names throw — callers that prefer to skip unknown metrics should catch.
 *
 * @param name - The metric name (must match production-targets / baselines).
 * @param dataset - The dataset profile to measure against.
 * @returns The measured value in the metric's unit.
 */
export async function runBenchmark(
  name: string,
  dataset: BenchmarkDataset,
): Promise<number> {
  const { dimensions, size, k = 10 } = dataset;

  switch (name) {
    case 'Single Vector Insert Throughput': {
      const db = new VectorDB(`bench-insert-single-${Date.now()}`, dimensions, {
        storage: new MemoryStorageAdapter(),
      });
      await db.init();
      const seed = Array.from({ length: Math.min(size, 200) }, (_, i) => ({
        id: `init-${i}`,
        vector: generateRandomVector(dimensions),
      }));
      await db.addBatch(seed);
      const ops = await measureOpsPerSec(async () => {
        await db.addVector(
          `v-${Date.now()}-${Math.random()}`,
          generateRandomVector(dimensions),
        );
      });
      await db.delete();
      return ops;
    }

    case 'Batch Insert Throughput': {
      const db = new VectorDB(`bench-insert-batch-${Date.now()}`, dimensions, {
        storage: new MemoryStorageAdapter(),
      });
      await db.init();
      const ops = await measureOpsPerSec(async () => {
        const batchItems = Array.from({ length: 100 }, (_, i) => ({
          id: `b-${Date.now()}-${i}`,
          vector: generateRandomVector(dimensions),
        }));
        await db.addBatch(batchItems);
      });
      await db.delete();
      return ops;
    }

    case 'Large Dataset Single Insert Throughput': {
      const db = new VectorDB(`bench-large-insert-${Date.now()}`, dimensions, {
        storage: new MemoryStorageAdapter(),
      });
      await db.init();
      const seed = Array.from({ length: Math.min(size, 500) }, (_, i) => ({
        id: `init-${i}`,
        vector: generateRandomVector(dimensions),
      }));
      await db.addBatch(seed);
      // Single un-batched inserts are the noisiest measurement, so use a wider
      // median window to stay stable under shared-runner load.
      const ops = await measureOpsPerSec(
        async () => {
          await db.addVector(
            `v-${Date.now()}-${Math.random()}`,
            generateRandomVector(dimensions),
          );
        },
        2,
        9,
      );
      await db.delete();
      return ops;
    }

    case 'Search Latency (k=10, cosine)':
    case 'Search Latency (k=10, cosine, large dataset)': {
      const db = new VectorDB(`bench-search-${Date.now()}`, dimensions, {
        distanceMetric: 'cosine',
        storage: new MemoryStorageAdapter(),
      });
      await db.init();
      const populate = Array.from({ length: Math.min(size, 1000) }, (_, i) => ({
        id: `s-${i}`,
        vector: generateRandomVector(dimensions),
      }));
      await db.addBatch(populate);
      const ops = await measureOpsPerSec(
        async () => {
          await db.search(generateRandomVector(dimensions), k);
        },
        2,
        5,
      );
      await db.delete();
      return ops;
    }

    case 'Filtered Search Latency (k=10)': {
      const db = new VectorDB(`bench-filter-search-${Date.now()}`, dimensions, {
        distanceMetric: 'cosine',
        storage: new MemoryStorageAdapter(),
      });
      await db.init();
      const populate = Array.from({ length: Math.min(size, 500) }, (_, i) => ({
        id: `fs-${i}`,
        vector: generateRandomVector(dimensions),
        metadata: { category: i % 5 },
      }));
      await db.addBatch(populate);
      const ops = await measureOpsPerSec(async () => {
        await db.search(generateRandomVector(dimensions), k, {
          filter: { category: { $in: [1, 2, 3] } },
        });
      });
      await db.delete();
      return ops;
    }

    case 'Search Recall@10': {
      // Build a database, identify the true k-NN for a query by brute force,
      // then measure what the actual search returns. This metric is
      // deterministic given the math and is hard-gated.
      const db = new VectorDB(`bench-recall-${Date.now()}`, dimensions, {
        distanceMetric: 'cosine',
        storage: new MemoryStorageAdapter(),
      });
      await db.init();
      const vectors = Array.from({ length: Math.min(size, 500) }, (_, i) => ({
        id: `r-${i}`,
        vector: generateRandomVector(dimensions),
      }));
      await db.addBatch(vectors);

      const trials = 20;
      let totalRecall = 0;

      for (let trial = 0; trial < trials; trial++) {
        const query = generateRandomVector(dimensions);
        const results = await db.search(query, k);
        const returnedIds = new Set(results.map((r) => r.id));

        // Brute-force cosine similarity to find the true top-k.
        const scores = vectors.map((v) => {
          const dot = v.vector.reduce((sum, val, i) => sum + val * (query[i] ?? 0), 0);
          const magA = Math.sqrt(v.vector.reduce((sum, val) => sum + val * val, 0));
          const magB = Math.sqrt(query.reduce((sum, val) => sum + val * val, 0));
          return { id: v.id, score: magA > 0 && magB > 0 ? dot / (magA * magB) : 0 };
        });
        scores.sort((a, b) => b.score - a.score);
        const trueTopK = new Set(scores.slice(0, k).map((s) => s.id));

        let hits = 0;
        for (const id of trueTopK) {
          if (returnedIds.has(id)) hits++;
        }
        totalRecall += hits / k;
      }

      await db.delete();
      return totalRecall / trials;
    }

    case 'Memory per 1,000 Vectors (384D)':
    case 'Memory per 10,000 Vectors (384D)': {
      if (typeof process === 'undefined' || !process.memoryUsage) return 0;
      const db = new VectorDB(`bench-memory-${Date.now()}`, dimensions, {
        storage: new MemoryStorageAdapter(),
      });
      await db.init();
      if (typeof globalThis.gc === 'function') globalThis.gc();
      const before = process.memoryUsage();
      const populate = Array.from({ length: Math.min(size, 1000) }, (_, i) => ({
        id: `m-${i}`,
        vector: generateRandomVector(dimensions),
      }));
      await db.addBatch(populate);
      if (typeof globalThis.gc === 'function') globalThis.gc();
      const after = process.memoryUsage();
      await db.delete();
      // Return MB of heap growth.
      return Math.max(0, (after.heapUsed - before.heapUsed) / (1024 * 1024));
    }

    case 'HNSW Index Rebuild (1,000 vectors, 256D)': {
      const db = new VectorDB(`bench-rebuild-${Date.now()}`, dimensions, {
        useIndex: true,
        storage: new MemoryStorageAdapter(),
      });
      await db.init();
      const populate = Array.from({ length: Math.min(size, 500) }, (_, i) => ({
        id: `idx-${i}`,
        vector: generateRandomVector(dimensions),
      }));
      await db.addBatch(populate);
      const ops = await measureOpsPerSec(
        async () => {
          await db.rebuildIndex();
        },
        1,
        3,
      );
      await db.delete();
      return ops;
    }

    case 'Vector Retrieval Throughput': {
      const db = new VectorDB(`bench-get-${Date.now()}`, dimensions, {
        storage: new MemoryStorageAdapter(),
      });
      await db.init();
      const populate = Array.from({ length: Math.min(size, 500) }, (_, i) => ({
        id: `get-${i}`,
        vector: generateRandomVector(dimensions),
      }));
      await db.addBatch(populate);
      const count = populate.length;
      const ops = await measureOpsPerSec(async () => {
        const id = `get-${Math.floor(Math.random() * count)}`;
        await db.getVector(id);
      });
      await db.delete();
      return ops;
    }

    case 'Scalar Quantization Compression Cost (256D)':
    case 'Product Quantization Compression Cost (512D)': {
      // Compression benchmarks measure encoding throughput on random vectors
      // via a compute proxy (Float32Array work) proportional to the
      // quantization cost — product quantization is ~5× more expensive.
      const isProduct = name.startsWith('Product');
      const iterationWork = isProduct ? 20 : 4;
      const ops = await measureOpsPerSec(() => {
        const vec = new Float32Array(dimensions).map(() => Math.random() * 2 - 1);
        let sum = 0;
        for (let pass = 0; pass < iterationWork; pass++) {
          for (let i = 0; i < dimensions; i++) {
            sum += (vec[i] ?? 0) * (vec[i] ?? 0);
          }
        }
        // Prevent dead-code elimination.
        if (sum < 0) throw new Error('impossible');
      });
      return ops;
    }

    case 'JavaScript Synchronous Vector Ops (256D dot product)': {
      const a = new Float32Array(dimensions).map(() => Math.random() * 2 - 1);
      const b = new Float32Array(dimensions).map(() => Math.random() * 2 - 1);
      const ops = await measureOpsPerSec(
        () => {
          let dot = 0;
          for (let i = 0; i < dimensions; i++) {
            dot += (a[i] ?? 0) * (b[i] ?? 0);
          }
          if (dot < -1e18) throw new Error('impossible');
        },
        5,
        10,
      );
      return ops;
    }

    case 'Startup Time (init + first search)': {
      const ops = await measureOpsPerSec(
        async () => {
          // Math.random() would inject a "." into the name (e.g. "0.42"),
          // which the database name validator rejects. Use a monotonic counter
          // for a collision-free, validator-safe unique suffix across the rapid
          // init/search/delete iterations of this startup loop.
          const db = new VectorDB(
            `bench-startup-${Date.now()}-${startupRunCounter++}`,
            dimensions,
            { storage: new MemoryStorageAdapter() },
          );
          await db.init();
          const init = Array.from({ length: Math.min(size, 20) }, (_, i) => ({
            id: `st-${i}`,
            vector: generateRandomVector(dimensions),
          }));
          await db.addBatch(init);
          await db.search(generateRandomVector(dimensions), 5);
          await db.delete();
        },
        1,
        3,
      );
      return ops;
    }

    default:
      throw new Error(`No benchmark implementation for metric: "${name}"`);
  }
}
