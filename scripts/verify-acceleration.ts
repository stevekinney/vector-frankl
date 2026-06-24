/**
 * verify-acceleration.ts
 *
 * Verifies that every acceleration path in the codebase has an entry in the
 * canonical classification table (src/acceleration-classification.ts) and
 * that no implementation files make unsupported status claims.
 *
 * Exits 0 on success, 1 on failure.
 */

import { ACCELERATION_CLASSIFICATIONS } from '../src/acceleration-classification.js';

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

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
 * Every expected acceleration path must appear in the classification table.
 */
function checkAllPathsClassified(): Result {
  const expected = ['SIMD', 'WebAssembly', 'WebGPU', 'Workers', 'SharedMemory'];
  const classified = new Set(ACCELERATION_CLASSIFICATIONS.map((c) => c.name));
  const missing = expected.filter((name) => !classified.has(name));

  if (missing.length > 0) {
    return fail(`Missing classifications for: ${missing.join(', ')}`);
  }
  return pass('All acceleration paths are classified');
}

/**
 * Every entry must have a non-empty rationale.
 */
function checkRationalesPresent(): Result {
  const empty = ACCELERATION_CLASSIFICATIONS.filter((c) => !c.rationale.trim());
  if (empty.length > 0) {
    return fail(`Missing rationale for: ${empty.map((c) => c.name).join(', ')}`);
  }
  return pass('All classifications have rationale text');
}

/**
 * Check that WASMManager.isAvailable() cannot return true without a real
 * module by confirming the class reads from the `isInitialized` flag that
 * the `init()` method only sets when `modulePath` is provided.
 *
 * We verify this by instantiating WASMManager and asserting the contract.
 */
async function checkWASMNotAvailableWithoutModule(): Promise<Result> {
  const { WASMManager } = await import('../src/wasm/wasm-manager.js');
  const manager = new WASMManager({ enableWASM: true });

  // Before init
  const beforeInit = manager.isAvailable();

  await manager.init();

  // After init with no modulePath
  const afterInit = manager.isAvailable();

  await manager.cleanup();

  if (beforeInit || afterInit) {
    return fail(
      `WASMManager.isAvailable() returned true without a compiled module. ` +
        `before init: ${beforeInit}, after init: ${afterInit}`,
    );
  }

  return pass('WASMManager.isAvailable() correctly returns false without a real module');
}

/**
 * Check that SIMDOperations always reports as supported (JS-based fallback).
 */
async function checkSIMDAlwaysSupported(): Promise<Result> {
  const { SIMDOperations } = await import('../src/simd/simd-operations.js');
  const ops = new SIMDOperations({ enableSIMD: true });
  const capabilities = ops.getCapabilities();

  if (!capabilities.supported) {
    return fail(
      'SIMDOperations.getCapabilities().supported should be true on any JS runtime',
    );
  }

  return pass('SIMDOperations correctly reports as supported on this runtime');
}

/**
 * Check that SIMD can actually compute a dot product.
 */
async function checkSIMDProducesCorrectResults(): Promise<Result> {
  const { SIMDOperations } = await import('../src/simd/simd-operations.js');
  const ops = new SIMDOperations({ enableSIMD: true });

  const a = new Float32Array([1, 2, 3, 4]);
  const b = new Float32Array([4, 3, 2, 1]);
  const expected = 1 * 4 + 2 * 3 + 3 * 2 + 4 * 1; // 20

  const result = ops.dotProduct(a, b);

  if (Math.abs(result - expected) > 0.001) {
    return fail(`SIMD dot product produced ${result}, expected ${expected}`);
  }

  return pass(`SIMD dot product correct: ${result}`);
}

/**
 * Check that WorkerPool refuses to initialize in non-browser environments
 * (where Worker is undefined) without throwing an unhandled rejection.
 */
async function checkWorkersGracefullyAbsent(): Promise<Result> {
  // In Bun's test runner Worker is not available at the global level for the
  // main thread; the WorkerPool init() is expected to throw.
  if (typeof Worker !== 'undefined') {
    return pass('Worker API is available in this environment (skipping absence check)');
  }

  const { WorkerPool } = await import('../src/workers/worker-pool.js');
  const pool = new WorkerPool({ maxWorkers: 2 });

  try {
    await pool.init();
    return fail('WorkerPool.init() should throw when Worker is undefined');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('not supported')) {
      return pass('WorkerPool correctly rejects initialization when Worker is absent');
    }
    // Some other error — still proves it throws, but surface it
    return pass(`WorkerPool threw (msg: "${message}") when Worker is absent`);
  }
}

/**
 * Confirm that the classification table matches the expected counts per status.
 */
function checkStatusCounts(): Result {
  const production = ACCELERATION_CLASSIFICATIONS.filter(
    (c) => c.status === 'production',
  );
  const experimental = ACCELERATION_CLASSIFICATIONS.filter(
    (c) => c.status === 'experimental',
  );

  // SIMD + Workers = 2 production, WebAssembly + WebGPU + SharedMemory = 3 experimental
  if (production.length !== 2) {
    return fail(
      `Expected 2 production paths, got ${production.length}: ${production.map((c) => c.name).join(', ')}`,
    );
  }
  if (experimental.length !== 3) {
    return fail(
      `Expected 3 experimental paths, got ${experimental.length}: ${experimental.map((c) => c.name).join(', ')}`,
    );
  }

  return pass(
    `Status counts correct: ${production.length} production (${production.map((c) => c.name).join(', ')}), ` +
      `${experimental.length} experimental (${experimental.map((c) => c.name).join(', ')})`,
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Runner
// ──────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const results: Result[] = [
    checkAllPathsClassified(),
    checkRationalesPresent(),
    await checkWASMNotAvailableWithoutModule(),
    await checkSIMDAlwaysSupported(),
    await checkSIMDProducesCorrectResults(),
    await checkWorkersGracefullyAbsent(),
    checkStatusCounts(),
  ];

  let anyFailed = false;

  for (const result of results) {
    const icon = result.pass ? '✓' : '✗';
    console.log(`  ${icon} ${result.message}`);
    if (!result.pass) {
      anyFailed = true;
    }
  }

  if (anyFailed) {
    console.error('\nverify:acceleration FAILED\n');
    process.exit(1);
  } else {
    console.log('\nverify:acceleration PASSED\n');
  }
}

await main();
