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
