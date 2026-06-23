/**
 * Property-based and edge-case tests for distance metrics across all supported
 * vector formats: Float32Array, Float64Array, Int8Array, Uint8Array, and
 * regular number arrays.
 *
 * Each test uses deterministic seeded pseudo-random data so failures reproduce.
 * Results from the library are compared against simple reference implementations.
 */

import { describe, expect, it } from 'bun:test';

import {
  DistanceMetrics,
  OptimizedDistanceMetrics,
  createDistanceCalculator,
} from '@/search/distance-metrics.js';
import { VectorFormatHandler } from '@/vectors/formats.js';

// ---------------------------------------------------------------------------
// Deterministic PRNG — mulberry32, seeded
// ---------------------------------------------------------------------------

function createPrng(seed: number): () => number {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) >>> 0;
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}

// ---------------------------------------------------------------------------
// Vector generators for all supported formats
// ---------------------------------------------------------------------------

function randomFloat32(rng: () => number, dim: number): Float32Array {
  return new Float32Array(Array.from({ length: dim }, () => rng() * 2 - 1));
}

function randomFloat64(rng: () => number, dim: number): Float64Array {
  return new Float64Array(Array.from({ length: dim }, () => rng() * 2 - 1));
}

function randomInt8(rng: () => number, dim: number): Int8Array {
  return new Int8Array(
    Array.from({ length: dim }, () => Math.round((rng() * 2 - 1) * 127)),
  );
}

function randomUint8(rng: () => number, dim: number): Uint8Array {
  return new Uint8Array(Array.from({ length: dim }, () => Math.round(rng() * 255)));
}

function randomArray(rng: () => number, dim: number): number[] {
  return Array.from({ length: dim }, () => rng() * 2 - 1);
}

function randomBinaryFloat32(rng: () => number, dim: number): Float32Array {
  return new Float32Array(Array.from({ length: dim }, () => (rng() > 0.5 ? 1 : 0)));
}

/**
 * Normalize a Float32Array in place; used to satisfy the cosine metric's
 * requiresNormalized contract.
 */
function normalizeInPlace(v: Float32Array): Float32Array {
  let mag = 0;
  for (let i = 0; i < v.length; i++) mag += v[i]! * v[i]!;
  mag = Math.sqrt(mag);
  if (mag > 0) for (let i = 0; i < v.length; i++) v[i] = v[i]! / mag;
  return v;
}

// ---------------------------------------------------------------------------
// Reference implementations
// ---------------------------------------------------------------------------

function refEuclidean(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i]! - b[i]!;
    sum += d * d;
  }
  return Math.sqrt(sum);
}

function refManhattan(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i]! - b[i]!);
  return sum;
}

function refCosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i]! * b[i]!;
  return 1 - dot;
}

function refHamming(a: Float32Array, b: Float32Array): number {
  let count = 0;
  for (let i = 0; i < a.length; i++) {
    const ba = a[i]! > 0 ? 1 : 0;
    const bb = b[i]! > 0 ? 1 : 0;
    if (ba !== bb) count++;
  }
  return count;
}

function refJaccard(a: Float32Array, b: Float32Array): number {
  let intersection = 0;
  let union = 0;
  for (let i = 0; i < a.length; i++) {
    const ia = a[i]! > 0 ? 1 : 0;
    const ib = b[i]! > 0 ? 1 : 0;
    if (ia || ib) {
      union++;
      if (ia && ib) intersection++;
    }
  }
  return union === 0 ? 0 : 1 - intersection / union;
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/** Convert any supported format to Float32Array via VectorFormatHandler. */
function toFloat32(
  v: Float32Array | Float64Array | Int8Array | Uint8Array | number[],
): Float32Array {
  return VectorFormatHandler.toFloat32Array(v);
}

// ---------------------------------------------------------------------------
// Property: euclidean matches reference across all formats
// ---------------------------------------------------------------------------

describe('property: euclidean matches reference across vector formats', () => {
  const rng = createPrng(0xf001cafe);
  const calculator = createDistanceCalculator('euclidean');
  const TRIALS = 10;
  const DIM = 8;

  it('Float32Array — random pairs', () => {
    for (let t = 0; t < TRIALS; t++) {
      const a = randomFloat32(rng, DIM);
      const b = randomFloat32(rng, DIM);
      expect(calculator.calculate(a, b)).toBeCloseTo(refEuclidean(a, b), 4);
    }
  });

  it('Float64Array — converted to Float32 before metric', () => {
    for (let t = 0; t < TRIALS; t++) {
      const a64 = randomFloat64(rng, DIM);
      const b64 = randomFloat64(rng, DIM);
      const a = toFloat32(a64);
      const b = toFloat32(b64);
      expect(calculator.calculate(a, b)).toBeCloseTo(refEuclidean(a, b), 4);
    }
  });

  it('Int8Array — converted to Float32 before metric', () => {
    for (let t = 0; t < TRIALS; t++) {
      const a8 = randomInt8(rng, DIM);
      const b8 = randomInt8(rng, DIM);
      const a = toFloat32(a8);
      const b = toFloat32(b8);
      expect(calculator.calculate(a, b)).toBeCloseTo(refEuclidean(a, b), 4);
    }
  });

  it('Uint8Array — converted to Float32 before metric', () => {
    for (let t = 0; t < TRIALS; t++) {
      const au = randomUint8(rng, DIM);
      const bu = randomUint8(rng, DIM);
      const a = toFloat32(au);
      const b = toFloat32(bu);
      expect(calculator.calculate(a, b)).toBeCloseTo(refEuclidean(a, b), 4);
    }
  });

  it('number[] — converted to Float32 before metric', () => {
    for (let t = 0; t < TRIALS; t++) {
      const aArr = randomArray(rng, DIM);
      const bArr = randomArray(rng, DIM);
      const a = toFloat32(aArr);
      const b = toFloat32(bArr);
      expect(calculator.calculate(a, b)).toBeCloseTo(refEuclidean(a, b), 4);
    }
  });
});

// ---------------------------------------------------------------------------
// Property: manhattan matches reference across all formats
// ---------------------------------------------------------------------------

describe('property: manhattan matches reference across vector formats', () => {
  const rng = createPrng(0xb0b01234);
  const calculator = createDistanceCalculator('manhattan');
  const TRIALS = 10;
  const DIM = 8;

  it('Float32Array — random pairs', () => {
    for (let t = 0; t < TRIALS; t++) {
      const a = randomFloat32(rng, DIM);
      const b = randomFloat32(rng, DIM);
      expect(calculator.calculate(a, b)).toBeCloseTo(refManhattan(a, b), 4);
    }
  });

  it('Int8Array — converted to Float32 before metric', () => {
    for (let t = 0; t < TRIALS; t++) {
      const a = toFloat32(randomInt8(rng, DIM));
      const b = toFloat32(randomInt8(rng, DIM));
      expect(calculator.calculate(a, b)).toBeCloseTo(refManhattan(a, b), 4);
    }
  });

  it('Uint8Array — converted to Float32 before metric', () => {
    for (let t = 0; t < TRIALS; t++) {
      const a = toFloat32(randomUint8(rng, DIM));
      const b = toFloat32(randomUint8(rng, DIM));
      expect(calculator.calculate(a, b)).toBeCloseTo(refManhattan(a, b), 4);
    }
  });
});

// ---------------------------------------------------------------------------
// Property: cosine matches reference for normalized float32 vectors
// ---------------------------------------------------------------------------

describe('property: cosine matches reference for normalized Float32Array', () => {
  const rng = createPrng(0x5a5a5a5a);
  const calculator = createDistanceCalculator('cosine');
  const TRIALS = 15;

  it('random normalized pairs (dim 8)', () => {
    for (let t = 0; t < TRIALS; t++) {
      const a = normalizeInPlace(randomFloat32(rng, 8));
      const b = normalizeInPlace(randomFloat32(rng, 8));
      expect(calculator.calculate(a, b)).toBeCloseTo(refCosine(a, b), 4);
    }
  });

  it('cosine distance is in [0, 2] for normalized vectors', () => {
    for (let t = 0; t < TRIALS; t++) {
      const a = normalizeInPlace(randomFloat32(rng, 8));
      const b = normalizeInPlace(randomFloat32(rng, 8));
      const d = calculator.calculate(a, b);
      expect(d).toBeGreaterThanOrEqual(-1e-5);
      expect(d).toBeLessThanOrEqual(2 + 1e-5);
    }
  });

  it('identical normalized vectors have distance ≈ 0', () => {
    for (let t = 0; t < 10; t++) {
      const v = normalizeInPlace(randomFloat32(rng, 8));
      expect(calculator.calculate(v, v)).toBeCloseTo(0, 4);
    }
  });

  it('optimized cosine matches naive cosine', () => {
    for (let t = 0; t < TRIALS; t++) {
      const a = normalizeInPlace(randomFloat32(rng, 12));
      const b = normalizeInPlace(randomFloat32(rng, 12));
      const naive = refCosine(a, b);
      const optimized = OptimizedDistanceMetrics.cosineOptimized(a, b);
      expect(optimized).toBeCloseTo(naive, 4);
    }
  });
});

// ---------------------------------------------------------------------------
// Property: hamming matches reference on binary float32 vectors
// ---------------------------------------------------------------------------

describe('property: hamming matches reference on binary Float32Array', () => {
  const rng = createPrng(0xd00dfeed);
  const calculator = createDistanceCalculator('hamming');
  const TRIALS = 15;
  const DIM = 16;

  it('random binary vectors', () => {
    for (let t = 0; t < TRIALS; t++) {
      const a = randomBinaryFloat32(rng, DIM);
      const b = randomBinaryFloat32(rng, DIM);
      expect(calculator.calculate(a, b)).toBe(refHamming(a, b));
    }
  });

  it('hamming distance is in [0, dim]', () => {
    for (let t = 0; t < TRIALS; t++) {
      const a = randomBinaryFloat32(rng, DIM);
      const b = randomBinaryFloat32(rng, DIM);
      const d = calculator.calculate(a, b);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(DIM);
    }
  });

  it('identical vectors have distance 0', () => {
    for (let t = 0; t < 10; t++) {
      const v = randomBinaryFloat32(rng, DIM);
      expect(calculator.calculate(v, v)).toBe(0);
    }
  });

  it('symmetry: d(a,b) === d(b,a)', () => {
    for (let t = 0; t < TRIALS; t++) {
      const a = randomBinaryFloat32(rng, DIM);
      const b = randomBinaryFloat32(rng, DIM);
      expect(calculator.calculate(a, b)).toBe(calculator.calculate(b, a));
    }
  });
});

// ---------------------------------------------------------------------------
// Property: jaccard matches reference on binary float32 vectors
// ---------------------------------------------------------------------------

describe('property: jaccard matches reference on binary Float32Array', () => {
  const rng = createPrng(0x0a1b2c3d);
  const calculator = createDistanceCalculator('jaccard');
  const TRIALS = 15;
  const DIM = 12;

  it('random binary vectors', () => {
    for (let t = 0; t < TRIALS; t++) {
      const a = randomBinaryFloat32(rng, DIM);
      const b = randomBinaryFloat32(rng, DIM);
      expect(calculator.calculate(a, b)).toBeCloseTo(refJaccard(a, b), 5);
    }
  });

  it('jaccard distance is in [0, 1]', () => {
    for (let t = 0; t < TRIALS; t++) {
      const a = randomBinaryFloat32(rng, DIM);
      const b = randomBinaryFloat32(rng, DIM);
      const d = calculator.calculate(a, b);
      expect(d).toBeGreaterThanOrEqual(-1e-6);
      expect(d).toBeLessThanOrEqual(1 + 1e-6);
    }
  });

  it('identical vectors have distance 0', () => {
    for (let t = 0; t < 10; t++) {
      const v = randomBinaryFloat32(rng, DIM);
      // All-zero vector: both all-zero → union is 0 → special case returns 0
      // Non-zero vector: intersection == union → distance is 0
      expect(calculator.calculate(v, v)).toBeCloseTo(0, 5);
    }
  });
});

// ---------------------------------------------------------------------------
// Property: distance metrics satisfy mathematical invariants
// ---------------------------------------------------------------------------

describe('property: metric invariants (non-negativity, identity, symmetry)', () => {
  const rng = createPrng(0xfedcba98);
  const TRIALS = 10;
  const DIM = 8;

  const metrics = ['euclidean', 'manhattan', 'hamming', 'jaccard'] as const;

  for (const name of metrics) {
    describe(name, () => {
      const calc = createDistanceCalculator(name);

      it('non-negativity: d(a, b) >= 0', () => {
        for (let t = 0; t < TRIALS; t++) {
          const a = randomBinaryFloat32(rng, DIM);
          const b = randomBinaryFloat32(rng, DIM);
          expect(calc.calculate(a, b)).toBeGreaterThanOrEqual(0);
        }
      });

      it('identity: d(a, a) === 0', () => {
        for (let t = 0; t < TRIALS; t++) {
          const a = randomFloat32(rng, DIM);
          expect(calc.calculate(a, a)).toBeCloseTo(0, 4);
        }
      });

      it('symmetry: d(a, b) === d(b, a)', () => {
        for (let t = 0; t < TRIALS; t++) {
          const a = randomFloat32(rng, DIM);
          const b = randomFloat32(rng, DIM);
          expect(calc.calculate(a, b)).toBeCloseTo(calc.calculate(b, a), 5);
        }
      });
    });
  }
});

// ---------------------------------------------------------------------------
// Property: euclidean triangle inequality (randomized)
// ---------------------------------------------------------------------------

describe('property: euclidean satisfies triangle inequality', () => {
  const rng = createPrng(0x11223344);
  const calculator = createDistanceCalculator('euclidean');
  const TRIALS = 20;

  it('random triples satisfy d(a,c) <= d(a,b) + d(b,c)', () => {
    for (let t = 0; t < TRIALS; t++) {
      const a = randomFloat32(rng, 8);
      const b = randomFloat32(rng, 8);
      const c = randomFloat32(rng, 8);
      const ab = calculator.calculate(a, b);
      const bc = calculator.calculate(b, c);
      const ac = calculator.calculate(a, c);
      expect(ac).toBeLessThanOrEqual(ab + bc + 1e-4);
    }
  });
});

// ---------------------------------------------------------------------------
// Property: optimized euclidean matches naive reference
// ---------------------------------------------------------------------------

describe('property: optimized euclidean matches reference', () => {
  const rng = createPrng(0x55667788);
  const TRIALS = 15;

  it('random Float32Array pairs across multiple dimensions', () => {
    const dims = [1, 2, 3, 4, 5, 7, 8, 9, 16, 17, 32, 33];
    for (const dim of dims) {
      const a = randomFloat32(rng, dim);
      const b = randomFloat32(rng, dim);
      const expected = refEuclidean(a, b);
      const actual = OptimizedDistanceMetrics.euclideanOptimized(a, b);
      expect(actual).toBeCloseTo(expected, 4);
    }
  });

  it('large random vectors (1024 elements)', () => {
    for (let t = 0; t < TRIALS; t++) {
      const a = randomFloat32(rng, 1024);
      const b = randomFloat32(rng, 1024);
      const expected = refEuclidean(a, b);
      const actual = OptimizedDistanceMetrics.euclideanOptimized(a, b);
      // Tolerate slightly more numerical error for large vectors
      expect(Math.abs(actual - expected) / (expected + 1e-10)).toBeLessThan(1e-3);
    }
  });
});

// ---------------------------------------------------------------------------
// Edge cases across all metrics
// ---------------------------------------------------------------------------

describe('edge cases: zero vectors', () => {
  const zero = new Float32Array(8);

  it('euclidean: d(0, 0) === 0', () => {
    const calc = createDistanceCalculator('euclidean');
    expect(calc.calculate(zero, zero)).toBe(0);
  });

  it('manhattan: d(0, 0) === 0', () => {
    const calc = createDistanceCalculator('manhattan');
    expect(calc.calculate(zero, zero)).toBe(0);
  });

  it('hamming: d(0, 0) === 0', () => {
    const calc = createDistanceCalculator('hamming');
    expect(calc.calculate(zero, zero)).toBe(0);
  });

  it('jaccard: d(0, 0) === 0 (both zero vectors → union=0 → 0)', () => {
    const calc = createDistanceCalculator('jaccard');
    expect(calc.calculate(zero, zero)).toBe(0);
  });
});

describe('edge cases: single-element vectors', () => {
  it('euclidean single element', () => {
    const calc = createDistanceCalculator('euclidean');
    const a = new Float32Array([3]);
    const b = new Float32Array([7]);
    expect(calc.calculate(a, b)).toBeCloseTo(4, 5);
  });

  it('manhattan single element', () => {
    const calc = createDistanceCalculator('manhattan');
    const a = new Float32Array([3]);
    const b = new Float32Array([7]);
    expect(calc.calculate(a, b)).toBeCloseTo(4, 5);
  });

  it('hamming single element differs', () => {
    const calc = createDistanceCalculator('hamming');
    expect(calc.calculate(new Float32Array([1]), new Float32Array([0]))).toBe(1);
  });

  it('hamming single element same', () => {
    const calc = createDistanceCalculator('hamming');
    expect(calc.calculate(new Float32Array([1]), new Float32Array([1]))).toBe(0);
  });
});

describe('edge cases: format-specific behaviour', () => {
  it('Int8Array round-trip preserves approximate cosine distance', () => {
    const rng = createPrng(0x1a2b3c4d);
    const calc = createDistanceCalculator('cosine');

    for (let t = 0; t < 5; t++) {
      // Build a float32 vector in [-1,1], quantise to int8, convert back
      const original = normalizeInPlace(randomFloat32(rng, 8));
      const int8 = VectorFormatHandler.fromFloat32Array(original, 'int8') as Int8Array;
      const back = toFloat32(int8);
      const direct = calc.calculate(original, original);
      const quantised = calc.calculate(back, back);
      // Both identical-to-self pairs should be near 0
      expect(direct).toBeCloseTo(0, 4);
      expect(quantised).toBeLessThan(0.01); // quantisation loss may push slightly above 0
    }
  });

  it('Uint8Array values are scaled to [0,1] by VectorFormatHandler', () => {
    const calc = createDistanceCalculator('euclidean');
    const a = toFloat32(new Uint8Array([0, 255]));
    const b = toFloat32(new Uint8Array([255, 0]));
    // After conversion: a=[0,1], b=[1,0]; euclidean = sqrt(2)
    expect(calc.calculate(a, b)).toBeCloseTo(Math.SQRT2, 4);
  });

  it('binary Uint8Array round-trip via VectorFormatHandler matches hamming reference', () => {
    const rng = createPrng(0xabcdef01);
    const calc = createDistanceCalculator('hamming');

    for (let t = 0; t < 10; t++) {
      // Generate Uint8Array with only 0/1 values
      const raw = new Uint8Array(Array.from({ length: 8 }, () => (rng() > 0.5 ? 1 : 0)));
      const a = toFloat32(raw); // binary values preserved as 0/1
      const b = toFloat32(
        new Uint8Array(Array.from({ length: 8 }, () => (rng() > 0.5 ? 1 : 0))),
      );
      expect(calc.calculate(a, b)).toBe(refHamming(a, b));
    }
  });
});

describe('edge cases: all metrics listed in registry are callable', () => {
  const registry = DistanceMetrics.getInstance();
  const rng = createPrng(0x9988aabb);

  it('every registered metric returns a finite number for valid float32 input', () => {
    const metricNames = registry.list();
    for (const name of metricNames) {
      const metric = registry.get(name);
      const a = new Float32Array([1, 0, 0, 1]);
      const b = new Float32Array([0, 1, 1, 0]);
      const result = metric.calculate(a, b);
      expect(isFinite(result)).toBe(true);
    }
  });

  it('fuzz: random float32 inputs do not throw for standard metrics', () => {
    for (let t = 0; t < 20; t++) {
      const a = randomFloat32(rng, 6);
      const b = randomFloat32(rng, 6);
      for (const name of ['euclidean', 'manhattan', 'hamming', 'jaccard', 'dot']) {
        const calc = createDistanceCalculator(name);
        expect(() => calc.calculate(a, b)).not.toThrow();
      }
    }
  });
});
