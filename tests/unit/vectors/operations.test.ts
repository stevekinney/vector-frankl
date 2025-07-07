import { describe, expect, test } from 'bun:test';

import { DimensionMismatchError } from '@/core/errors.js';
import { VectorOperations } from '@/vectors/operations.js';

describe('VectorOperations', () => {
  describe('magnitude', () => {
    test('should calculate magnitude correctly', async () => {
      const vector = new Float32Array([3, 4]);
      expect(await VectorOperations.magnitude(vector)).toBe(5);
    });

    test('should handle zero vector', async () => {
      const vector = new Float32Array([0, 0, 0]);
      expect(await VectorOperations.magnitude(vector)).toBe(0);
    });

    test('should handle unit vector', async () => {
      const vector = new Float32Array([1, 0, 0]);
      expect(await VectorOperations.magnitude(vector)).toBe(1);
    });
  });

  describe('normalize', () => {
    test('should normalize vector correctly', async () => {
      const vector = new Float32Array([3, 4]);
      const normalized = await VectorOperations.normalize(vector);

      expect(normalized[0]).toBeCloseTo(0.6);
      expect(normalized[1]).toBeCloseTo(0.8);
      expect(await VectorOperations.magnitude(normalized)).toBeCloseTo(1);
    });

    test('should handle zero vector', async () => {
      const vector = new Float32Array([0, 0, 0]);
      const normalized = await VectorOperations.normalize(vector);

      expect(normalized).toEqual(new Float32Array([0, 0, 0]));
    });

    test('should not modify original vector', async () => {
      const vector = new Float32Array([3, 4]);
      const original = new Float32Array(vector);

      await VectorOperations.normalize(vector);
      expect(vector).toEqual(original);
    });
  });

  describe('normalizeInPlace', () => {
    test('should normalize vector in place', async () => {
      const vector = new Float32Array([3, 4]);
      const result = await VectorOperations.normalizeInPlace(vector);

      expect(vector[0]).toBeCloseTo(0.6);
      expect(vector[1]).toBeCloseTo(0.8);
      expect(result).toBe(vector); // Same reference
    });
  });

  describe('isNormalized', () => {
    test('should detect normalized vector', async () => {
      const vector = new Float32Array([0.6, 0.8]);
      expect(await VectorOperations.isNormalized(vector)).toBe(true);
    });

    test('should detect non-normalized vector', async () => {
      const vector = new Float32Array([3, 4]);
      expect(await VectorOperations.isNormalized(vector)).toBe(false);
    });

    test('should handle epsilon tolerance', async () => {
      const vector = new Float32Array([0.6, 0.8000001]);
      expect(await VectorOperations.isNormalized(vector, 0.001)).toBe(true);
      expect(await VectorOperations.isNormalized(vector, 0.0000001)).toBe(false);
    });
  });

  describe('dotProduct', () => {
    test('should calculate dot product correctly', async () => {
      const vectorA = new Float32Array([1, 2, 3]);
      const vectorB = new Float32Array([4, 5, 6]);

      expect(await VectorOperations.dotProduct(vectorA, vectorB)).toBe(32);
    });

    test('should handle orthogonal vectors', async () => {
      const vectorA = new Float32Array([1, 0]);
      const vectorB = new Float32Array([0, 1]);

      expect(await VectorOperations.dotProduct(vectorA, vectorB)).toBe(0);
    });

    test('should throw error for dimension mismatch', () => {
      const vectorA = new Float32Array([1, 2]);
      const vectorB = new Float32Array([1, 2, 3]);

      expect(() => VectorOperations.dotProduct(vectorA, vectorB)).toThrow(
        DimensionMismatchError,
      );
    });
  });

  describe('vector arithmetic', () => {
    test('should add vectors correctly', async () => {
      const vectorA = new Float32Array([1, 2, 3]);
      const vectorB = new Float32Array([4, 5, 6]);

      const result = await VectorOperations.add(vectorA, vectorB);
      expect(result).toEqual(new Float32Array([5, 7, 9]));
    });

    test('should subtract vectors correctly', async () => {
      const vectorA = new Float32Array([4, 5, 6]);
      const vectorB = new Float32Array([1, 2, 3]);

      const result = await VectorOperations.subtract(vectorA, vectorB);
      expect(result).toEqual(new Float32Array([3, 3, 3]));
    });

    test('should scale vector correctly', async () => {
      const vector = new Float32Array([1, 2, 3]);

      const result = await VectorOperations.scale(vector, 2);
      expect(result).toEqual(new Float32Array([2, 4, 6]));
    });

    test('should handle negative scaling', async () => {
      const vector = new Float32Array([1, 2, 3]);

      const result = await VectorOperations.scale(vector, -1);
      expect(result).toEqual(new Float32Array([-1, -2, -3]));
    });
  });

  describe('statistical operations', () => {
    test('should calculate mean correctly', () => {
      const vectors = [
        new Float32Array([1, 2, 3]),
        new Float32Array([4, 5, 6]),
        new Float32Array([7, 8, 9]),
      ];

      const mean = VectorOperations.mean(vectors);
      expect(mean).toEqual(new Float32Array([4, 5, 6]));
    });

    test('should calculate variance correctly', () => {
      const vectors = [
        new Float32Array([1, 2]),
        new Float32Array([3, 4]),
        new Float32Array([5, 6]),
      ];

      const variance = VectorOperations.variance(vectors);
      expect(variance[0]).toBeCloseTo(2.667, 2);
      expect(variance[1]).toBeCloseTo(2.667, 2);
    });

    test('should calculate standard deviation correctly', () => {
      const vectors = [
        new Float32Array([1, 2]),
        new Float32Array([3, 4]),
        new Float32Array([5, 6]),
      ];

      const std = VectorOperations.standardDeviation(vectors);
      expect(std[0]).toBeCloseTo(1.633, 2);
      expect(std[1]).toBeCloseTo(1.633, 2);
    });

    test('should throw error for empty vector array', () => {
      expect(() => VectorOperations.mean([])).toThrow(
        'Cannot calculate mean of empty vector array',
      );
      expect(() => VectorOperations.variance([])).toThrow(
        'Cannot calculate variance of empty vector array',
      );
    });
  });

  describe('utility functions', () => {
    test('should check vector equality', () => {
      const vectorA = new Float32Array([1.0, 2.0, 3.0]);
      const vectorB = new Float32Array([1.0, 2.0, 3.0]);
      const vectorC = new Float32Array([1.0, 2.0, 3.1]);

      expect(VectorOperations.equals(vectorA, vectorB)).toBe(true);
      expect(VectorOperations.equals(vectorA, vectorC)).toBe(false);
    });

    test('should check equality with epsilon', () => {
      const vectorA = new Float32Array([1.0, 2.0]);
      const vectorB = new Float32Array([1.00001, 2.00001]);

      expect(VectorOperations.equals(vectorA, vectorB, 0.0001)).toBe(true);
      expect(VectorOperations.equals(vectorA, vectorB, 0.000001)).toBe(false);
    });

    test('should create random vector', () => {
      const vector = VectorOperations.random(100);

      expect(vector.length).toBe(100);
      expect(Math.min(...vector)).toBeGreaterThanOrEqual(-1);
      expect(Math.max(...vector)).toBeLessThanOrEqual(1);
    });

    test('should create random vector with custom range', () => {
      const vector = VectorOperations.random(50, 0, 10);

      expect(vector.length).toBe(50);
      expect(Math.min(...vector)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...vector)).toBeLessThanOrEqual(10);
    });

    test('should create random unit vector', () => {
      const vector = VectorOperations.randomUnit(100);

      expect(vector.length).toBe(100);
      expect(VectorOperations.magnitude(vector)).toBeCloseTo(1);
    });
  });

  describe('prepareForStorage', () => {
    test('should prepare vector for storage', async () => {
      const vector = [0.1, 0.2, 0.3];
      const prepared = await VectorOperations.prepareForStorage('test-id', vector, {
        label: 'test',
      });

      expect(prepared.id).toBe('test-id');
      expect(prepared.vector).toBeInstanceOf(Float32Array);
      expect(prepared.vector).toEqual(new Float32Array([0.1, 0.2, 0.3]));
      expect(prepared.metadata).toEqual({ label: 'test' });
      expect(prepared.magnitude).toBeCloseTo(0.374, 2);
      expect(prepared.normalized).toBe(false);
      expect(prepared.timestamp).toBeDefined();
    });

    test('should normalize if requested', async () => {
      const vector = new Float32Array([3, 4]);
      const prepared = await VectorOperations.prepareForStorage(
        'test-id',
        vector,
        undefined,
        { normalize: true },
      );

      expect(prepared.normalized).toBe(true);
      expect(prepared.magnitude).toBeCloseTo(1);
      expect(prepared.vector[0]).toBeCloseTo(0.6);
      expect(prepared.vector[1]).toBeCloseTo(0.8);
    });
  });
});
