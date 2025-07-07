import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { NamespaceManager } from './manager.js';
import { VectorOperations } from '@/vectors/operations.js';
import { NamespaceExistsError, NamespaceNotFoundError } from '@/core/errors.js';

describe('NamespaceManager', () => {
  let manager: NamespaceManager;
  const testDbName = 'test-manager-' + Date.now();

  beforeEach(async () => {
    manager = new NamespaceManager(testDbName);
    await manager.init();
  });

  afterEach(async () => {
    await manager.deleteAll();
  });

  describe('initialization', () => {
    it('should initialize successfully', async () => {
      const newManager = new NamespaceManager('test-init');
      expect(newManager.init()).resolves.toBeUndefined();
      await newManager.deleteAll();
    });

    it('should handle multiple init calls', async () => {
      await manager.init();
      await manager.init(); // Should not throw
    });
  });

  describe('createNamespace', () => {
    it('should create a new namespace', async () => {
      const config = {
        dimension: 384,
        distanceMetric: 'cosine' as const,
        description: 'Test namespace'
      };

      const namespace = await manager.createNamespace('test-create', config);

      expect(namespace.name).toBe('test-create');
      expect(namespace.config).toEqual(config);
      
      // Verify it was registered
      const info = await manager.getNamespaceInfo('test-create');
      expect(info?.name).toBe('test-create');
      expect(info?.config).toEqual(config);
    });

    it('should initialize the namespace database', async () => {
      const namespace = await manager.createNamespace('test-init-db', {
        dimension: 100
      });

      // Test that we can use the namespace
      const vector = VectorOperations.randomUnit(100);
      expect(
        namespace.addVector('test-1', vector, { test: true })
      ).resolves.toBeUndefined();

      const retrieved = await namespace.getVector('test-1');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.metadata?.['test']).toBe(true);
    });

    it('should cache created namespaces', async () => {
      await manager.createNamespace('cached', { dimension: 100 });
      
      expect(manager.getCacheSize()).toBe(1);
      
      // Getting it again should use cache
      const namespace = await manager.getNamespace('cached');
      expect(namespace.name).toBe('cached');
      expect(manager.getCacheSize()).toBe(1); // Still 1, not 2
    });

    it('should reject duplicate namespace names', async () => {
      await manager.createNamespace('duplicate', { dimension: 100 });

      expect(
        manager.createNamespace('duplicate', { dimension: 200 })
      ).rejects.toThrow(NamespaceExistsError);
    });

    it('should rollback on failure', async () => {
      // Mock a failure in namespace init
      const config = { dimension: -1 }; // Invalid dimension

      expect(
        manager.createNamespace('fail-test', config)
      ).rejects.toThrow();

      // Namespace should not be registered
      const exists = await manager.namespaceExists('fail-test');
      expect(exists).toBe(false);
    });
  });

  describe('getNamespace', () => {
    it('should retrieve existing namespace from registry', async () => {
      const config = { dimension: 256 };
      await manager.createNamespace('get-test', config);
      
      // Clear cache to force load from registry
      manager.evictFromCache('get-test');
      
      const namespace = await manager.getNamespace('get-test');
      expect(namespace.name).toBe('get-test');
      expect(namespace.config.dimension).toBe(256);
    });

    it('should use cached namespace if available', async () => {
      await manager.createNamespace('cache-test', { dimension: 100 });
      
      // First get (already cached from create)
      const ns1 = await manager.getNamespace('cache-test');
      
      // Second get should return same instance
      const ns2 = await manager.getNamespace('cache-test');
      
      expect(ns1).toBe(ns2); // Same object reference
    });

    it('should update last accessed time', async () => {
      await manager.createNamespace('access-test', { dimension: 100 });
      
      const infoBefore = await manager.getNamespaceInfo('access-test');
      const beforeAccess = infoBefore?.stats.lastAccessed;
      
      // Wait a bit and access
      await new Promise(resolve => setTimeout(resolve, 10));
      manager.evictFromCache('access-test'); // Force reload
      await manager.getNamespace('access-test');
      
      const infoAfter = await manager.getNamespaceInfo('access-test');
      const afterAccess = infoAfter?.stats.lastAccessed;
      
      expect(afterAccess).toBeGreaterThan(beforeAccess || 0);
    });

    it('should throw for non-existent namespace', async () => {
      expect(
        manager.getNamespace('does-not-exist')
      ).rejects.toThrow(NamespaceNotFoundError);
    });
  });

  describe('deleteNamespace', () => {
    it('should delete a namespace', async () => {
      await manager.createNamespace('to-delete', { dimension: 100 });
      
      await manager.deleteNamespace('to-delete');
      
      const exists = await manager.namespaceExists('to-delete');
      expect(exists).toBe(false);
    });

    it('should remove from cache if loaded', async () => {
      await manager.createNamespace('cache-delete', { dimension: 100 });
      expect(manager.getCacheSize()).toBe(1);
      
      await manager.deleteNamespace('cache-delete');
      expect(manager.getCacheSize()).toBe(0);
    });

    it('should delete the namespace database', async () => {
      const namespace = await manager.createNamespace('db-delete', { dimension: 100 });
      
      // Add some data
      await namespace.addVector('test', VectorOperations.randomUnit(100));
      
      await manager.deleteNamespace('db-delete');
      
      // Try to recreate with same name - should work and be empty
      const newNamespace = await manager.createNamespace('db-delete', { dimension: 100 });
      const vector = await newNamespace.getVector('test');
      expect(vector).toBeNull();
    });

    it('should throw for non-existent namespace', async () => {
      expect(
        manager.deleteNamespace('does-not-exist')
      ).rejects.toThrow(NamespaceNotFoundError);
    });
  });

  describe('listNamespaces', () => {
    it('should list all namespaces', async () => {
      const namespaces = [
        { name: 'ns1', dimension: 100 },
        { name: 'ns2', dimension: 200 },
        { name: 'ns3', dimension: 300 }
      ];

      for (const ns of namespaces) {
        await manager.createNamespace(ns.name, { dimension: ns.dimension });
      }

      const list = await manager.listNamespaces();
      expect(list).toHaveLength(3);
      
      const names = list.map(ns => ns.name).sort();
      expect(names).toEqual(['ns1', 'ns2', 'ns3']);
      
      const dimensions = list.map(ns => ({ 
        name: ns.name, 
        dim: ns.config.dimension 
      })).sort((a, b) => a.name.localeCompare(b.name));
      
      expect(dimensions).toEqual([
        { name: 'ns1', dim: 100 },
        { name: 'ns2', dim: 200 },
        { name: 'ns3', dim: 300 }
      ]);
    });
  });

  describe('cache management', () => {
    it('should respect cache limits', async () => {
      // Create 5 namespaces
      for (let i = 1; i <= 5; i++) {
        await manager.createNamespace(`cache-${i}`, { dimension: 100 });
      }
      
      expect(manager.getCacheSize()).toBe(5);
      
      // Set limit to 3
      await manager.setCacheLimit(3);
      
      expect(manager.getCacheSize()).toBe(3);
    });

    it('should evict least recently used', async () => {
      // Create namespaces with delays to ensure different access times
      for (let i = 1; i <= 3; i++) {
        await manager.createNamespace(`lru-${i}`, { dimension: 100 });
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      
      // Access lru-2 to make it more recent
      manager.evictFromCache('lru-2');
      await manager.getNamespace('lru-2');
      
      // Set limit to 2, should evict lru-1 (oldest that wasn't re-accessed)
      await manager.setCacheLimit(2);
      
      expect(manager.getCacheSize()).toBe(2);
    });

    it('should manually evict from cache', async () => {
      await manager.createNamespace('evict-test', { dimension: 100 });
      expect(manager.getCacheSize()).toBe(1);
      
      manager.evictFromCache('evict-test');
      expect(manager.getCacheSize()).toBe(0);
      
      // Should still be accessible from registry
      const namespace = await manager.getNamespace('evict-test');
      expect(namespace.name).toBe('evict-test');
    });
  });

  describe('closeAll', () => {
    it('should close all cached namespaces', async () => {
      await manager.createNamespace('close1', { dimension: 100 });
      await manager.createNamespace('close2', { dimension: 200 });
      
      expect(manager.getCacheSize()).toBe(2);
      
      await manager.closeAll();
      
      expect(manager.getCacheSize()).toBe(0);
    });
  });

  describe('deleteAll', () => {
    it('should delete all namespaces and registry', async () => {
      await manager.createNamespace('del1', { dimension: 100 });
      await manager.createNamespace('del2', { dimension: 200 });
      await manager.createNamespace('del3', { dimension: 300 });
      
      await manager.deleteAll();
      
      // Create new manager with same root name
      const newManager = new NamespaceManager(testDbName);
      await newManager.init();
      
      const list = await newManager.listNamespaces();
      expect(list).toHaveLength(0);
      
      await newManager.deleteAll();
    });
  });

  describe('updateNamespaceStats', () => {
    it('should update namespace statistics', async () => {
      await manager.createNamespace('stats-test', { dimension: 100 });
      
      await manager.updateNamespaceStats('stats-test', {
        vectorCount: 1000,
        storageSize: 4096000
      });
      
      const info = await manager.getNamespaceInfo('stats-test');
      expect(info?.stats.vectorCount).toBe(1000);
      expect(info?.stats.storageSize).toBe(4096000);
    });
  });

  describe('findNamespaces', () => {
    beforeEach(async () => {
      await manager.createNamespace('prod-electronics', { dimension: 100 });
      await manager.createNamespace('prod-clothing', { dimension: 200 });
      await manager.createNamespace('dev-testing', { dimension: 300 });
    });

    it('should find namespaces by pattern', async () => {
      const prodNamespaces = await manager.findNamespaces(/^prod-/);
      expect(prodNamespaces).toHaveLength(2);
      
      const devNamespaces = await manager.findNamespaces('dev');
      expect(devNamespaces).toHaveLength(1);
      expect(devNamespaces[0]!.name).toBe('dev-testing');
    });
  });

  describe('getTotalStorageUsage', () => {
    it('should calculate total storage usage', async () => {
      await manager.createNamespace('storage1', { dimension: 100 });
      await manager.createNamespace('storage2', { dimension: 200 });
      
      await manager.updateNamespaceStats('storage1', { storageSize: 1000000 });
      await manager.updateNamespaceStats('storage2', { storageSize: 2000000 });
      
      const total = await manager.getTotalStorageUsage();
      expect(total).toBe(3000000);
    });
  });
});