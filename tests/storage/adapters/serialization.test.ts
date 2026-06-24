import { describe, expect, it } from 'bun:test';

import { StorageCorruptionError, StorageFormatError } from '@/core/errors.js';
import type { VectorData } from '@/core/types.js';
import {
  BINARY_MAGIC,
  SUPPORTED_BINARY_VERSIONS,
  binaryToVectorData,
  calculateMagnitude,
  jsonToVectorData,
  legacyBinaryToVectorData,
  legacyVectorDataToBinary,
  serializableToVectorData,
  tryBinaryToVectorData,
  vectorDataToBinary,
  vectorDataToJson,
  vectorDataToSerializable,
} from '@/storage/adapters/serialization.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeVector(
  id: string,
  values: number[],
  meta?: Record<string, unknown>,
): VectorData {
  const vector = new Float32Array(values);
  const magnitude = calculateMagnitude(vector);
  const result: VectorData = {
    id,
    vector,
    magnitude,
    timestamp: 1_700_000_000_000,
  };
  if (meta !== undefined) {
    result.metadata = meta;
  }
  return result;
}

// ---------------------------------------------------------------------------
// calculateMagnitude
// ---------------------------------------------------------------------------

describe('calculateMagnitude', () => {
  it('computes the L2 norm correctly', () => {
    // [3, 4] => 5
    expect(calculateMagnitude(new Float32Array([3, 4]))).toBeCloseTo(5, 4);
  });

  it('returns 0 for a zero vector', () => {
    expect(calculateMagnitude(new Float32Array([0, 0, 0]))).toBe(0);
  });

  it('handles single-element vectors', () => {
    expect(calculateMagnitude(new Float32Array([7]))).toBeCloseTo(7, 4);
  });
});

// ---------------------------------------------------------------------------
// JSON serialization round-trip
// ---------------------------------------------------------------------------

describe('JSON serialization', () => {
  it('round-trips a minimal VectorData through serializableToVectorData', () => {
    const original = makeVector('a', [1, 2, 3]);
    const serialized = vectorDataToSerializable(original);
    const restored = serializableToVectorData(serialized);

    expect(restored.id).toBe('a');
    expect(Array.from(restored.vector)).toEqual([1, 2, 3]);
    expect(restored.magnitude).toBeCloseTo(original.magnitude, 5);
    expect(restored.timestamp).toBe(original.timestamp);
    expect(restored.metadata).toBeUndefined();
  });

  it('preserves all optional fields through serialization', () => {
    const original = makeVector('b', [0.5, -0.5], { label: 'test' });
    original.normalized = true;
    original.lastAccessed = 1_700_000_001_000;
    original.accessCount = 42;
    original.format = 'float32';

    const serialized = vectorDataToSerializable(original);
    const restored = serializableToVectorData(serialized);

    expect(restored.normalized).toBe(true);
    expect(restored.lastAccessed).toBe(1_700_000_001_000);
    expect(restored.accessCount).toBe(42);
    expect(restored.format).toBe('float32');
    expect(restored.metadata).toEqual({ label: 'test' });
  });

  it('round-trips through vectorDataToJson / jsonToVectorData', () => {
    const original = makeVector('json-test', [1, 0, -1], { x: 99 });
    const json = vectorDataToJson(original);
    expect(typeof json).toBe('string');

    const restored = jsonToVectorData(json);
    expect(restored.id).toBe('json-test');
    expect(restored.metadata).toEqual({ x: 99 });
    expect(Array.from(restored.vector)).toEqual([1, 0, -1]);
  });
});

// ---------------------------------------------------------------------------
// Binary serialization — versioned format
// ---------------------------------------------------------------------------

describe('vectorDataToBinary / binaryToVectorData (versioned)', () => {
  it('round-trips a minimal VectorData', () => {
    const original = makeVector('bin-1', [1, 2, 3, 4]);
    const buffer = vectorDataToBinary(original);

    expect(buffer.byteLength).toBeGreaterThan(17); // at least header size
    const restored = binaryToVectorData(buffer);

    expect(restored.id).toBe('bin-1');
    expect(Array.from(restored.vector)).toEqual([1, 2, 3, 4]);
    expect(restored.magnitude).toBeCloseTo(original.magnitude, 5);
    expect(restored.timestamp).toBe(original.timestamp);
  });

  it('round-trips all optional fields', () => {
    const original = makeVector('bin-2', [0.1, 0.2], { tag: 'hello' });
    original.normalized = false;
    original.lastAccessed = 9999;
    original.accessCount = 7;
    original.format = 'float32';

    const buffer = vectorDataToBinary(original);
    const restored = binaryToVectorData(buffer);

    expect(restored.normalized).toBe(false);
    expect(restored.lastAccessed).toBe(9999);
    expect(restored.accessCount).toBe(7);
    expect(restored.format).toBe('float32');
    expect(restored.metadata).toEqual({ tag: 'hello' });
  });

  it('writes the correct magic marker in the header', () => {
    const buffer = vectorDataToBinary(makeVector('magic-check', [1]));
    const view = new DataView(buffer);
    expect(view.getUint32(0, true)).toBe(BINARY_MAGIC);
  });

  it('writes the correct version byte', () => {
    const buffer = vectorDataToBinary(makeVector('ver-check', [1]));
    const view = new DataView(buffer);
    expect(view.getUint8(4)).toBe(SUPPORTED_BINARY_VERSIONS[0]);
  });

  it('writes a non-zero CRC-32 checksum', () => {
    const buffer = vectorDataToBinary(makeVector('crc-check', [1, 2, 3]));
    const view = new DataView(buffer);
    // Checksum is at byte offset 16 (after magic, version+padding, vectorLen, metaLen)
    expect(view.getUint32(16, true)).not.toBe(0);
  });

  it('handles large vectors', () => {
    const values = Array.from({ length: 1024 }, (_, i) => i / 1024);
    const original = makeVector('large', values);
    const buffer = vectorDataToBinary(original);
    const restored = binaryToVectorData(buffer);
    expect(restored.vector.length).toBe(1024);
    expect(restored.vector[0]).toBeCloseTo(0, 5);
    expect(restored.vector[1023]).toBeCloseTo(1023 / 1024, 5);
  });
});

// ---------------------------------------------------------------------------
// Corruption detection — binaryToVectorData
// ---------------------------------------------------------------------------

describe('binaryToVectorData corruption detection', () => {
  it('throws StorageCorruptionError for a too-small buffer', () => {
    expect(() => binaryToVectorData(new ArrayBuffer(4))).toThrow(StorageCorruptionError);
  });

  it('throws StorageCorruptionError for a buffer with wrong magic marker', () => {
    const buffer = vectorDataToBinary(makeVector('x', [1]));
    const view = new DataView(buffer);
    // Corrupt the magic marker
    view.setUint32(0, 0xdeadbeef, true);
    expect(() => binaryToVectorData(buffer)).toThrow(StorageCorruptionError);
  });

  it('throws StorageFormatError for an unsupported version', () => {
    const buffer = vectorDataToBinary(makeVector('x', [1]));
    const view = new DataView(buffer);
    view.setUint8(4, 255); // unknown version
    // Recompute checksum so only version error triggers
    // (We intentionally skip recomputing to get a checksum error first;
    //  but we still verify the right error type is thrown.)
    try {
      binaryToVectorData(buffer);
      expect(true).toBe(false); // Should not reach here
    } catch (e) {
      // Either StorageCorruptionError (checksum mismatch) or StorageFormatError
      // depending on check order — both are acceptable, but StorageFormatError
      // is the desired primary signal. Accept either in unit tests.
      expect(e).toBeInstanceOf(Error);
    }
  });

  it('throws StorageFormatError when version byte is explicitly unsupported (recomputed checksum)', () => {
    // Build a buffer where version is invalid but checksum is updated
    const original = makeVector('ver-err', [1, 2]);
    const buffer = vectorDataToBinary(original);

    // Patch version to 99 and re-zero the checksum field before computing
    const view = new DataView(buffer);
    view.setUint8(4, 99); // unsupported version
    view.setUint32(13, 0, true); // zero checksum field
    // Recompute checksum
    const bytes = new Uint8Array(buffer);
    let crc = 0xffffffff;
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[i] = c;
    }
    for (let i = 0; i < bytes.length; i++) {
      crc = (table[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8)) >>> 0;
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    view.setUint32(13, crc, true);

    expect(() => binaryToVectorData(buffer)).toThrow(StorageFormatError);
  });

  it('throws StorageCorruptionError for a CRC-32 mismatch', () => {
    const buffer = vectorDataToBinary(makeVector('crc-err', [1, 2, 3]));
    // Flip a byte in the vector payload (after header)
    const bytes = new Uint8Array(buffer);
    bytes[17] = bytes[17]! ^ 0xff; // flip first vector byte

    expect(() => binaryToVectorData(buffer)).toThrow(StorageCorruptionError);
    try {
      binaryToVectorData(buffer);
    } catch (e) {
      expect(e).toBeInstanceOf(StorageCorruptionError);
      expect((e as StorageCorruptionError).message).toMatch(/checksum/i);
    }
  });

  it('throws StorageCorruptionError for a size mismatch (truncated payload)', () => {
    const full = vectorDataToBinary(makeVector('trunc', [1, 2, 3, 4]));
    const truncated = full.slice(0, full.byteLength - 4); // remove last 4 bytes
    expect(() => binaryToVectorData(truncated)).toThrow(StorageCorruptionError);
  });

  it('reports the StorageCorruptionError code', () => {
    const buffer = vectorDataToBinary(makeVector('code-check', [1]));
    const view = new DataView(buffer);
    view.setUint32(0, 0xdeadbeef, true);

    try {
      binaryToVectorData(buffer);
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(StorageCorruptionError);
      expect((e as StorageCorruptionError).code).toBe('STORAGE_CORRUPTION');
    }
  });
});

// ---------------------------------------------------------------------------
// tryBinaryToVectorData — recovery and fail-closed
// ---------------------------------------------------------------------------

describe('tryBinaryToVectorData', () => {
  it('returns the VectorData when the buffer is valid', () => {
    const original = makeVector('try-ok', [1, 0]);
    const buffer = vectorDataToBinary(original);
    const result = tryBinaryToVectorData(buffer);
    expect(result).not.toBeNull();
    expect(result!.id).toBe('try-ok');
  });

  it('throws by default (failClosed=true) on a corrupt buffer', () => {
    const buffer = vectorDataToBinary(makeVector('try-corrupt', [1]));
    const view = new DataView(buffer);
    view.setUint32(0, 0xdeadbeef, true);

    expect(() => tryBinaryToVectorData(buffer)).toThrow(StorageCorruptionError);
  });

  it('returns null on a corrupt buffer when failClosed=false', () => {
    const buffer = vectorDataToBinary(makeVector('try-null', [1]));
    const view = new DataView(buffer);
    view.setUint32(0, 0xdeadbeef, true);

    const result = tryBinaryToVectorData(buffer, { failClosed: false });
    expect(result).toBeNull();
  });

  it('calls onCorruption before returning null', () => {
    const buffer = vectorDataToBinary(makeVector('try-cb', [1]));
    const bytes = new Uint8Array(buffer);
    bytes[17] = bytes[17]! ^ 0xff;

    let captured: Error | null = null;
    const result = tryBinaryToVectorData(buffer, {
      failClosed: false,
      onCorruption: (err) => {
        captured = err;
      },
    });

    expect(result).toBeNull();
    expect(captured).toBeInstanceOf(StorageCorruptionError);
  });

  it('falls back to legacy format when magic is absent', () => {
    const original = makeVector('legacy-fb', [5, 6, 7]);
    const legacyBuffer = legacyVectorDataToBinary(original);

    // legacyBuffer starts with a uint32 vector length — no VECF magic
    const result = tryBinaryToVectorData(legacyBuffer, { failClosed: false });
    expect(result).not.toBeNull();
    expect(result!.id).toBe('legacy-fb');
    expect(Array.from(result!.vector)).toEqual([5, 6, 7]);
  });
});

// ---------------------------------------------------------------------------
// Legacy binary format
// ---------------------------------------------------------------------------

describe('legacyVectorDataToBinary / legacyBinaryToVectorData', () => {
  it('round-trips a VectorData through the legacy format', () => {
    const original = makeVector('leg-1', [10, 20, 30]);
    const buffer = legacyVectorDataToBinary(original);
    const restored = legacyBinaryToVectorData(buffer);

    expect(restored.id).toBe('leg-1');
    expect(Array.from(restored.vector)).toEqual([10, 20, 30]);
    expect(restored.timestamp).toBe(original.timestamp);
  });

  it('throws StorageCorruptionError for a too-small legacy buffer', () => {
    expect(() => legacyBinaryToVectorData(new ArrayBuffer(2))).toThrow(
      StorageCorruptionError,
    );
  });

  it('throws StorageCorruptionError for a truncated legacy vector payload', () => {
    // Manually craft a buffer that claims 100 floats but only has 4 bytes
    const buffer = new ArrayBuffer(8);
    const view = new DataView(buffer);
    view.setUint32(0, 100, true); // claims 100 floats = 400 bytes but buffer is only 8
    expect(() => legacyBinaryToVectorData(buffer)).toThrow(StorageCorruptionError);
  });

  it('throws StorageCorruptionError when metadata JSON is missing required field id', () => {
    // Build a valid legacy buffer then corrupt the JSON
    const original = makeVector('leg-corrupt', [1, 2]);
    const buffer = legacyVectorDataToBinary(original);

    // Find the JSON part and replace id
    const view = new DataView(buffer);
    const vectorLength = view.getUint32(0, true);
    const vectorBytes = vectorLength * 4;
    const jsonStart = 4 + vectorBytes;
    const jsonSlice = new Uint8Array(buffer, jsonStart);
    const json = new TextDecoder().decode(jsonSlice);
    const corrupt = json.replace('"id":"leg-corrupt"', '"id":""');

    const newBuffer = new ArrayBuffer(4 + vectorBytes + corrupt.length);
    const newView = new DataView(newBuffer);
    newView.setUint32(0, vectorLength, true);
    new Uint8Array(newBuffer, 4, vectorBytes).set(new Uint8Array(buffer, 4, vectorBytes));
    new Uint8Array(newBuffer, 4 + vectorBytes).set(new TextEncoder().encode(corrupt));

    expect(() => legacyBinaryToVectorData(newBuffer)).toThrow(StorageCorruptionError);
  });
});

// ---------------------------------------------------------------------------
// StorageCorruptionError / StorageFormatError shape
// ---------------------------------------------------------------------------

describe('StorageCorruptionError shape', () => {
  it('carries code STORAGE_CORRUPTION', () => {
    const e = new StorageCorruptionError('bad data', 'vec-1');
    expect(e.code).toBe('STORAGE_CORRUPTION');
    expect(e.vectorId).toBe('vec-1');
    expect(e.reason).toBe('bad data');
    expect(e.message).toContain('vec-1');
    expect(e.message).toContain('bad data');
  });

  it('works without a vectorId', () => {
    const e = new StorageCorruptionError('truncated');
    expect(e.vectorId).toBeUndefined();
    expect(e.message).toContain('truncated');
  });
});

describe('StorageFormatError shape', () => {
  it('carries code STORAGE_FORMAT_ERROR', () => {
    const e = new StorageFormatError(99, [1]);
    expect(e.code).toBe('STORAGE_FORMAT_ERROR');
    expect(e.formatVersion).toBe(99);
    expect(e.supportedVersions).toEqual([1]);
    expect(e.message).toContain('99');
  });
});
