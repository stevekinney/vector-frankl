import { describe, expect, it } from 'bun:test';

import type { VectorData } from '@/core/types.js';
import {
  binaryToVectorData,
  jsonToVectorData,
  vectorDataToBinary,
  vectorDataToJson,
} from '@/storage/adapters/serialization.js';

/**
 * Build a minimal valid VectorData record with a given number of dimensions.
 */
function makeVectorData(dimensions: number, id = 'test-vector'): VectorData {
  const vector = new Float32Array(dimensions).fill(1);
  return {
    id,
    vector,
    magnitude: Math.sqrt(dimensions),
    timestamp: Date.now(),
  };
}

describe('Serialization', () => {
  describe('JSON round-trip', () => {
    it('serializes and deserializes a small vector correctly', () => {
      const original = makeVectorData(4);
      const json = vectorDataToJson(original);
      const recovered = jsonToVectorData(json);

      expect(recovered.id).toBe(original.id);
      expect(recovered.vector.length).toBe(4);
      expect(recovered.magnitude).toBeCloseTo(original.magnitude, 5);
    });
  });

  describe('Binary round-trip', () => {
    it('serializes and deserializes a small vector correctly', () => {
      const original = makeVectorData(4);
      const buffer = vectorDataToBinary(original);
      const recovered = binaryToVectorData(buffer);

      expect(recovered.id).toBe(original.id);
      expect(recovered.vector.length).toBe(4);
      expect(recovered.magnitude).toBeCloseTo(original.magnitude, 5);
    });
  });

  describe('Serialized payload memory limit regression tests', () => {
    describe('JSON deserialization limit', () => {
      it('rejects a JSON payload that exceeds the 512 MB limit before parsing', () => {
        // Build a string that is just over 512 MB. We use a simple repeated
        // character rather than a real serialized vector to avoid actually
        // allocating a Float32Array with millions of elements in the test.
        const overLimit = 512 * 1024 * 1024 + 1; // 512 MB + 1 byte
        // Simulate what a caller would see if it provided an oversized string;
        // we only create the string length value here for the guard check.
        // Actual allocation of 512 MB in a test would be impractical, so we
        // verify the guard by constructing a proxy that reports the oversized length.
        const fakeJson = { length: overLimit } as unknown as string;

        // The guard checks json.length, so this triggers even without real content
        expect(() => jsonToVectorData(fakeJson)).toThrow(
          'exceeds the maximum allowed size',
        );
      });

      it('accepts a normal-sized JSON payload', () => {
        const data = makeVectorData(4);
        const json = vectorDataToJson(data);

        // A 4-dimension vector JSON is tiny — must not throw
        expect(() => jsonToVectorData(json)).not.toThrow();
      });
    });

    describe('Binary deserialization limit', () => {
      it('rejects a binary payload that exceeds the 512 MB limit before any allocation', () => {
        // Build a DataView whose byteLength reports > 512 MB without truly
        // allocating that memory. We create a small real ArrayBuffer and then
        // use Object.defineProperty to override byteLength for the guard test.
        const tinyBuffer = new ArrayBuffer(8);
        const view = new DataView(tinyBuffer);
        view.setUint32(0, 1, true); // vector length = 1

        // Wrap in a Proxy that lies about byteLength
        const oversizedBuffer = new Proxy(tinyBuffer, {
          get(target, prop) {
            if (prop === 'byteLength') return 512 * 1024 * 1024 + 1;
            const value = Reflect.get(target, prop, target);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        }) as ArrayBuffer;

        expect(() => binaryToVectorData(oversizedBuffer)).toThrow(
          'exceeds the maximum allowed size',
        );
      });

      it('rejects binary payloads with a claimed vector length exceeding 100,000', () => {
        // Craft a binary buffer with a valid versioned header whose vector-length
        // field claims 200,000 dimensions — malicious input that would otherwise
        // cause a huge Float32Array allocation. The header layout is:
        //   magic@0 (u32), version@4 (u8), vectorLength@8 (u32),
        //   metaLength@12 (u32), checksum@16 (u32); HEADER_SIZE = 20.
        const BINARY_MAGIC = 0x56454346; // "VECF"
        const HEADER_SIZE = 20;
        const evilLength = 200_000; // exceeds the 100,000 dimension limit
        const buffer = new ArrayBuffer(HEADER_SIZE);
        const view = new DataView(buffer);
        view.setUint32(0, BINARY_MAGIC, true); // valid magic
        view.setUint8(4, 1); // supported version
        view.setUint32(8, evilLength, true); // evil vector length

        expect(() => binaryToVectorData(buffer)).toThrow(
          'exceeds the maximum allowed dimension',
        );
      });

      it('accepts a binary payload within limits', () => {
        const data = makeVectorData(4);
        const buffer = vectorDataToBinary(data);

        // A 4-element vector binary is tiny — must not throw
        expect(() => binaryToVectorData(buffer)).not.toThrow();
      });
    });
  });
});
