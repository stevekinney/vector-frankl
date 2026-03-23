import { expect, test } from '@playwright/test';

interface SuiteResult {
  passed: number;
  failed: number;
  failures: Array<{ test: string; error: string }>;
}

test.describe('Storage Adapters E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/storage-adapters.html');
    await page.waitForFunction(
      () => (window as any).__STORAGE_ADAPTERS_READY__ === true,
      null,
      {
        timeout: 10_000,
      },
    );
  });

  // ── MemoryStorageAdapter (baseline sanity check) ────────────────────

  test.describe('MemoryStorageAdapter', () => {
    test('runs full behavioral suite', async ({ page }) => {
      const result: SuiteResult = await page.evaluate(() => {
        return (window as any).runAdapterTests('memory');
      });

      if (result.failures.length > 0) {
        console.log(
          'MemoryStorageAdapter failures:',
          JSON.stringify(result.failures, null, 2),
        );
      }

      expect(result.failed).toBe(0);
      expect(result.passed).toBeGreaterThan(0);
    });
  });

  // ── IndexedDatabaseStorageAdapter ───────────────────────────────────

  test.describe('IndexedDatabaseStorageAdapter', () => {
    test('runs full behavioral suite', async ({ page }) => {
      const result: SuiteResult = await page.evaluate(() => {
        return (window as any).runAdapterTests('indexeddb');
      });

      if (result.failures.length > 0) {
        console.log(
          'IndexedDatabaseStorageAdapter failures:',
          JSON.stringify(result.failures, null, 2),
        );
      }

      expect(result.failed).toBe(0);
      expect(result.passed).toBeGreaterThan(0);
    });

    test('data persists across page reloads', async ({ page }) => {
      // Store data and close the adapter
      const setup = await page.evaluate(() => {
        return (window as any).setupIndexedDBPersistence();
      });

      expect(setup.count).toBe(2);

      // Reload the page to simulate a new session
      await page.reload();
      await page.waitForFunction(
        () => (window as any).__STORAGE_ADAPTERS_READY__ === true,
        null,
        { timeout: 10_000 },
      );

      // Verify data survived the reload
      const verification = await page.evaluate((dbName: string) => {
        return (window as any).verifyIndexedDBPersistence(dbName);
      }, setup.dbName);

      expect(verification.count).toBe(2);
      expect(verification.vec1Id).toBe('persist-1');
      expect(verification.vec1Metadata).toEqual({ saved: true });
      expect(verification.vec2Id).toBe('persist-2');
      expect(verification.vec2Metadata).toEqual({ saved: true });
    });

    test('concurrent read/write operations', async ({ page }) => {
      const result = await page.evaluate(() => {
        return (window as any).testIndexedDBConcurrency();
      });

      expect(result.count).toBe(20);
      expect(result.allCount).toBe(20);
    });
  });

  // ── OPFSStorageAdapter ──────────────────────────────────────────────

  test.describe('OPFSStorageAdapter', () => {
    test.beforeEach(async ({ page }) => {
      // Check if OPFS is available in this browser
      const hasOPFS = await page.evaluate(() => {
        return typeof navigator !== 'undefined' && !!navigator.storage?.getDirectory;
      });

      if (!hasOPFS) {
        test.skip();
      }
    });

    test('runs full behavioral suite', async ({ page }) => {
      const result: SuiteResult = await page.evaluate(() => {
        return (window as any).runAdapterTests('opfs');
      });

      if (result.failures.length > 0) {
        console.log(
          'OPFSStorageAdapter failures:',
          JSON.stringify(result.failures, null, 2),
        );
      }

      expect(result.failed).toBe(0);
      expect(result.passed).toBeGreaterThan(0);
    });

    test('binary format round-trip preserves Float32Array precision', async ({
      page,
    }) => {
      const result = await page.evaluate(() => {
        return (window as any).testOPFSBinaryFormat();
      });

      expect(result.isFloat32Array).toBe(true);
      expect(result.length).toBe(5);
      expect(result.metadataFormat).toBe('binary');

      // Verify values match what Float32Array would produce (single-precision)
      for (let i = 0; i < result.values.length; i++) {
        expect(result.values[i]).toBeCloseTo(result.originalValues[i], 5);
      }
    });

    test('destroy() removes directory from OPFS', async ({ page }) => {
      const result = await page.evaluate(() => {
        return (window as any).testOPFSDestroy();
      });

      expect(result.directoryExists).toBe(false);
    });
  });
});
