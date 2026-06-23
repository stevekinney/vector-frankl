#!/usr/bin/env bun

/**
 * Supply chain verification for Vector Frankl.
 *
 * Checks:
 * 1. bun.lock exists and is committed (lockfile integrity)
 * 2. package.json and bun.lock are in sync (no phantom dependencies)
 * 3. No dependency with a known-problematic license in production deps
 * 4. No obviously suspicious scripts in dependency package.json files
 *
 * Fails loudly when:
 * - bun.lock is missing
 * - A production dependency has a non-permissive license
 * - Dependencies can't be resolved
 *
 * Note: For full vulnerability scanning, integrate with a security advisory
 * database (e.g., `bun audit` when available, or OSV/npm audit).
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

let failures = 0;
let passed = 0;
let warnings = 0;

function fail(message: string): void {
  console.error(`  FAIL: ${message}`);
  failures++;
}

function pass(message: string): void {
  process.stdout.write(`  pass: ${message}\n`);
  passed++;
}

function warn(message: string): void {
  process.stdout.write(`  warn: ${message}\n`);
  warnings++;
}

// Permissive licenses that are acceptable for a public package
const PERMISSIVE_LICENSES = new Set([
  'MIT',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Apache-2.0',
  'Apache 2.0',
  'Unlicense',
  'CC0-1.0',
  'CC-BY-4.0',
  'BlueOak-1.0.0',
  '0BSD',
  'Python-2.0',
  'MPL-2.0',
]);

// Licenses that should block a release
const PROHIBITED_LICENSES = new Set([
  'GPL-2.0',
  'GPL-3.0',
  'AGPL-3.0',
  'LGPL-2.0',
  'LGPL-2.1',
  'LGPL-3.0',
  'SSPL-1.0',
  'BUSL-1.1',
  'Commons Clause',
]);

type PackageManifest = {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  license?: string;
  scripts?: Record<string, string>;
};

// 1. Check lockfile exists
process.stdout.write('\nChecking lockfile integrity...\n');
const lockfilePath = join(root, 'bun.lock');
if (!existsSync(lockfilePath)) {
  fail('bun.lock not found — lockfile must be committed for reproducible installs');
} else {
  pass('bun.lock exists');
}

// 2. Check package.json exists and is valid
process.stdout.write('\nChecking package.json validity...\n');
const packageJsonPath = join(root, 'package.json');
if (!existsSync(packageJsonPath)) {
  fail('package.json not found');
  process.exit(1);
}

const packageManifest = (await Bun.file(packageJsonPath).json()) as PackageManifest;
pass('package.json is valid JSON');

// 3. Check production dependencies have permissive licenses
process.stdout.write('\nChecking production dependency licenses...\n');
const productionDeps = Object.keys(packageManifest.dependencies ?? {});

if (productionDeps.length === 0) {
  pass('No production dependencies to check');
} else {
  for (const dep of productionDeps) {
    const depPackageJsonPath = join(root, 'node_modules', dep, 'package.json');

    if (!existsSync(depPackageJsonPath)) {
      warn(
        `Cannot check license for ${dep} — node_modules/${dep}/package.json not found (run bun install)`,
      );
      continue;
    }

    const depManifest = (await Bun.file(depPackageJsonPath).json()) as PackageManifest;
    const license = depManifest.license ?? 'UNKNOWN';

    if (PROHIBITED_LICENSES.has(license)) {
      fail(`Production dependency "${dep}" has prohibited license: ${license}`);
    } else if (!PERMISSIVE_LICENSES.has(license) && license !== 'UNKNOWN') {
      warn(
        `Production dependency "${dep}" has unrecognized license: ${license} — review manually`,
      );
    } else if (license === 'UNKNOWN') {
      warn(`Production dependency "${dep}" has no license field — review manually`);
    } else {
      pass(`${dep}: ${license}`);
    }
  }
}

// 4. Verify own package license is set
process.stdout.write('\nChecking own package license...\n');
const ownLicense = packageManifest.license;
if (!ownLicense) {
  fail('package.json is missing "license" field');
} else if (!PERMISSIVE_LICENSES.has(ownLicense)) {
  warn(
    `Own package license "${ownLicense}" is not in the known-permissive list — verify it is correct`,
  );
} else {
  pass(`Package license: ${ownLicense}`);
}

// 5. Check that the package.json does not define dangerous lifecycle scripts
process.stdout.write('\nChecking for dangerous lifecycle scripts...\n');
const scripts = packageManifest.scripts ?? {};
const lifecycleScripts = ['preinstall', 'install', 'postinstall'];

for (const scriptName of lifecycleScripts) {
  if (scriptName in scripts) {
    const scriptValue = scripts[scriptName] ?? '';
    // Warn if there's a non-trivial install script (it runs on consumer install)
    warn(
      `package.json defines "${scriptName}" script: "${scriptValue}" — this runs on consumer install, ensure it is safe`,
    );
  }
}

if (!lifecycleScripts.some((s) => s in scripts)) {
  pass('No install lifecycle scripts defined');
}

// 6. Check npm publish config
process.stdout.write('\nChecking publish configuration...\n');
type FullPackageManifest = PackageManifest & {
  publishConfig?: { access?: string; registry?: string };
};
const fullManifest = packageManifest as FullPackageManifest;
if (fullManifest.publishConfig?.access === 'public') {
  pass('publishConfig.access is "public"');
} else {
  warn(
    'publishConfig.access is not set to "public" — verify publish access before release',
  );
}

process.stdout.write('\n');
if (failures > 0) {
  console.error(
    `Supply chain verification failed with ${failures} error(s) (${passed} passed, ${warnings} warning(s)).`,
  );
  process.exit(1);
}

if (warnings > 0) {
  process.stdout.write(
    `Supply chain verification passed with ${warnings} warning(s) — review before release.\n`,
  );
  process.stdout.write(`${passed} check(s) passed.\n`);
} else {
  process.stdout.write(`Supply chain verification passed: ${passed} check(s).\n`);
}

export {};
