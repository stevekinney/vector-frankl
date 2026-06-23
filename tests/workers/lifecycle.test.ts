/**
 * Worker lifecycle, error propagation, and cleanup tests.
 *
 * Covers:
 *   - startup failures
 *   - task failures and error propagation
 *   - serialization errors
 *   - task timeouts
 *   - repeated initialization
 *   - close() / terminate() and cleanup (no worker leaks)
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { WorkerPool } from '@/workers/worker-pool.js';
import type { WorkerResponse } from '@/workers/worker-pool.js';

// ---------------------------------------------------------------------------
// Mock Worker helpers
// ---------------------------------------------------------------------------

/**
 * A controllable mock of the Web Worker API.
 * Tests interact with the pool through the standard `postMessage`/event
 * handler boundary; this mock simulates the worker-side behaviour.
 */
class MockWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;

  terminated = false;

  /** Behaviour mode set per-test */
  mode: 'echo' | 'error' | 'silent' = 'echo';

  /** Collected postMessage calls for assertion */
  sent: unknown[] = [];

  constructor(_url: string, _options?: WorkerOptions) {}

  postMessage(data: unknown): void {
    this.sent.push(data);

    const msg = data as { taskId: string; operation: string };

    switch (this.mode) {
      case 'echo': {
        // Immediately respond with a success result
        const response: WorkerResponse = {
          taskId: msg.taskId,
          result: `result:${msg.operation}`,
        };
        queueMicrotask(() => {
          this.onmessage?.({ data: response } as MessageEvent);
        });
        break;
      }
      case 'error': {
        // Immediately respond with an error
        const response: WorkerResponse = {
          taskId: msg.taskId,
          error: `Worker task failed: ${msg.operation}`,
        };
        queueMicrotask(() => {
          this.onmessage?.({ data: response } as MessageEvent);
        });
        break;
      }
      case 'silent': {
        // Never respond — used to test timeout behaviour
        break;
      }
    }
  }

  terminate(): void {
    this.terminated = true;
  }

  /** Simulate a worker-level error (onerror) asynchronously */
  triggerError(message: string): void {
    queueMicrotask(() => {
      this.onerror?.({ message } as ErrorEvent);
    });
  }
}

// Registry of all MockWorkers created during a test
let createdWorkers: MockWorker[] = [];

// Default behaviour for newly constructed workers
let workerConstructorMode: MockWorker['mode'] = 'echo';
let workerConstructorThrows = false;

function installMockWorker(): void {
  createdWorkers = [];
  workerConstructorThrows = false;
  workerConstructorMode = 'echo';

  (global as unknown as Record<string, unknown>)["Worker"] = class extends MockWorker {
    constructor(url: string, options?: WorkerOptions) {
      super(url, options);
      if (workerConstructorThrows) {
        throw new Error('Worker construction failed');
      }
      this.mode = workerConstructorMode;
      createdWorkers.push(this);
    }
  };
}

function removeMockWorker(): void {
  delete (global as unknown as Record<string, unknown>)["Worker"];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Worker lifecycle', () => {
  beforeEach(() => {
    installMockWorker();
  });

  afterEach(async () => {
    removeMockWorker();
  });

  // -------------------------------------------------------------------------
  // Startup failure
  // -------------------------------------------------------------------------

  describe('startup failure', () => {
    it('throws when Worker constructor throws for all workers', async () => {
      workerConstructorThrows = true;
      const pool = new WorkerPool({ maxWorkers: 2 });

      expect(pool.init()).rejects.toThrow('Failed to create any workers');
    });

    it('partial construction: succeeds with fewer workers than requested', async () => {
      // First worker throws, second succeeds
      let callCount = 0;
      (global as unknown as Record<string, unknown>)["Worker"] = class extends MockWorker {
        constructor(url: string, options?: WorkerOptions) {
          super(url, options);
          callCount++;
          if (callCount === 1) throw new Error('Worker 0 failed to start');
          this.mode = 'echo';
          createdWorkers.push(this);
        }
      };

      const pool = new WorkerPool({ maxWorkers: 2 });
      await pool.init();

      const stats = pool.getStats();
      expect(stats.totalWorkers).toBe(1);
      await pool.terminate();
    });

    it('repeated init() is idempotent', async () => {
      const pool = new WorkerPool({ maxWorkers: 1 });
      await pool.init();
      const countAfterFirst = createdWorkers.length;

      await pool.init(); // second call must be a no-op
      expect(createdWorkers.length).toBe(countAfterFirst);

      await pool.terminate();
    });
  });

  // -------------------------------------------------------------------------
  // Task failure and error propagation
  // -------------------------------------------------------------------------

  describe('task failure', () => {
    it('rejects the returned promise when a worker reports an error result', async () => {
      workerConstructorMode = 'error';
      const pool = new WorkerPool({ maxWorkers: 1 });
      await pool.init();

      let caught: Error | null = null;
      try {
        await pool.execute('do_work', {});
      } catch (error) {
        caught = error as Error;
      }

      expect(caught).toBeInstanceOf(Error);
      expect(caught!.message).toBe('Worker task failed: do_work');

      await pool.terminate();
    });

    it('propagates error message verbatim from worker response', async () => {
      workerConstructorMode = 'error';
      const pool = new WorkerPool({ maxWorkers: 1 });
      await pool.init();

      let caught: Error | null = null;
      try {
        await pool.execute('my_operation', {});
      } catch (error) {
        caught = error as Error;
      }

      expect(caught).toBeInstanceOf(Error);
      expect(caught!.message).toBe('Worker task failed: my_operation');

      await pool.terminate();
    });

    it('worker-level error event rejects the active task', async () => {
      const pool = new WorkerPool({ maxWorkers: 1 });
      await pool.init();

      // Switch to silent so the task stays in-flight
      for (const w of createdWorkers) {
        w.mode = 'silent';
      }

      const taskPromise = pool.execute('long_task', {});

      // Trigger a worker-level error event
      for (const w of createdWorkers) {
        w.triggerError('Unexpected runtime error');
      }

      let caught: Error | null = null;
      try {
        await taskPromise;
      } catch (error) {
        caught = error as Error;
      }

      expect(caught).toBeInstanceOf(Error);

      await pool.terminate();
    });
  });

  // -------------------------------------------------------------------------
  // Timeout
  // -------------------------------------------------------------------------

  describe('timeout', () => {
    it('rejects with a timeout error when the worker does not respond', async () => {
      workerConstructorMode = 'silent';
      const pool = new WorkerPool({ maxWorkers: 1, timeout: 50 });
      await pool.init();

      let caught: Error | null = null;
      try {
        await pool.execute('slow_op', {});
      } catch (error) {
        caught = error as Error;
      }

      expect(caught).toBeInstanceOf(Error);
      expect(caught!.message).toMatch(/timeout/i);

      await pool.terminate();
    });

    it('timeout does not leave the worker in a busy state', async () => {
      workerConstructorMode = 'silent';
      const pool = new WorkerPool({ maxWorkers: 1, timeout: 50 });
      await pool.init();

      try {
        await pool.execute('slow_op', {});
      } catch {
        // expected timeout
      }

      const stats = pool.getStats();
      expect(stats.busyWorkers).toBe(0);

      await pool.terminate();
    });

    it('can execute new tasks after a timeout', async () => {
      let callCount = 0;
      (global as unknown as Record<string, unknown>)["Worker"] = class extends MockWorker {
        constructor(url: string, options?: WorkerOptions) {
          super(url, options);
          this.mode = 'echo';
          createdWorkers.push(this);
        }
        override postMessage(data: unknown): void {
          callCount++;
          if (callCount === 1) {
            // First task times out — don't respond
            this.sent.push(data);
            return;
          }
          super.postMessage(data);
        }
      };

      const pool = new WorkerPool({ maxWorkers: 1, timeout: 50 });
      await pool.init();

      // First call will time out
      try {
        await pool.execute('first', {});
      } catch {
        // expected timeout
      }

      // Second call should succeed via echo
      const result = await pool.execute('second', {});
      expect(result).toBe('result:second');

      await pool.terminate();
    });
  });

  // -------------------------------------------------------------------------
  // Cleanup / terminate / close
  // -------------------------------------------------------------------------

  describe('cleanup', () => {
    it('terminate() terminates all workers', async () => {
      const pool = new WorkerPool({ maxWorkers: 2 });
      await pool.init();
      expect(createdWorkers).toHaveLength(2);

      await pool.terminate();

      for (const w of createdWorkers) {
        expect(w.terminated).toBe(true);
      }
    });

    it('terminate() resets worker count to zero', async () => {
      const pool = new WorkerPool({ maxWorkers: 2 });
      await pool.init();

      await pool.terminate();

      expect(pool.getStats().totalWorkers).toBe(0);
    });

    it('terminate() rejects all queued tasks', async () => {
      // One worker, saturate it with a silent task then queue a second
      workerConstructorMode = 'silent';
      const pool = new WorkerPool({ maxWorkers: 1, timeout: 30000 });
      await pool.init();

      // First task occupies the only worker
      const first = pool.execute('task1', {});
      // Second task goes into the queue (no available worker)
      const second = pool.execute('task2', {});

      // Attach rejection handlers BEFORE terminate() so the rejections are
      // not unhandled when terminate() rejects them synchronously.
      const firstResult = first.then(() => 'resolved').catch((e: Error) => e.message);
      const secondResult = second.then(() => 'resolved').catch((e: Error) => e.message);

      await pool.terminate();

      expect(await firstResult).toBe('Worker pool terminated');
      expect(await secondResult).toBe('Worker pool terminated');
    });

    it('terminate() on an uninitialised pool does not throw', async () => {
      const pool = new WorkerPool();
      await pool.terminate();
      // No error thrown
    });

    it('close() is an alias for terminate()', async () => {
      const pool = new WorkerPool({ maxWorkers: 1 });
      await pool.init();

      await pool.close();

      expect(pool.getStats().totalWorkers).toBe(0);
      for (const w of createdWorkers) {
        expect(w.terminated).toBe(true);
      }
    });

    it('workers do not leak after terminate()', async () => {
      const pool = new WorkerPool({ maxWorkers: 3 });
      await pool.init();

      expect(createdWorkers).toHaveLength(3);

      await pool.terminate();

      // All workers are terminated — no lingering references in the pool
      expect(pool.getStats().totalWorkers).toBe(0);
      for (const w of createdWorkers) {
        expect(w.terminated).toBe(true);
      }
    });

    it('can re-initialise after terminate()', async () => {
      const pool = new WorkerPool({ maxWorkers: 1 });
      await pool.init();
      await pool.terminate();

      // Pool should accept init() again from a clean state
      await pool.init();
      expect(pool.getStats().totalWorkers).toBe(1);

      await pool.terminate();
    });
  });

  // -------------------------------------------------------------------------
  // Serialization errors
  // -------------------------------------------------------------------------

  describe('serialization error', () => {
    it('rejects when postMessage throws due to a non-transferable payload', async () => {
      (global as unknown as Record<string, unknown>)["Worker"] = class extends MockWorker {
        constructor(url: string, options?: WorkerOptions) {
          super(url, options);
          this.mode = 'echo';
          createdWorkers.push(this);
        }
        override postMessage(_data: unknown): void {
          throw new TypeError('Failed to execute postMessage: could not be cloned');
        }
      };

      const pool = new WorkerPool({ maxWorkers: 1 });
      await pool.init();

      let caught: Error | null = null;
      try {
        await pool.execute('work', {});
      } catch (error) {
        caught = error as Error;
      }

      expect(caught).toBeInstanceOf(TypeError);
      expect(caught!.message).toMatch(/postMessage|cloned/i);

      await pool.terminate();
    });
  });

  // -------------------------------------------------------------------------
  // Stats integrity during lifecycle events
  // -------------------------------------------------------------------------

  describe('statistics', () => {
    it('reflects busy worker count while tasks are in-flight', async () => {
      workerConstructorMode = 'silent'; // tasks stay in-flight
      const pool = new WorkerPool({ maxWorkers: 2, timeout: 30000 });
      await pool.init();

      const t1 = pool.execute('op1', {});
      const t2 = pool.execute('op2', {});

      // Attach rejection handlers before terminate() fires them
      const r1 = t1.catch(() => 'rejected');
      const r2 = t2.catch(() => 'rejected');

      // Both workers are now busy
      expect(pool.getStats().busyWorkers).toBe(2);

      // Terminate to clean up
      await pool.terminate();

      expect(await r1).toBe('rejected');
      expect(await r2).toBe('rejected');
    });

    it('busy count drops back to 0 after tasks complete', async () => {
      const pool = new WorkerPool({ maxWorkers: 2 });
      await pool.init();

      await pool.execute('op1', {});
      await pool.execute('op2', {});

      expect(pool.getStats().busyWorkers).toBe(0);

      await pool.terminate();
    });
  });
});
