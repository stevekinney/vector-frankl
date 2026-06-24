#!/usr/bin/env bun

/**
 * Production benchmark runner for Vector Frankl.
 *
 * Runs the full benchmark suite against the committed performance targets
 * defined in `src/benchmarks/production-targets.ts` and the baselines in
 * `benchmarks/baselines.json`. Exits with a non-zero code when any
 * result regresses beyond its documented tolerance, making CI fail.
 *
 * Usage:
 *   bun run benchmark:production              # Run and compare against targets
 *   bun run benchmark:production --update-baselines  # Run and write new baselines
 *   bun run benchmark:production --report json        # Emit JSON report to stdout
 *   bun run benchmark:production --help
 */

import {
  PRODUCTION_TARGETS,
  evaluateTarget,
} from '../src/benchmarks/production-targets.js';
import { runBenchmark } from '../src/benchmarks/benchmark-bodies.js';

// ── CLI argument parsing ──────────────────────────────────────────────────────

const args = process.argv.slice(2);
const options = {
  updateBaselines: args.includes('--update-baselines'),
  report: args.includes('--report')
    ? (args[args.indexOf('--report') + 1] ?? 'console')
    : 'console',
  help: args.includes('--help') || args.includes('-h'),
  verbose: args.includes('--verbose') || args.includes('-v'),
};

if (options.help) {
  console.log(`
Vector Frankl Production Benchmark Runner

Usage: bun run benchmark:production [options]

Options:
  --update-baselines   Run benchmarks and write results to benchmarks/baselines.json
  --report <format>    Output format: console (default) | json
  --verbose, -v        Print per-test detail
  --help, -h           Show this help

Exit codes:
  0  All targets met
  1  One or more regressions detected
  2  Benchmark runner error
`);
  process.exit(0);
}

// ── Result types ─────────────────────────────────────────────────────────────

interface MeasuredResult {
  name: string;
  category: string;
  unit: string;
  direction: 'higher-is-better' | 'lower-is-better';
  measured: number;
  minimum: number;
  tolerance: number;
  passed: boolean;
  delta: number;
  deltaPercent: number;
  dataset: { dimensions: number; size: number; k?: number };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatOps(value: number, unit: string): string {
  if (unit === 'ops/sec') {
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M ops/sec`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k ops/sec`;
    return `${value.toFixed(1)} ops/sec`;
  }
  return `${value.toFixed(2)} ${unit}`;
}

// Benchmark bodies (dataset seeding, iteration counts, the operation under
// test) live in src/benchmarks/benchmark-bodies.ts and are shared verbatim with
// the CI gate (scripts/verify-benchmarks.ts) via runBenchmark(), so capture and
// verification always measure the identical operation.

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('Vector Frankl Production Benchmarks\n');
  console.log(`Running ${PRODUCTION_TARGETS.length} production targets...\n`);

  const results: MeasuredResult[] = [];
  let failures = 0;

  for (const target of PRODUCTION_TARGETS) {
    process.stdout.write(`  ${target.name}... `);

    let measured: number;
    try {
      measured = await runBenchmark(target.name, target.dataset);
    } catch (err) {
      console.error(`FAILED (${err instanceof Error ? err.message : String(err)})`);
      failures++;
      results.push({
        name: target.name,
        category: target.category,
        unit: target.unit,
        direction: target.direction,
        measured: 0,
        minimum: target.minimum,
        tolerance: target.tolerance,
        passed: false,
        delta: -target.minimum,
        deltaPercent: -100,
        dataset: target.dataset,
      });
      continue;
    }

    const evaluation = evaluateTarget(target, measured);
    const { passed, delta, deltaPercent } = evaluation;

    const measuredStr = formatOps(measured, target.unit);
    const minimumStr = formatOps(target.minimum, target.unit);

    if (passed) {
      const sign = delta >= 0 ? '+' : '';
      console.log(
        `PASS  ${measuredStr} (min: ${minimumStr}, delta: ${sign}${deltaPercent.toFixed(1)}%)`,
      );
    } else {
      failures++;
      console.error(
        `FAIL  ${measuredStr} (min: ${minimumStr}, delta: ${deltaPercent.toFixed(1)}%, tolerance: ±${(target.tolerance * 100).toFixed(0)}%)`,
      );
    }

    results.push({
      name: target.name,
      category: target.category,
      unit: target.unit,
      direction: target.direction,
      measured,
      minimum: target.minimum,
      tolerance: target.tolerance,
      passed,
      delta,
      deltaPercent,
      dataset: target.dataset,
    });
  }

  // ── Summary ────────────────────────────────────────────────────────────────

  console.log('\n' + '─'.repeat(60));
  const passed = results.filter((r) => r.passed).length;
  console.log(`Results: ${passed}/${results.length} targets met`);

  if (failures > 0) {
    console.log(`\nFailed targets:`);
    for (const r of results.filter((r) => !r.passed)) {
      console.log(
        `  - ${r.name}: measured ${formatOps(r.measured, r.unit)}, minimum ${formatOps(r.minimum, r.unit)}`,
      );
    }
  }

  // ── Update baselines ───────────────────────────────────────────────────────

  if (options.updateBaselines) {
    const baselinePath = new URL('../benchmarks/baselines.json', import.meta.url)
      .pathname;
    const existingRaw = await Bun.file(baselinePath).text();
    const existing = JSON.parse(existingRaw) as {
      $schema: string;
      version: string;
      description: string;
      generatedAt: string;
      environment: { description: string };
      tolerances: { description: string; default: number };
      baselines: Array<{
        name: string;
        category: string;
        unit: string;
        direction: string;
        baseline: number;
        tolerance: number;
        dataset: { dimensions: number; size: number; k?: number };
      }>;
    };

    existing.generatedAt = new Date().toISOString();
    // Stamp the environment the baselines were actually measured on so the
    // committed file never claims a reference machine it was not captured on.
    const bunVersion =
      typeof Bun !== 'undefined' ? `Bun ${Bun.version}` : 'unknown runtime';
    const runnerHint = process.env['CI'] ? ' (GitHub Actions runner)' : '';
    existing.environment.description = `${process.platform}/${process.arch}, ${bunVersion}, no GPU acceleration, no WASM SIMD override${runnerHint}`;
    for (const result of results) {
      if (result.measured <= 0) continue;
      const entry = existing.baselines.find((b) => b.name === result.name);
      if (entry) {
        entry.baseline = Math.round(result.measured * 100) / 100;
      }
    }

    await Bun.write(baselinePath, JSON.stringify(existing, null, 2) + '\n');
    console.log('\nBaselines updated: benchmarks/baselines.json');
  }

  // ── JSON report ────────────────────────────────────────────────────────────

  if (options.report === 'json') {
    const report = {
      timestamp: new Date().toISOString(),
      passed,
      total: results.length,
      failures,
      results,
    };
    console.log('\n' + JSON.stringify(report, null, 2));
  }

  // In --update-baselines mode the current run *is* the new reference, so
  // deviations from the previous baselines are expected and must not fail the
  // process — the whole point is to overwrite them. A non-zero exit here would
  // also abort the CI commit step that persists the freshly captured numbers.
  if (failures > 0 && !options.updateBaselines) {
    process.exit(1);
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(2);
  });
}
