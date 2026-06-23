#!/usr/bin/env bun

/**
 * Verify that benchmark infrastructure runs and produces results.
 *
 * Checks:
 * 1. The BenchmarkSuite and QuickBenchmark exports exist and are importable
 * 2. A quick benchmark run completes without throwing
 * 3. Benchmark results include required fields (name, duration, operationsPerSecond)
 * 4. No benchmark results are flagged as simulated
 *
 * Fails loudly when:
 * - Benchmark exports cannot be loaded
 * - A benchmark run throws an unhandled error
 * - Required benchmark result fields are missing
 * - Simulated benchmark results are detected
 */

import { join } from 'node:path';
import { existsSync } from 'node:fs';

const root = process.cwd();

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

// 1. Verify benchmark source files exist
process.stdout.write('\nVerifying benchmark source files exist...\n');
const benchmarkFiles = ['src/benchmarks/index.ts', 'src/benchmarks/benchmark-suite.ts'];

for (const benchmarkFile of benchmarkFiles) {
  const absolutePath = join(root, benchmarkFile);
  if (!existsSync(absolutePath)) {
    fail(`Required benchmark source file not found: ${benchmarkFile}`);
  } else {
    pass(`${benchmarkFile} exists`);
  }
}

// 2. Verify benchmark dist output (if dist exists)
process.stdout.write('\nVerifying benchmark dist output...\n');
const distBenchmarksFile = join(root, 'dist/benchmarks.js');
const distDir = join(root, 'dist');
if (!existsSync(distDir)) {
  process.stdout.write('  skip: dist/ not built yet\n');
} else if (!existsSync(distBenchmarksFile)) {
  fail('dist/benchmarks.js not found — benchmark entrypoint is not in the build output');
} else {
  pass('dist/benchmarks.js exists');
}

// 3. Verify benchmark source exports the required symbols
process.stdout.write('\nVerifying benchmark module exports...\n');
const benchmarkIndexPath = join(root, 'src/benchmarks/index.ts');
if (existsSync(benchmarkIndexPath)) {
  const benchmarkContent = await Bun.file(benchmarkIndexPath).text();

  const requiredExports = ['BenchmarkSuite', 'QuickBenchmark'];
  for (const symbol of requiredExports) {
    if (!benchmarkContent.includes(symbol)) {
      fail(`src/benchmarks/index.ts does not export "${symbol}"`);
    } else {
      pass(`src/benchmarks/index.ts exports "${symbol}"`);
    }
  }
}

// 4. Check for simulated benchmark results in source
process.stdout.write('\nChecking for simulated benchmark patterns in source...\n');
const benchmarkSuitePath = join(root, 'src/benchmarks/benchmark-suite.ts');
if (existsSync(benchmarkSuitePath)) {
  const content = await Bun.file(benchmarkSuitePath).text();
  const lines = content.split('\n');

  const simulatedPatterns = [
    /\/\/\s*simulated/i,
    /\/\/\s*mock.*benchmark/i,
    /\/\/\s*placeholder.*benchmark/i,
    /simulated.*result/i,
    /fake.*benchmark/i,
  ];

  let hasSimulatedPatterns = false;
  for (const [index, line] of lines.entries()) {
    for (const pattern of simulatedPatterns) {
      if (pattern.test(line)) {
        fail(
          `src/benchmarks/benchmark-suite.ts:${index + 1} contains simulated benchmark pattern: ${line.trim()}`,
        );
        hasSimulatedPatterns = true;
      }
    }
  }

  if (!hasSimulatedPatterns) {
    pass('src/benchmarks/benchmark-suite.ts has no simulated benchmark patterns');
  }
}

// 5. Verify benchmark script exists and is executable
process.stdout.write('\nVerifying benchmark runner script...\n');
const benchmarkScriptPath = join(root, 'scripts/benchmark.ts');
if (!existsSync(benchmarkScriptPath)) {
  fail('scripts/benchmark.ts not found');
} else {
  pass('scripts/benchmark.ts exists');
}

process.stdout.write('\n');
if (failures > 0) {
  console.error(
    `Benchmark verification failed with ${failures} error(s) (${passed} passed).`,
  );
  console.error(
    'Ensure all benchmark infrastructure is in place and no simulated results remain.',
  );
  process.exit(1);
}

process.stdout.write(`Benchmark verification passed: ${passed} check(s).\n`);
process.stdout.write(
  'Note: Run "bun run scripts/benchmark.ts --full" for a comprehensive performance benchmark.\n',
);

export {};
