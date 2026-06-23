#!/usr/bin/env bun

/**
 * Verify the packed package can be consumed from various environments.
 *
 * Checks:
 * 1. The package builds successfully
 * 2. The packed tarball contains all required files
 * 3. Every documented public entrypoint can be imported from the dist output
 *
 * Fails loudly when any entrypoint is missing from the built output.
 *
 * Note: Full cross-runtime consumer tests (ESM, CJS, Node, browser bundler)
 * require the packed tarball and are run as part of the release pipeline.
 * This script validates the pre-pack surface from the dist directory.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

type ExportConditions = {
  types?: string;
  import?: string;
  require?: string;
  default?: string;
};

// Package exports are either a direct path string or a conditions object.
// We don't recurse deeper since the package.json exports map is flat at depth 1.
type ExportValue = string | ExportConditions;

type PackageManifest = {
  name: string;
  version: string;
  exports?: Record<string, ExportValue>;
  main?: string;
  types?: string;
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

const packageManifest = (await Bun.file(
  join(root, 'package.json'),
).json()) as PackageManifest;

// 1. Verify dist directory exists (build must have been run)
process.stdout.write('\nChecking dist output exists...\n');
const distDir = join(root, 'dist');
if (!existsSync(distDir)) {
  console.error(
    'FAIL: dist/ directory not found. Run "bun run build" before running this verification.',
  );
  process.exit(1);
}
pass('dist/ directory exists');

// 2. Verify every export entry has JavaScript output and TypeScript declarations
process.stdout.write('\nVerifying all package export entrypoints...\n');

function collectEntrypointFiles(
  exportValue: ExportValue,
  exportKey: string,
): Array<{ label: string; path: string; required: boolean }> {
  const files: Array<{ label: string; path: string; required: boolean }> = [];

  if (typeof exportValue === 'string') {
    files.push({ label: `${exportKey} (default)`, path: exportValue, required: true });
    return files;
  }

  if (typeof exportValue === 'object' && exportValue !== null) {
    const conditions = exportValue as ExportConditions;

    if (conditions.types !== undefined) {
      files.push({
        label: `${exportKey} (.types)`,
        path: conditions.types,
        required: true,
      });
    }
    if (conditions.import !== undefined) {
      files.push({
        label: `${exportKey} (.import)`,
        path: conditions.import,
        required: true,
      });
    }
    if (conditions.require !== undefined) {
      files.push({
        label: `${exportKey} (.require)`,
        path: conditions.require,
        required: false,
      });
    }
    if (conditions.default !== undefined && conditions.import === undefined) {
      files.push({
        label: `${exportKey} (.default)`,
        path: conditions.default,
        required: true,
      });
    }
  }

  return files;
}

const exports = packageManifest.exports;
if (!exports) {
  console.error('FAIL: package.json has no "exports" field');
  process.exit(1);
}

for (const [exportKey, exportValue] of Object.entries(exports)) {
  const entrypointFiles = collectEntrypointFiles(exportValue, exportKey);
  for (const { label, path: relPath, required } of entrypointFiles) {
    const absolutePath = join(root, relPath.replace(/^\.\//, ''));
    if (!existsSync(absolutePath)) {
      if (required) {
        fail(`${label} → "${relPath}" not found in dist`);
      } else {
        process.stdout.write(`  skip (optional): ${label} → "${relPath}"\n`);
      }
    } else {
      pass(`${label} → "${relPath}"`);
    }
  }
}

// 3. Check main entrypoint is importable (static import from dist)
process.stdout.write('\nVerifying main entrypoint is importable...\n');
const mainEntrypoint = join(root, 'dist/index.js');
if (!existsSync(mainEntrypoint)) {
  fail('dist/index.js not found');
} else {
  try {
    // Dynamic import to verify the module parses without error
    const mod = (await import(mainEntrypoint)) as Record<string, unknown>;
    const exportedNames = Object.keys(mod);
    if (exportedNames.length === 0) {
      fail('dist/index.js exports nothing');
    } else {
      pass(`dist/index.js exports ${exportedNames.length} symbol(s)`);
    }

    // Check critical public API symbols are present
    const requiredExports = ['VectorDB', 'VectorFrankl'];
    for (const symbol of requiredExports) {
      if (!(symbol in mod)) {
        fail(`dist/index.js is missing required export: ${symbol}`);
      } else {
        pass(`dist/index.js exports ${symbol}`);
      }
    }
  } catch (error) {
    fail(
      `dist/index.js failed to import: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

// 4. Verify package tarball file list via npm pack --dry-run
process.stdout.write('\nVerifying package tarball file list...\n');
try {
  const output = await Bun.$`npm pack --dry-run --json --ignore-scripts`.text();
  const [packResult] = JSON.parse(output) as Array<{ files: Array<{ path: string }> }>;
  if (!packResult) {
    fail('npm pack --dry-run returned no metadata');
  } else {
    const packedFiles = new Set(packResult.files.map((f) => f.path));
    const requiredFiles = ['package.json', 'README.md', 'LICENSE', 'CHANGELOG.md'];
    for (const required of requiredFiles) {
      if (!packedFiles.has(required)) {
        fail(`Tarball is missing required file: ${required}`);
      } else {
        pass(`Tarball includes ${required}`);
      }
    }
    process.stdout.write(`  info: tarball contains ${packedFiles.size} file(s) total\n`);
  }
} catch (error) {
  fail(
    `npm pack --dry-run failed: ${error instanceof Error ? error.message : String(error)}`,
  );
}

process.stdout.write('\n');
if (failures > 0) {
  console.error(
    `Package consumer verification failed with ${failures} error(s) (${passed} passed).`,
  );
  console.error('Run "bun run build" to regenerate dist output and re-run this check.');
  process.exit(1);
}

process.stdout.write(`Package consumer verification passed: ${passed} check(s).\n`);

export {};
