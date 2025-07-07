import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';

import { VectorDatabase } from '@/core/database.js';
import { VectorNotFoundError } from '@/core/errors.js';
import { VectorStorage } from '@/core/storage.js';
import { VectorOperations } from '@/vectors/operations.js';
import {
  cleanupIndexedDBMocks,
  setupIndexedDBMocks,
} from '../../mocks/indexeddb-mock.js';

describe('VectorStorage', () => {
  let database: VectorDatabase;
  let storage: VectorStorage;
  const testDbName = 'test-vector-storage-db';

  beforeAll(() => {
    setupIndexedDBMocks();
  });

  afterAll(() => {
    cleanupIndexedDBMocks();
  });

  beforeEach(async () => {
    // Clean up any existing test database
    try {
      indexedDB.deleteDatabase(testDbName);
    } catch (_error) {
      // Ignore errors during cleanup
    }

    database = new VectorDatabase({ name: testDbName });
    await database.init();
    storage = new VectorStorage(database);
  });

  afterEach(async () => {
    await database.close();
    try {
      indexedDB.deleteDatabase(testDbName);
    } catch (_error) {
      // Ignore cleanup errors
    }
  });

  describe('put and get operations', () => {
    test('should store and retrieve a vector', async () => {
      const vector = await VectorOperations.prepareForStorage(
        'test-vector-1',
        new Float32Array([0.1, 0.2, 0.3, 0.4]),
        { label: 'test' },
      );

      await storage.put(vector);
      const retrieved = await storage.get('test-vector-1');

      expect(retrieved.id).toBe('test-vector-1');
      expect(retrieved.vector).toEqual(vector.vector);
      expect(retrieved.metadata).toEqual({ label: 'test' });
      expect(retrieved.magnitude).toBeCloseTo(vector.magnitude);
      expect(retrieved.lastAccessed).toBeDefined();
      expect(retrieved.accessCount).toBe(1);
    });

    test('should update existing vector', async () => {
      const vector1 = await VectorOperations.prepareForStorage(
        'test-vector-1',
        new Float32Array([0.1, 0.2, 0.3, 0.4]),
        { version: 1 },
      );

      await storage.put(vector1);

      const vector2 = await VectorOperations.prepareForStorage(
        'test-vector-1',
        new Float32Array([0.5, 0.6, 0.7, 0.8]),
        { version: 2 },
      );

      await storage.put(vector2);
      const retrieved = await storage.get('test-vector-1');

      expect(retrieved.vector).toEqual(vector2.vector);
      expect(retrieved.metadata).toEqual({ version: 2 });
    });

    test('should throw error when getting non-existent vector', async () => {
      expect(storage.get('non-existent')).rejects.toThrow(VectorNotFoundError);
    });

    test('should update access metadata on get', async () => {
      const vector = await VectorOperations.prepareForStorage(
        'test-vector-1',
        new Float32Array([0.1, 0.2, 0.3, 0.4]),
      );

      await storage.put(vector);

      // First access
      const retrieved1 = await storage.get('test-vector-1');
      expect(retrieved1.accessCount).toBe(1);

      // Second access
      const retrieved2 = await storage.get('test-vector-1');
      expect(retrieved2.accessCount).toBe(2);
      expect(retrieved2.lastAccessed).toBeGreaterThan(retrieved1.lastAccessed!);
    });
  });

  describe('batch operations', () => {
    test('should get multiple vectors', async () => {
      const vectors = [
        await VectorOperations.prepareForStorage('vec1', new Float32Array([0.1, 0.2])),
        await VectorOperations.prepareForStorage('vec2', new Float32Array([0.3, 0.4])),
        await VectorOperations.prepareForStorage('vec3', new Float32Array([0.5, 0.6])),
      ];

      for (const vector of vectors) {
        await storage.put(vector);
      }

      const retrieved = await storage.getMany(['vec1', 'vec3']);
      expect(retrieved).toHaveLength(2);
      expect(retrieved.map((v) => v.id)).toContain('vec1');
      expect(retrieved.map((v) => v.id)).toContain('vec3');
    });

    test('should handle partial failures in getMany', async () => {
      const vector = await VectorOperations.prepareForStorage(
        'vec1',
        new Float32Array([0.1, 0.2]),
      );
      await storage.put(vector);

      const retrieved = await storage.getMany(['vec1', 'non-existent', 'vec3']);
      expect(retrieved).toHaveLength(1);
      expect(retrieved[0]!.id).toBe('vec1');
    });

    test('should store vectors in batch', async () => {
      const vectors = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          VectorOperations.prepareForStorage(
            `batch-vec-${i}`,
            new Float32Array([i * 0.1, i * 0.2, i * 0.3, i * 0.4]),
          ),
        ),
      );

      await storage.putBatch(vectors);

      const count = await storage.count();
      expect(count).toBe(10);

      const retrieved = await storage.get('batch-vec-5');
      expect(retrieved.vector).toEqual(new Float32Array([0.5, 1.0, 1.5, 2.0]));
    });

    test('should report progress during batch operations', async () => {
      const vectors = await Promise.all(
        Array.from({ length: 100 }, (_, i) =>
          VectorOperations.prepareForStorage(
            `progress-vec-${i}`,
            new Float32Array([i * 0.01]),
          ),
        ),
      );

      const progressReports: any[] = [];

      await storage.putBatch(vectors, {
        batchSize: 10,
        onProgress: (progress) => {
          progressReports.push(progress);
        },
      });

      expect(progressReports.length).toBeGreaterThan(0);
      expect(progressReports[progressReports.length - 1].completed).toBe(100);
      expect(progressReports[progressReports.length - 1].percentage).toBe(100);
    });
  });

  describe('delete operations', () => {
    test('should delete a vector', async () => {
      const vector = await VectorOperations.prepareForStorage(
        'to-delete',
        new Float32Array([0.1, 0.2]),
      );

      await storage.put(vector);
      expect(await storage.exists('to-delete')).toBe(true);

      await storage.delete('to-delete');
      expect(await storage.exists('to-delete')).toBe(false);
    });

    test('should delete multiple vectors', async () => {
      const vectors = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          VectorOperations.prepareForStorage(`del-vec-${i}`, new Float32Array([i * 0.1])),
        ),
      );

      for (const vector of vectors) {
        await storage.put(vector);
      }

      const deleted = await storage.deleteMany(['del-vec-1', 'del-vec-3', 'del-vec-4']);
      expect(deleted).toBe(3);

      expect(await storage.exists('del-vec-0')).toBe(true);
      expect(await storage.exists('del-vec-1')).toBe(false);
      expect(await storage.exists('del-vec-2')).toBe(true);
      expect(await storage.exists('del-vec-3')).toBe(false);
      expect(await storage.exists('del-vec-4')).toBe(false);
    });

    test('should clear all vectors', async () => {
      const vectors = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          VectorOperations.prepareForStorage(
            `clear-vec-${i}`,
            new Float32Array([i * 0.1]),
          ),
        ),
      );

      for (const vector of vectors) {
        await storage.put(vector);
      }

      expect(await storage.count()).toBe(5);

      await storage.clear();
      expect(await storage.count()).toBe(0);
    });
  });

  describe('utility operations', () => {
    test('should check if vector exists', async () => {
      const vector = await VectorOperations.prepareForStorage(
        'exists-test',
        new Float32Array([0.1, 0.2]),
      );

      expect(await storage.exists('exists-test')).toBe(false);

      await storage.put(vector);
      expect(await storage.exists('exists-test')).toBe(true);
    });

    test('should count vectors', async () => {
      expect(await storage.count()).toBe(0);

      const vectors = await Promise.all(
        Array.from({ length: 3 }, (_, i) =>
          VectorOperations.prepareForStorage(
            `count-vec-${i}`,
            new Float32Array([i * 0.1]),
          ),
        ),
      );

      for (const vector of vectors) {
        await storage.put(vector);
      }

      expect(await storage.count()).toBe(3);
    });

    test('should get all vectors', async () => {
      const vectors = await Promise.all(
        Array.from({ length: 3 }, (_, i) =>
          VectorOperations.prepareForStorage(
            `all-vec-${i}`,
            new Float32Array([i * 0.1, i * 0.2]),
            { index: i },
          ),
        ),
      );

      for (const vector of vectors) {
        await storage.put(vector);
      }

      const all = await storage.getAll();
      expect(all).toHaveLength(3);
      expect(all.map((v) => v.id).sort()).toEqual([
        'all-vec-0',
        'all-vec-1',
        'all-vec-2',
      ]);
    });
  });
});
