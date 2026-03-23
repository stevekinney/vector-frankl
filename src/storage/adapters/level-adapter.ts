import { rm } from 'node:fs/promises';

import { VectorNotFoundError } from '@/core/errors.js';
import type {
  BatchOptions,
  BatchProgress,
  StorageAdapter,
  VectorData,
} from '@/core/types.js';

// ---------------------------------------------------------------------------
// level types (declared inline because level is an optional peer dependency)
// ---------------------------------------------------------------------------

interface LevelDatabase {
  put(key: string, value: string): Promise<void>;
  get(key: string): Promise<string | undefined>;
  del(key: string): Promise<void>;
  batch(): LevelBatch;
  iterator(): AsyncIterable<[string, string]>;
  open(): Promise<void>;
  clear(): Promise<void>;
  close(): Promise<void>;
}

interface LevelBatch {
  put(key: string, value: string): LevelBatch;
  del(key: string): LevelBatch;
  write(): Promise<void>;
}

interface LevelConstructor {
  new (directory: string): LevelDatabase;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface LevelStorageAdapterOptions {
  directory: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function calculateMagnitude(vector: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < vector.length; i++) {
    sum += vector[i]! * vector[i]!;
  }
  return Math.sqrt(sum);
}

// ---------------------------------------------------------------------------
// Serialization — JSON format
// ---------------------------------------------------------------------------

interface SerializedVectorData {
  id: string;
  vector: number[];
  metadata?: Record<string, unknown>;
  magnitude: number;
  format?: string;
  normalized?: boolean;
  timestamp: number;
  lastAccessed?: number;
  accessCount?: number;
  compression?: VectorData['compression'];
}

function vectorDataToJson(data: VectorData): string {
  const serialized: SerializedVectorData = {
    id: data.id,
    vector: Array.from(data.vector),
    magnitude: data.magnitude,
    timestamp: data.timestamp,
  };

  if (data.metadata !== undefined) {
    serialized.metadata = data.metadata;
  }
  if (data.format !== undefined) {
    serialized.format = data.format;
  }
  if (data.normalized !== undefined) {
    serialized.normalized = data.normalized;
  }
  if (data.lastAccessed !== undefined) {
    serialized.lastAccessed = data.lastAccessed;
  }
  if (data.accessCount !== undefined) {
    serialized.accessCount = data.accessCount;
  }
  if (data.compression !== undefined) {
    serialized.compression = data.compression;
  }

  return JSON.stringify(serialized);
}

function jsonToVectorData(json: string): VectorData {
  const parsed = JSON.parse(json) as SerializedVectorData;
  const result: VectorData = {
    id: parsed.id,
    vector: new Float32Array(parsed.vector),
    magnitude: parsed.magnitude,
    timestamp: parsed.timestamp,
  };

  if (parsed.metadata !== undefined) {
    result.metadata = parsed.metadata;
  }
  if (parsed.format !== undefined) {
    result.format = parsed.format;
  }
  if (parsed.normalized !== undefined) {
    result.normalized = parsed.normalized;
  }
  if (parsed.lastAccessed !== undefined) {
    result.lastAccessed = parsed.lastAccessed;
  }
  if (parsed.accessCount !== undefined) {
    result.accessCount = parsed.accessCount;
  }
  if (parsed.compression !== undefined) {
    result.compression = parsed.compression;
  }

  return result;
}

// ---------------------------------------------------------------------------
// LevelStorageAdapter
// ---------------------------------------------------------------------------

export class LevelStorageAdapter implements StorageAdapter {
  private readonly directory: string;
  private database: LevelDatabase | null = null;

  constructor(options: LevelStorageAdapterOptions) {
    this.directory = options.directory;
  }

  private getDatabase(): LevelDatabase {
    if (!this.database) {
      throw new Error('LevelStorageAdapter has not been initialized. Call init() first.');
    }
    return this.database;
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────

  async init(): Promise<void> {
    if (this.database) {
      return;
    }

    const moduleName = 'level';
    const { Level } = (await import(/* webpackIgnore: true */ moduleName)) as {
      Level: LevelConstructor;
    };
    const database = new Level(this.directory);
    await database.open();
    this.database = database;
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
    const database = this.getDatabase();

    const stored: VectorData = {
      ...vector,
      timestamp: vector.timestamp || Date.now(),
      lastAccessed: Date.now(),
    };

    await database.put(stored.id, vectorDataToJson(stored));
  }

  async get(id: string): Promise<VectorData> {
    const database = this.getDatabase();

    const json = await database.get(id);

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
    const database = this.getDatabase();
    const value = await database.get(id);
    return value !== undefined;
  }

  async delete(id: string): Promise<void> {
    const database = this.getDatabase();
    await database.del(id);
  }

  // ── Multi-item reads ────────────────────────────────────────────────────

  async getMany(ids: string[]): Promise<VectorData[]> {
    const database = this.getDatabase();
    const results: VectorData[] = [];
    const now = Date.now();

    for (const id of ids) {
      const json = await database.get(id);
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
    const database = this.getDatabase();
    const results: VectorData[] = [];

    for await (const [_key, value] of database.iterator()) {
      results.push(jsonToVectorData(value));
    }

    return results;
  }

  async count(): Promise<number> {
    const database = this.getDatabase();
    let total = 0;

    for await (const _entry of database.iterator()) {
      total++;
    }

    return total;
  }

  // ── Multi-item writes ───────────────────────────────────────────────────

  async deleteMany(ids: string[]): Promise<number> {
    const database = this.getDatabase();
    let deleted = 0;

    for (const id of ids) {
      const value = await database.get(id);
      if (value !== undefined) {
        await database.del(id);
        deleted++;
      }
    }

    return deleted;
  }

  async clear(): Promise<void> {
    const database = this.getDatabase();
    await database.clear();
  }

  async putBatch(vectors: VectorData[], options?: BatchOptions): Promise<void> {
    const database = this.getDatabase();
    const batchSize = options?.batchSize ?? vectors.length;
    const totalBatches = Math.ceil(vectors.length / batchSize);

    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      if (options?.abortSignal?.aborted) {
        throw new DOMException('The operation was aborted.', 'AbortError');
      }

      const start = batchIndex * batchSize;
      const end = Math.min(start + batchSize, vectors.length);

      const batch = database.batch();

      for (let i = start; i < end; i++) {
        const vector = vectors[i]!;
        const stored: VectorData = {
          ...vector,
          timestamp: vector.timestamp || Date.now(),
          lastAccessed: Date.now(),
        };
        batch.put(stored.id, vectorDataToJson(stored));
      }

      await batch.write();

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
    const database = this.getDatabase();

    const json = await database.get(id);

    if (json === undefined) {
      throw new VectorNotFoundError(id);
    }

    const existing = jsonToVectorData(json);
    existing.vector = vector;

    if (options?.updateMagnitude !== false) {
      existing.magnitude = calculateMagnitude(vector);
    }

    if (options?.updateTimestamp !== false) {
      existing.timestamp = Date.now();
    }

    await database.put(id, vectorDataToJson(existing));
  }

  async updateMetadata(
    id: string,
    metadata: Record<string, unknown>,
    options?: { merge?: boolean; updateTimestamp?: boolean },
  ): Promise<void> {
    const database = this.getDatabase();

    const json = await database.get(id);

    if (json === undefined) {
      throw new VectorNotFoundError(id);
    }

    const existing = jsonToVectorData(json);

    if (options?.merge !== false && existing.metadata) {
      existing.metadata = { ...existing.metadata, ...metadata };
    } else {
      existing.metadata = metadata;
    }

    if (options?.updateTimestamp !== false) {
      existing.timestamp = Date.now();
    }

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
    const database = this.getDatabase();
    let succeeded = 0;
    let failed = 0;
    const errors: Array<{ id: string; error: Error }> = [];

    for (const update of updates) {
      try {
        const json = await database.get(update.id);

        if (json === undefined) {
          throw new VectorNotFoundError(update.id);
        }

        const existing = jsonToVectorData(json);

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
}
