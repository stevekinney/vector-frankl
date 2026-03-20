import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { IndexedDatabaseStorageAdapter } from '@/storage/adapters/indexed-database-adapter.js';
import {
  cleanupIndexedDBMocks,
  setupIndexedDBMocks,
} from '../../mocks/indexeddb-mock.js';
import { runStorageAdapterTests } from './adapter-test-suite.js';

beforeAll(() => {
  setupIndexedDBMocks();
});

afterAll(() => {
  cleanupIndexedDBMocks();
});

let counter = 0;

runStorageAdapterTests(
  'IndexedDatabaseStorageAdapter',
  () => new IndexedDatabaseStorageAdapter({ name: `test-idb-adapter-${counter++}` }),
);

describe('IndexedDatabaseStorageAdapter-specific', () => {
  it('exposes the underlying VectorDatabase via getDatabase()', async () => {
    const adapter = new IndexedDatabaseStorageAdapter({ name: `test-idb-escape-${counter++}` });
    await adapter.init();

    const database = adapter.getDatabase();
    expect(database).toBeDefined();
    expect(database.isInitialized()).toBe(true);

    await adapter.destroy();
  });

  it('throws when calling methods before init()', () => {
    const adapter = new IndexedDatabaseStorageAdapter({ name: 'test-idb-uninit' });

    expect(() => adapter.getDatabase()).toThrow('not initialized');
  });

  it('accepts an explicit version number', async () => {
    const adapter = new IndexedDatabaseStorageAdapter({
      name: `test-idb-version-${counter++}`,
      version: 2,
    });
    await adapter.init();

    const database = adapter.getDatabase();
    const info = await database.getDatabaseInfo();
    expect(info.version).toBe(2);

    await adapter.destroy();
  });
});
