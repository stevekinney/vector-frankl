#!/usr/bin/env bun

/**
 * Validates that every documented `vector-frankl/...` import path is present in
 * package.json exports, that each exported entrypoint has JavaScript and
 * declaration output on disk, and that no public documentation imports from
 * `vector-frankl/src/...`.
 *
 * Verification: `bun run verify:exports`
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname } from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ExportConditions = {
  types?: string;
  import?: string;
  require?: string;
  default?: string;
  [key: string]: string | undefined;
};

type ExportEntry = string | ExportConditions;

type PackageExports = Record<string, ExportEntry>;

type PackageManifest = {
  name: string;
  exports?: PackageExports;
};

type ValidationFailure = {
  kind: 'src-import' | 'undocumented-missing' | 'no-js' | 'no-dts' | 'missing-in-exports';
  detail: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PACKAGE_ROOT = process.cwd();

async function readPackageJson(): Promise<PackageManifest> {
  const raw = await Bun.file(join(PACKAGE_ROOT, 'package.json')).json();
  return raw as PackageManifest;
}

/**
 * Recursively collects all markdown and TypeScript source files under a
 * directory, following only `.md`, `.ts`, `.tsx` extensions.
 */
async function collectDocFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  if (!existsSync(dir)) return results;

  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await collectDocFiles(fullPath);
      results.push(...nested);
    } else {
      const ext = extname(entry.name);
      if (ext === '.md' || ext === '.ts' || ext === '.tsx') {
        results.push(fullPath);
      }
    }
  }
  return results;
}

/**
 * Extract all `from 'vector-frankl/...'` and `from "vector-frankl/..."` import
 * specifiers found in a file's content.  Returns bare specifiers like
 * `vector-frankl/compression`, not the full export key form.
 */
function extractImportSpecifiers(content: string): string[] {
  const pattern = /from\s+['"]((vector-frankl)(?:\/[^'"]*)?)['"]/g;
  const specifiers: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    if (match[1] !== undefined) {
      specifiers.push(match[1]);
    }
  }
  return specifiers;
}

/**
 * Converts a bare import specifier such as `vector-frankl/compression` to the
 * package.json export key `./compression`.  The root `vector-frankl` maps to
 * `.`.
 */
function specifierToExportKey(specifier: string): string {
  if (specifier === 'vector-frankl') return '.';
  const suffix = specifier.slice('vector-frankl'.length);
  return '.' + suffix; // e.g. "./compression"
}

/**
 * Resolves all string values from a nested export conditions object.
 */
function resolveExportPaths(entry: ExportEntry): string[] {
  if (typeof entry === 'string') return [entry];
  return Object.values(entry).filter((v): v is string => typeof v === 'string');
}

// ---------------------------------------------------------------------------
// Main validation
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const pkg = await readPackageJson();
  const exports = pkg.exports ?? {};
  const failures: ValidationFailure[] = [];

  // -------------------------------------------------------------------------
  // 1. Scan documentation files for vector-frankl import specifiers
  // -------------------------------------------------------------------------

  const docRoots = [
    join(PACKAGE_ROOT, 'README.md'),
    join(PACKAGE_ROOT, 'docs'),
    join(PACKAGE_ROOT, 'examples'),
  ];

  const docFiles: string[] = [];
  for (const root of docRoots) {
    if (existsSync(root)) {
      const s = await stat(root);
      if (s.isFile()) {
        docFiles.push(root);
      } else {
        const nested = await collectDocFiles(root);
        docFiles.push(...nested);
      }
    }
  }

  const documentedSpecifiers = new Set<string>();

  for (const filePath of docFiles) {
    const content = await readFile(filePath, 'utf-8');
    for (const specifier of extractImportSpecifiers(content)) {
      // Reject vector-frankl/src/... imports immediately
      if (specifier.startsWith('vector-frankl/src/')) {
        failures.push({
          kind: 'src-import',
          detail: `${filePath}: imports from '${specifier}' — public documentation must not reference src/ paths`,
        });
      } else {
        documentedSpecifiers.add(specifier);
      }
    }
  }

  // -------------------------------------------------------------------------
  // 2. Every documented import must be in package.json exports
  // -------------------------------------------------------------------------

  for (const specifier of documentedSpecifiers) {
    const key = specifierToExportKey(specifier);
    if (!(key in exports)) {
      failures.push({
        kind: 'missing-in-exports',
        detail: `'${specifier}' is documented but '${key}' is not in package.json exports`,
      });
    }
  }

  // -------------------------------------------------------------------------
  // 3. Every export entry must have JS output and declaration output on disk
  // -------------------------------------------------------------------------

  for (const [key, entry] of Object.entries(exports)) {
    const paths = resolveExportPaths(entry);

    let hasJs = false;
    let hasDts = false;

    for (const relativePath of paths) {
      const absolutePath = join(PACKAGE_ROOT, relativePath);
      if (relativePath.endsWith('.d.ts')) {
        if (existsSync(absolutePath)) hasDts = true;
      } else if (relativePath.endsWith('.js')) {
        if (existsSync(absolutePath)) hasJs = true;
      }
    }

    if (!hasJs) {
      failures.push({
        kind: 'no-js',
        detail: `Export '${key}': no JavaScript output found (checked: ${paths.join(', ')})`,
      });
    }

    if (!hasDts) {
      failures.push({
        kind: 'no-dts',
        detail: `Export '${key}': no TypeScript declaration file found (checked: ${paths.join(', ')})`,
      });
    }
  }

  // -------------------------------------------------------------------------
  // 4. Report results
  // -------------------------------------------------------------------------

  if (failures.length > 0) {
    console.error('Export map validation FAILED:\n');
    for (const failure of failures) {
      console.error(`  [${failure.kind}] ${failure.detail}`);
    }
    console.error(`\n${failures.length} violation(s) found.`);
    process.exit(1);
  }

  const exportCount = Object.keys(exports).length;
  const docCount = documentedSpecifiers.size;

  console.log(
    `Export map validated: ${exportCount} exports checked, ${docCount} documented import(s) verified.`,
  );
}

main().catch((error: unknown) => {
  console.error('verify-exports failed:', error);
  process.exit(1);
});
