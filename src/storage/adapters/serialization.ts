import { StorageCorruptionError, StorageFormatError } from '@/core/errors.js';
import type { VectorData } from '@/core/types.js';

// ---------------------------------------------------------------------------
// Shared serialization utilities used by multiple storage adapters
// ---------------------------------------------------------------------------

/** Maximum allowed binary/JSON payload size in bytes (prevents memory exhaustion during deserialization). */
const MAX_BINARY_PAYLOAD_BYTES = 512 * 1024 * 1024; // 512 MB

/** Maximum allowed vector dimension encoded in a serialized header (prevents huge allocations from crafted input). */
const MAX_VECTOR_DIMENSION = 100_000;

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

/** Maximum allowed JSON payload size in bytes (prevents memory exhaustion during deserialization). */
const MAX_JSON_PAYLOAD_BYTES = 512 * 1024 * 1024; // 512 MB

/** Serialize a VectorData record to a JSON string. */
export function vectorDataToJson(data: VectorData): string {
  return JSON.stringify(vectorDataToSerializable(data));
}

/** Deserialize a JSON string into a VectorData record. */
export function jsonToVectorData(json: string): VectorData {
  if (json.length > MAX_JSON_PAYLOAD_BYTES) {
    throw new Error(
      `Serialized JSON payload of ${json.length} bytes exceeds the maximum allowed size of ${MAX_JSON_PAYLOAD_BYTES} bytes`,
    );
  }
  const parsed = JSON.parse(json) as SerializedVectorData;
  return serializableToVectorData(parsed);
}

// ---------------------------------------------------------------------------
// Versioned binary serialization
//
// Wire format (version 1):
//
//   Offset  Size  Field
//   ------  ----  -----
//   0       4     Magic marker: 0x56454346 ("VECF" in ASCII, little-endian)
//   4       1     Format version (currently 1)
//   5       3     Reserved / padding (zeros)
//   8       4     Vector length in elements (uint32 LE)
//   12      4     Metadata JSON byte length (uint32 LE)
//   16      4     CRC-32 checksum over entire buffer (checksum field zeroed)
//   20      N     Float32Array bytes (N = vectorLength × 4, 4-byte aligned)
//   20+N    M     UTF-8 JSON for all fields except the raw vector
//
// The checksum covers the entire buffer with the checksum field set to 0,
// so readers can recompute by zeroing bytes [16..20) and calling crc32().
// The header is 20 bytes, a multiple of 4, so the Float32Array at offset 20
// is always correctly aligned.
// ---------------------------------------------------------------------------

/** Magic bytes that identify a versioned VECF binary payload. */
export const BINARY_MAGIC = 0x56454346; // "VECF"

/** Currently supported binary format versions.  Add future versions here. */
export const SUPPORTED_BINARY_VERSIONS = [1] as const;
export type BinaryFormatVersion = (typeof SUPPORTED_BINARY_VERSIONS)[number];

/** Byte offsets for fixed-header fields. */
const OFFSET_MAGIC = 0;
const OFFSET_VERSION = 4;
// bytes 5-7: reserved padding
const OFFSET_VECTOR_LENGTH = 8;
const OFFSET_META_LENGTH = 12;
const OFFSET_CHECKSUM = 16;
const HEADER_SIZE = 20; // multiple of 4 for Float32Array alignment

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

// ---------------------------------------------------------------------------
// CRC-32 — pure TypeScript, no external dependency
// ---------------------------------------------------------------------------

/** Lookup table for CRC-32 computation. */
const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c;
  }
  return table;
})();

/**
 * Compute a CRC-32 checksum over a Uint8Array view of a buffer.
 * Returns an unsigned 32-bit integer.
 */
function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = (CRC_TABLE[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Public serialization API
// ---------------------------------------------------------------------------

/**
 * Serialize a VectorData record to a versioned binary ArrayBuffer.
 *
 * The output includes a magic marker, format version, field lengths, and a
 * CRC-32 integrity checksum so readers can detect corruption before parsing.
 */
export function vectorDataToBinary(data: VectorData): ArrayBuffer {
  const remaining = buildBinaryRemainingFields(data);

  const jsonBytes = new TextEncoder().encode(JSON.stringify(remaining));
  const vectorLength = data.vector.length;
  const vectorByteLength = vectorLength * Float32Array.BYTES_PER_ELEMENT;
  const metaLength = jsonBytes.byteLength;

  const totalSize = HEADER_SIZE + vectorByteLength + metaLength;
  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  // Header fields
  view.setUint32(OFFSET_MAGIC, BINARY_MAGIC, true);
  view.setUint8(OFFSET_VERSION, 1);
  view.setUint32(OFFSET_VECTOR_LENGTH, vectorLength, true);
  view.setUint32(OFFSET_META_LENGTH, metaLength, true);
  // Checksum field is zeroed initially (set after computing)
  view.setUint32(OFFSET_CHECKSUM, 0, true);

  // Payload
  const float32View = new Float32Array(buffer, HEADER_SIZE, vectorLength);
  float32View.set(data.vector);
  bytes.set(jsonBytes, HEADER_SIZE + vectorByteLength);

  // Compute and write checksum over the whole buffer (checksum field = 0)
  const checksum = crc32(bytes);
  view.setUint32(OFFSET_CHECKSUM, checksum, true);

  return buffer;
}

/**
 * Deserialize a versioned binary ArrayBuffer into a VectorData record.
 *
 * Validates the magic marker, format version, field lengths, and CRC-32
 * checksum before parsing.  Throws `StorageCorruptionError` when the
 * payload is structurally invalid or the checksum does not match.
 * Throws `StorageFormatError` when the version is unsupported.
 */
export function binaryToVectorData(buffer: ArrayBuffer): VectorData {
  // ---- Memory-exhaustion guard -------------------------------------------
  // Reject oversized payloads before any allocation from the buffer contents.
  if (buffer.byteLength > MAX_BINARY_PAYLOAD_BYTES) {
    throw new Error(
      `Binary payload of ${buffer.byteLength} bytes exceeds the maximum allowed size of ${MAX_BINARY_PAYLOAD_BYTES} bytes`,
    );
  }

  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  // ---- Minimum size check ------------------------------------------------
  if (buffer.byteLength < HEADER_SIZE) {
    throw new StorageCorruptionError(
      `Buffer too small: ${buffer.byteLength} bytes (minimum ${HEADER_SIZE})`,
    );
  }

  // ---- Magic marker ------------------------------------------------------
  const magic = view.getUint32(OFFSET_MAGIC, true);
  if (magic !== BINARY_MAGIC) {
    // Could be a legacy (non-versioned) buffer — let the caller handle it via
    // tryBinaryToVectorData.  We throw here so the caller can distinguish.
    throw new StorageCorruptionError(
      `Invalid magic marker: 0x${magic.toString(16).padStart(8, '0').toUpperCase()} (expected 0x56454346)`,
    );
  }

  // ---- Version -----------------------------------------------------------
  const version = view.getUint8(OFFSET_VERSION);
  if (!(SUPPORTED_BINARY_VERSIONS as readonly number[]).includes(version)) {
    throw new StorageFormatError(version, SUPPORTED_BINARY_VERSIONS);
  }

  // ---- Field lengths -----------------------------------------------------
  const vectorLength = view.getUint32(OFFSET_VECTOR_LENGTH, true);
  const metaLength = view.getUint32(OFFSET_META_LENGTH, true);

  // Reject an implausible vector length encoded in the header before computing
  // any allocation size — guards against memory-exhaustion from crafted input.
  if (vectorLength > MAX_VECTOR_DIMENSION) {
    throw new Error(
      `Binary payload claims vector length ${vectorLength} which exceeds the maximum allowed dimension of ${MAX_VECTOR_DIMENSION}`,
    );
  }

  const expectedSize =
    HEADER_SIZE + vectorLength * Float32Array.BYTES_PER_ELEMENT + metaLength;
  if (buffer.byteLength !== expectedSize) {
    throw new StorageCorruptionError(
      `Buffer size mismatch: expected ${expectedSize} bytes but got ${buffer.byteLength}`,
    );
  }

  // ---- Checksum ----------------------------------------------------------
  const storedChecksum = view.getUint32(OFFSET_CHECKSUM, true);

  // Zero out the checksum field for recomputation
  const checkBuffer = buffer.slice(0);
  const checkView = new DataView(checkBuffer);
  checkView.setUint32(OFFSET_CHECKSUM, 0, true);
  const computed = crc32(new Uint8Array(checkBuffer));

  if (computed !== storedChecksum) {
    throw new StorageCorruptionError(
      `CRC-32 checksum mismatch: stored 0x${storedChecksum.toString(16)} vs computed 0x${computed.toString(16)}`,
    );
  }

  // ---- Payload -----------------------------------------------------------
  const vectorByteLength = vectorLength * Float32Array.BYTES_PER_ELEMENT;
  const vector = new Float32Array(
    buffer.slice(HEADER_SIZE, HEADER_SIZE + vectorByteLength),
  );

  const jsonBytes = bytes.subarray(HEADER_SIZE + vectorByteLength);
  let remaining: BinaryRemainingFields;
  try {
    remaining = JSON.parse(new TextDecoder().decode(jsonBytes)) as BinaryRemainingFields;
  } catch (cause) {
    throw new StorageCorruptionError(
      `Failed to parse metadata JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }

  // ---- Semantic validation -----------------------------------------------
  if (typeof remaining.id !== 'string' || remaining.id.length === 0) {
    throw new StorageCorruptionError('Metadata missing required field: id');
  }
  if (typeof remaining.magnitude !== 'number') {
    throw new StorageCorruptionError('Metadata missing required field: magnitude');
  }
  if (typeof remaining.timestamp !== 'number') {
    throw new StorageCorruptionError('Metadata missing required field: timestamp');
  }

  return binaryFieldsToVectorData(remaining, vector);
}

/**
 * Attempt to read a binary buffer using the versioned format.
 * Falls back to the legacy (unversioned) format if the magic marker is absent.
 *
 * Returns a `VectorData` on success.  Returns `null` when the buffer is
 * completely unreadable and `failClosed` is `false`; throws when `failClosed`
 * is `true` (default).
 *
 * The `onCorruption` callback, if provided, is called with the
 * `StorageCorruptionError` or `StorageFormatError` before falling back or
 * throwing, giving callers an opportunity to log or emit a signal.
 */
export function tryBinaryToVectorData(
  buffer: ArrayBuffer,
  options: {
    failClosed?: boolean;
    onCorruption?: (error: StorageCorruptionError | StorageFormatError) => void;
  } = {},
): VectorData | null {
  const { failClosed = true, onCorruption } = options;

  try {
    return binaryToVectorData(buffer);
  } catch (error) {
    if (error instanceof StorageFormatError) {
      onCorruption?.(error);
      if (failClosed) throw error;
      return null;
    }

    if (error instanceof StorageCorruptionError) {
      const magic = buffer.byteLength >= 4 ? new DataView(buffer).getUint32(0, true) : -1;
      const isLegacy = magic !== BINARY_MAGIC;

      if (isLegacy) {
        // Try to parse as legacy format (no header, starts with a uint32 vector length)
        try {
          return legacyBinaryToVectorData(buffer);
        } catch {
          // Legacy parse also failed — fall through to corruption handling
        }
      }

      onCorruption?.(error);
      if (failClosed) throw error;
      return null;
    }

    // Unknown error — rethrow as-is
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Legacy binary format (kept for backwards-compatibility reads)
//
// Wire format: [4-byte uint32 vector length (little-endian)]
//              [Float32Array bytes]
//              [UTF-8 JSON for remaining fields]
// ---------------------------------------------------------------------------

/**
 * Serialize a VectorData record using the legacy binary format.
 *
 * @deprecated Prefer `vectorDataToBinary` which includes integrity headers.
 */
export function legacyVectorDataToBinary(data: VectorData): ArrayBuffer {
  const remaining = buildBinaryRemainingFields(data);

  const jsonBytes = new TextEncoder().encode(JSON.stringify(remaining));
  const vectorLength = data.vector.length;
  const vectorByteLength = vectorLength * Float32Array.BYTES_PER_ELEMENT;

  const totalSize = 4 + vectorByteLength + jsonBytes.byteLength;
  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);

  view.setUint32(0, vectorLength, true);

  const float32View = new Float32Array(buffer, 4, vectorLength);
  float32View.set(data.vector);

  new Uint8Array(buffer, 4 + vectorByteLength).set(jsonBytes);

  return buffer;
}

/**
 * Deserialize a legacy binary ArrayBuffer into a VectorData record.
 * No integrity checks are performed; corrupt input may produce garbage data.
 *
 * @deprecated Prefer `binaryToVectorData` which validates integrity headers.
 */
export function legacyBinaryToVectorData(buffer: ArrayBuffer): VectorData {
  // Reject oversized payloads before any allocation from the buffer contents
  if (buffer.byteLength > MAX_BINARY_PAYLOAD_BYTES) {
    throw new Error(
      `Binary payload of ${buffer.byteLength} bytes exceeds the maximum allowed size of ${MAX_BINARY_PAYLOAD_BYTES} bytes`,
    );
  }

  if (buffer.byteLength < 4) {
    throw new StorageCorruptionError(
      `Legacy buffer too small: ${buffer.byteLength} bytes`,
    );
  }

  const view = new DataView(buffer);
  const vectorLength = view.getUint32(0, true);

  // Reject implausible vector lengths encoded in the binary header
  if (vectorLength > 100_000) {
    throw new Error(
      `Binary payload claims vector length ${vectorLength} which exceeds the maximum allowed dimension of 100,000`,
    );
  }

  const vectorByteLength = vectorLength * Float32Array.BYTES_PER_ELEMENT;

  if (buffer.byteLength < 4 + vectorByteLength) {
    throw new StorageCorruptionError(
      `Legacy buffer truncated: need ${4 + vectorByteLength} bytes for vector, have ${buffer.byteLength}`,
    );
  }

  const vector = new Float32Array(buffer.slice(4, 4 + vectorByteLength));

  const jsonBytes = new Uint8Array(buffer, 4 + vectorByteLength);
  let remaining: BinaryRemainingFields;
  try {
    remaining = JSON.parse(new TextDecoder().decode(jsonBytes)) as BinaryRemainingFields;
  } catch (cause) {
    throw new StorageCorruptionError(
      `Legacy buffer: failed to parse metadata JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }

  if (typeof remaining.id !== 'string' || remaining.id.length === 0) {
    throw new StorageCorruptionError(
      'Legacy buffer: metadata missing required field: id',
    );
  }

  return binaryFieldsToVectorData(remaining, vector);
}
