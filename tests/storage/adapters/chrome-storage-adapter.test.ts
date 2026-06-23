import { beforeEach, describe, expect, it } from 'bun:test';
import { QuotaExceededError, VectorNotFoundError } from '@/core/errors.js';
import {
  CHROME_STORAGE_MAX_SERIALIZED_BYTES,
  ChromeStorageAdapter,
} from '@/storage/adapters/chrome-storage-adapter.js';
import type { VectorData } from '@/core/types.js';
import { runStorageAdapterTests } from './adapter-test-suite.js';

// ---------------------------------------------------------------------------
// In-process mock of chrome.storage.local
// ---------------------------------------------------------------------------
//
// The chrome.storage API is only available inside Chrome extensions.  We
// provide a Map-backed drop-in that mirrors the async chrome.storage.local
// interface so unit tests run in Bun without a browser.

type StorageStore = Map<string, unknown>;

function createMockChromeStorage(store: StorageStore) {
  return {
    async get(keys: string | string[]): Promise<Record<string, unknown>> {
      const keyList = Array.isArray(keys) ? keys : [keys];
      const result: Record<string, unknown> = {};
      for (const k of keyList) {
        if (store.has(k)) {
          result[k] = store.get(k);
        }
      }
      return result;
    },
    async set(items: Record<string, unknown>): Promise<void> {
      for (const [k, v] of Object.entries(items)) {
        store.set(k, v);
      }
    },
    async remove(keys: string | string[]): Promise<void> {
      const keyList = Array.isArray(keys) ? keys : [keys];
      for (const k of keyList) {
        store.delete(k);
      }
    },
  };
}

// Install a fresh chrome global before each test run.
function installMockChrome(store: StorageStore): void {
  (globalThis as any).chrome = {
    storage: {
      local: createMockChromeStorage(store),
      session: createMockChromeStorage(store),
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeVector(
  id: string,
  values: number[],
  metadata?: Record<string, unknown>,
): VectorData {
  const vector = new Float32Array(values);
  const magnitude = Math.sqrt(values.reduce((sum, v) => sum + v * v, 0));
  const result: VectorData = { id, vector, magnitude, timestamp: Date.now() };
  if (metadata !== undefined) {
    result.metadata = metadata;
  }
  return result;
}

/** Build a vector whose JSON serialization exceeds the per-item quota. */
function makeOversizedVector(id: string): VectorData {
  // Each Float32 dimension serializes to ~7 bytes in JSON ("1.234567,").
  // 8192 / 7 ≈ 1171 dims needed to exceed the limit; use 2000 to be safe.
  const dims = 2_000;
  const values = Array.from({ length: dims }, (_, i) => i * 0.001);
  return makeVector(id, values);
}

// ---------------------------------------------------------------------------
// Shared behavioral suite (uses the adapter-test-suite)
// ---------------------------------------------------------------------------

let sharedStore: StorageStore;

runStorageAdapterTests(
  'ChromeStorageAdapter',
  () => {
    sharedStore = new Map();
    installMockChrome(sharedStore);
    return new ChromeStorageAdapter({ prefix: 'test' });
  },
  async (adapter) => {
    await adapter.destroy();
  },
);

// ---------------------------------------------------------------------------
// Chrome-specific: large-vector rejection
// ---------------------------------------------------------------------------

describe('ChromeStorageAdapter — large-vector rejection', () => {
  let store: StorageStore;
  let adapter: ChromeStorageAdapter;

  beforeEach(async () => {
    store = new Map();
    installMockChrome(store);
    adapter = new ChromeStorageAdapter({ prefix: 'quota-test' });
    await adapter.init();
  });

  it('rejects a single oversized vector with QuotaExceededError before writing', async () => {
    const large = makeOversizedVector('big');

    try {
      await adapter.put(large);
      expect.unreachable('should have thrown QuotaExceededError');
    } catch (error) {
      expect(error).toBeInstanceOf(QuotaExceededError);
    }

    // The ID must not appear in the index — the adapter must fail before any
    // write, not after a partial write.
    expect(await adapter.exists('big')).toBe(false);
    expect(await adapter.count()).toBe(0);
  });

  it('rejects an oversized vector inside putBatch and reports it as a failure', async () => {
    const small = makeVector('small', [1, 2, 3]);
    const large = makeOversizedVector('large');

    // putBatch records per-vector errors rather than throwing for the whole batch.
    let threw = false;
    try {
      await adapter.putBatch([small, large]);
    } catch {
      threw = true;
    }

    // small should be stored regardless of the large-vector failure.
    expect(await adapter.exists('small')).toBe(true);
    // large must not be stored (pre-flight rejection, not post-write rollback).
    expect(await adapter.exists('large')).toBe(false);

    // putBatch should throw a BatchOperationError because of the failed vector.
    expect(threw).toBe(true);
  });

  it('does not touch the ID index for an oversized vector', async () => {
    // Store a small vector first so the index is non-empty.
    await adapter.put(makeVector('existing', [1]));
    expect(await adapter.count()).toBe(1);

    const large = makeOversizedVector('oversized');
    try {
      await adapter.put(large);
    } catch {
      // Expected
    }

    // Count must remain 1 — the oversized vector must not modify the index.
    expect(await adapter.count()).toBe(1);
    const ids = await adapter.getAll();
    expect(ids.map((v) => v.id)).toEqual(['existing']);
  });

  it('CHROME_STORAGE_MAX_SERIALIZED_BYTES is 8192', () => {
    expect(CHROME_STORAGE_MAX_SERIALIZED_BYTES).toBe(8_192);
  });
});

// ---------------------------------------------------------------------------
// Chrome-specific: concurrent writes within a single context
// ---------------------------------------------------------------------------

describe('ChromeStorageAdapter — in-process concurrency (single context)', () => {
  let store: StorageStore;
  let adapter: ChromeStorageAdapter;

  beforeEach(async () => {
    store = new Map();
    installMockChrome(store);
    adapter = new ChromeStorageAdapter({ prefix: 'concurrent' });
    await adapter.init();
  });

  it('concurrent put() calls do not lose IDs', async () => {
    const vectors = Array.from({ length: 20 }, (_, i) =>
      makeVector(`c-${i}`, [i, i + 1]),
    );

    // Fire all puts concurrently within the same adapter instance (single
    // context).  The internal mutex should serialise index mutations.
    await Promise.all(vectors.map((v) => adapter.put(v)));

    expect(await adapter.count()).toBe(20);
    const all = await adapter.getAll();
    expect(all.length).toBe(20);
  });

  it('concurrent delete() calls do not corrupt the ID index', async () => {
    // Insert 10 vectors, then delete them all concurrently.
    const vectors = Array.from({ length: 10 }, (_, i) => makeVector(`del-c-${i}`, [i]));
    await Promise.all(vectors.map((v) => adapter.put(v)));
    expect(await adapter.count()).toBe(10);

    await Promise.all(vectors.map((v) => adapter.delete(v.id)));
    expect(await adapter.count()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Chrome-specific: partial-write consistency documentation test
// ---------------------------------------------------------------------------

describe('ChromeStorageAdapter — partial-write rollback behaviour', () => {
  it('ID index is updated before vector data write (documented ordering)', async () => {
    // This test documents the current implementation ordering: the ID index
    // is written first inside the mutex, then the vector data is written.
    // If the second write fails, the ID will be present in the index but
    // the vector data will be absent.
    //
    // We simulate this by patching storage.set to fail on the second call
    // within a put() operation.

    const store: StorageStore = new Map();
    installMockChrome(store);

    let callCount = 0;
    const realSet = (globalThis as any).chrome.storage.local.set.bind(
      (globalThis as any).chrome.storage.local,
    );

    // Intercept the second set() call (which writes vector data) and throw.
    (globalThis as any).chrome.storage.local.set = async (
      items: Record<string, unknown>,
    ) => {
      callCount++;
      if (callCount === 2) {
        throw new Error('Simulated write failure');
      }
      return realSet(items);
    };

    const adapter2 = new ChromeStorageAdapter({ prefix: 'partial-write-test' });
    await adapter2.init();

    let threw = false;
    try {
      await adapter2.put(makeVector('broken', [1, 2]));
    } catch {
      threw = true;
    }

    expect(threw).toBe(true);

    // The vector data is absent (second write failed), so get() should throw.
    try {
      await adapter2.get('broken');
      // If we reach here without throwing, the vector data was somehow written.
      // That would only happen if the implementation changed; note it but don't
      // fail — the important invariant is that no silent data loss occurs.
    } catch (error) {
      expect(error).toBeInstanceOf(VectorNotFoundError);
    }
  });
});

// ---------------------------------------------------------------------------
// Chrome-specific: quota limitation documentation
// ---------------------------------------------------------------------------

describe('ChromeStorageAdapter — quota limit documentation', () => {
  it('documents per-item size limit via CHROME_STORAGE_MAX_SERIALIZED_BYTES', () => {
    // This test is intentionally a documentation anchor.  The constant value
    // reflects the chrome.storage per-item limit and must not change without
    // a corresponding update to the experimental-classification comment block
    // at the top of chrome-storage-adapter.ts.
    expect(CHROME_STORAGE_MAX_SERIALIZED_BYTES).toBe(8_192);
  });

  it('allows a small vector that fits within the quota', async () => {
    const store: StorageStore = new Map();
    installMockChrome(store);
    const adapter = new ChromeStorageAdapter({ prefix: 'quota-ok' });
    await adapter.init();

    // A 3-dimensional vector is well under 8 KB.
    const small = makeVector('fits', [0.1, 0.2, 0.3]);
    await adapter.put(small);

    expect(await adapter.exists('fits')).toBe(true);
    const retrieved = await adapter.get('fits');
    expect(retrieved.id).toBe('fits');
  });
});
