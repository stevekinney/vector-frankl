import { describe, expect, it } from 'bun:test';

import type { VectorData } from '@/core/types.js';
import { HNSWIndex } from '@/search/hnsw-index.js';

function makeVector(
  id: string,
  values: number[],
  metadata?: Record<string, unknown>,
): VectorData {
  const vector = new Float32Array(values);
  const magnitude = Math.sqrt(values.reduce((sum, v) => sum + v * v, 0));
  const result: VectorData = {
    id,
    vector,
    magnitude,
    timestamp: Date.now(),
  };
  if (metadata) {
    result.metadata = metadata;
  }
  return result;
}

describe('HNSWIndex', () => {
  describe('exportState / importState round-trip', () => {
    it('should export and import an empty index', () => {
      const index = new HNSWIndex('cosine');
      const state = index.exportState();

      expect(state.nodes).toHaveLength(0);
      expect(state.entryPoint).toBeNull();

      const restored = new HNSWIndex('cosine');
      restored.importState(state);

      expect(restored.size()).toBe(0);
    });

    it('should round-trip a populated index', async () => {
      const index = new HNSWIndex('cosine', { m: 4, efConstruction: 50, maxLevel: 3 });

      const vectors = [
        makeVector('v1', [1, 0, 0, 0]),
        makeVector('v2', [0, 1, 0, 0]),
        makeVector('v3', [0, 0, 1, 0]),
        makeVector('v4', [0, 0, 0, 1]),
        makeVector('v5', [1, 1, 0, 0], { label: 'mixed' }),
      ];

      for (const v of vectors) {
        await index.addVector(v);
      }

      // Export
      const state = index.exportState();
      expect(state.nodes).toHaveLength(5);
      expect(state.entryPoint).not.toBeNull();

      // Import into a fresh index
      const restored = new HNSWIndex('cosine', { m: 4, efConstruction: 50, maxLevel: 3 });
      restored.importState(state);

      expect(restored.size()).toBe(5);

      // Search should still work after import
      const query = new Float32Array([1, 0, 0, 0]);
      const results = await restored.search(query, 3);

      expect(results.length).toBeGreaterThan(0);
      // The closest vector to [1,0,0,0] should be v1
      expect(results[0]!.id).toBe('v1');
    });

    it('should preserve metadata through export/import', async () => {
      const index = new HNSWIndex('cosine');

      await index.addVector(
        makeVector('with-meta', [1, 2, 3], { category: 'test', count: 42 }),
      );

      const state = index.exportState();
      const node = state.nodes.find((n) => n.id === 'with-meta');
      expect(node?.metadata).toEqual({ category: 'test', count: 42 });

      const restored = new HNSWIndex('cosine');
      restored.importState(state);

      const results = await restored.search(new Float32Array([1, 2, 3]), 1);
      expect(results[0]!.metadata).toEqual({ category: 'test', count: 42 });
    });

    it('should preserve connections through export/import', async () => {
      const index = new HNSWIndex('cosine', { m: 4, efConstruction: 50 });

      // Add enough vectors to build meaningful connections
      for (let i = 0; i < 10; i++) {
        const values = [0, 0, 0, 0];
        values[i % 4] = 1;
        await index.addVector(makeVector(`v${i}`, values));
      }

      const originalStats = index.getStats();
      const state = index.exportState();

      const restored = new HNSWIndex('cosine', { m: 4, efConstruction: 50 });
      restored.importState(state);

      const restoredStats = restored.getStats();
      expect(restoredStats.nodeCount).toBe(originalStats.nodeCount);
      expect(restoredStats.avgConnections).toBe(originalStats.avgConnections);
    });
  });
});
