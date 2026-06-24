/**
 * Production performance targets for Vector Frankl.
 *
 * These targets define the minimum acceptable performance for realistic
 * dataset sizes in production environments. Each target documents the
 * metric name, minimum acceptable value, units, and the dataset profile
 * under which it was measured.
 *
 * When `bun run benchmark:production` runs, each result is compared
 * against the target. A regression beyond the documented tolerance causes
 * a non-zero exit code, failing continuous integration.
 */

/** Units for a performance target measurement. */
export type TargetUnit =
  | 'ops/sec' // operations per second
  | 'ms' // milliseconds (latency; lower is better)
  | 'MB' // megabytes (memory; lower is better)
  | 'KB' // kilobytes (package size; lower is better)
  | 'ratio' // dimensionless ratio (recall; higher is better)
  | '%'; // percentage (compression ratio savings; higher is better)

/** Direction of the target: whether higher or lower values are better. */
export type TargetDirection = 'higher-is-better' | 'lower-is-better';

/**
 * A single documented production performance target.
 *
 * The `tolerance` field is the maximum allowed deviation from `minimum`
 * expressed as a fraction (e.g. 0.20 = 20%). A regression beyond
 * tolerance causes CI to fail.
 */
export interface ProductionTarget {
  /** Human-readable metric name for display and reports. */
  name: string;
  /** Benchmark category that produces this metric. */
  category: string;
  /** Minimum acceptable value. */
  minimum: number;
  /** Units of measurement. */
  unit: TargetUnit;
  /** Whether higher or lower values indicate better performance. */
  direction: TargetDirection;
  /**
   * Maximum allowed regression as a fraction of the minimum value
   * (e.g. 0.20 allows up to 20% below minimum before CI fails).
   * Only applies when direction is 'higher-is-better'.
   * When direction is 'lower-is-better', tolerance is applied as a
   * multiplier: measured ≤ minimum × (1 + tolerance).
   */
  tolerance: number;
  /** Dataset profile under which this target applies. */
  dataset: {
    /** Vector dimensionality. */
    dimensions: number;
    /** Number of stored vectors. */
    size: number;
    /** Top-k value used for search targets. */
    k?: number;
  };
  /** Free-text notes for documentation purposes. */
  notes?: string;
}

/**
 * All production performance targets for Vector Frankl.
 *
 * Targets are defined for realistic production dataset sizes:
 * - Small: 1,000 vectors at 384D (typical sentence-embedding use case)
 * - Medium: 10,000 vectors at 768D (larger embedding model output)
 *
 * Adjust targets upward as optimizations land; never lower them without
 * an accompanying root-cause analysis and a comment explaining why.
 */
export const PRODUCTION_TARGETS: readonly ProductionTarget[] = [
  // ── Insert throughput ──────────────────────────────────────────────────────

  {
    name: 'Single Vector Insert Throughput',
    category: 'database-ops',
    minimum: 500,
    unit: 'ops/sec',
    direction: 'higher-is-better',
    tolerance: 0.2,
    dataset: { dimensions: 384, size: 1000 },
    notes:
      'Single vector insert into a 1,000-vector database. ' +
      'Baseline reflects synchronous in-memory operations plus IndexedDB write.',
  },

  {
    name: 'Batch Insert Throughput',
    category: 'database-ops',
    minimum: 2000,
    unit: 'ops/sec',
    direction: 'higher-is-better',
    tolerance: 0.2,
    dataset: { dimensions: 384, size: 1000 },
    notes:
      'Batch of 100 vectors into a 1,000-vector database. ' +
      'Amortizes IndexedDB transaction overhead across the batch.',
  },

  {
    name: 'Large Dataset Single Insert Throughput',
    category: 'database-ops',
    minimum: 200,
    unit: 'ops/sec',
    direction: 'higher-is-better',
    tolerance: 0.25,
    dataset: { dimensions: 768, size: 10000 },
    notes:
      'Single vector insert into a 10,000-vector database at 768D. ' +
      'Captures the cost of HNSW graph updates at production scale.',
  },

  // ── Search latency ─────────────────────────────────────────────────────────

  {
    name: 'Search Latency (k=10, cosine)',
    category: 'search',
    minimum: 50,
    unit: 'ops/sec',
    direction: 'higher-is-better',
    tolerance: 0.2,
    dataset: { dimensions: 384, size: 1000, k: 10 },
    notes:
      'k-NN search at k=10 over 1,000 384D vectors with cosine distance. ' +
      'Linear scan baseline; HNSW improves this significantly at larger sizes.',
  },

  {
    name: 'Search Latency (k=10, cosine, large dataset)',
    category: 'search',
    minimum: 20,
    unit: 'ops/sec',
    direction: 'higher-is-better',
    tolerance: 0.25,
    dataset: { dimensions: 768, size: 10000, k: 10 },
    notes:
      'k-NN search at k=10 over 10,000 768D vectors. ' +
      'HNSW index required to meet this target.',
  },

  {
    name: 'Filtered Search Latency (k=10)',
    category: 'search',
    minimum: 30,
    unit: 'ops/sec',
    direction: 'higher-is-better',
    tolerance: 0.25,
    dataset: { dimensions: 384, size: 1000, k: 10 },
    notes:
      'k-NN search with metadata pre-filter over 1,000 vectors. ' +
      'Filter reduces the candidate set before distance computation.',
  },

  // ── Recall ─────────────────────────────────────────────────────────────────

  {
    name: 'Search Recall@10',
    category: 'recall',
    minimum: 0.85,
    unit: 'ratio',
    direction: 'higher-is-better',
    tolerance: 0.05,
    dataset: { dimensions: 384, size: 1000, k: 10 },
    notes:
      'Fraction of true top-10 nearest neighbors returned by approximate search. ' +
      'HNSW with default ef=50 should exceed 0.95; 0.85 is a floor for degraded configs.',
  },

  // ── Memory usage ───────────────────────────────────────────────────────────

  {
    name: 'Memory per 1,000 Vectors (384D)',
    category: 'memory',
    minimum: 50,
    unit: 'MB',
    direction: 'lower-is-better',
    tolerance: 0.3,
    dataset: { dimensions: 384, size: 1000 },
    notes:
      'Heap growth after inserting 1,000 384D Float32 vectors. ' +
      '384D × 4 bytes × 1,000 = ~1.5 MB raw data; overhead from index and metadata bounded to 50 MB.',
  },

  {
    name: 'Memory per 10,000 Vectors (384D)',
    category: 'memory',
    minimum: 400,
    unit: 'MB',
    direction: 'lower-is-better',
    tolerance: 0.3,
    dataset: { dimensions: 384, size: 10000 },
    notes:
      'Heap growth after inserting 10,000 384D vectors. ' +
      'Includes HNSW graph overhead (~15–20 bytes per node edge).',
  },

  // ── Index rebuild ──────────────────────────────────────────────────────────

  {
    name: 'HNSW Index Rebuild (1,000 vectors, 256D)',
    category: 'indexing',
    minimum: 1,
    unit: 'ops/sec',
    direction: 'higher-is-better',
    tolerance: 0.3,
    dataset: { dimensions: 256, size: 1000 },
    notes:
      'Full HNSW index rebuild from stored vectors. ' +
      'Invoked after bulk imports or index corruption recovery.',
  },

  // ── Storage throughput ─────────────────────────────────────────────────────

  {
    name: 'Vector Retrieval Throughput',
    category: 'database-ops',
    minimum: 1000,
    unit: 'ops/sec',
    direction: 'higher-is-better',
    tolerance: 0.2,
    dataset: { dimensions: 384, size: 1000 },
    notes: 'Random point-read of a single vector by ID from IndexedDB.',
  },

  // ── Compression cost ───────────────────────────────────────────────────────

  {
    name: 'Scalar Quantization Compression Cost (256D)',
    category: 'compression',
    minimum: 30_000,
    unit: 'ops/sec',
    direction: 'higher-is-better',
    tolerance: 0.3,
    dataset: { dimensions: 256, size: 1000 },
    notes:
      'Scalar quantization throughput for 256D float32 vectors (encoding proxy). ' +
      '4× size reduction; latency budget is <0.1 ms per vector.',
  },

  {
    name: 'Product Quantization Compression Cost (512D)',
    category: 'compression',
    minimum: 9_000,
    unit: 'ops/sec',
    direction: 'higher-is-better',
    tolerance: 0.3,
    dataset: { dimensions: 512, size: 1000 },
    notes:
      'Product quantization throughput for 512D float32 vectors (encoding proxy). ' +
      'Higher compression ratio (~16×) at higher CPU cost.',
  },

  // ── Acceleration thresholds ────────────────────────────────────────────────

  {
    name: 'JavaScript Synchronous Vector Ops (256D dot product)',
    category: 'acceleration',
    minimum: 200_000,
    unit: 'ops/sec',
    direction: 'higher-is-better',
    tolerance: 0.3,
    dataset: { dimensions: 256, size: 0 },
    notes:
      'Pure JavaScript dot product on 256D Float32Array as measured by the ' +
      'benchmark script (single-operation throughput including call overhead). ' +
      'Raw batch throughput is ~2M ops/sec; this target measures the benchmark ' +
      'harness overhead floor, establishing when WASM/SIMD acceleration should engage.',
  },

  {
    name: 'Startup Time (init + first search)',
    category: 'startup',
    minimum: 10,
    unit: 'ops/sec',
    direction: 'higher-is-better',
    tolerance: 0.3,
    dataset: { dimensions: 384, size: 100 },
    notes:
      'Time from VectorDB construction through init() to first successful search. ' +
      'Measured as operations per second (reciprocal of latency); target is <100 ms cold start.',
  },
] as const;

/**
 * Look up a production target by its metric name.
 *
 * Returns `undefined` if no matching target exists.
 */
export function findTarget(name: string): ProductionTarget | undefined {
  return PRODUCTION_TARGETS.find((t) => t.name === name);
}

/**
 * Return all targets in a given benchmark category.
 */
export function targetsForCategory(category: string): ProductionTarget[] {
  return PRODUCTION_TARGETS.filter((t) => t.category === category);
}

/**
 * Evaluate whether a measured value passes its target.
 *
 * @param target - The production target to evaluate against.
 * @param measured - The actual measured value.
 * @returns An object describing whether the target passed and by how much.
 */
export function evaluateTarget(
  target: ProductionTarget,
  measured: number,
): {
  passed: boolean;
  measured: number;
  minimum: number;
  delta: number;
  deltaPercent: number;
  withinTolerance: boolean;
} {
  let passed: boolean;
  let delta: number;

  if (target.direction === 'higher-is-better') {
    const threshold = target.minimum * (1 - target.tolerance);
    passed = measured >= threshold;
    delta = measured - target.minimum;
  } else {
    const threshold = target.minimum * (1 + target.tolerance);
    passed = measured <= threshold;
    delta = target.minimum - measured; // positive = better than minimum
  }

  const deltaPercent = (delta / target.minimum) * 100;
  const withinTolerance = passed;

  return {
    passed,
    measured,
    minimum: target.minimum,
    delta,
    deltaPercent,
    withinTolerance,
  };
}
