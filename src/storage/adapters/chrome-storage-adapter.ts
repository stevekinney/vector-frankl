import {
  BatchOperationError,
  BrowserSupportError,
  VectorNotFoundError,
} from '@/core/errors.js';
import type {
  BatchOptions,
  BatchProgress,
  StorageAdapter,
  VectorData,
} from '@/core/types.js';
import {
  type SerializedVectorData,
  serializableToVectorData,
  vectorDataToSerializable,
} from './serialization.js';

declare const chrome: {
  storage: {
    local: ChromeStorageArea;
    session: ChromeStorageArea;
  };
};

interface ChromeStorageArea {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

interface ChromeStorageAdapterOptions {
  prefix: string;
  area?: 'local' | 'session';
}

const DEFAULT_BATCH_SIZE = 100;

export class ChromeStorageAdapter implements StorageAdapter {
  private readonly prefix: string;
  private readonly area: 'local' | 'session';

  /** Promise-based mutex to serialize ID index mutations. */
  private mutexQueue: Promise<void> = Promise.resolve();

  constructor(options: ChromeStorageAdapterOptions) {
    this.prefix = options.prefix;
    this.area = options.area ?? 'local';
  }

  // ---------------------------------------------------------------------------
  // Key helpers
  // ---------------------------------------------------------------------------

  private get idIndexKey(): string {
    return `${this.prefix}:__ids__`;
  }

  private vectorKey(id: string): string {
    return `${this.prefix}:v:${id}`;
  }

  private get storage(): ChromeStorageArea {
    return chrome.storage[this.area];
  }

  // ---------------------------------------------------------------------------
  // Mutex
  // ---------------------------------------------------------------------------

  /**
   * Acquire the mutex, execute `fn`, then release.  All ID-index mutations
   * must go through this to prevent lost-update races.
   */
  private withMutex<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.mutexQueue;
    let release: () => void;
    this.mutexQueue = new Promise<void>((resolve) => {
      release = resolve;
    });

    return previous.then(async () => {
      try {
        return await fn();
      } finally {
        release!();
      }
    });
  }

  // ---------------------------------------------------------------------------
  // ID index helpers
  // ---------------------------------------------------------------------------

  private async readIdIndex(): Promise<string[]> {
    const result = await this.storage.get(this.idIndexKey);
    const ids = result[this.idIndexKey];
    return Array.isArray(ids) ? (ids as string[]) : [];
  }

  private async writeIdIndex(ids: string[]): Promise<void> {
    await this.storage.set({ [this.idIndexKey]: ids });
  }

  // ---------------------------------------------------------------------------
  // Serialization helpers
  // ---------------------------------------------------------------------------

  private serialize(vector: VectorData): SerializedVectorData {
    return vectorDataToSerializable(vector);
  }

  private deserialize(data: SerializedVectorData): VectorData {
    return serializableToVectorData(data);
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async init(): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.storage) {
      throw new BrowserSupportError('chrome.storage');
    }
  }

  async close(): Promise<void> {
    // No-op: chrome.storage does not require explicit cleanup.
  }

  async destroy(): Promise<void> {
    return this.withMutex(async () => {
      const ids = await this.readIdIndex();
      const keysToRemove = [this.idIndexKey, ...ids.map((id) => this.vectorKey(id))];
      await this.storage.remove(keysToRemove);
    });
  }

  // ---------------------------------------------------------------------------
  // Single-item CRUD
  // ---------------------------------------------------------------------------

  async put(vector: VectorData): Promise<void> {
    const normalized: VectorData = {
      ...vector,
      timestamp: vector.timestamp || Date.now(),
      lastAccessed: Date.now(),
    };
    const serialized = this.serialize(normalized);
    const key = this.vectorKey(vector.id);

    await this.withMutex(async () => {
      const ids = await this.readIdIndex();

      if (!ids.includes(vector.id)) {
        ids.push(vector.id);
        await this.writeIdIndex(ids);
      }

      await this.storage.set({ [key]: serialized });
    });
  }

  async get(id: string): Promise<VectorData> {
    const key = this.vectorKey(id);
    const result = await this.storage.get(key);
    const data = result[key] as SerializedVectorData | undefined;

    if (!data) {
      throw new VectorNotFoundError(id);
    }

    // Update access tracking
    data.lastAccessed = Date.now();
    data.accessCount = (data.accessCount ?? 0) + 1;
    await this.storage.set({ [key]: data });

    return this.deserialize(data);
  }

  async exists(id: string): Promise<boolean> {
    const ids = await this.readIdIndex();
    return ids.includes(id);
  }

  async delete(id: string): Promise<void> {
    await this.withMutex(async () => {
      const ids = await this.readIdIndex();
      const index = ids.indexOf(id);

      if (index !== -1) {
        ids.splice(index, 1);
        await this.writeIdIndex(ids);
      }

      await this.storage.remove(this.vectorKey(id));
    });
  }

  // ---------------------------------------------------------------------------
  // Multi-item reads
  // ---------------------------------------------------------------------------

  async getMany(ids: string[]): Promise<VectorData[]> {
    const keys = ids.map((id) => this.vectorKey(id));
    const result = await this.storage.get(keys);
    const vectors: VectorData[] = [];
    const updates: Record<string, unknown> = {};

    for (const id of ids) {
      const key = this.vectorKey(id);
      const data = result[key] as SerializedVectorData | undefined;

      if (data) {
        data.lastAccessed = Date.now();
        data.accessCount = (data.accessCount ?? 0) + 1;
        updates[key] = data;
        vectors.push(this.deserialize(data));
      }
    }

    // Persist access tracking updates in a single write
    if (Object.keys(updates).length > 0) {
      await this.storage.set(updates);
    }

    return vectors;
  }

  async getAll(): Promise<VectorData[]> {
    const ids = await this.readIdIndex();

    if (ids.length === 0) {
      return [];
    }

    const keys = ids.map((id) => this.vectorKey(id));
    const result = await this.storage.get(keys);
    const vectors: VectorData[] = [];

    for (const id of ids) {
      const key = this.vectorKey(id);
      const data = result[key] as SerializedVectorData | undefined;

      if (data) {
        vectors.push(this.deserialize(data));
      }
    }

    return vectors;
  }

  async count(): Promise<number> {
    const ids = await this.readIdIndex();
    return ids.length;
  }

  // ---------------------------------------------------------------------------
  // Multi-item writes
  // ---------------------------------------------------------------------------

  async deleteMany(ids: string[]): Promise<number> {
    let deletedCount = 0;

    await this.withMutex(async () => {
      const currentIds = await this.readIdIndex();
      const idsSet = new Set(currentIds);
      const keysToRemove: string[] = [];

      for (const id of ids) {
        if (idsSet.has(id)) {
          idsSet.delete(id);
          keysToRemove.push(this.vectorKey(id));
          deletedCount++;
        }
      }

      if (keysToRemove.length > 0) {
        await this.writeIdIndex([...idsSet]);
        await this.storage.remove(keysToRemove);
      }
    });

    return deletedCount;
  }

  async clear(): Promise<void> {
    await this.withMutex(async () => {
      const ids = await this.readIdIndex();
      const keysToRemove = ids.map((id) => this.vectorKey(id));
      keysToRemove.push(this.idIndexKey);
      await this.storage.remove(keysToRemove);
      await this.writeIdIndex([]);
    });
  }

  async putBatch(vectors: VectorData[], options?: BatchOptions): Promise<void> {
    const batchSize = options?.batchSize ?? DEFAULT_BATCH_SIZE;
    const total = vectors.length;
    let completed = 0;
    let failed = 0;
    const errors: Array<{ id: string; error: Error }> = [];

    const totalBatches = Math.ceil(total / batchSize);

    for (let i = 0; i < total; i += batchSize) {
      if (options?.abortSignal?.aborted) {
        throw new BatchOperationError(completed, total - completed, [
          { id: 'batch', error: new Error('Batch operation aborted') },
        ]);
      }

      const batch = vectors.slice(i, i + batchSize);
      const items: Record<string, unknown> = {};
      const batchIds: string[] = [];

      for (const vector of batch) {
        try {
          items[this.vectorKey(vector.id)] = this.serialize(vector);
          batchIds.push(vector.id);
        } catch (error) {
          failed++;
          errors.push({
            id: vector.id,
            error: error instanceof Error ? error : new Error(String(error)),
          });
        }
      }

      // Write vector data and update the ID index atomically (under mutex)
      await this.withMutex(async () => {
        const currentIds = await this.readIdIndex();
        const idsSet = new Set(currentIds);

        for (const id of batchIds) {
          idsSet.add(id);
        }

        await this.storage.set(items);
        await this.writeIdIndex([...idsSet]);
      });

      completed += batchIds.length;

      if (options?.onProgress) {
        const progress: BatchProgress = {
          total,
          completed,
          failed,
          percentage: Math.round((completed / total) * 100),
          currentBatch: Math.floor(i / batchSize) + 1,
          totalBatches,
        };
        options.onProgress(progress);
      }
    }

    if (failed > 0) {
      throw new BatchOperationError(completed, failed, errors);
    }
  }

  // ---------------------------------------------------------------------------
  // Partial updates (read-modify-write)
  // ---------------------------------------------------------------------------

  async updateVector(
    id: string,
    vector: Float32Array,
    options?: { updateMagnitude?: boolean; updateTimestamp?: boolean },
  ): Promise<void> {
    const key = this.vectorKey(id);
    const result = await this.storage.get(key);
    const data = result[key] as SerializedVectorData | undefined;

    if (!data) {
      throw new VectorNotFoundError(id);
    }

    data.vector = Array.from(vector);

    if (options?.updateMagnitude !== false) {
      let magnitude = 0;
      for (let i = 0; i < vector.length; i++) {
        const value = vector[i]!;
        magnitude += value * value;
      }
      data.magnitude = Math.sqrt(magnitude);
    }

    if (options?.updateTimestamp !== false) {
      data.timestamp = Date.now();
    }

    await this.storage.set({ [key]: data });
  }

  async updateMetadata(
    id: string,
    metadata: Record<string, unknown>,
    options?: { merge?: boolean; updateTimestamp?: boolean },
  ): Promise<void> {
    const key = this.vectorKey(id);
    const result = await this.storage.get(key);
    const data = result[key] as SerializedVectorData | undefined;

    if (!data) {
      throw new VectorNotFoundError(id);
    }

    if (options?.merge !== false) {
      data.metadata = { ...data.metadata, ...metadata };
    } else {
      data.metadata = metadata;
    }

    if (options?.updateTimestamp !== false) {
      data.timestamp = Date.now();
    }

    await this.storage.set({ [key]: data });
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
    const batchSize = options?.batchSize ?? DEFAULT_BATCH_SIZE;
    let succeeded = 0;
    let failed = 0;
    const errors: Array<{ id: string; error: Error }> = [];

    const totalBatches = Math.ceil(updates.length / batchSize);

    for (let i = 0; i < updates.length; i += batchSize) {
      if (options?.abortSignal?.aborted) {
        throw new BatchOperationError(succeeded, failed, [
          { id: 'batch', error: new Error('Batch update aborted') },
        ]);
      }

      const batch = updates.slice(i, i + batchSize);

      // Read all keys in this batch at once
      const keys = batch.map((update) => this.vectorKey(update.id));
      const result = await this.storage.get(keys);
      const toWrite: Record<string, unknown> = {};

      for (const update of batch) {
        const key = this.vectorKey(update.id);
        const data = result[key] as SerializedVectorData | undefined;

        if (!data) {
          failed++;
          errors.push({ id: update.id, error: new VectorNotFoundError(update.id) });
          continue;
        }

        try {
          if (update.vector) {
            data.vector = Array.from(update.vector);
            let magnitude = 0;
            for (let j = 0; j < update.vector.length; j++) {
              const value = update.vector[j]!;
              magnitude += value * value;
            }
            data.magnitude = Math.sqrt(magnitude);
          }

          if (update.metadata !== undefined) {
            data.metadata = { ...data.metadata, ...update.metadata };
          }

          data.timestamp = Date.now();
          toWrite[key] = data;
          succeeded++;
        } catch (error) {
          failed++;
          errors.push({
            id: update.id,
            error: error instanceof Error ? error : new Error(String(error)),
          });
        }
      }

      if (Object.keys(toWrite).length > 0) {
        await this.storage.set(toWrite);
      }

      if (options?.onProgress) {
        const completed = Math.min(i + batchSize, updates.length);
        const progress: BatchProgress = {
          total: updates.length,
          completed,
          failed,
          percentage: Math.round((completed / updates.length) * 100),
          currentBatch: Math.floor(i / batchSize) + 1,
          totalBatches,
        };
        options.onProgress(progress);
      }
    }

    return { succeeded, failed, errors };
  }
}
