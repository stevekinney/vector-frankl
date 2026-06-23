#!/usr/bin/env bun
/**
 * Verify the packed package installs and works across representative consumer runtimes.
 *
 * For each consumer (ESM, CommonJS, Bun, Node, TypeScript, browser-bundler) the
 * script:
 *   1. Creates a temporary workspace under tmp/consumers/<name>
 *   2. Writes a consumer source file that exercises every documented public entrypoint
 *   3. Installs the packed tarball (built here from source)
 *   4. Runs/compiles the consumer and asserts success
 *
 * Exit code 0 = all consumers passed.
 * Exit code 1 = one or more consumers failed.
 */

import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const ROOT = resolve(import.meta.dir, '..');
const TMP_DIR = join(ROOT, 'tmp', 'consumers');
const PACKAGE_JSON = join(ROOT, 'package.json');

type ConsumerKind =
  | 'bun-esm'
  | 'bun-typescript'
  | 'node-esm'
  | 'node-cjs'
  | 'typescript-typecheck'
  | 'browser-bundler';

interface ConsumerSpec {
  name: ConsumerKind;
  description: string;
  /** Source files to write into the workspace. key = relative path, value = content. */
  sources: Record<string, string>;
  /** package.json overrides merged on top of the minimal template. */
  packageOverrides?: Record<string, unknown>;
  /** Command to run after install. */
  verifyCommand: string[];
}

// ---------------------------------------------------------------------------
// Consumer source templates
// ---------------------------------------------------------------------------

/**
 * Core exercise code exercised by every consumer.
 * Uses MemoryStorageAdapter so no runtime storage APIs (IndexedDB/OPFS) are needed.
 */
const CORE_EXERCISE_ESM = `
import {
  VectorDB,
  VectorFrankl,
  MemoryStorageAdapter,
  VectorDatabaseError,
  DimensionMismatchError,
  VectorNotFoundError,
  VectorOperations,
  DistanceMetrics,
  createDistanceCalculator,
  isVectorDatabaseError,
  VERSION,
} from 'vector-frankl';

function makeVector(dim) {
  return new Float32Array(dim).map(() => Math.random());
}

async function exerciseVectorDB() {
  const storage = new MemoryStorageAdapter();
  const db = new VectorDB('test-db', 4, { storage });
  await db.init();

  // add
  const v1 = makeVector(4);
  const v2 = makeVector(4);
  await db.addVector('vec-1', v1, { label: 'alpha' });
  await db.addVector('vec-2', v2, { label: 'beta' });

  // exists
  const exists = await db.exists('vec-1');
  if (!exists) throw new Error('vec-1 should exist');

  // get
  const got = await db.getVector('vec-1');
  if (!got) throw new Error('getVector returned null');

  // update
  const v1b = makeVector(4);
  await db.updateVector('vec-1', v1b, { label: 'alpha-updated' });

  // search
  const query = makeVector(4);
  const results = await db.search(query, 2);
  if (results.length === 0) throw new Error('search returned no results');

  // clear + close
  await db.clear();
  await db.close();
}

async function exerciseVectorFrankl() {
  // VectorFrankl defaults to IndexedDB (browser-only). In Bun/Node we must
  // supply a storageFactory that creates a MemoryStorageAdapter instead.
  const vf = new VectorFrankl('test-frankl', {
    defaultDimension: 4,
    storageFactory: () => new MemoryStorageAdapter(),
  });
  await vf.init();

  const ns = await vf.createNamespace('docs', { dimension: 4, distanceMetric: 'cosine' });

  const vec = makeVector(4);
  await ns.addVector('item-1', vec);
  const results = await ns.search(makeVector(4), 1);
  if (!results) throw new Error('namespace search failed');

  await ns.clear();
  await vf.close();
}

function exerciseStaticUtilities() {
  const a = new Float32Array([1, 0, 0, 0]);
  const b = new Float32Array([0, 1, 0, 0]);

  // DistanceMetrics is a singleton registry — access via getInstance()
  const cosineMetric = DistanceMetrics.getInstance().get('cosine');
  const cosine = cosineMetric.calculate(a, b);
  if (typeof cosine !== 'number') throw new Error('cosine distance should be a number');

  // createDistanceCalculator convenience function
  const calc = createDistanceCalculator('euclidean');
  const euclidean = calc.calculate(a, b);
  if (typeof euclidean !== 'number') throw new Error('euclidean distance should be a number');

  // dotProduct and magnitude have sync variants (the async versions return Promises)
  const dot = VectorOperations.dotProductSync(a, b);
  if (typeof dot !== 'number') throw new Error('dotProductSync should be a number');

  const mag = VectorOperations.magnitudeSync(a);
  if (typeof mag !== 'number') throw new Error('magnitudeSync should be a number');
}

function exerciseErrorTypes() {
  const err = new VectorDatabaseError('test', 'UNKNOWN_ERROR');
  if (!isVectorDatabaseError(err)) throw new Error('isVectorDatabaseError failed');
  if (!(new DimensionMismatchError(4, 3) instanceof VectorDatabaseError)) {
    throw new Error('DimensionMismatchError should extend VectorDatabaseError');
  }
  if (!(new VectorNotFoundError('x') instanceof VectorDatabaseError)) {
    throw new Error('VectorNotFoundError should extend VectorDatabaseError');
  }
}

async function main() {
  if (typeof VERSION !== 'string') throw new Error('VERSION export missing');
  exerciseStaticUtilities();
  exerciseErrorTypes();
  await exerciseVectorDB();
  await exerciseVectorFrankl();
  console.log('OK: all entrypoints verified');
}

main().catch((err) => { console.error('FAIL:', err); process.exit(1); });
`.trimStart();

/**
 * CommonJS consumer — uses the package "require" export condition.
 *
 * NOTE: packages with "type": "module" must use .cjs file extensions for their
 * CJS output — .js files in such packages are treated as ESM by Node v12+.
 * This consumer therefore tests the "require" export condition by loading
 * vector-frankl via synchronous require() from a plain .cjs file.  If the
 * package ships .js CJS files inside a "type": "module" package, this consumer
 * will fail, which is the correct result — the script exists to surface that.
 */
const CORE_EXERCISE_CJS = `
'use strict';
const {
  VectorDB,
  MemoryStorageAdapter,
  VectorDatabaseError,
  DistanceMetrics,
  createDistanceCalculator,
  isVectorDatabaseError,
  VERSION,
} = require('vector-frankl');

function makeVector(dim) {
  return new Float32Array(dim).map(() => Math.random());
}

async function main() {
  if (typeof VERSION !== 'string') throw new Error('VERSION export missing');

  // DistanceMetrics is a singleton registry; access via getInstance()
  const cosineMetric = DistanceMetrics.getInstance().get('cosine');
  const cosine = cosineMetric.calculate(
    new Float32Array([1, 0, 0]),
    new Float32Array([0, 1, 0])
  );
  if (typeof cosine !== 'number') throw new Error('cosine distance failed');

  // createDistanceCalculator convenience function
  const calc = createDistanceCalculator('euclidean');
  if (typeof calc.calculate !== 'function') throw new Error('createDistanceCalculator failed');

  const storage = new MemoryStorageAdapter();
  const db = new VectorDB('cjs-test', 3, { storage });
  await db.init();

  await db.addVector('v1', makeVector(3), { src: 'cjs' });
  await db.addVector('v2', makeVector(3), { src: 'cjs' });

  const got = await db.getVector('v1');
  if (!got) throw new Error('getVector failed in CJS');

  await db.updateVector('v1', makeVector(3), { src: 'cjs-updated' });

  const results = await db.search(makeVector(3), 2);
  if (results.length === 0) throw new Error('search failed in CJS');

  await db.clear();
  await db.close();

  const err = new VectorDatabaseError('test', 'UNKNOWN_ERROR');
  if (!isVectorDatabaseError(err)) throw new Error('isVectorDatabaseError failed in CJS');

  console.log('OK: CJS entrypoints verified');
}

main().catch((err) => { console.error('FAIL:', err); process.exit(1); });
`.trimStart();

/**
 * TypeScript consumer that exercises type-level correctness.
 * Compiled with tsc --noEmit to catch broken declarations.
 */
const CORE_EXERCISE_TS = `
import {
  VectorDB,
  VectorFrankl,
  MemoryStorageAdapter,
  VectorDatabaseError,
  DimensionMismatchError,
  VectorNotFoundError,
  VectorOperations,
  SearchEngine,
  DistanceMetrics,
  createDistanceCalculator,
  isVectorDatabaseError,
  VERSION,
  type DatabaseConfig,
  type VectorData,
  type SearchResult,
  type StorageAdapter,
  type DistanceMetric,
  type SearchOptions,
  type NamespaceConfig,
  type StorageAdapterFactory,
} from 'vector-frankl';

// Type assertions — tsc will catch any missing/broken declarations
const _version: string = VERSION;
void _version;

// Value-level references to verify each class export resolves correctly
void VectorFrankl;
void VectorDatabaseError;
void DimensionMismatchError;
void VectorNotFoundError;
void VectorOperations;
void SearchEngine;
void DistanceMetrics;
void createDistanceCalculator;

const _storage: StorageAdapter = new MemoryStorageAdapter();
void _storage;

// DatabaseConfig covers IndexedDB connection config — distanceMetric lives on NamespaceConfig
const _config: Partial<DatabaseConfig> = { name: 'test-db', version: 1 };
void _config;

const _metric: DistanceMetric = 'cosine';
void _metric;

// SearchOptions does not include topK (that is a positional parameter on search())
const _options: SearchOptions = { includeMetadata: true };
void _options;

const _nsConfig: NamespaceConfig = { dimension: 4, distanceMetric: 'cosine' };
void _nsConfig;

const _factory: StorageAdapterFactory = () => new MemoryStorageAdapter();
void _factory;

function _handleError(err: unknown): void {
  if (isVectorDatabaseError(err)) {
    const _code: string = err.code;
    void _code;
  }
}
void _handleError;

async function _smokeRun(): Promise<void> {
  const db = new VectorDB('ts-test', 4, { storage: new MemoryStorageAdapter() });
  await db.init();

  await db.addVector('x', new Float32Array(4).fill(0.5), { tag: 'ts' });
  const results: SearchResult[] = await db.search(new Float32Array(4).fill(0.1), 1);
  const _r: SearchResult | undefined = results[0];
  void _r;

  const data: VectorData | null = await db.getVector('x');
  void data;

  await db.updateVector('x', new Float32Array(4).fill(0.9));
  await db.clear();
  await db.close();
}
void _smokeRun;

export {};
`.trimStart();

// tsconfig for the typescript-typecheck consumer
const CONSUMER_TSCONFIG = JSON.stringify(
  {
    compilerOptions: {
      strict: true,
      exactOptionalPropertyTypes: true,
      noUncheckedIndexedAccess: true,
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      target: 'ES2022',
      esModuleInterop: true,
      skipLibCheck: false,
      noEmit: true,
    },
    include: ['src/**/*.ts'],
  },
  null,
  2,
);

// ---------------------------------------------------------------------------
// Consumer specifications
// ---------------------------------------------------------------------------

function buildConsumers(): ConsumerSpec[] {
  return [
    {
      name: 'bun-esm',
      description: 'Bun native ESM consumer',
      sources: {
        'src/index.ts': CORE_EXERCISE_ESM,
      },
      packageOverrides: {
        type: 'module',
        scripts: { verify: 'bun run src/index.ts' },
      },
      verifyCommand: ['bun', 'run', 'verify'],
    },
    {
      name: 'bun-typescript',
      description: 'Bun TypeScript consumer (type-check + run)',
      sources: {
        'src/index.ts': CORE_EXERCISE_TS.replace(
          'export {};',
          `
// Runtime smoke-test
const storage = new MemoryStorageAdapter();
const db = new VectorDB('bun-ts-test', 4, { storage });
db.init()
  .then(() => db.addVector('a', new Float32Array(4).fill(0.5)))
  .then(() => db.search(new Float32Array(4).fill(0.1), 1))
  .then(async () => { await db.clear(); await db.close(); })
  .then(() => console.log('OK: Bun TypeScript entrypoints verified'))
  .catch((err: unknown) => { console.error('FAIL:', err); process.exit(1); });
`,
        ),
      },
      packageOverrides: {
        type: 'module',
        scripts: { verify: 'bun run src/index.ts' },
      },
      verifyCommand: ['bun', 'run', 'verify'],
    },
    {
      name: 'node-esm',
      description: 'Node.js ESM consumer',
      sources: {
        'src/index.mjs': CORE_EXERCISE_ESM,
      },
      packageOverrides: {
        type: 'module',
        scripts: { verify: 'node src/index.mjs' },
      },
      verifyCommand: ['bun', 'run', 'verify'],
    },
    {
      name: 'node-cjs',
      description: 'Node.js CommonJS consumer',
      sources: {
        'src/index.cjs': CORE_EXERCISE_CJS,
      },
      packageOverrides: {
        // No "type": "module" so .cjs is loaded as CJS
        scripts: { verify: 'node src/index.cjs' },
      },
      verifyCommand: ['bun', 'run', 'verify'],
    },
    {
      name: 'typescript-typecheck',
      description: 'TypeScript strict type-check consumer (tsc --noEmit)',
      sources: {
        'src/index.ts': CORE_EXERCISE_TS,
        'tsconfig.json': CONSUMER_TSCONFIG,
      },
      packageOverrides: {
        type: 'module',
        scripts: {
          verify: 'tsc --noEmit',
        },
      },
      verifyCommand: ['bun', 'run', 'verify'],
    },
    {
      name: 'browser-bundler',
      description: 'Browser bundler consumer (bun build --target=browser)',
      sources: {
        'src/index.ts': CORE_EXERCISE_ESM,
      },
      packageOverrides: {
        type: 'module',
        scripts: {
          // Bundle with bun targeting browser; success = bundler resolves all imports.
          // NOTE: Use ./src/index.ts (not src/index.ts) to ensure Bun treats it as a relative file path.
          verify: 'bun build ./src/index.ts --target=browser --outdir=dist',
        },
      },
      verifyCommand: ['bun', 'run', 'verify'],
    },
  ];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(msg: string): void {
  console.log(msg);
}

function err(msg: string): void {
  console.error(msg);
}

async function sh(args: string[], cwd: string): Promise<{ ok: boolean; output: string }> {
  const proc = Bun.spawn(args, {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  const output = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n');
  return { ok: exitCode === 0, output };
}

async function pack(repoRoot: string): Promise<string> {
  log('\n── Building package from source…');

  // Clean and rebuild (run build steps directly to avoid the prepare/husky hook)
  const buildClean = await sh(['bun', 'run', 'build:clean'], repoRoot);
  if (!buildClean.ok) {
    throw new Error(`Build clean failed:\n${buildClean.output}`);
  }

  const buildTypes = await sh(['bun', 'run', 'build:types'], repoRoot);
  if (!buildTypes.ok) {
    throw new Error(`Build types failed:\n${buildTypes.output}`);
  }

  const buildJs = await sh(['bun', 'run', 'build:js'], repoRoot);
  if (!buildJs.ok) {
    throw new Error(`Build JS failed:\n${buildJs.output}`);
  }

  const buildCjs = await sh(['bun', 'run', 'build:cjs'], repoRoot);
  if (!buildCjs.ok) {
    throw new Error(`Build CJS failed:\n${buildCjs.output}`);
  }

  const buildAdapters = await sh(['bun', 'run', 'build:adapters'], repoRoot);
  if (!buildAdapters.ok) {
    throw new Error(`Build adapters failed:\n${buildAdapters.output}`);
  }

  log('── Packing tarball…');

  // Use npm pack with --ignore-scripts to skip the prepare hook (husky) that
  // requires a global husky install. The prepack script (bun run build) is also
  // skipped since we already built above.
  const packResult = await sh(['npm', 'pack', '--ignore-scripts', '--json'], repoRoot);
  if (!packResult.ok) {
    throw new Error(`Pack failed:\n${packResult.output}`);
  }

  // npm pack --json prints a JSON array; extract the filename from it.
  let tarballFilename: string | undefined;
  try {
    const parsed = JSON.parse(packResult.output) as Array<{ filename: string }>;
    tarballFilename = parsed[0]?.filename;
  } catch {
    // Fallback: last non-empty line of output
    tarballFilename = packResult.output
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .at(-1);
  }

  if (!tarballFilename) {
    throw new Error(
      `Could not determine tarball filename from pack output:\n${packResult.output}`,
    );
  }

  const tarball = join(repoRoot, tarballFilename);
  if (!existsSync(tarball)) {
    throw new Error(
      `Expected tarball not found: ${tarball}\nPack output:\n${packResult.output}`,
    );
  }

  log(`── Tarball ready: ${tarballFilename}`);
  return tarball;
}

async function setupConsumer(
  spec: ConsumerSpec,
  tarballPath: string,
): Promise<{ dir: string }> {
  const dir = join(TMP_DIR, spec.name);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });

  // Write sources
  for (const [relativePath, content] of Object.entries(spec.sources)) {
    const fullPath = join(dir, relativePath);
    await mkdir(join(dir, relativePath.split('/').slice(0, -1).join('/') || '.'), {
      recursive: true,
    });
    await writeFile(fullPath, content, 'utf8');
  }

  // Build package.json
  const pkg: Record<string, unknown> = {
    name: `vector-frankl-consumer-${spec.name}`,
    version: '1.0.0',
    private: true,
    ...spec.packageOverrides,
  };

  // TypeScript consumer needs tsc on PATH — add typescript as a dev dep
  if (spec.name === 'typescript-typecheck') {
    pkg['devDependencies'] = { typescript: 'latest' };
  }

  await writeFile(join(dir, 'package.json'), JSON.stringify(pkg, null, 2), 'utf8');

  // Install dependencies: first the dev deps (if any), then the tarball
  const installArgs = ['bun', 'add', tarballPath];
  if (spec.name === 'typescript-typecheck') {
    // Install typescript first so tsc is available
    const tsInstall = await sh(['bun', 'add', 'typescript'], dir);
    if (!tsInstall.ok) {
      throw new Error(`typescript install failed:\n${tsInstall.output}`);
    }
  }
  const install = await sh(installArgs, dir);
  if (!install.ok) {
    throw new Error(`bun add tarball failed:\n${install.output}`);
  }

  return { dir };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  log('=== verify:package-consumers ===\n');

  // Validate we are at repo root
  if (!existsSync(PACKAGE_JSON)) {
    err(
      `package.json not found at ${PACKAGE_JSON} — run this script from the repo root.`,
    );
    process.exit(1);
  }

  // Ensure tmp workspace is clean
  await rm(TMP_DIR, { recursive: true, force: true });
  await mkdir(TMP_DIR, { recursive: true });

  // Build and pack from source
  let tarballPath: string;
  try {
    tarballPath = await pack(ROOT);
  } catch (e) {
    err(`\nFATAL: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }

  const consumers = buildConsumers();

  const results: Array<{ spec: ConsumerSpec; ok: boolean; output: string }> = [];

  for (const spec of consumers) {
    log(`\n──────────────────────────────────────`);
    log(`Consumer: ${spec.name}  (${spec.description})`);

    let consumerDir: string;
    try {
      const { dir } = await setupConsumer(spec, tarballPath);
      consumerDir = dir;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      err(`  ✗ Setup failed: ${msg}`);
      results.push({ spec, ok: false, output: msg });
      continue;
    }

    const { ok, output } = await sh(spec.verifyCommand, consumerDir);
    if (ok) {
      log(`  ✓ ${output || 'passed'}`);
    } else {
      err(`  ✗ FAILED`);
      err(output);
    }
    results.push({ spec, ok, output });
  }

  log('\n══════════════════════════════════════');
  log('Results:');
  for (const { spec, ok } of results) {
    const mark = ok ? '✓' : '✗';
    log(`  ${mark} ${spec.name}`);
  }

  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    err(`\nFAILED: ${failed.length} of ${results.length} consumers failed.`);
    process.exit(1);
  }

  log(`\nAll ${results.length} consumers passed.`);
}

main().catch((e: unknown) => {
  err(`Unhandled error: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
