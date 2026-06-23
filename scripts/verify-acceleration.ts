#!/usr/bin/env bun

/**
 * Verify that every acceleration path (SIMD, WebAssembly, WebGPU, workers, shared memory)
 * is classified as production-supported or experimental.
 *
 * Fails loudly when:
 * - Source files contain demo/mock markers that have not been addressed
 * - Acceleration paths are not classified in source or documentation
 * - Known placeholder strings appear in production source
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

// Patterns that indicate production-unready placeholder code in acceleration paths
const PLACEHOLDER_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  {
    pattern: /\/\/\s*For demonstration/i,
    description: 'demonstration-only comment',
  },
  {
    pattern: /\/\/\s*demo mode/i,
    description: 'demo mode comment',
  },
  {
    pattern: /\/\/\s*In production[,\s]/i,
    description: '"In production" placeholder comment (implies not production now)',
  },
  {
    pattern: /\/\/\s*mock WASM/i,
    description: 'mock WASM comment',
  },
  {
    pattern: /\/\/\s*placeholder allocation/i,
    description: 'placeholder allocation comment',
  },
];

// Acceleration source files to scan
const accelerationFiles: Array<{ path: string; label: string }> = [
  { path: 'src/wasm/wasm-manager.ts', label: 'WebAssembly manager' },
  { path: 'src/wasm/wasm-operations.ts', label: 'WebAssembly operations' },
  { path: 'src/gpu/gpu-search-engine.ts', label: 'WebGPU search engine' },
  { path: 'src/gpu/webgpu-manager.ts', label: 'WebGPU manager' },
  { path: 'src/workers/worker-pool.ts', label: 'worker pool' },
  { path: 'src/workers/shared-memory.ts', label: 'shared memory' },
  { path: 'src/simd', label: 'SIMD directory' },
];

process.stdout.write(
  '\nScanning acceleration source files for placeholder patterns...\n',
);

for (const { path: filePath, label } of accelerationFiles) {
  const absolutePath = join(root, filePath);
  if (!existsSync(absolutePath)) {
    process.stdout.write(`  skip: ${label} (${filePath} not found)\n`);
    continue;
  }

  // Handle both files and directories
  const isDirectory = (await Bun.file(absolutePath).exists()) === false;
  const filesToScan: string[] = [];

  if (isDirectory || filePath.endsWith('/')) {
    const glob = new Bun.Glob('**/*.ts');
    const entries = await Array.fromAsync(
      glob.scan({ cwd: absolutePath, onlyFiles: true }),
    );
    filesToScan.push(...entries.map((e) => join(absolutePath, e)));
  } else {
    filesToScan.push(absolutePath);
  }

  for (const scanFile of filesToScan) {
    if (!existsSync(scanFile)) continue;

    const content = await Bun.file(scanFile).text();
    const lines = content.split('\n');
    let fileHasIssues = false;

    for (const { pattern, description } of PLACEHOLDER_PATTERNS) {
      const matchingLines = lines
        .map((line, index) => ({ line, lineNumber: index + 1 }))
        .filter(({ line }) => pattern.test(line));

      for (const { line, lineNumber } of matchingLines) {
        const relativePath = scanFile.replace(root + '/', '');
        fail(`${relativePath}:${lineNumber} contains ${description}: ${line.trim()}`);
        fileHasIssues = true;
      }
    }

    if (!fileHasIssues) {
      const relativePath = scanFile.replace(root + '/', '');
      pass(`${relativePath} (${label}) has no placeholder patterns`);
    }
  }
}

// Check that acceleration paths are classified in the README
process.stdout.write('\nChecking README classifies acceleration paths...\n');
const readmePath = join(root, 'README.md');
if (!existsSync(readmePath)) {
  process.stdout.write('  skip: README.md not found\n');
} else {
  const readmeContent = await Bun.file(readmePath).text();

  const accelerationTerms = ['SIMD', 'WebAssembly', 'WebGPU', 'worker', 'shared memory'];
  const classificationTerms = [
    'Experimental',
    'Production-supported',
    'experimental',
    'production',
  ];

  // Check if readme contains any mention of acceleration AND classification
  const hasAccelerationMention = accelerationTerms.some((term) =>
    readmeContent.includes(term),
  );
  const hasClassification = classificationTerms.some((term) =>
    readmeContent.includes(term),
  );

  if (hasAccelerationMention && !hasClassification) {
    fail(
      'README.md mentions acceleration features but does not classify them as Experimental or Production-supported',
    );
  } else if (hasAccelerationMention && hasClassification) {
    pass('README.md classifies acceleration features');
  } else {
    process.stdout.write('  info: README.md does not mention acceleration features\n');
  }
}

process.stdout.write('\n');
if (failures > 0) {
  console.error(
    `Acceleration verification failed with ${failures} error(s) (${passed} passed).`,
  );
  console.error(
    'Resolve placeholder comments in acceleration source files before releasing.',
  );
  process.exit(1);
}

process.stdout.write(`Acceleration verification passed: ${passed} check(s).\n`);

export {};
