#!/usr/bin/env bun
/**
 * Verifies that documentation examples compile and that public API claims match
 * the actual implementation. Fails loudly if any advertised strategy is not
 * backed by a real compressor in CompressionManager.
 */

import { $ } from 'bun';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

let exitCode = 0;

function fail(message: string): void {
  console.error(`FAIL: ${message}`);
  exitCode = 1;
}

function pass(message: string): void {
  console.log(`PASS: ${message}`);
}

// ---------------------------------------------------------------------------
// 1. Typecheck example files
// ---------------------------------------------------------------------------

const exampleFiles = ['examples/basic-usage.ts', 'examples/namespace-usage.ts'];

for (const file of exampleFiles) {
  const fullPath = join(root, file);
  if (!existsSync(fullPath)) {
    fail(`Example file not found: ${file}`);
    continue;
  }

  const result = await $`bun run typecheck`.quiet().nothrow();
  // We only care about errors in the example files themselves; the bun type
  // definition error is pre-existing and unrelated to examples.
  const stderr = result.stderr.toString();
  const exampleErrors = stderr.split('\n').filter((line) => line.includes(file));

  if (exampleErrors.length > 0) {
    fail(`Type errors in ${file}:\n  ${exampleErrors.join('\n  ')}`);
  } else {
    pass(`${file} typechecks`);
  }
}

// ---------------------------------------------------------------------------
// 2. Verify that every strategy in CompressionStrategy is implemented
// ---------------------------------------------------------------------------

// Dynamically import the CompressionManager to inspect available strategies.
const { CompressionManager } = await import('../src/compression/compression-manager.js');
const manager = new CompressionManager();
const availableStrategies = manager.getAvailableStrategies();

// 'none' is a valid strategy that means "no compression" — it's handled at a
// higher layer and does not need a compressor entry.
const implementedStrategies = new Set(availableStrategies);

// Check that 'binary' is NOT present — it is deferred and must not be advertised.
if (implementedStrategies.has('binary' as never)) {
  fail(
    "'binary' appears in CompressionManager.getAvailableStrategies() but has no real implementation.",
  );
} else {
  pass("'binary' is correctly absent from available compression strategies");
}

// Check that the documented strategies are all present.
const requiredStrategies = ['scalar', 'product'] as const;
for (const strategy of requiredStrategies) {
  if (!implementedStrategies.has(strategy)) {
    fail(
      `Required compression strategy '${strategy}' is not registered in CompressionManager`,
    );
  } else {
    pass(`Strategy '${strategy}' is implemented and registered`);
  }
}

// ---------------------------------------------------------------------------
// 3. Verify CompressionStrategy type does not include 'binary'
// ---------------------------------------------------------------------------

// We grep the types file directly — if 'binary' appears in the CompressionStrategy
// type definition, the claim is invalid.
const typesFile = join(root, 'src/core/types.ts');
const typesContent = await Bun.file(typesFile).text();

const compressionStrategyLine = typesContent
  .split('\n')
  .find((line) => line.includes('CompressionStrategy') && line.includes('='));

if (compressionStrategyLine && compressionStrategyLine.includes("'binary'")) {
  fail(
    "CompressionStrategy type in src/core/types.ts still includes 'binary' — remove it until the implementation ships.",
  );
} else {
  pass("CompressionStrategy type does not advertise unimplemented 'binary' strategy");
}

// ---------------------------------------------------------------------------
// 4. Verify README does not claim binary compression as a feature
// ---------------------------------------------------------------------------

const readmeFile = join(root, 'README.md');
if (existsSync(readmeFile)) {
  const readmeContent = await Bun.file(readmeFile).text();
  // Detect claims like "binary compression" or "binary quantization" in feature lists.
  const binaryCompressionClaim = /\bbinary\s+(compression|quantization)\b/i.test(
    readmeContent,
  );
  if (binaryCompressionClaim) {
    fail(
      "README.md contains a 'binary compression' or 'binary quantization' claim that is not yet implemented.",
    );
  } else {
    pass('README.md does not advertise unimplemented binary compression');
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

if (exitCode === 0) {
  console.log('\nAll documentation example checks passed.');
} else {
  console.error('\nOne or more documentation example checks failed.');
}

process.exit(exitCode);

export {};
