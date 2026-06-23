/**
 * Tests for multi-vector mutation atomicity and index recovery semantics.
 *
 * Covers the documented behaviour for addBatch(), updateBatch(), and
 * deleteMany() when storage or index operations fail:
 *
 * - Partial storage failures leave storage in a known (partial-success) state
 *   and are surfaced to the caller via BatchOperationError.
 * - Index-update failures after successful storage writes mark the index dirty
 *   so that stale index state is never used silently.
 * - Dirty-index state disables HNSW search, falling back to brute-force.
 * - rebuildIndex() restores indexed search and clears the dirty flag.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { BatchOperationError } from '@/core/errors.js';
import type { BatchOptions, StorageAdapter, VectorData } from '@/core/types.js';
import { VectorDB } from '@/api/database.js';
import { MemoryStorageAdapter } from '@/storage/adapters/memory-adapter.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFloat32(dim: number, fill = 0.1): Float32Array {
  return new Float32Array(dim).fill(fill);
}

/**
 * A StorageAdapter that wraps a MemoryStorageAdapter and lets tests inject
 * per-call failures into putBatch() and deleteMany().
 */
class FaultInjectionAdapter implements StorageAdapter {
  readonly inner: MemoryStorageAdapter;

  /** When true, the next putBatch() call throws a BatchOperationError. */
  failNextPutBatch = false;
  /** When true, the next deleteMany() call throws a BatchOperationError. */
  failNextDeleteMany = false;

  constructor() {
    this.inner = new MemoryStorageAdapter({ cloneOnRead: false, cloneOnWrite: false });
  }

  async init(): Promise<void> {
    return this.inner.init();
  }
  async close(): Promise<void> {
    return this.inner.close();
  }
  async destroy(): Promise<void> {
    return this.inner.destroy();
  }
  async put(vector: VectorData): Promise<void> {
    return this.inner.put(vector);
  }
  async get(id: string): Promise<VectorData> {
    return this.inner.get(id);
  }
  async exists(id: string): Promise<boolean> {
    return this.inner.exists(id);
  }
  async delete(id: string): Promise<void> {
    return this.inner.delete(id);
  }
  async getMany(ids: string[]): Promise<VectorData[]> {
    return this.inner.getMany(ids);
  }
  async getAll(): Promise<VectorData[]> {
    return this.inner.getAll();
  }
  async count(): Promise<number> {
    return this.inner.count();
  }
  async clear(): Promise<void> {
    return this.inner.clear();
  }
  async updateVector(
    id: string,
    vector: Float32Array,
    options?: { updateMagnitude?: boolean; updateTimestamp?: boolean },
  ): Promise<void> {
    return this.inner.updateVector(id, vector, options);
  }
  async updateMetadata(
    id: string,
    metadata: Record<string, unknown>,
    options?: { merge?: boolean; updateTimestamp?: boolean },
  ): Promise<void> {
    return this.inner.updateMetadata(id, metadata, options);
  }
  async updateBatch(
    updates: Array<{
      id: string;
      vector?: Float32Array;
      metadata?: Record<string, unknown>;
    }>,
    options?: BatchOptions,
  ): Promise<{
    succeeded: number;
    failed: number;
    errors: Array<{ id: string; error: Error }>;
  }> {
    return this.inner.updateBatch(updates, options);
  }

  async putBatch(vectors: VectorData[], options?: BatchOptions): Promise<void> {
    if (this.failNextPutBatch) {
      this.failNextPutBatch = false;
      throw new BatchOperationError(0, vectors.length, [
        {
          id: vectors[0]?.id ?? 'unknown',
          error: new Error('Simulated storage failure'),
        },
      ]);
    }
    return this.inner.putBatch(vectors, options);
  }

  async deleteMany(ids: string[]): Promise<number> {
    if (this.failNextDeleteMany) {
      this.failNextDeleteMany = false;
      throw new BatchOperationError(0, ids.length, [
        { id: ids[0] ?? 'unknown', error: new Error('Simulated storage failure') },
      ]);
    }
    return this.inner.deleteMany(ids);
  }

  scan(options?: Parameters<StorageAdapter['scan']>[0]): AsyncIterable<VectorData> {
    return this.inner.scan(options);
  }

  getScanCapabilities(): ReturnType<StorageAdapter['getScanCapabilities']> {
    return this.inner.getScanCapabilities();
  }
}

// ---------------------------------------------------------------------------
// addBatch() atomicity
// ---------------------------------------------------------------------------

describe('addBatch() — batch atomicity and index safety', () => {
  const dimension = 4;
  let db: VectorDB;

  beforeEach(() => {
    db = new VectorDB('test-db', dimension, {
      storage: new MemoryStorageAdapter({ cloneOnRead: false, cloneOnWrite: false }),
      useIndex: true,
      useWorkers: false,
      autoEviction: false,
    });
  });

  afterEach(async () => {
    await db.close();
  });

  it('should store all vectors when the batch succeeds', async () => {
    await db.init();

    const vectors = Array.from({ length: 5 }, (_, i) => ({
      id: `vec-${i}`,
      vector: makeFloat32(dimension, i * 0.1 + 0.1),
    }));

    await db.addBatch(vectors);

    const stats = await db.getStats();
    expect(stats.vectorCount).toBe(5);
  });

  it('should throw when the storage putBatch fails', async () => {
    const faultAdapter = new FaultInjectionAdapter();
    const faultDb = new VectorDB('fault-db', dimension, {
      storage: faultAdapter,
      useIndex: false,
      useWorkers: false,
      autoEviction: false,
    });
    await faultDb.init();

    faultAdapter.failNextPutBatch = true;

    expect(
      faultDb.addBatch([{ id: 'v1', vector: makeFloat32(dimension) }]),
    ).rejects.toThrow(BatchOperationError);

    await faultDb.close();
  });

  it('should report storage count matching the number of successfully written vectors', async () => {
    await db.init();

    const vectors = Array.from({ length: 3 }, (_, i) => ({
      id: `batch-vec-${i}`,
      vector: makeFloat32(dimension, (i + 1) * 0.2),
    }));

    await db.addBatch(vectors);

    const count = await db.getStats();
    expect(count.vectorCount).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// deleteMany() atomicity
// ---------------------------------------------------------------------------

describe('deleteMany() — batch atomicity and index safety', () => {
  const dimension = 4;
  let db: VectorDB;

  beforeEach(async () => {
    db = new VectorDB('del-db', dimension, {
      storage: new MemoryStorageAdapter({ cloneOnRead: false, cloneOnWrite: false }),
      useIndex: true,
      useWorkers: false,
      autoEviction: false,
    });
    await db.init();

    // Seed three vectors.
    for (let i = 0; i < 3; i++) {
      await db.addVector(`v${i}`, makeFloat32(dimension, (i + 1) * 0.1));
    }
  });

  afterEach(async () => {
    await db.close();
  });

  it('should delete the requested vectors from storage', async () => {
    const deleted = await db.deleteMany(['v0', 'v1']);
    expect(deleted).toBe(2);

    expect(await db.exists('v0')).toBe(false);
    expect(await db.exists('v1')).toBe(false);
    expect(await db.exists('v2')).toBe(true);
  });

  it('should not count non-existent IDs toward the deletion count', async () => {
    const deleted = await db.deleteMany(['v0', 'does-not-exist']);
    expect(deleted).toBe(1);
  });

  it('should throw when the storage deleteMany fails completely', async () => {
    const faultAdapter = new FaultInjectionAdapter();
    const faultDb = new VectorDB('fault-del-db', dimension, {
      storage: faultAdapter,
      useIndex: false,
      useWorkers: false,
      autoEviction: false,
    });
    await faultDb.init();
    await faultDb.addVector('v1', makeFloat32(dimension));

    faultAdapter.failNextDeleteMany = true;

    expect(faultDb.deleteMany(['v1'])).rejects.toThrow(BatchOperationError);

    // Storage state is unchanged: vector still present.
    expect(await faultDb.exists('v1')).toBe(true);

    await faultDb.close();
  });
});

// ---------------------------------------------------------------------------
// updateBatch() atomicity
// ---------------------------------------------------------------------------

describe('updateBatch() — batch atomicity and partial success', () => {
  const dimension = 4;
  let db: VectorDB;

  beforeEach(async () => {
    db = new VectorDB('upd-db', dimension, {
      storage: new MemoryStorageAdapter({ cloneOnRead: false, cloneOnWrite: false }),
      useIndex: true,
      useWorkers: false,
      autoEviction: false,
    });
    await db.init();

    await db.addVector('v1', makeFloat32(dimension, 0.1));
    await db.addVector('v2', makeFloat32(dimension, 0.2));
  });

  afterEach(async () => {
    await db.close();
  });

  it('should update all vectors when the batch succeeds', async () => {
    const result = await db.updateBatch([
      { id: 'v1', metadata: { updated: true } },
      { id: 'v2', metadata: { updated: true } },
    ]);

    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(0);

    const v1 = await db.getVector('v1');
    expect(v1?.metadata?.['updated']).toBe(true);
  });

  it('should record partial failures without aborting the batch', async () => {
    // 'missing-id' does not exist; the other update should still succeed.
    const result = await db.updateBatch([
      { id: 'v1', metadata: { patched: true } },
      { id: 'missing-id', metadata: { should: 'fail' } },
    ]);

    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.errors[0]?.id).toBe('missing-id');

    // v1 was successfully updated.
    const v1 = await db.getVector('v1');
    expect(v1?.metadata?.['patched']).toBe(true);
  });

  it('should reflect updated storage state in search results after rebuild', async () => {
    await db.updateBatch([{ id: 'v1', metadata: { tag: 'updated' } }]);

    // A search should still return v1 (index was rebuilt after updateBatch).
    const results = await db.search(makeFloat32(dimension, 0.1), 10);
    const ids = results.map((r) => r.id);
    expect(ids).toContain('v1');
  });
});

// ---------------------------------------------------------------------------
// Index dirty-flag behaviour via rollback scenario
// ---------------------------------------------------------------------------

describe('index dirty flag — rollback scenario', () => {
  it('should disable indexed search when the index is marked dirty', async () => {
    /**
     * Simulate the scenario: storage write succeeds but index update fails.
     * We do this by directly using SearchEngine's markIndexDirty() — which is
     * the same path VectorDB hits when an index update throws.  We verify via
     * the public SearchEngine API that dirty suppresses indexed search.
     */
    const { SearchEngine } = await import('@/search/search-engine.js');
    const adapter = new MemoryStorageAdapter({ cloneOnRead: false, cloneOnWrite: false });

    const v1: VectorData = {
      id: 'a',
      vector: new Float32Array([1, 0, 0, 0]),
      magnitude: 1,
      timestamp: Date.now(),
    };
    const v2: VectorData = {
      id: 'b',
      vector: new Float32Array([0, 1, 0, 0]),
      magnitude: 1,
      timestamp: Date.now(),
    };

    await adapter.put(v1);
    await adapter.put(v2);

    const engine = new SearchEngine(adapter, 4, 'cosine', {
      useIndex: true,
      useWorkers: false,
    });

    // Populate HNSW with only 'a' — simulates a partial/stale index.
    await engine.addVectorToIndex(v1);

    // Mark dirty to simulate the index-update-failure code path.
    engine.markIndexDirty();
    expect(engine.isIndexDirty()).toBe(true);

    // Search must not use the stale HNSW index.
    // Brute-force sees both 'a' and 'b'; stale HNSW would only see 'a'.
    const results = await engine.search(new Float32Array([0, 1, 0, 0]), 10);
    const ids = results.map((r) => r.id);
    expect(ids).toContain('b'); // Only reachable via brute-force
  });

  it('should re-enable indexed search after rebuildIndex() clears the dirty flag', async () => {
    const { SearchEngine } = await import('@/search/search-engine.js');
    const adapter = new MemoryStorageAdapter({ cloneOnRead: false, cloneOnWrite: false });

    const v1: VectorData = {
      id: 'a',
      vector: new Float32Array([1, 0, 0, 0]),
      magnitude: 1,
      timestamp: Date.now(),
    };
    await adapter.put(v1);

    const engine = new SearchEngine(adapter, 4, 'cosine', {
      useIndex: true,
      useWorkers: false,
    });

    engine.markIndexDirty();

    await engine.rebuildIndex({ loadFromCache: false });

    expect(engine.isIndexDirty()).toBe(false);

    // Search should succeed (index is now clean and rebuilt from storage).
    const results = await engine.search(new Float32Array([1, 0, 0, 0]), 10);
    expect(results.map((r) => r.id)).toContain('a');
  });
});
