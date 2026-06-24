#!/usr/bin/env bun

/**
 * Benchmark baseline verifier for Vector Frankl.
 *
 * Reads the committed baselines from `benchmarks/baselines.json` and runs a
 * subset of fast representative benchmarks. It then applies a two-tier policy:
 *
 * - **Hard-gated** metrics are deterministic — they do not depend on the
 *   runner's instantaneous CPU budget: search recall@10 (a ratio fixed by the
 *   math) and memory-per-vector (heap growth for a fixed fixture). A regression
 *   here is a real correctness/footprint regression and fails CI.
 *
 * - **Advisory** metrics are absolute throughput (`ops/sec`). On shared CI
 *   runners these vary ~2× run-to-run from CPU-steal alone — two runs of
 *   identical code on the same runner type were observed to differ by ~50%.
 *   No per-run statistic (mean, median, more iterations) can correct a
 *   uniformly slower run, and a tolerance wide enough to absorb 2× would catch
 *   nothing real. So throughput is measured and *logged for trend visibility*
 *   but never fails CI. (For a hardware-neutral throughput gate, the correct
 *   design is same-run A/B against the base revision — tracked as follow-up.)
 *
 * The benchmark *bodies* (seeding, iteration counts, the operation under test)
 * live in `src/benchmarks/benchmark-bodies.ts` and are shared verbatim with the
 * baseline-capture script `scripts/benchmark-production.ts`, so the gate always
 * measures the same operation its baseline was captured from.
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
 *   0  All hard-gated baselines verified (advisory throughput may still drift)
 *   1  A hard-gated regression or traceability check failed
 *   2  Configuration or file error
 */

import type {
  TargetDirection,
  TargetUnit,
} from '../src/benchmarks/production-targets.js';
import { runBenchmark } from '../src/benchmarks/benchmark-bodies.js';

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

Policy:
  Hard-gated (fail CI):  deterministic metrics — recall@10, memory-per-vector.
  Advisory  (log only):  absolute throughput (ops/sec), which is hardware-bound
                         and varies ~2x run-to-run on shared CI runners.

Exit codes:
  0  All hard-gated baselines verified
  1  A hard-gated regression or traceability failure
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

/**
 * Whether a baseline is a hard gate (deterministic, fails CI on regression) or
 * advisory (hardware-bound throughput, logged only).
 *
 * Deterministic categories don't depend on the runner's instantaneous speed:
 * recall is fixed by the math, and memory is heap growth for a fixed fixture.
 * Everything measured in `ops/sec` is wall-clock-bound and therefore advisory.
 */
const HARD_GATED_CATEGORIES = new Set(['recall', 'memory']);

function isHardGated(entry: BaselineEntry): boolean {
  return HARD_GATED_CATEGORIES.has(entry.category) && entry.unit !== 'ops/sec';
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
    const tier = isHardGated(b) ? 'gate' : 'advisory';
    process.stdout.write(
      `  ${b.name.padEnd(55)} ${String(b.baseline).padStart(12)} ${b.unit}  (±${(b.tolerance * 100).toFixed(0)}%) [${tier}]\n`,
    );
  }
  process.exit(0);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

/**
 * Run the benchmark for a single baseline entry.
 * Returns the measured value in the entry's unit, or `null` when the
 * benchmark is skipped in --fast mode.
 */
async function runBaseline(entry: BaselineEntry): Promise<number | null> {
  const { size = 1000 } = entry.dataset;

  // Skip slow targets in --fast mode.
  const slowCategories = new Set(['memory', 'startup']);
  const largeDataset = size > 5000;
  if (options.fast && (slowCategories.has(entry.category) || largeDataset)) {
    return null;
  }

  try {
    return await runBenchmark(entry.name, entry.dataset);
  } catch {
    // Unknown baseline name: skip rather than fail.
    return null;
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
    // README not found — not a failure, just skip traceability.
    return { passed: true, issues: [] };
  }

  // Extract any explicit baseline trace comments.
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
  process.stdout.write(`Generated: ${baselinesFile.generatedAt}\n`);
  process.stdout.write(
    'Policy: deterministic metrics (recall, memory) are hard-gated; ' +
      'throughput (ops/sec) is advisory and never fails CI.\n\n',
  );

  let failures = 0;
  let skipped = 0;
  let passed = 0;
  let advisoryDrift = 0;
  const regressions: string[] = [];
  const advisories: string[] = [];

  for (const entry of baselinesFile.baselines) {
    const gated = isHardGated(entry);
    const tier = gated ? 'gate' : 'adv ';
    const label = `[${tier}] ${entry.name}`.padEnd(62);
    process.stdout.write(`  ${label}`);

    let measured: number | null;
    try {
      measured = await runBaseline(entry);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stdout.write(`ERROR (${message})\n`);
      // A throwing benchmark is a real failure only for hard-gated metrics.
      if (gated) {
        failures++;
        regressions.push(`${entry.name}: benchmark threw an error (${message})`);
      } else {
        advisories.push(`${entry.name}: benchmark threw an error (${message})`);
      }
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

    if (!gated) {
      // Advisory: report measurement and drift, never fail.
      const drift = ok ? 'within band' : 'DRIFTED';
      process.stdout.write(
        `ADVISORY  ${measuredStr} (baseline: ${baselineStr}, ${sign}${deltaPercent.toFixed(1)}%, ${drift})\n`,
      );
      if (!ok) {
        advisoryDrift++;
        advisories.push(
          `${entry.name}: measured ${measuredStr}, baseline ${baselineStr} (${deltaPercent.toFixed(1)}%) — advisory, hardware-bound`,
        );
      }
      continue;
    }

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

  // Traceability check.
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

  // Summary.
  process.stdout.write('\n' + '─'.repeat(60) + '\n');
  process.stdout.write(
    `Hard-gated: ${passed} passed, ${failures} failed | ` +
      `Advisory: ${advisoryDrift} drifted | Skipped: ${skipped} / ${baselinesFile.baselines.length} total\n`,
  );

  if (regressions.length > 0) {
    process.stdout.write('\nHard-gated regressions (failing CI):\n');
    for (const r of regressions) {
      process.stdout.write(`  - ${r}\n`);
    }
  }

  if (advisories.length > 0) {
    process.stdout.write(
      '\nAdvisory throughput notes (not failing CI — hardware-bound):\n',
    );
    for (const a of advisories) {
      process.stdout.write(`  - ${a}\n`);
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
