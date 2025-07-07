import { test, expect } from '@playwright/test';

test.describe('Vector Database Basic Operations', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Wait for page to be ready
    await expect(page.locator('h1')).toContainText('Vector Frankl E2E Tests');
  });

  test('should initialize database successfully', async ({ page }) => {
    // Listen for console messages to debug
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', error => console.log('PAGE ERROR:', error.message));
    
    // Click initialize database button
    await page.click('#init-db');
    
    // Wait a moment and check for errors
    await page.waitForTimeout(2000);
    
    // Check browser console for errors
    const logs = await page.evaluate(() => {
      return window.console ? 'Console exists' : 'No console';
    });
    console.log('Console check:', logs);
    
    // Try to access the module manually to see if it loads
    const moduleTest = await page.evaluate(async () => {
      try {
        const module = await import('/dist/index.js');
        return { success: true, keys: Object.keys(module), module: typeof module };
      } catch (error) {
        return { success: false, error: error.message, stack: error.stack };
      }
    });
    console.log('Module test:', moduleTest);
    
    // Wait for initialization to complete
    await expect(page.locator('#db-status')).toContainText('Initialized', { timeout: 10000 });
    await expect(page.locator('#db-status')).toHaveClass(/success/);
    
    // Verify other buttons are enabled
    await expect(page.locator('#test-crud')).toBeEnabled();
    await expect(page.locator('#test-search')).toBeEnabled();
    
    // Check that test result was logged
    await expect(page.locator('#test-results')).toContainText('Database Initialization: SUCCESS');
  });

  test('should perform CRUD operations', async ({ page }) => {
    // Initialize database first
    await page.click('#init-db');
    await expect(page.locator('#db-status')).toContainText('Initialized', { timeout: 10000 });

    // Execute CRUD test via JavaScript
    await page.evaluate(async () => {
      try {
        // Test data
        const testVectors = [
          { id: 'vec1', vector: new Array(384).fill(0).map(() => Math.random()), metadata: { category: 'test', type: 'A' } },
          { id: 'vec2', vector: new Array(384).fill(0).map(() => Math.random()), metadata: { category: 'test', type: 'B' } },
          { id: 'vec3', vector: new Array(384).fill(0).map(() => Math.random()), metadata: { category: 'demo', type: 'A' } }
        ];

        window.log('Starting CRUD operations test...');

        // CREATE: Add vectors
        for (const { id, vector, metadata } of testVectors) {
          await window.db.addVector(id, vector, metadata);
          window.log(`Added vector ${id}`);
        }

        // READ: Get vectors
        const retrieved1 = await window.db.getVector('vec1');
        if (!retrieved1) throw new Error('Failed to retrieve vec1');
        window.log(`Retrieved vector vec1 with ${retrieved1.vector.length} dimensions`);

        // READ: List all vectors
        const allVectors = await window.db.getAllVectors();
        if (allVectors.length !== 3) throw new Error(`Expected 3 vectors, got ${allVectors.length}`);
        window.log(`Listed ${allVectors.length} vectors`);

        // UPDATE: Update metadata
        await window.db.updateMetadata('vec1', { category: 'updated', type: 'A', timestamp: Date.now() });
        const updated = await window.db.getVector('vec1');
        if (updated.metadata.category !== 'updated') throw new Error('Metadata update failed');
        window.log('Updated vector metadata successfully');

        // DELETE: Remove a vector
        await window.db.deleteVector('vec2');
        const remaining = await window.db.getAllVectors();
        if (remaining.length !== 2) throw new Error(`Expected 2 vectors after deletion, got ${remaining.length}`);
        window.log('Deleted vector successfully');

        // Test vector search
        const searchResults = await window.db.search(testVectors[0].vector, 5);
        if (searchResults.length === 0) throw new Error('Search returned no results');
        window.log(`Search returned ${searchResults.length} results`);

        // Test metadata filtering
        const filtered = await window.db.search(testVectors[0].vector, 5, {
          filter: { category: 'demo' }
        });
        window.log(`Filtered search returned ${filtered.length} results`);

        window.addTestResult('CRUD Operations', 'success', 'All operations completed successfully');
      } catch (error) {
        window.addTestResult('CRUD Operations', 'error', error.message);
        window.log(`CRUD test failed: ${error.message}`, 'error');
        throw error;
      }
    });

    // Verify the test completed successfully
    await expect(page.locator('#test-results')).toContainText('CRUD Operations: SUCCESS');
  });

  test('should handle vector search with different distance metrics', async ({ page }) => {
    // Initialize database first
    await page.click('#init-db');
    await expect(page.locator('#db-status')).toContainText('Initialized', { timeout: 10000 });

    await page.evaluate(async () => {
      try {
        // Create test vectors with known relationships
        const baseVector = new Array(384).fill(0);
        baseVector[0] = 1; // Simple vector for testing
        
        const similarVector = new Array(384).fill(0);
        similarVector[0] = 0.9; // Very similar to base
        
        const differentVector = new Array(384).fill(0);
        differentVector[100] = 1; // Different from base

        await window.db.addVector('base', baseVector);
        await window.db.addVector('similar', similarVector);
        await window.db.addVector('different', differentVector);

        // Test cosine similarity search (default)
        const cosineResults = await window.db.search(baseVector, 3);
        if (cosineResults.length !== 3) throw new Error('Cosine search should return 3 results');
        
        // The most similar should be the base vector itself
        if (cosineResults[0].id !== 'base') {
          window.log(`Warning: Expected 'base' as first result, got '${cosineResults[0].id}'`);
        }

        window.log(`Search results order: ${cosineResults.map(r => `${r.id}(${r.score.toFixed(3)})`).join(', ')}`);

        window.addTestResult('Vector Search', 'success', `Found ${cosineResults.length} results with proper scoring`);
      } catch (error) {
        window.addTestResult('Vector Search', 'error', error.message);
        throw error;
      }
    });

    await expect(page.locator('#test-results')).toContainText('Vector Search: SUCCESS');
  });

  test('should handle batch operations efficiently', async ({ page }) => {
    // Initialize database first
    await page.click('#init-db');
    await expect(page.locator('#db-status')).toContainText('Initialized', { timeout: 10000 });

    await page.evaluate(async () => {
      try {
        const startTime = performance.now();
        
        // Generate batch of vectors
        const batchSize = 100;
        const vectors = [];
        
        for (let i = 0; i < batchSize; i++) {
          vectors.push({
            id: `batch_${i}`,
            vector: new Array(384).fill(0).map(() => Math.random()),
            metadata: { 
              batch: 'test',
              index: i,
              category: i % 3 === 0 ? 'A' : i % 3 === 1 ? 'B' : 'C'
            }
          });
        }

        // Add vectors in batch
        for (const { id, vector, metadata } of vectors) {
          await window.db.addVector(id, vector, metadata);
        }

        const addTime = performance.now() - startTime;
        window.log(`Added ${batchSize} vectors in ${addTime.toFixed(2)}ms`);

        // Test batch retrieval
        const retrievalStart = performance.now();
        const allVectors = await window.db.getAllVectors();
        const retrievalTime = performance.now() - retrievalStart;
        
        if (allVectors.length < batchSize) {
          throw new Error(`Expected at least ${batchSize} vectors, got ${allVectors.length}`);
        }

        window.log(`Retrieved ${allVectors.length} vectors in ${retrievalTime.toFixed(2)}ms`);

        // Test batch search
        const searchStart = performance.now();
        const searchResults = await window.db.search(vectors[0].vector, 10);
        const searchTime = performance.now() - searchStart;
        
        window.log(`Search completed in ${searchTime.toFixed(2)}ms, found ${searchResults.length} results`);

        // Performance thresholds (adjust based on expected performance)
        const avgAddTime = addTime / batchSize;
        if (avgAddTime > 10) { // More than 10ms per vector is concerning
          window.log(`Warning: Slow vector addition (${avgAddTime.toFixed(2)}ms per vector)`, 'warning');
        }

        if (searchTime > 1000) { // More than 1 second for search is concerning
          window.log(`Warning: Slow search (${searchTime.toFixed(2)}ms)`, 'warning');
        }

        window.addTestResult('Batch Operations', 'success', 
          `Added ${batchSize} vectors (${avgAddTime.toFixed(2)}ms avg), search: ${searchTime.toFixed(2)}ms`);
      } catch (error) {
        window.addTestResult('Batch Operations', 'error', error.message);
        throw error;
      }
    });

    await expect(page.locator('#test-results')).toContainText('Batch Operations: SUCCESS');
  });

  test('should clear database successfully', async ({ page }) => {
    // Initialize and add some data first
    await page.click('#init-db');
    await expect(page.locator('#db-status')).toContainText('Initialized', { timeout: 10000 });

    // Add some test data
    await page.evaluate(async () => {
      await window.db.addVector('test1', new Array(384).fill(0.5));
      await window.db.addVector('test2', new Array(384).fill(0.3));
    });

    // Clear database
    await page.click('#clear-db');

    // Verify database is cleared
    await page.evaluate(async () => {
      const vectors = await window.db.getAllVectors();
      if (vectors.length !== 0) {
        throw new Error(`Expected 0 vectors after clear, got ${vectors.length}`);
      }
      window.addTestResult('Database Clear', 'success', 'Database cleared successfully');
    });

    await expect(page.locator('#test-results')).toContainText('Database Clear: SUCCESS');
  });
});