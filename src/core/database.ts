import { 
  DatabaseInitializationError, 
  TransactionError,
  BrowserSupportError 
} from './errors.js';
import type { DatabaseConfig } from './types.js';

/**
 * Core database class for managing IndexedDB connections and operations
 */
export class VectorDatabase {
  private database: IDBDatabase | null = null;
  private readonly name: string;
  private readonly version: number;
  private initializationPromise: Promise<void> | null = null;

  /**
   * Object store names used in the database
   */
  static readonly STORES = {
    VECTORS: 'vectors',
    INDICES: 'indices',
    CONFIG: 'config',
    NAMESPACES: 'namespaces',
    HNSW_INDICES: 'hnsw_indices'
  } as const;

  /**
   * Index names for the vectors store
   */
  static readonly VECTOR_INDICES = {
    METADATA: 'metadata',
    TIMESTAMP: 'timestamp',
    LAST_ACCESSED: 'lastAccessed'
  } as const;

  constructor(config: DatabaseConfig) {
    if (!this.isIndexedDBSupported()) {
      throw new BrowserSupportError('IndexedDB');
    }

    this.name = config.name;
    this.version = config.version || 1;
  }

  /**
   * Initialize the database connection
   */
  async init(): Promise<void> {
    // Return existing initialization if in progress
    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    // Already initialized
    if (this.database) {
      return;
    }

    this.initializationPromise = this.openDatabase();
    
    try {
      await this.initializationPromise;
    } catch (error) {
      this.initializationPromise = null;
      throw error;
    }
  }

  /**
   * Open IndexedDB connection
   */
  private async openDatabase(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.name, this.version);

      request.onerror = () => {
        reject(new DatabaseInitializationError(
          'Failed to open database',
          request.error || undefined
        ));
      };

      request.onsuccess = () => {
        this.database = request.result;
        this.setupEventHandlers();
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const database = (event.target as IDBOpenDBRequest).result;
        this.createSchema(database, event.oldVersion);
      };

      request.onblocked = () => {
        reject(new DatabaseInitializationError(
          'Database upgrade blocked by other connections'
        ));
      };
    });
  }

  /**
   * Create or upgrade database schema
   */
  private createSchema(database: IDBDatabase, _oldVersion: number): void {
    // Create vectors store if it doesn't exist
    if (!database.objectStoreNames.contains(VectorDatabase.STORES.VECTORS)) {
      const vectorStore = database.createObjectStore(
        VectorDatabase.STORES.VECTORS,
        { keyPath: 'id' }
      );

      // Create indices for efficient querying
      vectorStore.createIndex(
        VectorDatabase.VECTOR_INDICES.METADATA,
        'metadata',
        { unique: false }
      );
      
      vectorStore.createIndex(
        VectorDatabase.VECTOR_INDICES.TIMESTAMP,
        'timestamp',
        { unique: false }
      );
      
      vectorStore.createIndex(
        VectorDatabase.VECTOR_INDICES.LAST_ACCESSED,
        'lastAccessed',
        { unique: false }
      );
    }

    // Create indices store if it doesn't exist
    if (!database.objectStoreNames.contains(VectorDatabase.STORES.INDICES)) {
      database.createObjectStore(
        VectorDatabase.STORES.INDICES,
        { keyPath: 'name' }
      );
    }

    // Create config store if it doesn't exist
    if (!database.objectStoreNames.contains(VectorDatabase.STORES.CONFIG)) {
      database.createObjectStore(
        VectorDatabase.STORES.CONFIG,
        { keyPath: 'key' }
      );
    }

    // Create namespaces store if it doesn't exist
    if (!database.objectStoreNames.contains(VectorDatabase.STORES.NAMESPACES)) {
      database.createObjectStore(
        VectorDatabase.STORES.NAMESPACES,
        { keyPath: 'name' }
      );
    }

    // Create HNSW indices store if it doesn't exist
    if (!database.objectStoreNames.contains(VectorDatabase.STORES.HNSW_INDICES)) {
      database.createObjectStore(
        VectorDatabase.STORES.HNSW_INDICES,
        { keyPath: 'id' }
      );
    }
  }

  /**
   * Setup event handlers for the database connection
   */
  private setupEventHandlers(): void {
    if (!this.database) return;

    this.database.onclose = () => {
      this.database = null;
      this.initializationPromise = null;
    };

    this.database.onerror = (event) => {
      console.error('Database error:', event);
    };

    this.database.onabort = (event) => {
      console.error('Database transaction aborted:', event);
    };
  }

  /**
   * Get a database connection, initializing if necessary
   */
  private async getDatabase(): Promise<IDBDatabase> {
    if (!this.database) {
      await this.init();
    }

    if (!this.database) {
      throw new DatabaseInitializationError('Database connection not available');
    }

    return this.database;
  }

  /**
   * Create a new transaction
   */
  async transaction(
    storeNames: string | string[],
    mode: IDBTransactionMode = 'readonly'
  ): Promise<IDBTransaction> {
    const database = await this.getDatabase();
    
    try {
      const stores = Array.isArray(storeNames) ? storeNames : [storeNames];
      return database.transaction(stores, mode);
    } catch (error) {
      throw new TransactionError(
        'create transaction',
        `Failed to create transaction for stores: ${storeNames}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Execute a transaction with automatic error handling
   */
  async executeTransaction<T>(
    storeNames: string | string[],
    mode: IDBTransactionMode,
    operation: (transaction: IDBTransaction) => Promise<T>
  ): Promise<T> {
    const transaction = await this.transaction(storeNames, mode);
    
    return new Promise((resolve, reject) => {
      let result: T;

      transaction.oncomplete = () => {
        resolve(result);
      };

      transaction.onerror = () => {
        reject(new TransactionError(
          'execute',
          'Transaction failed',
          transaction.error || undefined
        ));
      };

      transaction.onabort = () => {
        reject(new TransactionError(
          'execute',
          'Transaction aborted',
          transaction.error || undefined
        ));
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

  /**
   * Close the database connection
   */
  async close(): Promise<void> {
    if (this.database) {
      this.database.close();
      this.database = null;
      this.initializationPromise = null;
    }
  }

  /**
   * Delete the entire database
   */
  async delete(): Promise<void> {
    await this.close();

    return new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(this.name);

      request.onsuccess = () => {
        resolve();
      };

      request.onerror = () => {
        reject(new DatabaseInitializationError(
          'Failed to delete database',
          request.error || undefined
        ));
      };

      request.onblocked = () => {
        reject(new DatabaseInitializationError(
          'Database deletion blocked by other connections'
        ));
      };
    });
  }

  /**
   * Check if IndexedDB is supported
   */
  private isIndexedDBSupported(): boolean {
    try {
      return typeof indexedDB !== 'undefined' && indexedDB !== null;
    } catch {
      return false;
    }
  }

  /**
   * Get database information
   */
  async getDatabaseInfo(): Promise<{
    name: string;
    version: number;
    stores: string[];
  }> {
    const database = await this.getDatabase();
    
    return {
      name: database.name,
      version: database.version,
      stores: Array.from(database.objectStoreNames)
    };
  }

  /**
   * Check if the database is initialized
   */
  isInitialized(): boolean {
    return this.database !== null;
  }

  /**
   * Get all available databases (Chrome only)
   */
  static async getAllDatabases(): Promise<IDBDatabaseInfo[]> {
    if ('databases' in indexedDB) {
      return indexedDB.databases();
    }
    
    throw new BrowserSupportError('indexedDB.databases()', 'Current browser');
  }
}