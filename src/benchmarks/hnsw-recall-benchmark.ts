/**
 * HNSW recall benchmarks against brute-force search.
 *
 * These benchmarks run entirely in-memory against `HNSWIndex` (no IndexedDB
 * required) and fail loudly when recall drops below the per-fixture target.
 * Datasets are generated with a seeded PRNG so recall regressions are
 * fully reproducible across runs.
 */

import type { DistanceMetric } from '@/core/types.js';
import { HNSWIndex } from '@/search/hnsw-index.js';
import { createDistanceCalculator } from '@/search/distance-metrics.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One parametric recall benchmark fixture. */
export interface RecallFixture {
  /** Human-readable label used in output and error messages. */
  label: string;
  /** Number of vectors in the dataset. */
  datasetSize: number;
  /** Vector dimension. */
  dimension: number;
  /** Distance metric used for both HNSW and brute-force. */
  metric: DistanceMetric;
  /** Maximum connections per node (`m`). */
  m: number;
  /** Candidate list size during construction (`efConstruction`). */
  efConstruction: number;
  /** Candidate list size during search (`ef`). */
  ef: number;
  /** Number of nearest neighbours to retrieve (`k`). */
  k: number;
  /** Number of query vectors to average recall over. */
  queryCount: number;
  /** Minimum acceptable recall@k (0–1). Build fails if recall < target. */
  recallTarget: number;
}

/** Result produced by running one fixture. */
export interface RecallResult {
  fixture: RecallFixture;
  /** Measured recall@k averaged over all query vectors. */
  recall: number;
  /** Whether the measured recall met the target. */
  passed: boolean;
  /** Build time in milliseconds (index construction). */
  buildTimeMs: number;
  /** Average query time in milliseconds. */
  avgQueryTimeMs: number;
}

// ---------------------------------------------------------------------------
// Default fixture table
//
// Targets are intentionally conservative: the current HNSW implementation is
// classified experimental. These benchmarks will catch regressions — not
// enforce ANN-library-grade recall — and become stricter as the implementation
// matures.
// ---------------------------------------------------------------------------

export const DEFAULT_RECALL_FIXTURES: RecallFixture[] = [
  // Small datasets — high recall expected regardless of ef
  {
    label: 'small-cosine-m8-ef50',
    datasetSize: 200,
    dimension: 32,
    metric: 'cosine',
    m: 8,
    efConstruction: 50,
    ef: 50,
    k: 10,
    queryCount: 20,
    recallTarget: 0.8,
  },
  {
    label: 'small-euclidean-m8-ef50',
    datasetSize: 200,
    dimension: 32,
    metric: 'euclidean',
    m: 8,
    efConstruction: 50,
    ef: 50,
    k: 10,
    queryCount: 20,
    recallTarget: 0.8,
  },
  // Medium datasets with higher-dimensional vectors
  {
    label: 'medium-cosine-m16-ef100',
    datasetSize: 500,
    dimension: 64,
    metric: 'cosine',
    m: 16,
    efConstruction: 100,
    ef: 100,
    k: 10,
    queryCount: 20,
    recallTarget: 0.75,
  },
  {
    label: 'medium-euclidean-m16-ef100',
    datasetSize: 500,
    dimension: 64,
    metric: 'euclidean',
    m: 16,
    efConstruction: 100,
    ef: 100,
    k: 10,
    queryCount: 20,
    recallTarget: 0.75,
  },
  // Manhattan distance
  {
    label: 'medium-manhattan-m8-ef50',
    datasetSize: 300,
    dimension: 32,
    metric: 'manhattan',
    m: 8,
    efConstruction: 50,
    ef: 50,
    k: 10,
    queryCount: 20,
    recallTarget: 0.7,
  },
];

// ---------------------------------------------------------------------------
// Seeded PRNG (splitmix32 → xoshiro128**)
// ---------------------------------------------------------------------------

/** Returns a deterministic pseudo-random number generator seeded with `seed`. */
function makeSeededRng(seed: number): () => number {
  function splitmix32(state: number): number {
    state = (state + 0x9e3779b9) | 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return (z ^ (z >>> 16)) >>> 0;
  }

  let s0 = splitmix32(seed);
  let s1 = splitmix32(s0);
  let s2 = splitmix32(s1);
  let s3 = splitmix32(s2);

  return () => {
    const result = Math.imul(s1 * 5, 7) >>> 0;
    const t = (s1 << 9) >>> 0;
    s2 ^= s0;
    s3 ^= s1;
    s1 ^= s2;
    s0 ^= s3;
    s2 ^= t;
    s3 = ((s3 << 11) | (s3 >>> 21)) >>> 0;
    return (result >>> 0) / 0x100000000;
  };
}

// ---------------------------------------------------------------------------
// Dataset generation
// ---------------------------------------------------------------------------

/** Generate a deterministic dataset of unit-normalised Float32Arrays. */
function generateDataset(count: number, dimension: number, seed: number): Float32Array[] {
  const rng = makeSeededRng(seed);
  return Array.from({ length: count }, () => {
    const raw = new Float32Array(dimension);
    let magnitude = 0;
    for (let i = 0; i < dimension; i++) {
      raw[i] = rng() * 2 - 1;
      magnitude += raw[i]! * raw[i]!;
    }
    magnitude = Math.sqrt(magnitude);
    if (magnitude > 0) {
      for (let i = 0; i < dimension; i++) {
        raw[i] = raw[i]! / magnitude;
      }
    }
    return raw;
  });
}

// ---------------------------------------------------------------------------
// Brute-force k-NN (ground truth)
// ---------------------------------------------------------------------------

/**
 * Returns the IDs of the `k` nearest vectors in `dataset` to `query` using
 * exact brute-force distance computation.
 */
function bruteForceKNN(
  query: Float32Array,
  dataset: Array<{ id: string; vector: Float32Array }>,
  k: number,
  metric: DistanceMetric,
): Set<string> {
  const calc = createDistanceCalculator(metric);
  const distances = dataset.map(({ id, vector }) => ({
    id,
    distance: calc.calculate(query, vector),
  }));
  distances.sort((a, b) => a.distance - b.distance);
  return new Set(distances.slice(0, k).map((d) => d.id));
}

// ---------------------------------------------------------------------------
// Core benchmark runner
// ---------------------------------------------------------------------------

/**
 * Run one recall fixture and return the measured result.
 *
 * The dataset seed is derived deterministically from the fixture label so the
 * same fixture always produces the same vectors.
 */
async function runFixture(fixture: RecallFixture): Promise<RecallResult> {
  const seed = fixture.label
    .split('')
    .reduce((acc, ch) => ((acc << 5) - acc + ch.charCodeAt(0)) | 0, 0);

  // Build dataset
  const vectors = generateDataset(fixture.datasetSize, fixture.dimension, seed);
  const entries = vectors.map((vector, i) => ({ id: `v${i}`, vector }));

  // Build HNSW index
  const index = new HNSWIndex(fixture.metric, {
    m: fixture.m,
    efConstruction: fixture.efConstruction,
    seed: Math.abs(seed),
  });

  const buildStart = performance.now();
  for (const { id, vector } of entries) {
    const magnitude = Math.sqrt(Array.from(vector).reduce((s, v) => s + v * v, 0));
    await index.addVector({ id, vector, magnitude, timestamp: Date.now() });
  }
  const buildTimeMs = performance.now() - buildStart;

  // Generate query vectors (different seed offset)
  const queries = generateDataset(fixture.queryCount, fixture.dimension, seed + 1);

  // Measure recall@k
  let totalRecall = 0;
  let totalQueryTime = 0;

  for (const query of queries) {
    const groundTruth = bruteForceKNN(query, entries, fixture.k, fixture.metric);

    const qStart = performance.now();
    const hnswResults = await index.search(query, fixture.k, fixture.ef);
    totalQueryTime += performance.now() - qStart;

    const retrieved = new Set(hnswResults.map((r) => r.id));
    let hits = 0;
    for (const id of retrieved) {
      if (groundTruth.has(id)) hits++;
    }
    totalRecall += hits / fixture.k;
  }

  const recall = totalRecall / fixture.queryCount;
  const avgQueryTimeMs = totalQueryTime / fixture.queryCount;

  return {
    fixture,
    recall,
    passed: recall >= fixture.recallTarget,
    buildTimeMs,
    avgQueryTimeMs,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run all HNSW recall benchmarks.
 *
 * Prints per-fixture results to stdout. Throws `RecallBenchmarkFailureError`
 * if any fixture fails to meet its recall target so the process exits non-zero
 * and breaks the build.
 *
 * @param fixtures - Array of fixtures to run. Defaults to
 *   `DEFAULT_RECALL_FIXTURES`.
 * @param verbose - If true, print per-fixture progress lines.
 */
export async function runHNSWRecallBenchmarks(
  fixtures: RecallFixture[] = DEFAULT_RECALL_FIXTURES,
  verbose = true,
): Promise<RecallResult[]> {
  if (verbose) {
    console.log('🎯 HNSW Recall Benchmarks (vs brute-force ground truth)');
    console.log('─'.repeat(60));
  }

  const results: RecallResult[] = [];

  for (const fixture of fixtures) {
    const result = await runFixture(fixture);
    results.push(result);

    if (verbose) {
      const status = result.passed ? '✅' : '❌';
      const recallPct = (result.recall * 100).toFixed(1);
      const targetPct = (fixture.recallTarget * 100).toFixed(1);
      console.log(
        `${status} ${fixture.label.padEnd(35)} recall=${recallPct}% (target≥${targetPct}%)` +
          `  build=${result.buildTimeMs.toFixed(0)}ms  query=${result.avgQueryTimeMs.toFixed(2)}ms`,
      );
    }
  }

  const failures = results.filter((r) => !r.passed);
  if (failures.length > 0) {
    const lines = failures.map(
      (r) =>
        `  • ${r.fixture.label}: recall=${(r.recall * 100).toFixed(1)}% < target=${(r.fixture.recallTarget * 100).toFixed(1)}%`,
    );
    throw new RecallBenchmarkFailureError(
      `${failures.length} HNSW recall benchmark(s) failed:\n${lines.join('\n')}`,
      failures,
    );
  }

  return results;
}

/**
 * Thrown when one or more recall fixtures fall below their target.
 * Carrying the full result list lets callers inspect which fixtures failed.
 */
export class RecallBenchmarkFailureError extends Error {
  readonly failures: RecallResult[];

  constructor(message: string, failures: RecallResult[]) {
    super(message);
    this.name = 'RecallBenchmarkFailureError';
    this.failures = failures;
  }
}
