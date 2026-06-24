import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { NamespaceExistsError, NamespaceNotFoundError } from '@/core/errors.js';
import { MemoryStorageAdapter } from '@/storage/adapters/memory-adapter.js';
import type { NamespaceConfig, NamespaceInfo, VectorData } from '@/core/types.js';
import { AdapterNamespaceRegistry } from './adapter-registry.js';

/**
 * Builds an in-memory adapter backed registry for each test.
 */
function makeRegistry(): {
  registry: AdapterNamespaceRegistry;
  adapter: MemoryStorageAdapter;
} {
  const adapter = new MemoryStorageAdapter();
  const registry = new AdapterNamespaceRegistry(adapter);
  return { registry, adapter };
}

const baseConfig: NamespaceConfig = {
  dimension: 128,
  distanceMetric: 'cosine',
  description: 'test namespace',
};

describe('AdapterNamespaceRegistry', () => {
  let registry: AdapterNamespaceRegistry;
  let adapter: MemoryStorageAdapter;

  beforeEach(async () => {
    ({ registry, adapter } = makeRegistry());
    await registry.init();
  });

  afterEach(async () => {
    await registry.delete();
  });

  describe('initialization', () => {
    it('initializes without error', async () => {
      const { registry: r } = makeRegistry();
      expect(r.init()).resolves.toBeUndefined();
      await r.delete();
    });

    it('is idempotent — multiple init calls are safe', async () => {
      await registry.init();
      expect(registry.init()).resolves.toBeUndefined();
    });
  });

  describe('register', () => {
    it('registers a namespace and returns NamespaceInfo', async () => {
      const info = await registry.register('alpha', baseConfig);

      expect(info.name).toBe('alpha');
      expect(info.config).toEqual(baseConfig);
      expect(info.stats.vectorCount).toBe(0);
      expect(info.stats.storageSize).toBe(0);
      expect(info.created).toBeGreaterThan(0);
      expect(info.modified).toBe(info.created);
    });

    it('throws NamespaceExistsError on duplicate name', async () => {
      await registry.register('dup', baseConfig);
      expect(registry.register('dup', baseConfig)).rejects.toThrow(NamespaceExistsError);
    });

    it('validates namespace names', async () => {
      expect(registry.register('ab', baseConfig)).rejects.toThrow(
        'must be between 3 and 64 characters',
      );
      expect(registry.register('has space', baseConfig)).rejects.toThrow(
        'must contain only alphanumeric',
      );
      expect(registry.register('root', baseConfig)).rejects.toThrow('reserved');
    });
  });

  describe('get', () => {
    it('retrieves a registered namespace', async () => {
      await registry.register('beta', baseConfig);
      const info = await registry.get('beta');

      expect(info?.name).toBe('beta');
      expect(info?.config).toEqual(baseConfig);
    });

    it('returns null for unknown namespace', async () => {
      const info = await registry.get('nonexistent');
      expect(info).toBeNull();
    });
  });

  describe('list', () => {
    it('returns all registered namespaces', async () => {
      await registry.register('list-alpha', { dimension: 64 });
      await registry.register('list-beta', { dimension: 128 });
      await registry.register('list-gamma', { dimension: 256 });

      const list = await registry.list();
      expect(list).toHaveLength(3);
      expect(list.map((n) => n.name).sort()).toEqual([
        'list-alpha',
        'list-beta',
        'list-gamma',
      ]);
    });

    it('returns empty array when no namespaces are registered', async () => {
      const list = await registry.list();
      expect(list).toEqual([]);
    });
  });

  describe('updateStats', () => {
    it('merges partial stat updates', async () => {
      await registry.register('stats-one', baseConfig);

      await registry.updateStats('stats-one', { vectorCount: 100 });
      await registry.updateStats('stats-one', { storageSize: 4096 });

      const info = await registry.get('stats-one');
      expect(info?.stats.vectorCount).toBe(100);
      expect(info?.stats.storageSize).toBe(4096);
    });

    it('throws NamespaceNotFoundError for unknown namespace', async () => {
      expect(registry.updateStats('missing', { vectorCount: 1 })).rejects.toThrow(
        NamespaceNotFoundError,
      );
    });
  });

  describe('unregister', () => {
    it('removes a namespace', async () => {
      await registry.register('to-remove', baseConfig);
      await registry.unregister('to-remove');

      const info = await registry.get('to-remove');
      expect(info).toBeNull();
    });

    it('throws NamespaceNotFoundError for unknown namespace', async () => {
      expect(registry.unregister('missing')).rejects.toThrow(NamespaceNotFoundError);
    });
  });

  describe('exists', () => {
    it('returns true for registered namespaces', async () => {
      await registry.register('exists-one', baseConfig);
      expect(await registry.exists('exists-one')).toBe(true);
    });

    it('returns false for unregistered namespaces', async () => {
      expect(await registry.exists('nope')).toBe(false);
    });
  });

  describe('findByPattern', () => {
    beforeEach(async () => {
      await registry.register('prod-alpha', { dimension: 64 });
      await registry.register('prod-beta', { dimension: 64 });
      await registry.register('dev-gamma', { dimension: 64 });
    });

    it('matches a string substring pattern', async () => {
      const results = await registry.findByPattern('prod');
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.name.startsWith('prod'))).toBe(true);
    });

    it('matches a regex pattern', async () => {
      const results = await registry.findByPattern(/^dev-/);
      expect(results).toHaveLength(1);
      expect(results[0]!.name).toBe('dev-gamma');
    });

    it('returns empty array when nothing matches', async () => {
      const results = await registry.findByPattern('zzz');
      expect(results).toEqual([]);
    });
  });

  describe('getTotalStorageUsage', () => {
    it('sums storageSize across all namespaces', async () => {
      await registry.register('sum-space-one', { dimension: 64 });
      await registry.register('sum-space-two', { dimension: 64 });
      await registry.updateStats('sum-space-one', { storageSize: 1000 });
      await registry.updateStats('sum-space-two', { storageSize: 2000 });

      const total = await registry.getTotalStorageUsage();
      expect(total).toBe(3000);
    });

    it('returns 0 when no namespaces exist', async () => {
      expect(await registry.getTotalStorageUsage()).toBe(0);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Placeholder-vector storage contract
  //
  // AdapterNamespaceRegistry stores namespace metadata as VectorData entries
  // because StorageAdapter was designed around VectorData records. The vector
  // field is a synthetic Float32Array([0]) — a placeholder required by the
  // contract. These tests document and guard that internal representation so
  // adapter authors know what to expect and corruption/migration paths stay
  // explicit.
  // ──────────────────────────────────────────────────────────────────────
  describe('placeholder-vector storage contract (internal)', () => {
    it('persists metadata as a VectorData entry in the underlying adapter', async () => {
      await registry.register('placeholder-one', baseConfig);

      // The adapter stores the namespace as a raw VectorData record.
      const raw = await adapter.get('placeholder-one');
      expect(raw).toBeDefined();
      expect(raw.id).toBe('placeholder-one');
    });

    it('uses a Float32Array([0]) placeholder vector — not real embedding data', async () => {
      await registry.register('placeholder-vec', baseConfig);

      const raw = await adapter.get('placeholder-vec');
      expect(raw.vector).toBeInstanceOf(Float32Array);
      expect(raw.vector.length).toBe(1);
      expect(raw.vector[0]).toBe(0);
    });

    it('stores NamespaceInfo fields in the metadata sub-object', async () => {
      await registry.register('meta-fields', baseConfig);

      const raw = await adapter.get('meta-fields');
      const meta = raw.metadata as Record<string, unknown>;
      expect(meta['name']).toBe('meta-fields');
      expect(meta['config']).toEqual(baseConfig);
      expect(typeof meta['created']).toBe('number');
      expect(typeof meta['modified']).toBe('number');
    });

    it('round-trips NamespaceInfo faithfully through the adapter', async () => {
      const info = await registry.register('round-trip', baseConfig);
      const retrieved = await registry.get('round-trip');

      expect(retrieved).toEqual(info);
    });

    it('survives stats updates without corrupting the metadata', async () => {
      await registry.register('stable-meta', baseConfig);

      await registry.updateStats('stable-meta', {
        vectorCount: 42,
        storageSize: 8192,
        lastAccessed: 9999,
      });

      const info = await registry.get('stable-meta');
      expect(info?.name).toBe('stable-meta');
      expect(info?.config).toEqual(baseConfig);
      expect(info?.stats.vectorCount).toBe(42);
      expect(info?.stats.storageSize).toBe(8192);
      expect(info?.stats.lastAccessed).toBe(9999);
    });

    it('adapter-compatibility: a pre-seeded record with correct metadata shape is readable', async () => {
      // Simulate a migration scenario: another process wrote a VectorData record
      // directly into the adapter with a valid metadata payload. The registry
      // must be able to deserialize it without error.
      const now = Date.now();
      const seededInfo: NamespaceInfo = {
        name: 'migrated-ns',
        config: { dimension: 256, distanceMetric: 'euclidean' },
        stats: { vectorCount: 10, storageSize: 2048 },
        created: now,
        modified: now,
      };

      const record: VectorData = {
        id: 'migrated-ns',
        vector: new Float32Array([0]),
        magnitude: 0,
        normalized: false,
        timestamp: now,
        metadata: {
          name: seededInfo.name,
          config: seededInfo.config,
          stats: seededInfo.stats,
          created: seededInfo.created,
          modified: seededInfo.modified,
        },
      };

      adapter.seed(record);

      const result = await registry.get('migrated-ns');
      expect(result).toEqual(seededInfo);
    });

    it('corruption: a record with missing metadata fields returns an incomplete result without throwing', async () => {
      // Partial record — simulates corruption where metadata is incomplete.
      // The registry deserializes without throwing; callers that need reliable
      // data should validate NamespaceInfo before use.
      const now = Date.now();
      const partial: VectorData = {
        id: 'corrupt-ns',
        vector: new Float32Array([0]),
        magnitude: 0,
        normalized: false,
        timestamp: now,
        metadata: {
          // Intentionally omit name and config
          stats: { vectorCount: 0, storageSize: 0 },
          created: now,
          modified: now,
        },
      };

      adapter.seed(partial);

      // get() must not throw — callers are responsible for validating the result.
      const result = await registry.get('corrupt-ns');
      expect(result).toBeDefined();
      // name will be undefined because we omitted it — this is intentional to
      // document that the registry does NOT validate deserialized payloads.
      expect(result!.name).toBeUndefined();
    });
  });
});
