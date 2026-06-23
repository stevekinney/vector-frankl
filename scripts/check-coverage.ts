#!/usr/bin/env bun
/**
 * Parses coverage/lcov.info and enforces aggregate coverage thresholds.
 *
 * Exits with code 1 when any threshold is not met; exits 0 when all pass.
 * Run via `bun run scripts/check-coverage.ts` after `bun test --coverage`.
 *
 * Thresholds (percentages) — baseline measured 2026-06-23:
 *   --lines     minimum line coverage      (default 77 — baseline ~77.18%)
 *   --functions minimum function coverage  (default 79 — baseline ~84.56%)
 *   --branches  minimum branch coverage    (default 0  — bun 1.x does not emit branch data)
 *
 * Raise these floors as issue #92 ("100% production coverage") ships.
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArg(flag: string, fallback: number): number {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && process.argv[idx + 1] !== undefined) {
    const val = Number(process.argv[idx + 1]);
    if (!Number.isNaN(val)) return val;
  }
  return fallback;
}

const THRESHOLD_LINES = parseArg('--lines', 77);
const THRESHOLD_FUNCTIONS = parseArg('--functions', 79);
const THRESHOLD_BRANCHES = parseArg('--branches', 0);

// ---------------------------------------------------------------------------
// lcov.info parsing
// ---------------------------------------------------------------------------

type CoverageTotals = {
  linesFound: number;
  linesHit: number;
  functionsFound: number;
  functionsHit: number;
  branchesFound: number;
  branchesHit: number;
};

function parseLcov(content: string): CoverageTotals {
  const totals: CoverageTotals = {
    linesFound: 0,
    linesHit: 0,
    functionsFound: 0,
    functionsHit: 0,
    branchesFound: 0,
    branchesHit: 0,
  };

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('LF:')) {
      totals.linesFound += Number(trimmed.slice(3));
    } else if (trimmed.startsWith('LH:')) {
      totals.linesHit += Number(trimmed.slice(3));
    } else if (trimmed.startsWith('FNF:')) {
      totals.functionsFound += Number(trimmed.slice(4));
    } else if (trimmed.startsWith('FNH:')) {
      totals.functionsHit += Number(trimmed.slice(4));
    } else if (trimmed.startsWith('BRF:')) {
      totals.branchesFound += Number(trimmed.slice(4));
    } else if (trimmed.startsWith('BRH:')) {
      totals.branchesHit += Number(trimmed.slice(4));
    }
  }

  return totals;
}

function pct(hit: number, found: number): number {
  if (found === 0) return 100;
  return (hit / found) * 100;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const lcovPath = join(process.cwd(), 'coverage', 'lcov.info');

  if (!existsSync(lcovPath)) {
    console.error('coverage/lcov.info not found.');
    console.error('Run `bun run test:coverage` first to generate coverage data.');
    process.exit(1);
  }

  const content = await readFile(lcovPath, 'utf-8');
  const totals = parseLcov(content);

  const linePct = pct(totals.linesHit, totals.linesFound);
  const fnPct = pct(totals.functionsHit, totals.functionsFound);
  const branchPct = pct(totals.branchesHit, totals.branchesFound);

  const linePass = linePct >= THRESHOLD_LINES;
  const fnPass = fnPct >= THRESHOLD_FUNCTIONS;
  const branchPass = THRESHOLD_BRANCHES === 0 || branchPct >= THRESHOLD_BRANCHES;

  const lineStr = `${linePct.toFixed(2)}% lines   (threshold: ${THRESHOLD_LINES}%)`;
  const fnStr = `${fnPct.toFixed(2)}% functions (threshold: ${THRESHOLD_FUNCTIONS}%)`;
  const branchStr = `${branchPct.toFixed(2)}% branches (threshold: ${THRESHOLD_BRANCHES}%)`;

  console.log('Coverage summary:');
  console.log(`  ${linePass ? 'PASS' : 'FAIL'}  ${lineStr}`);
  console.log(`  ${fnPass ? 'PASS' : 'FAIL'}  ${fnStr}`);
  if (THRESHOLD_BRANCHES > 0) {
    console.log(`  ${branchPass ? 'PASS' : 'FAIL'}  ${branchStr}`);
  }

  if (!linePass || !fnPass || !branchPass) {
    console.error(
      '\nCoverage is below the required threshold. Add tests or document exclusions.',
    );
    process.exit(1);
  }

  console.log('\nAll coverage thresholds met.');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
