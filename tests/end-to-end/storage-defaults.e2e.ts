import { expect, test } from '@playwright/test';

/**
 * End-to-end tests for storage default behavior.
 *
 * These tests verify that:
 *   - isIndexedDBAvailable() returns true in a supported browser.
 *   - resolveStorageAdapter() defaults to IndexedDB rather than memory.
 *   - Browser paths do not silently fall back to memory for durable storage.
 *   - VectorDB default construction uses IndexedDB-backed storage.
 */
test.describe('storage defaults', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/storage-defaults.html');
    await page.waitForFunction(
      () => (window as any).__STORAGE_DEFAULTS_READY__ === true,
      null,
      { timeout: 10_000 },
    );
  });

  test('isIndexedDBAvailable returns true in a browser environment', async ({ page }) => {
    const result: { available: boolean; isBoolean: boolean } = await page.evaluate(() =>
      (window as any).testIsIndexedDBAvailable(),
    );

    expect(result.isBoolean).toBe(true);
    expect(result.available).toBe(true);
  });

  test('resolveStorageAdapter default backend yields IndexedDB adapter', async ({
    page,
  }) => {
    const result: { isIndexedDB: boolean; isMemory: boolean } = await page.evaluate(() =>
      (window as any).testResolveDefaultIsIndexedDB(),
    );

    expect(result.isIndexedDB).toBe(true);
    expect(result.isMemory).toBe(false);
  });

  test('resolveStorageAdapter explicit indexeddb backend yields IndexedDB adapter', async ({
    page,
  }) => {
    const result: { isIndexedDB: boolean } = await page.evaluate(() =>
      (window as any).testResolveExplicitIndexedDB(),
    );

    expect(result.isIndexedDB).toBe(true);
  });

  test('resolveStorageAdapter explicit memory backend yields MemoryStorageAdapter', async ({
    page,
  }) => {
    const result: { isMemory: boolean; isIndexedDB: boolean } = await page.evaluate(() =>
      (window as any).testResolveExplicitMemory(),
    );

    expect(result.isMemory).toBe(true);
    expect(result.isIndexedDB).toBe(false);
  });

  test('default IndexedDB adapter initializes and persists data', async ({ page }) => {
    const result: { isIndexedDB: boolean; count: number; wroteAndRead: boolean } =
      await page.evaluate(() => (window as any).testDefaultAdapterIsDurable());

    expect(result.isIndexedDB).toBe(true);
    expect(result.count).toBe(1);
    expect(result.wroteAndRead).toBe(true);
  });

  test('VectorDB default construction uses IndexedDB-backed storage', async ({
    page,
  }) => {
    const result: { vectorCount: number; initialized: boolean } = await page.evaluate(
      () => (window as any).testVectorDBDefaultIsIndexedDB(),
    );

    expect(result.initialized).toBe(true);
    expect(result.vectorCount).toBe(1);
  });
});
