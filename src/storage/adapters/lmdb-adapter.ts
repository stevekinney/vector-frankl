import { rm } from 'node:fs/promises';

import { VectorNotFoundError } from '@/core/errors.js';
import type {
  BatchOptions,
  BatchProgress,
  StorageAdapter,
  VectorData,
} from '@/core/types.js';
import {
  calculateMagnitude,
  jsonToVectorData,
  vectorDataToJson,
} from './serialization.js';

// ---------------------------------------------------------------------------
// LMDB types (declared inline because lmdb is an optional peer dependency)
// ---------------------------------------------------------------------------

interface LmdbDatabase {
  get(key: string): string | undefined;
  put(key: string, value: string): Promise<boolean>;
  remove(key: string): Promise<boolean>;
  transaction<T>(fn: () => T): T;
  getRange(options?: {
    start?: string;
    end?: string;
  }): Iterable<{ key: string; value: string }>;
  drop(): Promise<void>;
  close(): Promise<void>;
}

interface LmdbOpenOptions {
  path: string;
  mapSize?: number;
  encoding: 'string';
}

type LmdbOpenFunction = (options: LmdbOpenOptions) => LmdbDatabase;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

interface LmdbStorageAdapterOptions {
  directory: string;
  mapSize?: number;
}

// ---------------------------------------------------------------------------
// LmdbStorageAdapter
// ---------------------------------------------------------------------------

export class LmdbStorageAdapter implements StorageAdapter {
  private readonly directory: string;
  private readonly mapSize: number | undefined;
  private database: LmdbDatabase | null = null;

  constructor(options: LmdbStorageAdapterOptions) {
    this.directory = options.directory;
    this.mapSize = options.mapSize;
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────

  async init(): Promise<void> {
    // Make init idempotent: if a database handle already exists, do nothing.
    if (this.database !== null) {
      return;
    }

    // lmdb is an optional peer dependency -- use a variable to avoid
    // TypeScript's static module resolution on the import specifier.
    const moduleName = 'lmdb';
    const { open } = (await import(/* webpackIgnore: true */ moduleName)) as {
      open: LmdbOpenFunction;
    };

    const options: LmdbOpenOptions = {
      path: this.directory,
      encoding: 'string',
    };

    if (this.mapSize !== undefined) {
      options.mapSize = this.mapSize;
    }

    this.database = open(options);
  }

  async close(): Promise<void> {
    if (this.database) {
      await this.database.close();
      this.database = null;
    }
  }

  async destroy(): Promise<void> {
    if (this.database) {
      await this.database.close();
      this.database = null;
    }

    await rm(this.directory, { recursive: true, force: true });
  }

  // ── Single-item CRUD ────────────────────────────────────────────────────

  async put(vector: VectorData): Promise<void> {
    const database = this.requireDatabase();

    const data: VectorData = {
      ...vector,
      timestamp: vector.timestamp || Date.now(),
      lastAccessed: Date.now(),
    };

    const json = vectorDataToJson(data);
    await database.put(data.id, json);
  }

  async get(id: string): Promise<VectorData> {
    const database = this.requireDatabase();

    const json = database.get(id);

    if (json === undefined) {
      throw new VectorNotFoundError(id);
    }

    const data = jsonToVectorData(json);

    // Update access tracking
    data.lastAccessed = Date.now();
    data.accessCount = (data.accessCount ?? 0) + 1;
    await database.put(id, vectorDataToJson(data));

    return data;
  }

  async exists(id: string): Promise<boolean> {
    const database = this.requireDatabase();
    return database.get(id) !== undefined;
  }

  async delete(id: string): Promise<void> {
    const database = this.requireDatabase();
    await database.remove(id);
  }

  // ── Multi-item reads ────────────────────────────────────────────────────

  async getMany(ids: string[]): Promise<VectorData[]> {
    const database = this.requireDatabase();
    const results: VectorData[] = [];
    const now = Date.now();

    for (const id of ids) {
      const json = database.get(id);
      if (json !== undefined) {
        const data = jsonToVectorData(json);
        data.lastAccessed = now;
        data.accessCount = (data.accessCount ?? 0) + 1;
        await database.put(id, vectorDataToJson(data));
        results.push(data);
      }
    }

    return results;
  }

  async getAll(): Promise<VectorData[]> {
    const database = this.requireDatabase();
    const results: VectorData[] = [];

    for (const entry of database.getRange()) {
      const data = jsonToVectorData(entry.value);
      results.push(data);
    }

    return results;
  }

  async count(): Promise<number> {
    const database = this.requireDatabase();
    let total = 0;

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for (const _ of database.getRange()) {
      total++;
    }

    return total;
  }

  // ── Multi-item writes ───────────────────────────────────────────────────

  async deleteMany(ids: string[]): Promise<number> {
    const database = this.requireDatabase();
    let deleted = 0;

    for (const id of ids) {
      const exists = database.get(id) !== undefined;
      if (exists) {
        await database.remove(id);
        deleted++;
      }
    }

    return deleted;
  }

  async clear(): Promise<void> {
    const database = this.requireDatabase();
    const keys = Array.from(database.getRange()).map((entry) => entry.key);
    for (const key of keys) {
      await database.remove(key);
    }
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
        await this.put(vector);
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

  // ── Partial updates (read-modify-write) ─────────────────────────────────

  async updateVector(
    id: string,
    vector: Float32Array,
    options?: { updateMagnitude?: boolean; updateTimestamp?: boolean },
  ): Promise<void> {
    const existing = this.readExisting(id);

    existing.vector = vector;

    if (options?.updateMagnitude !== false) {
      existing.magnitude = calculateMagnitude(vector);
    }

    if (options?.updateTimestamp !== false) {
      existing.timestamp = Date.now();
    }

    const database = this.requireDatabase();
    await database.put(id, vectorDataToJson(existing));
  }

  async updateMetadata(
    id: string,
    metadata: Record<string, unknown>,
    options?: { merge?: boolean; updateTimestamp?: boolean },
  ): Promise<void> {
    const existing = this.readExisting(id);

    if (options?.merge !== false && existing.metadata) {
      existing.metadata = { ...existing.metadata, ...metadata };
    } else {
      existing.metadata = metadata;
    }

    if (options?.updateTimestamp !== false) {
      existing.timestamp = Date.now();
    }

    const database = this.requireDatabase();
    await database.put(id, vectorDataToJson(existing));
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
        const existing = this.readExisting(update.id);

        if (update.vector) {
          existing.vector = update.vector;
          existing.magnitude = calculateMagnitude(update.vector);
        }

        if (update.metadata) {
          existing.metadata = existing.metadata
            ? { ...existing.metadata, ...update.metadata }
            : update.metadata;
        }

        existing.timestamp = Date.now();

        const database = this.requireDatabase();
        await database.put(update.id, vectorDataToJson(existing));
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

  // ── Internal helpers ────────────────────────────────────────────────────

  /** Read a vector from the database without updating access tracking. */
  private readExisting(id: string): VectorData {
    const database = this.requireDatabase();
    const json = database.get(id);

    if (json === undefined) {
      throw new VectorNotFoundError(id);
    }

    return jsonToVectorData(json);
  }

  private requireDatabase(): LmdbDatabase {
    if (!this.database) {
      throw new Error(
        'LmdbStorageAdapter is not initialized. Call init() before using the adapter.',
      );
    }
    return this.database;
  }
}
