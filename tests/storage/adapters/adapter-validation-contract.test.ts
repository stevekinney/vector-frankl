/**
 * Adapter validation contract tests.
 *
 * This file verifies the documented validation boundary:
 *   - Storage adapters are low-level and do NOT validate inputs.
 *   - Input validation is only guaranteed through the high-level APIs
 *     (`VectorDB` and `VectorFrankl`), which run every user-supplied value
 *     through `InputValidator` before reaching an adapter.
 *
 * These tests serve as a living contract. They document which unsafe inputs an
 * adapter will accept (and silently store), making it explicit that callers who
 * drive adapters directly must validate their own inputs.
 *
 * The high-level API validation boundary is exercised separately in the
 * VectorDB / VectorFrankl tests; here we only confirm the adapter layer
 * makes no guarantees.
 */

import { describe, expect, it, beforeEach } from 'bun:test';
import type { VectorData } from '@/core/types.js';
import { MemoryStorageAdapter } from '@/storage/adapters/memory-adapter.js';

function makeVectorData(
  overrides: Partial<VectorData> & Pick<VectorData, 'id'>,
): VectorData {
  return {
    vector: new Float32Array([1, 0]),
    magnitude: 1,
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('StorageAdapter validation contract', () => {
  describe('MemoryStorageAdapter — low-level interface, no input validation', () => {
    let adapter: MemoryStorageAdapter;

    beforeEach(async () => {
      adapter = new MemoryStorageAdapter();
      await adapter.init();
    });

    // ── ID boundaries ────────────────────────────────────────────────────

    describe('vector ID handling', () => {
      it('accepts and stores an empty string ID without throwing', async () => {
        // Adapters do not validate IDs. The high-level API (VectorDB) rejects
        // empty string IDs before they reach the adapter.
        const vec = makeVectorData({ id: '' });
        await adapter.put(vec);
        expect(await adapter.exists('')).toBe(true);
      });

      it('accepts and stores an ID that exceeds 255 characters without throwing', async () => {
        const longId = 'a'.repeat(256);
        const vec = makeVectorData({ id: longId });
        await adapter.put(vec);
        expect(await adapter.exists(longId)).toBe(true);
      });

      it('accepts and stores an ID containing control characters without throwing', async () => {
        const controlId = 'id\x00test';
        const vec = makeVectorData({ id: controlId });
        await adapter.put(vec);
        expect(await adapter.exists(controlId)).toBe(true);
      });
    });

    // ── Vector dimension limits ──────────────────────────────────────────

    describe('vector dimension handling', () => {
      it('accepts a zero-length vector without throwing', async () => {
        // Adapters do not enforce minimum dimension. VectorDB rejects dimension=0.
        const vec = makeVectorData({
          id: 'zero-dim',
          vector: new Float32Array(0),
          magnitude: 0,
        });
        await adapter.put(vec);
        const retrieved = await adapter.get('zero-dim');
        expect(retrieved.vector).toHaveLength(0);
      });

      it('accepts an extremely large vector without throwing', async () => {
        // Adapters do not enforce the 100k-dimension memory limit. VectorDB does.
        const largeDim = 200_000;
        const largeVector = new Float32Array(largeDim).fill(0.001);
        const vec = makeVectorData({
          id: 'large-dim',
          vector: largeVector,
          magnitude: 1,
        });
        await adapter.put(vec);
        const retrieved = await adapter.get('large-dim');
        expect(retrieved.vector).toHaveLength(largeDim);
      });
    });

    // ── Metadata safety ──────────────────────────────────────────────────

    describe('metadata handling', () => {
      it('accepts metadata with keys starting with double underscores without throwing', async () => {
        // The InputValidator rejects __proto__-style keys. Adapters do not.
        const vec = makeVectorData({
          id: 'meta-unsafe',
          metadata: { __type__: 'value' },
        });
        await adapter.put(vec);
        const retrieved = await adapter.get('meta-unsafe');
        expect(retrieved.metadata).toEqual({ __type__: 'value' });
      });

      it('accepts metadata with deeply nested objects without throwing', async () => {
        let nested: Record<string, unknown> = { leaf: 'value' };
        for (let i = 0; i < 15; i++) {
          nested = { child: nested };
        }
        const vec = makeVectorData({ id: 'deep-meta', metadata: nested });
        await adapter.put(vec);
        expect(await adapter.exists('deep-meta')).toBe(true);
      });

      it('accepts metadata with a very large number of properties without throwing', async () => {
        const metadata: Record<string, string> = {};
        for (let i = 0; i < 1500; i++) {
          metadata[`key${i}`] = 'value';
        }
        const vec = makeVectorData({ id: 'many-props', metadata });
        await adapter.put(vec);
        expect(await adapter.exists('many-props')).toBe(true);
      });
    });

    // ── Batch size limits ────────────────────────────────────────────────

    describe('batch size handling', () => {
      it('accepts a putBatch call with more than 1000 vectors without throwing', async () => {
        // InputValidator.validateBatchData caps at 1000 items. Adapters do not.
        const vectors = Array.from({ length: 1500 }, (_, i) =>
          makeVectorData({ id: `batch-${i}` }),
        );
        await adapter.putBatch(vectors);
        expect(await adapter.count()).toBe(1500);
      });
    });

    // ── High-level API validates; adapters do not ────────────────────────

    describe('high-level API enforces all validation', () => {
      it('documents that VectorDB is the validation boundary, not the adapter', () => {
        // This test serves as an explicit documentation anchor.
        //
        // VectorDB calls InputValidator.validateVectorId, validateDimension,
        // validateMetadata, validateK, and validateSearchOptions before any
        // data reaches a StorageAdapter. Adapters are intentionally kept thin
        // so that validation is concentrated in one place rather than
        // duplicated — with gaps — across every adapter.
        //
        // If you are calling an adapter directly, YOU are responsible for
        // validating inputs before they reach storage.
        expect(true).toBe(true);
      });
    });
  });
});
