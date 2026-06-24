import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/end-to-end',
  testMatch: '*.e2e.ts',
  // package-consumer.e2e.ts runs against its own server/page on port 8202
  // (playwright.config.package-consumer.ts). Excluding it here keeps the
  // default config — which serves the E2E harness page on 8201 — from
  // running it against the wrong origin.
  testIgnore: 'package-consumer.e2e.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:8201',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Enable cross-origin isolation for SharedArrayBuffer support
        launchOptions: {
          args: [
            '--enable-features=SharedArrayBuffer',
            '--cross-origin-embedder-policy=require-corp',
            '--cross-origin-opener-policy=same-origin',
          ],
        },
      },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'mobile-safari',
      use: { ...devices['iPhone 12'] },
    },
  ],

  webServer: {
    command:
      'bun run tests/end-to-end/build-for-browser.ts && bun run tests/end-to-end/server.ts',
    port: 8201,
    reuseExistingServer: false,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
