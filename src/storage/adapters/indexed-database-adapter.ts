import { VectorDatabase } from '@/core/database.js';
import { BatchOperationError, VectorNotFoundError } from '@/core/errors.js';
import { VectorStorage } from '@/core/storage.js';
import type { BatchOptions, StorageAdapter, VectorData } from '@/core/types.js';

interface IndexedDatabaseAdapterOptions {
  name: string;
  version?: number;
}

/**
 * Storage adapter that wraps VectorDatabase and VectorStorage into a
 * single StorageAdapter implementation backed by IndexedDB.
 */
export class IndexedDatabaseStorageAdapter implements StorageAdapter {
  private readonly options: IndexedDatabaseAdapterOptions;
  private database: VectorDatabase | null = null;
  private storage: VectorStorage | null = null;

  constructor(options: IndexedDatabaseAdapterOptions) {
    this.options = options;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async init(): Promise<void> {
    // Make init idempotent: if already initialized, do nothing.
    if (this.database !== null) {
      return;
    }

    const databaseConfiguration =
      this.options.version !== undefined
        ? { name: this.options.name, version: this.options.version }
        : { name: this.options.name };

    this.database = new VectorDatabase(databaseConfiguration);

    await this.database.init();

    this.storage = new VectorStorage(this.database);
  }

  async close(): Promise<void> {
    const database = this.requireDatabase();
    await database.close();
    this.database = null;
    this.storage = null;
  }

  async destroy(): Promise<void> {
    const database = this.requireDatabase();
    await database.delete();
    this.database = null;
    this.storage = null;
  }

  // ---------------------------------------------------------------------------
  // Single-item CRUD
  // ---------------------------------------------------------------------------

  async put(vector: VectorData): Promise<void> {
    const storage = this.requireStorage();
    await storage.put(vector);
  }

  async get(id: string): Promise<VectorData> {
    const storage = this.requireStorage();
    return storage.get(id);
  }

  async exists(id: string): Promise<boolean> {
    const storage = this.requireStorage();
    return storage.exists(id);
  }

  async delete(id: string): Promise<void> {
    const storage = this.requireStorage();
    await storage.delete(id);
  }

  // ---------------------------------------------------------------------------
  // Multi-item reads
  // ---------------------------------------------------------------------------

  async getMany(ids: string[]): Promise<VectorData[]> {
    const storage = this.requireStorage();
    try {
      return await storage.getMany(ids);
    } catch (error) {
      // VectorStorage throws BatchOperationError when all requested IDs fail.
      // This can happen for two distinct reasons:
      //   1. All IDs were simply not found (VectorNotFoundError) — expected;
      //      the StorageAdapter contract returns the found subset (empty here).
      //   2. All requests failed due to I/O / transaction errors — unexpected;
      //      we must re-throw so the caller knows about the storage failure.
      if (error instanceof BatchOperationError) {
        const hasTransactionFailure = error.errors.some(
          (entry) => !(entry.error instanceof VectorNotFoundError),
        );
        if (hasTransactionFailure) {
          throw error;
        }
        return [];
      }
      throw error;
    }
  }

  async getAll(): Promise<VectorData[]> {
    const storage = this.requireStorage();
    return storage.getAll();
  }

  async count(): Promise<number> {
    const storage = this.requireStorage();
    return storage.count();
  }

  // ---------------------------------------------------------------------------
  // Multi-item writes
  // ---------------------------------------------------------------------------

  async deleteMany(ids: string[]): Promise<number> {
    const storage = this.requireStorage();
    return storage.deleteMany(ids);
  }

  async clear(): Promise<void> {
    const storage = this.requireStorage();
    await storage.clear();
  }

  async putBatch(vectors: VectorData[], options?: BatchOptions): Promise<void> {
    const storage = this.requireStorage();
    await storage.putBatch(vectors, options);
  }

  // ---------------------------------------------------------------------------
  // Partial updates
  // ---------------------------------------------------------------------------

  async updateVector(
    id: string,
    vector: Float32Array,
    options?: { updateMagnitude?: boolean; updateTimestamp?: boolean },
  ): Promise<void> {
    const storage = this.requireStorage();
    await storage.updateVector(id, vector, options);
  }

  async updateMetadata(
    id: string,
    metadata: Record<string, unknown>,
    options?: { merge?: boolean; updateTimestamp?: boolean },
  ): Promise<void> {
    const storage = this.requireStorage();
    await storage.updateMetadata(id, metadata, options);
  }

  async updateBatch(
    updates: Array<{
      id: string;
      vector?: Float32Array;
      metadata?: Record<string, unknown>;
    }>,
    options?: BatchOptions,
  ): Promise<{
    succeeded: number;
    failed: number;
    errors: Array<{ id: string; error: Error }>;
  }> {
    const storage = this.requireStorage();
    return storage.updateBatch(updates, options);
  }

  // ---------------------------------------------------------------------------
  // Escape hatch
  // ---------------------------------------------------------------------------

  /**
   * Returns the underlying VectorDatabase instance for direct access,
   * for example to persist or restore HNSW index data.
   *
   * Throws if the adapter has not been initialized.
   */
  getDatabase(): VectorDatabase {
    return this.requireDatabase();
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private requireDatabase(): VectorDatabase {
    if (!this.database) {
      throw new Error(
        'IndexedDatabaseStorageAdapter is not initialized. Call init() before using the adapter.',
      );
    }
    return this.database;
  }

  private requireStorage(): VectorStorage {
    if (!this.storage) {
      throw new Error(
        'IndexedDatabaseStorageAdapter is not initialized. Call init() before using the adapter.',
      );
    }
    return this.storage;
  }
}
