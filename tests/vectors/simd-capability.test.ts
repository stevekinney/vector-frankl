/**
 * Tests for SIMD capability detection reclassification.
 *
 * Verifies that capability detection accurately reports JavaScript-level
 * optimizations only, and never claims hardware SIMD unless a real SIMD
 * execution path is proven active (which it currently is not).
 *
 * See issue #77: [SIMD] Reclassify SIMD unless real SIMD is proven.
 */

import { describe, expect, it } from 'bun:test';

import { SIMDOperations } from '@/simd/simd-operations.js';
import { SIMDDistanceMetrics } from '@/simd/simd-distance-metrics.js';

describe('SIMD capability detection', () => {
  describe('SIMDOperations.getCapabilities()', () => {
    it('does not report hardware SIMD when no WASM SIMD module is active', () => {
      const ops = new SIMDOperations();
      const caps = ops.getCapabilities();

      // No real SIMD execution path exists — hasHardwareSIMD must be false
      expect(caps.hasHardwareSIMD).toBe(false);
    });

    it('reports optimized JavaScript as supported (TypedArray-optimized path)', () => {
      const ops = new SIMDOperations({ enableSIMD: true });
      const caps = ops.getCapabilities();

      // Optimized JS (loop-unrolled TypedArrays) should be available
      expect(caps.supported).toBe(true);
    });

    it('does not include hardware SIMD instruction set labels', () => {
      const ops = new SIMDOperations();
      const caps = ops.getCapabilities();

      // No entry should claim native hardware SIMD
      const hasSIMDClaim = caps.instructionSets.some(
        (entry) => entry === 'SIMD' || entry === 'SSE' || entry === 'AVX' || entry === 'NEON',
      );
      expect(hasSIMDClaim).toBe(false);
    });

    it('instructionSets only contains JavaScript-level optimization labels', () => {
      const ops = new SIMDOperations();
      const caps = ops.getCapabilities();

      // Every entry must be a JS-level label, not a hardware ISA claim
      const allowedPrefixes = ['TypedArray', 'WebAssembly'];
      for (const entry of caps.instructionSets) {
        const isAllowed = allowedPrefixes.some((prefix) => entry.startsWith(prefix));
        expect(isAllowed).toBe(true);
      }
    });

    it('reports hasHardwareSIMD as false when SIMD is explicitly disabled', () => {
      const ops = new SIMDOperations({ enableSIMD: false });
      const caps = ops.getCapabilities();

      expect(caps.hasHardwareSIMD).toBe(false);
    });

    it('reports hasHardwareSIMD as false regardless of enableSIMD setting', () => {
      const opsEnabled = new SIMDOperations({ enableSIMD: true });
      const opsDisabled = new SIMDOperations({ enableSIMD: false });

      expect(opsEnabled.getCapabilities().hasHardwareSIMD).toBe(false);
      expect(opsDisabled.getCapabilities().hasHardwareSIMD).toBe(false);
    });
  });

  describe('isSIMDEnabled() reflects JavaScript optimization only', () => {
    it('returns true when optimized JS operations are enabled', () => {
      const ops = new SIMDOperations({ enableSIMD: true });
      expect(ops.isSIMDEnabled()).toBe(true);
    });

    it('returns false when optimized JS operations are disabled', () => {
      const ops = new SIMDOperations({ enableSIMD: false });
      expect(ops.isSIMDEnabled()).toBe(false);
    });

    it('isSIMDEnabled true does not imply hardware SIMD', () => {
      const ops = new SIMDOperations({ enableSIMD: true });

      // Even when "SIMD" operations are enabled, hardware SIMD is not active
      expect(ops.isSIMDEnabled()).toBe(true);
      expect(ops.getCapabilities().hasHardwareSIMD).toBe(false);
    });
  });
});

describe('SIMD distance metrics capability', () => {
  describe('simdAccelerated flag accuracy', () => {
    it('simdAccelerated reflects JavaScript optimization, not hardware SIMD', () => {
      const metrics = new SIMDDistanceMetrics();
      const acceleratedMetrics = metrics.getSIMDAcceleratedMetrics();

      // These metrics exist and use loop-unrolled JS
      expect(acceleratedMetrics).toContain('cosine');
      expect(acceleratedMetrics).toContain('euclidean');
      expect(acceleratedMetrics).toContain('manhattan');
      expect(acceleratedMetrics).toContain('dot');
    });

    it('hamming and jaccard are not marked as simdAccelerated', () => {
      const metrics = new SIMDDistanceMetrics();
      const acceleratedMetrics = metrics.getSIMDAcceleratedMetrics();

      expect(acceleratedMetrics).not.toContain('hamming');
      expect(acceleratedMetrics).not.toContain('jaccard');
    });
  });
});

describe('SIMD vs scalar parity', () => {
  const vectorA = new Float32Array(Array.from({ length: 64 }, () => Math.random()));
  const vectorB = new Float32Array(Array.from({ length: 64 }, () => Math.random()));

  it('optimized and scalar dot product produce identical results', () => {
    const ops = new SIMDOperations({ enableSIMD: true, simdThreshold: 16 });
    const opsScalar = new SIMDOperations({ enableSIMD: true, simdThreshold: 10000 });

    const optimized = ops.dotProduct(vectorA, vectorB);
    const scalar = opsScalar.dotProduct(vectorA, vectorB);

    expect(optimized).toBeCloseTo(scalar, 5);
  });

  it('optimized and scalar euclidean distance produce identical results', () => {
    const ops = new SIMDOperations({ enableSIMD: true, simdThreshold: 16 });
    const opsScalar = new SIMDOperations({ enableSIMD: true, simdThreshold: 10000 });

    const optimized = ops.euclideanDistance(vectorA, vectorB);
    const scalar = opsScalar.euclideanDistance(vectorA, vectorB);

    expect(optimized).toBeCloseTo(scalar, 5);
  });

  it('optimized and scalar manhattan distance produce identical results', () => {
    const ops = new SIMDOperations({ enableSIMD: true, simdThreshold: 16 });
    const opsScalar = new SIMDOperations({ enableSIMD: true, simdThreshold: 10000 });

    const optimized = ops.manhattanDistance(vectorA, vectorB);
    const scalar = opsScalar.manhattanDistance(vectorA, vectorB);

    expect(optimized).toBeCloseTo(scalar, 5);
  });

  it('optimized and scalar normalize produce identical results', () => {
    const ops = new SIMDOperations({ enableSIMD: true, simdThreshold: 16 });
    const opsScalar = new SIMDOperations({ enableSIMD: true, simdThreshold: 10000 });

    const optimized = ops.normalize(vectorA);
    const scalar = opsScalar.normalize(vectorA);

    for (let i = 0; i < vectorA.length; i++) {
      expect(optimized[i]!).toBeCloseTo(scalar[i]!, 5);
    }
  });

  it('distance metric calculator produces same results enabled or disabled', () => {
    const metricsEnabled = new SIMDDistanceMetrics({ enableSIMD: true, simdThreshold: 16 });
    const metricsDisabled = new SIMDDistanceMetrics({ enableSIMD: true, simdThreshold: 10000 });

    for (const metric of ['cosine', 'euclidean', 'manhattan'] as const) {
      const enabled = metricsEnabled.calculateDistance(vectorA, vectorB, metric);
      const disabled = metricsDisabled.calculateDistance(vectorA, vectorB, metric);
      expect(enabled).toBeCloseTo(disabled, 5);
    }
  });
});

describe('SIMD fallback behavior', () => {
  it('falls back gracefully when SIMD is disabled', () => {
    const ops = new SIMDOperations({ enableSIMD: false });
    const caps = ops.getCapabilities();

    // capabilities.supported reflects TypedArray availability (always true),
    // but isSIMDEnabled() returns false because the config disables it.
    // hasHardwareSIMD is always false regardless.
    expect(ops.isSIMDEnabled()).toBe(false);
    expect(caps.hasHardwareSIMD).toBe(false);

    // Operations still work correctly via scalar path
    const a = new Float32Array([1, 2, 3, 4]);
    const b = new Float32Array([4, 3, 2, 1]);
    const dot = ops.dotProduct(a, b);
    expect(dot).toBe(20); // 1*4 + 2*3 + 3*2 + 4*1 = 4+6+6+4 = 20
  });

  it('small vectors below threshold use scalar path regardless of SIMD setting', () => {
    const ops = new SIMDOperations({ enableSIMD: true, simdThreshold: 16 });

    // Vectors shorter than threshold always go through scalar path
    const small = new Float32Array([1, 2, 3]);
    const small2 = new Float32Array([4, 5, 6]);
    const result = ops.dotProduct(small, small2);
    expect(result).toBe(32); // 1*4 + 2*5 + 3*6 = 4+10+18 = 32
  });
});
