import { rm } from 'node:fs/promises';

import { VectorNotFoundError } from '@/core/errors.js';
import type {
  BatchOptions,
  BatchProgress,
  StorageAdapter,
  VectorData,
} from '@/core/types.js';
import { calculateMagnitude } from './serialization.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

interface SQLiteStorageAdapterOptions {
  /** Path to the SQLite database file, or ':memory:' for in-memory. */
  filename: string;
}

function vectorToBlob(vector: Float32Array): Uint8Array {
  return new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength);
}

function blobToVector(blob: Uint8Array): Float32Array {
  return new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4);
}

// ---------------------------------------------------------------------------
// Row shape returned by bun:sqlite queries
// ---------------------------------------------------------------------------

interface VectorRow {
  id: string;
  vector: Uint8Array;
  metadata: string | null;
  magnitude: number;
  format: string | null;
  normalized: number;
  timestamp: number;
  last_accessed: number;
  access_count: number;
  compression: string | null;
}

function rowToVectorData(row: VectorRow): VectorData {
  const data: VectorData = {
    id: row.id,
    vector: blobToVector(row.vector),
    magnitude: row.magnitude,
    timestamp: row.timestamp,
  };

  if (row.metadata !== null) {
    data.metadata = JSON.parse(row.metadata) as Record<string, unknown>;
  }

  if (row.format !== null) {
    data.format = row.format;
  }

  if (row.normalized === 1) {
    data.normalized = true;
  }

  if (row.last_accessed !== 0) {
    data.lastAccessed = row.last_accessed;
  }

  if (row.access_count > 0) {
    data.accessCount = row.access_count;
  }

  if (row.compression !== null) {
    data.compression = JSON.parse(row.compression) as NonNullable<
      VectorData['compression']
    >;
  }

  return data;
}

// ---------------------------------------------------------------------------
// SQLiteStorageAdapter
// ---------------------------------------------------------------------------

/** Minimal interface for the bun:sqlite Database instance used by this adapter. */
interface BunSQLiteDatabase {
  exec(sql: string): void;
  run(sql: string, params?: unknown[]): { changes: number };
  query(sql: string): {
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
  prepare(sql: string): {
    run(...params: unknown[]): { changes: number };
  };
  transaction<T extends (...args: never[]) => void>(fn: T): T;
  close(): void;
}

export class SQLiteStorageAdapter implements StorageAdapter {
  private readonly filename: string;
  private database: BunSQLiteDatabase | null = null;

  constructor(options: SQLiteStorageAdapterOptions) {
    if (typeof Bun === 'undefined') {
      throw new Error('SQLiteStorageAdapter requires the Bun runtime');
    }
    this.filename = options.filename;
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────

  async init(): Promise<void> {
    // Make init idempotent: if a database connection already exists, do nothing.
    if (this.database !== null) {
      return;
    }

    const moduleName = 'bun:sqlite';
    const { Database } = (await import(/* webpackIgnore: true */ moduleName)) as {
      Database: new (filename: string) => BunSQLiteDatabase;
    };

    this.database = new Database(this.filename);
    this.database.exec('PRAGMA journal_mode=WAL');

    this.database.exec(`
      CREATE TABLE IF NOT EXISTS vectors (
        id TEXT PRIMARY KEY,
        vector BLOB NOT NULL,
        metadata TEXT,
        magnitude REAL NOT NULL,
        format TEXT,
        normalized INTEGER NOT NULL DEFAULT 0,
        timestamp INTEGER NOT NULL,
        last_accessed INTEGER NOT NULL,
        access_count INTEGER NOT NULL DEFAULT 0,
        compression TEXT
      )
    `);
  }

  async close(): Promise<void> {
    if (this.database) {
      this.database.close();
      this.database = null;
    }
  }

  async destroy(): Promise<void> {
    if (this.database) {
      this.database.close();
      this.database = null;
    }

    // For file-based databases, remove the file and any WAL/SHM companions.
    if (this.filename !== ':memory:') {
      await rm(this.filename, { force: true });
      await rm(`${this.filename}-wal`, { force: true });
      await rm(`${this.filename}-shm`, { force: true });
    }
  }

  // ── Single-item CRUD ────────────────────────────────────────────────────

  async put(vector: VectorData): Promise<void> {
    const database = this.requireDatabase();
    const now = Date.now();

    database.run(
      `INSERT OR REPLACE INTO vectors
        (id, vector, metadata, magnitude, format, normalized, timestamp, last_accessed, access_count, compression)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        vector.id,
        vectorToBlob(vector.vector),
        vector.metadata !== undefined ? JSON.stringify(vector.metadata) : null,
        vector.magnitude,
        vector.format ?? null,
        vector.normalized ? 1 : 0,
        vector.timestamp || now,
        now,
        vector.accessCount ?? 0,
        vector.compression !== undefined ? JSON.stringify(vector.compression) : null,
      ],
    );
  }

  async get(id: string): Promise<VectorData> {
    const database = this.requireDatabase();
    const now = Date.now();

    const row = database
      .query(
        'SELECT id, vector, metadata, magnitude, format, normalized, timestamp, last_accessed, access_count, compression FROM vectors WHERE id = ?',
      )
      .get(id) as VectorRow | null;

    if (!row) {
      throw new VectorNotFoundError(id);
    }

    database.run(
      'UPDATE vectors SET last_accessed = ?, access_count = access_count + 1 WHERE id = ?',
      [now, id],
    );

    const data = rowToVectorData(row);
    data.lastAccessed = now;
    data.accessCount = (data.accessCount ?? 0) + 1;
    return data;
  }

  async exists(id: string): Promise<boolean> {
    const database = this.requireDatabase();
    const row = database.query('SELECT 1 FROM vectors WHERE id = ? LIMIT 1').get(id);
    return row != null;
  }

  async delete(id: string): Promise<void> {
    const database = this.requireDatabase();
    database.run('DELETE FROM vectors WHERE id = ?', [id]);
  }

  // ── Multi-item reads ────────────────────────────────────────────────────

  async getMany(ids: string[]): Promise<VectorData[]> {
    if (ids.length === 0) return [];

    const database = this.requireDatabase();
    const now = Date.now();
    const placeholders = ids.map(() => '?').join(', ');

    const rows = database
      .query(
        `SELECT id, vector, metadata, magnitude, format, normalized, timestamp, last_accessed, access_count, compression
         FROM vectors WHERE id IN (${placeholders})`,
      )
      .all(...ids) as VectorRow[];

    if (rows.length === 0) {
      return [];
    }

    // Update access tracking for found rows
    const foundIds = rows.map((row) => row.id);
    const updatePlaceholders = foundIds.map(() => '?').join(', ');
    database.run(
      `UPDATE vectors SET last_accessed = ?, access_count = access_count + 1 WHERE id IN (${updatePlaceholders})`,
      [now, ...foundIds],
    );

    return rows.map((row) => {
      const data = rowToVectorData(row);
      data.lastAccessed = now;
      data.accessCount = (data.accessCount ?? 0) + 1;
      return data;
    });
  }

  async getAll(): Promise<VectorData[]> {
    const database = this.requireDatabase();
    const rows = database
      .query(
        'SELECT id, vector, metadata, magnitude, format, normalized, timestamp, last_accessed, access_count, compression FROM vectors',
      )
      .all() as VectorRow[];

    return rows.map(rowToVectorData);
  }

  async count(): Promise<number> {
    const database = this.requireDatabase();
    const row = database.query('SELECT COUNT(*) as total FROM vectors').get() as {
      total: number;
    } | null;
    return row?.total ?? 0;
  }

  // ── Multi-item writes ───────────────────────────────────────────────────

  async deleteMany(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;

    const database = this.requireDatabase();
    const placeholders = ids.map(() => '?').join(', ');

    const result = database.run(`DELETE FROM vectors WHERE id IN (${placeholders})`, ids);
    return result.changes;
  }

  async clear(): Promise<void> {
    const database = this.requireDatabase();
    database.run('DELETE FROM vectors');
  }

  async putBatch(vectors: VectorData[], options?: BatchOptions): Promise<void> {
    if (vectors.length === 0) return;

    const database = this.requireDatabase();
    const batchSize = options?.batchSize ?? vectors.length;
    const totalBatches = Math.ceil(vectors.length / batchSize);
    const now = Date.now();

    const insertStatement = database.prepare(
      `INSERT OR REPLACE INTO vectors
        (id, vector, metadata, magnitude, format, normalized, timestamp, last_accessed, access_count, compression)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const runBatch = database.transaction((batch: VectorData[]) => {
      for (const vector of batch) {
        insertStatement.run(
          vector.id,
          vectorToBlob(vector.vector),
          vector.metadata !== undefined ? JSON.stringify(vector.metadata) : null,
          vector.magnitude,
          vector.format ?? null,
          vector.normalized ? 1 : 0,
          vector.timestamp || now,
          now,
          vector.accessCount ?? 0,
          vector.compression !== undefined ? JSON.stringify(vector.compression) : null,
        );
      }
    });

    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      if (options?.abortSignal?.aborted) {
        throw new DOMException('The operation was aborted.', 'AbortError');
      }

      const start = batchIndex * batchSize;
      const end = Math.min(start + batchSize, vectors.length);

      runBatch(vectors.slice(start, end));

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
    const database = this.requireDatabase();

    const check = database.query('SELECT 1 FROM vectors WHERE id = ? LIMIT 1').get(id);
    if (!check) {
      throw new VectorNotFoundError(id);
    }

    const magnitude =
      options?.updateMagnitude !== false ? calculateMagnitude(vector) : undefined;
    const timestamp = options?.updateTimestamp !== false ? Date.now() : undefined;

    let sql = 'UPDATE vectors SET vector = ?';
    const params: (string | number | Uint8Array | null)[] = [vectorToBlob(vector)];

    if (magnitude !== undefined) {
      sql += ', magnitude = ?';
      params.push(magnitude);
    }
    if (timestamp !== undefined) {
      sql += ', timestamp = ?';
      params.push(timestamp);
    }

    sql += ' WHERE id = ?';
    params.push(id);

    database.run(sql, params);
  }

  async updateMetadata(
    id: string,
    metadata: Record<string, unknown>,
    options?: { merge?: boolean; updateTimestamp?: boolean },
  ): Promise<void> {
    const database = this.requireDatabase();

    const row = database.query('SELECT metadata FROM vectors WHERE id = ?').get(id) as {
      metadata: string | null;
    } | null;

    if (!row) {
      throw new VectorNotFoundError(id);
    }

    let merged: Record<string, unknown>;

    if (options?.merge !== false && row.metadata) {
      const existing = JSON.parse(row.metadata) as Record<string, unknown>;
      merged = { ...existing, ...metadata };
    } else {
      merged = metadata;
    }

    const timestamp = options?.updateTimestamp !== false ? Date.now() : undefined;
    let sql = 'UPDATE vectors SET metadata = ?';
    const params: (string | number | null)[] = [JSON.stringify(merged)];

    if (timestamp !== undefined) {
      sql += ', timestamp = ?';
      params.push(timestamp);
    }

    sql += ' WHERE id = ?';
    params.push(id);

    database.run(sql, params);
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
    const database = this.requireDatabase();
    let succeeded = 0;
    let failed = 0;
    const errors: Array<{ id: string; error: Error }> = [];

    const runUpdates = database.transaction(() => {
      for (const update of updates) {
        try {
          const row = database
            .query('SELECT metadata, magnitude FROM vectors WHERE id = ?')
            .get(update.id) as { metadata: string | null; magnitude: number } | null;

          if (!row) {
            throw new VectorNotFoundError(update.id);
          }

          const setClauses: string[] = [];
          const params: (string | number | Uint8Array | null)[] = [];

          if (update.vector) {
            setClauses.push('vector = ?');
            params.push(vectorToBlob(update.vector));
            setClauses.push('magnitude = ?');
            params.push(calculateMagnitude(update.vector));
          }

          if (update.metadata) {
            const existing = row.metadata
              ? (JSON.parse(row.metadata) as Record<string, unknown>)
              : {};
            const merged = { ...existing, ...update.metadata };
            setClauses.push('metadata = ?');
            params.push(JSON.stringify(merged));
          }

          setClauses.push('timestamp = ?');
          params.push(Date.now());

          params.push(update.id);
          database.run(
            `UPDATE vectors SET ${setClauses.join(', ')} WHERE id = ?`,
            params,
          );

          succeeded++;
        } catch (error) {
          failed++;
          errors.push({
            id: update.id,
            error: error instanceof Error ? error : new Error(String(error)),
          });
        }
      }
    });

    runUpdates();

    return { succeeded, failed, errors };
  }

  // ── Internal helpers ────────────────────────────────────────────────────

  private requireDatabase(): BunSQLiteDatabase {
    if (!this.database) {
      throw new Error(
        'SQLiteStorageAdapter is not initialized. Call init() before using the adapter.',
      );
    }
    return this.database;
  }
}
