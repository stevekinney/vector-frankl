import { VectorNotFoundError } from '@/core/errors.js';
import type {
  BatchOptions,
  BatchProgress,
  StorageAdapter,
  VectorData,
} from '@/core/types.js';
import { calculateMagnitude } from './serialization.js';

interface MemoryStorageAdapterOptions {
  cloneOnRead?: boolean;
  cloneOnWrite?: boolean;
}

export class MemoryStorageAdapter implements StorageAdapter {
  private readonly store = new Map<string, VectorData>();
  private readonly cloneOnRead: boolean;
  private readonly cloneOnWrite: boolean;

  constructor(options: MemoryStorageAdapterOptions = {}) {
    this.cloneOnRead = options.cloneOnRead ?? true;
    this.cloneOnWrite = options.cloneOnWrite ?? true;
  }

  private clone(vector: VectorData): VectorData {
    return structuredClone(vector);
  }

  /**
   * Directly insert a vector without modifying timestamps.
   * Useful for testing scenarios that need precise control over access metadata.
   */
  seed(vector: VectorData): void {
    const stored = this.cloneOnWrite ? this.clone(vector) : vector;
    this.store.set(stored.id, stored);
  }

  // Lifecycle

  async init(): Promise<void> {}

  async close(): Promise<void> {}

  async destroy(): Promise<void> {
    this.store.clear();
  }

  // Single-item CRUD

  async put(vector: VectorData): Promise<void> {
    const stored = this.cloneOnWrite ? this.clone(vector) : vector;

    if (!stored.timestamp) {
      stored.timestamp = Date.now();
    }
    stored.lastAccessed = Date.now();

    this.store.set(stored.id, stored);
  }

  async get(id: string): Promise<VectorData> {
    const entry = this.store.get(id);

    if (!entry) {
      throw new VectorNotFoundError(id);
    }

    entry.lastAccessed = Date.now();
    entry.accessCount = (entry.accessCount ?? 0) + 1;

    return this.cloneOnRead ? this.clone(entry) : entry;
  }

  async exists(id: string): Promise<boolean> {
    return this.store.has(id);
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }

  // Multi-item reads

  async getMany(ids: string[]): Promise<VectorData[]> {
    const results: VectorData[] = [];
    const now = Date.now();

    for (const id of ids) {
      const entry = this.store.get(id);
      if (entry) {
        entry.lastAccessed = now;
        entry.accessCount = (entry.accessCount ?? 0) + 1;
        results.push(this.cloneOnRead ? this.clone(entry) : entry);
      }
    }

    return results;
  }

  async getAll(): Promise<VectorData[]> {
    const results: VectorData[] = [];

    for (const entry of this.store.values()) {
      results.push(this.cloneOnRead ? this.clone(entry) : entry);
    }

    return results;
  }

  async count(): Promise<number> {
    return this.store.size;
  }

  // Multi-item writes

  async deleteMany(ids: string[]): Promise<number> {
    let deleted = 0;

    for (const id of ids) {
      if (this.store.delete(id)) {
        deleted++;
      }
    }

    return deleted;
  }

  async clear(): Promise<void> {
    this.store.clear();
  }

  async putBatch(vectors: VectorData[], options?: BatchOptions): Promise<void> {
    const batchSize = options?.batchSize ?? vectors.length;
    const totalBatches = Math.ceil(vectors.length / batchSize);

    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      if (options?.abortSignal?.aborted) {
        throw new DOMException('The operation was aborted.', 'AbortError');
      }

      const start = batchIndex * batchSize;
      const end = Math.min(start + batchSize, vectors.length);

      for (let i = start; i < end; i++) {
        const vector = vectors[i]!;
        const stored = this.cloneOnWrite ? this.clone(vector) : vector;

        if (!stored.timestamp) {
          stored.timestamp = Date.now();
        }
        stored.lastAccessed = Date.now();

        this.store.set(stored.id, stored);
      }

      if (options?.onProgress) {
        const progress: BatchProgress = {
          total: vectors.length,
          completed: end,
          failed: 0,
          percentage: Math.round((end / vectors.length) * 100),
          currentBatch: batchIndex + 1,
          totalBatches,
        };
        options.onProgress(progress);
      }
    }
  }

  // Partial updates (read-modify-write)

  async updateVector(
    id: string,
    vector: Float32Array,
    options?: { updateMagnitude?: boolean; updateTimestamp?: boolean },
  ): Promise<void> {
    const entry = this.store.get(id);

    if (!entry) {
      throw new VectorNotFoundError(id);
    }

    entry.vector = vector;

    if (options?.updateMagnitude !== false) {
      entry.magnitude = calculateMagnitude(vector);
    }

    if (options?.updateTimestamp !== false) {
      entry.timestamp = Date.now();
    }
  }

  async updateMetadata(
    id: string,
    metadata: Record<string, unknown>,
    options?: { merge?: boolean; updateTimestamp?: boolean },
  ): Promise<void> {
    const entry = this.store.get(id);

    if (!entry) {
      throw new VectorNotFoundError(id);
    }

    if (options?.merge !== false && entry.metadata) {
      entry.metadata = { ...entry.metadata, ...metadata };
    } else {
      entry.metadata = metadata;
    }

    if (options?.updateTimestamp !== false) {
      entry.timestamp = Date.now();
    }
  }

  async updateBatch(
    updates: Array<{
      id: string;
      vector?: Float32Array;
      metadata?: Record<string, unknown>;
    }>,
    _options?: BatchOptions,
  ): Promise<{
    succeeded: number;
    failed: number;
    errors: Array<{ id: string; error: Error }>;
  }> {
    let succeeded = 0;
    let failed = 0;
    const errors: Array<{ id: string; error: Error }> = [];

    for (const update of updates) {
      try {
        const entry = this.store.get(update.id);

        if (!entry) {
          throw new VectorNotFoundError(update.id);
        }

        if (update.vector) {
          entry.vector = update.vector;
          entry.magnitude = calculateMagnitude(update.vector);
        }

        if (update.metadata) {
          entry.metadata = entry.metadata
            ? { ...entry.metadata, ...update.metadata }
            : update.metadata;
        }

        entry.timestamp = Date.now();
        succeeded++;
      } catch (error) {
        failed++;
        errors.push({
          id: update.id,
          error: error instanceof Error ? error : new Error(String(error)),
        });
      }
    }

    return { succeeded, failed, errors };
  }
}
