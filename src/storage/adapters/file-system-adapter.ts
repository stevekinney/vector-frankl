import { mkdir, readdir, rm, stat } from 'node:fs/promises';

import { VectorNotFoundError } from '@/core/errors.js';
import type {
  BatchOptions,
  BatchProgress,
  StorageAdapter,
  VectorData,
} from '@/core/types.js';
import {
  binaryToVectorData,
  calculateMagnitude,
  jsonToVectorData,
  vectorDataToBinary,
  vectorDataToJson,
} from './serialization.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

interface FileSystemStorageAdapterOptions {
  directory: string;
  format?: 'binary' | 'json';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Characters that are unsafe for most file systems. */
// eslint-disable-next-line no-control-regex
const UNSAFE_FILENAME_CHARACTERS = /[%/\\:*?"<>|\x00-\x1F\x7F]/g;

/** Percent-encode characters that are unsafe in filenames. */
function encodeVectorId(id: string): string {
  return id.replace(UNSAFE_FILENAME_CHARACTERS, (character) => {
    return `%${character.charCodeAt(0).toString(16).padStart(2, '0').toUpperCase()}`;
  });
}

// ---------------------------------------------------------------------------
// FileSystemStorageAdapter
// ---------------------------------------------------------------------------

export class FileSystemStorageAdapter implements StorageAdapter {
  private readonly directory: string;
  private readonly vectorsDirectory: string;
  private readonly format: 'binary' | 'json';

  constructor(options: FileSystemStorageAdapterOptions) {
    if (typeof Bun === 'undefined') {
      throw new Error('FileSystemStorageAdapter requires the Bun runtime');
    }

    this.directory = options.directory;
    this.vectorsDirectory = `${options.directory}/vectors`;
    this.format = options.format ?? 'json';
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────

  async init(): Promise<void> {
    await mkdir(this.vectorsDirectory, { recursive: true });
  }

  async close(): Promise<void> {
    // No-op — nothing to tear down for file-system storage.
  }

  async destroy(): Promise<void> {
    await rm(this.directory, { recursive: true, force: true });
  }

  // ── Single-item CRUD ────────────────────────────────────────────────────

  async put(vector: VectorData): Promise<void> {
    const data: VectorData = {
      ...vector,
      timestamp: vector.timestamp || Date.now(),
      lastAccessed: Date.now(),
    };
    await this.writeVector(data);
  }

  async get(id: string): Promise<VectorData> {
    const filePath = this.vectorFilePath(id);
    const file = Bun.file(filePath);

    if (!(await file.exists())) {
      throw new VectorNotFoundError(id);
    }

    const data = await this.readVectorFile(file);

    // Update access tracking
    data.lastAccessed = Date.now();
    data.accessCount = (data.accessCount ?? 0) + 1;
    await this.writeVector(data);

    return data;
  }

  async exists(id: string): Promise<boolean> {
    return Bun.file(this.vectorFilePath(id)).exists();
  }

  async delete(id: string): Promise<void> {
    const filePath = this.vectorFilePath(id);
    try {
      await rm(filePath);
    } catch {
      // Silently ignore if the file doesn't exist.
    }
  }

  // ── Multi-item reads ────────────────────────────────────────────────────

  async getMany(ids: string[]): Promise<VectorData[]> {
    const results: VectorData[] = [];
    const now = Date.now();

    for (const id of ids) {
      const file = Bun.file(this.vectorFilePath(id));
      if (await file.exists()) {
        const data = await this.readVectorFile(file);
        data.lastAccessed = now;
        data.accessCount = (data.accessCount ?? 0) + 1;
        await this.writeVector(data);
        results.push(data);
      }
    }

    return results;
  }

  async getAll(): Promise<VectorData[]> {
    let entries: string[];
    try {
      entries = await readdir(this.vectorsDirectory);
    } catch {
      return [];
    }

    const results: VectorData[] = [];

    for (const entry of entries) {
      if (!entry.endsWith('.vec')) continue;
      const file = Bun.file(`${this.vectorsDirectory}/${entry}`);
      const data = await this.readVectorFile(file);
      results.push(data);
    }

    return results;
  }

  async count(): Promise<number> {
    let entries: string[];
    try {
      entries = await readdir(this.vectorsDirectory);
    } catch {
      return 0;
    }

    return entries.filter((entry) => entry.endsWith('.vec')).length;
  }

  // ── Multi-item writes ───────────────────────────────────────────────────

  async deleteMany(ids: string[]): Promise<number> {
    let deleted = 0;

    for (const id of ids) {
      const filePath = this.vectorFilePath(id);
      try {
        await stat(filePath);
        await rm(filePath);
        deleted++;
      } catch {
        // File did not exist — skip.
      }
    }

    return deleted;
  }

  async clear(): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(this.vectorsDirectory);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.endsWith('.vec')) {
        await rm(`${this.vectorsDirectory}/${entry}`, { force: true });
      }
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
    const existing = await this.readExisting(id);

    existing.vector = vector;

    if (options?.updateMagnitude !== false) {
      existing.magnitude = calculateMagnitude(vector);
    }

    if (options?.updateTimestamp !== false) {
      existing.timestamp = Date.now();
    }

    await this.writeVector(existing);
  }

  async updateMetadata(
    id: string,
    metadata: Record<string, unknown>,
    options?: { merge?: boolean; updateTimestamp?: boolean },
  ): Promise<void> {
    const existing = await this.readExisting(id);

    if (options?.merge !== false && existing.metadata) {
      existing.metadata = { ...existing.metadata, ...metadata };
    } else {
      existing.metadata = metadata;
    }

    if (options?.updateTimestamp !== false) {
      existing.timestamp = Date.now();
    }

    await this.writeVector(existing);
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
        const existing = await this.readExisting(update.id);

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
        await this.writeVector(existing);
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

  /** Read a vector from disk without updating access tracking. */
  private async readExisting(id: string): Promise<VectorData> {
    const filePath = this.vectorFilePath(id);
    const file = Bun.file(filePath);

    if (!(await file.exists())) {
      throw new VectorNotFoundError(id);
    }

    return this.readVectorFile(file);
  }

  private vectorFilePath(id: string): string {
    return `${this.vectorsDirectory}/${encodeVectorId(id)}.vec`;
  }

  private async writeVector(data: VectorData): Promise<void> {
    const filePath = this.vectorFilePath(data.id);

    if (this.format === 'binary') {
      await Bun.write(filePath, vectorDataToBinary(data));
    } else {
      await Bun.write(filePath, vectorDataToJson(data));
    }
  }

  private async readVectorFile(file: ReturnType<typeof Bun.file>): Promise<VectorData> {
    if (this.format === 'binary') {
      const buffer = await file.arrayBuffer();
      return binaryToVectorData(buffer);
    }

    const text = await file.text();
    return jsonToVectorData(text);
  }
}
