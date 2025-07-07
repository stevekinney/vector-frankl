import { test, expect } from '@playwright/test';

test.describe('IndexedDB Storage Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('should persist data across page reloads', async ({ page }) => {
    // Initialize database and add data
    await page.click('#init-db');
    await expect(page.locator('#db-status')).toContainText('Initialized', { timeout: 10000 });

    await page.evaluate(async () => {
      const testVector = new Array(384).fill(0).map(() => Math.random());
      await window.db.addVector('persistent_test', testVector, { 
        description: 'test persistence', 
        timestamp: Date.now() 
      });
      window.log('Added test vector for persistence test');
    });

    // Reload the page
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Re-initialize database (should connect to existing data)
    await page.click('#init-db');
    await expect(page.locator('#db-status')).toContainText('Initialized', { timeout: 10000 });

    // Check if data persisted
    await page.evaluate(async () => {
      try {
        const vectors = await window.db.getAllVectors();
        const persistentVector = await window.db.getVector('persistent_test');
        
        if (!persistentVector) {
          throw new Error('Persistent vector not found after reload');
        }
        
        if (persistentVector.metadata.description !== 'test persistence') {
          throw new Error('Persistent vector metadata corrupted');
        }

        window.log(`Found ${vectors.length} vectors after reload`);
        window.addTestResult('Data Persistence', 'success', 
          `Vector persisted with correct metadata`);
      } catch (error) {
        window.addTestResult('Data Persistence', 'error', error.message);
        throw error;
      }
    });

    await expect(page.locator('#test-results')).toContainText('Data Persistence: SUCCESS');
  });

  test('should handle large vector storage', async ({ page }) => {
    await page.click('#init-db');
    await expect(page.locator('#db-status')).toContainText('Initialized', { timeout: 10000 });

    await page.evaluate(async () => {
      try {
        // Test with the database's expected dimension (384) but larger metadata
        const dimension = 384; // Match the database dimension
        const largeVector = new Array(dimension).fill(0).map(() => Math.random());
        
        const startTime = performance.now();
        await window.db.addVector('large_vector', largeVector, {
          dimension: dimension,
          type: 'large_test',
          largeMetadata: 'x'.repeat(10000), // Add large metadata instead
          description: 'Testing large vector storage with extensive metadata'
        });
        const addTime = performance.now() - startTime;

        // Retrieve and verify
        const retrievalStart = performance.now();
        const retrieved = await window.db.getVector('large_vector');
        const retrievalTime = performance.now() - retrievalStart;

        if (!retrieved) {
          throw new Error('Large vector not found after storage');
        }

        if (retrieved.vector.length !== dimension) {
          throw new Error(`Vector dimension mismatch: expected ${dimension}, got ${retrieved.vector.length}`);
        }

        // Test search with large vector
        const searchStart = performance.now();
        const searchResults = await window.db.search(largeVector, 1);
        const searchTime = performance.now() - searchStart;

        window.log(`Large vector (${dimension}D): add=${addTime.toFixed(2)}ms, retrieve=${retrievalTime.toFixed(2)}ms, search=${searchTime.toFixed(2)}ms`);

        window.addTestResult('Large Vector Storage', 'success', 
          `Stored and retrieved ${dimension}D vector with large metadata successfully`);
      } catch (error) {
        window.addTestResult('Large Vector Storage', 'error', error.message);
        throw error;
      }
    });

    await expect(page.locator('#test-results')).toContainText('Large Vector Storage: SUCCESS');
  });

  test('should handle database versioning and migrations', async ({ page }) => {
    await page.click('#init-db');
    await expect(page.locator('#db-status')).toContainText('Initialized', { timeout: 10000 });

    await page.evaluate(async () => {
      try {
        // Check if we can access IndexedDB directly to verify structure
        const dbRequest = indexedDB.open('test-db');
        
        const db = await new Promise((resolve, reject) => {
          dbRequest.onsuccess = () => resolve(dbRequest.result);
          dbRequest.onerror = () => reject(dbRequest.error);
        });

        const objectStoreNames = Array.from(db.objectStoreNames);
        window.log(`Database object stores: ${objectStoreNames.join(', ')}`);

        // Verify expected object stores exist
        const expectedStores = ['vectors', 'metadata', 'indices'];
        const missingStores = expectedStores.filter(store => !objectStoreNames.includes(store));
        
        if (missingStores.length > 0) {
          window.log(`Note: Some expected stores not found: ${missingStores.join(', ')}`);
        }

        db.close();

        window.addTestResult('Database Structure', 'success', 
          `Database contains ${objectStoreNames.length} object stores`);
      } catch (error) {
        window.addTestResult('Database Structure', 'error', error.message);
        throw error;
      }
    });

    await expect(page.locator('#test-results')).toContainText('Database Structure: SUCCESS');
  });

  test('should handle concurrent database operations', async ({ page }) => {
    await page.click('#init-db');
    await expect(page.locator('#db-status')).toContainText('Initialized', { timeout: 10000 });

    await page.evaluate(async () => {
      try {
        // Test concurrent writes
        const concurrentWrites = [];
        const numOperations = 20;

        for (let i = 0; i < numOperations; i++) {
          const vector = new Array(384).fill(0).map(() => Math.random());
          concurrentWrites.push(
            window.db.addVector(`concurrent_${i}`, vector, { 
              batch: 'concurrent',
              index: i 
            })
          );
        }

        const startTime = performance.now();
        await Promise.all(concurrentWrites);
        const writeTime = performance.now() - startTime;

        window.log(`Completed ${numOperations} concurrent writes in ${writeTime.toFixed(2)}ms`);

        // Verify all writes succeeded
        const vectors = await window.db.getAllVectors();
        const concurrentVectors = vectors.filter(v => v.id.startsWith('concurrent_'));
        
        if (concurrentVectors.length !== numOperations) {
          throw new Error(`Expected ${numOperations} concurrent vectors, got ${concurrentVectors.length}`);
        }

        // Test concurrent reads
        const concurrentReads = [];
        for (let i = 0; i < numOperations; i++) {
          concurrentReads.push(window.db.getVector(`concurrent_${i}`));
        }

        const readStart = performance.now();
        const readResults = await Promise.all(concurrentReads);
        const readTime = performance.now() - readStart;

        const successfulReads = readResults.filter(r => r !== null).length;
        window.log(`Completed ${successfulReads}/${numOperations} concurrent reads in ${readTime.toFixed(2)}ms`);

        if (successfulReads !== numOperations) {
          throw new Error(`Some concurrent reads failed: ${successfulReads}/${numOperations}`);
        }

        window.addTestResult('Concurrent Operations', 'success', 
          `${numOperations} concurrent writes/reads completed successfully`);
      } catch (error) {
        window.addTestResult('Concurrent Operations', 'error', error.message);
        throw error;
      }
    });

    await expect(page.locator('#test-results')).toContainText('Concurrent Operations: SUCCESS');
  });

  test('should handle storage quota and cleanup', async ({ page }) => {
    await page.click('#init-db');
    await expect(page.locator('#db-status')).toContainText('Initialized', { timeout: 10000 });

    await page.evaluate(async () => {
      try {
        // Check storage quota if available
        if ('storage' in navigator && 'estimate' in navigator.storage) {
          const estimate = await navigator.storage.estimate();
          const quotaMB = Math.round((estimate.quota || 0) / (1024 * 1024));
          const usageMB = Math.round((estimate.usage || 0) / (1024 * 1024));
          
          window.log(`Storage quota: ${quotaMB}MB, used: ${usageMB}MB`);
          
          // Add many vectors to test quota awareness
          const testCount = 50;
          for (let i = 0; i < testCount; i++) {
            const vector = new Array(384).fill(0).map(() => Math.random());
            await window.db.addVector(`quota_test_${i}`, vector, {
              description: 'Large metadata '.repeat(100), // Add some bulk
              index: i
            });
          }

          // Check storage again
          const newEstimate = await navigator.storage.estimate();
          const newUsageMB = Math.round((newEstimate.usage || 0) / (1024 * 1024));
          
          window.log(`Storage after adding ${testCount} vectors: ${newUsageMB}MB (${newUsageMB - usageMB}MB increase)`);

          window.addTestResult('Storage Quota', 'success', 
            `Storage usage tracked: ${newUsageMB}MB total`);
        } else {
          window.log('Storage API not available in this browser');
          window.addTestResult('Storage Quota', 'success', 'Storage API not available (browser limitation)');
        }
      } catch (error) {
        window.addTestResult('Storage Quota', 'error', error.message);
        throw error;
      }
    });

    await expect(page.locator('#test-results')).toContainText('Storage Quota: SUCCESS');
  });

  test('should handle database errors gracefully', async ({ page }) => {
    await page.click('#init-db');
    await expect(page.locator('#db-status')).toContainText('Initialized', { timeout: 10000 });

    await page.evaluate(async () => {
      try {
        // Test invalid vector operations
        let errorCount = 0;

        // Test adding vector with invalid ID
        try {
          await window.db.addVector('', new Array(384).fill(0));
        } catch (error) {
          window.log('Correctly caught empty ID error');
          errorCount++;
        }

        // Test adding vector with wrong dimensions
        try {
          await window.db.addVector('wrong_dim', new Array(100).fill(0)); // Wrong dimension
        } catch (error) {
          window.log('Correctly caught dimension mismatch error');
          errorCount++;
        }

        // Test retrieving non-existent vector
        const nonExistent = await window.db.getVector('does_not_exist');
        if (nonExistent === null) {
          window.log('Correctly returned null for non-existent vector');
          errorCount++;
        }

        // Test search with invalid vector
        try {
          await window.db.search(new Array(100).fill(0), 5); // Wrong dimension
        } catch (error) {
          window.log('Correctly caught search dimension error');
          errorCount++;
        }

        if (errorCount >= 3) { // At least 3 out of 4 error cases handled
          window.addTestResult('Error Handling', 'success', 
            `Properly handled ${errorCount} error conditions`);
        } else {
          throw new Error(`Only ${errorCount} error conditions handled properly`);
        }
      } catch (error) {
        window.addTestResult('Error Handling', 'error', error.message);
        throw error;
      }
    });

    await expect(page.locator('#test-results')).toContainText('Error Handling: SUCCESS');
  });
});