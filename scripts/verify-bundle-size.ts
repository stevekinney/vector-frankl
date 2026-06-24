#!/usr/bin/env bun

/**
 * Verify the built package bundle sizes are within defined limits.
 *
 * Budget limits (uncompressed, post-minification):
 *   - Main entrypoint (dist/index.js):      500 KB
 *   - GPU entrypoint (dist/gpu.js):         320 KB
 *   - Workers entrypoint (dist/workers.js): 320 KB
 *   - Debug entrypoint (dist/debug.js):     510 KB
 *   - Benchmarks entrypoint:                520 KB
 *   - Compression entrypoint:               320 KB
 *
 * Note: Budgets were raised with the zod 3→4 migration (PR #34). Zod 4 is a
 * complete rewrite that is significantly larger than zod 3 (~220 KB extra per
 * bundle). Every entrypoint transitively includes zod via logger →
 * configuration/environment. The new limits reflect real zod 4 bundle sizes
 * with a small headroom margin.
 *
 * Fails loudly when:
 * - A required build output is missing
 * - A bundle exceeds its size budget
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

// Size budgets in bytes (uncompressed, post-minification)
const BUDGETS: Record<string, number> = {
  'dist/index.js': 500 * 1024, // 500 KB
  'dist/gpu.js': 320 * 1024, // 320 KB — raised from 300 KB for zod 4 (PR #34)
  'dist/workers.js': 320 * 1024, // 320 KB — raised from 200 KB for zod 4 (PR #34)
  'dist/debug.js': 510 * 1024, // 510 KB — raised from 320 KB for zod 4 (PR #34); debug/health/diagnostics introspect the search+storage layer
  'dist/benchmarks.js': 520 * 1024, // 520 KB — raised from 300 KB for zod 4 (PR #34)
  'dist/compression.js': 320 * 1024, // 320 KB — raised from 200 KB for zod 4 (PR #34)
};

let failures = 0;
let passed = 0;

function fail(message: string): void {
  console.error(`  FAIL: ${message}`);
  failures++;
}

function pass(message: string): void {
  process.stdout.write(`  pass: ${message}\n`);
  passed++;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

const distDir = join(root, 'dist');
if (!existsSync(distDir)) {
  console.error(
    'FAIL: dist/ directory not found. Run "bun run build" before running bundle size checks.',
  );
  process.exit(1);
}

process.stdout.write('\nChecking bundle sizes against budgets...\n');

for (const [relPath, budgetBytes] of Object.entries(BUDGETS)) {
  const absolutePath = join(root, relPath);

  if (!existsSync(absolutePath)) {
    fail(`${relPath} not found — this entrypoint must be built before release`);
    continue;
  }

  const file = Bun.file(absolutePath);
  const sizeBytes = file.size;
  const budgetLabel = formatBytes(budgetBytes);
  const sizeLabel = formatBytes(sizeBytes);

  if (sizeBytes > budgetBytes) {
    fail(
      `${relPath} is ${sizeLabel} — exceeds budget of ${budgetLabel} (over by ${formatBytes(sizeBytes - budgetBytes)})`,
    );
  } else {
    const utilizationPct = ((sizeBytes / budgetBytes) * 100).toFixed(1);
    pass(`${relPath}: ${sizeLabel} of ${budgetLabel} budget (${utilizationPct}% used)`);
  }
}

process.stdout.write('\n');
if (failures > 0) {
  console.error(
    `Bundle size verification failed with ${failures} error(s) (${passed} passed).`,
  );
  console.error(
    'Reduce bundle size or update budgets in scripts/verify-bundle-size.ts with justification.',
  );
  process.exit(1);
}

process.stdout.write(
  `Bundle size verification passed: ${passed} entrypoint(s) within budget.\n`,
);

export {};
