#!/usr/bin/env bun

/**
 * Verify that every documented `vector-frankl/...` import is exported by package.json
 * and has JavaScript and declaration output in the dist directory.
 *
 * Fails loudly when:
 * - An exported path is missing its JavaScript output file
 * - An exported path is missing its TypeScript declaration file
 * - Any documentation file imports from `vector-frankl/src/...`
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
  name?: string;
  exports?: Record<string, ExportValue>;
  version?: string;
};

const packageManifest = (await Bun.file(
  join(root, 'package.json'),
).json()) as PackageManifest;

let failures = 0;

function fail(message: string): void {
  console.error(`  FAIL: ${message}`);
  failures++;
}

function pass(message: string): void {
  console.log(`  pass: ${message}`);
}

// Collect all export paths and their expected files
function collectExportFiles(exportValue: ExportValue, exportKey: string): void {
  if (typeof exportValue === 'string') {
    // Direct path — must exist
    const filePath = join(root, exportValue.replace(/^\.\//, ''));
    if (!existsSync(filePath)) {
      fail(`Export "${exportKey}" → "${exportValue}" file not found: ${filePath}`);
    } else {
      pass(`Export "${exportKey}" → "${exportValue}" exists`);
    }
    return;
  }

  if (typeof exportValue === 'object' && exportValue !== null) {
    // Condition map
    const conditions = exportValue as ExportConditions;

    if (conditions.types !== undefined) {
      const typesPath = join(root, conditions.types.replace(/^\.\//, ''));
      if (!existsSync(typesPath)) {
        fail(
          `Export "${exportKey}" .types → "${conditions.types}" not found: ${typesPath}`,
        );
      } else {
        pass(`Export "${exportKey}" .types → "${conditions.types}" exists`);
      }
    } else {
      fail(`Export "${exportKey}" is missing a "types" condition`);
    }

    const jsCondition = conditions.import ?? conditions.default;
    if (jsCondition !== undefined) {
      const jsPath = join(root, jsCondition.replace(/^\.\//, ''));
      if (!existsSync(jsPath)) {
        fail(`Export "${exportKey}" .import → "${jsCondition}" not found: ${jsPath}`);
      } else {
        pass(`Export "${exportKey}" .import → "${jsCondition}" exists`);
      }
    } else {
      fail(`Export "${exportKey}" is missing an "import" or "default" condition`);
    }
  }
}

// Check each export entry
console.log('\nChecking package exports against dist output...');
const exports = packageManifest.exports;
if (!exports) {
  console.error('FAIL: package.json has no "exports" field');
  process.exit(1);
}

for (const [exportKey, exportValue] of Object.entries(exports)) {
  collectExportFiles(exportValue, exportKey);
}

// Check documentation files don't import from vector-frankl/src/...
console.log('\nChecking documentation for vector-frankl/src imports...');

const docFiles = ['README.md', 'docs/API.md'];
for (const docFile of docFiles) {
  const filePath = join(root, docFile);
  if (!existsSync(filePath)) {
    // Not all doc files are required to exist for this check
    continue;
  }

  const content = await Bun.file(filePath).text();
  const srcImports = [...content.matchAll(/vector-frankl\/src[/'"]/g)];
  if (srcImports.length > 0) {
    fail(`${docFile} contains ${srcImports.length} import(s) from vector-frankl/src/...`);
  } else {
    pass(`${docFile} has no vector-frankl/src imports`);
  }
}

// Check examples directory
const examplesDir = join(root, 'examples');
if (existsSync(examplesDir)) {
  const exampleFiles = await Array.fromAsync(
    new Bun.Glob('**/*.ts').scan({ cwd: examplesDir, onlyFiles: true }),
  );

  for (const exampleFile of exampleFiles) {
    const filePath = join(examplesDir, exampleFile);
    const content = await Bun.file(filePath).text();
    const srcImports = [...content.matchAll(/vector-frankl\/src[/'"]/g)];
    if (srcImports.length > 0) {
      fail(
        `examples/${exampleFile} contains ${srcImports.length} import(s) from vector-frankl/src/...`,
      );
    }
  }
}

console.log('');
if (failures > 0) {
  console.error(`Export verification failed with ${failures} error(s).`);
  console.error('Run "bun run build" to generate dist output, then re-run this check.');
  process.exit(1);
}

console.log(
  `Export verification passed. All ${Object.keys(exports).length} exports verified.`,
);

export {};
