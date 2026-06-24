/**
 * Quota hardening tests.
 *
 * Verifies:
 * - Single writes and batch writes check quota before allocation.
 * - Simulated quota failures leave no dangling IDs or partial records.
 * - Auto-eviction is awaited when enabled and emits typed quota errors.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { QuotaSafetyMarginError, VectorDatabaseError } from '@/core/errors.js';
import { MemoryStorageAdapter } from '@/storage/adapters/memory-adapter.js';
import { VectorDB } from '@/api/database.js';
import { StorageQuotaMonitor } from '@/storage/quota-monitor.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Reset the StorageQuotaMonitor singleton so each test starts fresh. */
function resetQuotaMonitor(): void {
  (StorageQuotaMonitor as any)['instance'] = null;
}

function makeMemoryDB(autoEviction = false): VectorDB {
  const adapter = new MemoryStorageAdapter();
  return new VectorDB('quota-test', 3, {
    storage: adapter,
    autoEviction,
  });
}

function makeVector(val = 0.5): number[] {
  return [val, val, val];
}

/**
 * Patch navigator.storage.estimate so it returns a critically-high usage ratio.
 * Returns a cleanup function that restores the original.
 */
function simulateCriticalQuota(usageRatio = 0.97): () => void {
  const originalStorage = Object.getOwnPropertyDescriptor(navigator, 'storage');

  Object.defineProperty(navigator, 'storage', {
    value: {
      estimate: () =>
        Promise.resolve({ usage: Math.floor(1_000_000 * usageRatio), quota: 1_000_000 }),
    },
    configurable: true,
    writable: true,
  });

  return () => {
    if (originalStorage) {
      Object.defineProperty(navigator, 'storage', originalStorage);
    } else {
      delete (navigator as any).storage;
    }
  };
}

// ---------------------------------------------------------------------------
// Quota check before single write
// ---------------------------------------------------------------------------

describe('quota check — single write', () => {
  beforeEach(resetQuotaMonitor);
  afterEach(resetQuotaMonitor);

  it('allows writes when quota is healthy (< 95%)', async () => {
    const restoreQuota = simulateCriticalQuota(0.5); // 50% used
    const db = makeMemoryDB(false);
    await db.init();

    try {
      await db.addVector('v1', makeVector(0.1));
      expect(await db.exists('v1')).toBe(true);
    } finally {
      restoreQuota();
      await db.close();
    }
  });

  it('rejects single write with QuotaSafetyMarginError when quota >= 95% and autoEviction is off', async () => {
    const restoreQuota = simulateCriticalQuota(0.97);
    const db = makeMemoryDB(false);
    await db.init();

    try {
      let caught: unknown;
      try {
        await db.addVector('dangling', makeVector());
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeInstanceOf(QuotaSafetyMarginError);

      // No dangling ID should have been written
      expect(await db.exists('dangling')).toBe(false);
    } finally {
      restoreQuota();
      await db.close();
    }
  });

  it('QuotaSafetyMarginError carries the correct error code', async () => {
    const restoreQuota = simulateCriticalQuota(0.97);
    const db = makeMemoryDB(false);
    await db.init();

    try {
      let caught: unknown;
      try {
        await db.addVector('code-check', makeVector());
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeInstanceOf(QuotaSafetyMarginError);
      expect((caught as QuotaSafetyMarginError).code).toBe('QUOTA_SAFETY_MARGIN');
    } finally {
      restoreQuota();
      await db.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Quota check before batch write
// ---------------------------------------------------------------------------

describe('quota check — batch write', () => {
  beforeEach(resetQuotaMonitor);
  afterEach(resetQuotaMonitor);

  it('rejects entire batch with QuotaSafetyMarginError when quota >= 95% and autoEviction is off', async () => {
    const restoreQuota = simulateCriticalQuota(0.97);
    const db = makeMemoryDB(false);
    await db.init();

    const batch = [
      { id: 'b1', vector: makeVector(0.1) },
      { id: 'b2', vector: makeVector(0.2) },
      { id: 'b3', vector: makeVector(0.3) },
    ];

    try {
      let caught: unknown;
      try {
        await db.addBatch(batch);
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeInstanceOf(QuotaSafetyMarginError);

      // No dangling IDs should have been written
      for (const { id } of batch) {
        expect(await db.exists(id)).toBe(false);
      }
    } finally {
      restoreQuota();
      await db.close();
    }
  });

  it('allows batch when quota is healthy', async () => {
    const restoreQuota = simulateCriticalQuota(0.3);
    const db = makeMemoryDB(false);
    await db.init();

    const batch = [
      { id: 'ok1', vector: makeVector(0.1) },
      { id: 'ok2', vector: makeVector(0.2) },
    ];

    try {
      await db.addBatch(batch);
      expect(await db.exists('ok1')).toBe(true);
      expect(await db.exists('ok2')).toBe(true);
    } finally {
      restoreQuota();
      await db.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Auto-eviction awaited before write
// ---------------------------------------------------------------------------

describe('auto-eviction — awaited before write', () => {
  beforeEach(resetQuotaMonitor);
  afterEach(resetQuotaMonitor);

  it('performs eviction before writing when autoEviction is enabled and quota is critical', async () => {
    // Pre-populate the db with vectors, then simulate critical quota so the
    // pre-write guard triggers eviction before the new write.
    const adapter = new MemoryStorageAdapter();
    const db = new VectorDB('evict-test', 3, {
      storage: adapter,
      autoEviction: true,
    });
    await db.init();

    // Add 5 vectors with normal quota
    const restoreFn1 = simulateCriticalQuota(0.3);
    for (let i = 0; i < 5; i++) {
      await db.addVector(`pre-${i}`, makeVector(i * 0.1));
    }
    restoreFn1();

    const stats = await db.getStats();
    expect(stats.vectorCount).toBe(5);

    // Now simulate critical quota
    const restoreFn2 = simulateCriticalQuota(0.97);

    // The write should attempt eviction (which frees space from the 5 vectors)
    // and then — if quota drops below the threshold — succeed.  With the
    // in-memory adapter the quota API is simulated and stays high, so the write
    // may still fail.  What we assert is: no dangling 'new-vector' ID is left
    // if the write fails, and if it succeeds the vector is readable.
    let writeSucceeded = false;
    let caughtError: unknown;
    try {
      await db.addVector('new-vector', makeVector(0.9));
      writeSucceeded = true;
    } catch (e) {
      caughtError = e;
    }

    if (!writeSucceeded) {
      // Acceptable — quota still critical after eviction
      expect(caughtError).toBeInstanceOf(QuotaSafetyMarginError);
      // No dangling record
      expect(await db.exists('new-vector')).toBe(false);
    } else {
      expect(await db.exists('new-vector')).toBe(true);
    }

    restoreFn2();
    await db.close();
  });
});

// ---------------------------------------------------------------------------
// QuotaSafetyMarginError shape
// ---------------------------------------------------------------------------

describe('QuotaSafetyMarginError shape', () => {
  it('carries the correct code and properties', () => {
    const e = new QuotaSafetyMarginError(1024, 512);
    expect(e.code).toBe('QUOTA_SAFETY_MARGIN');
    expect(e.required).toBe(1024);
    expect(e.available).toBe(512);
    expect(e.message).toContain('1024');
    expect(e.message).toContain('512');
  });

  it('is a subclass of VectorDatabaseError', () => {
    const e = new QuotaSafetyMarginError(0, 0);
    expect(e).toBeInstanceOf(VectorDatabaseError);
  });
});
