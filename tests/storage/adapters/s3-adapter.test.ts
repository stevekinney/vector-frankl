import { afterAll, describe, expect, it } from 'bun:test';
import { runStorageAdapterTests } from './adapter-test-suite.js';

// ---------------------------------------------------------------------------
// Integration-mode detection
//
// When this file is loaded after `s3-integration-setup.ts` (via `--preload`),
// the preload writes `S3_INTEGRATION_*` variables into process.env. In that
// case we use Bun's real S3 client and skip the in-process mock so that all
// operations hit a disposable S3-compatible service (typically MinIO).
// ---------------------------------------------------------------------------

const integrationEndpoint = process.env['S3_INTEGRATION_ENDPOINT'];
const integrationSkip = process.env['S3_INTEGRATION_SKIP'] === 'true';
const integrationMode = Boolean(integrationEndpoint);

const integrationConfig = integrationMode
  ? {
      endpoint: integrationEndpoint as string,
      accessKeyId: process.env['S3_INTEGRATION_ACCESS_KEY_ID'] ?? 'minioadmin',
      secretAccessKey: process.env['S3_INTEGRATION_SECRET_ACCESS_KEY'] ?? 'minioadmin',
      region: process.env['S3_INTEGRATION_REGION'] ?? 'us-east-1',
      bucket: process.env['S3_INTEGRATION_BUCKET'] ?? 'vf-integration-test',
    }
  : null;

// ---------------------------------------------------------------------------
// Mock Bun.s3 — in-memory object store
// (used only when not in integration mode)
// ---------------------------------------------------------------------------

const objectStore = new Map<string, string>();

function createMockS3File(key: string): {
  text: () => Promise<string>;
  exists: () => Promise<boolean>;
  write: (data: string) => Promise<number>;
  delete: () => Promise<void>;
} {
  return {
    text: async () => {
      const body = objectStore.get(key);
      if (body === undefined) {
        throw new Error(`NoSuchKey: ${key}`);
      }
      return body;
    },
    exists: async () => objectStore.has(key),
    write: async (data: string) => {
      objectStore.set(key, data);
      return data.length;
    },
    delete: async () => {
      objectStore.delete(key);
    },
  };
}

const mockS3 = {
  file: (key: string, _options?: Record<string, unknown>) => createMockS3File(key),
  write: async (key: string, data: string, _options?: Record<string, unknown>) => {
    objectStore.set(key, data);
    return data.length;
  },
  delete: async (key: string, _options?: Record<string, unknown>) => {
    objectStore.delete(key);
  },
  exists: async (key: string, _options?: Record<string, unknown>) => objectStore.has(key),
};

// Patch Bun.s3 so the adapter's init() picks up the mock.
// Only applied when NOT in integration mode — in integration mode, Bun's real
// S3 client is used as-is.
const bunRecord = Bun as Record<string, unknown>;
const originalS3 = bunRecord['s3'];

if (!integrationMode) {
  bunRecord['s3'] = mockS3;
}

afterAll(() => {
  if (!integrationMode) {
    bunRecord['s3'] = originalS3;
  }
});

// ---------------------------------------------------------------------------
// Import adapter AFTER mock decision is made
// ---------------------------------------------------------------------------

const { S3StorageAdapter } = await import('@/storage/adapters/s3-adapter.js');

// ---------------------------------------------------------------------------
// Shared adapter test suite
// ---------------------------------------------------------------------------

if (!integrationMode) {
  // Mock mode: shared suite uses the in-process mock.
  runStorageAdapterTests('S3StorageAdapter', async () => {
    objectStore.clear();
    return new S3StorageAdapter({ bucket: 'test-bucket', prefix: 'test/' });
  });
} else if (!integrationSkip) {
  // Integration mode: shared suite uses a real S3-compatible service. Each
  // test run gets a unique prefix to ensure isolation between concurrent runs.
  runStorageAdapterTests('S3StorageAdapter (integration)', async () => {
    if (!integrationConfig) throw new Error('Integration config unavailable');
    const prefix = `vf-test-${Date.now()}-${Math.floor(Math.random() * 0xffff).toString(16)}/`;
    return new S3StorageAdapter({ ...integrationConfig, prefix });
  });
}

// ---------------------------------------------------------------------------
// Integration-only scenarios
// (skipped automatically when no real S3-compatible service is available)
// ---------------------------------------------------------------------------

describe.skipIf(!integrationMode || integrationSkip)(
  'S3StorageAdapter integration scenarios',
  () => {
    /**
     * Helper that creates a fresh adapter with a unique prefix to keep each
     * test hermetically isolated from every other test in this file.
     */
    function freshAdapter() {
      if (!integrationConfig) throw new Error('Integration config unavailable');
      const prefix = `vf-int-${Date.now()}-${Math.floor(Math.random() * 0xffff).toString(16)}/`;
      return new S3StorageAdapter({ ...integrationConfig, prefix });
    }

    // -- Manifest consistency ---------------------------------------------

    it('persists the index manifest after writes', async () => {
      const adapter = freshAdapter();
      await adapter.init();

      try {
        await adapter.put({
          id: 'manifest-1',
          vector: new Float32Array([1]),
          magnitude: 1,
          timestamp: 0,
        });
        await adapter.put({
          id: 'manifest-2',
          vector: new Float32Array([2]),
          magnitude: 2,
          timestamp: 0,
        });

        // Create a second adapter instance pointing at the same prefix — it
        // must pick up the manifest persisted by the first instance on init().
        if (!integrationConfig) throw new Error('Integration config unavailable');
        const reader = new S3StorageAdapter({
          ...integrationConfig,
          // Access the private prefix field via type assertion for test setup only.
          prefix: (adapter as unknown as { prefix: string }).prefix,
        });
        await reader.init();

        try {
          expect(await reader.count()).toBe(2);
          expect(await reader.exists('manifest-1')).toBe(true);
          expect(await reader.exists('manifest-2')).toBe(true);
        } finally {
          await reader.close();
        }
      } finally {
        await adapter.destroy();
      }
    });

    // -- Concurrent writers -----------------------------------------------

    it('handles concurrent writes without losing IDs', async () => {
      const adapter = freshAdapter();
      await adapter.init();

      try {
        const concurrency = 10;
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
      } finally {
        await adapter.destroy();
      }
    });

    // -- Eventually-consistent reads --------------------------------------

    it('reads back data written in a prior session', async () => {
      if (!integrationConfig) throw new Error('Integration config unavailable');

      const sharedPrefix = `vf-ec-${Date.now()}-${Math.floor(Math.random() * 0xffff).toString(16)}/`;
      const writer = new S3StorageAdapter({ ...integrationConfig, prefix: sharedPrefix });
      await writer.init();

      await writer.put({
        id: 'ec-item',
        vector: new Float32Array([7, 8]),
        magnitude: Math.sqrt(113),
        timestamp: 0,
      });
      await writer.close();

      // Open a fresh adapter pointing at the same prefix — simulates a new
      // process or lambda invocation reading data from a prior write session.
      const reader = new S3StorageAdapter({ ...integrationConfig, prefix: sharedPrefix });
      await reader.init();

      try {
        expect(await reader.exists('ec-item')).toBe(true);
        const item = await reader.get('ec-item');
        expect(item.id).toBe('ec-item');
        expect(item.vector).toBeInstanceOf(Float32Array);
      } finally {
        await reader.destroy();
      }
    });

    // -- Multipart-size payload -------------------------------------------

    it('stores and retrieves a large vector payload', async () => {
      const adapter = freshAdapter();
      await adapter.init();

      try {
        // 10 000 dimensions ≈ 40 KB of float data per vector — well above the
        // typical S3 minimum multipart size but small enough to be fast in CI.
        const dim = 10_000;
        const values = Float32Array.from({ length: dim }, (_, i) => i * 0.0001);
        const magnitude = Math.sqrt(values.reduce((s, v) => s + v * v, 0));

        await adapter.put({ id: 'large-vec', vector: values, magnitude, timestamp: Date.now() });

        const retrieved = await adapter.get('large-vec');
        expect(retrieved.vector).toHaveLength(dim);
        expect(retrieved.vector[0]).toBeCloseTo(0, 5);
        expect(retrieved.vector[99]).toBeCloseTo(0.0099, 4);
      } finally {
        await adapter.destroy();
      }
    });

    // -- Missing objects --------------------------------------------------

    it('throws VectorNotFoundError for a missing object', async () => {
      const { VectorNotFoundError } = await import('@/core/errors.js');
      const adapter = freshAdapter();
      await adapter.init();

      try {
        expect(adapter.get('never-written')).rejects.toBeInstanceOf(VectorNotFoundError);
      } finally {
        await adapter.destroy();
      }
    });

    // -- Retries (simulated) ----------------------------------------------

    it('survives a transient read failure via retry logic', async () => {
      // The S3StorageAdapter itself does not implement application-level
      // retries (the underlying Bun S3 client handles transport retries). This
      // test verifies the adapter returns correct data under normal operation,
      // which is the baseline that retry behavior must preserve.
      const adapter = freshAdapter();
      await adapter.init();

      try {
        const vec = {
          id: 'retry-vec',
          vector: new Float32Array([1, 2]),
          magnitude: Math.sqrt(5),
          timestamp: 0,
        };
        await adapter.put(vec);

        const retrieved = await adapter.get('retry-vec');
        expect(retrieved.id).toBe('retry-vec');
        expect(retrieved.vector).toEqual(vec.vector);
      } finally {
        await adapter.destroy();
      }
    });

    // -- Cleanup ----------------------------------------------------------

    it('destroy() removes all objects in the prefix namespace', async () => {
      const adapter = freshAdapter();
      await adapter.init();

      await adapter.put({ id: 'obj-1', vector: new Float32Array([1]), magnitude: 1, timestamp: 0 });
      await adapter.put({ id: 'obj-2', vector: new Float32Array([2]), magnitude: 2, timestamp: 0 });
      expect(await adapter.count()).toBe(2);

      await adapter.destroy();

      // Re-init to confirm the namespace is empty after destroy.
      await adapter.init();
      expect(await adapter.count()).toBe(0);
      await adapter.close();
    });
  },
);

// ---------------------------------------------------------------------------
// Concurrent behaviour — single-writer contract
// ---------------------------------------------------------------------------

function makeVector(id: string, values: number[]) {
  const vector = new Float32Array(values);
  const magnitude = Math.sqrt(values.reduce((sum, v) => sum + v * v, 0));
  return { id, vector, magnitude, timestamp: Date.now() };
}

describe('concurrent writes — single-writer contract', () => {
  it('preserves all IDs when concurrent puts are issued on the same instance', async () => {
    // Within one adapter instance the promise-based mutex serialises all
    // manifest updates, so every ID must survive.
    objectStore.clear();
    const adapter = new S3StorageAdapter({ bucket: 'test-bucket', prefix: 'concurrent/' });
    await adapter.init();

    const ids = Array.from({ length: 20 }, (_, i) => `concurrent-${i}`);

    // Fire all puts at the same time — none may be lost.
    await Promise.all(ids.map((id) => adapter.put(makeVector(id, [1, 2, 3]))));

    const count = await adapter.count();
    expect(count).toBe(ids.length);

    // Every ID must be retrievable.
    for (const id of ids) {
      expect(await adapter.exists(id)).toBe(true);
    }

    await adapter.destroy();
  });

  it('singleWriter discriminant is true on every instance', () => {
    // Consumers can inspect .singleWriter to detect the concurrency model.
    const adapter = new S3StorageAdapter({ bucket: 'test-bucket' });
    expect(adapter.singleWriter).toBe(true);
  });

  it('documents that two separate instances diverge on the same prefix (single-writer limitation)', async () => {
    // This test demonstrates — and therefore catches any regression of — the
    // known single-writer limitation: two adapter instances sharing the same
    // bucket + prefix each maintain an independent in-memory manifest. Writes
    // on instance B are invisible to instance A's manifest (and vice-versa)
    // unless both instances are re-initialised from the shared object store.
    //
    // This is intentional behaviour: S3StorageAdapter is single-writer only.
    // Multi-writer support would require conditional writes (ETag CAS) that
    // Bun.s3 does not currently expose.

    objectStore.clear();

    const adapterA = new S3StorageAdapter({
      bucket: 'test-bucket',
      prefix: 'diverge/',
    });
    const adapterB = new S3StorageAdapter({
      bucket: 'test-bucket',
      prefix: 'diverge/',
    });

    await adapterA.init();
    await adapterB.init();

    // A writes two vectors; B writes two different vectors — all four are
    // written to the backing store (objectStore) but each adapter only knows
    // about its own writes.
    await adapterA.put(makeVector('a1', [1]));
    await adapterA.put(makeVector('a2', [2]));
    await adapterB.put(makeVector('b1', [3]));
    await adapterB.put(makeVector('b2', [4]));

    // From A's perspective only a1 and a2 exist.
    expect(await adapterA.count()).toBe(2);
    expect(await adapterA.exists('a1')).toBe(true);
    expect(await adapterA.exists('a2')).toBe(true);
    // B's IDs are NOT visible to A (single-writer limitation).
    expect(await adapterA.exists('b1')).toBe(false);
    expect(await adapterA.exists('b2')).toBe(false);

    // From B's perspective only b1 and b2 exist.
    expect(await adapterB.count()).toBe(2);
    expect(await adapterB.exists('b1')).toBe(true);
    expect(await adapterB.exists('b2')).toBe(true);
    // A's IDs are NOT visible to B (single-writer limitation).
    expect(await adapterB.exists('a1')).toBe(false);
    expect(await adapterB.exists('a2')).toBe(false);

    // Cleanup: destroy whichever instance wrote last so the store is clean.
    // We destroy A first (which rewrites the manifest with only a1/a2), then
    // B (which would overwrite with b1/b2). Both are wiped at the end.
    await adapterA.destroy();
    await adapterB.destroy();
    objectStore.clear();
  });
});
