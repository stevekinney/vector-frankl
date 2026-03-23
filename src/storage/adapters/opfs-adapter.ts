import { BrowserSupportError, VectorNotFoundError } from '@/core/errors.js';
import type {
  BatchOptions,
  BatchProgress,
  StorageAdapter,
  VectorData,
} from '@/core/types.js';
import { calculateMagnitude } from './serialization.js';

// OPFS types declared inline since they may not be in the TypeScript lib.

interface FileSystemDirectoryHandle {
  getDirectoryHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<FileSystemDirectoryHandle>;
  getFileHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<FileSystemFileHandle>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
  values(): AsyncIterableIterator<FileSystemHandle>;
}

interface FileSystemFileHandle {
  getFile(): Promise<File>;
  createWritable(): Promise<FileSystemWritableFileStream>;
}

interface FileSystemWritableFileStream extends WritableStream {
  write(data: BufferSource | Blob | string): Promise<void>;
  close(): Promise<void>;
}

interface FileSystemHandle {
  kind: 'file' | 'directory';
  name: string;
}

// Configuration

interface OPFSStorageAdapterOptions {
  directory: string;
  format?: 'binary' | 'json';
}

// Serialization helpers

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

function vectorDataToSerializable(data: VectorData): SerializedVectorData {
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

  return serialized;
}

function serializableToVectorData(serialized: SerializedVectorData): VectorData {
  const data: VectorData = {
    id: serialized.id,
    vector: new Float32Array(serialized.vector),
    magnitude: serialized.magnitude,
    timestamp: serialized.timestamp,
  };

  if (serialized.metadata !== undefined) {
    data.metadata = serialized.metadata;
  }
  if (serialized.format !== undefined) {
    data.format = serialized.format;
  }
  if (serialized.normalized !== undefined) {
    data.normalized = serialized.normalized;
  }
  if (serialized.lastAccessed !== undefined) {
    data.lastAccessed = serialized.lastAccessed;
  }
  if (serialized.accessCount !== undefined) {
    data.accessCount = serialized.accessCount;
  }
  if (serialized.compression !== undefined) {
    data.compression = serialized.compression;
  }

  return data;
}

// Binary format helpers
// Layout: [4-byte uint32 vector length][Float32Array bytes][UTF-8 JSON for remaining fields]

/**
 * The fields stored in the JSON portion of the binary format (everything except the vector).
 */
interface BinaryRemainingFields {
  id: string;
  magnitude: number;
  timestamp: number;
  metadata?: Record<string, unknown>;
  format?: string;
  normalized?: boolean;
  lastAccessed?: number;
  accessCount?: number;
  compression?: VectorData['compression'];
}

function buildBinaryRemainingFields(data: VectorData): BinaryRemainingFields {
  const fields: BinaryRemainingFields = {
    id: data.id,
    magnitude: data.magnitude,
    timestamp: data.timestamp,
  };

  if (data.metadata !== undefined) {
    fields.metadata = data.metadata;
  }
  if (data.format !== undefined) {
    fields.format = data.format;
  }
  if (data.normalized !== undefined) {
    fields.normalized = data.normalized;
  }
  if (data.lastAccessed !== undefined) {
    fields.lastAccessed = data.lastAccessed;
  }
  if (data.accessCount !== undefined) {
    fields.accessCount = data.accessCount;
  }
  if (data.compression !== undefined) {
    fields.compression = data.compression;
  }

  return fields;
}

function vectorDataToBinary(data: VectorData): ArrayBuffer {
  const remaining = buildBinaryRemainingFields(data);

  const jsonBytes = new TextEncoder().encode(JSON.stringify(remaining));
  const vectorLength = data.vector.length;
  const vectorBytes = vectorLength * 4; // Float32 = 4 bytes each

  // 4 bytes for length prefix + vector bytes + JSON bytes
  const totalSize = 4 + vectorBytes + jsonBytes.byteLength;
  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);

  // Write vector length as uint32
  view.setUint32(0, vectorLength, true);

  // Write Float32Array bytes
  const float32View = new Float32Array(buffer, 4, vectorLength);
  float32View.set(data.vector);

  // Write JSON bytes after the vector
  const jsonOffset = 4 + vectorBytes;
  const uint8View = new Uint8Array(buffer, jsonOffset);
  uint8View.set(jsonBytes);

  return buffer;
}

function binaryFieldsToVectorData(
  remaining: BinaryRemainingFields,
  vector: Float32Array,
): VectorData {
  const data: VectorData = {
    id: remaining.id,
    vector,
    magnitude: remaining.magnitude,
    timestamp: remaining.timestamp,
  };

  if (remaining.metadata !== undefined) {
    data.metadata = remaining.metadata;
  }
  if (remaining.format !== undefined) {
    data.format = remaining.format;
  }
  if (remaining.normalized !== undefined) {
    data.normalized = remaining.normalized;
  }
  if (remaining.lastAccessed !== undefined) {
    data.lastAccessed = remaining.lastAccessed;
  }
  if (remaining.accessCount !== undefined) {
    data.accessCount = remaining.accessCount;
  }
  if (remaining.compression !== undefined) {
    data.compression = remaining.compression;
  }

  return data;
}

function binaryToVectorData(buffer: ArrayBuffer): VectorData {
  const view = new DataView(buffer);

  // Read vector length
  const vectorLength = view.getUint32(0, true);
  const vectorBytes = vectorLength * 4;

  // Read Float32Array
  const vector = new Float32Array(buffer.slice(4, 4 + vectorBytes));

  // Read JSON for remaining fields
  const jsonOffset = 4 + vectorBytes;
  const jsonBytes = new Uint8Array(buffer, jsonOffset);
  const jsonString = new TextDecoder().decode(jsonBytes);
  const remaining = JSON.parse(jsonString) as BinaryRemainingFields;

  return binaryFieldsToVectorData(remaining, vector);
}

// ID sanitization: percent-encode filesystem-unsafe characters.

// eslint-disable-next-line no-control-regex -- Control characters are intentionally matched for filesystem safety.
const UNSAFE_FILENAME_PATTERN = /[<>:"/\\|?*\x00-\x1F%]/g;

function sanitizeId(id: string): string {
  return id.replace(UNSAFE_FILENAME_PATTERN, (character) => {
    return '%' + character.charCodeAt(0).toString(16).padStart(2, '0');
  });
}

function idToFilename(id: string): string {
  return sanitizeId(id) + '.vec';
}

// Magnitude calculation is imported from shared serialization utilities.

export class OPFSStorageAdapter implements StorageAdapter {
  private readonly directory: string;
  private readonly format: 'binary' | 'json';
  private rootHandle: FileSystemDirectoryHandle | undefined;
  private vectorsHandle: FileSystemDirectoryHandle | undefined;

  constructor(options: OPFSStorageAdapterOptions) {
    this.directory = options.directory;
    this.format = options.format ?? 'json';
  }

  // Lifecycle

  async init(): Promise<void> {
    if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) {
      throw new BrowserSupportError('Origin Private File System');
    }

    const opfsRoot =
      (await navigator.storage.getDirectory()) as unknown as FileSystemDirectoryHandle;
    this.rootHandle = await opfsRoot.getDirectoryHandle(this.directory, { create: true });
    this.vectorsHandle = await this.rootHandle.getDirectoryHandle('vectors', {
      create: true,
    });
  }

  async close(): Promise<void> {
    // No-op: OPFS does not require explicit cleanup.
  }

  async destroy(): Promise<void> {
    const opfsRoot =
      (await navigator.storage.getDirectory()) as unknown as FileSystemDirectoryHandle;
    await opfsRoot.removeEntry(this.directory, { recursive: true });
    this.rootHandle = undefined;
    this.vectorsHandle = undefined;
  }

  // Single-item CRUD

  async put(vector: VectorData): Promise<void> {
    const directory = this.requireVectorsHandle();
    const filename = idToFilename(vector.id);

    const stored: VectorData = {
      ...vector,
      timestamp: vector.timestamp || Date.now(),
      lastAccessed: Date.now(),
    };

    await this.writeVectorFile(directory, filename, stored);
  }

  async get(id: string): Promise<VectorData> {
    const directory = this.requireVectorsHandle();
    const filename = idToFilename(id);

    let fileHandle: FileSystemFileHandle;
    try {
      fileHandle = await directory.getFileHandle(filename);
    } catch (error: unknown) {
      if (isNotFoundError(error)) {
        throw new VectorNotFoundError(id);
      }
      throw error;
    }

    const data = await this.readVectorFromHandle(fileHandle);

    // Update access tracking
    data.lastAccessed = Date.now();
    data.accessCount = (data.accessCount ?? 0) + 1;
    await this.writeVectorFile(directory, filename, data);

    return data;
  }

  async exists(id: string): Promise<boolean> {
    const directory = this.requireVectorsHandle();
    const filename = idToFilename(id);

    try {
      await directory.getFileHandle(filename);
      return true;
    } catch (error: unknown) {
      if (isNotFoundError(error)) {
        return false;
      }
      throw error;
    }
  }

  async delete(id: string): Promise<void> {
    const directory = this.requireVectorsHandle();
    const filename = idToFilename(id);

    try {
      await directory.removeEntry(filename);
    } catch (error: unknown) {
      if (!isNotFoundError(error)) {
        throw error;
      }
      // Silently ignore if not found (idempotent delete)
    }
  }

  // Multi-item reads

  async getMany(ids: string[]): Promise<VectorData[]> {
    const directory = this.requireVectorsHandle();
    const results: VectorData[] = [];
    const errors: Array<{ id: string; error: Error }> = [];
    const now = Date.now();

    for (const id of ids) {
      const filename = idToFilename(id);
      try {
        const fileHandle = await directory.getFileHandle(filename);
        const data = await this.readVectorFromHandle(fileHandle);

        data.lastAccessed = now;
        data.accessCount = (data.accessCount ?? 0) + 1;
        await this.writeVectorFile(directory, filename, data);

        results.push(data);
      } catch (error: unknown) {
        if (isNotFoundError(error)) {
          errors.push({ id, error: new VectorNotFoundError(id) });
        } else {
          errors.push({
            id,
            error: error instanceof Error ? error : new Error(String(error)),
          });
        }
      }
    }

    // Return whatever was found (possibly empty). Other adapters return []
    // when no requested IDs exist, so we follow the same convention.
    return results;
  }

  async getAll(): Promise<VectorData[]> {
    const directory = this.requireVectorsHandle();
    const results: VectorData[] = [];

    for await (const entry of directory.values()) {
      if (entry.kind === 'file' && entry.name.endsWith('.vec')) {
        const fileHandle = await directory.getFileHandle(entry.name);
        const data = await this.readVectorFromHandle(fileHandle);
        results.push(data);
      }
    }

    return results;
  }

  async count(): Promise<number> {
    const directory = this.requireVectorsHandle();
    let total = 0;

    for await (const entry of directory.values()) {
      if (entry.kind === 'file' && entry.name.endsWith('.vec')) {
        total++;
      }
    }

    return total;
  }

  // Multi-item writes

  async deleteMany(ids: string[]): Promise<number> {
    const directory = this.requireVectorsHandle();
    let deleted = 0;

    for (const id of ids) {
      const filename = idToFilename(id);
      try {
        await directory.removeEntry(filename);
        deleted++;
      } catch (error: unknown) {
        if (!isNotFoundError(error)) {
          throw error;
        }
      }
    }

    return deleted;
  }

  async clear(): Promise<void> {
    const directory = this.requireVectorsHandle();
    const filenames: string[] = [];

    for await (const entry of directory.values()) {
      if (entry.kind === 'file' && entry.name.endsWith('.vec')) {
        filenames.push(entry.name);
      }
    }

    for (const filename of filenames) {
      await directory.removeEntry(filename);
    }
  }

  async putBatch(vectors: VectorData[], options?: BatchOptions): Promise<void> {
    const directory = this.requireVectorsHandle();
    const batchSize = options?.batchSize ?? vectors.length;
    const totalBatches = Math.ceil(vectors.length / batchSize);

    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      if (options?.abortSignal?.aborted) {
        throw new DOMException('The operation was aborted.', 'AbortError');
      }

      const start = batchIndex * batchSize;
      const end = Math.min(start + batchSize, vectors.length);

      for (let i = start; i < end; i++) {
        if (options?.abortSignal?.aborted) {
          throw new DOMException('The operation was aborted.', 'AbortError');
        }

        const vector = vectors[i]!;
        const filename = idToFilename(vector.id);

        const stored: VectorData = {
          ...vector,
          timestamp: vector.timestamp || Date.now(),
          lastAccessed: Date.now(),
        };

        await this.writeVectorFile(directory, filename, stored);
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
    const directory = this.requireVectorsHandle();
    const filename = idToFilename(id);

    let fileHandle: FileSystemFileHandle;
    try {
      fileHandle = await directory.getFileHandle(filename);
    } catch (error: unknown) {
      if (isNotFoundError(error)) {
        throw new VectorNotFoundError(id);
      }
      throw error;
    }

    const data = await this.readVectorFromHandle(fileHandle);

    data.vector = vector;

    if (options?.updateMagnitude !== false) {
      data.magnitude = calculateMagnitude(vector);
    }

    if (options?.updateTimestamp !== false) {
      data.timestamp = Date.now();
    }

    await this.writeVectorFile(directory, filename, data);
  }

  async updateMetadata(
    id: string,
    metadata: Record<string, unknown>,
    options?: { merge?: boolean; updateTimestamp?: boolean },
  ): Promise<void> {
    const directory = this.requireVectorsHandle();
    const filename = idToFilename(id);

    let fileHandle: FileSystemFileHandle;
    try {
      fileHandle = await directory.getFileHandle(filename);
    } catch (error: unknown) {
      if (isNotFoundError(error)) {
        throw new VectorNotFoundError(id);
      }
      throw error;
    }

    const data = await this.readVectorFromHandle(fileHandle);

    if (options?.merge !== false && data.metadata) {
      data.metadata = { ...data.metadata, ...metadata };
    } else {
      data.metadata = metadata;
    }

    if (options?.updateTimestamp !== false) {
      data.timestamp = Date.now();
    }

    await this.writeVectorFile(directory, filename, data);
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
    const directory = this.requireVectorsHandle();
    let succeeded = 0;
    let failed = 0;
    const errors: Array<{ id: string; error: Error }> = [];
    const batchSize = options?.batchSize ?? updates.length;
    const totalBatches = Math.ceil(updates.length / batchSize);

    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      if (options?.abortSignal?.aborted) {
        break;
      }

      const start = batchIndex * batchSize;
      const end = Math.min(start + batchSize, updates.length);

      for (let i = start; i < end; i++) {
        const update = updates[i]!;

        try {
          const filename = idToFilename(update.id);
          let fileHandle: FileSystemFileHandle;

          try {
            fileHandle = await directory.getFileHandle(filename);
          } catch (error: unknown) {
            if (isNotFoundError(error)) {
              throw new VectorNotFoundError(update.id);
            }
            throw error;
          }

          const data = await this.readVectorFromHandle(fileHandle);

          if (update.vector) {
            data.vector = update.vector;
            data.magnitude = calculateMagnitude(update.vector);
          }

          if (update.metadata) {
            data.metadata = data.metadata
              ? { ...data.metadata, ...update.metadata }
              : update.metadata;
          }

          data.timestamp = Date.now();

          await this.writeVectorFile(directory, filename, data);
          succeeded++;
        } catch (error) {
          failed++;
          errors.push({
            id: update.id,
            error: error instanceof Error ? error : new Error(String(error)),
          });
        }
      }

      if (options?.onProgress) {
        const progress: BatchProgress = {
          total: updates.length,
          completed: start + (end - start),
          failed,
          percentage: Math.round((end / updates.length) * 100),
          currentBatch: batchIndex + 1,
          totalBatches,
        };
        options.onProgress(progress);
      }
    }

    return { succeeded, failed, errors };
  }

  // Private helpers

  private requireVectorsHandle(): FileSystemDirectoryHandle {
    if (!this.vectorsHandle) {
      throw new Error('OPFSStorageAdapter has not been initialized. Call init() first.');
    }
    return this.vectorsHandle;
  }

  private async writeVectorFile(
    directory: FileSystemDirectoryHandle,
    filename: string,
    data: VectorData,
  ): Promise<void> {
    const fileHandle = await directory.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();

    try {
      if (this.format === 'binary') {
        const buffer = vectorDataToBinary(data);
        await writable.write(buffer);
      } else {
        const serialized = vectorDataToSerializable(data);
        await writable.write(JSON.stringify(serialized));
      }
    } finally {
      await writable.close();
    }
  }

  private async readVectorFromHandle(
    fileHandle: FileSystemFileHandle,
  ): Promise<VectorData> {
    const file = await fileHandle.getFile();

    if (this.format === 'binary') {
      const buffer = await file.arrayBuffer();
      return binaryToVectorData(buffer);
    } else {
      const text = await file.text();
      const serialized = JSON.parse(text) as SerializedVectorData;
      return serializableToVectorData(serialized);
    }
  }
}

// Error detection helpers

function isNotFoundError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'NotFoundError') {
    return true;
  }
  // Some environments use TypeError for missing entries
  if (error instanceof TypeError && /not found/i.test(error.message)) {
    return true;
  }
  return false;
}
