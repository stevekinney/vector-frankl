import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for package-consumer browser tests.
 *
 * These tests verify that the published tarball installs correctly, that
 * documented entry-points import without errors outside the source tree,
 * and that the documented database workflows (create, write, search,
 * update, clear, close, reload) all succeed when the package is consumed
 * exactly as an end-user would consume it.
 *
 * The webServer command builds the package, packs a tarball, installs it
 * into a temporary consumer directory, bundles the consumer app, and
 * starts a static server before Playwright launches the browser.
 */
export default defineConfig({
  testDir: './tests/end-to-end',
  testMatch: 'package-consumer.e2e.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:8202',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            '--enable-features=SharedArrayBuffer',
            '--cross-origin-embedder-policy=require-corp',
            '--cross-origin-opener-policy=same-origin',
          ],
        },
      },
    },
  ],

  webServer: {
    command: 'bun run scripts/serve-package-consumer.ts',
    port: 8202,
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 120_000,
  },
});
