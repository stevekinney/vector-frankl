import { mkdir, readdir, rm, stat } from 'node:fs/promises';

import { VectorNotFoundError } from '@/core/errors.js';
import type { BatchOptions, BatchProgress, StorageAdapter, VectorData } from '@/core/types.js';

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
const UNSAFE_FILENAME_CHARACTERS = /[/\\:*?"<>|]/g;

/** Percent-encode characters that are unsafe in filenames. */
function encodeVectorId(id: string): string {
  return id.replace(UNSAFE_FILENAME_CHARACTERS, (character) => {
    return `%${character.charCodeAt(0).toString(16).padStart(2, '0').toUpperCase()}`;
  });
}

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
// Serialization — Binary format
//
// Layout: [4-byte uint32 vector length][Float32Array bytes][UTF-8 JSON for
// remaining fields]
// ---------------------------------------------------------------------------

function vectorDataToBinary(data: VectorData): Uint8Array {
  const vectorLength = data.vector.length;
  const vectorBytes = new Uint8Array(data.vector.buffer, data.vector.byteOffset, data.vector.byteLength);

  // Build the JSON payload for everything except the vector itself.
  const fields: Record<string, unknown> = {
    id: data.id,
    magnitude: data.magnitude,
    timestamp: data.timestamp,
  };

  if (data.metadata !== undefined) fields['metadata'] = data.metadata;
  if (data.format !== undefined) fields['format'] = data.format;
  if (data.normalized !== undefined) fields['normalized'] = data.normalized;
  if (data.lastAccessed !== undefined) fields['lastAccessed'] = data.lastAccessed;
  if (data.accessCount !== undefined) fields['accessCount'] = data.accessCount;
  if (data.compression !== undefined) fields['compression'] = data.compression;

  const jsonBytes = new TextEncoder().encode(JSON.stringify(fields));

  // 4 bytes (uint32 vector length) + vector data + JSON tail
  const buffer = new Uint8Array(4 + vectorBytes.byteLength + jsonBytes.byteLength);
  const view = new DataView(buffer.buffer);
  view.setUint32(0, vectorLength, true); // little-endian
  buffer.set(vectorBytes, 4);
  buffer.set(jsonBytes, 4 + vectorBytes.byteLength);

  return buffer;
}

function binaryToVectorData(arrayBuffer: ArrayBuffer): VectorData {
  const view = new DataView(arrayBuffer);
  const vectorLength = view.getUint32(0, true);
  const vectorByteLength = vectorLength * Float32Array.BYTES_PER_ELEMENT;

  const vector = new Float32Array(arrayBuffer.slice(4, 4 + vectorByteLength));

  const jsonBytes = new Uint8Array(arrayBuffer, 4 + vectorByteLength);
  const fields = JSON.parse(new TextDecoder().decode(jsonBytes)) as Record<string, unknown>;

  const result: VectorData = {
    id: fields['id'] as string,
    vector,
    magnitude: fields['magnitude'] as number,
    timestamp: fields['timestamp'] as number,
  };

  if (fields['metadata'] !== undefined) result.metadata = fields['metadata'] as Record<string, unknown>;
  if (fields['format'] !== undefined) result.format = fields['format'] as string;
  if (fields['normalized'] !== undefined) result.normalized = fields['normalized'] as boolean;
  if (fields['lastAccessed'] !== undefined) result.lastAccessed = fields['lastAccessed'] as number;
  if (fields['accessCount'] !== undefined) result.accessCount = fields['accessCount'] as number;
  if (fields['compression'] !== undefined) {
    result.compression = fields['compression'] as NonNullable<VectorData['compression']>;
  }

  return result;
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
    const existing = await this.get(id);

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
    const existing = await this.get(id);

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
    updates: Array<{ id: string; vector?: Float32Array; metadata?: Record<string, unknown> }>,
    _options?: BatchOptions,
  ): Promise<{ succeeded: number; failed: number; errors: Array<{ id: string; error: Error }> }> {
    let succeeded = 0;
    let failed = 0;
    const errors: Array<{ id: string; error: Error }> = [];

    for (const update of updates) {
      try {
        const existing = await this.get(update.id);

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
