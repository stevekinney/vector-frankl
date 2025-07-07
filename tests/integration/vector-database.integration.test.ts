import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { VectorDB, VectorFrankl } from '@/index.js';
import { setupIndexedDBMocks, cleanupIndexedDBMocks } from '../mocks/indexeddb-mock.js';

describe('Vector Database Integration Tests', () => {
  let db: VectorDB;
  let vectorFrankl: VectorFrankl;
  const testDBName = 'test-vector-db-integration';
  const dimension = 128;

  beforeEach(async () => {
    // Set up IndexedDB mocks for browser APIs
    setupIndexedDBMocks();

    // Clean up any existing databases
    try {
      const existingDB = new VectorDB(testDBName, dimension);
      await existingDB.delete();
    } catch {
      // Ignore errors for non-existent databases
    }

    db = new VectorDB(testDBName, dimension, {
      autoEviction: false, // Disable for controlled testing
      useIndex: true
    });
    await db.init();

    vectorFrankl = new VectorFrankl();
    await vectorFrankl.init();
  });

  afterEach(async () => {
    try {
      await db.delete();
      await vectorFrankl.close();
    } catch (error) {
      console.warn('Cleanup error:', error);
    }
    
    // Clean up IndexedDB mocks
    cleanupIndexedDBMocks();
  });

  describe('Basic Operations', () => {
    it('should add, retrieve, and delete vectors', async () => {
      const vector = new Float32Array(dimension).fill(0.5);
      const metadata = { category: 'test', value: 42 };

      // Add vector
      await db.addVector('test-1', vector, metadata);

      // Retrieve vector
      const retrieved = await db.getVector('test-1');
      expect(retrieved).toBeTruthy();
      expect(retrieved!.id).toBe('test-1');
      expect(retrieved!.vector).toEqual(vector);
      expect(retrieved!.metadata).toEqual(metadata);

      // Check existence
      expect(await db.exists('test-1')).toBe(true);

      // Delete vector
      await db.deleteVector('test-1');
      expect(await db.exists('test-1')).toBe(false);
    });

    it('should handle batch operations', async () => {
      const vectors = Array.from({ length: 100 }, (_, i) => ({
        id: `batch-${i}`,
        vector: new Float32Array(dimension).fill(i / 100),
        metadata: { batch: true, index: i }
      }));

      // Batch add
      await db.addBatch(vectors);

      // Verify all vectors were added
      const stats = await db.getStats();
      expect(stats.vectorCount).toBe(100);

      // Batch retrieve
      const ids = vectors.map(v => v.id);
      const retrieved = await db.getMany(ids);
      expect(retrieved).toHaveLength(100);

      // Batch delete
      const deletedCount = await db.deleteMany(ids.slice(0, 50));
      expect(deletedCount).toBe(50);

      const finalStats = await db.getStats();
      expect(finalStats.vectorCount).toBe(50);
    });

    it('should update vectors and metadata', async () => {
      const originalVector = new Float32Array(dimension).fill(0.5);
      const updatedVector = new Float32Array(dimension).fill(0.8);
      const originalMetadata = { version: 1 };
      const updatedMetadata = { version: 2, updated: true };

      // Add original vector
      await db.addVector('update-test', originalVector, originalMetadata);

      // Update vector
      await db.updateVector('update-test', updatedVector);
      let retrieved = await db.getVector('update-test');
      expect(retrieved!.vector).toEqual(updatedVector);
      expect(retrieved!.metadata).toEqual(originalMetadata); // Metadata unchanged

      // Update metadata
      await db.updateMetadata('update-test', updatedMetadata);
      retrieved = await db.getVector('update-test');
      expect(retrieved!.metadata).toEqual(updatedMetadata);

      // Batch update
      await db.updateBatch([
        { id: 'update-test', metadata: { version: 3 } }
      ]);
      retrieved = await db.getVector('update-test');
      expect(retrieved!.metadata?.['version']).toBe(3);
    });
  });

  describe('Search Functionality', () => {
    beforeEach(async () => {
      // Add test vectors with different patterns
      const testVectors = [
        { id: 'similar-1', vector: new Float32Array(dimension).fill(1.0), metadata: { group: 'A', score: 0.9 } },
        { id: 'similar-2', vector: new Float32Array(dimension).fill(0.9), metadata: { group: 'A', score: 0.8 } },
        { id: 'different-1', vector: new Float32Array(dimension).fill(0.1), metadata: { group: 'B', score: 0.7 } },
        { id: 'different-2', vector: new Float32Array(dimension).fill(-0.5), metadata: { group: 'B', score: 0.6 } },
        { id: 'mixed', vector: (() => {
          const v = new Float32Array(dimension);
          for (let i = 0; i < dimension; i++) {
            v[i] = i % 2 === 0 ? 1.0 : -1.0;
          }
          return v;
        })(), metadata: { group: 'C', score: 0.5 } }
      ];

      await db.addBatch(testVectors);
    });

    it('should perform similarity search', async () => {
      const queryVector = new Float32Array(dimension).fill(0.95);
      const results = await db.search(queryVector, 3);

      expect(results).toHaveLength(3);
      expect(results[0]!.id).toBe('similar-1'); // Should be most similar
      expect(results[0]!.score).toBeGreaterThan(results[1]!.score);
    });

    it('should support metadata filtering', async () => {
      const queryVector = new Float32Array(dimension).fill(0.5);
      
      // Filter by group
      const groupAResults = await db.search(queryVector, 5, {
        filter: { group: 'A' },
        includeMetadata: true
      });

      expect(groupAResults).toHaveLength(2);
      groupAResults.forEach(result => {
        expect(result.metadata?.['group']).toBe('A');
      });

      // Complex filter with score range
      const highScoreResults = await db.search(queryVector, 5, {
        filter: {
          $and: [
            { group: { $in: ['A', 'B'] } },
            { score: { $gte: 0.7 } }
          ]
        },
        includeMetadata: true
      });

      expect(highScoreResults.length).toBeGreaterThan(0);
      highScoreResults.forEach(result => {
        expect(['A', 'B']).toContain(result.metadata?.['group']);
        expect(result.metadata?.['score']).toBeGreaterThanOrEqual(0.7);
      });
    });

    it('should support range queries', async () => {
      const queryVector = new Float32Array(dimension).fill(0.5);
      const maxDistance = 1.0;

      const rangeResults = await db.searchRange(queryVector, maxDistance, {
        maxResults: 10,
        includeMetadata: true
      });

      expect(rangeResults.length).toBeGreaterThan(0);
      rangeResults.forEach(result => {
        expect(result.distance).toBeLessThanOrEqual(maxDistance);
      });
    });

    it('should support streaming search', async () => {
      const queryVector = new Float32Array(dimension).fill(0.5);
      const results: any[] = [];

      for await (const batch of db.searchStream(queryVector, {
        batchSize: 2,
        maxResults: 5,
        includeMetadata: true
      })) {
        results.push(...batch);
      }

      expect(results.length).toBeGreaterThan(0);
      expect(results.length).toBeLessThanOrEqual(5);
    });

    it('should support different distance metrics', async () => {
      const queryVector = new Float32Array(dimension).fill(0.5);

      // Test cosine similarity (default)
      db.setDistanceMetric('cosine');
      const cosineResults = await db.search(queryVector, 3);

      // Test euclidean distance
      db.setDistanceMetric('euclidean');
      const euclideanResults = await db.search(queryVector, 3);

      // Test manhattan distance
      db.setDistanceMetric('manhattan');
      const manhattanResults = await db.search(queryVector, 3);

      // Results should be different with different metrics
      expect(cosineResults).toHaveLength(3);
      expect(euclideanResults).toHaveLength(3);
      expect(manhattanResults).toHaveLength(3);

      // At least some results should be in different order
      const sameOrder = cosineResults.every((result, index) => 
        result.id === euclideanResults[index]?.id
      );
      expect(sameOrder).toBe(false);
    });
  });

  describe('Indexing', () => {
    it('should build and use HNSW index', async () => {
      // Add enough vectors to trigger indexing
      const vectors = Array.from({ length: 500 }, (_, i) => ({
        id: `indexed-${i}`,
        vector: (() => {
          const v = new Float32Array(dimension);
          for (let j = 0; j < dimension; j++) {
            v[j] = Math.random() * 2 - 1; // Random values between -1 and 1
          }
          return v;
        })(),
        metadata: { cluster: Math.floor(i / 100) }
      }));

      await db.addBatch(vectors);

      // Enable indexing and rebuild
      await db.setIndexing(true);
      await db.rebuildIndex();

      const indexStats = db.getIndexStats();
      expect(indexStats.enabled).toBe(true);
      expect(indexStats.nodeCount).toBeGreaterThan(0);

      // Test search with index
      const queryVector = vectors[0]!.vector;
      const results = await db.search(queryVector, 10);
      
      expect(results).toHaveLength(10);
      expect(results[0]!.id).toBe('indexed-0'); // Should find itself first
    });

    it('should persist and load index', async () => {
      // Add vectors and build index
      const vectors = Array.from({ length: 100 }, (_, i) => ({
        id: `persist-${i}`,
        vector: new Float32Array(dimension).fill(i / 100),
        metadata: { index: i }
      }));

      await db.addBatch(vectors);
      await db.setIndexing(true);
      await db.rebuildIndex();

      let indexStats = db.getIndexStats();
      const originalNodeCount = indexStats.nodeCount;
      expect(originalNodeCount).toBeGreaterThan(0);

      // Close and reopen database
      await db.close();
      
      db = new VectorDB(testDBName, dimension, { useIndex: true });
      await db.init();

      // Index should be loaded automatically
      indexStats = db.getIndexStats();
      expect(indexStats.enabled).toBe(true);
      // Note: Node count might differ due to implementation details
    });
  });

  describe('Storage Management', () => {
    it('should monitor storage quota', async () => {
      const quotaInfo = await db.getStorageQuota();
      
      if (quotaInfo) {
        expect(quotaInfo.usage).toBeGreaterThanOrEqual(0);
        expect(quotaInfo.quota).toBeGreaterThan(0);
        expect(quotaInfo.usageRatio).toBeGreaterThanOrEqual(0);
        expect(quotaInfo.usageRatio).toBeLessThanOrEqual(1);
        expect(quotaInfo.available).toBeGreaterThanOrEqual(0);
      }
    });

    it('should provide eviction statistics and suggestions', async () => {
      // Add some vectors with different access patterns
      const vectors = Array.from({ length: 50 }, (_, i) => ({
        id: `eviction-${i}`,
        vector: new Float32Array(dimension).fill(i / 50),
        metadata: { 
          priority: i < 10 ? 1.0 : 0.5, // First 10 are high priority
          permanent: i < 5 // First 5 are permanent
        }
      }));

      await db.addBatch(vectors);

      // Simulate some access patterns
      for (let i = 0; i < 10; i++) {
        await db.getVector(`eviction-${i}`); // Access first 10 multiple times
      }

      const evictionStats = await db.getEvictionStats();
      
      expect(evictionStats.stats.totalVectors).toBe(50);
      expect(evictionStats.stats.permanentVectors).toBe(5);
      expect(evictionStats.stats.totalEstimatedBytes).toBeGreaterThan(0);
      
      if (evictionStats.suggestion) {
        expect(['lru', 'lfu', 'ttl', 'score', 'hybrid']).toContain(evictionStats.suggestion.strategy);
        expect(evictionStats.suggestion.reasoning).toBeTruthy();
      }
    });

    it('should perform eviction with different strategies', async () => {
      // Add vectors with timestamps
      const vectors = Array.from({ length: 30 }, (_, i) => ({
        id: `evict-test-${i}`,
        vector: new Float32Array(dimension).fill(i / 30),
        metadata: { 
          priority: Math.random(),
          permanent: i < 3 // First 3 are permanent
        }
      }));

      await db.addBatch(vectors);

      // Test LRU eviction
      const lruResult = await db.evictVectors({
        strategy: 'lru',
        maxVectors: 10,
        preservePermanent: true
      });

      expect(lruResult.evictedCount).toBeLessThanOrEqual(10);
      expect(lruResult.evictedCount).toBeGreaterThan(0);
      expect(lruResult.freedBytes).toBeGreaterThan(0);
      expect(lruResult.strategy).toBe('lru');

      // Verify permanent vectors were preserved
      for (let i = 0; i < 3; i++) {
        expect(await db.exists(`evict-test-${i}`)).toBe(true);
      }

      // Test score-based eviction
      const scoreResult = await db.evictVectors({
        strategy: 'score',
        maxVectors: 5
      });

      expect(scoreResult.evictedCount).toBeLessThanOrEqual(5);
      expect(scoreResult.strategy).toBe('score');
    });

    it('should handle quota warnings and auto-eviction', async () => {
      // Enable auto-eviction
      db.setAutoEviction(true);
      expect(db.isAutoEvictionEnabled()).toBe(true);

      db.onQuotaWarning((warning) => {
        expect(warning.type).toMatch(/warning|critical|emergency/);
        expect(warning.message).toBeTruthy();
      });

      // Note: It's difficult to trigger actual quota warnings in tests
      // This test mainly verifies the API is working
      expect(typeof db.getUsageTrend).toBe('function');
      
      const trend = db.getUsageTrend();
      expect(['increasing', 'decreasing', 'stable', 'insufficient_data']).toContain(trend.trend);
      expect(trend.confidence).toBeGreaterThanOrEqual(0);
      expect(trend.confidence).toBeLessThanOrEqual(1);
    });
  });

  describe('Namespace Integration', () => {
    it('should work with namespace system', async () => {
      // Create namespaces with different configurations
      const textNamespace = await vectorFrankl.createNamespace('text-embeddings', {
        dimension: 384,
        distanceMetric: 'cosine',
        description: 'Text embeddings'
      });

      const imageNamespace = await vectorFrankl.createNamespace('image-embeddings', {
        dimension: 512,
        distanceMetric: 'euclidean',
        description: 'Image embeddings'
      });

      // Add vectors to different namespaces
      const textVector = new Float32Array(384).fill(0.5);
      const imageVector = new Float32Array(512).fill(0.8);

      await textNamespace.addVector('text-1', textVector, { type: 'document' });
      await imageNamespace.addVector('image-1', imageVector, { type: 'photo' });

      // Search in specific namespaces
      const textResults = await textNamespace.search(textVector, 5);
      const imageResults = await imageNamespace.search(imageVector, 5);

      expect(textResults).toHaveLength(1);
      expect(imageResults).toHaveLength(1);

      // Namespaces should be isolated
      expect(textResults[0]!.id).toBe('text-1');
      expect(imageResults[0]!.id).toBe('image-1');

      // Clean up namespaces
      await vectorFrankl.deleteNamespace('text-embeddings');
      await vectorFrankl.deleteNamespace('image-embeddings');
    });

    it('should handle namespace storage independently', async () => {
      const ns1 = await vectorFrankl.createNamespace('storage-test-1', {
        dimension: 128,
        description: 'First namespace'
      });

      const ns2 = await vectorFrankl.createNamespace('storage-test-2', {
        dimension: 128,
        description: 'Second namespace'
      });

      // Add different amounts of data to each namespace
      await ns1.addBatch(Array.from({ length: 20 }, (_, i) => ({
        id: `ns1-${i}`,
        vector: new Float32Array(128).fill(i / 20),
        metadata: { namespace: 1 }
      })));

      await ns2.addBatch(Array.from({ length: 10 }, (_, i) => ({
        id: `ns2-${i}`,
        vector: new Float32Array(128).fill(i / 10),
        metadata: { namespace: 2 }
      })));

      // Check stats for each namespace
      const ns1Stats = await ns1.getStats();
      const ns2Stats = await ns2.getStats();

      expect(ns1Stats.vectorCount).toBe(20);
      expect(ns2Stats.vectorCount).toBe(10);

      // Storage usage should be tracked independently
      const quotaInfo = await (vectorFrankl as any).db.getStorageQuota();
      if (quotaInfo?.breakdown) {
        const vectorDBs = quotaInfo.breakdown.vectorDatabases;
        const ns1DB = vectorDBs.find((db: any) => db.name.includes('storage-test-1'));
        const ns2DB = vectorDBs.find((db: any) => db.name.includes('storage-test-2'));

        if (ns1DB && ns2DB) {
          expect(ns1DB.vectorCount).toBe(20);
          expect(ns2DB.vectorCount).toBe(10);
          expect(ns1DB.estimatedSize).toBeGreaterThan(ns2DB.estimatedSize);
        }
      }

      // Clean up
      await vectorFrankl.deleteNamespace('storage-test-1');
      await vectorFrankl.deleteNamespace('storage-test-2');
    });
  });

  describe('Error Handling', () => {
    it('should handle dimension mismatches', async () => {
      const wrongDimensionVector = new Float32Array(64).fill(0.5); // Wrong dimension

      expect(async () => await db.addVector('wrong-dim', wrongDimensionVector)).toThrow();
    });

    it('should handle non-existent vectors', async () => {
      const result = await db.getVector('non-existent');
      expect(result).toBeNull();

      expect(async () => await db.updateVector('non-existent', new Float32Array(dimension))).toThrow();
    });

    it('should handle corrupted or invalid data gracefully', async () => {
      // Add a valid vector first
      await db.addVector('valid', new Float32Array(dimension).fill(0.5));

      // Try to search with invalid query vector
      const invalidQuery = new Float32Array(64); // Wrong dimension
      expect(async () => await db.search(invalidQuery)).toThrow();

      // Original data should still be accessible
      const retrieved = await db.getVector('valid');
      expect(retrieved).toBeTruthy();
    });
  });

  describe('Performance Considerations', () => {
    it('should handle large batch operations efficiently', async () => {
      const largeBatch = Array.from({ length: 1000 }, (_, i) => ({
        id: `perf-${i}`,
        vector: new Float32Array(dimension).fill(Math.random()),
        metadata: { batch: 'large', index: i }
      }));

      const startTime = performance.now();
      await db.addBatch(largeBatch, { batchSize: 100 });
      const duration = performance.now() - startTime;

      // Should complete within reasonable time (adjust as needed)
      expect(duration).toBeLessThan(10000); // 10 seconds

      // Verify all vectors were added
      const stats = await db.getStats();
      expect(stats.vectorCount).toBe(1000);

      // Test search performance
      const searchStart = performance.now();
      const results = await db.search(largeBatch[0]!.vector, 10);
      const searchDuration = performance.now() - searchStart;

      expect(results).toHaveLength(10);
      expect(searchDuration).toBeLessThan(1000); // 1 second
    });

    it('should maintain reasonable memory usage', async () => {
      // This test is basic - real memory testing would require more sophisticated tools
      const initialMemory = (performance as any).memory?.usedJSHeapSize || 0;

      // Add a moderate amount of data
      const vectors = Array.from({ length: 500 }, (_, i) => ({
        id: `memory-${i}`,
        vector: new Float32Array(dimension).fill(Math.random()),
        metadata: { test: 'memory', index: i }
      }));

      await db.addBatch(vectors);

      const afterMemory = (performance as any).memory?.usedJSHeapSize || 0;
      
      if (afterMemory > 0 && initialMemory > 0) {
        const memoryIncrease = afterMemory - initialMemory;
        const expectedSize = vectors.length * dimension * 4; // Rough estimate
        
        // Memory increase should be reasonable (within 5x of expected)
        expect(memoryIncrease).toBeLessThan(expectedSize * 5);
      }
    });
  });
});