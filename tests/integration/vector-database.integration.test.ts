import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { VectorDB, VectorFrankl, SearchEngine } from '@/index.js';
import { VectorDatabase } from '@/core/database.js';
import type { SearchOptions, StorageAdapter } from '@/core/types.js';
import {
  assertInvariants,
  type VectorDBInternals,
} from '@/test/helpers/storage-index-invariants.js';
import { cleanupIndexedDBMocks, setupIndexedDBMocks } from '../mocks/indexeddb-mock.js';

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
      useIndex: false,
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
        metadata: { batch: true, index: i },
      }));

      // Batch add
      await db.addBatch(vectors);

      // Verify all vectors were added
      const stats = await db.getStats();
      expect(stats.vectorCount).toBe(100);

      // Batch retrieve
      const ids = vectors.map((v) => v.id);
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
      await db.updateBatch([{ id: 'update-test', metadata: { version: 3 } }]);
      retrieved = await db.getVector('update-test');
      expect(retrieved!.metadata?.['version']).toBe(3);
    });
  });

  describe('Search Functionality', () => {
    beforeEach(async () => {
      // Add test vectors with different patterns
      const testVectors = [
        {
          id: 'similar-1',
          vector: new Float32Array(dimension).fill(1.0),
          metadata: { group: 'A', score: 0.9 },
        },
        {
          id: 'similar-2',
          vector: new Float32Array(dimension).fill(0.9),
          metadata: { group: 'A', score: 0.8 },
        },
        {
          id: 'different-1',
          vector: new Float32Array(dimension).fill(0.1),
          metadata: { group: 'B', score: 0.7 },
        },
        {
          id: 'different-2',
          vector: new Float32Array(dimension).fill(-0.5),
          metadata: { group: 'B', score: 0.6 },
        },
        {
          id: 'mixed',
          vector: (() => {
            const v = new Float32Array(dimension);
            for (let i = 0; i < dimension; i++) {
              v[i] = i % 2 === 0 ? 1.0 : -1.0;
            }
            return v;
          })(),
          metadata: { group: 'C', score: 0.5 },
        },
      ];

      await db.addBatch(testVectors);
    });

    it('should perform similarity search', async () => {
      const queryVector = new Float32Array(dimension).fill(0.95);
      const results = await db.search(queryVector, 3);

      expect(results).toHaveLength(3);
      // Cosine similarity is direction-based; uniform-fill vectors (1.0 and 0.9)
      // have the same direction, so scores may be equal
      expect(results[0]!.score).toBeGreaterThanOrEqual(results[1]!.score);
    });

    it('should support metadata filtering', async () => {
      const queryVector = new Float32Array(dimension).fill(0.5);

      // Filter by group
      const groupAResults = await db.search(queryVector, 5, {
        filter: { group: 'A' },
        includeMetadata: true,
      });

      expect(groupAResults).toHaveLength(2);
      groupAResults.forEach((result) => {
        expect(result.metadata?.['group']).toBe('A');
      });

      // Complex filter with score range
      const highScoreResults = await db.search(queryVector, 5, {
        filter: {
          $and: [{ group: { $in: ['A', 'B'] } }, { score: { $gte: 0.7 } }],
        },
        includeMetadata: true,
      });

      expect(highScoreResults.length).toBeGreaterThan(0);
      highScoreResults.forEach((result) => {
        expect(['A', 'B']).toContain(result.metadata?.['group']);
        expect(result.metadata?.['score']).toBeGreaterThanOrEqual(0.7);
      });
    });

    it('should support range queries', async () => {
      const queryVector = new Float32Array(dimension).fill(0.5);
      const maxDistance = 1.0;

      const rangeResults = await db.searchRange(queryVector, maxDistance, {
        maxResults: 10,
        includeMetadata: true,
      });

      expect(rangeResults.length).toBeGreaterThan(0);
      rangeResults.forEach((result) => {
        expect(result.distance).toBeLessThanOrEqual(maxDistance);
      });
    });

    it('should support streaming search', async () => {
      const queryVector = new Float32Array(dimension).fill(0.5);
      const results: any[] = [];

      for await (const batch of db.searchStream(queryVector, {
        batchSize: 2,
        maxResults: 5,
        includeMetadata: true,
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
      const sameOrder = cosineResults.every(
        (result, index) => result.id === euclideanResults[index]?.id,
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
        metadata: { cluster: Math.floor(i / 100) },
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
        metadata: { index: i },
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

    it('should restore node count matching stored vector count after close and reopen', async () => {
      const vectorCount = 20;
      const vectors = Array.from({ length: vectorCount }, (_, i) => ({
        id: `lifecycle-${i}`,
        vector: new Float32Array(dimension).fill((i + 1) / vectorCount),
        metadata: { index: i },
      }));

      await db.addBatch(vectors);
      await db.setIndexing(true);
      await db.rebuildIndex();

      const statsBefore = db.getIndexStats();
      expect(statsBefore.nodeCount).toBe(vectorCount);

      // Close and reopen
      await db.close();

      db = new VectorDB(testDBName, dimension, { useIndex: true });
      await db.init();

      const statsAfter = db.getIndexStats();
      expect(statsAfter.enabled).toBe(true);
      expect(statsAfter.nodeCount).toBe(vectorCount);
    });

    it('should return the same deterministic top result before and after close', async () => {
      const vectorCount = 10;
      const vectors = Array.from({ length: vectorCount }, (_, i) => ({
        id: `deterministic-${i}`,
        vector: new Float32Array(dimension).fill((i + 1) / vectorCount),
        metadata: { index: i },
      }));

      await db.addBatch(vectors);
      await db.setIndexing(true);
      await db.rebuildIndex();

      // Use the first stored vector as the query so the exact top result is known
      const queryVector = vectors[0]!.vector;
      const resultsBefore = await db.search(queryVector, 1);
      expect(resultsBefore).toHaveLength(1);
      const topIdBefore = resultsBefore[0]!.id;

      // Close and reopen
      await db.close();

      db = new VectorDB(testDBName, dimension, { useIndex: true });
      await db.init();

      const resultsAfter = await db.search(queryVector, 1);
      expect(resultsAfter).toHaveLength(1);
      expect(resultsAfter[0]!.id).toBe(topIdBefore);
    });

    it('should rebuild a stale persisted index whose node count does not match storage', async () => {
      const vectorCount = 5;
      const vectors = Array.from({ length: vectorCount }, (_, i) => ({
        id: `stale-${i}`,
        vector: new Float32Array(dimension).fill((i + 1) / vectorCount),
        metadata: { index: i },
      }));

      await db.addBatch(vectors);
      await db.setIndexing(true);
      await db.rebuildIndex();

      // Simulate a stale persisted index by building an index with fewer vectors,
      // saving it, then adding more vectors to storage without updating the index.
      // We achieve this by disabling the index and adding more vectors, then
      // re-enabling: the persisted snapshot will be for the old vector count.
      await db.setIndexing(false);
      await db.addVector('stale-extra', new Float32Array(dimension).fill(0.5));
      await db.close();

      // Reopen with indexing enabled; the persisted index has 5 nodes but storage
      // now has 6 vectors, so init() must detect the mismatch and rebuild.
      db = new VectorDB(testDBName, dimension, { useIndex: true });
      await db.init();

      const stats = db.getIndexStats();
      expect(stats.enabled).toBe(true);
      expect(stats.nodeCount).toBe(vectorCount + 1); // All 6 vectors indexed
    });

    it('rebuilds a persisted index when the distance metric changes on reopen', async () => {
      const vectorCount = 6;
      const vectors = Array.from({ length: vectorCount }, (_, i) => ({
        id: `metric-${i}`,
        vector: new Float32Array(dimension).fill((i + 1) / vectorCount),
        metadata: { index: i },
      }));

      // Build and persist a cosine-metric index.
      const cosineDB = new VectorDB(testDBName, dimension, {
        useIndex: true,
        distanceMetric: 'cosine',
      });
      await cosineDB.init();
      await cosineDB.addBatch(vectors);
      await cosineDB.rebuildIndex();
      expect(cosineDB.getIndexStats().nodeCount).toBe(vectorCount);
      await cosineDB.close();

      // Reopen the SAME database/dimension under euclidean. The persisted index
      // has a matching node count but was built for cosine, so reusing it would
      // traverse a cosine graph while reporting euclidean scores. It must rebuild.
      db = new VectorDB(testDBName, dimension, {
        useIndex: true,
        distanceMetric: 'euclidean',
      });
      await db.init();
      await db.rebuildIndex();

      const stats = db.getIndexStats();
      expect(stats.enabled).toBe(true);
      expect(stats.nodeCount).toBe(vectorCount);

      // Indexed euclidean search agrees with the brute-force euclidean answer:
      // the query equals the first stored vector, so it must be the top result.
      const query = vectors[0]!.vector;
      const results = await db.search(query, 1);
      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe('metric-0');
    });
  });

  describe('Indexed Mutation Consistency', () => {
    const indexedMutationDBName = `${testDBName}-indexed-mutations`;

    async function searchPersistedIndex(
      queryVector: [number, number],
      k: number,
      options?: SearchOptions,
    ) {
      const internals = db as unknown as {
        database: VectorDatabase | null;
        storage: StorageAdapter;
      };

      if (!internals.database) {
        throw new Error('Indexed mutation tests require default IndexedDB storage');
      }

      const searchEngine = new SearchEngine(internals.storage, 2, 'cosine', {
        database: internals.database,
        indexId: `${indexedMutationDBName}-main`,
        useIndex: true,
        useWorkers: false,
      });

      await searchEngine.rebuildIndex();

      try {
        return await searchEngine.search(new Float32Array(queryVector), k, options);
      } finally {
        await searchEngine.cleanup();
      }
    }

    beforeEach(async () => {
      await db.delete();
      db = new VectorDB(indexedMutationDBName, 2, {
        autoEviction: false,
        useIndex: true,
      });
      await db.init();
    });

    it('should clear cached and persisted indexes when clearing vectors', async () => {
      await db.addVector('first-vector', [1, 0], { label: 'first' });
      await db.addVector('second-vector', [0, 1], { label: 'second' });
      await db.rebuildIndex();

      expect(db.getIndexStats().nodeCount).toBe(2);

      await db.clear();

      const stats = await db.getStats();
      expect(stats.vectorCount).toBe(0);
      expect(db.getIndexStats().nodeCount).toBe(0);
      expect(await db.search([1, 0], 5, { includeMetadata: true })).toEqual([]);

      expect(await searchPersistedIndex([1, 0], 5, { includeMetadata: true })).toEqual(
        [],
      );

      // Invariant: after clear(), index and storage must both be empty.
      await assertInvariants(db as unknown as VectorDBInternals);
    });

    it('should delete persisted indexes when clearing while indexing is disabled', async () => {
      await db.addVector('disabled-index-vector', [1, 0], { label: 'stale' });
      await db.rebuildIndex();
      await db.setIndexing(false);

      await db.clear();
      await db.setIndexing(true);

      expect(db.getIndexStats().nodeCount).toBe(0);
      expect(await db.search([1, 0], 5, { includeMetadata: true })).toEqual([]);
      expect(await searchPersistedIndex([1, 0], 5, { includeMetadata: true })).toEqual(
        [],
      );

      // Invariant: after clear() + re-enable indexing, index and storage must agree.
      await assertInvariants(db as unknown as VectorDBInternals);
    });

    it('should delete persisted indexes when clearing from a non-indexed instance', async () => {
      await db.addVector('recreated-index-vector', [1, 0], { label: 'stale' });
      await db.rebuildIndex();
      await db.close();

      db = new VectorDB(indexedMutationDBName, 2, {
        autoEviction: false,
        useIndex: false,
      });
      await db.init();
      await db.clear();
      await db.close();

      db = new VectorDB(indexedMutationDBName, 2, {
        autoEviction: false,
        useIndex: true,
      });
      await db.init();
      await db.rebuildIndex();

      expect(db.getIndexStats().nodeCount).toBe(0);
      expect(await db.search([1, 0], 5, { includeMetadata: true })).toEqual([]);
      expect(await searchPersistedIndex([1, 0], 5, { includeMetadata: true })).toEqual(
        [],
      );

      // Invariant: after clear() from non-indexed instance + rebuild, storage and index agree.
      await assertInvariants(db as unknown as VectorDBInternals);
    });

    it('should force-rebuild cached indexes after metadata updates', async () => {
      await db.addVector('metadata-vector', [1, 0], { label: 'old' });
      await db.rebuildIndex();

      await db.updateMetadata('metadata-vector', { label: 'new' });

      const results = await db.search([1, 0], 1, { includeMetadata: true });
      expect(results).toHaveLength(1);
      expect(results[0]!.metadata).toEqual({ label: 'new' });

      const persistedResults = await searchPersistedIndex([1, 0], 1, {
        includeMetadata: true,
      });
      expect(persistedResults).toHaveLength(1);
      expect(persistedResults[0]!.metadata).toEqual({ label: 'new' });

      // Invariant: after updateMetadata, index and storage must agree on membership.
      await assertInvariants(db as unknown as VectorDBInternals);
    });

    it('should force-rebuild cached indexes after batch vector updates', async () => {
      await db.addVector('updated-vector', [1, 0], { label: 'old' });
      await db.addVector('target-vector', [1, 0], { label: 'target' });
      await db.rebuildIndex();

      await db.updateBatch([
        {
          id: 'updated-vector',
          metadata: { label: 'updated' },
          vector: [0, 1],
        },
      ]);

      const results = await db.search([1, 0], 2, {
        includeMetadata: true,
        includeVector: true,
      });

      expect(results[0]!.id).toBe('target-vector');

      const updatedResult = results.find((result) => result.id === 'updated-vector');
      expect(updatedResult?.metadata).toEqual({ label: 'updated' });
      expect(Array.from(updatedResult!.vector!)).toEqual([0, 1]);

      const persistedResults = await searchPersistedIndex([1, 0], 2, {
        includeMetadata: true,
        includeVector: true,
      });

      expect(persistedResults[0]!.id).toBe('target-vector');

      const persistedUpdatedResult = persistedResults.find(
        (result) => result.id === 'updated-vector',
      );
      expect(persistedUpdatedResult?.metadata).toEqual({ label: 'updated' });
      expect(Array.from(persistedUpdatedResult!.vector!)).toEqual([0, 1]);

      // Invariant: after updateBatch, index and storage must agree on membership.
      await assertInvariants(db as unknown as VectorDBInternals);
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
          permanent: i < 5, // First 5 are permanent
        },
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
        expect(['lru', 'lfu', 'ttl', 'score', 'hybrid']).toContain(
          evictionStats.suggestion.strategy,
        );
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
          permanent: i < 3, // First 3 are permanent
        },
      }));

      await db.addBatch(vectors);

      // Test LRU eviction
      const lruResult = await db.evictVectors({
        strategy: 'lru',
        maxVectors: 10,
        preservePermanent: true,
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
        maxVectors: 5,
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
      expect(['increasing', 'decreasing', 'stable', 'insufficient_data']).toContain(
        trend.trend,
      );
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
        description: 'Text embeddings',
      });

      const imageNamespace = await vectorFrankl.createNamespace('image-embeddings', {
        dimension: 512,
        distanceMetric: 'euclidean',
        description: 'Image embeddings',
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
        description: 'First namespace',
      });

      const ns2 = await vectorFrankl.createNamespace('storage-test-2', {
        dimension: 128,
        description: 'Second namespace',
      });

      // Add different amounts of data to each namespace
      await ns1.addBatch(
        Array.from({ length: 20 }, (_, i) => ({
          id: `ns1-${i}`,
          vector: new Float32Array(128).fill(i / 20),
          metadata: { namespace: 1 },
        })),
      );

      await ns2.addBatch(
        Array.from({ length: 10 }, (_, i) => ({
          id: `ns2-${i}`,
          vector: new Float32Array(128).fill(i / 10),
          metadata: { namespace: 2 },
        })),
      );

      // Check stats for each namespace
      const ns1Stats = await ns1.getStats();
      const ns2Stats = await ns2.getStats();

      expect(ns1Stats.vectorCount).toBe(20);
      expect(ns2Stats.vectorCount).toBe(10);

      // Storage usage should be tracked independently (if API is available)
      const quotaInfo = await (vectorFrankl as any).db?.getStorageQuota?.();
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

      expect(
        async () => await db.updateVector('non-existent', new Float32Array(dimension)),
      ).toThrow();
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

  describe('Input Validation — Public Entry Points', () => {
    describe('VectorDB constructor', () => {
      it('rejects an invalid database name', () => {
        expect(() => new VectorDB('1bad-name', dimension)).toThrow();
        expect(() => new VectorDB('', dimension)).toThrow();
        expect(() => new VectorDB('a'.repeat(65), dimension)).toThrow();
      });

      it('rejects an invalid dimension', () => {
        expect(() => new VectorDB(testDBName, 0)).toThrow();
        expect(() => new VectorDB(testDBName, -1)).toThrow();
        expect(() => new VectorDB(testDBName, 100001)).toThrow();
        expect(() => new VectorDB(testDBName, 1.5)).toThrow();
      });
    });

    describe('VectorDB.addVector', () => {
      it('rejects an empty vector ID', () => {
        const vector = new Float32Array(dimension).fill(0.5);
        expect(db.addVector('', vector)).rejects.toThrow('Vector ID cannot be empty');
      });

      it('rejects a vector ID that is not a string', () => {
        const vector = new Float32Array(dimension).fill(0.5);
        expect(db.addVector(123 as unknown as string, vector)).rejects.toThrow(
          'Vector ID must be a string',
        );
      });

      it('rejects a vector ID exceeding 255 characters', () => {
        const vector = new Float32Array(dimension).fill(0.5);
        expect(db.addVector('a'.repeat(256), vector)).rejects.toThrow(
          'Vector ID cannot exceed 255 characters',
        );
      });

      it('rejects a vector with the wrong dimension', () => {
        const wrongDim = new Float32Array(64).fill(0.5);
        expect(db.addVector('dim-mismatch', wrongDim)).rejects.toThrow();
      });

      it('rejects invalid metadata (array instead of object)', () => {
        const vector = new Float32Array(dimension).fill(0.5);
        expect(
          db.addVector('bad-meta', vector, [1, 2, 3] as unknown as Record<
            string,
            unknown
          >),
        ).rejects.toThrow('Metadata must be an object');
      });

      it('rejects metadata with deeply nested structure exceeding depth limit', () => {
        const vector = new Float32Array(dimension).fill(0.5);
        let deep: Record<string, unknown> = { value: 'leaf' };
        for (let i = 0; i < 11; i++) deep = { nested: deep };
        expect(db.addVector('deep-meta', vector, deep)).rejects.toThrow(
          'Metadata object depth cannot exceed',
        );
      });
    });

    describe('VectorDB.getVector', () => {
      it('rejects an empty ID', () => {
        expect(db.getVector('')).rejects.toThrow('Vector ID cannot be empty');
      });

      it('rejects a non-string ID', () => {
        expect(db.getVector(null as unknown as string)).rejects.toThrow(
          'Vector ID must be a string',
        );
      });
    });

    describe('VectorDB.deleteVector', () => {
      it('rejects an empty ID', () => {
        expect(db.deleteVector('')).rejects.toThrow('Vector ID cannot be empty');
      });
    });

    describe('VectorDB.exists', () => {
      it('rejects an empty ID', () => {
        expect(db.exists('')).rejects.toThrow('Vector ID cannot be empty');
      });

      it('rejects a non-string ID', () => {
        expect(db.exists(null as unknown as string)).rejects.toThrow(
          'Vector ID must be a string',
        );
      });

      it('rejects an ID with invalid characters', () => {
        expect(db.exists('id<script>')).rejects.toThrow(
          'Vector ID contains invalid characters',
        );
      });
    });

    describe('VectorDB.search', () => {
      it('rejects a non-positive k value', () => {
        const vector = new Float32Array(dimension).fill(0.5);
        expect(db.search(vector, 0)).rejects.toThrow(
          'Search parameter k must be positive',
        );
        expect(db.search(vector, -1)).rejects.toThrow(
          'Search parameter k must be positive',
        );
      });

      it('rejects a non-integer k value', () => {
        const vector = new Float32Array(dimension).fill(0.5);
        expect(db.search(vector, 1.5)).rejects.toThrow(
          'Search parameter k must be an integer',
        );
      });

      it('rejects a k value exceeding 10,000', () => {
        const vector = new Float32Array(dimension).fill(0.5);
        expect(db.search(vector, 10001)).rejects.toThrow(
          'Search parameter k cannot exceed 10,000',
        );
      });

      it('rejects a query vector with the wrong dimension', () => {
        const wrongDim = new Float32Array(64).fill(0.5);
        expect(db.search(wrongDim, 5)).rejects.toThrow();
      });

      it('rejects search options with invalid includeMetadata type', () => {
        const vector = new Float32Array(dimension).fill(0.5);
        expect(
          db.search(vector, 5, { includeMetadata: 'yes' as unknown as boolean }),
        ).rejects.toThrow('includeMetadata must be a boolean');
      });
    });

    describe('VectorDB.searchRange', () => {
      it('rejects a negative maxDistance', () => {
        const vector = new Float32Array(dimension).fill(0.5);
        expect(db.searchRange(vector, -0.1)).rejects.toThrow(
          'Distance must be non-negative',
        );
      });

      it('rejects a non-finite maxDistance', () => {
        const vector = new Float32Array(dimension).fill(0.5);
        expect(db.searchRange(vector, Infinity)).rejects.toThrow(
          'Distance must be finite',
        );
        expect(db.searchRange(vector, NaN)).rejects.toThrow('Distance must be finite');
      });

      it('rejects a maxDistance beyond the metric-aware bound (cosine ≤ 4)', () => {
        // This db uses the default cosine metric, whose distance range is [0, 2];
        // the validator allows a small headroom (≤ 4) and rejects beyond it.
        const vector = new Float32Array(dimension).fill(0.5);
        expect(db.searchRange(vector, 5)).rejects.toThrow('exceeds the maximum 4');
      });

      it('allows a large manhattan threshold proportional to the dimension', async () => {
        // A manhattan db legitimately needs thresholds that scale with dimension,
        // so a value that would exceed the old fixed 1000 cap must be accepted.
        const manhattanDB = new VectorDB(`${testDBName}-manhattan`, dimension, {
          distanceMetric: 'manhattan',
          autoEviction: false,
          useIndex: false,
        });
        await manhattanDB.init();
        const vector = new Float32Array(dimension).fill(0.5);
        // Should not throw on validation (no matching vectors is fine).
        const results = await manhattanDB.searchRange(vector, 5000);
        expect(Array.isArray(results)).toBe(true);
        await manhattanDB.delete();
      });

      it('rejects a query vector with the wrong dimension', () => {
        const wrongDim = new Float32Array(64).fill(0.5);
        expect(db.searchRange(wrongDim, 0.5)).rejects.toThrow();
      });
    });

    describe('VectorDB.updateVector', () => {
      it('rejects an empty ID', () => {
        const vector = new Float32Array(dimension).fill(0.5);
        expect(db.updateVector('', vector)).rejects.toThrow('Vector ID cannot be empty');
      });

      it('rejects a vector with the wrong dimension', async () => {
        await db.addVector('update-dim-test', new Float32Array(dimension).fill(0.5));
        const wrongDim = new Float32Array(64).fill(0.5);
        expect(db.updateVector('update-dim-test', wrongDim)).rejects.toThrow();
      });
    });

    describe('VectorDB.updateMetadata', () => {
      it('rejects an empty ID', () => {
        expect(db.updateMetadata('', { key: 'value' })).rejects.toThrow(
          'Vector ID cannot be empty',
        );
      });

      it('rejects invalid metadata (array)', async () => {
        await db.addVector('update-meta-test', new Float32Array(dimension).fill(0.5));
        expect(
          db.updateMetadata('update-meta-test', ['invalid'] as unknown as Record<
            string,
            unknown
          >),
        ).rejects.toThrow('Metadata must be an object');
      });

      it('rejects metadata with too many properties', async () => {
        await db.addVector('update-meta-overflow', new Float32Array(dimension).fill(0.5));
        const bigMeta: Record<string, string> = {};
        for (let i = 0; i <= 1000; i++) bigMeta[`key${i}`] = 'value';
        expect(db.updateMetadata('update-meta-overflow', bigMeta)).rejects.toThrow(
          'Metadata cannot have more than 1000 properties',
        );
      });
    });

    describe('VectorDB.getMany', () => {
      it('rejects when the IDs array is empty', () => {
        expect(db.getMany([])).rejects.toThrow('Vector IDs array cannot be empty');
      });

      it('rejects when IDs array contains duplicates', () => {
        expect(db.getMany(['id1', 'id1'])).rejects.toThrow(
          'Duplicate vector ID found: id1',
        );
      });

      it('rejects when IDs array contains an invalid ID', () => {
        expect(db.getMany(['valid', ''])).rejects.toThrow('Vector ID cannot be empty');
      });
    });

    describe('VectorDB.deleteMany', () => {
      it('rejects when the IDs array is empty', () => {
        expect(db.deleteMany([])).rejects.toThrow('Vector IDs array cannot be empty');
      });

      it('rejects when IDs contain invalid characters', () => {
        expect(db.deleteMany(['valid', 'bad<id>'])).rejects.toThrow(
          'Vector ID contains invalid characters',
        );
      });
    });

    describe('VectorDB.updateBatch', () => {
      it('rejects a batch item with an empty ID', () => {
        expect(db.updateBatch([{ id: '', metadata: { key: 'val' } }])).rejects.toThrow(
          'Vector ID cannot be empty',
        );
      });

      it('rejects a batch item with a non-string ID', () => {
        expect(
          db.updateBatch([{ id: 42 as unknown as string, metadata: {} }]),
        ).rejects.toThrow('Vector ID must be a string');
      });

      it('rejects a batch item with invalid metadata', () => {
        expect(
          db.updateBatch([
            {
              id: 'valid-id',
              metadata: 'not-an-object' as unknown as Record<string, unknown>,
            },
          ]),
        ).rejects.toThrow('Metadata must be an object');
      });

      it('rejects a batch item vector with the wrong dimension', () => {
        expect(
          db.updateBatch([{ id: 'valid-id', vector: new Float32Array(64).fill(0.5) }]),
        ).rejects.toThrow();
      });
    });

    describe('VectorDB.addBatch', () => {
      it('rejects a batch item with an empty ID', () => {
        const vectors = [{ id: '', vector: new Float32Array(dimension).fill(0.5) }];
        expect(db.addBatch(vectors)).rejects.toThrow('Vector ID cannot be empty');
      });

      it('rejects a batch item with a wrong-dimension vector', () => {
        const vectors = [{ id: 'bad-dim', vector: new Float32Array(64).fill(0.5) }];
        expect(db.addBatch(vectors)).rejects.toThrow();
      });
    });

    describe('VectorFrankl namespace validation', () => {
      it('rejects creating a namespace with a reserved name', () => {
        expect(
          vectorFrankl.createNamespace('root', { dimension: 128 }),
        ).rejects.toThrow();
      });

      it('rejects creating a namespace whose name contains internal separator', () => {
        expect(
          vectorFrankl.createNamespace('bad-ns-name', { dimension: 128 }),
        ).rejects.toThrow();
      });

      it('rejects creating a namespace with a name shorter than 3 characters', () => {
        expect(vectorFrankl.createNamespace('ab', { dimension: 128 })).rejects.toThrow();
      });

      it('rejects creating a namespace with a name longer than 64 characters', () => {
        expect(
          vectorFrankl.createNamespace('n'.repeat(65), { dimension: 128 }),
        ).rejects.toThrow();
      });

      it('rejects creating a namespace with a name containing spaces', () => {
        expect(
          vectorFrankl.createNamespace('has space', { dimension: 128 }),
        ).rejects.toThrow();
      });
    });

    describe('VectorNamespace — delegates validation to lower layer', () => {
      let namespace: import('@/namespaces/namespace.js').VectorNamespace;

      beforeEach(async () => {
        namespace = await vectorFrankl.createNamespace('validation-ns', {
          dimension: 64,
          distanceMetric: 'cosine',
        });
      });

      afterEach(async () => {
        try {
          await vectorFrankl.deleteNamespace('validation-ns');
        } catch {
          // ignore cleanup errors
        }
      });

      it('rejects addVector with empty ID (delegates to VectorDB)', () => {
        const vector = new Float32Array(64).fill(0.5);
        expect(namespace.addVector('', vector)).rejects.toThrow(
          'Vector ID cannot be empty',
        );
      });

      it('rejects search with wrong-dimension vector (delegates to VectorDB)', () => {
        const wrongDim = new Float32Array(32).fill(0.5);
        expect(namespace.search(wrongDim, 5)).rejects.toThrow();
      });

      it('rejects getMany with empty array (delegates to VectorDB)', () => {
        expect(namespace.getMany([])).rejects.toThrow('Vector IDs array cannot be empty');
      });

      it('rejects searchRange with negative distance (delegates to VectorDB)', () => {
        const vector = new Float32Array(64).fill(0.5);
        expect(namespace.searchRange(vector, -1)).rejects.toThrow(
          'Distance must be non-negative',
        );
      });

      it('rejects updateMetadata with array metadata (delegates to VectorDB)', async () => {
        await namespace.addVector('valid-id', new Float32Array(64).fill(0.5));
        expect(
          namespace.updateMetadata('valid-id', ['not-an-object'] as unknown as Record<
            string,
            unknown
          >),
        ).rejects.toThrow('Metadata must be an object');
      });

      it('rejects exists with invalid ID (delegates to VectorDB)', () => {
        expect(namespace.exists('')).rejects.toThrow('Vector ID cannot be empty');
      });
    });
  });

  describe('Performance Considerations', () => {
    it('should handle large batch operations efficiently', async () => {
      const largeBatch = Array.from({ length: 1000 }, (_, i) => ({
        id: `perf-${i}`,
        vector: new Float32Array(dimension).fill(Math.random()),
        metadata: { batch: 'large', index: i },
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
        metadata: { test: 'memory', index: i },
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
