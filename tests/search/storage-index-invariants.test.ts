/**
 * Tests for storage-index invariant helpers.
 *
 * Two suites:
 *  1. "invariant helpers detect corruption" — deliberately breaks storage/index
 *     consistency and verifies the helpers report it with useful messages.
 *  2. "invariant helpers pass on normal mutations" — runs public VectorDB
 *     mutations and asserts invariants hold after each one.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { VectorDB } from '@/index.js';
import {
  assertStorageIndexInvariants,
  checkStorageIndexInvariants,
  type VectorDBInternals,
} from '@/test/helpers/storage-index-invariants.js';
import { cleanupIndexedDBMocks, setupIndexedDBMocks } from '../mocks/indexeddb-mock.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const DB_NAME = 'test-invariant-db';
const DIM = 4;

function makeVector(values: number[]): Float32Array {
  return new Float32Array(values);
}

function getInternals(db: VectorDB): VectorDBInternals {
  return db as unknown as VectorDBInternals;
}

/** Build a simple indexed VectorDB and add `count` vectors. */
async function buildIndexedDB(
  name: string,
  count: number,
): Promise<{ db: VectorDB; internals: VectorDBInternals }> {
  const db = new VectorDB(name, DIM, { useIndex: true, autoEviction: false });
  await db.init();

  for (let i = 0; i < count; i++) {
    await db.addVector(`vec-${i}`, makeVector([i * 0.1, 0, 0, 0]));
  }

  // Rebuild so the index is fully populated.
  await db.rebuildIndex();

  return { db, internals: getInternals(db) };
}

// ─── Suite 1: helpers detect deliberately corrupted state ────────────────────

describe('invariant helpers detect corruption', () => {
  let db: VectorDB;

  beforeEach(() => {
    setupIndexedDBMocks();
  });

  afterEach(async () => {
    try {
      await db?.delete();
    } catch {
      // ignore cleanup errors
    }
    cleanupIndexedDBMocks();
  });

  it('reports missing index entry when a vector is in storage but not in the index', async () => {
    ({ db } = await buildIndexedDB(`${DB_NAME}-missing`, 3));
    const internals = getInternals(db);

    // Directly add a vector to storage, bypassing the index.
    const ghostData = {
      id: 'ghost-vec',
      vector: makeVector([0.9, 0, 0, 0]),
      magnitude: 0.9,
      timestamp: Date.now(),
    };
    await internals.storage.put(ghostData);

    // Index still has only 3 nodes; storage now has 4.
    const result = await checkStorageIndexInvariants(internals);

    expect(result.valid).toBe(false);
    expect(result.missingFromIndex).toContain('ghost-vec');
    expect(result.violations.length).toBeGreaterThanOrEqual(1);

    const violation = result.violations.find((v) => v.id === 'ghost-vec');
    expect(violation).toBeDefined();
    expect(violation!.kind).toBe('missing_from_index');
    expect(violation!.message).toContain('ghost-vec');
    expect(violation!.message).toContain('storage');
    expect(violation!.message).toContain('HNSW');
  });

  it('reports stale index entry when a vector is deleted from storage but remains in the index', async () => {
    ({ db } = await buildIndexedDB(`${DB_NAME}-stale`, 3));
    const internals = getInternals(db);

    // Delete from storage only — do NOT call searchEngine.removeVectorFromIndex.
    await internals.storage.delete('vec-1');

    const result = await checkStorageIndexInvariants(internals);

    expect(result.valid).toBe(false);
    expect(result.staleInIndex).toContain('vec-1');
    expect(result.deletedStillIndexed).toContain('vec-1');

    const violation = result.violations.find((v) => v.id === 'vec-1');
    expect(violation).toBeDefined();
    expect(violation!.kind).toBe('deleted_still_indexed');
    expect(violation!.message).toContain('vec-1');
    expect(violation!.message).toContain('storage');
  });

  it('reports duplicated index entries when a node ID appears more than once in the raw exportState list', async () => {
    // The HNSW index's internal Map guarantees uniqueness at runtime, so duplicates
    // can only arise in a pathological index implementation that uses a list rather
    // than a map.  We exercise the helper directly with a synthetic internals object
    // whose hnswIndex.exportState() deliberately returns a duplicate node list.
    ({ db } = await buildIndexedDB(`${DB_NAME}-dup`, 2));
    const internals = getInternals(db);

    const { hnswIndex } = internals.searchEngine;
    if (!hnswIndex) throw new Error('Expected hnswIndex to be initialized');

    const state = hnswIndex.exportState();
    const first = state.nodes[0];
    if (!first) throw new Error('Expected at least one node');

    // Build a synthetic internals object whose exportState returns a duplicate list.
    const duplicatedState = { ...state, nodes: [...state.nodes, { ...first }] };
    const syntheticInternals: VectorDBInternals = {
      storage: internals.storage,
      searchEngine: {
        useIndex: true,
        // A thin shim that returns the doctored state.
        hnswIndex: {
          exportState: () => duplicatedState,
        } as unknown as typeof hnswIndex,
      },
    };

    const result = await checkStorageIndexInvariants(syntheticInternals);

    expect(result.valid).toBe(false);
    expect(result.duplicatedInIndex).toContain(first.id);

    const violation = result.violations.find(
      (v) => v.id === first.id && v.kind === 'duplicated_in_index',
    );
    expect(violation).toBeDefined();
    expect(violation!.message).toContain('times');
  });

  it('reports multiple violations simultaneously', async () => {
    ({ db } = await buildIndexedDB(`${DB_NAME}-multi`, 4));
    const internals = getInternals(db);

    // Create a "missing from index" violation: add to storage only.
    await internals.storage.put({
      id: 'unindexed-vec',
      vector: makeVector([0.5, 0.5, 0, 0]),
      magnitude: Math.sqrt(0.5),
      timestamp: Date.now(),
    });

    // Create a "deleted still indexed" violation: remove from storage only.
    await internals.storage.delete('vec-2');

    const result = await checkStorageIndexInvariants(internals);

    expect(result.valid).toBe(false);
    expect(result.missingFromIndex).toContain('unindexed-vec');
    expect(result.deletedStillIndexed).toContain('vec-2');
    expect(result.violations.length).toBeGreaterThanOrEqual(2);
  });

  it('assertStorageIndexInvariants throws an error listing all violations', async () => {
    ({ db } = await buildIndexedDB(`${DB_NAME}-assert`, 2));
    const internals = getInternals(db);

    // Inject two violations.
    await internals.storage.put({
      id: 'missing-from-idx',
      vector: makeVector([1, 0, 0, 0]),
      magnitude: 1,
      timestamp: Date.now(),
    });
    await internals.storage.delete('vec-0');

    const result = await checkStorageIndexInvariants(internals);

    let thrown: Error | undefined;
    try {
      assertStorageIndexInvariants(result);
    } catch (e) {
      thrown = e as Error;
    }

    expect(thrown).toBeDefined();
    expect(thrown!.message).toContain('invariant violation');
    // Both IDs should appear in the error message.
    expect(thrown!.message).toContain('missing-from-idx');
    expect(thrown!.message).toContain('vec-0');
  });

  it('returns valid:true when index and storage are empty', async () => {
    db = new VectorDB(`${DB_NAME}-empty`, DIM, { useIndex: true, autoEviction: false });
    await db.init();

    const result = await checkStorageIndexInvariants(getInternals(db));

    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('returns valid:true without throwing when indexing is disabled', async () => {
    db = new VectorDB(`${DB_NAME}-noindex`, DIM, { useIndex: false, autoEviction: false });
    await db.init();

    await db.addVector('v1', makeVector([1, 0, 0, 0]));

    const result = await checkStorageIndexInvariants(getInternals(db));

    // No index to check against — helpers should report clean.
    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
  });
});

// ─── Suite 2: invariants hold after normal public mutations ──────────────────

describe('invariant helpers pass on normal mutations', () => {
  let db: VectorDB;

  beforeEach(() => {
    setupIndexedDBMocks();
  });

  afterEach(async () => {
    try {
      await db?.delete();
    } catch {
      // ignore cleanup errors
    }
    cleanupIndexedDBMocks();
  });

  it('invariant holds after addVector', async () => {
    db = new VectorDB(`${DB_NAME}-add`, DIM, { useIndex: true, autoEviction: false });
    await db.init();

    await db.addVector('a', makeVector([1, 0, 0, 0]));
    await db.addVector('b', makeVector([0, 1, 0, 0]));
    await db.addVector('c', makeVector([0, 0, 1, 0]));

    const result = await checkStorageIndexInvariants(getInternals(db));
    assertStorageIndexInvariants(result);

    expect(result.valid).toBe(true);
  });

  it('invariant holds after deleteVector', async () => {
    ({ db } = await buildIndexedDB(`${DB_NAME}-del`, 5));

    await db.deleteVector('vec-2');

    const result = await checkStorageIndexInvariants(getInternals(db));
    assertStorageIndexInvariants(result);

    expect(result.valid).toBe(true);
  });

  it('invariant holds after addBatch', async () => {
    db = new VectorDB(`${DB_NAME}-batch`, DIM, { useIndex: true, autoEviction: false });
    await db.init();

    await db.addBatch([
      { id: 'b1', vector: makeVector([1, 0, 0, 0]) },
      { id: 'b2', vector: makeVector([0, 1, 0, 0]) },
      { id: 'b3', vector: makeVector([0, 0, 1, 0]) },
    ]);

    const result = await checkStorageIndexInvariants(getInternals(db));
    assertStorageIndexInvariants(result);

    expect(result.valid).toBe(true);
  });

  it('invariant holds after deleteMany', async () => {
    ({ db } = await buildIndexedDB(`${DB_NAME}-delmany`, 6));

    await db.deleteMany(['vec-0', 'vec-3', 'vec-5']);

    const result = await checkStorageIndexInvariants(getInternals(db));
    assertStorageIndexInvariants(result);

    expect(result.valid).toBe(true);
  });

  it('invariant holds after updateVector', async () => {
    ({ db } = await buildIndexedDB(`${DB_NAME}-upd`, 3));

    await db.updateVector('vec-1', makeVector([0.5, 0.5, 0, 0]));

    const result = await checkStorageIndexInvariants(getInternals(db));
    assertStorageIndexInvariants(result);

    expect(result.valid).toBe(true);
  });

  it('invariant holds after updateMetadata', async () => {
    ({ db } = await buildIndexedDB(`${DB_NAME}-meta`, 3));

    await db.updateMetadata('vec-1', { label: 'updated' });

    const result = await checkStorageIndexInvariants(getInternals(db));
    assertStorageIndexInvariants(result);

    expect(result.valid).toBe(true);
  });

  it('invariant holds after updateBatch', async () => {
    ({ db } = await buildIndexedDB(`${DB_NAME}-updbatch`, 4));

    await db.updateBatch([
      { id: 'vec-0', metadata: { tag: 'x' } },
      { id: 'vec-2', vector: new Float32Array([0.1, 0.2, 0.3, 0.4]) },
    ]);

    const result = await checkStorageIndexInvariants(getInternals(db));
    assertStorageIndexInvariants(result);

    expect(result.valid).toBe(true);
  });

  it('invariant holds after clear', async () => {
    ({ db } = await buildIndexedDB(`${DB_NAME}-clear`, 5));

    await db.clear();

    const result = await checkStorageIndexInvariants(getInternals(db));
    assertStorageIndexInvariants(result);

    expect(result.valid).toBe(true);
  });

  it('invariant holds after rebuildIndex', async () => {
    ({ db } = await buildIndexedDB(`${DB_NAME}-rebuild`, 4));

    // Add extra vectors after initial build, then rebuild.
    await db.addVector('extra-1', makeVector([0.8, 0.1, 0, 0]));
    await db.addVector('extra-2', makeVector([0.1, 0.8, 0, 0]));
    await db.rebuildIndex();

    const result = await checkStorageIndexInvariants(getInternals(db));
    assertStorageIndexInvariants(result);

    expect(result.valid).toBe(true);
  });
});
