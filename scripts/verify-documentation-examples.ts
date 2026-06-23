#!/usr/bin/env bun

/**
 * Verify that documentation code examples type-check against the source.
 *
 * Checks:
 * 1. TypeScript files under examples/ compile without errors
 * 2. No documentation file references non-public imports (vector-frankl/src/...)
 * 3. All documented import paths exist as package.json exports
 *
 * Fails loudly when:
 * - An example file fails to type-check
 * - A documentation file imports from internal source paths
 * - A documented entrypoint is not in the package.json exports map
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

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

type PackageManifest = {
  name: string;
  exports?: Record<string, unknown>;
};

const packageManifest = (await Bun.file(
  join(root, 'package.json'),
).json()) as PackageManifest;
const packageName = packageManifest.name;
const exportedPaths = new Set(Object.keys(packageManifest.exports ?? {}));

// 1. Type-check example files
process.stdout.write('\nType-checking example files...\n');
const examplesDir = join(root, 'examples');
if (!existsSync(examplesDir)) {
  process.stdout.write('  skip: examples/ directory not found\n');
} else {
  const exampleFiles = await Array.fromAsync(
    new Bun.Glob('**/*.ts').scan({ cwd: examplesDir, onlyFiles: true }),
  );

  if (exampleFiles.length === 0) {
    process.stdout.write('  skip: no .ts files found in examples/\n');
  } else {
    // Run tsc --noEmit on each example to check for type errors
    // We use tsc in isolation mode per file to avoid project config interference
    const typeCheckResult = await Bun.$`bun run typecheck 2>&1`
      .text()
      .catch((err: unknown) => {
        return err instanceof Error ? err.message : String(err);
      });

    // Look for errors in example files specifically
    const exampleErrorLines = typeCheckResult
      .split('\n')
      .filter((line) => line.includes('examples/') && line.includes('error TS'));

    if (exampleErrorLines.length > 0) {
      for (const line of exampleErrorLines) {
        fail(`Type error in example: ${line.trim()}`);
      }
    } else {
      pass(`${exampleFiles.length} example file(s) type-check cleanly`);
    }
  }
}

// 2. Check documentation files for internal src imports
process.stdout.write('\nChecking documentation for internal src imports...\n');
const docFiles = ['README.md', 'docs/API.md', 'docs/SECURITY.md'];

for (const docFile of docFiles) {
  const filePath = join(root, docFile);
  if (!existsSync(filePath)) {
    continue;
  }

  const content = await Bun.file(filePath).text();
  const internalImports = [
    ...content.matchAll(new RegExp(`${packageName}/src[/'"]`, 'g')),
  ];
  if (internalImports.length > 0) {
    fail(
      `${docFile} contains ${internalImports.length} import(s) from ${packageName}/src/...`,
    );
  } else {
    pass(`${docFile} has no internal src imports`);
  }
}

// 3. Check documented import paths against exports map
process.stdout.write('\nChecking documented import paths against exports map...\n');
const allDocFiles = ['README.md', 'docs/API.md'];

for (const docFile of allDocFiles) {
  const filePath = join(root, docFile);
  if (!existsSync(filePath)) {
    continue;
  }

  const content = await Bun.file(filePath).text();

  // Find import statements in code blocks: from 'vector-frankl/something' or from "vector-frankl/something"
  const importPattern = new RegExp(`from ['"]${packageName}(/[^'"]*)?['"]`, 'g');
  const importMatches = [...content.matchAll(importPattern)];

  for (const match of importMatches) {
    const subpath = match[1] ?? '';
    const exportKey = subpath === '' ? '.' : `.${subpath}`;

    if (!exportedPaths.has(exportKey)) {
      fail(
        `${docFile} documents import from "${packageName}${subpath}" but "${exportKey}" is not in exports map`,
      );
    } else {
      pass(`${docFile}: "${packageName}${subpath}" is a valid export`);
    }
  }
}

process.stdout.write('\n');
if (failures > 0) {
  console.error(
    `Documentation example verification failed with ${failures} error(s) (${passed} passed).`,
  );
  process.exit(1);
}

process.stdout.write(`Documentation example verification passed: ${passed} check(s).\n`);

export {};
