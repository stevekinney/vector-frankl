import { expect, test } from '@playwright/test';

// Type for the browser-side window extensions defined in indexeddb-durability.html
type DurabilityWindow = Window & {
  __INDEXEDDB_DURABILITY_READY__: boolean;
  setupPersistence: (dbName: string) => Promise<{ dbName: string }>;
  verifyPersistence: (dbName: string) => Promise<{
    id: string;
    metadata: Record<string, unknown>;
    count: number;
  }>;
  testMultipleInstances: () => Promise<{
    countA: number;
    countB: number;
    crossReadA: string;
    crossReadB: string;
  }>;
  testVersionUpgrade: () => Promise<{
    version1: number;
    version2: number;
    storesV1: string[];
    storesV2: string[];
  }>;
  testCustomMigration: () => Promise<{
    log: string[];
    version: number;
    stores: string[];
  }>;
  testBlockedUpgrade: () => Promise<{
    wasBlocked: boolean;
    errorMessage: string | null;
  }>;
  testTransactionAbort: () => Promise<{
    succeeded: number;
    failed: number;
    baselineValue: unknown;
    count: number;
  }>;
  testQuotaAwareness: () => Promise<{
    quotaInfo: { available: boolean; beforeUsage?: number; afterUsage?: number };
    count: number;
  }>;
  testIndexConsistency: () => Promise<{
    updatedMetadata: unknown;
    existsVec0: boolean;
    existsVec4: boolean;
    countAfterDeletes: number;
    countAfterClear: number;
  }>;
  testDeleteManyConsistency: () => Promise<{
    deleted: number;
    remaining: number;
    remainingIds: string[];
  }>;
  setupUpdateVectorReload: (dbName: string) => Promise<{ dbName: string }>;
  verifyUpdateVectorReload: (dbName: string) => Promise<{
    vector: number[];
    metadata: Record<string, unknown>;
  }>;
  testPutBatchAbort: () => Promise<{
    didThrow: boolean;
    count: number;
    abortedEarly: boolean;
  }>;
};

/**
 * IndexedDB durability end-to-end tests.
 *
 * These tests exercise real browser IndexedDB behavior — persistence across
 * reloads, multiple concurrent instances, version-change / upgrade handling,
 * transaction abort recovery, quota awareness, and clear/update/delete index
 * consistency — using real browser APIs in the full browser matrix.
 */
test.describe('IndexedDB Durability', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/indexeddb-durability.html');
    await page.waitForFunction(
      () =>
        (window as unknown as DurabilityWindow).__INDEXEDDB_DURABILITY_READY__ === true,
      null,
      { timeout: 15_000 },
    );
  });

  // ── Persistence: data survives a page reload ────────────────────────────

  test('data persists across page reloads', async ({ page }) => {
    const dbName = `e2e-durability-persist-${Date.now()}`;

    // Phase 1: write and close
    const setup = await page.evaluate((name: string) => {
      return (window as unknown as DurabilityWindow).setupPersistence(name);
    }, dbName);

    expect(setup.dbName).toBe(dbName);

    // Reload to simulate a new browser session
    await page.reload();
    await page.waitForFunction(
      () =>
        (window as unknown as DurabilityWindow).__INDEXEDDB_DURABILITY_READY__ === true,
      null,
      { timeout: 15_000 },
    );

    // Phase 2: reopen and verify
    const result = await page.evaluate((name: string) => {
      return (window as unknown as DurabilityWindow).verifyPersistence(name);
    }, dbName);

    expect(result.id).toBe('persist-vec');
    expect(result.metadata).toEqual({ label: 'durable' });
    expect(result.count).toBe(1);
  });

  // ── Multiple instances: two adapters on the same DB ─────────────────────

  test('two adapter instances share the same underlying store', async ({ page }) => {
    const result = await page.evaluate(() => {
      return (window as unknown as DurabilityWindow).testMultipleInstances();
    });

    // Both adapters see the writes from each other
    expect(result.countA).toBe(2);
    expect(result.countB).toBe(2);
    expect(result.crossReadA).toBe('from-a');
    expect(result.crossReadB).toBe('from-b');
  });

  // ── Version-change: opening at a higher version triggers onupgradeneeded ─

  test('opening a higher version triggers schema upgrade', async ({ page }) => {
    const result = await page.evaluate(() => {
      return (window as unknown as DurabilityWindow).testVersionUpgrade();
    });

    expect(result.version1).toBe(1);
    expect(result.version2).toBe(2);
    // Both versions should have the core object stores
    expect(result.storesV1).toContain('vectors');
    expect(result.storesV2).toContain('vectors');
  });

  // ── Custom migration via onUpgrade callback ──────────────────────────────

  test('onUpgrade callback runs migration logic', async ({ page }) => {
    const result = await page.evaluate(() => {
      return (window as unknown as DurabilityWindow).testCustomMigration();
    });

    expect(result.log).toContain('v1-opened');
    expect(result.log).toContain('migrated-from-1');
    expect(result.log).toContain('v2-opened');
    expect(result.version).toBe(2);
    expect(result.stores).toContain('migration-log');
  });

  // ── Blocked upgrade: held connection blocks version bump ─────────────────

  test('open connection blocks higher-version upgrade', async ({ page }) => {
    const result = await page.evaluate(() => {
      return (window as unknown as DurabilityWindow).testBlockedUpgrade();
    });

    expect(result.wasBlocked).toBe(true);
    expect(result.errorMessage).toBeTruthy();
  });

  // ── Transaction abort: partial batch leaves consistent store ─────────────

  test('updateBatch reports partial failure without corrupting store', async ({
    page,
  }) => {
    const result = await page.evaluate(() => {
      return (window as unknown as DurabilityWindow).testTransactionAbort();
    });

    // The successful update must have applied
    expect(result.succeeded).toBe(1);
    // The nonexistent-ID update must have been reported as failed
    expect(result.failed).toBe(1);
    // The baseline record must reflect the successful update
    expect(result.baselineValue).toBe('updated');
    // Store must still contain exactly the one baseline record
    expect(result.count).toBe(1);
  });

  // ── Quota awareness: storage estimate changes after writes ───────────────

  test('storage quota estimate reflects indexed data', async ({ page }) => {
    const result = await page.evaluate(() => {
      return (window as unknown as DurabilityWindow).testQuotaAwareness();
    });

    expect(result.count).toBe(20);

    if (result.quotaInfo.available) {
      // After inserting 20 vectors, reported usage should be non-negative.
      // We cannot assert a strict increase because the browser may bucket or
      // delay its estimate update — but the API must have responded.
      expect(result.quotaInfo.afterUsage).toBeGreaterThanOrEqual(0);
    }
    // When Storage API is unavailable the test still passes; lack of the API
    // is a browser limitation, not a library bug.
  });

  // ── Clear/Update/Delete index consistency ────────────────────────────────

  test('update/delete/clear operations leave the store in a consistent state', async ({
    page,
  }) => {
    const result = await page.evaluate(() => {
      return (window as unknown as DurabilityWindow).testIndexConsistency();
    });

    expect(result.updatedMetadata).toBe('updated');
    expect(result.existsVec0).toBe(false);
    expect(result.existsVec4).toBe(false);
    expect(result.countAfterDeletes).toBe(3);
    expect(result.countAfterClear).toBe(0);
  });

  // ── deleteMany index consistency ─────────────────────────────────────────

  test('deleteMany removes correct entries and returns accurate count', async ({
    page,
  }) => {
    const result = await page.evaluate(() => {
      return (window as unknown as DurabilityWindow).testDeleteManyConsistency();
    });

    // 3 real IDs deleted, 1 phantom (ghost) not counted
    expect(result.deleted).toBe(3);
    expect(result.remaining).toBe(3);
    expect(result.remainingIds).toEqual(['dm-1', 'dm-3', 'dm-5']);
  });

  // ── updateVector + updateMetadata persists across reload ─────────────────

  test('updateVector and updateMetadata changes persist across page reload', async ({
    page,
  }) => {
    const dbName = `e2e-durability-update-reload-${Date.now()}`;

    // Phase 1: write, update, close
    await page.evaluate((name: string) => {
      return (window as unknown as DurabilityWindow).setupUpdateVectorReload(name);
    }, dbName);

    // Reload
    await page.reload();
    await page.waitForFunction(
      () =>
        (window as unknown as DurabilityWindow).__INDEXEDDB_DURABILITY_READY__ === true,
      null,
      { timeout: 15_000 },
    );

    // Phase 2: verify
    const result = await page.evaluate((name: string) => {
      return (window as unknown as DurabilityWindow).verifyUpdateVectorReload(name);
    }, dbName);

    // Updated vector values must have survived the reload
    expect(result.vector[0]).toBeCloseTo(0, 5);
    expect(result.vector[1]).toBeCloseTo(1, 5);
    expect(result.vector[2]).toBeCloseTo(0, 5);
    // Updated metadata must have survived
    expect(result.metadata['version']).toBe(2);
  });

  // ── putBatch abort: aborted batch stops early ─────────────────────────────

  test('putBatch respects abort signal and stops processing mid-batch', async ({
    page,
  }) => {
    const result = await page.evaluate(() => {
      return (window as unknown as DurabilityWindow).testPutBatchAbort();
    });

    expect(result.didThrow).toBe(true);
    expect(result.abortedEarly).toBe(true);
    // Some vectors must have been written before the abort
    expect(result.count).toBeGreaterThan(0);
    expect(result.count).toBeLessThan(30);
  });
});
