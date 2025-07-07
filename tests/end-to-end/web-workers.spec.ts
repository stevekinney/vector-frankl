import { expect, test } from '@playwright/test';

test.describe('Web Workers Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('should support web workers when available', async ({ page }) => {
    await page.click('#init-db');
    await expect(page.locator('#db-status')).toContainText('Initialized', {
      timeout: 10000,
    });

    await page.evaluate(async () => {
      try {
        // Check if Web Workers are supported
        const workersSupported = typeof Worker !== 'undefined';
        window.log(`Web Workers supported: ${workersSupported}`);

        if (!workersSupported) {
          window.addTestResult(
            'Web Workers Support',
            'success',
            'Web Workers not available in this environment',
          );
          return;
        }

        // Test basic worker functionality
        const workerCode = `
          self.onmessage = function(e) {
            const { vectors, queryVector } = e.data;
            
            // Simple dot product calculation in worker
            const results = vectors.map((vec, index) => {
              let dotProduct = 0;
              for (let i = 0; i < Math.min(vec.length, queryVector.length); i++) {
                dotProduct += vec[i] * queryVector[i];
              }
              return { index, score: dotProduct };
            });
            
            // Sort by score descending
            results.sort((a, b) => b.score - a.score);
            
            self.postMessage({ results });
          };
        `;

        const blob = new Blob([workerCode], { type: 'application/javascript' });
        const worker = new Worker(URL.createObjectURL(blob));

        // Test data
        const testVectors = [
          new Array(100).fill(0.5),
          new Array(100).fill(0.3),
          new Array(100).fill(0.8),
          new Array(100).fill(0.1),
        ];
        const queryVector = new Array(100).fill(0.6);

        // Send work to worker
        const workerResult = await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Worker timeout')), 5000);

          worker.onmessage = (e) => {
            clearTimeout(timeout);
            resolve(e.data);
          };

          worker.onerror = (error) => {
            clearTimeout(timeout);
            reject(error);
          };

          worker.postMessage({ vectors: testVectors, queryVector });
        });

        // Verify worker results
        if (!workerResult.results || workerResult.results.length !== testVectors.length) {
          throw new Error('Worker returned invalid results');
        }

        // Check that results are sorted by score
        for (let i = 1; i < workerResult.results.length; i++) {
          if (workerResult.results[i].score > workerResult.results[i - 1].score) {
            throw new Error('Worker results not properly sorted');
          }
        }

        worker.terminate();
        window.log('Worker computed similarity scores successfully');

        window.addTestResult(
          'Web Workers Support',
          'success',
          `Worker processed ${testVectors.length} vectors successfully`,
        );
      } catch (error) {
        window.addTestResult('Web Workers Support', 'error', error.message);
        throw error;
      }
    });

    await expect(page.locator('#test-results')).toContainText(
      'Web Workers Support: SUCCESS',
    );
  });

  test('should handle worker pool operations', async ({ page }) => {
    await page.click('#init-db');
    await expect(page.locator('#db-status')).toContainText('Initialized', {
      timeout: 10000,
    });

    await page.evaluate(async () => {
      try {
        if (typeof Worker === 'undefined') {
          window.addTestResult('Worker Pool', 'success', 'Web Workers not available');
          return;
        }

        // Simple worker pool implementation for testing
        class SimpleWorkerPool {
          constructor(size = 2) {
            this.workers = [];
            this.queue = [];
            this.busy = new Set();

            for (let i = 0; i < size; i++) {
              this.createWorker(i);
            }
          }

          createWorker(id) {
            const workerCode = `
              self.onmessage = function(e) {
                const { taskId, data } = e.data;
                
                // Simulate some computation
                const result = data.map(x => x * x).reduce((a, b) => a + b, 0);
                
                self.postMessage({ taskId, result });
              };
            `;

            const blob = new Blob([workerCode], { type: 'application/javascript' });
            const worker = new Worker(URL.createObjectURL(blob));

            worker.onmessage = (e) => {
              const { taskId, result } = e.data;
              this.busy.delete(worker);

              // Find the pending task and resolve it
              const taskIndex = this.queue.findIndex((task) => task.id === taskId);
              if (taskIndex !== -1) {
                const task = this.queue.splice(taskIndex, 1)[0];
                task.resolve(result);
              }

              this.processQueue();
            };

            this.workers.push(worker);
          }

          async execute(data) {
            const taskId = Date.now() + Math.random();

            return new Promise((resolve, reject) => {
              this.queue.push({ id: taskId, data, resolve, reject });
              this.processQueue();
            });
          }

          processQueue() {
            if (this.queue.length === 0) return;

            const availableWorker = this.workers.find((w) => !this.busy.has(w));
            if (!availableWorker) return;

            const task = this.queue.find((t) => !t.started);
            if (!task) return;

            task.started = true;
            this.busy.add(availableWorker);

            availableWorker.postMessage({
              taskId: task.id,
              data: task.data,
            });
          }

          terminate() {
            this.workers.forEach((worker) => worker.terminate());
          }
        }

        const pool = new SimpleWorkerPool(3);
        const tasks = [];

        // Create multiple tasks
        for (let i = 0; i < 10; i++) {
          const data = new Array(100).fill(i);
          tasks.push(pool.execute(data));
        }

        const startTime = performance.now();
        const results = await Promise.all(tasks);
        const totalTime = performance.now() - startTime;

        // Verify all tasks completed
        if (results.length !== 10) {
          throw new Error(`Expected 10 results, got ${results.length}`);
        }

        // Verify results are correct (each should be sum of squares)
        for (let i = 0; i < results.length; i++) {
          const expected = 100 * i * i; // 100 elements of value i, squared and summed
          if (results[i] !== expected) {
            throw new Error(
              `Task ${i} result mismatch: expected ${expected}, got ${results[i]}`,
            );
          }
        }

        pool.terminate();

        window.log(`Worker pool completed 10 tasks in ${totalTime.toFixed(2)}ms`);
        window.addTestResult(
          'Worker Pool',
          'success',
          `Pool of 3 workers completed 10 tasks in ${totalTime.toFixed(2)}ms`,
        );
      } catch (error) {
        window.addTestResult('Worker Pool', 'error', error.message);
        throw error;
      }
    });

    await expect(page.locator('#test-results')).toContainText('Worker Pool: SUCCESS');
  });

  test('should handle SharedArrayBuffer when available', async ({ page }) => {
    await page.click('#init-db');
    await expect(page.locator('#db-status')).toContainText('Initialized', {
      timeout: 10000,
    });

    await page.evaluate(async () => {
      try {
        const sharedArrayBufferSupported = typeof SharedArrayBuffer !== 'undefined';
        window.log(`SharedArrayBuffer supported: ${sharedArrayBufferSupported}`);

        if (!sharedArrayBufferSupported) {
          window.addTestResult(
            'SharedArrayBuffer',
            'success',
            'SharedArrayBuffer not available (requires COOP/COEP headers)',
          );
          return;
        }

        if (typeof Worker === 'undefined') {
          window.addTestResult(
            'SharedArrayBuffer',
            'success',
            'Web Workers not available',
          );
          return;
        }

        // Test SharedArrayBuffer with worker
        const sharedBuffer = new SharedArrayBuffer(1024);
        const sharedArray = new Float32Array(sharedBuffer);

        // Fill with test data
        for (let i = 0; i < sharedArray.length; i++) {
          sharedArray[i] = Math.random();
        }

        const workerCode = `
          self.onmessage = function(e) {
            const { sharedBuffer } = e.data;
            const sharedArray = new Float32Array(sharedBuffer);
            
            // Compute sum in worker using shared memory
            let sum = 0;
            for (let i = 0; i < sharedArray.length; i++) {
              sum += sharedArray[i];
            }
            
            self.postMessage({ sum, length: sharedArray.length });
          };
        `;

        const blob = new Blob([workerCode], { type: 'application/javascript' });
        const worker = new Worker(URL.createObjectURL(blob));

        const workerResult = await new Promise((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error('SharedArrayBuffer worker timeout')),
            5000,
          );

          worker.onmessage = (e) => {
            clearTimeout(timeout);
            resolve(e.data);
          };

          worker.onerror = (error) => {
            clearTimeout(timeout);
            reject(error);
          };

          worker.postMessage({ sharedBuffer });
        });

        // Verify worker could access shared memory
        if (workerResult.length !== sharedArray.length) {
          throw new Error('Worker could not access shared memory properly');
        }

        // Compute sum in main thread for comparison
        let mainSum = 0;
        for (let i = 0; i < sharedArray.length; i++) {
          mainSum += sharedArray[i];
        }

        const difference = Math.abs(workerResult.sum - mainSum);
        if (difference > 0.001) {
          // Allow for floating point precision
          throw new Error('SharedArrayBuffer data mismatch between threads');
        }

        worker.terminate();

        window.log(
          `SharedArrayBuffer test: ${sharedArray.length} floats, sum=${workerResult.sum.toFixed(3)}`,
        );
        window.addTestResult(
          'SharedArrayBuffer',
          'success',
          `Worker accessed shared memory with ${sharedArray.length} elements`,
        );
      } catch (error) {
        window.addTestResult('SharedArrayBuffer', 'error', error.message);
        throw error;
      }
    });

    await expect(page.locator('#test-results')).toContainText(
      'SharedArrayBuffer: SUCCESS',
    );
  });

  test('should handle worker errors gracefully', async ({ page }) => {
    await page.click('#init-db');
    await expect(page.locator('#db-status')).toContainText('Initialized', {
      timeout: 10000,
    });

    await page.evaluate(async () => {
      try {
        if (typeof Worker === 'undefined') {
          window.addTestResult(
            'Worker Error Handling',
            'success',
            'Web Workers not available',
          );
          return;
        }

        let errorsCaught = 0;

        // Test worker with syntax error
        try {
          const badWorkerCode = `
            self.onmessage = function(e) {
              // Intentional syntax error
              this is not valid javascript!!
            };
          `;

          const blob = new Blob([badWorkerCode], { type: 'application/javascript' });
          const badWorker = new Worker(URL.createObjectURL(blob));

          const errorPromise = new Promise((resolve) => {
            badWorker.onerror = () => {
              errorsCaught++;
              resolve();
            };
            badWorker.postMessage('test');
          });

          await Promise.race([
            errorPromise,
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Worker error timeout')), 2000),
            ),
          ]);

          badWorker.terminate();
        } catch (error) {
          window.log(`Worker error test failed: ${error.message}`);
        }

        // Test worker that throws runtime error
        try {
          const errorWorkerCode = `
            self.onmessage = function(e) {
              throw new Error('Intentional worker error');
            };
          `;

          const blob = new Blob([errorWorkerCode], { type: 'application/javascript' });
          const errorWorker = new Worker(URL.createObjectURL(blob));

          const runtimeErrorPromise = new Promise((resolve) => {
            errorWorker.onerror = () => {
              errorsCaught++;
              resolve();
            };
            errorWorker.postMessage('test');
          });

          await Promise.race([
            runtimeErrorPromise,
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Runtime error timeout')), 2000),
            ),
          ]);

          errorWorker.terminate();
        } catch (error) {
          window.log(`Runtime error test failed: ${error.message}`);
        }

        // Test worker termination
        const normalWorkerCode = `
          self.onmessage = function(e) {
            // Long running task
            const start = Date.now();
            while (Date.now() - start < 5000) {
              // Busy wait
            }
            self.postMessage('completed');
          };
        `;

        const blob = new Blob([normalWorkerCode], { type: 'application/javascript' });
        const longWorker = new Worker(URL.createObjectURL(blob));

        longWorker.postMessage('start');

        // Terminate before completion
        setTimeout(() => {
          longWorker.terminate();
          errorsCaught++;
          window.log('Successfully terminated long-running worker');
        }, 100);

        // Wait a bit for termination
        await new Promise((resolve) => setTimeout(resolve, 200));

        if (errorsCaught >= 2) {
          // At least 2 error conditions handled
          window.addTestResult(
            'Worker Error Handling',
            'success',
            `Properly handled ${errorsCaught} worker error conditions`,
          );
        } else {
          throw new Error(`Only ${errorsCaught} error conditions handled`);
        }
      } catch (error) {
        window.addTestResult('Worker Error Handling', 'error', error.message);
        throw error;
      }
    });

    await expect(page.locator('#test-results')).toContainText(
      'Worker Error Handling: SUCCESS',
    );
  });
});
