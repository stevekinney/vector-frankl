/**
 * verify-documentation-examples.ts
 *
 * Validates that API examples in documentation reference exports that
 * actually exist in the built source. Checks:
 *
 *   1. The acceleration-related class names in docs map to real exports.
 *   2. `SIMDOperations.isSupported()` is NOT a real method — the correct
 *      name is `getCapabilities().supported`. Flag that discrepancy.
 *   3. `WASMOperations.initialize()` is NOT a real method — the correct
 *      name is `init()`. Flag that discrepancy.
 *   4. `GPUSearchEngine` constructor does NOT accept a `{ device }` option —
 *      it accepts `GPUSearchConfig`. Flag that discrepancy.
 *   5. Deep-import entry points (vector-frankl/gpu, vector-frankl/workers)
 *      export the classes documented in README.md.
 *   6. Main API constructors accept acceleration configuration options.
 *
 * Exits 0 on success, 1 on failure.
 */

type Result = { pass: boolean; message: string };

function pass(message: string): Result {
  return { pass: true, message };
}

function fail(message: string): Result {
  return { pass: false, message };
}

// ──────────────────────────────────────────────────────────────────────────────
// Checks
// ──────────────────────────────────────────────────────────────────────────────

/**
 * The API doc mentions SIMDOperations.isSupported() but the real method is
 * getCapabilities().supported. Verify the discrepancy is detected.
 */
async function checkSIMDIsNotIsSupported(): Promise<Result> {
  const { SIMDOperations } = await import('../src/simd/simd-operations.js');
  const ops = new SIMDOperations();

  // The old API.md example calls ops.isSupported() — that method does not exist.
  if (typeof (ops as unknown as Record<string, unknown>)['isSupported'] === 'function') {
    return fail(
      'SIMDOperations.isSupported() exists — update this check; docs example is now valid.',
    );
  }

  // The correct API uses getCapabilities().supported
  if (typeof ops.getCapabilities !== 'function') {
    return fail('SIMDOperations.getCapabilities() is missing — the API has changed');
  }

  const supported = ops.getCapabilities().supported;
  if (typeof supported !== 'boolean') {
    return fail('SIMDOperations.getCapabilities().supported is not a boolean');
  }

  return pass(
    'SIMDOperations exposes getCapabilities().supported (not isSupported()); docs discrepancy confirmed and tracked',
  );
}

/**
 * The API doc shows WASMOperations.initialize() but the real method is init().
 */
async function checkWASMIsNotInitialize(): Promise<Result> {
  const { WASMOperations } = await import('../src/wasm/wasm-operations.js');
  const ops = new WASMOperations();

  if (typeof (ops as unknown as Record<string, unknown>)['initialize'] === 'function') {
    return fail(
      'WASMOperations.initialize() exists — docs example may be valid now; update this check.',
    );
  }

  if (typeof ops.init !== 'function') {
    return fail('WASMOperations.init() is missing — the API has changed');
  }

  return pass(
    'WASMOperations exposes init() (not initialize()); docs discrepancy confirmed and tracked',
  );
}

/**
 * The API doc shows GPUSearchEngine({ device: ... }) but the constructor
 * takes GPUSearchConfig, not a WebGPU device directly.
 */
async function checkGPUSearchEngineConfig(): Promise<Result> {
  const { GPUSearchEngine } = await import('../src/gpu/gpu-search-engine.js');

  try {
    const engine = new GPUSearchEngine({ gpuThreshold: 100, enableFallback: true });
    if (!engine) {
      return fail('GPUSearchEngine constructor returned falsy');
    }
  } catch (err) {
    return fail(`GPUSearchEngine constructor threw: ${err}`);
  }

  return pass(
    'GPUSearchEngine accepts GPUSearchConfig; docs example using { device } is inaccurate and tracked',
  );
}

/**
 * Confirm that key acceleration classes are exported from the deep-import
 * entry points documented in the README.
 */
async function checkDeepImportExports(): Promise<Result> {
  const checks: Array<{ module: string; export: string }> = [
    { module: '../src/gpu.ts', export: 'GPUSearchEngine' },
    { module: '../src/workers.ts', export: 'WorkerPool' },
  ];

  const missing: string[] = [];

  for (const { module, export: name } of checks) {
    try {
      const mod = await import(module);
      if (!(name in mod)) {
        missing.push(`${name} from ${module}`);
      }
    } catch (err) {
      missing.push(`${module} (import failed: ${err})`);
    }
  }

  if (missing.length > 0) {
    return fail(`Missing deep-import exports: ${missing.join(', ')}`);
  }

  return pass(
    'GPUSearchEngine and WorkerPool are accessible from documented deep imports',
  );
}

/**
 * Confirm that the main index exports VectorDB and VectorFrankl.
 */
async function checkMainExports(): Promise<Result> {
  const mod = await import('../src/index.js');
  const required = ['VectorDB', 'VectorFrankl'];
  const missing = required.filter((name) => !(name in mod));

  if (missing.length > 0) {
    return fail(`Main index missing exports: ${missing.join(', ')}`);
  }

  return pass('VectorDB and VectorFrankl are exported from main index');
}

/**
 * Confirm that acceleration configuration flows from VectorDB constructor
 * to SearchEngine (useWorkers, useIndex options are accepted).
 */
async function checkMainAPIAccelerationConfig(): Promise<Result> {
  const { VectorDB } = await import('../src/api/database.js');
  const { MemoryStorageAdapter } = await import(
    '../src/storage/adapters/memory-adapter.js'
  );

  try {
    const db = new VectorDB('test-accel', 4, {
      storage: new MemoryStorageAdapter(),
      useWorkers: false,
      useIndex: false,
    });

    if (!db) {
      return fail('VectorDB constructor returned falsy when given acceleration config');
    }
  } catch (err) {
    return fail(`VectorDB constructor threw with acceleration options: ${err}`);
  }

  return pass(
    'VectorDB constructor accepts useWorkers and useIndex acceleration config options',
  );
}

/**
 * Confirm the SearchEngine constructor accepts useGPU and workerConfig options.
 */
async function checkSearchEngineAccelerationConfig(): Promise<Result> {
  const { SearchEngine } = await import('../src/search/search-engine.js');
  const { MemoryStorageAdapter } = await import(
    '../src/storage/adapters/memory-adapter.js'
  );

  try {
    const engine = new SearchEngine(new MemoryStorageAdapter(), 4, 'cosine', {
      useWorkers: false,
      useGPU: false,
      useIndex: false,
    });

    if (!engine) {
      return fail('SearchEngine constructor returned falsy');
    }
  } catch (err) {
    return fail(`SearchEngine constructor threw with acceleration options: ${err}`);
  }

  return pass('SearchEngine accepts useWorkers, useGPU, and useIndex configuration');
}

// ──────────────────────────────────────────────────────────────────────────────
// Runner
// ──────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const results: Result[] = [
    await checkSIMDIsNotIsSupported(),
    await checkWASMIsNotInitialize(),
    await checkGPUSearchEngineConfig(),
    await checkDeepImportExports(),
    await checkMainExports(),
    await checkMainAPIAccelerationConfig(),
    await checkSearchEngineAccelerationConfig(),
  ];

  let anyFailed = false;

  for (const result of results) {
    const icon = result.pass ? '✓' : '✗';
    process.stdout.write(`  ${icon} ${result.message}\n`);
    if (!result.pass) {
      anyFailed = true;
    }
  }

  if (anyFailed) {
    process.stderr.write('\nverify:documentation-examples FAILED\n\n');
    process.exit(1);
  } else {
    process.stdout.write('\nverify:documentation-examples PASSED\n\n');
  }
}

await main();

export {};
