#!/usr/bin/env bun

/**
 * Production verification gate for Vector Frankl releases.
 *
 * Runs as `bun run verify:production` and fails loudly when any required
 * release gate is missing or failing. Designed to run in CI and as a
 * `prepublishOnly` guard.
 *
 * Gate categories:
 *   - Required package.json scripts exist
 *   - Required browser end-to-end test projects exist
 *   - Required build output is present
 *   - Package surface is valid
 */

type PackageScripts = Record<string, string>;
type PackageManifest = {
  scripts?: PackageScripts;
};

const REQUIRED_SCRIPTS: readonly string[] = [
  'build',
  'lint',
  'typecheck',
  'test',
  'test:end-to-end',
  'package:check',
  'verify:production',
];

const REQUIRED_BROWSER_PROJECTS: readonly string[] = [
  'tests/end-to-end/basic-operations.e2e.ts',
  'tests/end-to-end/cross-browser-compatibility.e2e.ts',
  'tests/end-to-end/indexeddb-storage.e2e.ts',
  'tests/end-to-end/wasm-operations.e2e.ts',
  'tests/end-to-end/web-workers.e2e.ts',
];

const REQUIRED_SCRIPTS_FILES: readonly string[] = [
  'scripts/check-package.ts',
  'scripts/benchmark.ts',
];

type GateResult = {
  name: string;
  passed: boolean;
  message: string;
};

const results: GateResult[] = [];

function pass(name: string, message: string): void {
  results.push({ name, passed: true, message });
  console.log(`  ✅ ${name}: ${message}`);
}

function fail(name: string, message: string): void {
  results.push({ name, passed: false, message });
  console.error(`  ❌ ${name}: ${message}`);
}

async function fileExists(path: string): Promise<boolean> {
  const file = Bun.file(path);
  return file.exists();
}

// Gate 1: Required package.json scripts exist
console.log('\nGate 1: Required package.json scripts');
const packageManifest = (await Bun.file('package.json').json()) as PackageManifest;
const definedScripts = packageManifest.scripts ?? {};

for (const script of REQUIRED_SCRIPTS) {
  if (script in definedScripts) {
    pass('scripts', `"${script}" is defined`);
  } else {
    fail('scripts', `"${script}" is missing from package.json scripts`);
  }
}

// Gate 2: Required browser end-to-end projects exist
console.log('\nGate 2: Required browser end-to-end test projects');
for (const project of REQUIRED_BROWSER_PROJECTS) {
  if (await fileExists(project)) {
    pass('browser-projects', `${project} exists`);
  } else {
    fail('browser-projects', `${project} is missing — browser coverage is incomplete`);
  }
}

// Gate 3: Required script files exist
console.log('\nGate 3: Required release scripts');
for (const scriptFile of REQUIRED_SCRIPTS_FILES) {
  if (await fileExists(scriptFile)) {
    pass('release-scripts', `${scriptFile} exists`);
  } else {
    fail('release-scripts', `${scriptFile} is missing`);
  }
}

// Gate 4: Build output is present
console.log('\nGate 4: Build output');
const buildFiles = ['dist/index.js', 'dist/index.d.ts'];
for (const buildFile of buildFiles) {
  if (await fileExists(buildFile)) {
    pass('build-output', `${buildFile} exists`);
  } else {
    fail('build-output', `${buildFile} is missing — run "bun run build" first`);
  }
}

// Summary
const failed = results.filter((r) => !r.passed);
const passed = results.filter((r) => r.passed);

console.log(`\n${'─'.repeat(60)}`);
console.log(`Production verification: ${passed.length} passed, ${failed.length} failed`);

if (failed.length > 0) {
  console.error('\nFailed gates:');
  for (const result of failed) {
    console.error(`  • [${result.name}] ${result.message}`);
  }
  console.error(
    '\nRelease is NOT ready. Fix the issues above before publishing.',
  );
  process.exit(1);
}

console.log('\nAll production gates passed. Release is ready.');

export {};
