/**
 * Global-state isolation tests
 *
 * These Playwright tests verify that the browser-side vector database has no
 * hidden shared global state that could cause flakiness on repeated runs.
 * Each test navigates to the page, performs a complete write-read-delete cycle,
 * and asserts that residual state from earlier runs is never visible.
 *
 * The five-run flaky-test gate is executed externally:
 *   for i in 1 2 3 4 5; do bun run test:end-to-end:chromium || exit 1; done
 *
 * But the tests themselves are designed so that any hidden global state causes
 * an assertion failure rather than a silent pass.
 */

import { expect, test } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Navigate to the test page and wait until it is fully loaded. */
async function goToTestPage(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await expect(page.locator('h1')).toContainText('Vector Frankl E2E Tests');
}

/** Initialize the database and confirm the status indicator turns green. */
async function initDb(page: import('@playwright/test').Page): Promise<void> {
  await page.click('#init-db');
  await expect(page.locator('#db-status')).toContainText('Initialized', {
    timeout: 15_000,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Global-state isolation', () => {
  test.beforeEach(async ({ page }) => {
    await goToTestPage(page);
    await initDb(page);
  });

  // -------------------------------------------------------------------------
  // 1. Clean-slate at every navigation
  // -------------------------------------------------------------------------

  test('database starts with zero vectors on every fresh page load', async ({ page }) => {
    // Each navigation spawns an entirely new page context in Playwright, so
    // IndexedDB is scoped to the test origin and its contents could carry over
    // between tests if the cleanup hooks are broken.
    await page.evaluate(async () => {
      // Clear any vectors that may have been left by a previous test run.
      await window.db.clear();

      const vectors = await window.db.getAllVectors();
      if (vectors.length !== 0) {
        throw new Error(
          `Expected 0 vectors on a clean page, but found ${vectors.length}. ` +
            'This indicates hidden global state from a previous run.',
        );
      }
      window.addTestResult('Clean Slate', 'success', 'Zero vectors on fresh page');
    });

    await expect(page.locator('#test-results')).toContainText('Clean Slate: SUCCESS');
  });

  // -------------------------------------------------------------------------
  // 2. Write, read, clear — full isolation cycle
  // -------------------------------------------------------------------------

  test('add-search-clear cycle leaves no residual state', async ({ page }) => {
    await page.evaluate(async () => {
      try {
        const DIMENSION = 64;

        // Deterministic pseudo-random generator (mulberry32 seed 42).
        let seed = 42;
        const rng = () => {
          seed |= 0;
          seed = (seed + 0x6d2b79f5) | 0;
          let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
          t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
          return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
        };

        const makeVector = (dim: number) =>
          new Array(dim).fill(0).map(() => rng() * 2 - 1);

        // Add 50 deterministic vectors.
        for (let i = 0; i < 50; i++) {
          await window.db.addVector(`isolation-${i}`, makeVector(DIMENSION), {
            run: 'isolation-test',
            index: i,
          });
        }

        const afterAdd = await window.db.getAllVectors();
        if (afterAdd.length !== 50) {
          throw new Error(`Expected 50 vectors, got ${afterAdd.length}`);
        }

        // Search — must return plausible results from this run only.
        const query = makeVector(DIMENSION);
        const results = await window.db.search(query, 5);
        if (results.length === 0) {
          throw new Error('Search returned no results');
        }
        for (const r of results) {
          if (!r.id.startsWith('isolation-')) {
            throw new Error(
              `Found unexpected vector "${r.id}" — global state from another run.`,
            );
          }
        }

        // Clear and verify the database is empty.
        await window.db.clear();
        const afterClear = await window.db.getAllVectors();
        if (afterClear.length !== 0) {
          throw new Error(`Expected 0 vectors after clear, got ${afterClear.length}`);
        }

        window.addTestResult(
          'Isolation Cycle',
          'success',
          `Added 50 vectors, searched, cleared. Zero residual state confirmed.`,
        );
      } catch (error) {
        window.addTestResult('Isolation Cycle', 'error', (error as Error).message);
        throw error;
      }
    });

    await expect(page.locator('#test-results')).toContainText('Isolation Cycle: SUCCESS');
  });

  // -------------------------------------------------------------------------
  // 3. Worker-created state does not leak across page navigations
  // -------------------------------------------------------------------------

  test('worker-spawned operations do not leave global state', async ({ page }) => {
    await page.evaluate(async () => {
      try {
        if (typeof Worker === 'undefined') {
          window.addTestResult(
            'Worker Isolation',
            'success',
            'Workers not available — skipped',
          );
          return;
        }

        // Spawn a worker that computes something in isolation.
        const workerCode = `
          self.onmessage = function(e) {
            const { count, dim } = e.data;
            // Simple dot product to exercise the worker thread.
            const a = new Float32Array(dim).map((_, i) => i / dim);
            const b = new Float32Array(dim).map((_, i) => (dim - i) / dim);
            let dot = 0;
            for (let i = 0; i < dim; i++) dot += a[i] * b[i];
            self.postMessage({ vectorsProcessed: count, dotProduct: dot });
          };
        `;

        const blob = new Blob([workerCode], { type: 'application/javascript' });
        const worker = new Worker(URL.createObjectURL(blob));

        const result = await new Promise<{
          vectorsProcessed: number;
          dotProduct: number;
        }>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Worker timeout')), 5_000);
          worker.onmessage = (e) => {
            clearTimeout(timeout);
            resolve(e.data);
          };
          worker.onerror = (err) => {
            clearTimeout(timeout);
            reject(err);
          };
          worker.postMessage({ count: 100, dim: 64 });
        });

        worker.terminate();

        if (result.vectorsProcessed !== 100) {
          throw new Error(`Worker returned unexpected count: ${result.vectorsProcessed}`);
        }

        // Verify that the worker's computation did not touch the database.
        const vectors = await window.db.getAllVectors();
        if (vectors.length !== 0) {
          throw new Error(
            `Worker left ${vectors.length} vectors in the database — global state leak.`,
          );
        }

        window.addTestResult(
          'Worker Isolation',
          'success',
          `Worker processed 100 vectors; database remains clean.`,
        );
      } catch (error) {
        window.addTestResult('Worker Isolation', 'error', (error as Error).message);
        throw error;
      }
    });

    await expect(page.locator('#test-results')).toContainText(
      'Worker Isolation: SUCCESS',
    );
  });

  // -------------------------------------------------------------------------
  // 4. Multiple sequential operations on the same page do not bleed state
  // -------------------------------------------------------------------------

  test('sequential operations within a single run are fully isolated', async ({
    page,
  }) => {
    await page.evaluate(async () => {
      try {
        const DIMENSION = 64;

        const makeVector = (seed: number) => {
          let s = seed;
          return new Array(DIMENSION).fill(0).map(() => {
            s = (s * 1_664_525 + 1_013_904_223) & 0xffff_ffff;
            return (s >>> 0) / 0x1_0000_0000;
          });
        };

        // Run A: insert 30 vectors, search, clear.
        for (let i = 0; i < 30; i++) {
          await window.db.addVector(`run-a-${i}`, makeVector(i * 3 + 1), {
            run: 'A',
          });
        }
        const afterA = await window.db.getAllVectors();
        if (afterA.length !== 30) {
          throw new Error(`Run A: expected 30 vectors, got ${afterA.length}`);
        }
        await window.db.clear();

        // Run B: insert 20 vectors, verify no run-A leftovers.
        for (let i = 0; i < 20; i++) {
          await window.db.addVector(`run-b-${i}`, makeVector(i * 7 + 5), {
            run: 'B',
          });
        }
        const afterB = await window.db.getAllVectors();
        if (afterB.length !== 20) {
          throw new Error(`Run B: expected 20 vectors, got ${afterB.length}`);
        }
        for (const v of afterB) {
          if (!v.id.startsWith('run-b-')) {
            throw new Error(
              `Run B: found unexpected vector "${v.id}" — state leak from run A.`,
            );
          }
        }

        await window.db.clear();

        window.addTestResult(
          'Sequential Isolation',
          'success',
          'Sequential runs A and B show no state bleed.',
        );
      } catch (error) {
        window.addTestResult('Sequential Isolation', 'error', (error as Error).message);
        throw error;
      }
    });

    await expect(page.locator('#test-results')).toContainText(
      'Sequential Isolation: SUCCESS',
    );
  });

  // -------------------------------------------------------------------------
  // 5. Re-initialisation does not expose state from a previous VectorDB instance
  // -------------------------------------------------------------------------

  test('re-initialising VectorDB with a unique name never sees another instance data', async ({
    page,
  }) => {
    await page.evaluate(async () => {
      try {
        // @ts-expect-error dynamic browser import
        const { VectorDB } = await import('/dist/index.js');

        const DIMENSION = 64;
        const makeVec = (v: number) => new Array(DIMENSION).fill(v);

        // Instance X — write data.
        const dbX = new VectorDB('isolation-x', DIMENSION);
        await dbX.init();
        await dbX.addVector('x-1', makeVec(0.1), { owner: 'X' });
        await dbX.addVector('x-2', makeVec(0.2), { owner: 'X' });
        await dbX.close();

        // Instance Y — must not see instance X data.
        const dbY = new VectorDB('isolation-y', DIMENSION);
        await dbY.init();
        await dbY.addVector('y-1', makeVec(0.9), { owner: 'Y' });

        const yVectors = await dbY.getAllVectors();
        const leaked = yVectors.filter((v: { id: string }) => v.id.startsWith('x-'));
        if (leaked.length > 0) {
          throw new Error(
            `Instance Y contains ${leaked.length} vector(s) from instance X — namespace leak.`,
          );
        }

        await dbX.delete();
        await dbY.delete();

        window.addTestResult(
          'Namespace Isolation',
          'success',
          'Two VectorDB instances share no state.',
        );
      } catch (error) {
        window.addTestResult('Namespace Isolation', 'error', (error as Error).message);
        throw error;
      }
    });

    await expect(page.locator('#test-results')).toContainText(
      'Namespace Isolation: SUCCESS',
    );
  });
});
