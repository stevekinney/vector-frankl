import { BatchOperationError, VectorNotFoundError } from '@/core/errors.js';
import type { BatchOptions, BatchProgress, StorageAdapter, VectorData } from '@/core/types.js';

// ---------------------------------------------------------------------------
// sql.js types (declared inline because sql.js is an optional peer dependency)
// ---------------------------------------------------------------------------

interface SqlJsDatabase {
  run(sql: string, params?: unknown[]): SqlJsDatabase;
  exec(sql: string, params?: unknown[]): Array<{ columns: string[]; values: unknown[][] }>;
  getRowsModified(): number;
  close(): void;
  export(): Uint8Array;
}

interface SqlJsStatic {
  Database: new (data?: ArrayLike<number>) => SqlJsDatabase;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

interface SQLiteStorageAdapterOptions {
  /** URL to the sql.js WASM binary. */
  wasmUrl: string;
  /** Where the database bytes live between sessions. */
  persistence?: 'memory' | 'opfs' | 'indexeddb';
  /** Logical filename used as a key when persisting to IndexedDB or OPFS. */
  filename?: string;
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

function vectorToBlob(vector: Float32Array): Uint8Array {
  return new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength);
}

function blobToVector(blob: unknown): Float32Array {
  const bytes = new Uint8Array(blob as ArrayLike<number>);
  return new Float32Array(bytes.buffer);
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class SQLiteStorageAdapter implements StorageAdapter {
  private readonly options: SQLiteStorageAdapterOptions;
  private database: SqlJsDatabase | null = null;

  constructor(options: SQLiteStorageAdapterOptions) {
    this.options = options;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async init(): Promise<void> {
    // sql.js is an optional peer dependency -- use a variable to avoid
    // TypeScript's static module resolution on the import specifier.
    const moduleName = 'sql.js';
    const { default: initSqlJs } = (await import(/* webpackIgnore: true */ moduleName)) as {
      default: unknown;
    };
    const SQL: SqlJsStatic = await (initSqlJs as (config: { locateFile: (file: string) => string }) => Promise<SqlJsStatic>)({
      locateFile: (_file: string) => this.options.wasmUrl,
    });

    const existingData = await this.loadPersistedData();
    this.database = existingData ? new SQL.Database(existingData) : new SQL.Database();

    this.database.run(`
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
    const database = this.requireDatabase();
    await this.persist();
    database.close();
    this.database = null;
  }

  async destroy(): Promise<void> {
    if (this.database) {
      this.database.close();
      this.database = null;
    }

    const persistence = this.options.persistence ?? 'memory';
    const filename = this.options.filename ?? 'vector-frankl.sqlite';

    if (persistence === 'indexeddb') {
      await this.deleteIndexedDatabaseStore(filename);
    } else if (persistence === 'opfs') {
      await this.deleteOpfsFile(filename);
    }
    // For 'memory', closing is sufficient -- there is nothing else to delete.
  }

  // -------------------------------------------------------------------------
  // Single-item CRUD
  // -------------------------------------------------------------------------

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

    const result = database.exec(
      'SELECT id, vector, metadata, magnitude, format, normalized, timestamp, last_accessed, access_count, compression FROM vectors WHERE id = ?',
      [id],
    );

    const row = result[0]?.values[0];
    if (!row) {
      throw new VectorNotFoundError(id);
    }

    database.run(
      'UPDATE vectors SET last_accessed = ?, access_count = access_count + 1 WHERE id = ?',
      [now, id],
    );

    const data = this.rowToVectorData(row);
    data.lastAccessed = now;
    data.accessCount = (data.accessCount ?? 0) + 1;
    return data;
  }

  async exists(id: string): Promise<boolean> {
    const database = this.requireDatabase();
    const result = database.exec('SELECT 1 FROM vectors WHERE id = ? LIMIT 1', [id]);
    return (result[0]?.values.length ?? 0) > 0;
  }

  async delete(id: string): Promise<void> {
    const database = this.requireDatabase();
    database.run('DELETE FROM vectors WHERE id = ?', [id]);
  }

  // -------------------------------------------------------------------------
  // Multi-item reads
  // -------------------------------------------------------------------------

  async getMany(ids: string[]): Promise<VectorData[]> {
    if (ids.length === 0) return [];

    const database = this.requireDatabase();
    const now = Date.now();
    const placeholders = ids.map(() => '?').join(', ');

    const result = database.exec(
      `SELECT id, vector, metadata, magnitude, format, normalized, timestamp, last_accessed, access_count, compression
       FROM vectors WHERE id IN (${placeholders})`,
      ids,
    );

    const rows = result[0]?.values ?? [];
    if (rows.length === 0) {
      throw new BatchOperationError(
        0,
        ids.length,
        ids.map((id) => ({ id, error: new VectorNotFoundError(id) })),
      );
    }

    // Update access tracking for found rows
    const foundIds = rows.map((row) => row[0] as string);
    const updatePlaceholders = foundIds.map(() => '?').join(', ');
    database.run(
      `UPDATE vectors SET last_accessed = ?, access_count = access_count + 1 WHERE id IN (${updatePlaceholders})`,
      [now, ...foundIds],
    );

    return rows.map((row) => {
      const data = this.rowToVectorData(row);
      data.lastAccessed = now;
      data.accessCount = (data.accessCount ?? 0) + 1;
      return data;
    });
  }

  async getAll(): Promise<VectorData[]> {
    const database = this.requireDatabase();
    const result = database.exec(
      'SELECT id, vector, metadata, magnitude, format, normalized, timestamp, last_accessed, access_count, compression FROM vectors',
    );

    const rows = result[0]?.values ?? [];
    return rows.map((row) => this.rowToVectorData(row));
  }

  async count(): Promise<number> {
    const database = this.requireDatabase();
    const result = database.exec('SELECT COUNT(*) FROM vectors');
    return (result[0]?.values[0]?.[0] as number | undefined) ?? 0;
  }

  // -------------------------------------------------------------------------
  // Multi-item writes
  // -------------------------------------------------------------------------

  async deleteMany(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;

    const database = this.requireDatabase();
    const placeholders = ids.map(() => '?').join(', ');

    database.run('BEGIN');
    try {
      database.run(`DELETE FROM vectors WHERE id IN (${placeholders})`, ids);
      const deleted = database.getRowsModified();
      database.run('COMMIT');
      return deleted;
    } catch (error) {
      database.run('ROLLBACK');
      throw error;
    }
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

    database.run('BEGIN');
    try {
      for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
        if (options?.abortSignal?.aborted) {
          database.run('ROLLBACK');
          throw new DOMException('The operation was aborted.', 'AbortError');
        }

        const start = batchIndex * batchSize;
        const end = Math.min(start + batchSize, vectors.length);

        for (let i = start; i < end; i++) {
          const vector = vectors[i]!;
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

      database.run('COMMIT');
    } catch (error) {
      // Only rollback if the transaction is still open (i.e. not already rolled
      // back by an abort above).
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        database.run('ROLLBACK');
      }
      throw error;
    }
  }

  // -------------------------------------------------------------------------
  // Partial updates (read-modify-write)
  // -------------------------------------------------------------------------

  async updateVector(
    id: string,
    vector: Float32Array,
    options?: { updateMagnitude?: boolean; updateTimestamp?: boolean },
  ): Promise<void> {
    const database = this.requireDatabase();

    // Verify existence
    const check = database.exec('SELECT 1 FROM vectors WHERE id = ? LIMIT 1', [id]);
    if ((check[0]?.values.length ?? 0) === 0) {
      throw new VectorNotFoundError(id);
    }

    const magnitude = options?.updateMagnitude !== false ? calculateMagnitude(vector) : undefined;
    const timestamp = options?.updateTimestamp !== false ? Date.now() : undefined;

    let sql = 'UPDATE vectors SET vector = ?';
    const params: unknown[] = [vectorToBlob(vector)];

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

    const result = database.exec(
      'SELECT metadata FROM vectors WHERE id = ?',
      [id],
    );

    const row = result[0]?.values[0];
    if (!row) {
      throw new VectorNotFoundError(id);
    }

    const existingRaw = row[0] as string | null;
    let merged: Record<string, unknown>;

    if (options?.merge !== false && existingRaw) {
      const existing = JSON.parse(existingRaw) as Record<string, unknown>;
      merged = { ...existing, ...metadata };
    } else {
      merged = metadata;
    }

    const timestamp = options?.updateTimestamp !== false ? Date.now() : undefined;
    let sql = 'UPDATE vectors SET metadata = ?';
    const params: unknown[] = [JSON.stringify(merged)];

    if (timestamp !== undefined) {
      sql += ', timestamp = ?';
      params.push(timestamp);
    }

    sql += ' WHERE id = ?';
    params.push(id);

    database.run(sql, params);
  }

  async updateBatch(
    updates: Array<{ id: string; vector?: Float32Array; metadata?: Record<string, unknown> }>,
    _options?: BatchOptions,
  ): Promise<{ succeeded: number; failed: number; errors: Array<{ id: string; error: Error }> }> {
    const database = this.requireDatabase();
    let succeeded = 0;
    let failed = 0;
    const errors: Array<{ id: string; error: Error }> = [];

    database.run('BEGIN');
    try {
      for (const update of updates) {
        try {
          const result = database.exec(
            'SELECT vector, metadata, magnitude FROM vectors WHERE id = ?',
            [update.id],
          );

          const row = result[0]?.values[0];
          if (!row) {
            throw new VectorNotFoundError(update.id);
          }

          const setClauses: string[] = [];
          const params: unknown[] = [];

          if (update.vector) {
            setClauses.push('vector = ?');
            params.push(vectorToBlob(update.vector));
            setClauses.push('magnitude = ?');
            params.push(calculateMagnitude(update.vector));
          }

          if (update.metadata) {
            const existingRaw = row[1] as string | null;
            const existing = existingRaw ? (JSON.parse(existingRaw) as Record<string, unknown>) : {};
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

      database.run('COMMIT');
    } catch (error) {
      database.run('ROLLBACK');
      throw error;
    }

    return { succeeded, failed, errors };
  }

  // -------------------------------------------------------------------------
  // Row mapping
  // -------------------------------------------------------------------------

  private rowToVectorData(row: unknown[]): VectorData {
    // columns: id, vector, metadata, magnitude, format, normalized, timestamp, last_accessed, access_count, compression
    const metadataRaw = row[2] as string | null;
    const compressionRaw = row[9] as string | null;

    const data: VectorData = {
      id: row[0] as string,
      vector: blobToVector(row[1]),
      magnitude: row[3] as number,
      timestamp: row[6] as number,
    };

    if (metadataRaw !== null) {
      data.metadata = JSON.parse(metadataRaw) as Record<string, unknown>;
    }

    const format = row[4] as string | null;
    if (format !== null) {
      data.format = format;
    }

    if ((row[5] as number) === 1) {
      data.normalized = true;
    }

    const lastAccessed = row[7] as number | null;
    if (lastAccessed !== null) {
      data.lastAccessed = lastAccessed;
    }

    const accessCount = row[8] as number | null;
    if (accessCount !== null && accessCount > 0) {
      data.accessCount = accessCount;
    }

    if (compressionRaw !== null) {
      const parsed = JSON.parse(compressionRaw) as NonNullable<VectorData['compression']>;
      data.compression = parsed;
    }

    return data;
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private requireDatabase(): SqlJsDatabase {
    if (!this.database) {
      throw new Error(
        'SQLiteStorageAdapter is not initialized. Call init() before using the adapter.',
      );
    }
    return this.database;
  }

  // -------------------------------------------------------------------------
  // Persistence helpers
  // -------------------------------------------------------------------------

  private async persist(): Promise<void> {
    if (!this.database) return;

    const persistence = this.options.persistence ?? 'memory';
    if (persistence === 'memory') return;

    const data = this.database.export();
    const filename = this.options.filename ?? 'vector-frankl.sqlite';

    if (persistence === 'indexeddb') {
      await this.saveToIndexedDatabase(filename, data);
    } else if (persistence === 'opfs') {
      await this.saveToOpfs(filename, data);
    }
  }

  private async loadPersistedData(): Promise<Uint8Array | null> {
    const persistence = this.options.persistence ?? 'memory';
    const filename = this.options.filename ?? 'vector-frankl.sqlite';

    if (persistence === 'indexeddb') {
      return this.loadFromIndexedDatabase(filename);
    }

    if (persistence === 'opfs') {
      return this.loadFromOpfs(filename);
    }

    return null;
  }

  // -- IndexedDB persistence ------------------------------------------------

  private readonly INDEXED_DATABASE_NAME = 'vector-frankl-sqlite';
  private readonly INDEXED_DATABASE_STORE = 'databases';

  private openIndexedDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.INDEXED_DATABASE_NAME, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(this.INDEXED_DATABASE_STORE)) {
          database.createObjectStore(this.INDEXED_DATABASE_STORE);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  private async saveToIndexedDatabase(filename: string, data: Uint8Array): Promise<void> {
    const database = await this.openIndexedDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(this.INDEXED_DATABASE_STORE, 'readwrite');
      const store = transaction.objectStore(this.INDEXED_DATABASE_STORE);
      const request = store.put(data, filename);
      request.onsuccess = () => {
        database.close();
        resolve();
      };
      request.onerror = () => {
        database.close();
        reject(request.error);
      };
    });
  }

  private async loadFromIndexedDatabase(filename: string): Promise<Uint8Array | null> {
    try {
      const database = await this.openIndexedDatabase();
      return new Promise((resolve, reject) => {
        const transaction = database.transaction(this.INDEXED_DATABASE_STORE, 'readonly');
        const store = transaction.objectStore(this.INDEXED_DATABASE_STORE);
        const request = store.get(filename);
        request.onsuccess = () => {
          database.close();
          const result = request.result as Uint8Array | undefined;
          resolve(result ?? null);
        };
        request.onerror = () => {
          database.close();
          reject(request.error);
        };
      });
    } catch {
      return null;
    }
  }

  private async deleteIndexedDatabaseStore(filename: string): Promise<void> {
    try {
      const database = await this.openIndexedDatabase();
      return new Promise((resolve, reject) => {
        const transaction = database.transaction(this.INDEXED_DATABASE_STORE, 'readwrite');
        const store = transaction.objectStore(this.INDEXED_DATABASE_STORE);
        const request = store.delete(filename);
        request.onsuccess = () => {
          database.close();
          resolve();
        };
        request.onerror = () => {
          database.close();
          reject(request.error);
        };
      });
    } catch {
      // Store may not exist yet -- nothing to delete.
    }
  }

  // -- OPFS persistence -----------------------------------------------------

  private async saveToOpfs(filename: string, data: Uint8Array): Promise<void> {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle(filename, { create: true });
    const writable = await handle.createWritable();
    await writable.write(data);
    await writable.close();
  }

  private async loadFromOpfs(filename: string): Promise<Uint8Array | null> {
    try {
      const root = await navigator.storage.getDirectory();
      const handle = await root.getFileHandle(filename);
      const file = await handle.getFile();
      const buffer = await file.arrayBuffer();
      return new Uint8Array(buffer);
    } catch {
      return null;
    }
  }

  private async deleteOpfsFile(filename: string): Promise<void> {
    try {
      const root = await navigator.storage.getDirectory();
      await root.removeEntry(filename);
    } catch {
      // File may not exist -- nothing to delete.
    }
  }
}
