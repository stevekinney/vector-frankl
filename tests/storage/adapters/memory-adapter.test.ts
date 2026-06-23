import { describe, expect, it } from 'bun:test';
import type { VectorData } from '@/core/types.js';
import { MemoryStorageAdapter } from '@/storage/adapters/memory-adapter.js';
import { runStorageAdapterTests } from './adapter-test-suite.js';

// Run the shared behavioral test suite with default options (clone on)
runStorageAdapterTests('MemoryStorageAdapter', () => new MemoryStorageAdapter());

// Run the shared suite again with cloning disabled to cover those branches
runStorageAdapterTests(
  'MemoryStorageAdapter (no cloning)',
  () => new MemoryStorageAdapter({ cloneOnRead: false, cloneOnWrite: false }),
);

// Memory-adapter-specific tests
describe('MemoryStorageAdapter-specific', () => {
  describe('seed()', () => {
    it('inserts a vector without modifying timestamps', async () => {
      const adapter = new MemoryStorageAdapter();
      const fixedTime = 1000;

      const vec: VectorData = {
        id: 'seeded',
        vector: new Float32Array([1, 2, 3]),
        magnitude: Math.sqrt(14),
        timestamp: fixedTime,
        lastAccessed: fixedTime,
        accessCount: 42,
      };

      adapter.seed(vec);

      const retrieved = await adapter.get('seeded');
      // seed() should NOT overwrite lastAccessed or timestamp
      expect(retrieved.timestamp).toBe(fixedTime);
      // accessCount is incremented by get(), so it should be 42 + 1 = 43
      expect(retrieved.accessCount).toBe(43);
    });

    it('clones on seed when cloneOnWrite is true', async () => {
      const adapter = new MemoryStorageAdapter({ cloneOnWrite: true });
      const vec: VectorData = {
        id: 'clone-seed',
        vector: new Float32Array([1]),
        magnitude: 1,
        timestamp: Date.now(),
      };

      adapter.seed(vec);
      // Mutate the original — stored copy should be unaffected
      vec.magnitude = 999;

      const retrieved = await adapter.get('clone-seed');
      expect(retrieved.magnitude).toBe(1);
    });

    it('does not clone on seed when cloneOnWrite is false', async () => {
      const adapter = new MemoryStorageAdapter({ cloneOnWrite: false });
      const vec: VectorData = {
        id: 'no-clone-seed',
        vector: new Float32Array([1]),
        magnitude: 1,
        timestamp: Date.now(),
      };

      adapter.seed(vec);
      // Mutate the original — stored copy should be the same reference
      vec.magnitude = 999;

      const retrieved = await adapter.get('no-clone-seed');
      expect(retrieved.magnitude).toBe(999);
    });
  });

  // ── capabilities ──────────────────────────────────────────────────────

  describe('capabilities', () => {
    it('reports metadataIndexing: true', () => {
      const adapter = new MemoryStorageAdapter();
      expect(adapter.capabilities.metadataIndexing).toBe(true);
    });

    it('reports persistence: false', () => {
      const adapter = new MemoryStorageAdapter();
      expect(adapter.capabilities.persistence).toBe(false);
    });

    it('reports transactions: false', () => {
      const adapter = new MemoryStorageAdapter();
      expect(adapter.capabilities.transactions).toBe(false);
    });
  });

  // ── filteredScan ──────────────────────────────────────────────────────

  describe('filteredScan()', () => {
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

    it('returns only vectors whose metadata satisfies the predicate', async () => {
      const adapter = new MemoryStorageAdapter({ cloneOnRead: false, cloneOnWrite: false });
      await adapter.put(makeVector('a', [1, 0], { category: 'science' }));
      await adapter.put(makeVector('b', [0, 1], { category: 'art' }));
      await adapter.put(makeVector('c', [1, 1], { category: 'science' }));

      const results = await adapter.filteredScan((m) => m['category'] === 'science');
      const ids = results.map((v) => v.id).sort();
      expect(ids).toEqual(['a', 'c']);
    });

    it('returns an empty array when no vectors match', async () => {
      const adapter = new MemoryStorageAdapter({ cloneOnRead: false, cloneOnWrite: false });
      await adapter.put(makeVector('a', [1], { type: 'x' }));

      const results = await adapter.filteredScan((m) => m['type'] === 'z');
      expect(results).toHaveLength(0);
    });

    it('returns all vectors when the predicate always returns true', async () => {
      const adapter = new MemoryStorageAdapter({ cloneOnRead: false, cloneOnWrite: false });
      await adapter.put(makeVector('a', [1]));
      await adapter.put(makeVector('b', [2]));

      const results = await adapter.filteredScan(() => true);
      expect(results).toHaveLength(2);
    });

    it('handles vectors with no metadata by treating metadata as {}', async () => {
      const adapter = new MemoryStorageAdapter({ cloneOnRead: false, cloneOnWrite: false });
      // Vector without metadata field
      await adapter.put(makeVector('no-meta', [1]));
      await adapter.put(makeVector('has-meta', [2], { tag: 'yes' }));

      // Predicate that checks for 'tag' key — only 'has-meta' should match
      const results = await adapter.filteredScan((m) => 'tag' in m);
      const ids = results.map((v) => v.id);
      expect(ids).toEqual(['has-meta']);
    });

    it('clones results when cloneOnRead is true', async () => {
      const adapter = new MemoryStorageAdapter({ cloneOnRead: true, cloneOnWrite: true });
      await adapter.put(makeVector('a', [1], { tag: 'original' }));

      const [result] = await adapter.filteredScan(() => true);
      // Mutate the returned record — store should be unaffected
      result!.magnitude = 999;

      const [fresh] = await adapter.filteredScan(() => true);
      expect(fresh!.magnitude).toBeCloseTo(1);
    });

    it('returns only the matching subset from a large store without materializing all vectors', async () => {
      const adapter = new MemoryStorageAdapter({ cloneOnRead: false, cloneOnWrite: false });
      const total = 1000;
      const targetCount = 50;

      for (let i = 0; i < total; i++) {
        const category = i < targetCount ? 'target' : 'other';
        await adapter.put(makeVector(`v${i}`, [i], { category }));
      }

      let predicateCalls = 0;
      const results = await adapter.filteredScan((m) => {
        predicateCalls++;
        return m['category'] === 'target';
      });

      expect(results).toHaveLength(targetCount);
      // The predicate should have been called exactly once per record
      expect(predicateCalls).toBe(total);
    });
  });

  describe('clone isolation', () => {
    it('returns cloned data when cloneOnRead is true (mutation safe)', async () => {
      const adapter = new MemoryStorageAdapter({ cloneOnRead: true, cloneOnWrite: true });
      await adapter.put({
        id: 'iso',
        vector: new Float32Array([1, 2]),
        magnitude: Math.sqrt(5),
        timestamp: Date.now(),
      });

      const first = await adapter.get('iso');
      first.magnitude = 999;

      const second = await adapter.get('iso');
      expect(second.magnitude).toBeCloseTo(Math.sqrt(5));
    });

    it('returns the same reference when cloneOnRead is false', async () => {
      const adapter = new MemoryStorageAdapter({
        cloneOnRead: false,
        cloneOnWrite: false,
      });
      await adapter.put({
        id: 'ref',
        vector: new Float32Array([1, 2]),
        magnitude: Math.sqrt(5),
        timestamp: Date.now(),
      });

      const first = await adapter.get('ref');
      first.magnitude = 999;

      const second = await adapter.get('ref');
      expect(second.magnitude).toBe(999);
    });
  });
});
