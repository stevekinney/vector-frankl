import { afterAll } from 'bun:test';
import { runStorageAdapterTests } from './adapter-test-suite.js';

// ---------------------------------------------------------------------------
// Mock Bun.RedisClient — Map-based in-memory implementation
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

// Patch Bun.RedisClient so the adapter's init() picks up the mock
const bunRecord = Bun as Record<string, unknown>;
const originalRedisClient = bunRecord['RedisClient'];

bunRecord['RedisClient'] = MockRedisClient;

// Ensure we restore after tests
afterAll(() => {
  if (originalRedisClient !== undefined) {
    bunRecord['RedisClient'] = originalRedisClient;
  }
});

// ---------------------------------------------------------------------------
// Import adapter AFTER mock is in place
// ---------------------------------------------------------------------------

const { RedisStorageAdapter } = await import('@/storage/adapters/redis-adapter.js');

// ---------------------------------------------------------------------------
// Run the shared adapter test suite
// ---------------------------------------------------------------------------

runStorageAdapterTests(
  'RedisStorageAdapter',
  async () => {
    store.clear();
    sets.clear();
    return new RedisStorageAdapter({ prefix: 'test' });
  },
);
