import { describe, expect, it } from 'bun:test';

import { InvalidFormatError } from '@/core/errors.js';
import {
  DistanceCalculator,
  DistanceMetrics,
  OptimizedDistanceMetrics,
  createDistanceCalculator,
  listAvailableMetrics,
  registerCustomMetric,
} from '@/search/distance-metrics.js';

/**
 * Helper to build a Float32Array from plain numbers.
 */
function float32(...values: number[]): Float32Array {
  return new Float32Array(values);
}

/**
 * Normalize a vector in-place and return it, so cosine tests operate on unit vectors.
 */
function normalize(vector: Float32Array): Float32Array {
  let magnitude = 0;
  for (let i = 0; i < vector.length; i++) {
    magnitude += vector[i]! * vector[i]!;
  }
  magnitude = Math.sqrt(magnitude);
  if (magnitude > 0) {
    for (let i = 0; i < vector.length; i++) {
      vector[i] = vector[i]! / magnitude;
    }
  }
  return vector;
}

// ---------------------------------------------------------------------------
// DistanceMetrics singleton registry
// ---------------------------------------------------------------------------

describe('DistanceMetrics', () => {
  const registry = DistanceMetrics.getInstance();

  describe('getInstance', () => {
    it('should return the same instance on every call', () => {
      const first = DistanceMetrics.getInstance();
      const second = DistanceMetrics.getInstance();
      expect(first).toBe(second);
    });
  });

  describe('list', () => {
    it('should include all six default metrics', () => {
      const names = registry.list();
      expect(names).toContain('cosine');
      expect(names).toContain('euclidean');
      expect(names).toContain('manhattan');
      expect(names).toContain('hamming');
      expect(names).toContain('jaccard');
      expect(names).toContain('dot');
    });
  });

  describe('get', () => {
    it('should return a metric implementation for each default name', () => {
      for (const name of ['cosine', 'euclidean', 'manhattan', 'hamming', 'jaccard', 'dot']) {
        const metric = registry.get(name);
        expect(metric.name).toBe(name);
        expect(typeof metric.calculate).toBe('function');
      }
    });

    it('should throw InvalidFormatError for an unknown metric', () => {
      expect(() => registry.get('nonexistent')).toThrow(InvalidFormatError);
    });
  });

  describe('register', () => {
    it('should allow registering and retrieving a custom metric', () => {
      registry.register({
        name: '__test_custom',
        calculate: () => 42,
      });

      const metric = registry.get('__test_custom');
      expect(metric.name).toBe('__test_custom');
      expect(metric.calculate(float32(1), float32(2))).toBe(42);
    });
  });
});

// ---------------------------------------------------------------------------
// Default metric calculations
// ---------------------------------------------------------------------------

describe('Default metrics', () => {
  const registry = DistanceMetrics.getInstance();

  // -- Cosine -----------------------------------------------------------------

  describe('cosine', () => {
    const cosine = registry.get('cosine');

    it('should have requiresNormalized set to true', () => {
      expect(cosine.requiresNormalized).toBe(true);
    });

    it('should return 0 for identical normalized vectors', () => {
      const vector = normalize(float32(1, 2, 3));
      expect(cosine.calculate(vector, vector)).toBeCloseTo(0, 5);
    });

    it('should return approximately 2 for opposite normalized vectors', () => {
      const vectorA = normalize(float32(1, 0, 0));
      const vectorB = normalize(float32(-1, 0, 0));
      expect(cosine.calculate(vectorA, vectorB)).toBeCloseTo(2, 5);
    });

    it('should return 1 for orthogonal normalized vectors', () => {
      const vectorA = normalize(float32(1, 0));
      const vectorB = normalize(float32(0, 1));
      expect(cosine.calculate(vectorA, vectorB)).toBeCloseTo(1, 5);
    });

    it('should handle single-element vectors', () => {
      const vectorA = normalize(float32(5));
      const vectorB = normalize(float32(5));
      expect(cosine.calculate(vectorA, vectorB)).toBeCloseTo(0, 5);
    });

    it('should handle zero vectors (returns 1 since dotProduct is 0)', () => {
      const zero = float32(0, 0, 0);
      // dot product of two zero vectors is 0, so 1 - 0 = 1
      expect(cosine.calculate(zero, zero)).toBeCloseTo(1, 5);
    });
  });

  // -- Euclidean --------------------------------------------------------------

  describe('euclidean', () => {
    const euclidean = registry.get('euclidean');

    it('should return 0 for identical vectors', () => {
      const vector = float32(1, 2, 3);
      expect(euclidean.calculate(vector, vector)).toBe(0);
    });

    it('should compute L2 distance correctly', () => {
      const vectorA = float32(0, 0);
      const vectorB = float32(3, 4);
      expect(euclidean.calculate(vectorA, vectorB)).toBeCloseTo(5, 5);
    });

    it('should handle single-element vectors', () => {
      expect(euclidean.calculate(float32(7), float32(3))).toBeCloseTo(4, 5);
    });

    it('should return 0 for two zero vectors', () => {
      expect(euclidean.calculate(float32(0, 0), float32(0, 0))).toBe(0);
    });

    it('should handle negative values', () => {
      const vectorA = float32(-1, -2);
      const vectorB = float32(1, 2);
      // sqrt((2)^2 + (4)^2) = sqrt(4+16) = sqrt(20)
      expect(euclidean.calculate(vectorA, vectorB)).toBeCloseTo(Math.sqrt(20), 5);
    });
  });

  // -- Manhattan --------------------------------------------------------------

  describe('manhattan', () => {
    const manhattan = registry.get('manhattan');

    it('should return 0 for identical vectors', () => {
      const vector = float32(1, 2, 3);
      expect(manhattan.calculate(vector, vector)).toBe(0);
    });

    it('should compute L1 distance correctly', () => {
      const vectorA = float32(0, 0);
      const vectorB = float32(3, 4);
      expect(manhattan.calculate(vectorA, vectorB)).toBeCloseTo(7, 5);
    });

    it('should handle negative differences', () => {
      const vectorA = float32(-1, -2);
      const vectorB = float32(1, 2);
      // |(-1)-1| + |(-2)-2| = 2 + 4 = 6
      expect(manhattan.calculate(vectorA, vectorB)).toBeCloseTo(6, 5);
    });

    it('should handle single-element vectors', () => {
      expect(manhattan.calculate(float32(10), float32(3))).toBeCloseTo(7, 5);
    });
  });

  // -- Hamming ----------------------------------------------------------------

  describe('hamming', () => {
    const hamming = registry.get('hamming');

    it('should have supportsFormat set to binary', () => {
      expect(hamming.supportsFormat).toBe('binary');
    });

    it('should return 0 for identical binary vectors', () => {
      const vector = float32(1, 0, 1, 1);
      expect(hamming.calculate(vector, vector)).toBe(0);
    });

    it('should count differing positions', () => {
      const vectorA = float32(1, 0, 1, 0);
      const vectorB = float32(0, 0, 1, 1);
      // positions 0 and 3 differ
      expect(hamming.calculate(vectorA, vectorB)).toBe(2);
    });

    it('should treat any value > 0 as 1', () => {
      const vectorA = float32(5, 0, 0.1, 0);
      const vectorB = float32(1, 0, 1, 0);
      // both map to [1,0,1,0] so distance = 0
      expect(hamming.calculate(vectorA, vectorB)).toBe(0);
    });

    it('should treat negative values as 0 (not > 0)', () => {
      const vectorA = float32(-1, 0);
      const vectorB = float32(0, 0);
      // -1 > 0 is false, so both treated as [0, 0], distance = 0
      expect(hamming.calculate(vectorA, vectorB)).toBe(0);
    });

    it('should handle all-different vectors', () => {
      const vectorA = float32(1, 1, 1, 1);
      const vectorB = float32(0, 0, 0, 0);
      expect(hamming.calculate(vectorA, vectorB)).toBe(4);
    });

    it('should handle single-element vectors', () => {
      expect(hamming.calculate(float32(1), float32(0))).toBe(1);
      expect(hamming.calculate(float32(1), float32(1))).toBe(0);
    });
  });

  // -- Jaccard ----------------------------------------------------------------

  describe('jaccard', () => {
    const jaccard = registry.get('jaccard');

    it('should have supportsFormat set to sparse', () => {
      expect(jaccard.supportsFormat).toBe('sparse');
    });

    it('should return 0 for identical nonzero vectors', () => {
      const vector = float32(1, 0, 1, 1);
      expect(jaccard.calculate(vector, vector)).toBeCloseTo(0, 5);
    });

    it('should return 0 for two zero vectors', () => {
      const zero = float32(0, 0, 0);
      expect(jaccard.calculate(zero, zero)).toBe(0);
    });

    it('should return 1 when vectors share no active positions', () => {
      const vectorA = float32(1, 0, 0);
      const vectorB = float32(0, 0, 1);
      // intersection=0, union=2, 1 - 0/2 = 1
      expect(jaccard.calculate(vectorA, vectorB)).toBeCloseTo(1, 5);
    });

    it('should compute partial overlap correctly', () => {
      const vectorA = float32(1, 1, 0, 0);
      const vectorB = float32(0, 1, 1, 0);
      // active: A={0,1}, B={1,2}, intersection={1}, union={0,1,2}
      // 1 - 1/3 = 0.6667
      expect(jaccard.calculate(vectorA, vectorB)).toBeCloseTo(1 - 1 / 3, 5);
    });

    it('should treat values > 0 as 1 for set membership', () => {
      const vectorA = float32(0.001, 100, 0);
      const vectorB = float32(1, 1, 0);
      // Both reduce to [1,1,0] so distance = 0
      expect(jaccard.calculate(vectorA, vectorB)).toBeCloseTo(0, 5);
    });
  });

  // -- Dot product ------------------------------------------------------------

  describe('dot', () => {
    const dot = registry.get('dot');

    it('should return negative of the dot product', () => {
      const vectorA = float32(1, 2, 3);
      const vectorB = float32(4, 5, 6);
      // dot product = 1*4 + 2*5 + 3*6 = 32
      expect(dot.calculate(vectorA, vectorB)).toBeCloseTo(-32, 5);
    });

    it('should return 0 for orthogonal vectors', () => {
      const vectorA = float32(1, 0);
      const vectorB = float32(0, 1);
      expect(dot.calculate(vectorA, vectorB)).toBeCloseTo(0, 5);
    });

    it('should return -0 for zero vectors (negation of zero dot product)', () => {
      const zero = float32(0, 0, 0);
      // -0 === 0 in JavaScript, but Object.is distinguishes them.
      // The dot metric negates the dot product, so 0 becomes -0.
      expect(dot.calculate(zero, zero)).toBeCloseTo(0, 5);
      expect(Object.is(dot.calculate(zero, zero), -0)).toBe(true);
    });

    it('should return a positive value for opposite vectors (lower is better)', () => {
      const vectorA = float32(1, 0);
      const vectorB = float32(-1, 0);
      // dot product = -1, negated = 1
      expect(dot.calculate(vectorA, vectorB)).toBeCloseTo(1, 5);
    });

    it('should handle single-element vectors', () => {
      expect(dot.calculate(float32(3), float32(7))).toBeCloseTo(-21, 5);
    });
  });
});

// ---------------------------------------------------------------------------
// OptimizedDistanceMetrics
// ---------------------------------------------------------------------------

describe('OptimizedDistanceMetrics', () => {
  describe('euclideanOptimized', () => {
    it('should produce the same result as the default euclidean metric', () => {
      const vectorA = float32(1, 2, 3, 4, 5);
      const vectorB = float32(5, 4, 3, 2, 1);

      const defaultMetric = DistanceMetrics.getInstance().get('euclidean');
      const expected = defaultMetric.calculate(vectorA, vectorB);

      expect(OptimizedDistanceMetrics.euclideanOptimized(vectorA, vectorB)).toBeCloseTo(
        expected,
        5,
      );
    });

    it('should handle vectors whose length is exactly divisible by 4', () => {
      const vectorA = float32(1, 2, 3, 4, 5, 6, 7, 8);
      const vectorB = float32(8, 7, 6, 5, 4, 3, 2, 1);

      let sum = 0;
      for (let i = 0; i < vectorA.length; i++) {
        const diff = vectorA[i]! - vectorB[i]!;
        sum += diff * diff;
      }
      const expected = Math.sqrt(sum);

      expect(OptimizedDistanceMetrics.euclideanOptimized(vectorA, vectorB)).toBeCloseTo(
        expected,
        5,
      );
    });

    it('should handle vectors whose length is not divisible by 4 (remainder path)', () => {
      // length = 5 (1 remainder element after processing 4)
      const vectorA = float32(1, 2, 3, 4, 5);
      const vectorB = float32(6, 7, 8, 9, 10);

      let sum = 0;
      for (let i = 0; i < vectorA.length; i++) {
        const diff = vectorA[i]! - vectorB[i]!;
        sum += diff * diff;
      }
      const expected = Math.sqrt(sum);

      expect(OptimizedDistanceMetrics.euclideanOptimized(vectorA, vectorB)).toBeCloseTo(
        expected,
        5,
      );
    });

    it('should handle vectors with length 1 (no unrolled iterations)', () => {
      expect(OptimizedDistanceMetrics.euclideanOptimized(float32(3), float32(7))).toBeCloseTo(
        4,
        5,
      );
    });

    it('should handle vectors with length 2', () => {
      const result = OptimizedDistanceMetrics.euclideanOptimized(float32(0, 0), float32(3, 4));
      expect(result).toBeCloseTo(5, 5);
    });

    it('should handle vectors with length 3', () => {
      const result = OptimizedDistanceMetrics.euclideanOptimized(
        float32(0, 0, 0),
        float32(1, 2, 2),
      );
      expect(result).toBeCloseTo(3, 5);
    });

    it('should return 0 for identical vectors', () => {
      const vector = float32(1, 2, 3, 4, 5, 6, 7, 8, 9);
      expect(OptimizedDistanceMetrics.euclideanOptimized(vector, vector)).toBe(0);
    });

    it('should handle a large vector (verifying loop unrolling correctness)', () => {
      const size = 1025; // not divisible by 4
      const vectorA = new Float32Array(size);
      const vectorB = new Float32Array(size);
      for (let i = 0; i < size; i++) {
        vectorA[i] = i * 0.01;
        vectorB[i] = (size - i) * 0.01;
      }

      const defaultMetric = DistanceMetrics.getInstance().get('euclidean');
      const expected = defaultMetric.calculate(vectorA, vectorB);

      expect(OptimizedDistanceMetrics.euclideanOptimized(vectorA, vectorB)).toBeCloseTo(
        expected,
        2,
      );
    });
  });

  describe('cosineOptimized', () => {
    it('should produce the same result as the default cosine metric', () => {
      const vectorA = normalize(float32(1, 2, 3, 4, 5));
      const vectorB = normalize(float32(5, 4, 3, 2, 1));

      const defaultMetric = DistanceMetrics.getInstance().get('cosine');
      const expected = defaultMetric.calculate(vectorA, vectorB);

      expect(OptimizedDistanceMetrics.cosineOptimized(vectorA, vectorB)).toBeCloseTo(expected, 5);
    });

    it('should return 0 for identical normalized vectors', () => {
      const vector = normalize(float32(1, 2, 3, 4));
      expect(OptimizedDistanceMetrics.cosineOptimized(vector, vector)).toBeCloseTo(0, 5);
    });

    it('should handle vectors whose length is not divisible by 4', () => {
      const vectorA = normalize(float32(1, 0, 0, 0, 1));
      const vectorB = normalize(float32(0, 1, 0, 1, 0));

      const defaultMetric = DistanceMetrics.getInstance().get('cosine');
      const expected = defaultMetric.calculate(vectorA, vectorB);

      expect(OptimizedDistanceMetrics.cosineOptimized(vectorA, vectorB)).toBeCloseTo(expected, 5);
    });

    it('should handle single-element normalized vectors', () => {
      const vector = normalize(float32(1));
      expect(OptimizedDistanceMetrics.cosineOptimized(vector, vector)).toBeCloseTo(0, 5);
    });

    it('should handle a large vector (verifying loop unrolling correctness)', () => {
      const size = 1023; // not divisible by 4
      const vectorA = new Float32Array(size);
      const vectorB = new Float32Array(size);
      for (let i = 0; i < size; i++) {
        vectorA[i] = Math.sin(i);
        vectorB[i] = Math.cos(i);
      }
      normalize(vectorA);
      normalize(vectorB);

      const defaultMetric = DistanceMetrics.getInstance().get('cosine');
      const expected = defaultMetric.calculate(vectorA, vectorB);

      expect(OptimizedDistanceMetrics.cosineOptimized(vectorA, vectorB)).toBeCloseTo(expected, 3);
    });
  });
});

// ---------------------------------------------------------------------------
// DistanceCalculator
// ---------------------------------------------------------------------------

describe('DistanceCalculator', () => {
  describe('constructor', () => {
    it('should throw InvalidFormatError for an unknown metric name', () => {
      expect(() => new DistanceCalculator('does_not_exist')).toThrow(InvalidFormatError);
    });

    it('should accept all default metric names without error', () => {
      for (const name of ['cosine', 'euclidean', 'manhattan', 'hamming', 'jaccard', 'dot']) {
        expect(() => new DistanceCalculator(name)).not.toThrow();
      }
    });
  });

  describe('calculate', () => {
    it('should throw on dimension mismatch', () => {
      const calculator = new DistanceCalculator('euclidean');
      expect(() => calculator.calculate(float32(1, 2), float32(1, 2, 3))).toThrow(
        /dimension mismatch/i,
      );
    });

    it('should use the optimized path for euclidean by default', () => {
      const calculator = new DistanceCalculator('euclidean');
      const vectorA = float32(0, 0);
      const vectorB = float32(3, 4);
      // Whether optimized or not, the result should be correct
      expect(calculator.calculate(vectorA, vectorB)).toBeCloseTo(5, 5);
    });

    it('should use the optimized path for cosine by default', () => {
      const calculator = new DistanceCalculator('cosine');
      const vectorA = normalize(float32(1, 0));
      const vectorB = normalize(float32(0, 1));
      expect(calculator.calculate(vectorA, vectorB)).toBeCloseTo(1, 5);
    });

    it('should use the non-optimized path when optimize is false', () => {
      const calculator = new DistanceCalculator('euclidean', { optimize: false });
      const vectorA = float32(0, 0);
      const vectorB = float32(3, 4);
      expect(calculator.calculate(vectorA, vectorB)).toBeCloseTo(5, 5);
    });

    it('should fall through to default calculate for non-optimized metrics', () => {
      const calculator = new DistanceCalculator('manhattan');
      expect(calculator.calculate(float32(1, 2), float32(4, 6))).toBeCloseTo(7, 5);
    });

    it('should handle empty vectors (length 0)', () => {
      const calculator = new DistanceCalculator('euclidean');
      const empty = new Float32Array(0);
      expect(calculator.calculate(empty, empty)).toBe(0);
    });
  });

  describe('calculateBatch', () => {
    it('should return distances from the query to each vector', () => {
      const calculator = new DistanceCalculator('euclidean');
      const query = float32(0, 0);
      const vectors = [float32(3, 4), float32(1, 0), float32(0, 5)];

      const distances = calculator.calculateBatch(query, vectors);

      expect(distances).toHaveLength(3);
      expect(distances[0]).toBeCloseTo(5, 5);
      expect(distances[1]).toBeCloseTo(1, 5);
      expect(distances[2]).toBeCloseTo(5, 5);
    });

    it('should return an empty array for an empty vector set', () => {
      const calculator = new DistanceCalculator('euclidean');
      const query = float32(0, 0);
      expect(calculator.calculateBatch(query, [])).toEqual([]);
    });

    it('should handle a single vector in the batch', () => {
      const calculator = new DistanceCalculator('manhattan');
      const query = float32(1, 1);
      const distances = calculator.calculateBatch(query, [float32(4, 5)]);
      expect(distances).toHaveLength(1);
      expect(distances[0]).toBeCloseTo(7, 5);
    });

    it('should use the chunked path when parallel is true and vectors exceed 1000', () => {
      const calculator = new DistanceCalculator('euclidean');
      const query = float32(0, 0);
      const vectors: Float32Array[] = [];
      for (let i = 0; i < 1001; i++) {
        vectors.push(float32(1, 0));
      }

      const distances = calculator.calculateBatch(query, vectors, { parallel: true });
      expect(distances).toHaveLength(1001);
      for (const distance of distances) {
        expect(distance).toBeCloseTo(1, 5);
      }
    });

    it('should not use the chunked path when parallel is true but vectors are <= 1000', () => {
      const calculator = new DistanceCalculator('euclidean');
      const query = float32(0, 0);
      const vectors = [float32(3, 4), float32(1, 0)];

      const distances = calculator.calculateBatch(query, vectors, { parallel: true });
      expect(distances).toHaveLength(2);
      expect(distances[0]).toBeCloseTo(5, 5);
      expect(distances[1]).toBeCloseTo(1, 5);
    });
  });

  describe('findNearest', () => {
    const vectors = [
      { id: 'close', vector: float32(1, 0) },
      { id: 'far', vector: float32(10, 10) },
      { id: 'medium', vector: float32(3, 4) },
    ];

    it('should return the k nearest neighbors sorted by distance', () => {
      const calculator = new DistanceCalculator('euclidean');
      const query = float32(0, 0);

      const nearest = calculator.findNearest(query, vectors, 2);

      expect(nearest).toHaveLength(2);
      expect(nearest[0]!.id).toBe('close');
      expect(nearest[1]!.id).toBe('medium');
    });

    it('should return all vectors when k exceeds the vector set size', () => {
      const calculator = new DistanceCalculator('euclidean');
      const query = float32(0, 0);

      const nearest = calculator.findNearest(query, vectors, 100);

      expect(nearest).toHaveLength(3);
      // Should still be sorted by distance
      expect(nearest[0]!.id).toBe('close');
      expect(nearest[1]!.id).toBe('medium');
      expect(nearest[2]!.id).toBe('far');
    });

    it('should return an empty array when given no vectors', () => {
      const calculator = new DistanceCalculator('euclidean');
      const result = calculator.findNearest(float32(0, 0), [], 5);
      expect(result).toEqual([]);
    });

    it('should return results with correct distance values', () => {
      const calculator = new DistanceCalculator('euclidean');
      const query = float32(0, 0);

      const nearest = calculator.findNearest(query, vectors, 3);

      expect(nearest[0]!.distance).toBeCloseTo(1, 5);
      expect(nearest[1]!.distance).toBeCloseTo(5, 5);
      expect(nearest[2]!.distance).toBeCloseTo(Math.sqrt(200), 5);
    });

    it('should work with different distance metrics', () => {
      const calculator = new DistanceCalculator('manhattan');
      const query = float32(0, 0);

      const nearest = calculator.findNearest(query, vectors, 2);

      expect(nearest).toHaveLength(2);
      expect(nearest[0]!.id).toBe('close');
      expect(nearest[0]!.distance).toBeCloseTo(1, 5);
      expect(nearest[1]!.id).toBe('medium');
      expect(nearest[1]!.distance).toBeCloseTo(7, 5);
    });

    it('should return exactly k results when k equals vector set size', () => {
      const calculator = new DistanceCalculator('euclidean');
      const query = float32(0, 0);

      const nearest = calculator.findNearest(query, vectors, 3);
      expect(nearest).toHaveLength(3);
    });
  });

  describe('getMetricInfo', () => {
    it('should return name and requiresNormalized for cosine', () => {
      const calculator = new DistanceCalculator('cosine');
      const info = calculator.getMetricInfo();
      expect(info.name).toBe('cosine');
      expect(info.requiresNormalized).toBe(true);
    });

    it('should return only name when requiresNormalized is not defined', () => {
      const calculator = new DistanceCalculator('euclidean');
      const info = calculator.getMetricInfo();
      expect(info.name).toBe('euclidean');
      expect(info).not.toHaveProperty('requiresNormalized');
    });

    it('should include requiresNormalized: false when explicitly set', () => {
      registerCustomMetric({
        name: '__test_info_metric',
        requiresNormalized: false,
        calculate: () => 0,
      });
      const calculator = new DistanceCalculator('__test_info_metric');
      const info = calculator.getMetricInfo();
      expect(info.requiresNormalized).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// Convenience functions
// ---------------------------------------------------------------------------

describe('createDistanceCalculator', () => {
  it('should return a DistanceCalculator instance', () => {
    const calculator = createDistanceCalculator('euclidean');
    expect(calculator).toBeInstanceOf(DistanceCalculator);
  });

  it('should forward options to the constructor', () => {
    const calculator = createDistanceCalculator('cosine', { optimize: false });
    const vectorA = normalize(float32(1, 0));
    const vectorB = normalize(float32(0, 1));
    // Should work regardless of optimization flag
    expect(calculator.calculate(vectorA, vectorB)).toBeCloseTo(1, 5);
  });

  it('should throw for unknown metric names', () => {
    expect(() => createDistanceCalculator('bogus')).toThrow(InvalidFormatError);
  });
});

describe('registerCustomMetric', () => {
  it('should register a metric accessible from the singleton', () => {
    registerCustomMetric({
      name: '__convenience_custom',
      calculate(vectorA, vectorB) {
        // Always returns the sum of first elements
        return (vectorA[0] ?? 0) + (vectorB[0] ?? 0);
      },
    });

    const metric = DistanceMetrics.getInstance().get('__convenience_custom');
    expect(metric.calculate(float32(2), float32(3))).toBeCloseTo(5, 5);
  });

  it('should allow overwriting an existing metric', () => {
    registerCustomMetric({
      name: '__overwrite_target',
      calculate: () => 1,
    });
    expect(DistanceMetrics.getInstance().get('__overwrite_target').calculate(float32(), float32())).toBe(1);

    registerCustomMetric({
      name: '__overwrite_target',
      calculate: () => 2,
    });
    expect(DistanceMetrics.getInstance().get('__overwrite_target').calculate(float32(), float32())).toBe(2);
  });
});

describe('listAvailableMetrics', () => {
  it('should return the same list as the singleton', () => {
    const fromFunction = listAvailableMetrics();
    const fromSingleton = DistanceMetrics.getInstance().list();
    expect(fromFunction).toEqual(fromSingleton);
  });

  it('should include custom metrics that were registered', () => {
    registerCustomMetric({
      name: '__list_test_metric',
      calculate: () => 0,
    });
    expect(listAvailableMetrics()).toContain('__list_test_metric');
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('Edge cases', () => {
  describe('NaN values in vectors', () => {
    it('should propagate NaN through euclidean distance', () => {
      const calculator = new DistanceCalculator('euclidean');
      const vectorA = float32(1, NaN, 3);
      const vectorB = float32(4, 5, 6);
      expect(calculator.calculate(vectorA, vectorB)).toBeNaN();
    });

    it('should propagate NaN through cosine distance', () => {
      const calculator = new DistanceCalculator('cosine');
      const vectorA = float32(NaN, 1);
      const vectorB = float32(1, 0);
      expect(calculator.calculate(vectorA, vectorB)).toBeNaN();
    });

    it('should propagate NaN through manhattan distance', () => {
      const calculator = new DistanceCalculator('manhattan');
      const vectorA = float32(1, NaN);
      const vectorB = float32(1, 1);
      expect(calculator.calculate(vectorA, vectorB)).toBeNaN();
    });

    it('should propagate NaN through dot product', () => {
      const calculator = new DistanceCalculator('dot');
      expect(calculator.calculate(float32(NaN), float32(1))).toBeNaN();
    });
  });

  describe('Infinity values in vectors', () => {
    it('should handle Infinity in euclidean distance', () => {
      const calculator = new DistanceCalculator('euclidean');
      const result = calculator.calculate(float32(Infinity, 0), float32(0, 0));
      expect(result).toBe(Infinity);
    });
  });

  describe('very large vectors with the optimized path', () => {
    it('should match non-optimized euclidean for a 4097-element vector', () => {
      const size = 4097;
      const vectorA = new Float32Array(size);
      const vectorB = new Float32Array(size);
      for (let i = 0; i < size; i++) {
        vectorA[i] = i % 7;
        vectorB[i] = i % 11;
      }

      const optimized = new DistanceCalculator('euclidean', { optimize: true });
      const baseline = new DistanceCalculator('euclidean', { optimize: false });

      expect(optimized.calculate(vectorA, vectorB)).toBeCloseTo(
        baseline.calculate(vectorA, vectorB),
        2,
      );
    });

    it('should match non-optimized cosine for a 4097-element vector', () => {
      const size = 4097;
      const vectorA = new Float32Array(size);
      const vectorB = new Float32Array(size);
      for (let i = 0; i < size; i++) {
        vectorA[i] = Math.sin(i * 0.1);
        vectorB[i] = Math.cos(i * 0.1);
      }
      normalize(vectorA);
      normalize(vectorB);

      const optimized = new DistanceCalculator('cosine', { optimize: true });
      const baseline = new DistanceCalculator('cosine', { optimize: false });

      expect(optimized.calculate(vectorA, vectorB)).toBeCloseTo(
        baseline.calculate(vectorA, vectorB),
        2,
      );
    });
  });

  describe('symmetry of distance calculations', () => {
    it('should produce symmetric results for euclidean', () => {
      const calculator = new DistanceCalculator('euclidean');
      const vectorA = float32(1, 2, 3);
      const vectorB = float32(4, 5, 6);
      expect(calculator.calculate(vectorA, vectorB)).toBe(calculator.calculate(vectorB, vectorA));
    });

    it('should produce symmetric results for cosine', () => {
      const calculator = new DistanceCalculator('cosine');
      const vectorA = normalize(float32(1, 2, 3));
      const vectorB = normalize(float32(4, 5, 6));
      expect(calculator.calculate(vectorA, vectorB)).toBeCloseTo(
        calculator.calculate(vectorB, vectorA),
        10,
      );
    });

    it('should produce symmetric results for manhattan', () => {
      const calculator = new DistanceCalculator('manhattan');
      const vectorA = float32(1, 2, 3);
      const vectorB = float32(4, 5, 6);
      expect(calculator.calculate(vectorA, vectorB)).toBe(calculator.calculate(vectorB, vectorA));
    });

    it('should produce symmetric results for hamming', () => {
      const calculator = new DistanceCalculator('hamming');
      const vectorA = float32(1, 0, 1);
      const vectorB = float32(0, 1, 1);
      expect(calculator.calculate(vectorA, vectorB)).toBe(calculator.calculate(vectorB, vectorA));
    });

    it('should produce symmetric results for jaccard', () => {
      const calculator = new DistanceCalculator('jaccard');
      const vectorA = float32(1, 0, 1);
      const vectorB = float32(0, 1, 1);
      expect(calculator.calculate(vectorA, vectorB)).toBe(calculator.calculate(vectorB, vectorA));
    });
  });

  describe('triangle inequality for true distance metrics', () => {
    it('should satisfy triangle inequality for euclidean', () => {
      const calculator = new DistanceCalculator('euclidean');
      const a = float32(0, 0);
      const b = float32(3, 0);
      const c = float32(3, 4);

      const ab = calculator.calculate(a, b);
      const bc = calculator.calculate(b, c);
      const ac = calculator.calculate(a, c);

      expect(ac).toBeLessThanOrEqual(ab + bc + 1e-6);
    });

    it('should satisfy triangle inequality for manhattan', () => {
      const calculator = new DistanceCalculator('manhattan');
      const a = float32(0, 0);
      const b = float32(3, 0);
      const c = float32(3, 4);

      const ab = calculator.calculate(a, b);
      const bc = calculator.calculate(b, c);
      const ac = calculator.calculate(a, c);

      expect(ac).toBeLessThanOrEqual(ab + bc + 1e-6);
    });
  });
});
