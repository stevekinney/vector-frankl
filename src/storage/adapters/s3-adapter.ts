import { VectorNotFoundError } from '@/core/errors.js';
import type {
  BatchOptions,
  BatchProgress,
  ScanCapabilities,
  ScanOptions,
  StorageAdapter,
  VectorData,
} from '@/core/types.js';
import {
  S3_ADAPTER_CAPABILITIES,
  type AdapterCapabilities,
} from './adapter-capabilities.js';
import {
  calculateMagnitude,
  jsonToVectorData,
  vectorDataToJson,
} from './serialization.js';

// ---------------------------------------------------------------------------
// Bun S3 types (declared inline since @types/bun may not yet include the
// built-in S3 client)
// ---------------------------------------------------------------------------

interface BunS3File {
  text(): Promise<string>;
  exists(): Promise<boolean>;
  write(data: string): Promise<number>;
  delete(): Promise<void>;
}

interface BunS3Options {
  bucket: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  region?: string;
  endpoint?: string;
}

interface BunS3Client {
  file(key: string, options?: BunS3Options): BunS3File;
  write(key: string, data: string, options?: BunS3Options): Promise<number>;
  delete(key: string, options?: BunS3Options): Promise<void>;
  exists(key: string, options?: BunS3Options): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Options for {@link S3StorageAdapter}.
 *
 * @remarks
 * `S3StorageAdapter` is a **single-writer** adapter. Only one adapter instance
 * may write to a given `bucket` + `prefix` combination at a time. Multiple
 * instances writing concurrently will race on the manifest file and **will lose
 * IDs**. See {@link S3StorageAdapter} for a full explanation of this constraint.
 */
export interface S3StorageAdapterOptions {
  bucket: string;
  prefix?: string;
  region?: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}

// ---------------------------------------------------------------------------
// S3StorageAdapter
// ---------------------------------------------------------------------------

/**
 * Storage adapter backed by Bun's built-in `Bun.s3` S3 client.
 *
 * ## Single-writer contract
 *
 * `S3StorageAdapter` maintains an in-process manifest (`__index__.json`) that
 * tracks all stored vector IDs. A promise-based mutex serialises all manifest
 * mutations **within a single adapter instance**, so concurrent calls on the
 * *same* instance are safe.
 *
 * However, the mutex is **in-process only**. If two separate adapter instances
 * (i.e. two processes, two workers, or two `new S3StorageAdapter(…)` calls in
 * the same process) write to the same `bucket` + `prefix` simultaneously, each
 * instance maintains its own in-memory manifest and the two will diverge. The
 * last writer wins and **IDs written by the other instance will be lost from
 * the manifest**, even though the underlying S3 objects still exist.
 *
 * **Use this adapter only when a single process owns the `bucket` + `prefix`
 * at any given time.** For multi-writer workloads, S3 conditional writes
 * (ETag-based compare-and-swap) or an external coordination service are
 * required — neither is currently supported.
 *
 * The discriminant property `singleWriter: true` is present on every instance
 * so callers can detect this adapter's concurrency model at runtime:
 *
 * ```ts
 * if (adapter instanceof S3StorageAdapter) {
 *   console.warn('S3 adapter is single-writer only');
 * }
 * ```
 */
export class S3StorageAdapter implements StorageAdapter {
  /** Declared capability guarantees for this adapter. */
  static readonly capabilities: AdapterCapabilities = S3_ADAPTER_CAPABILITIES;

  /**
   * Discriminant flag marking this adapter as single-writer only.
   *
   * Concurrent writes from **multiple adapter instances** against the same
   * `bucket` + `prefix` will cause manifest corruption and ID loss. Only one
   * process/instance should own a given prefix at a time.
   */
  readonly singleWriter = true as const;

  private readonly prefix: string;
  private readonly s3Options: BunS3Options;
  private s3: BunS3Client | null = null;
  private index: Set<string> = new Set();

  /** Promise-based mutex to serialise index mutations within this instance. */
  private mutexQueue: Promise<void> = Promise.resolve();

  constructor(options: S3StorageAdapterOptions) {
    const rawPrefix = options.prefix ?? '';
    this.prefix =
      rawPrefix !== '' && !rawPrefix.endsWith('/') ? `${rawPrefix}/` : rawPrefix;
    this.s3Options = { bucket: options.bucket };

    if (options.accessKeyId !== undefined) {
      this.s3Options.accessKeyId = options.accessKeyId;
    }
    if (options.secretAccessKey !== undefined) {
      this.s3Options.secretAccessKey = options.secretAccessKey;
    }
    if (options.region !== undefined) {
      this.s3Options.region = options.region;
    }
    if (options.endpoint !== undefined) {
      this.s3Options.endpoint = options.endpoint;
    }
  }

  // ── Mutex ───────────────────────────────────────────────────────────────

  /**
   * Acquire the mutex, execute `fn`, then release. All index mutations must go
   * through this to prevent lost-update races on concurrent write operations.
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

  // ── Lifecycle ───────────────────────────────────────────────────────────

  async init(): Promise<void> {
    if (typeof Bun === 'undefined' || !Bun.s3) {
      throw new Error(
        'S3StorageAdapter requires the Bun runtime with built-in S3 support',
      );
    }

    this.s3 = Bun.s3 as unknown as BunS3Client;

    // Load the index manifest
    try {
      const indexFile = this.s3.file(this.indexKey(), this.s3Options);
      if (await indexFile.exists()) {
        const body = await indexFile.text();
        const ids = JSON.parse(body) as string[];
        this.index = new Set(ids);
      } else {
        this.index = new Set();
      }
    } catch {
      this.index = new Set();
    }
  }

  async close(): Promise<void> {
    if (this.s3) {
      await this.withMutex(() => this.persistIndex());
      this.s3 = null;
    }
  }

  async destroy(): Promise<void> {
    await this.withMutex(async () => {
      if (this.s3) {
        // Delete all vector objects
        for (const id of this.index) {
          await this.deleteObject(this.vectorKey(id));
        }
        // Delete the index manifest
        await this.deleteObject(this.indexKey());
        this.s3 = null;
      }
      this.index = new Set();
    });
  }

  // ── Single-item CRUD ────────────────────────────────────────────────────

  async put(vector: VectorData): Promise<void> {
    const data: VectorData = {
      ...vector,
      timestamp: vector.timestamp || Date.now(),
      lastAccessed: Date.now(),
    };

    await this.withMutex(async () => {
      await this.putObject(this.vectorKey(data.id), vectorDataToJson(data));
      this.index.add(data.id);
      await this.persistIndex();
    });
  }

  async get(id: string): Promise<VectorData> {
    if (!this.index.has(id)) {
      throw new VectorNotFoundError(id);
    }

    return this.withMutex(async () => {
      const body = await this.getObject(this.vectorKey(id));
      if (body === null) {
        this.index.delete(id);
        await this.persistIndex();
        throw new VectorNotFoundError(id);
      }

      const data = jsonToVectorData(body);

      // Update access tracking inside the mutex to prevent concurrent put()
      // from being silently overwritten by a stale write-back.
      data.lastAccessed = Date.now();
      data.accessCount = (data.accessCount ?? 0) + 1;
      await this.putObject(this.vectorKey(id), vectorDataToJson(data));

      return data;
    });
  }

  async exists(id: string): Promise<boolean> {
    return this.index.has(id);
  }

  async delete(id: string): Promise<void> {
    await this.withMutex(async () => {
      await this.deleteObject(this.vectorKey(id));
      this.index.delete(id);
      await this.persistIndex();
    });
  }

  // ── Multi-item reads ────────────────────────────────────────────────────

  async getMany(ids: string[]): Promise<VectorData[]> {
    return this.withMutex(async () => {
      const results: VectorData[] = [];
      const now = Date.now();
      const staleIds: string[] = [];

      for (const id of ids) {
        if (!this.index.has(id)) {
          continue;
        }

        const body = await this.getObject(this.vectorKey(id));
        if (body === null) {
          staleIds.push(id);
          continue;
        }

        const data = jsonToVectorData(body);
        // Update access tracking inside the mutex to prevent concurrent put()
        // from being silently overwritten by a stale write-back.
        data.lastAccessed = now;
        data.accessCount = (data.accessCount ?? 0) + 1;
        await this.putObject(this.vectorKey(id), vectorDataToJson(data));
        results.push(data);
      }

      for (const id of staleIds) {
        this.index.delete(id);
      }
      if (staleIds.length > 0) {
        await this.persistIndex();
      }

      return results;
    });
  }

  async getAll(): Promise<VectorData[]> {
    const results: VectorData[] = [];
    const staleIds: string[] = [];

    for (const id of this.index) {
      const body = await this.getObject(this.vectorKey(id));
      if (body === null) {
        staleIds.push(id);
        continue;
      }
      results.push(jsonToVectorData(body));
    }

    if (staleIds.length > 0) {
      await this.withMutex(async () => {
        for (const id of staleIds) {
          this.index.delete(id);
        }
        await this.persistIndex();
      });
    }

    return results;
  }

  async count(): Promise<number> {
    return this.index.size;
  }

  /**
   * Stream all vectors by fetching each object from S3 individually.
   *
   * S3 does not support cursor-based range reads; the in-memory index
   * enumerates IDs and each object is fetched one at a time.
   */
  async *scan(options?: ScanOptions): AsyncIterable<VectorData> {
    const ids = Array.from(this.index);

    for (const id of ids) {
      if (options?.signal?.aborted) return;
      const body = await this.getObject(this.vectorKey(id));
      if (body !== null) {
        yield jsonToVectorData(body);
      }
    }
  }

  /**
   * S3 maintains an in-memory ID index; object payloads are fetched one at
   * a time, but the ID set is always fully materialized.
   */
  getScanCapabilities(): ScanCapabilities {
    return {
      nativeStreaming: false,
      limitationReason:
        'S3StorageAdapter maintains a full in-memory ID index. Object payloads are fetched one at a time, but the ID set is always fully materialized.',
    };
  }

  // ── Multi-item writes ───────────────────────────────────────────────────

  async deleteMany(ids: string[]): Promise<number> {
    let deleted = 0;

    await this.withMutex(async () => {
      for (const id of ids) {
        if (this.index.has(id)) {
          await this.deleteObject(this.vectorKey(id));
          this.index.delete(id);
          deleted++;
        }
      }

      if (deleted > 0) {
        await this.persistIndex();
      }
    });

    return deleted;
  }

  async clear(): Promise<void> {
    await this.withMutex(async () => {
      for (const id of this.index) {
        await this.deleteObject(this.vectorKey(id));
      }

      await this.deleteObject(this.indexKey());
      this.index = new Set();
    });
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

      await this.withMutex(async () => {
        for (let i = start; i < end; i++) {
          const vector = vectors[i]!;
          const data: VectorData = {
            ...vector,
            timestamp: vector.timestamp || Date.now(),
            lastAccessed: Date.now(),
          };

          await this.putObject(this.vectorKey(data.id), vectorDataToJson(data));
          this.index.add(data.id);
        }

        await this.persistIndex();
      });

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
    await this.withMutex(async () => {
      const existing = await this.readExistingUnlocked(id);

      existing.vector = vector;

      if (options?.updateMagnitude !== false) {
        existing.magnitude = calculateMagnitude(vector);
      }

      if (options?.updateTimestamp !== false) {
        existing.timestamp = Date.now();
      }

      await this.putObject(this.vectorKey(id), vectorDataToJson(existing));
    });
  }

  async updateMetadata(
    id: string,
    metadata: Record<string, unknown>,
    options?: { merge?: boolean; updateTimestamp?: boolean },
  ): Promise<void> {
    await this.withMutex(async () => {
      const existing = await this.readExistingUnlocked(id);

      if (options?.merge !== false && existing.metadata) {
        existing.metadata = { ...existing.metadata, ...metadata };
      } else {
        existing.metadata = metadata;
      }

      if (options?.updateTimestamp !== false) {
        existing.timestamp = Date.now();
      }

      await this.putObject(this.vectorKey(id), vectorDataToJson(existing));
    });
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
    return this.withMutex(async () => {
      let succeeded = 0;
      let failed = 0;
      const errors: Array<{ id: string; error: Error }> = [];

      for (const update of updates) {
        try {
          const existing = await this.readExistingUnlocked(update.id);

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
          await this.putObject(this.vectorKey(update.id), vectorDataToJson(existing));
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
    });
  }

  // ── Internal helpers ────────────────────────────────────────────────────

  /**
   * Read a vector from S3 without updating access tracking.
   * Must be called from within `withMutex` — does not acquire the mutex itself.
   */
  private async readExistingUnlocked(id: string): Promise<VectorData> {
    if (!this.index.has(id)) {
      throw new VectorNotFoundError(id);
    }

    const body = await this.getObject(this.vectorKey(id));
    if (body === null) {
      this.index.delete(id);
      await this.persistIndex();
      throw new VectorNotFoundError(id);
    }

    return jsonToVectorData(body);
  }

  private vectorKey(id: string): string {
    return `${this.prefix}vectors/${encodeURIComponent(id)}.json`;
  }

  private indexKey(): string {
    return `${this.prefix}__index__.json`;
  }

  private requireS3(): BunS3Client {
    if (!this.s3) {
      throw new Error(
        'S3StorageAdapter is not initialized. Call init() before using the adapter.',
      );
    }
    return this.s3;
  }

  private async getObject(key: string): Promise<string | null> {
    const s3 = this.requireS3();
    const file = s3.file(key, this.s3Options);

    if (!(await file.exists())) {
      return null;
    }

    return file.text();
  }

  private async putObject(key: string, body: string): Promise<void> {
    const s3 = this.requireS3();
    await s3.write(key, body, this.s3Options);
  }

  private async deleteObject(key: string): Promise<void> {
    const s3 = this.requireS3();
    try {
      await s3.delete(key, this.s3Options);
    } catch {
      // Idempotent — ignore errors from deleting non-existent objects
    }
  }

  private async persistIndex(): Promise<void> {
    const json = JSON.stringify(Array.from(this.index));
    await this.putObject(this.indexKey(), json);
  }
}
