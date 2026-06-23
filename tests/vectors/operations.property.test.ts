/**
 * Property-based tests for vector math operations.
 *
 * Tests are driven by deterministic seeded random data so failures reproduce.
 * Each "property" describes a mathematical invariant that must hold for all
 * valid inputs, checked against naive reference implementations.
 */

import { describe, expect, it } from 'bun:test';

import { VectorOperations } from '@/vectors/operations.js';

// ---------------------------------------------------------------------------
// Deterministic PRNG — mulberry32, seeded
// ---------------------------------------------------------------------------

/**
 * A simple seeded pseudo-random number generator (mulberry32 algorithm).
 * Returns a function that produces numbers in [0, 1).
 */
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
// Vector generators
// ---------------------------------------------------------------------------

/**
 * Generate a Float32Array of `dimension` random values in [-scale, scale].
 */
function randomFloat32(
  rng: () => number,
  dimension: number,
  scale = 1,
): Float32Array {
  const v = new Float32Array(dimension);
  for (let i = 0; i < dimension; i++) {
    v[i] = (rng() * 2 - 1) * scale;
  }
  return v;
}

/**
 * Generate a non-zero Float32Array so normalization is well-defined.
 */
function randomNonZeroFloat32(
  rng: () => number,
  dimension: number,
): Float32Array {
  let v: Float32Array;
  do {
    v = randomFloat32(rng, dimension);
  } while (v.every((x) => x === 0));
  return v;
}

// ---------------------------------------------------------------------------
// Reference implementations (plain JavaScript, no optimisations)
// ---------------------------------------------------------------------------

function refMagnitude(v: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i]! * v[i]!;
  return Math.sqrt(sum);
}

function refNormalize(v: Float32Array): Float32Array {
  const mag = refMagnitude(v);
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i]! / mag;
  return out;
}

function refDotProduct(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i]! * b[i]!;
  return sum;
}

function refAdd(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i]! + b[i]!;
  return out;
}

function refSubtract(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i]! - b[i]!;
  return out;
}

function refScale(v: Float32Array, scalar: number): Float32Array {
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i]! * scalar;
  return out;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Assert every element of two Float32Arrays is within `epsilon` of each other.
 */
function expectVectorsClose(
  actual: Float32Array,
  expected: Float32Array,
  epsilon = 1e-4,
): void {
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < expected.length; i++) {
    const a = actual[i]!;
    const e = expected[i]!;
    expect(Math.abs(a - e)).toBeLessThan(epsilon);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('property: magnitude matches reference implementation', () => {
  const rng = createPrng(0xdeadbeef);

  it('small vectors (4 elements, scalar path)', async () => {
    for (let trial = 0; trial < 20; trial++) {
      const v = randomFloat32(rng, 4);
      const actual = await VectorOperations.magnitude(v);
      const expected = refMagnitude(v);
      expect(Math.abs(actual - expected)).toBeLessThan(1e-4);
    }
  });

  it('large vectors (32 elements, SIMD path)', async () => {
    for (let trial = 0; trial < 20; trial++) {
      const v = randomFloat32(rng, 32);
      const actual = await VectorOperations.magnitude(v);
      const expected = refMagnitude(v);
      expect(Math.abs(actual - expected)).toBeLessThan(1e-3);
    }
  });

  it('random dimensions across the range [1, 128]', async () => {
    const dims = [1, 2, 3, 5, 7, 8, 15, 16, 17, 31, 32, 33, 63, 64, 65, 128];
    for (const dim of dims) {
      const v = randomFloat32(rng, dim);
      const actual = await VectorOperations.magnitude(v);
      const expected = refMagnitude(v);
      expect(Math.abs(actual - expected)).toBeLessThan(1e-3);
    }
  });

  it('zero vector has magnitude 0', async () => {
    const zero = new Float32Array(8);
    expect(await VectorOperations.magnitude(zero)).toBe(0);
  });

  it('unit vectors have magnitude ≈ 1', async () => {
    for (let trial = 0; trial < 10; trial++) {
      const v = randomNonZeroFloat32(rng, 8);
      const unit = VectorOperations.normalizeSync(v);
      const mag = await VectorOperations.magnitude(unit);
      expect(Math.abs(mag - 1)).toBeLessThan(1e-5);
    }
  });
});

describe('property: normalize produces unit vectors matching reference', () => {
  const rng = createPrng(0xc0ffee01);

  it('random Float32Array vectors', async () => {
    for (let trial = 0; trial < 20; trial++) {
      const v = randomNonZeroFloat32(rng, 8);
      const actual = await VectorOperations.normalize(v);
      const expected = refNormalize(v);
      expectVectorsClose(actual, expected, 1e-4);
    }
  });

  it('normalized vector has unit magnitude', async () => {
    for (let trial = 0; trial < 20; trial++) {
      const v = randomNonZeroFloat32(rng, 16);
      const normalized = await VectorOperations.normalize(v);
      const mag = refMagnitude(normalized);
      expect(Math.abs(mag - 1)).toBeLessThan(1e-4);
    }
  });

  it('idempotent: normalizing twice gives same result as once', async () => {
    for (let trial = 0; trial < 10; trial++) {
      const v = randomNonZeroFloat32(rng, 8);
      const once = await VectorOperations.normalize(v);
      const twice = await VectorOperations.normalize(once);
      expectVectorsClose(twice, once, 1e-4);
    }
  });

  it('zero vector returns zero vector', async () => {
    const zero = new Float32Array(4);
    const result = await VectorOperations.normalize(zero);
    for (let i = 0; i < result.length; i++) {
      expect(result[i]).toBe(0);
    }
  });
});

describe('property: dotProduct matches reference implementation', () => {
  const rng = createPrng(0xfeedface);

  it('random Float32Array pairs (small, scalar path)', async () => {
    for (let trial = 0; trial < 20; trial++) {
      const a = randomFloat32(rng, 4);
      const b = randomFloat32(rng, 4);
      const actual = await VectorOperations.dotProduct(a, b);
      const expected = refDotProduct(a, b);
      expect(Math.abs(actual - expected)).toBeLessThan(1e-3);
    }
  });

  it('random Float32Array pairs (large, SIMD path)', async () => {
    for (let trial = 0; trial < 20; trial++) {
      const a = randomFloat32(rng, 32);
      const b = randomFloat32(rng, 32);
      const actual = await VectorOperations.dotProduct(a, b);
      const expected = refDotProduct(a, b);
      expect(Math.abs(actual - expected)).toBeLessThan(1e-2);
    }
  });

  it('commutativity: a·b === b·a', async () => {
    for (let trial = 0; trial < 20; trial++) {
      const a = randomFloat32(rng, 8);
      const b = randomFloat32(rng, 8);
      const ab = await VectorOperations.dotProduct(a, b);
      const ba = await VectorOperations.dotProduct(b, a);
      expect(Math.abs(ab - ba)).toBeLessThan(1e-5);
    }
  });

  it('orthogonal unit vectors have dot product ≈ 0', async () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([0, 1, 0]);
    const result = await VectorOperations.dotProduct(a, b);
    expect(Math.abs(result)).toBeLessThan(1e-6);
  });

  it('parallel vectors: a·a === |a|²', async () => {
    for (let trial = 0; trial < 10; trial++) {
      const v = randomFloat32(rng, 8);
      const dot = await VectorOperations.dotProduct(v, v);
      const mag2 = refMagnitude(v) ** 2;
      expect(Math.abs(dot - mag2)).toBeLessThan(1e-2);
    }
  });
});

describe('property: add matches reference implementation', () => {
  const rng = createPrng(0xabcd1234);

  it('random Float32Array pairs', async () => {
    for (let trial = 0; trial < 20; trial++) {
      const a = randomFloat32(rng, 8);
      const b = randomFloat32(rng, 8);
      const actual = await VectorOperations.add(a, b);
      const expected = refAdd(a, b);
      expectVectorsClose(actual, expected, 1e-5);
    }
  });

  it('commutativity: a+b === b+a', async () => {
    for (let trial = 0; trial < 10; trial++) {
      const a = randomFloat32(rng, 8);
      const b = randomFloat32(rng, 8);
      const ab = await VectorOperations.add(a, b);
      const ba = await VectorOperations.add(b, a);
      expectVectorsClose(ab, ba, 1e-6);
    }
  });

  it('adding zero vector is identity', async () => {
    for (let trial = 0; trial < 10; trial++) {
      const v = randomFloat32(rng, 8);
      const zero = new Float32Array(8);
      const result = await VectorOperations.add(v, zero);
      expectVectorsClose(result, v, 1e-6);
    }
  });
});

describe('property: subtract matches reference implementation', () => {
  const rng = createPrng(0x99887766);

  it('random Float32Array pairs', async () => {
    for (let trial = 0; trial < 20; trial++) {
      const a = randomFloat32(rng, 8);
      const b = randomFloat32(rng, 8);
      const actual = await VectorOperations.subtract(a, b);
      const expected = refSubtract(a, b);
      expectVectorsClose(actual, expected, 1e-5);
    }
  });

  it('subtracting self yields zero vector', async () => {
    for (let trial = 0; trial < 10; trial++) {
      const v = randomFloat32(rng, 8);
      const result = await VectorOperations.subtract(v, v);
      for (let i = 0; i < result.length; i++) {
        expect(result[i]).toBe(0);
      }
    }
  });

  it('a - b === -(b - a)', async () => {
    for (let trial = 0; trial < 10; trial++) {
      const a = randomFloat32(rng, 8);
      const b = randomFloat32(rng, 8);
      const ab = await VectorOperations.subtract(a, b);
      const ba = await VectorOperations.subtract(b, a);
      for (let i = 0; i < ab.length; i++) {
        expect(ab[i]!).toBeCloseTo(-ba[i]!, 5);
      }
    }
  });

  it('add and subtract are inverse: (a + b) - b ≈ a', async () => {
    for (let trial = 0; trial < 10; trial++) {
      const a = randomFloat32(rng, 8);
      const b = randomFloat32(rng, 8);
      const sum = await VectorOperations.add(a, b);
      const back = await VectorOperations.subtract(sum, b);
      expectVectorsClose(back, a, 1e-4);
    }
  });
});

describe('property: scale matches reference implementation', () => {
  const rng = createPrng(0x13579bdf);

  it('random vectors with random scalars', async () => {
    for (let trial = 0; trial < 20; trial++) {
      const v = randomFloat32(rng, 8);
      const scalar = (rng() * 2 - 1) * 10;
      const actual = await VectorOperations.scale(v, scalar);
      const expected = refScale(v, scalar);
      expectVectorsClose(actual, expected, 1e-3);
    }
  });

  it('scaling by 1 is identity', async () => {
    for (let trial = 0; trial < 10; trial++) {
      const v = randomFloat32(rng, 8);
      const result = await VectorOperations.scale(v, 1);
      expectVectorsClose(result, v, 1e-6);
    }
  });

  it('scaling by 0 gives zero vector', async () => {
    for (let trial = 0; trial < 10; trial++) {
      const v = randomFloat32(rng, 8);
      const result = await VectorOperations.scale(v, 0);
      for (let i = 0; i < result.length; i++) {
        // Use == rather than Object.is so that -0 === 0 passes
        expect(result[i] == 0).toBe(true);
      }
    }
  });

  it('scale magnitude is |scalar| * original magnitude', async () => {
    for (let trial = 0; trial < 10; trial++) {
      const v = randomNonZeroFloat32(rng, 8);
      const scalar = rng() * 5 + 0.1; // positive scalar
      const scaled = await VectorOperations.scale(v, scalar);
      const originalMag = refMagnitude(v);
      const scaledMag = refMagnitude(scaled);
      expect(Math.abs(scaledMag - scalar * originalMag)).toBeLessThan(1e-3);
    }
  });

  it('scale then divide by scalar returns original', async () => {
    for (let trial = 0; trial < 10; trial++) {
      const v = randomFloat32(rng, 8);
      const scalar = rng() * 5 + 0.5;
      const scaled = await VectorOperations.scale(v, scalar);
      const back = await VectorOperations.scale(scaled, 1 / scalar);
      expectVectorsClose(back, v, 1e-4);
    }
  });
});

describe('property: mean matches reference implementation', () => {
  const rng = createPrng(0x2468ace0);

  function refMean(vectors: Float32Array[]): Float32Array {
    const dim = vectors[0]!.length;
    const out = new Float32Array(dim);
    for (const v of vectors) {
      for (let i = 0; i < dim; i++) out[i]! += v[i]!;
    }
    for (let i = 0; i < dim; i++) out[i]! /= vectors.length;
    return out;
  }

  it('random vector collections', () => {
    for (let trial = 0; trial < 10; trial++) {
      const count = Math.floor(rng() * 9) + 2; // 2–10 vectors
      const vectors = Array.from({ length: count }, () => randomFloat32(rng, 6));
      const actual = VectorOperations.mean(vectors);
      const expected = refMean(vectors);
      expectVectorsClose(actual, expected, 1e-4);
    }
  });

  it('mean of a single vector equals that vector', () => {
    const v = randomFloat32(rng, 6);
    const result = VectorOperations.mean([v]);
    expectVectorsClose(result, v, 1e-6);
  });

  it('mean of v and -v is zero', () => {
    const v = randomFloat32(rng, 6);
    const neg = new Float32Array(v.map((x) => -x));
    const result = VectorOperations.mean([v, neg]);
    for (let i = 0; i < result.length; i++) {
      expect(Math.abs(result[i]!)).toBeLessThan(1e-6);
    }
  });
});

describe('property: random dimensions edge cases', () => {
  const rng = createPrng(0xedcba987);

  it('single-element vectors work for all operations', async () => {
    const a = new Float32Array([3]);
    const b = new Float32Array([4]);

    expect(await VectorOperations.magnitude(a)).toBeCloseTo(3, 5);
    expect(await VectorOperations.dotProduct(a, b)).toBeCloseTo(12, 5);

    const sum = await VectorOperations.add(a, b);
    expect(sum[0]).toBeCloseTo(7, 5);

    const diff = await VectorOperations.subtract(a, b);
    expect(diff[0]).toBeCloseTo(-1, 5);

    const scaled = await VectorOperations.scale(a, 2);
    expect(scaled[0]).toBeCloseTo(6, 5);
  });

  it('large vectors (256 elements) match reference', async () => {
    const a = randomFloat32(rng, 256, 0.5);
    const b = randomFloat32(rng, 256, 0.5);

    const mag = await VectorOperations.magnitude(a);
    expect(Math.abs(mag - refMagnitude(a))).toBeLessThan(1e-2);

    const dot = await VectorOperations.dotProduct(a, b);
    expect(Math.abs(dot - refDotProduct(a, b))).toBeLessThan(1);

    const sum = await VectorOperations.add(a, b);
    expectVectorsClose(sum, refAdd(a, b), 1e-4);
  });

  it('fuzz: random operations do not throw for valid inputs', async () => {
    for (let trial = 0; trial < 30; trial++) {
      const dim = Math.floor(rng() * 30) + 1;
      const a = randomFloat32(rng, dim);
      const b = randomFloat32(rng, dim);

      const mag = await VectorOperations.magnitude(a);
      expect(isFinite(mag)).toBe(true);

      const dot = await VectorOperations.dotProduct(a, b);
      expect(isFinite(dot)).toBe(true);

      const sum = await VectorOperations.add(a, b);
      expect(sum).toBeDefined();

      const diff = await VectorOperations.subtract(a, b);
      expect(diff).toBeDefined();

      const scaled = await VectorOperations.scale(a, rng());
      expect(scaled).toBeDefined();
    }
  });
});
