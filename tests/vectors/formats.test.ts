import { describe, expect, it } from 'bun:test';

import { DimensionMismatchError, InvalidFormatError } from '@/core/errors.js';
import { VectorFormatHandler } from '@/vectors/formats.js';

describe('VectorFormatHandler Enhanced Validation', () => {
  describe('Format Detection', () => {
    it('should detect valid formats correctly', () => {
      expect(VectorFormatHandler.detectFormat(new Float32Array([1, 2, 3]))).toBe(
        'float32',
      );
      expect(VectorFormatHandler.detectFormat(new Float64Array([1, 2, 3]))).toBe(
        'float64',
      );
      expect(VectorFormatHandler.detectFormat(new Int8Array([1, 2, 3]))).toBe('int8');
      expect(VectorFormatHandler.detectFormat(new Uint8Array([1, 2, 3]))).toBe('uint8');
      expect(VectorFormatHandler.detectFormat(new Uint8Array([0, 1, 0]))).toBe('binary');
      expect(VectorFormatHandler.detectFormat([1, 2, 3])).toBe('array');
    });

    it('should throw error for null/undefined vectors', () => {
      expect(() => VectorFormatHandler.detectFormat(null as any)).toThrow(
        InvalidFormatError,
      );
      expect(() => VectorFormatHandler.detectFormat(undefined as any)).toThrow(
        InvalidFormatError,
      );
    });

    it('should throw error for empty vectors', () => {
      expect(() => VectorFormatHandler.detectFormat(new Float32Array([]))).toThrow(
        InvalidFormatError,
      );
      expect(() => VectorFormatHandler.detectFormat([])).toThrow(InvalidFormatError);
    });

    it('should throw error for arrays with non-numeric values', () => {
      expect(() => VectorFormatHandler.detectFormat([1, 'invalid', 3] as any)).toThrow(
        InvalidFormatError,
      );
      // NaN and Infinity are handled in validate(), not detectFormat()
    });
  });

  describe('Enhanced Validation', () => {
    it('should validate dimension constraints', () => {
      const vector = new Float32Array([1, 2, 3]);

      // Should pass with correct dimension
      expect(() => VectorFormatHandler.validate(vector, 3)).not.toThrow();

      // Should throw with wrong dimension
      expect(() => VectorFormatHandler.validate(vector, 4)).toThrow(
        DimensionMismatchError,
      );
    });

    it('should validate dimension ranges', () => {
      const vector = new Float32Array([1, 2, 3, 4, 5]);

      // Should pass within range
      expect(() =>
        VectorFormatHandler.validate(vector, undefined, {
          minDimension: 3,
          maxDimension: 10,
        }),
      ).not.toThrow();

      // Should fail below minimum
      expect(() =>
        VectorFormatHandler.validate(vector, undefined, {
          minDimension: 10,
        }),
      ).toThrow('Vector dimension too small');

      // Should fail above maximum
      expect(() =>
        VectorFormatHandler.validate(vector, undefined, {
          maxDimension: 3,
        }),
      ).toThrow('Vector dimension too large');
    });

    it('should validate normalization requirement', () => {
      const normalizedVector = new Float32Array([0.6, 0.8]); // magnitude = 1.0
      const unnormalizedVector = new Float32Array([3, 4]); // magnitude = 5.0

      // Should pass for normalized vector
      expect(() =>
        VectorFormatHandler.validate(normalizedVector, undefined, {
          requireNormalized: true,
        }),
      ).not.toThrow();

      // Should fail for unnormalized vector
      expect(() =>
        VectorFormatHandler.validate(unnormalizedVector, undefined, {
          requireNormalized: true,
        }),
      ).toThrow('Vector is not normalized');
    });

    it('should validate NaN and infinity constraints', () => {
      const vectorWithNaN = [1, NaN, 3]; // Use arrays since typed arrays can't store NaN/Infinity reliably
      const vectorWithInfinity = [1, Infinity, 3];
      new Float32Array([1, 2, 3]);

      // Should reject NaN by default
      expect(() => VectorFormatHandler.validate(vectorWithNaN)).toThrow(
        'Vector contains NaN values',
      );

      // Should reject Infinity by default
      expect(() => VectorFormatHandler.validate(vectorWithInfinity)).toThrow(
        'Vector contains infinite values',
      );

      // Should allow NaN when explicitly enabled
      expect(() =>
        VectorFormatHandler.validate(vectorWithNaN, undefined, {
          allowNaN: true,
        }),
      ).not.toThrow();

      // Should allow Infinity when explicitly enabled
      expect(() =>
        VectorFormatHandler.validate(vectorWithInfinity, undefined, {
          allowInfinity: true,
        }),
      ).not.toThrow();
    });

    it('should validate binary vectors', () => {
      const validBinary = new Uint8Array([0, 1, 0, 1]);
      const invalidBinary = new Uint8Array([0, 1, 2, 1]);

      // Should pass for valid binary (detected as binary format)
      expect(() => VectorFormatHandler.validate(validBinary)).not.toThrow();
      expect(VectorFormatHandler.detectFormat(validBinary)).toBe('binary');

      // Should be detected as uint8, not binary (because it has value 2)
      expect(VectorFormatHandler.detectFormat(invalidBinary)).toBe('uint8');
      expect(() => VectorFormatHandler.validate(invalidBinary)).not.toThrow(); // uint8 format is valid
    });
  });

  describe('Vector Utilities', () => {
    it('should normalize vectors correctly', () => {
      const vector = new Float32Array([3, 4]); // magnitude = 5
      const normalized = VectorFormatHandler.normalize(vector) as Float32Array;

      expect(normalized[0]).toBeCloseTo(0.6, 6);
      expect(normalized[1]).toBeCloseTo(0.8, 6);

      // Check magnitude is 1
      const magnitude = Math.sqrt(normalized[0]! ** 2 + normalized[1]! ** 2);
      expect(magnitude).toBeCloseTo(1.0, 6);
    });

    it('should throw error when normalizing zero vector', () => {
      const zeroVector = new Float32Array([0, 0, 0]);
      expect(() => VectorFormatHandler.normalize(zeroVector)).toThrow(
        'Cannot normalize zero vector',
      );
    });

    it('should check vector equality with tolerance', () => {
      const vector1 = new Float32Array([1.0, 2.0, 3.0]);
      const vector2 = new Float32Array([1.000001, 2.000001, 3.000001]);
      const vector3 = new Float32Array([1.1, 2.1, 3.1]);

      // Should be equal within default tolerance
      expect(VectorFormatHandler.isEqual(vector1, vector2)).toBe(true);

      // Should not be equal outside tolerance
      expect(VectorFormatHandler.isEqual(vector1, vector3)).toBe(false);

      // Should be equal with larger tolerance
      expect(VectorFormatHandler.isEqual(vector1, vector3, 0.2)).toBe(true);
    });

    it('should return comprehensive vector information', () => {
      const vector = new Float32Array([0.6, 0.8]);
      const info = VectorFormatHandler.getVectorInfo(vector);

      expect(info.format).toBe('float32');
      expect(info.dimension).toBe(2);
      expect(info.byteSize).toBe(8);
      expect(info.magnitude).toBeCloseTo(1.0, 6);
      expect(info.isNormalized).toBe(true);
      expect(info.hasInvalidValues).toBe(false);
      expect(info.range.min).toBeCloseTo(0.6, 5);
      expect(info.range.max).toBeCloseTo(0.8, 5);
      expect(info.stats.mean).toBeCloseTo(0.7, 6);
    });

    it('should suggest optimal formats correctly', () => {
      // Binary vector
      const binaryVector = new Float32Array([0, 1, 0, 1]);
      const binarySuggestion = VectorFormatHandler.suggestOptimalFormat(binaryVector);
      expect(binarySuggestion.recommendedFormat).toBe('binary');
      expect(binarySuggestion.reasoning).toContain('binary values');

      // Int8 range vector
      const int8Vector = new Float32Array([-0.5, 0.3, 0.8, -0.2]);
      const int8Suggestion = VectorFormatHandler.suggestOptimalFormat(int8Vector);
      expect(int8Suggestion.recommendedFormat).toBe('int8');
      expect(int8Suggestion.reasoning).toContain('[-1, 1] range');

      // Uint8 range vector
      const uint8Vector = new Float32Array([0.1, 0.5, 0.9, 0.3]);
      const uint8Suggestion = VectorFormatHandler.suggestOptimalFormat(uint8Vector);
      expect(uint8Suggestion.recommendedFormat).toBe('uint8');
      expect(uint8Suggestion.reasoning).toContain('[0, 1] range');

      // Full precision vector
      const fullPrecisionVector = new Float32Array([10.5, -20.3, 100.7]);
      const fullPrecisionSuggestion =
        VectorFormatHandler.suggestOptimalFormat(fullPrecisionVector);
      expect(fullPrecisionSuggestion.recommendedFormat).toBe('float32');
      expect(fullPrecisionSuggestion.reasoning).toContain(
        'full floating-point precision',
      );
    });
  });

  describe('Format Conversion', () => {
    it('should maintain data integrity during conversions', () => {
      const original = new Float32Array([0.5, -0.3, 0.8]);

      // Convert to different formats and back
      const asInt8 = VectorFormatHandler.fromFloat32Array(original, 'int8') as Int8Array;
      const backToFloat32 = VectorFormatHandler.toFloat32Array(asInt8);

      // Should be approximately equal (within quantization error)
      for (let i = 0; i < original.length; i++) {
        expect(Math.abs(backToFloat32[i]! - original[i]!)).toBeLessThan(0.01);
      }
    });

    it('should handle edge cases in format conversion', () => {
      // Test clamping behavior
      const extremeValues = new Float32Array([-10, 10, 0]);
      const asInt8 = VectorFormatHandler.fromFloat32Array(
        extremeValues,
        'int8',
      ) as Int8Array;

      // Should clamp to valid range
      expect(asInt8[0]).toBe(-127); // Clamped from -10
      expect(asInt8[1]).toBe(127); // Clamped from 10
      expect(asInt8[2]).toBe(0); // Unchanged
    });
  });

  describe('Error Messages', () => {
    it('should provide helpful error messages', () => {
      try {
        VectorFormatHandler.detectFormat(null as any);
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidFormatError);
        expect((error as Error).message).toContain('null_or_undefined');
      }

      try {
        VectorFormatHandler.detectFormat([]);
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidFormatError);
        expect((error as Error).message).toContain('empty_vector');
      }

      try {
        VectorFormatHandler.validate(new Float32Array([1, 2, 3]), 5);
      } catch (error) {
        expect(error).toBeInstanceOf(DimensionMismatchError);
      }
    });
  });
});
