import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { NamespaceRegistry } from './registry.js';
import { NamespaceExistsError, NamespaceNotFoundError } from '@/core/errors.js';

describe('NamespaceRegistry', () => {
  let registry: NamespaceRegistry;
  const testDbName = 'test-registry-' + Date.now();

  beforeEach(async () => {
    registry = new NamespaceRegistry(testDbName);
    await registry.init();
  });

  afterEach(async () => {
    await registry.delete();
  });

  describe('initialization', () => {
    it('should initialize successfully', async () => {
      const newRegistry = new NamespaceRegistry('test-init');
      expect(newRegistry.init()).resolves.toBeUndefined();
      await newRegistry.delete();
    });

    it('should handle multiple init calls', async () => {
      await registry.init();
      await registry.init(); // Should not throw
    });
  });

  describe('register', () => {
    it('should register a new namespace', async () => {
      const config = {
        dimension: 384,
        distanceMetric: 'cosine' as const,
        description: 'Test namespace'
      };

      const info = await registry.register('test-ns', config);

      expect(info.name).toBe('test-ns');
      expect(info.config).toEqual(config);
      expect(info.stats.vectorCount).toBe(0);
      expect(info.stats.storageSize).toBe(0);
      expect(info.created).toBeGreaterThan(0);
      expect(info.modified).toBe(info.created);
    });

    it('should reject duplicate namespace names', async () => {
      const config = { dimension: 100 };
      await registry.register('duplicate', config);

      expect(
        registry.register('duplicate', config)
      ).rejects.toThrow(NamespaceExistsError);
    });

    it('should validate namespace names', async () => {
      const config = { dimension: 100 };

      // Invalid characters
      expect(
        registry.register('test space', config)
      ).rejects.toThrow('must contain only alphanumeric');

      expect(
        registry.register('test!@#', config)
      ).rejects.toThrow('must contain only alphanumeric');

      // Too short
      expect(
        registry.register('ab', config)
      ).rejects.toThrow('must be between 3 and 64 characters');

      // Reserved names
      expect(
        registry.register('root', config)
      ).rejects.toThrow('reserved');

      expect(
        registry.register('system', config)
      ).rejects.toThrow('reserved');
    });

    it('should accept valid namespace names', async () => {
      const config = { dimension: 100 };
      const validNames = [
        'valid-name',
        'valid_name',
        'validName123',
        'VALID_NAME',
        'v123',
        'a'.repeat(64) // Max length
      ];

      for (const name of validNames) {
        const info = await registry.register(name, config);
        expect(info.name).toBe(name);
      }
    });
  });

  describe('get', () => {
    it('should retrieve an existing namespace', async () => {
      const config = {
        dimension: 256,
        distanceMetric: 'euclidean' as const
      };
      const registered = await registry.register('get-test', config);

      const retrieved = await registry.get('get-test');
      expect(retrieved).toEqual(registered);
    });

    it('should return null for non-existent namespace', async () => {
      const result = await registry.get('does-not-exist');
      expect(result).toBeNull();
    });
  });

  describe('list', () => {
    it('should list all namespaces', async () => {
      const namespaces = [
        { name: 'ns1', config: { dimension: 100 } },
        { name: 'ns2', config: { dimension: 200 } },
        { name: 'ns3', config: { dimension: 300 } }
      ];

      for (const ns of namespaces) {
        await registry.register(ns.name, ns.config);
      }

      const list = await registry.list();
      expect(list).toHaveLength(3);
      expect(list.map(ns => ns.name).sort()).toEqual(['ns1', 'ns2', 'ns3']);
    });

    it('should return empty array when no namespaces', async () => {
      const list = await registry.list();
      expect(list).toEqual([]);
    });
  });

  describe('updateStats', () => {
    it('should update namespace statistics', async () => {
      await registry.register('stats-test', { dimension: 100 });

      await registry.updateStats('stats-test', {
        vectorCount: 1000,
        storageSize: 4096000,
        lastAccessed: Date.now()
      });

      const info = await registry.get('stats-test');
      expect(info?.stats.vectorCount).toBe(1000);
      expect(info?.stats.storageSize).toBe(4096000);
      expect(info?.stats.lastAccessed).toBeGreaterThan(0);
      expect(info?.modified).toBeGreaterThan(info?.created || 0);
    });

    it('should throw for non-existent namespace', async () => {
      expect(
        registry.updateStats('does-not-exist', { vectorCount: 100 })
      ).rejects.toThrow(NamespaceNotFoundError);
    });

    it('should merge partial updates', async () => {
      await registry.register('merge-test', { dimension: 100 });

      // First update
      await registry.updateStats('merge-test', {
        vectorCount: 500
      });

      // Second update (partial)
      await registry.updateStats('merge-test', {
        storageSize: 2048000
      });

      const info = await registry.get('merge-test');
      expect(info?.stats.vectorCount).toBe(500); // Preserved
      expect(info?.stats.storageSize).toBe(2048000); // Updated
    });
  });

  describe('unregister', () => {
    it('should remove a namespace', async () => {
      await registry.register('to-delete', { dimension: 100 });
      
      await registry.unregister('to-delete');
      
      const info = await registry.get('to-delete');
      expect(info).toBeNull();
    });

    it('should throw for non-existent namespace', async () => {
      expect(
        registry.unregister('does-not-exist')
      ).rejects.toThrow(NamespaceNotFoundError);
    });
  });

  describe('exists', () => {
    it('should return true for existing namespace', async () => {
      await registry.register('exists-test', { dimension: 100 });
      
      const exists = await registry.exists('exists-test');
      expect(exists).toBe(true);
    });

    it('should return false for non-existent namespace', async () => {
      const exists = await registry.exists('does-not-exist');
      expect(exists).toBe(false);
    });
  });

  describe('findByPattern', () => {
    beforeEach(async () => {
      const namespaces = [
        'products-electronics',
        'products-clothing',
        'documents-manual',
        'documents-guide',
        'images-product',
        'test-namespace'
      ];

      for (const name of namespaces) {
        await registry.register(name, { dimension: 100 });
      }
    });

    it('should find namespaces by string pattern', async () => {
      const results = await registry.findByPattern('products');
      expect(results).toHaveLength(2);
      expect(results.every(ns => ns.name.includes('products'))).toBe(true);
    });

    it('should find namespaces by regex pattern', async () => {
      const results = await registry.findByPattern(/^documents-/);
      expect(results).toHaveLength(2);
      expect(results.map(ns => ns.name).sort()).toEqual([
        'documents-guide',
        'documents-manual'
      ]);
    });

    it('should return empty array for no matches', async () => {
      const results = await registry.findByPattern('no-match');
      expect(results).toEqual([]);
    });
  });

  describe('getTotalStorageUsage', () => {
    it('should calculate total storage across namespaces', async () => {
      await registry.register('ns1', { dimension: 100 });
      await registry.register('ns2', { dimension: 200 });
      await registry.register('ns3', { dimension: 300 });

      await registry.updateStats('ns1', { storageSize: 1000000 });
      await registry.updateStats('ns2', { storageSize: 2000000 });
      await registry.updateStats('ns3', { storageSize: 3000000 });

      const total = await registry.getTotalStorageUsage();
      expect(total).toBe(6000000);
    });

    it('should return 0 when no namespaces', async () => {
      const total = await registry.getTotalStorageUsage();
      expect(total).toBe(0);
    });
  });
});