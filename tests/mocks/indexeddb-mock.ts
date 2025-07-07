/**
 * Mock implementation of IndexedDB for testing purposes
 */

// Type definitions for IndexedDB mock
interface IDBEventTarget {
  target: MockIDBRequest | MockIDBOpenDBRequest | MockIDBTransaction | MockIDBDatabase;
}

interface IDBRequestEvent extends IDBEventTarget {
  target: MockIDBRequest | MockIDBOpenDBRequest;
}

interface IDBTransactionEvent extends IDBEventTarget {
  target: MockIDBTransaction;
}

interface IDBDatabaseEvent extends IDBEventTarget {
  target: MockIDBDatabase;
}

interface IDBVersionChangeEvent extends IDBDatabaseEvent {
  oldVersion: number;
  newVersion: number;
}

interface IDBObjectStoreOptions {
  keyPath?: string | string[];
  autoIncrement?: boolean;
}

interface IDBIndexOptions {
  unique?: boolean;
  multiEntry?: boolean;
}

type IDBValidKey = string | number | Date | ArrayBufferView | ArrayBuffer | IDBValidKey[];
// Simple IDBKeyRange mock interface
interface IDBKeyRange {
  lower?: IDBValidKey;
  upper?: IDBValidKey;
  lowerOpen?: boolean;
  upperOpen?: boolean;
}
type IDBCursorDirection = 'next' | 'nextunique' | 'prev' | 'prevunique';

export class MockIDBRequest<T = unknown> {
  result: T | null = null;
  error: Error | null = null;
  readyState: 'pending' | 'done' = 'pending';

  onsuccess: ((event: IDBRequestEvent) => void) | null = null;
  onerror: ((event: IDBRequestEvent) => void) | null = null;

  constructor(result?: T | null, error?: Error) {
    if (error) {
      this.error = error;
      setTimeout(() => {
        this.readyState = 'done';
        this.onerror?.({ target: this });
      }, 0);
    } else {
      this.result = result ?? null;
      setTimeout(() => {
        this.readyState = 'done';
        this.onsuccess?.({ target: this });
      }, 0);
    }
  }
}

export class MockIDBCursor<T = unknown> {
  value: T | null = null;
  key: IDBValidKey | null = null;
  primaryKey: IDBValidKey | null = null;
  private data: T[];
  private index = 0;

  constructor(data: T[]) {
    this.data = data;
    this.update();
  }

  private update() {
    if (this.index < this.data.length) {
      const item = this.data[this.index];
      this.value = item ?? null;
      this.key = ((item as Record<string, unknown>)['id'] as IDBValidKey) || this.index;
      this.primaryKey = this.key;
    } else {
      this.value = null;
      this.key = null;
      this.primaryKey = null;
    }
  }

  continue(): MockIDBRequest<MockIDBCursor<T> | null> {
    this.index++;
    this.update();
    return new MockIDBRequest(this.index < this.data.length ? this : null);
  }
}

export class MockIDBObjectStore {
  name: string;
  keyPath: string | string[];
  autoIncrement: boolean;
  private data = new Map<string, unknown>();
  private indices = new Map<string, MockIDBIndex>();

  // Getter for tests to access data
  getData(): Map<string, unknown> {
    return this.data;
  }

  constructor(name: string, options: IDBObjectStoreOptions = {}) {
    this.name = name;
    this.keyPath = options.keyPath || 'id';
    this.autoIncrement = options.autoIncrement || false;
  }

  get(key: IDBValidKey): MockIDBRequest<unknown> {
    const value = this.data.get(String(key));
    return new MockIDBRequest(value === undefined ? null : value);
  }

  getAll(): MockIDBRequest<unknown[]> {
    const values = Array.from(this.data.values());
    return new MockIDBRequest(values);
  }

  put<T = unknown>(value: T, key?: IDBValidKey): MockIDBRequest<IDBValidKey> {
    const actualKey = key ? String(key) : this.getKeyFromValue(value);
    if (actualKey) {
      this.data.set(actualKey, { ...(value as Record<string, unknown>) });
      return new MockIDBRequest<IDBValidKey>(actualKey);
    }
    return new MockIDBRequest<IDBValidKey>(null as any, new Error('No key provided'));
  }

  add<T = unknown>(value: T, key?: IDBValidKey): MockIDBRequest<IDBValidKey> {
    const actualKey = key ? String(key) : this.getKeyFromValue(value);
    if (actualKey && !this.data.has(actualKey)) {
      this.data.set(actualKey, { ...(value as Record<string, unknown>) });
      return new MockIDBRequest<IDBValidKey>(actualKey);
    }
    return new MockIDBRequest<IDBValidKey>(null as any, new Error('Key already exists'));
  }

  delete(key: IDBValidKey): MockIDBRequest<boolean> {
    const existed = this.data.delete(String(key));
    return new MockIDBRequest(existed);
  }

  clear(): MockIDBRequest<undefined> {
    this.data.clear();
    return new MockIDBRequest(undefined);
  }

  count(key?: IDBValidKey | IDBKeyRange): MockIDBRequest<number> {
    if (key && typeof key !== 'object') {
      return new MockIDBRequest(this.data.has(String(key)) ? 1 : 0);
    }
    return new MockIDBRequest(this.data.size);
  }

  openCursor(
    _range?: IDBValidKey | IDBKeyRange,
    _direction?: IDBCursorDirection,
  ): MockIDBRequest<MockIDBCursor | null> {
    const values = Array.from(this.data.values());
    if (values.length === 0) {
      return new MockIDBRequest(null);
    }
    const cursor = new MockIDBCursor(values);
    return new MockIDBRequest(cursor);
  }

  createIndex(
    name: string,
    keyPath: string | string[],
    _options: IDBIndexOptions = {},
  ): MockIDBIndex {
    const index = new MockIDBIndex(name, keyPath, this);
    this.indices.set(name, index);
    return index;
  }

  index(name: string): MockIDBIndex {
    const index = this.indices.get(name);
    if (!index) {
      throw new Error(`Index '${name}' does not exist`);
    }
    return index;
  }

  private getKeyFromValue(value: unknown): string | null {
    if (typeof this.keyPath === 'string' && value && typeof value === 'object') {
      return String((value as Record<string, unknown>)[this.keyPath]) || null;
    }
    return null;
  }
}

export class MockIDBIndex {
  name: string;
  keyPath: string | string[];
  private store: MockIDBObjectStore;

  constructor(name: string, keyPath: string | string[], store: MockIDBObjectStore) {
    this.name = name;
    this.keyPath = keyPath;
    this.store = store;
  }

  get(key: IDBValidKey): MockIDBRequest<unknown> {
    // Simple implementation - find first matching value
    const values = Array.from(this.store.getData().values());
    const match = values.find((value) => this.getIndexKey(value) === key);
    return new MockIDBRequest(match || null);
  }

  getAll(): MockIDBRequest<unknown[]> {
    const values = Array.from(this.store.getData().values());
    return new MockIDBRequest(values);
  }

  openCursor(
    _range?: IDBValidKey | IDBKeyRange,
    _direction?: IDBCursorDirection,
  ): MockIDBRequest<MockIDBCursor | null> {
    const values = Array.from(this.store.getData().values());
    if (values.length === 0) {
      return new MockIDBRequest(null);
    }
    const cursor = new MockIDBCursor(values);
    return new MockIDBRequest(cursor);
  }

  count(): MockIDBRequest<number> {
    return new MockIDBRequest(this.store.getData().size);
  }

  private getIndexKey(value: unknown): IDBValidKey | null {
    if (typeof this.keyPath === 'string') {
      return this.getNestedValue(value, this.keyPath) as IDBValidKey | null;
    }
    return null;
  }

  private getNestedValue(obj: unknown, path: string): unknown {
    return path
      .split('.')
      .reduce<unknown>(
        (current, key) =>
          current && typeof current === 'object'
            ? (current as Record<string, unknown>)[key]
            : undefined,
        obj,
      );
  }
}

export class MockIDBTransaction {
  mode: 'readonly' | 'readwrite' | 'versionchange';
  objectStoreNames: string[];
  private stores = new Map<string, MockIDBObjectStore>();
  private _complete = Promise.resolve();

  oncomplete: ((event: IDBTransactionEvent) => void) | null = null;
  onerror: ((event: IDBTransactionEvent) => void) | null = null;
  onabort: ((event: IDBTransactionEvent) => void) | null = null;

  constructor(
    storeNames: string[],
    mode: 'readonly' | 'readwrite' | 'versionchange',
    stores: Map<string, MockIDBObjectStore>,
  ) {
    this.mode = mode;
    this.objectStoreNames = storeNames;

    // Copy relevant stores
    for (const name of storeNames) {
      const store = stores.get(name);
      if (store) {
        this.stores.set(name, store);
      }
    }

    // Auto-complete transaction
    setTimeout(() => {
      this.oncomplete?.({ target: this });
    }, 0);
  }

  get complete(): Promise<void> {
    return this._complete;
  }

  objectStore(name: string): MockIDBObjectStore {
    const store = this.stores.get(name);
    if (!store) {
      throw new Error(`Object store '${name}' not found`);
    }
    return store;
  }

  abort() {
    setTimeout(() => {
      this.onabort?.({ target: this });
    }, 0);
  }
}

interface DOMStringList extends Array<string> {
  contains(name: string): boolean;
}

export class MockIDBDatabase {
  name: string;
  version: number;
  objectStoreNames: DOMStringList;
  private stores = new Map<string, MockIDBObjectStore>();

  onclose: ((event: IDBDatabaseEvent) => void) | null = null;
  onerror: ((event: IDBDatabaseEvent) => void) | null = null;
  onabort: ((event: IDBDatabaseEvent) => void) | null = null;
  onversionchange: ((event: IDBVersionChangeEvent) => void) | null = null;

  constructor(name: string, version: number) {
    this.name = name;
    this.version = version;

    // Initialize objectStoreNames as DOMStringList
    this.objectStoreNames = Object.assign([], {
      contains: (name: string) => this.objectStoreNames.includes(name),
    }) as DOMStringList;
  }

  createObjectStore(
    name: string,
    options: IDBObjectStoreOptions = {},
  ): MockIDBObjectStore {
    const store = new MockIDBObjectStore(name, options);
    this.stores.set(name, store);
    const names = Array.from(this.stores.keys());
    this.objectStoreNames = Object.assign(names, {
      contains: (name: string) => names.includes(name),
    }) as DOMStringList;

    return store;
  }

  deleteObjectStore(name: string): void {
    this.stores.delete(name);
    const names = Array.from(this.stores.keys());
    this.objectStoreNames = Object.assign(names, {
      contains: (name: string) => names.includes(name),
    }) as DOMStringList;
  }

  transaction(
    storeNames: string | string[],
    mode: 'readonly' | 'readwrite' | 'versionchange' = 'readonly',
  ): MockIDBTransaction {
    const names = Array.isArray(storeNames) ? storeNames : [storeNames];
    return new MockIDBTransaction(names, mode, this.stores);
  }

  close(): void {
    setTimeout(() => {
      this.onclose?.({ target: this });
    }, 0);
  }

  /**
   * Convenience method that the actual code expects
   */
  async withTransaction<T>(
    storeNames: string[],
    callback: (tx: MockIDBTransaction) => Promise<T>,
  ): Promise<T> {
    const transaction = this.transaction(storeNames, 'readwrite');
    try {
      const result = await callback(transaction);
      return result;
    } catch (error) {
      transaction.abort();
      throw error;
    }
  }

  /**
   * Execute transaction method expected by the vector database
   */
  async executeTransaction<T>(
    storeNames: string | string[],
    mode: 'readonly' | 'readwrite' | 'versionchange',
    operation: (transaction: MockIDBTransaction) => Promise<T>,
  ): Promise<T> {
    const stores = Array.isArray(storeNames) ? storeNames : [storeNames];
    const transaction = this.transaction(stores, mode);

    return new Promise((resolve, reject) => {
      let result: T;

      transaction.oncomplete = () => {
        resolve(result);
      };

      transaction.onerror = () => {
        reject(new Error('Transaction failed'));
      };

      transaction.onabort = () => {
        reject(new Error('Transaction aborted'));
      };

      // Execute the operation
      operation(transaction)
        .then((res) => {
          result = res;
        })
        .catch((error) => {
          transaction.abort();
          reject(error);
        });
    });
  }
}

export class MockIDBOpenDBRequest {
  result: MockIDBDatabase | null = null;
  error: Error | null = null;
  readyState: 'pending' | 'done' = 'pending';

  onsuccess: ((event: IDBRequestEvent) => void) | null = null;
  onerror: ((event: IDBRequestEvent) => void) | null = null;
  onupgradeneeded: ((event: IDBVersionChangeEvent) => void) | null = null;
  onblocked: ((event: IDBRequestEvent) => void) | null = null;

  constructor(name: string, version?: number) {
    setTimeout(() => {
      // Simulate database opening
      const db = new MockIDBDatabase(name, version || 1);

      // Store the database in the global registry
      mockDatabases.set(name, db);

      // Set result before callbacks
      this.result = db;

      // Always trigger upgrade for new databases (simulate schema creation)
      const upgradeEvent: IDBVersionChangeEvent = {
        target: this as any,
        oldVersion: 0,
        newVersion: version || 1,
      };

      if (this.onupgradeneeded) {
        this.onupgradeneeded(upgradeEvent);
      }

      // Wait a tick to ensure upgrade is processed, then trigger success
      setTimeout(() => {
        this.readyState = 'done';
        this.onsuccess?.({ target: this });
      }, 0);
    }, 0);
  }
}

// Mock databases registry
const mockDatabases = new Map<string, MockIDBDatabase>();

// Mock IndexedDB implementation
export const mockIndexedDB = {
  open(name: string, version?: number): MockIDBOpenDBRequest {
    return new MockIDBOpenDBRequest(name, version);
  },

  deleteDatabase(name: string): MockIDBRequest {
    mockDatabases.delete(name);
    return new MockIDBRequest(undefined);
  },

  databases(): Promise<Array<{ name: string; version: number }>> {
    const dbs = Array.from(mockDatabases.entries()).map(([name, db]) => ({
      name,
      version: db.version,
    }));
    return Promise.resolve(dbs);
  },

  cmp(first: IDBValidKey, second: IDBValidKey): number {
    // Simple comparison - in real IndexedDB this is more complex
    const a = String(first);
    const b = String(second);
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  },
};

// Mock storage API
export const mockStorage = {
  estimate(): Promise<{ usage: number; quota: number }> {
    return Promise.resolve({
      usage: 1024 * 1024 * 10, // 10MB
      quota: 1024 * 1024 * 1024, // 1GB
    });
  },
};

// Mock navigator
export const mockNavigator = {
  storage: mockStorage,
};

/**
 * Setup IndexedDB mocks for testing
 */
export function setupIndexedDBMocks(): void {
  // @ts-expect-error - Monkey patching for tests
  global.indexedDB = mockIndexedDB;
  // @ts-expect-error - Monkey patching for tests
  global.IDBRequest = MockIDBRequest;
  // @ts-expect-error - Monkey patching for tests
  global.IDBTransaction = MockIDBTransaction;
  // @ts-expect-error - Monkey patching for tests
  global.IDBDatabase = MockIDBDatabase;
  // @ts-expect-error - Monkey patching for tests
  global.IDBObjectStore = MockIDBObjectStore;
  // @ts-expect-error - Monkey patching for tests
  global.IDBIndex = MockIDBIndex;
  // @ts-expect-error - Monkey patching for tests
  global.IDBCursor = MockIDBCursor;
  global.navigator = mockNavigator as Navigator;
}

/**
 * Clean up IndexedDB mocks after testing
 */
export function cleanupIndexedDBMocks(): void {
  mockDatabases.clear();
}
