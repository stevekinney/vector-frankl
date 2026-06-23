import { expect, test } from '@playwright/test';

/**
 * Package-consumer browser tests.
 *
 * These tests verify that the published tarball installs and runs correctly
 * in a real browser when the package is consumed outside the source tree.
 * The server (`scripts/serve-package-consumer.ts`) handles packing the
 * tarball, installing it into a temporary consumer project, bundling the
 * consumer app, and serving it before Playwright starts.
 *
 * Every test exercises a documented database workflow via the consumer app
 * that imports exclusively from the installed `vector-frankl` package name.
 */

test.describe('Package Consumer Browser Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('consumer app loads without import errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Give dynamic imports a moment to resolve
    await page.waitForTimeout(500);

    expect(errors.filter((e) => /Cannot find module|Failed to resolve|SyntaxError/.test(e))).toEqual([]);

    // The page title confirms the consumer bundle loaded
    await expect(page).toHaveTitle('Vector Frankl Package Consumer Test');
  });

  test('initializes database from installed package', async ({ page }) => {
    page.on('pageerror', (err) => {
      throw new Error(`Browser error: ${err.message}`);
    });

    await page.click('button:has-text("Initialize")');

    await expect(page.locator('#db-status')).toContainText('Initialized', {
      timeout: 15_000,
    });
    await expect(page.locator('#db-status')).toHaveClass(/success/);

    await expect(
      page.locator('.result[data-test-name="Database Initialization"]'),
    ).toContainText('success', { ignoreCase: true });
  });

  test('full workflow: write, search, update, clear, close', async ({ page }) => {
    // Initialize first
    await page.click('button:has-text("Initialize")');
    await expect(page.locator('#db-status')).toContainText('Initialized', {
      timeout: 15_000,
    });

    // Run the full workflow
    await page.click('button:has-text("Run Full Workflow")');

    // Wait for all workflow steps to appear as results
    await expect(
      page.locator('.result[data-test-name="Write Vectors"]'),
    ).toContainText('success', { ignoreCase: true, timeout: 15_000 });

    await expect(
      page.locator('.result[data-test-name="Search"]'),
    ).toContainText('success', { ignoreCase: true });

    await expect(
      page.locator('.result[data-test-name="Update Metadata"]'),
    ).toContainText('success', { ignoreCase: true });

    await expect(
      page.locator('.result[data-test-name="Clear"]'),
    ).toContainText('success', { ignoreCase: true });

    await expect(
      page.locator('.result[data-test-name="Close"]'),
    ).toContainText('success', { ignoreCase: true });

    // Confirm no error results exist in the container
    const errorResults = await page.locator('.result.error').count();
    expect(errorResults).toBe(0);
  });

  test('reload persistence: data survives close and re-open', async ({ page }) => {
    // Initialize first (so the consumer module is loaded)
    await page.click('button:has-text("Initialize")');
    await expect(page.locator('#db-status')).toContainText('Initialized', {
      timeout: 15_000,
    });

    await page.click('button:has-text("Test Reload Persistence")');

    await expect(
      page.locator('.result[data-test-name="Reload Persistence"]'),
    ).toContainText('success', { ignoreCase: true, timeout: 15_000 });
  });

  test('VectorFrankl namespace API resolves from installed package', async ({ page }) => {
    // Confirm the VectorFrankl class (namespace API) also imports cleanly.
    // The Initialize button constructs both VectorDB and VectorFrankl.
    await page.click('button:has-text("Initialize")');
    await expect(page.locator('#db-status')).toContainText('Initialized', {
      timeout: 15_000,
    });

    const vfType = await page.evaluate(() => typeof (window as unknown as Record<string, unknown>)['vf']);
    expect(vfType).toBe('object');
  });
});
