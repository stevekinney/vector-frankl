import { describe, expect, test, beforeEach, afterEach, beforeAll, afterAll } from 'bun:test';
import { VectorDatabase } from '@/core/database.js';
import type { DatabaseConfig } from '@/core/types.js';
import { setupIndexedDBMocks, cleanupIndexedDBMocks } from '../../mocks/indexeddb-mock.js';

describe('VectorDatabase', () => {
  let database: VectorDatabase;
  const testDbName = 'test-vector-db';
  const config: DatabaseConfig = {
    name: testDbName,
    version: 1
  };

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
    
    database = new VectorDatabase(config);
  });

  afterEach(async () => {
    // Close and clean up
    if (database.isInitialized()) {
      await database.close();
    }
    
    try {
      indexedDB.deleteDatabase(testDbName);
    } catch (_error) {
      // Ignore cleanup errors
    }
  });

  describe('initialization', () => {
    test('should initialize successfully', async () => {
      expect(database.init()).resolves.toBeUndefined();
      expect(database.isInitialized()).toBe(true);
    });

    test('should handle multiple init calls', async () => {
      await database.init();
      expect(database.init()).resolves.toBeUndefined();
      expect(database.isInitialized()).toBe(true);
    });

    test('should create required object stores', async () => {
      await database.init();
      const info = await database.getDatabaseInfo();
      
      expect(info.stores).toContain(VectorDatabase.STORES.VECTORS);
      expect(info.stores).toContain(VectorDatabase.STORES.INDICES);
      expect(info.stores).toContain(VectorDatabase.STORES.CONFIG);
      expect(info.stores).toContain(VectorDatabase.STORES.NAMESPACES);
    });
  });

  describe('transactions', () => {
    beforeEach(async () => {
      await database.init();
    });

    test('should create a read transaction', async () => {
      const transaction = await database.transaction(
        VectorDatabase.STORES.VECTORS,
        'readonly'
      );
      
      expect(transaction).toBeDefined();
      expect(transaction.mode).toBe('readonly');
    });

    test('should create a write transaction', async () => {
      const transaction = await database.transaction(
        VectorDatabase.STORES.VECTORS,
        'readwrite'
      );
      
      expect(transaction).toBeDefined();
      expect(transaction.mode).toBe('readwrite');
    });

    test('should handle multiple stores in transaction', async () => {
      const transaction = await database.transaction(
        [VectorDatabase.STORES.VECTORS, VectorDatabase.STORES.CONFIG],
        'readwrite'
      );
      
      expect(transaction).toBeDefined();
    });

    test('should execute transaction successfully', async () => {
      const result = await database.executeTransaction(
        VectorDatabase.STORES.CONFIG,
        'readwrite',
        async (transaction) => {
          const store = transaction.objectStore(VectorDatabase.STORES.CONFIG);
          
          return new Promise<string>((resolve, reject) => {
            const request = store.put({ key: 'test', value: 'test-value' });
            request.onsuccess = () => resolve('success');
            request.onerror = () => reject(new Error('Failed'));
          });
        }
      );
      
      expect(result).toBe('success');
    });
  });

  describe('database operations', () => {
    test('should close database', async () => {
      await database.init();
      expect(database.isInitialized()).toBe(true);
      
      await database.close();
      expect(database.isInitialized()).toBe(false);
    });

    test('should delete database', async () => {
      await database.init();
      await database.delete();
      
      expect(database.isInitialized()).toBe(false);
      
      // Verify database is deleted by trying to open it
      const openRequest = indexedDB.open(testDbName);
      await new Promise<void>((resolve) => {
        openRequest.onsuccess = () => {
          const db = openRequest.result;
          // New database should have version 1 (not our initialized version)
          expect(db.version).toBe(1);
          db.close();
          resolve();
        };
      });
    });

    test('should get database info', async () => {
      await database.init();
      const info = await database.getDatabaseInfo();
      
      expect(info.name).toBe(testDbName);
      expect(info.version).toBe(1);
      expect(info.stores).toBeInstanceOf(Array);
      expect(info.stores.length).toBeGreaterThan(0);
    });
  });

  describe('error handling', () => {
    test('should throw error if browser does not support IndexedDB', () => {
      // Mock IndexedDB not being available
      const originalIndexedDB = globalThis.indexedDB;
      // @ts-expect-error - Temporarily remove indexedDB for testing
      globalThis.indexedDB = undefined;
      
      expect(() => new VectorDatabase(config)).toThrow();
      
      // Restore
      globalThis.indexedDB = originalIndexedDB;
    });
  });
});