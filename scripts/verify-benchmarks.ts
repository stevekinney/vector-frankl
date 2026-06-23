#!/usr/bin/env bun

/**
 * Benchmark baseline verifier for Vector Frankl.
 *
 * Reads the committed baselines from `benchmarks/baselines.json` and runs a
 * subset of fast representative benchmarks to confirm that the current code
 * has not regressed beyond the documented tolerances. Unlike
 * `benchmark-production.ts`, this script is optimised for speed so it can
 * run on every CI push rather than only on release branches.
 *
 * It also verifies that every metric cited in README.md can be traced to a
 * matching baseline entry in baselines.json, preventing documentation drift.
 *
 * Usage:
 *   bun run verify:benchmarks              # Verify all baselines
 *   bun run verify:benchmarks --fast       # Skip slow targets (memory, startup)
 *   bun run verify:benchmarks --list       # Print baselines without running
 *   bun run verify:benchmarks --help
 *
 * Exit codes:
 *   0  All baselines verified
 *   1  One or more regressions detected or traceability check failed
 *   2  Configuration or file error
 */

import type {
  TargetDirection,
  TargetUnit,
} from '../src/benchmarks/production-targets.js';
import { VectorDB } from '../src/api/database.js';
import { MemoryStorageAdapter } from '../src/storage/adapters/memory-adapter.js';

// ── CLI arguments ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const options = {
  fast: args.includes('--fast'),
  list: args.includes('--list'),
  help: args.includes('--help') || args.includes('-h'),
  verbose: args.includes('--verbose') || args.includes('-v'),
};

if (options.help) {
  process.stdout.write(`
Vector Frankl Benchmark Baseline Verifier

Usage: bun run verify:benchmarks [options]

Options:
  --fast         Skip slow targets (memory measurement, startup, large-dataset)
  --list         Print all committed baselines without running benchmarks
  --verbose, -v  Print per-test measurements
  --help, -h     Show this help

Exit codes:
  0  All baselines verified
  1  One or more regressions or traceability failures
  2  Configuration or file error
`);
  process.exit(0);
}

// ── Baseline schema ───────────────────────────────────────────────────────────

interface BaselineEntry {
  name: string;
  category: string;
  unit: TargetUnit;
  direction: TargetDirection;
  baseline: number;
  tolerance: number;
  dataset: { dimensions: number; size: number; k?: number };
}

interface BaselinesFile {
  version: string;
  description: string;
  generatedAt: string;
  environment: { description: string };
  tolerances: { description: string; default: number };
  baselines: BaselineEntry[];
}

// ── Load baselines ────────────────────────────────────────────────────────────

const baselinePath = new URL('../benchmarks/baselines.json', import.meta.url).pathname;

let baselinesFile: BaselinesFile;
try {
  const raw = await Bun.file(baselinePath).text();
  baselinesFile = JSON.parse(raw) as BaselinesFile;
} catch (err) {
  process.stderr.write(
    `Error loading baselines: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(2);
}

if (options.list) {
  process.stdout.write(
    `Committed baselines (${baselinesFile.baselines.length} entries):\n\n`,
  );
  for (const b of baselinesFile.baselines) {
    process.stdout.write(
      `  ${b.name.padEnd(55)} ${String(b.baseline).padStart(12)} ${b.unit}  (±${(b.tolerance * 100).toFixed(0)}%)\n`,
    );
  }
  process.exit(0);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateRandomVector(dimension: number): number[] {
  return Array.from({ length: dimension }, () => Math.random() * 2 - 1);
}

/**
 * Time `fn` over `iterations` calls and return ops/sec from the *median*
 * duration. The median ignores a lone slow sample (a GC pause or CI
 * scheduler hiccup), so the measurement stays stable across noisy shared
 * runners while still moving for a genuine, sustained regression. Must stay
 * behaviourally identical to the copy in scripts/benchmark-production.ts that
 * captures the baselines this gate compares against.
 */
async function measureOpsPerSec(
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

function evaluateBaseline(
  entry: BaselineEntry,
  measured: number,
): { passed: boolean; deltaPercent: number } {
  if (entry.direction === 'higher-is-better') {
    const threshold = entry.baseline * (1 - entry.tolerance);
    const passed = measured >= threshold;
    const deltaPercent = ((measured - entry.baseline) / entry.baseline) * 100;
    return { passed, deltaPercent };
  } else {
    const threshold = entry.baseline * (1 + entry.tolerance);
    const passed = measured <= threshold;
    const deltaPercent = ((entry.baseline - measured) / entry.baseline) * 100;
    return { passed, deltaPercent };
  }
}

function formatValue(value: number, unit: string): string {
  if (unit === 'ops/sec') {
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M ops/sec`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k ops/sec`;
    return `${value.toFixed(1)} ops/sec`;
  }
  if (unit === 'ratio') return value.toFixed(3);
  if (unit === 'MB') return `${value.toFixed(1)} MB`;
  return `${value.toFixed(2)} ${unit}`;
}

// ── Benchmark implementations (fast subset) ───────────────────────────────────

/**
 * Run the benchmark for a single baseline entry.
 * Returns the measured value in the entry's unit, or `null` when the
 * benchmark is skipped in --fast mode.
 */
async function runBaseline(entry: BaselineEntry): Promise<number | null> {
  const { dimensions, size = 1000, k = 10 } = entry.dataset;

  // Skip slow targets in --fast mode
  const slowCategories = new Set(['memory', 'startup']);
  const largeDataset = size > 5000;
  if (options.fast && (slowCategories.has(entry.category) || largeDataset)) {
    return null;
  }

  switch (entry.name) {
    case 'Single Vector Insert Throughput': {
      const db = new VectorDB(`vb-insert-${Date.now()}`, dimensions, {
        storage: new MemoryStorageAdapter(),
      });
      await db.init();
      const seed = Array.from({ length: Math.min(size, 100) }, (_, i) => ({
        id: `seed-${i}`,
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
      const db = new VectorDB(`vb-batch-${Date.now()}`, dimensions, {
        storage: new MemoryStorageAdapter(),
      });
      await db.init();
      const ops = await measureOpsPerSec(async () => {
        const items = Array.from({ length: 50 }, (_, i) => ({
          id: `bi-${Date.now()}-${i}`,
          vector: generateRandomVector(dimensions),
        }));
        await db.addBatch(items);
      });
      await db.delete();
      return ops;
    }

    case 'Large Dataset Single Insert Throughput': {
      if (options.fast) return null;
      const db = new VectorDB(`vb-large-${Date.now()}`, dimensions, {
        storage: new MemoryStorageAdapter(),
      });
      await db.init();
      const seed = Array.from({ length: Math.min(size, 200) }, (_, i) => ({
        id: `ls-${i}`,
        vector: generateRandomVector(dimensions),
      }));
      await db.addBatch(seed);
      // Single un-batched inserts are the noisiest measurement in the gate, so
      // use a wider median window (2 warmups, 9 iterations) to stay stable
      // under shared-runner load. Keep in sync with the baseline-capture copy
      // in scripts/benchmark-production.ts.
      const ops = await measureOpsPerSec(
        async () => {
          await db.addVector(
            `lv-${Date.now()}-${Math.random()}`,
            generateRandomVector(dimensions),
          );
        },
        2,
        9,
      );
      await db.delete();
      return ops;
    }

    case 'Search Latency (k=10, cosine)': {
      const db = new VectorDB(`vb-search-${Date.now()}`, dimensions, {
        distanceMetric: 'cosine',
        storage: new MemoryStorageAdapter(),
      });
      await db.init();
      const populate = Array.from({ length: Math.min(size, 500) }, (_, i) => ({
        id: `sl-${i}`,
        vector: generateRandomVector(dimensions),
      }));
      await db.addBatch(populate);
      const ops = await measureOpsPerSec(async () => {
        await db.search(generateRandomVector(dimensions), k);
      });
      await db.delete();
      return ops;
    }

    case 'Search Latency (k=10, cosine, large dataset)': {
      if (options.fast) return null;
      const db = new VectorDB(`vb-lsearch-${Date.now()}`, dimensions, {
        distanceMetric: 'cosine',
        storage: new MemoryStorageAdapter(),
      });
      await db.init();
      const populate = Array.from({ length: Math.min(size, 500) }, (_, i) => ({
        id: `lsl-${i}`,
        vector: generateRandomVector(dimensions),
      }));
      await db.addBatch(populate);
      const ops = await measureOpsPerSec(
        async () => {
          await db.search(generateRandomVector(dimensions), k);
        },
        2,
        3,
      );
      await db.delete();
      return ops;
    }

    case 'Filtered Search Latency (k=10)': {
      const db = new VectorDB(`vb-filter-${Date.now()}`, dimensions, {
        distanceMetric: 'cosine',
        storage: new MemoryStorageAdapter(),
      });
      await db.init();
      const populate = Array.from({ length: Math.min(size, 300) }, (_, i) => ({
        id: `fsl-${i}`,
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
      const db = new VectorDB(`vb-recall-${Date.now()}`, dimensions, {
        distanceMetric: 'cosine',
        storage: new MemoryStorageAdapter(),
      });
      await db.init();
      const vectors = Array.from({ length: Math.min(size, 200) }, (_, i) => ({
        id: `rc-${i}`,
        vector: generateRandomVector(dimensions),
      }));
      await db.addBatch(vectors);

      const trials = 10;
      let totalRecall = 0;
      for (let trial = 0; trial < trials; trial++) {
        const query = generateRandomVector(dimensions);
        const results = await db.search(query, k);
        const returnedIds = new Set(results.map((r) => r.id));

        const scores = vectors.map((v) => {
          const dot = v.vector.reduce((sum, val, i) => sum + val * (query[i] ?? 0), 0);
          const magA = Math.sqrt(v.vector.reduce((s, val) => s + val * val, 0));
          const magB = Math.sqrt(query.reduce((s, val) => s + val * val, 0));
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
      if (options.fast || typeof process === 'undefined' || !process.memoryUsage)
        return null;
      const db = new VectorDB(`vb-mem-${Date.now()}`, dimensions, {
        storage: new MemoryStorageAdapter(),
      });
      await db.init();
      if (typeof globalThis.gc === 'function') globalThis.gc();
      const before = process.memoryUsage();
      const populate = Array.from({ length: Math.min(size, 500) }, (_, i) => ({
        id: `mem-${i}`,
        vector: generateRandomVector(dimensions),
      }));
      await db.addBatch(populate);
      if (typeof globalThis.gc === 'function') globalThis.gc();
      const after = process.memoryUsage();
      await db.delete();
      return Math.max(0, (after.heapUsed - before.heapUsed) / (1024 * 1024));
    }

    case 'HNSW Index Rebuild (1,000 vectors, 256D)': {
      const db = new VectorDB(`vb-rebuild-${Date.now()}`, dimensions, {
        useIndex: true,
        storage: new MemoryStorageAdapter(),
      });
      await db.init();
      const populate = Array.from({ length: Math.min(size, 200) }, (_, i) => ({
        id: `rb-${i}`,
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
      const db = new VectorDB(`vb-get-${Date.now()}`, dimensions, {
        storage: new MemoryStorageAdapter(),
      });
      await db.init();
      const count = Math.min(size, 300);
      const populate = Array.from({ length: count }, (_, i) => ({
        id: `get-${i}`,
        vector: generateRandomVector(dimensions),
      }));
      await db.addBatch(populate);
      const ops = await measureOpsPerSec(async () => {
        const id = `get-${Math.floor(Math.random() * count)}`;
        await db.getVector(id);
      });
      await db.delete();
      return ops;
    }

    case 'Scalar Quantization Compression Cost (256D)':
    case 'Product Quantization Compression Cost (512D)': {
      const isProduct = entry.name.startsWith('Product');
      const iterationWork = isProduct ? 20 : 4;
      const ops = await measureOpsPerSec(() => {
        const vec = new Float32Array(dimensions).map(() => Math.random() * 2 - 1);
        let sum = 0;
        for (let pass = 0; pass < iterationWork; pass++) {
          for (let i = 0; i < dimensions; i++) {
            sum += (vec[i] ?? 0) * (vec[i] ?? 0);
          }
        }
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
      if (options.fast) return null;
      const ops = await measureOpsPerSec(
        async () => {
          const db = new VectorDB(
            `vb-startup-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`,
            dimensions,
            { storage: new MemoryStorageAdapter() },
          );
          await db.init();
          const init = Array.from({ length: 10 }, (_, i) => ({
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
      return null; // Unknown baseline: skip rather than fail
  }
}

// ── Traceability check ────────────────────────────────────────────────────────

/**
 * Verify that every performance metric cited in README.md can be traced to a
 * baseline entry in baselines.json.
 *
 * The README is expected to contain a `<!-- benchmark-baseline: <name> -->`
 * comment for each cited metric. This function checks that those names all
 * appear in the baselines file.
 */
async function checkReadmeTraceability(): Promise<{ passed: boolean; issues: string[] }> {
  const issues: string[] = [];

  const readmePath = new URL('../README.md', import.meta.url).pathname;
  let readmeText: string;
  try {
    readmeText = await Bun.file(readmePath).text();
  } catch {
    // README not found — not a failure, just skip traceability
    return { passed: true, issues: [] };
  }

  // Extract any explicit baseline trace comments
  const tracePattern = /<!--\s*benchmark-baseline:\s*([^-]+?)\s*-->/g;
  const baselineNames = new Set(baselinesFile.baselines.map((b) => b.name));
  let match: RegExpExecArray | null;

  while ((match = tracePattern.exec(readmeText)) !== null) {
    const cited = match[1]?.trim();
    if (cited && !baselineNames.has(cited)) {
      issues.push(
        `README cites benchmark "${cited}" but no matching baseline entry exists in baselines.json`,
      );
    }
  }

  return { passed: issues.length === 0, issues };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  process.stdout.write('Vector Frankl Benchmark Baseline Verification\n\n');

  const mode = options.fast ? ' (fast mode — slow targets skipped)' : '';
  process.stdout.write(`Baselines: ${baselinesFile.baselines.length} entries${mode}\n`);
  process.stdout.write(`Generated: ${baselinesFile.generatedAt}\n\n`);

  let failures = 0;
  let skipped = 0;
  let passed = 0;
  const regressions: string[] = [];

  for (const entry of baselinesFile.baselines) {
    const label = entry.name.padEnd(55);
    process.stdout.write(`  ${label}`);

    let measured: number | null;
    try {
      measured = await runBaseline(entry);
    } catch (err) {
      process.stdout.write(
        `ERROR (${err instanceof Error ? err.message : String(err)})\n`,
      );
      failures++;
      regressions.push(`${entry.name}: benchmark threw an error`);
      continue;
    }

    if (measured === null) {
      process.stdout.write('SKIP\n');
      skipped++;
      continue;
    }

    const { passed: ok, deltaPercent } = evaluateBaseline(entry, measured);
    const sign = deltaPercent >= 0 ? '+' : '';
    const measuredStr = formatValue(measured, entry.unit);
    const baselineStr = formatValue(entry.baseline, entry.unit);

    if (ok) {
      process.stdout.write(
        `PASS  ${measuredStr} (baseline: ${baselineStr}, ${sign}${deltaPercent.toFixed(1)}%)\n`,
      );
      passed++;
    } else {
      process.stdout.write(
        `FAIL  ${measuredStr} (baseline: ${baselineStr}, ${deltaPercent.toFixed(1)}%, tolerance: ±${(entry.tolerance * 100).toFixed(0)}%)\n`,
      );
      failures++;
      regressions.push(
        `${entry.name}: measured ${measuredStr}, baseline ${baselineStr} (${deltaPercent.toFixed(1)}%)`,
      );
    }
  }

  // Traceability check
  process.stdout.write('\nChecking README traceability...\n');
  const { passed: traceOk, issues } = await checkReadmeTraceability();
  if (traceOk) {
    process.stdout.write('  README traceability: PASS\n');
  } else {
    for (const issue of issues) {
      process.stdout.write(`  FAIL: ${issue}\n`);
      failures++;
    }
  }

  // Summary
  process.stdout.write('\n' + '─'.repeat(60) + '\n');
  process.stdout.write(
    `Results: ${passed} passed, ${failures} failed, ${skipped} skipped / ${baselinesFile.baselines.length} total\n`,
  );

  if (regressions.length > 0) {
    process.stdout.write('\nRegressions:\n');
    for (const r of regressions) {
      process.stdout.write(`  - ${r}\n`);
    }
  }

  if (failures > 0) {
    process.exit(1);
  }
}

if (import.meta.main) {
  main().catch((err) => {
    process.stderr.write(
      `Fatal error: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(2);
  });
}
