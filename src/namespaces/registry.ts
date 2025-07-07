import { VectorDatabase } from '@/core/database.js';
import {
  NamespaceExistsError,
  NamespaceNotFoundError,
  TransactionError,
} from '@/core/errors.js';
import type { NamespaceConfig, NamespaceInfo, NamespaceStats } from '@/core/types.js';

/**
 * Registry for managing namespace metadata
 */
export class NamespaceRegistry {
  static readonly STORES = {
    NAMESPACES: 'namespaces',
    CONFIG: 'config',
  } as const;

  private database: VectorDatabase;
  private initialized = false;

  constructor(rootDatabaseName = 'vector-frankl-root') {
    this.database = new VectorDatabase({
      name: rootDatabaseName,
      version: 1,
    });
  }

  /**
   * Initialize the registry database
   */
  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Override the default schema creation
    (this.database as any)['createSchema'] = (db: IDBDatabase) => {
      // Namespaces store
      if (!db.objectStoreNames.contains(NamespaceRegistry.STORES.NAMESPACES)) {
        const namespaceStore = db.createObjectStore(NamespaceRegistry.STORES.NAMESPACES, {
          keyPath: 'name',
        });
        namespaceStore.createIndex('created', 'created');
        namespaceStore.createIndex('modified', 'modified');
        namespaceStore.createIndex('vectorCount', ['stats', 'vectorCount']);
      }

      // Global config store
      if (!db.objectStoreNames.contains(NamespaceRegistry.STORES.CONFIG)) {
        db.createObjectStore(NamespaceRegistry.STORES.CONFIG);
      }
    };

    await this.database.init();
    this.initialized = true;
  }

  /**
   * Register a new namespace
   */
  async register(name: string, config: NamespaceConfig): Promise<NamespaceInfo> {
    await this.ensureInitialized();

    // Validate namespace name
    this.validateNamespaceName(name);

    const now = Date.now();
    const namespaceInfo: NamespaceInfo = {
      name,
      config,
      stats: {
        vectorCount: 0,
        storageSize: 0,
      },
      created: now,
      modified: now,
    };

    try {
      await this.database.executeTransaction(
        [NamespaceRegistry.STORES.NAMESPACES],
        'readwrite',
        async (tx: IDBTransaction) => {
          const namespaceStore = tx.objectStore(NamespaceRegistry.STORES.NAMESPACES);

          // Check if namespace already exists
          const existing = (await this.promisifyRequest(namespaceStore.get(name))) as
            | NamespaceInfo
            | undefined;

          if (existing) {
            throw new NamespaceExistsError(name);
          }

          // Add the namespace
          await this.promisifyRequest(namespaceStore.add(namespaceInfo));
        },
      );

      return namespaceInfo;
    } catch (error) {
      if (error instanceof NamespaceExistsError) {
        throw error;
      }
      throw new TransactionError(
        'register namespace',
        'Failed to register namespace',
        error as Error,
      );
    }
  }

  /**
   * Get namespace information
   */
  async get(name: string): Promise<NamespaceInfo | null> {
    await this.ensureInitialized();

    try {
      const result = await this.database.executeTransaction(
        [NamespaceRegistry.STORES.NAMESPACES],
        'readonly',
        async (tx: IDBTransaction) => {
          const namespaceStore = tx.objectStore(NamespaceRegistry.STORES.NAMESPACES);
          return this.promisifyRequest(namespaceStore.get(name)) as Promise<
            NamespaceInfo | undefined
          >;
        },
      );
      return result || null;
    } catch (error) {
      throw new TransactionError(
        'get namespace',
        'Failed to get namespace',
        error as Error,
      );
    }
  }

  /**
   * List all namespaces
   */
  async list(): Promise<NamespaceInfo[]> {
    await this.ensureInitialized();

    try {
      return await this.database.executeTransaction(
        [NamespaceRegistry.STORES.NAMESPACES],
        'readonly',
        async (tx: IDBTransaction) => {
          const namespaceStore = tx.objectStore(NamespaceRegistry.STORES.NAMESPACES);
          const namespaces: NamespaceInfo[] = [];

          const cursor = namespaceStore.openCursor();
          await this.iterateCursor(cursor, (value) => {
            namespaces.push(value);
          });

          return namespaces;
        },
      );
    } catch (error) {
      throw new TransactionError(
        'list namespaces',
        'Failed to list namespaces',
        error as Error,
      );
    }
  }

  /**
   * Update namespace stats
   */
  async updateStats(name: string, stats: Partial<NamespaceStats>): Promise<void> {
    await this.ensureInitialized();

    try {
      await this.database.executeTransaction(
        [NamespaceRegistry.STORES.NAMESPACES],
        'readwrite',
        async (tx: IDBTransaction) => {
          const namespaceStore = tx.objectStore(NamespaceRegistry.STORES.NAMESPACES);

          const namespace = (await this.promisifyRequest(namespaceStore.get(name))) as
            | NamespaceInfo
            | undefined;

          if (!namespace) {
            throw new NamespaceNotFoundError(name);
          }

          // Update stats and modified timestamp
          namespace.stats = { ...namespace.stats, ...stats };
          namespace.modified = Date.now();

          await this.promisifyRequest(namespaceStore.put(namespace));
        },
      );
    } catch (error) {
      if (error instanceof NamespaceNotFoundError) {
        throw error;
      }
      throw new TransactionError(
        'update namespace stats',
        'Failed to update namespace stats',
        error as Error,
      );
    }
  }

  /**
   * Delete a namespace from the registry
   */
  async unregister(name: string): Promise<void> {
    await this.ensureInitialized();

    try {
      await this.database.executeTransaction(
        [NamespaceRegistry.STORES.NAMESPACES],
        'readwrite',
        async (tx: IDBTransaction) => {
          const namespaceStore = tx.objectStore(NamespaceRegistry.STORES.NAMESPACES);

          const namespace = (await this.promisifyRequest(namespaceStore.get(name))) as
            | NamespaceInfo
            | undefined;

          if (!namespace) {
            throw new NamespaceNotFoundError(name);
          }

          await this.promisifyRequest(namespaceStore.delete(name));
        },
      );
    } catch (error) {
      if (error instanceof NamespaceNotFoundError) {
        throw error;
      }
      throw new TransactionError(
        'unregister namespace',
        'Failed to unregister namespace',
        error as Error,
      );
    }
  }

  /**
   * Check if a namespace exists
   */
  async exists(name: string): Promise<boolean> {
    await this.ensureInitialized();

    try {
      const namespace = await this.get(name);
      return namespace !== null;
    } catch {
      return false;
    }
  }

  /**
   * Find namespaces by pattern
   */
  async findByPattern(pattern: string | RegExp): Promise<NamespaceInfo[]> {
    await this.ensureInitialized();

    const allNamespaces = await this.list();
    const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;

    return allNamespaces.filter((ns) => regex.test(ns.name));
  }

  /**
   * Get total storage usage across all namespaces
   */
  async getTotalStorageUsage(): Promise<number> {
    await this.ensureInitialized();

    const namespaces = await this.list();
    return namespaces.reduce((total, ns) => total + ns.stats.storageSize, 0);
  }

  /**
   * Close the registry database
   */
  async close(): Promise<void> {
    await this.database.close();
    this.initialized = false;
  }

  /**
   * Delete the registry database
   */
  async delete(): Promise<void> {
    await this.database.delete();
    this.initialized = false;
  }

  /**
   * Ensure the registry is initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.init();
    }
  }

  /**
   * Validate namespace name
   */
  private validateNamespaceName(name: string): void {
    if (!name || typeof name !== 'string') {
      throw new Error('Namespace name must be a non-empty string');
    }

    // Must be URL-safe: alphanumeric, dash, underscore
    const validPattern = /^[a-zA-Z0-9_-]+$/;
    if (!validPattern.test(name)) {
      throw new Error(
        'Namespace name must contain only alphanumeric characters, dashes, and underscores',
      );
    }

    // Prevent reserved names
    const reserved = ['root', 'system', 'admin', 'registry'];
    if (reserved.includes(name.toLowerCase())) {
      throw new Error(`Namespace name '${name}' is reserved`);
    }

    // Length limits
    if (name.length < 3 || name.length > 64) {
      throw new Error('Namespace name must be between 3 and 64 characters');
    }
  }

  /**
   * Helper to promisify IndexedDB requests
   */
  private promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error || new Error('IndexedDB request failed'));
    });
  }

  /**
   * Helper to iterate over a cursor
   */
  private async iterateCursor(
    cursorRequest: IDBRequest<IDBCursorWithValue | null>,
    callback: (value: NamespaceInfo) => void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (cursor) {
          callback(cursor.value);
          cursor.continue();
        } else {
          resolve();
        }
      };
      cursorRequest.onerror = () =>
        reject(cursorRequest.error || new Error('Cursor request failed'));
    });
  }
}
