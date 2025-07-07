import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { VectorNamespace } from './namespace.js';
import { VectorOperations } from '@/vectors/operations.js';
import { DimensionMismatchError } from '@/core/errors.js';
import type { NamespaceConfig } from '@/core/types.js';

describe('VectorNamespace', () => {
  let namespace: VectorNamespace;
  const config: NamespaceConfig = {
    dimension: 128,
    distanceMetric: 'cosine',
    indexStrategy: 'brute',
    compression: 'none',
    description: 'Test namespace'
  };

  beforeEach(async () => {
    namespace = new VectorNamespace('test-namespace', config, 'test-root');
    await namespace.init();
  });

  afterEach(async () => {
    await namespace.delete();
  });

  describe('initialization', () => {
    it('should initialize with provided config', async () => {
      expect(namespace.name).toBe('test-namespace');
      expect(namespace.config).toEqual(config);
      expect(namespace.getDatabaseName()).toBe('test-root-ns-test-namespace');
    });

    it('should create unique database names', () => {
      const ns1 = new VectorNamespace('ns1', config, 'root');
      const ns2 = new VectorNamespace('ns2', config, 'root');
      
      expect(ns1.getDatabaseName()).toBe('root-ns-ns1');
      expect(ns2.getDatabaseName()).toBe('root-ns-ns2');
      expect(ns1.getDatabaseName()).not.toBe(ns2.getDatabaseName());
    });
  });

  describe('vector operations', () => {
    it('should add and retrieve vectors', async () => {
      const vector = VectorOperations.randomUnit(128);
      const metadata = { title: 'Test Document', category: 'test' };
      
      await namespace.addVector('vec1', vector, metadata);
      
      const retrieved = await namespace.getVector('vec1');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe('vec1');
      expect(retrieved?.metadata).toEqual(metadata);
      expect(retrieved?.vector.length).toBe(128);
    });

    it('should enforce dimension constraints', async () => {
      const wrongVector = VectorOperations.randomUnit(256); // Wrong dimension
      
      expect(
        namespace.addVector('wrong', wrongVector)
      ).rejects.toThrow(DimensionMismatchError);
    });

    it('should handle batch operations', async () => {
      const vectors = Array.from({ length: 10 }, (_, i) => ({
        id: `batch-${i}`,
        vector: VectorOperations.randomUnit(128),
        metadata: { index: i }
      }));

      let progressCount = 0;
      await namespace.addBatch(vectors, {
        onProgress: () => { progressCount++; }
      });

      expect(progressCount).toBeGreaterThan(0);

      const stats = await namespace.getStats();
      expect(stats.vectorCount).toBe(10);
    });

    it('should delete vectors', async () => {
      await namespace.addVector('to-delete', VectorOperations.randomUnit(128));
      
      await namespace.deleteVector('to-delete');
      
      const retrieved = await namespace.getVector('to-delete');
      expect(retrieved).toBeNull();
    });

    it('should check vector existence', async () => {
      await namespace.addVector('exists', VectorOperations.randomUnit(128));
      
      expect(await namespace.exists('exists')).toBe(true);
      expect(await namespace.exists('not-exists')).toBe(false);
    });

    it('should get multiple vectors', async () => {
      const ids = ['multi1', 'multi2', 'multi3'];
      for (const id of ids) {
        await namespace.addVector(id, VectorOperations.randomUnit(128));
      }

      const vectors = await namespace.getMany(ids);
      expect(vectors).toHaveLength(3);
      expect(vectors.map(v => v.id).sort()).toEqual(ids);
    });

    it('should delete multiple vectors', async () => {
      const ids = ['del1', 'del2', 'del3', 'del4'];
      for (const id of ids) {
        await namespace.addVector(id, VectorOperations.randomUnit(128));
      }

      const deleted = await namespace.deleteMany(['del1', 'del3']);
      expect(deleted).toBe(2);

      expect(await namespace.exists('del1')).toBe(false);
      expect(await namespace.exists('del2')).toBe(true);
      expect(await namespace.exists('del3')).toBe(false);
      expect(await namespace.exists('del4')).toBe(true);
    });
  });

  describe('search', () => {
    beforeEach(async () => {
      // Add test vectors
      const testData = [
        { id: 'doc1', category: 'tech', title: 'AI Research' },
        { id: 'doc2', category: 'tech', title: 'Machine Learning' },
        { id: 'doc3', category: 'business', title: 'Market Analysis' },
        { id: 'doc4', category: 'business', title: 'Growth Strategy' },
        { id: 'doc5', category: 'tech', title: 'Deep Learning' }
      ];

      for (const data of testData) {
        await namespace.addVector(
          data.id,
          VectorOperations.randomUnit(128),
          data
        );
      }
    });

    it('should search for similar vectors', async () => {
      const query = VectorOperations.randomUnit(128);
      const results = await namespace.search(query, 3);

      expect(results).toHaveLength(3);
      expect(results[0]!.score).toBeGreaterThanOrEqual(results[1]!.score);
      expect(results[1]!.score).toBeGreaterThanOrEqual(results[2]!.score);
    });

    it('should filter by metadata', async () => {
      const query = VectorOperations.randomUnit(128);
      const results = await namespace.search(query, 10, {
        filter: { category: 'tech' },
        includeMetadata: true
      });

      expect(results).toHaveLength(3);
      expect(results.every(r => r.metadata?.['category'] === 'tech')).toBe(true);
    });

    it('should include vectors and metadata when requested', async () => {
      const query = VectorOperations.randomUnit(128);
      const results = await namespace.search(query, 2, {
        includeVector: true,
        includeMetadata: true
      });

      expect(results[0]!.vector).toBeDefined();
      expect(results[0]!.vector?.length).toBe(128);
      expect(results[0]!.metadata).toBeDefined();
    });
  });

  describe('namespace metadata', () => {
    it('should return namespace statistics', async () => {
      const stats = await namespace.getStats();
      
      expect(stats.dimension).toBe(128);
      expect(stats.distanceMetric).toBe('cosine');
      expect(stats.description).toBe('Test namespace');
      expect(stats.vectorCount).toBe(0);
    });

    it('should provide config accessors', () => {
      expect(namespace.getDistanceMetric()).toBe('cosine');
      expect(namespace.getIndexStrategy()).toBe('brute');
      expect(namespace.getCompressionStrategy()).toBe('none');
    });

    it('should use defaults for missing config', () => {
      const minimalNamespace = new VectorNamespace(
        'minimal',
        { dimension: 100 },
        'root'
      );

      expect(minimalNamespace.getDistanceMetric()).toBe('cosine');
      expect(minimalNamespace.getIndexStrategy()).toBe('auto');
      expect(minimalNamespace.getCompressionStrategy()).toBe('none');
    });
  });

  describe('storage estimation', () => {
    it('should estimate storage usage', async () => {
      // Add some vectors
      for (let i = 0; i < 10; i++) {
        await namespace.addVector(
          `vec-${i}`,
          VectorOperations.randomUnit(128),
          { index: i }
        );
      }

      const estimate = await namespace.estimateStorageUsage();
      expect(estimate.vectorCount).toBe(10);
      expect(estimate.estimatedBytes).toBeGreaterThan(0);
      
      // Rough calculation: 128 * 4 bytes + 200 overhead = 712 bytes per vector
      // 10 vectors = ~7120 bytes
      expect(estimate.estimatedBytes).toBeGreaterThanOrEqual(7000);
      expect(estimate.estimatedBytes).toBeLessThan(10000);
    });

    it('should scale with dimension', async () => {
      const largeNamespace = new VectorNamespace(
        'large',
        { dimension: 1024 },
        'test-root'
      );
      await largeNamespace.init();

      await largeNamespace.addVector('v1', VectorOperations.randomUnit(1024));

      const estimate = await largeNamespace.estimateStorageUsage();
      // 1024 * 4 + 200 = 4296 bytes per vector
      expect(estimate.estimatedBytes).toBeGreaterThanOrEqual(4000);
      expect(estimate.estimatedBytes).toBeLessThan(5000);

      await largeNamespace.delete();
    });
  });

  describe('clear and cleanup', () => {
    it('should clear all vectors', async () => {
      // Add vectors
      for (let i = 0; i < 5; i++) {
        await namespace.addVector(`clear-${i}`, VectorOperations.randomUnit(128));
      }

      let stats = await namespace.getStats();
      expect(stats.vectorCount).toBe(5);

      await namespace.clear();

      stats = await namespace.getStats();
      expect(stats.vectorCount).toBe(0);
    });

    it('should close connection', async () => {
      await namespace.close();
      // Should be able to reinitialize
      await namespace.init();
      
      // And still work
      await namespace.addVector('after-close', VectorOperations.randomUnit(128));
      const vector = await namespace.getVector('after-close');
      expect(vector).not.toBeNull();
    });
  });

  describe('getAllVectors', () => {
    it('should retrieve all vectors', async () => {
      const count = 5;
      for (let i = 0; i < count; i++) {
        await namespace.addVector(
          `all-${i}`,
          VectorOperations.randomUnit(128),
          { index: i }
        );
      }

      const allVectors = await namespace.getAllVectors();
      expect(allVectors).toHaveLength(count);
      expect(allVectors.map(v => v.id).sort()).toEqual(
        Array.from({ length: count }, (_, i) => `all-${i}`)
      );
    });
  });
});