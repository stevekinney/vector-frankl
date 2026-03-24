import type { VectorData } from '@/core/types.js';

// ---------------------------------------------------------------------------
// Shared serialization utilities used by multiple storage adapters
// ---------------------------------------------------------------------------

/**
 * Intermediate JSON-safe representation of a VectorData record.
 * Float32Array is stored as a plain number array for JSON.stringify().
 */
export interface SerializedVectorData {
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

/** Calculate the magnitude (L2 norm) of a vector. */
export function calculateMagnitude(vector: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < vector.length; i++) {
    sum += vector[i]! * vector[i]!;
  }
  return Math.sqrt(sum);
}

// ---------------------------------------------------------------------------
// JSON serialization
// ---------------------------------------------------------------------------

/** Convert a VectorData record to a JSON-safe SerializedVectorData object. */
export function vectorDataToSerializable(data: VectorData): SerializedVectorData {
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

/** Convert a SerializedVectorData object back to a VectorData record. */
export function serializableToVectorData(serialized: SerializedVectorData): VectorData {
  const result: VectorData = {
    id: serialized.id,
    vector: new Float32Array(serialized.vector),
    magnitude: serialized.magnitude,
    timestamp: serialized.timestamp,
  };

  if (serialized.metadata !== undefined) {
    result.metadata = serialized.metadata;
  }
  if (serialized.format !== undefined) {
    result.format = serialized.format;
  }
  if (serialized.normalized !== undefined) {
    result.normalized = serialized.normalized;
  }
  if (serialized.lastAccessed !== undefined) {
    result.lastAccessed = serialized.lastAccessed;
  }
  if (serialized.accessCount !== undefined) {
    result.accessCount = serialized.accessCount;
  }
  if (serialized.compression !== undefined) {
    result.compression = serialized.compression;
  }

  return result;
}

/** Serialize a VectorData record to a JSON string. */
export function vectorDataToJson(data: VectorData): string {
  return JSON.stringify(vectorDataToSerializable(data));
}

/** Deserialize a JSON string into a VectorData record. */
export function jsonToVectorData(json: string): VectorData {
  const parsed = JSON.parse(json) as SerializedVectorData;
  return serializableToVectorData(parsed);
}

// ---------------------------------------------------------------------------
// Binary serialization
//
// Wire format: [4-byte uint32 vector length (little-endian)]
//              [Float32Array bytes]
//              [UTF-8 JSON for remaining fields]
// ---------------------------------------------------------------------------

/** Fields stored in the JSON tail of the binary format (everything except the raw vector). */
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

/** Serialize a VectorData record to a binary ArrayBuffer. */
export function vectorDataToBinary(data: VectorData): ArrayBuffer {
  const remaining = buildBinaryRemainingFields(data);

  const jsonBytes = new TextEncoder().encode(JSON.stringify(remaining));
  const vectorLength = data.vector.length;
  const vectorByteLength = vectorLength * Float32Array.BYTES_PER_ELEMENT;

  const totalSize = 4 + vectorByteLength + jsonBytes.byteLength;
  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);

  // Write vector length as little-endian uint32.
  view.setUint32(0, vectorLength, true);

  // Write Float32Array bytes.
  const float32View = new Float32Array(buffer, 4, vectorLength);
  float32View.set(data.vector);

  // Write JSON bytes after the vector.
  new Uint8Array(buffer, 4 + vectorByteLength).set(jsonBytes);

  return buffer;
}

/** Deserialize a binary ArrayBuffer into a VectorData record. */
export function binaryToVectorData(buffer: ArrayBuffer): VectorData {
  const view = new DataView(buffer);
  const vectorLength = view.getUint32(0, true);
  const vectorByteLength = vectorLength * Float32Array.BYTES_PER_ELEMENT;

  const vector = new Float32Array(buffer.slice(4, 4 + vectorByteLength));

  const jsonBytes = new Uint8Array(buffer, 4 + vectorByteLength);
  const remaining = JSON.parse(
    new TextDecoder().decode(jsonBytes),
  ) as BinaryRemainingFields;

  return binaryFieldsToVectorData(remaining, vector);
}
