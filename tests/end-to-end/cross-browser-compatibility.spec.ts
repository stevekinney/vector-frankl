import { expect, test } from '@playwright/test';

test.describe('Cross-Browser Compatibility Tests', () => {
  test('should work across all browsers', async ({ page, browserName }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.evaluate((browser) => {
      window.log(`Testing in browser: ${browser}`);
    }, browserName);

    // Test database initialization
    await page.click('#init-db');
    await expect(page.locator('#db-status')).toContainText('Initialized', {
      timeout: 15000,
    });

    // Test basic operations
    await page.evaluate(async (browser) => {
      try {
        // Add a test vector
        const testVector = new Array(384).fill(0).map(() => Math.random());
        await window.db.addVector('cross_browser_test', testVector, {
          browser: navigator.userAgent,
          timestamp: Date.now(),
        });

        // Retrieve and verify
        const retrieved = await window.db.getVector('cross_browser_test');
        if (!retrieved) {
          throw new Error('Failed to retrieve vector in this browser');
        }

        // Test search
        const results = await window.db.search(testVector, 1);
        if (results.length === 0) {
          throw new Error('Search failed in this browser');
        }

        window.addTestResult(
          `${browser} Compatibility`,
          'success',
          'Basic operations work correctly',
        );
      } catch (error) {
        window.addTestResult(`${browser} Compatibility`, 'error', error.message);
        throw error;
      }
    }, browserName);

    await expect(page.locator('#test-results')).toContainText('Compatibility: SUCCESS');
  });

  test('should detect browser capabilities correctly', async ({ page, browserName }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const capabilities = await page.evaluate(() => {
      return {
        browser: navigator.userAgent,
        indexedDB: !!window.indexedDB,
        webWorkers: typeof Worker !== 'undefined',
        webAssembly: typeof WebAssembly !== 'undefined',
        sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
        webGL: !!window.WebGLRenderingContext,
        webGL2: !!window.WebGL2RenderingContext,
        webGPU: !!navigator.gpu,
        cryptoAPI: !!window.crypto && !!window.crypto.subtle,
        performanceAPI: !!window.performance && !!window.performance.now,
        storageAPI: 'storage' in navigator && 'estimate' in navigator.storage,
        deviceMemory: navigator.deviceMemory || null,
        hardwareConcurrency: navigator.hardwareConcurrency || null,
        platform: navigator.platform,
        language: navigator.language,
        cookieEnabled: navigator.cookieEnabled,
        onLine: navigator.onLine,
      };
    });

    console.log(`${browserName} capabilities:`, capabilities);

    // Verify minimum required capabilities
    expect(capabilities.indexedDB).toBe(true);

    // Log browser-specific differences
    await page.evaluate(
      ({ caps, browser }) => {
        window.log(`${browser} capabilities:`);
        window.log(`- IndexedDB: ${caps.indexedDB}`);
        window.log(`- Web Workers: ${caps.webWorkers}`);
        window.log(`- WebAssembly: ${caps.webAssembly}`);
        window.log(`- SharedArrayBuffer: ${caps.sharedArrayBuffer}`);
        window.log(`- WebGL: ${caps.webGL}/${caps.webGL2}`);
        window.log(`- WebGPU: ${caps.webGPU}`);
        window.log(`- Hardware Concurrency: ${caps.hardwareConcurrency}`);

        const supportScore = [
          caps.indexedDB,
          caps.webWorkers,
          caps.webAssembly,
          caps.webGL,
          caps.cryptoAPI,
          caps.performanceAPI,
        ].filter(Boolean).length;

        window.addTestResult(
          `${browser} Feature Support`,
          'success',
          `${supportScore}/6 core features supported`,
        );
      },
      { caps: capabilities, browser: browserName },
    );

    await expect(page.locator('#test-results')).toContainText('Feature Support: SUCCESS');
  });

  test('should handle browser-specific storage limits', async ({ page, browserName }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.click('#init-db');
    await expect(page.locator('#db-status')).toContainText('Initialized', {
      timeout: 10000,
    });

    await page.evaluate(async (browser) => {
      try {
        // Test storage estimation API
        let storageInfo = null;
        if ('storage' in navigator && 'estimate' in navigator.storage) {
          storageInfo = await navigator.storage.estimate();
        }

        // Add vectors until we approach a reasonable limit
        const vectors = [];
        const maxVectors = browser.includes('webkit') ? 50 : 100; // Safari might have stricter limits

        for (let i = 0; i < maxVectors; i++) {
          const vector = new Array(384).fill(0).map(() => Math.random());
          await window.db.addVector(`storage_test_${i}`, vector, {
            index: i,
            browser: browser,
            largeMeta: 'x'.repeat(1000), // Add some bulk
          });
          vectors.push(`storage_test_${i}`);
        }

        window.log(`${browser}: Successfully stored ${vectors.length} vectors`);

        // Test retrieval performance with many vectors
        const retrievalStart = performance.now();
        const allVectors = await window.db.getAllVectors();
        const retrievalTime = performance.now() - retrievalStart;

        // Test search performance with many vectors
        const searchStart = performance.now();
        const searchResults = await window.db.search(new Array(384).fill(0.5), 5);
        const searchTime = performance.now() - searchStart;

        window.log(
          `${browser}: Retrieval: ${retrievalTime.toFixed(2)}ms, Search: ${searchTime.toFixed(2)}ms`,
        );

        // Browser-specific performance expectations
        const expectedSearchTime = browser.includes('webkit') ? 200 : 100; // Safari might be slower
        const performanceOk = searchTime < expectedSearchTime;

        window.addTestResult(
          `${browser} Storage Limits`,
          'success',
          `Stored ${vectors.length} vectors, search: ${searchTime.toFixed(2)}ms ${performanceOk ? '✓' : '⚠'}`,
        );
      } catch (error) {
        window.addTestResult(`${browser} Storage Limits`, 'error', error.message);
        throw error;
      }
    }, browserName);

    await expect(page.locator('#test-results')).toContainText('Storage Limits: SUCCESS');
  });

  test('should handle browser-specific API differences', async ({
    page,
    browserName,
  }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.evaluate(async (browser) => {
      try {
        const apiTests = {
          crypto: false,
          performance: false,
          indexedDB: false,
          workers: false,
          wasm: false,
        };

        // Test Crypto API
        try {
          if (window.crypto && window.crypto.subtle) {
            const data = new TextEncoder().encode('test');
            const hash = await window.crypto.subtle.digest('SHA-256', data);
            apiTests.crypto = hash.byteLength === 32;
            window.log(`${browser}: Crypto API working`);
          }
        } catch (error) {
          window.log(`${browser}: Crypto API failed: ${error.message}`);
        }

        // Test Performance API
        try {
          const start = performance.now();
          await new Promise((resolve) => setTimeout(resolve, 10));
          const elapsed = performance.now() - start;
          apiTests.performance = elapsed > 5 && elapsed < 50;
          window.log(`${browser}: Performance API working (${elapsed.toFixed(2)}ms)`);
        } catch (error) {
          window.log(`${browser}: Performance API failed: ${error.message}`);
        }

        // Test IndexedDB
        try {
          const request = indexedDB.open('api-test-db', 1);
          await new Promise((resolve, reject) => {
            request.onsuccess = resolve;
            request.onerror = reject;
            request.onupgradeneeded = () => {
              const db = request.result;
              if (!db.objectStoreNames.contains('test')) {
                db.createObjectStore('test', { keyPath: 'id' });
              }
            };
          });
          request.result.close();
          apiTests.indexedDB = true;
          window.log(`${browser}: IndexedDB API working`);
        } catch (error) {
          window.log(`${browser}: IndexedDB API failed: ${error.message}`);
        }

        // Test Web Workers
        try {
          if (typeof Worker !== 'undefined') {
            const workerCode = 'self.postMessage("hello");';
            const blob = new Blob([workerCode], { type: 'application/javascript' });
            const worker = new Worker(URL.createObjectURL(blob));

            const message = await new Promise((resolve, reject) => {
              const timeout = setTimeout(() => reject(new Error('Worker timeout')), 2000);
              worker.onmessage = (e) => {
                clearTimeout(timeout);
                resolve(e.data);
              };
              worker.onerror = (error) => {
                clearTimeout(timeout);
                reject(error);
              };
            });

            worker.terminate();
            apiTests.workers = message === 'hello';
            window.log(`${browser}: Web Workers API working`);
          }
        } catch (error) {
          window.log(`${browser}: Web Workers API failed: ${error.message}`);
        }

        // Test WebAssembly
        try {
          if (typeof WebAssembly !== 'undefined') {
            const wasmBytes = new Uint8Array([
              0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
            ]);
            await WebAssembly.instantiate(wasmBytes);
            apiTests.wasm = false; // This will fail, but at least WASM exists
          }
        } catch (error) {
          // Expected to fail with minimal WASM, but WASM is available
          if (typeof WebAssembly !== 'undefined') {
            apiTests.wasm = true;
            window.log(`${browser}: WebAssembly API available`);
          }
        }

        const workingAPIs = Object.values(apiTests).filter(Boolean).length;
        const totalAPIs = Object.keys(apiTests).length;

        window.log(`${browser}: ${workingAPIs}/${totalAPIs} APIs working`);
        window.addTestResult(
          `${browser} API Compatibility`,
          'success',
          `${workingAPIs}/${totalAPIs} APIs functional: ${Object.entries(apiTests)
            .filter(([, works]) => works)
            .map(([api]) => api)
            .join(', ')}`,
        );
      } catch (error) {
        window.addTestResult(`${browser} API Compatibility`, 'error', error.message);
        throw error;
      }
    }, browserName);

    await expect(page.locator('#test-results')).toContainText(
      'API Compatibility: SUCCESS',
    );
  });
});
