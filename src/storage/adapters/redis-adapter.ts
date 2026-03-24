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
// Bun.RedisClient types (declared inline since the @types/bun version may
// not yet include the built-in Redis client)
// ---------------------------------------------------------------------------

interface BunRedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  del(...keys: string[]): Promise<number>;
  exists(...keys: string[]): Promise<number>;
  mget(...keys: string[]): Promise<Array<string | null>>;
  sadd(key: string, ...members: string[]): Promise<number>;
  srem(key: string, ...members: string[]): Promise<number>;
  scard(key: string): Promise<number>;
  smembers(key: string): Promise<string[]>;
  close(): void;
}

interface BunRedisClientConstructor {
  new (url?: string): BunRedisClient;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

interface RedisStorageAdapterOptions {
  url?: string;
  prefix: string;
}

// ---------------------------------------------------------------------------
// RedisStorageAdapter
// ---------------------------------------------------------------------------

export class RedisStorageAdapter implements StorageAdapter {
  private readonly url: string | undefined;
  private readonly prefix: string;
  private client: BunRedisClient | null = null;

  constructor(options: RedisStorageAdapterOptions) {
    this.url = options.url;
    this.prefix = options.prefix;
  }

  private getClient(): BunRedisClient {
    if (!this.client) {
      throw new Error('RedisStorageAdapter has not been initialized. Call init() first.');
    }
    return this.client;
  }

  /** Build the Redis key for a vector's data. */
  private vectorKey(id: string): string {
    return `${this.prefix}:v:${id}`;
  }

  /** Build the Redis key for the SET that tracks all vector IDs. */
  private idSetKey(): string {
    return `${this.prefix}:ids`;
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────

  async init(): Promise<void> {
    // Make init idempotent: if a client already exists, do nothing.
    if (this.client) {
      return;
    }

    if (typeof Bun === 'undefined' || !Bun.RedisClient) {
      throw new Error(
        'RedisStorageAdapter requires the Bun runtime with built-in Redis support',
      );
    }

    const RedisClient = Bun.RedisClient as unknown as BunRedisClientConstructor;

    this.client = this.url !== undefined ? new RedisClient(this.url) : new RedisClient();
  }

  async close(): Promise<void> {
    if (this.client) {
      this.client.close();
      this.client = null;
    }
  }

  async destroy(): Promise<void> {
    if (!this.client) {
      await this.init();
    }
    await this.clear();
    this.client!.close();
    this.client = null;
  }

  // ── Single-item CRUD ────────────────────────────────────────────────────

  async put(vector: VectorData): Promise<void> {
    const client = this.getClient();

    const stored: VectorData = {
      ...vector,
      timestamp: vector.timestamp || Date.now(),
      lastAccessed: Date.now(),
    };

    await client.set(this.vectorKey(stored.id), vectorDataToJson(stored));
    await client.sadd(this.idSetKey(), stored.id);
  }

  async get(id: string): Promise<VectorData> {
    const client = this.getClient();

    const json = await client.get(this.vectorKey(id));
    if (json === null) {
      throw new VectorNotFoundError(id);
    }

    const data = jsonToVectorData(json);

    // Update access tracking
    data.lastAccessed = Date.now();
    data.accessCount = (data.accessCount ?? 0) + 1;
    await client.set(this.vectorKey(id), vectorDataToJson(data));

    return data;
  }

  async exists(id: string): Promise<boolean> {
    const client = this.getClient();
    const result = await client.exists(this.vectorKey(id));
    return result === 1;
  }

  async delete(id: string): Promise<void> {
    const client = this.getClient();
    await client.del(this.vectorKey(id));
    await client.srem(this.idSetKey(), id);
  }

  // ── Multi-item reads ────────────────────────────────────────────────────

  async getMany(ids: string[]): Promise<VectorData[]> {
    if (ids.length === 0) return [];

    const client = this.getClient();
    const keys = ids.map((id) => this.vectorKey(id));
    const values = await client.mget(...keys);

    const results: VectorData[] = [];
    const now = Date.now();

    for (const json of values) {
      if (json === null || json === undefined) continue;

      const data = jsonToVectorData(json);
      data.lastAccessed = now;
      data.accessCount = (data.accessCount ?? 0) + 1;

      await client.set(this.vectorKey(data.id), vectorDataToJson(data));
      results.push(data);
    }

    return results;
  }

  async getAll(): Promise<VectorData[]> {
    const client = this.getClient();
    const ids = await client.smembers(this.idSetKey());

    if (ids.length === 0) return [];

    const keys = ids.map((id) => this.vectorKey(id));
    const values = await client.mget(...keys);

    const results: VectorData[] = [];

    for (const json of values) {
      if (json === null || json === undefined) continue;
      results.push(jsonToVectorData(json));
    }

    return results;
  }

  async count(): Promise<number> {
    const client = this.getClient();
    return client.scard(this.idSetKey());
  }

  // ── Multi-item writes ───────────────────────────────────────────────────

  async deleteMany(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;

    const client = this.getClient();
    let deleted = 0;

    for (const id of ids) {
      const exists = await client.exists(this.vectorKey(id));
      if (exists === 1) {
        await client.del(this.vectorKey(id));
        await client.srem(this.idSetKey(), id);
        deleted++;
      }
    }

    return deleted;
  }

  async clear(): Promise<void> {
    const client = this.getClient();
    const ids = await client.smembers(this.idSetKey());

    for (const id of ids) {
      await client.del(this.vectorKey(id));
    }
    await client.del(this.idSetKey());
  }

  async putBatch(vectors: VectorData[], options?: BatchOptions): Promise<void> {
    if (vectors.length === 0) return;

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
    const client = this.getClient();

    const json = await client.get(this.vectorKey(id));
    if (json === null) {
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

    await client.set(this.vectorKey(id), vectorDataToJson(existing));
  }

  async updateMetadata(
    id: string,
    metadata: Record<string, unknown>,
    options?: { merge?: boolean; updateTimestamp?: boolean },
  ): Promise<void> {
    const client = this.getClient();

    const json = await client.get(this.vectorKey(id));
    if (json === null) {
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

    await client.set(this.vectorKey(id), vectorDataToJson(existing));
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
    const client = this.getClient();
    let succeeded = 0;
    let failed = 0;
    const errors: Array<{ id: string; error: Error }> = [];

    for (const update of updates) {
      try {
        const json = await client.get(this.vectorKey(update.id));
        if (json === null) {
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
        await client.set(this.vectorKey(update.id), vectorDataToJson(existing));
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
