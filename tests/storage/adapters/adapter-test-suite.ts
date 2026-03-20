import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { StorageAdapter, VectorData } from '@/core/types.js';
import { VectorNotFoundError } from '@/core/errors.js';

function makeVector(
  id: string,
  values: number[],
  metadata?: Record<string, unknown>,
): VectorData {
  const vector = new Float32Array(values);
  const magnitude = Math.sqrt(values.reduce((sum, v) => sum + v * v, 0));
  const result: VectorData = { id, vector, magnitude, timestamp: Date.now() };
  if (metadata) {
    result.metadata = metadata;
  }
  return result;
}

export function runStorageAdapterTests(
  name: string,
  createAdapter: () => StorageAdapter | Promise<StorageAdapter>,
  cleanupAdapter?: (adapter: StorageAdapter) => Promise<void>,
): void {
  describe(name, () => {
    let adapter: StorageAdapter;

    beforeEach(async () => {
      adapter = await createAdapter();
      await adapter.init();
    });

    afterEach(async () => {
      if (cleanupAdapter) {
        await cleanupAdapter(adapter);
      } else {
        await adapter.destroy();
      }
    });

    // ── put / get round-trip ──────────────────────────────────────────

    describe('put/get round-trip', () => {
      it('stores and retrieves a vector with matching fields', async () => {
        const vec = makeVector('v1', [1, 2, 3], { label: 'test' });
        await adapter.put(vec);

        const retrieved = await adapter.get('v1');
        expect(retrieved.id).toBe('v1');
        expect(retrieved.magnitude).toBeCloseTo(vec.magnitude);
        expect(retrieved.metadata).toEqual({ label: 'test' });
      });

      it('preserves Float32Array type on round-trip', async () => {
        const vec = makeVector('float-check', [0.1, 0.2, 0.3]);
        await adapter.put(vec);

        const retrieved = await adapter.get('float-check');
        expect(retrieved.vector).toBeInstanceOf(Float32Array);
        expect(retrieved.vector.length).toBe(3);
        expect(retrieved.vector[0]).toBeCloseTo(0.1, 5);
        expect(retrieved.vector[1]).toBeCloseTo(0.2, 5);
        expect(retrieved.vector[2]).toBeCloseTo(0.3, 5);
      });
    });

    // ── get throws VectorNotFoundError ────────────────────────────────

    describe('get with missing ID', () => {
      it('throws VectorNotFoundError for a non-existent ID', async () => {
        try {
          await adapter.get('does-not-exist');
          expect.unreachable('should have thrown');
        } catch (error) {
          expect(error).toBeInstanceOf(VectorNotFoundError);
        }
      });
    });

    // ── getMany ───────────────────────────────────────────────────────

    describe('getMany', () => {
      it('returns found vectors and silently skips missing IDs', async () => {
        await adapter.put(makeVector('a', [1, 0]));
        await adapter.put(makeVector('b', [0, 1]));

        const results = await adapter.getMany(['a', 'missing', 'b']);
        const ids = results.map((v) => v.id).sort();
        expect(ids).toEqual(['a', 'b']);
      });

      it('returns an empty array when all IDs are missing', async () => {
        const results = await adapter.getMany(['x', 'y', 'z']);
        expect(results).toHaveLength(0);
      });
    });

    // ── exists ────────────────────────────────────────────────────────

    describe('exists', () => {
      it('returns false for a non-existent vector', async () => {
        expect(await adapter.exists('nope')).toBe(false);
      });

      it('returns true after storing a vector', async () => {
        await adapter.put(makeVector('present', [1]));
        expect(await adapter.exists('present')).toBe(true);
      });
    });

    // ── delete ────────────────────────────────────────────────────────

    describe('delete', () => {
      it('removes a stored vector', async () => {
        await adapter.put(makeVector('del-me', [1, 2]));
        expect(await adapter.exists('del-me')).toBe(true);

        await adapter.delete('del-me');
        expect(await adapter.exists('del-me')).toBe(false);
      });
    });

    // ── deleteMany ────────────────────────────────────────────────────

    describe('deleteMany', () => {
      it('removes multiple vectors and returns the count of actually deleted items', async () => {
        await adapter.put(makeVector('dm-1', [1]));
        await adapter.put(makeVector('dm-2', [2]));
        await adapter.put(makeVector('dm-3', [3]));

        const deleted = await adapter.deleteMany(['dm-1', 'dm-3', 'no-such-id']);
        expect(deleted).toBe(2);

        expect(await adapter.exists('dm-1')).toBe(false);
        expect(await adapter.exists('dm-2')).toBe(true);
        expect(await adapter.exists('dm-3')).toBe(false);
      });
    });

    // ── count ─────────────────────────────────────────────────────────

    describe('count', () => {
      it('returns 0 for an empty store', async () => {
        expect(await adapter.count()).toBe(0);
      });

      it('returns the correct number after inserts', async () => {
        await adapter.put(makeVector('c1', [1]));
        await adapter.put(makeVector('c2', [2]));
        await adapter.put(makeVector('c3', [3]));
        expect(await adapter.count()).toBe(3);
      });
    });

    // ── getAll ────────────────────────────────────────────────────────

    describe('getAll', () => {
      it('returns all stored vectors', async () => {
        await adapter.put(makeVector('ga-1', [1, 0]));
        await adapter.put(makeVector('ga-2', [0, 1]));

        const all = await adapter.getAll();
        const ids = all.map((v) => v.id).sort();
        expect(ids).toEqual(['ga-1', 'ga-2']);
      });

      it('returns an empty array when the store is empty', async () => {
        const all = await adapter.getAll();
        expect(all).toHaveLength(0);
      });
    });

    // ── clear ─────────────────────────────────────────────────────────

    describe('clear', () => {
      it('removes everything from the store', async () => {
        await adapter.put(makeVector('cl-1', [1]));
        await adapter.put(makeVector('cl-2', [2]));
        expect(await adapter.count()).toBe(2);

        await adapter.clear();
        expect(await adapter.count()).toBe(0);
      });
    });

    // ── putBatch with progress and abort ──────────────────────────────

    describe('putBatch', () => {
      it('stores all vectors and invokes the progress callback', async () => {
        const vectors = Array.from({ length: 25 }, (_, i) =>
          makeVector(`batch-${i}`, [i, i + 1]),
        );

        const progressReports: Array<{
          completed: number;
          total: number;
          percentage: number;
        }> = [];

        await adapter.putBatch(vectors, {
          batchSize: 10,
          onProgress(progress) {
            progressReports.push({
              completed: progress.completed,
              total: progress.total,
              percentage: progress.percentage,
            });
          },
        });

        expect(await adapter.count()).toBe(25);
        expect(progressReports.length).toBeGreaterThan(0);

        const lastReport = progressReports[progressReports.length - 1]!;
        expect(lastReport.completed).toBe(25);
        expect(lastReport.percentage).toBe(100);
      });

      it('stops processing when the abort signal fires', async () => {
        const vectors = Array.from({ length: 50 }, (_, i) =>
          makeVector(`abort-${i}`, [i]),
        );

        const controller = new AbortController();

        // Abort after the first batch completes
        let batchesSeen = 0;
        const batchPromise = adapter.putBatch(vectors, {
          batchSize: 10,
          abortSignal: controller.signal,
          onProgress() {
            batchesSeen++;
            if (batchesSeen === 1) {
              controller.abort();
            }
          },
        });

        try {
          await batchPromise;
          expect.unreachable('should have thrown');
        } catch {
          // Expected: abort error
        }

        // Fewer than all 50 vectors should have been stored
        const storedCount = await adapter.count();
        expect(storedCount).toBeLessThan(50);
      });
    });

    // ── updateVector ──────────────────────────────────────────────────

    describe('updateVector', () => {
      it('replaces the vector data and recalculates magnitude', async () => {
        await adapter.put(makeVector('uv-1', [1, 0, 0]));

        const newValues = new Float32Array([3, 4, 0]);
        await adapter.updateVector('uv-1', newValues);

        const updated = await adapter.get('uv-1');
        expect(updated.vector).toEqual(newValues);
        expect(updated.magnitude).toBeCloseTo(5); // sqrt(9+16)
      });

      it('throws VectorNotFoundError for a missing ID', async () => {
        try {
          await adapter.updateVector('ghost', new Float32Array([1]));
          expect.unreachable('should have thrown');
        } catch (error) {
          expect(error).toBeInstanceOf(VectorNotFoundError);
        }
      });
    });

    // ── updateMetadata ────────────────────────────────────────────────

    describe('updateMetadata', () => {
      it('merges metadata by default', async () => {
        await adapter.put(makeVector('um-1', [1], { a: 1, b: 2 }));

        await adapter.updateMetadata('um-1', { b: 99, c: 3 });

        const updated = await adapter.get('um-1');
        expect(updated.metadata).toEqual({ a: 1, b: 99, c: 3 });
      });

      it('replaces metadata when merge is false', async () => {
        await adapter.put(makeVector('um-2', [1], { a: 1, b: 2 }));

        await adapter.updateMetadata('um-2', { x: 10 }, { merge: false });

        const updated = await adapter.get('um-2');
        expect(updated.metadata).toEqual({ x: 10 });
      });

      it('throws VectorNotFoundError for a missing ID', async () => {
        try {
          await adapter.updateMetadata('ghost', { key: 'value' });
          expect.unreachable('should have thrown');
        } catch (error) {
          expect(error).toBeInstanceOf(VectorNotFoundError);
        }
      });
    });

    // ── updateBatch with partial failures ─────────────────────────────

    describe('updateBatch', () => {
      it('applies updates and reports partial failures', async () => {
        await adapter.put(makeVector('ub-1', [1], { status: 'old' }));
        await adapter.put(makeVector('ub-2', [2]));

        const result = await adapter.updateBatch([
          { id: 'ub-1', metadata: { status: 'new' } },
          { id: 'ub-2', vector: new Float32Array([9, 9]) },
          { id: 'missing', metadata: { nope: true } },
        ]);

        expect(result.succeeded).toBe(2);
        expect(result.failed).toBe(1);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]!.id).toBe('missing');

        const updated1 = await adapter.get('ub-1');
        expect(updated1.metadata).toEqual({ status: 'new' });

        const updated2 = await adapter.get('ub-2');
        expect(updated2.vector).toEqual(new Float32Array([9, 9]));
        expect(updated2.magnitude).toBeCloseTo(Math.sqrt(81 + 81));
      });
    });

    // ── lifecycle ───────────────────────────────────────────────────────

    describe('lifecycle', () => {
      it('close() completes without error', async () => {
        await adapter.close();
        // Re-init so afterEach cleanup can still destroy
        await adapter.init();
      });

      it('init() can be called multiple times (idempotent)', async () => {
        await adapter.init();
        await adapter.init();
        // Should not throw
      });
    });

    // ── putBatch without options ────────────────────────────────────────

    describe('putBatch without options', () => {
      it('stores vectors with no options (default batch size)', async () => {
        const vectors = Array.from({ length: 5 }, (_, i) =>
          makeVector(`no-opts-${i}`, [i]),
        );

        await adapter.putBatch(vectors);
        expect(await adapter.count()).toBe(5);
      });
    });

    // ── put sets timestamp when absent ─────────────────────────────────

    describe('put timestamp handling', () => {
      it('sets timestamp when not provided', async () => {
        const vec: VectorData = {
          id: 'no-ts',
          vector: new Float32Array([1, 2]),
          magnitude: Math.sqrt(5),
          timestamp: 0,
        };
        await adapter.put(vec);

        const retrieved = await adapter.get('no-ts');
        expect(retrieved.timestamp).toBeGreaterThan(0);
      });
    });

    // ── updateVector option branches ───────────────────────────────────

    describe('updateVector options', () => {
      it('skips magnitude recalculation when updateMagnitude is false', async () => {
        await adapter.put(makeVector('uv-mag', [1, 0, 0]));

        const original = await adapter.get('uv-mag');
        const originalMagnitude = original.magnitude;

        await adapter.updateVector('uv-mag', new Float32Array([3, 4, 0]), {
          updateMagnitude: false,
        });

        const updated = await adapter.get('uv-mag');
        expect(updated.vector).toEqual(new Float32Array([3, 4, 0]));
        expect(updated.magnitude).toBeCloseTo(originalMagnitude);
      });

      it('skips timestamp update when updateTimestamp is false', async () => {
        await adapter.put(makeVector('uv-ts', [1, 0, 0]));

        const original = await adapter.get('uv-ts');
        const originalTimestamp = original.timestamp;

        await adapter.updateVector('uv-ts', new Float32Array([3, 4, 0]), {
          updateTimestamp: false,
        });

        const updated = await adapter.get('uv-ts');
        expect(updated.timestamp).toBe(originalTimestamp);
      });
    });

    // ── updateMetadata with no prior metadata ──────────────────────────

    describe('updateMetadata edge cases', () => {
      it('sets metadata on a vector that had no metadata', async () => {
        // Create a vector without metadata
        const vec: VectorData = {
          id: 'no-meta',
          vector: new Float32Array([1]),
          magnitude: 1,
          timestamp: Date.now(),
        };
        await adapter.put(vec);

        await adapter.updateMetadata('no-meta', { added: true });

        const updated = await adapter.get('no-meta');
        expect(updated.metadata).toEqual({ added: true });
      });
    });

    // ── updateBatch with both vector and metadata ──────────────────────

    describe('updateBatch edge cases', () => {
      it('updates both vector and metadata in a single entry', async () => {
        await adapter.put(makeVector('ub-both', [1], { original: true }));

        const result = await adapter.updateBatch([
          {
            id: 'ub-both',
            vector: new Float32Array([5, 5]),
            metadata: { updated: true },
          },
        ]);

        expect(result.succeeded).toBe(1);
        expect(result.failed).toBe(0);

        const updated = await adapter.get('ub-both');
        expect(updated.vector).toEqual(new Float32Array([5, 5]));
        expect(updated.metadata).toEqual({ original: true, updated: true });
        expect(updated.magnitude).toBeCloseTo(Math.sqrt(50));
      });

      it('handles all-success batch', async () => {
        await adapter.put(makeVector('ub-ok-1', [1]));
        await adapter.put(makeVector('ub-ok-2', [2]));

        const result = await adapter.updateBatch([
          { id: 'ub-ok-1', metadata: { done: true } },
          { id: 'ub-ok-2', metadata: { done: true } },
        ]);

        expect(result.succeeded).toBe(2);
        expect(result.failed).toBe(0);
        expect(result.errors).toHaveLength(0);
      });
    });

    // ── delete non-existent ID ─────────────────────────────────────────

    describe('delete edge cases', () => {
      it('does not throw when deleting a non-existent ID', async () => {
        await adapter.delete('never-existed');
        // Should complete without error
      });
    });

    // ── access tracking ───────────────────────────────────────────────

    describe('access tracking', () => {
      it('increments accessCount and updates lastAccessed on get()', async () => {
        await adapter.put(makeVector('at-1', [1, 2]));

        const first = await adapter.get('at-1');
        expect(first.accessCount).toBe(1);
        expect(first.lastAccessed).toBeDefined();
        const firstAccessed = first.lastAccessed!;

        const second = await adapter.get('at-1');
        expect(second.accessCount).toBe(2);
        expect(second.lastAccessed).toBeGreaterThanOrEqual(firstAccessed);
      });
    });
  });
}
