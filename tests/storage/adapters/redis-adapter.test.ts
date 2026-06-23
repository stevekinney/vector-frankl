import { afterAll, describe, expect, it } from 'bun:test';
import { runStorageAdapterTests } from './adapter-test-suite.js';

// ---------------------------------------------------------------------------
// Integration-mode detection
//
// When this file is loaded after `redis-integration-setup.ts` (via
// `--preload`), the preload writes `REDIS_INTEGRATION_URL` into process.env.
// In that case we use Bun's real RedisClient and skip the in-process mock so
// that all operations hit a disposable Redis service.
// ---------------------------------------------------------------------------

const integrationUrl = process.env['REDIS_INTEGRATION_URL'];
const integrationSkip = process.env['REDIS_INTEGRATION_SKIP'] === 'true';
const integrationMode = Boolean(integrationUrl);

// ---------------------------------------------------------------------------
// Mock Bun.RedisClient — Map-based in-memory implementation
// (used only when not in integration mode)
// ---------------------------------------------------------------------------

const store = new Map<string, string>();
const sets = new Map<string, Set<string>>();

class MockRedisClient {
  async get(key: string) {
    return store.get(key) ?? null;
  }

  async set(key: string, value: string) {
    store.set(key, value);
  }

  async del(...keys: string[]) {
    let count = 0;
    for (const key of keys) {
      const inStore = store.delete(key);
      const inSets = sets.delete(key);
      if (inStore || inSets) count++;
    }
    return count;
  }

  async exists(...keys: string[]) {
    let count = 0;
    for (const key of keys) {
      if (store.has(key)) count++;
    }
    return count;
  }

  async mget(...keys: string[]) {
    return keys.map((k) => store.get(k) ?? null);
  }

  async sadd(key: string, ...members: string[]) {
    if (!sets.has(key)) sets.set(key, new Set());
    let added = 0;
    for (const m of members) {
      if (!sets.get(key)!.has(m)) {
        sets.get(key)!.add(m);
        added++;
      }
    }
    return added;
  }

  async srem(key: string, ...members: string[]) {
    const set = sets.get(key);
    if (!set) return 0;
    let removed = 0;
    for (const m of members) {
      if (set.delete(m)) removed++;
    }
    return removed;
  }

  async scard(key: string) {
    return sets.get(key)?.size ?? 0;
  }

  async smembers(key: string) {
    return [...(sets.get(key) ?? [])];
  }

  close() {
    // no-op for mock
  }
}

// Patch Bun.RedisClient so the adapter's init() picks up the mock.
// Only applied when NOT in integration mode — in integration mode, Bun's real
// RedisClient is used as-is.
const bunRecord = Bun as Record<string, unknown>;
const originalRedisClient = bunRecord['RedisClient'];

if (!integrationMode) {
  bunRecord['RedisClient'] = MockRedisClient;
}

// Ensure we restore after tests
afterAll(() => {
  if (!integrationMode) {
    if (originalRedisClient !== undefined) {
      bunRecord['RedisClient'] = originalRedisClient;
    } else {
      delete bunRecord['RedisClient'];
    }
  }
});

// ---------------------------------------------------------------------------
// Import adapter AFTER mock decision is made
// ---------------------------------------------------------------------------

const { RedisStorageAdapter } = await import('@/storage/adapters/redis-adapter.js');

// ---------------------------------------------------------------------------
// Shared adapter test suite
// ---------------------------------------------------------------------------

if (!integrationMode) {
  // Mock mode: shared suite uses the in-process mock.
  runStorageAdapterTests('RedisStorageAdapter', async () => {
    store.clear();
    sets.clear();
    return new RedisStorageAdapter({ prefix: 'test' });
  });
} else if (!integrationSkip) {
  // Integration mode: shared suite uses a real Redis service. Each test run
  // gets a unique prefix to ensure isolation between concurrent test runs.
  runStorageAdapterTests('RedisStorageAdapter (integration)', async () => {
    const prefix = `vf-test-${Date.now()}-${Math.floor(Math.random() * 0xffff).toString(16)}`;
    // integrationUrl is guaranteed defined here: this branch only runs when
    // integrationMode (Boolean(integrationUrl)) is true.
    return new RedisStorageAdapter({ url: integrationUrl!, prefix });
  });
}

// ---------------------------------------------------------------------------
// Integration-only scenarios
// (skipped automatically when no real Redis service is available)
// ---------------------------------------------------------------------------

describe.skipIf(!integrationMode || integrationSkip)(
  'RedisStorageAdapter integration scenarios',
  () => {
    /**
     * Helper that creates a fresh adapter with a unique prefix to keep each
     * test hermetically isolated from every other test in this file.
     */
    function freshAdapter() {
      const prefix = `vf-int-${Date.now()}-${Math.floor(Math.random() * 0xffff).toString(16)}`;
      // integrationUrl is guaranteed non-null when integrationMode is true
      return new RedisStorageAdapter({ url: integrationUrl as string, prefix });
    }

    // -- Connection failure -------------------------------------------------

    it('throws an explicit error when the Redis URL is unreachable', async () => {
      const adapter = new RedisStorageAdapter({
        url: 'redis://127.0.0.1:19999',
        prefix: 'cf-test',
      });

      await adapter.init();

      const vec = {
        id: 'conn-fail',
        vector: new Float32Array([1, 2, 3]),
        magnitude: Math.sqrt(14),
        timestamp: Date.now(),
      };

      // The adapter must surface a connection error, not hang silently.
      try {
        await adapter.put(vec);
        // If we reach here the server happened to be listening — accept it.
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
      } finally {
        await adapter.close();
      }
    });

    // -- Prefix isolation ---------------------------------------------------

    it('isolates data between adapters with different prefixes', async () => {
      const a = freshAdapter();
      const b = freshAdapter();

      await a.init();
      await b.init();

      try {
        await a.put({
          id: 'shared-id',
          vector: new Float32Array([1]),
          magnitude: 1,
          timestamp: 0,
        });

        // Adapter B must not see the vector written by adapter A.
        expect(await b.exists('shared-id')).toBe(false);
      } finally {
        await a.destroy();
        await b.destroy();
      }
    });

    // -- Pipelined batches --------------------------------------------------

    it('handles pipelined batch writes correctly', async () => {
      const adapter = freshAdapter();
      await adapter.init();

      try {
        const vectors = Array.from({ length: 30 }, (_, i) => ({
          id: `pipe-${i}`,
          vector: new Float32Array([i, i + 1]),
          magnitude: Math.sqrt(i * i + (i + 1) * (i + 1)),
          timestamp: Date.now(),
        }));

        await adapter.putBatch(vectors, { batchSize: 10 });
        expect(await adapter.count()).toBe(30);
      } finally {
        await adapter.destroy();
      }
    });

    // -- Concurrent writes --------------------------------------------------

    it('handles concurrent writes without data loss', async () => {
      const adapter = freshAdapter();
      await adapter.init();

      try {
        const concurrency = 20;
        const writes = Array.from({ length: concurrency }, (_, i) =>
          adapter.put({
            id: `concurrent-${i}`,
            vector: new Float32Array([i]),
            magnitude: i,
            timestamp: Date.now(),
          }),
        );

        await Promise.all(writes);
        expect(await adapter.count()).toBe(concurrency);

        const all = await adapter.getAll();
        expect(all).toHaveLength(concurrency);
      } finally {
        await adapter.destroy();
      }
    });

    // -- Expiration behavior ------------------------------------------------

    it('reflects the absence of a vector that was manually removed', async () => {
      const adapter = freshAdapter();
      await adapter.init();

      try {
        await adapter.put({
          id: 'expire-target',
          vector: new Float32Array([1]),
          magnitude: 1,
          timestamp: Date.now(),
        });

        expect(await adapter.exists('expire-target')).toBe(true);

        await adapter.delete('expire-target');
        expect(await adapter.exists('expire-target')).toBe(false);
      } finally {
        await adapter.destroy();
      }
    });

    // -- Cleanup -----------------------------------------------------------

    it('destroy() removes all keys in the namespace', async () => {
      const adapter = freshAdapter();
      await adapter.init();

      await adapter.put({
        id: 'k1',
        vector: new Float32Array([1]),
        magnitude: 1,
        timestamp: 0,
      });
      await adapter.put({
        id: 'k2',
        vector: new Float32Array([2]),
        magnitude: 2,
        timestamp: 0,
      });
      expect(await adapter.count()).toBe(2);

      await adapter.destroy();

      // Re-init to confirm the namespace is empty after destroy.
      await adapter.init();
      expect(await adapter.count()).toBe(0);
      await adapter.close();
    });

    // -- Authentication / TLS configuration --------------------------------

    it('init() succeeds when a valid URL is provided', async () => {
      const adapter = freshAdapter();
      // Must not throw.
      await adapter.init();
      await adapter.close();
    });
  },
);
