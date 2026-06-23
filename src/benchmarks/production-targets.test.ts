import { describe, expect, it } from 'bun:test';

import {
  PRODUCTION_TARGETS,
  evaluateTarget,
  findTarget,
  targetsForCategory,
  type ProductionTarget,
  type TargetDirection,
  type TargetUnit,
} from './production-targets.js';

describe('PRODUCTION_TARGETS', () => {
  it('defines at least one target for each required metric area', () => {
    const categories = new Set(PRODUCTION_TARGETS.map((t) => t.category));

    // Required categories per issue #96
    expect(categories.has('database-ops')).toBe(true); // insert throughput + storage
    expect(categories.has('search')).toBe(true); // search latency
    expect(categories.has('recall')).toBe(true); // recall
    expect(categories.has('memory')).toBe(true); // memory use
    expect(categories.has('indexing')).toBe(true); // index rebuild time
    expect(categories.has('compression')).toBe(true); // compression cost
    expect(categories.has('acceleration')).toBe(true); // acceleration thresholds
    expect(categories.has('startup')).toBe(true); // startup time
  });

  it('has valid structure for every target', () => {
    for (const target of PRODUCTION_TARGETS) {
      expect(typeof target.name).toBe('string');
      expect(target.name.length).toBeGreaterThan(0);

      expect(typeof target.category).toBe('string');
      expect(target.category.length).toBeGreaterThan(0);

      expect(typeof target.minimum).toBe('number');
      expect(target.minimum).toBeGreaterThan(0);

      expect(typeof target.unit).toBe('string');
      const validUnits: TargetUnit[] = ['ops/sec', 'ms', 'MB', 'KB', 'ratio', '%'];
      expect(validUnits).toContain(target.unit);

      const validDirections: TargetDirection[] = ['higher-is-better', 'lower-is-better'];
      expect(validDirections).toContain(target.direction);

      expect(typeof target.tolerance).toBe('number');
      expect(target.tolerance).toBeGreaterThan(0);
      expect(target.tolerance).toBeLessThanOrEqual(1);

      expect(target.dataset).toBeDefined();
      expect(typeof target.dataset.dimensions).toBe('number');
      expect(target.dataset.dimensions).toBeGreaterThan(0);
      expect(typeof target.dataset.size).toBe('number');
      expect(target.dataset.size).toBeGreaterThanOrEqual(0);
    }
  });

  it('has unique target names', () => {
    const names = PRODUCTION_TARGETS.map((t) => t.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  it('covers batch insert throughput', () => {
    const batchTarget = PRODUCTION_TARGETS.find((t) =>
      t.name.toLowerCase().includes('batch'),
    );
    expect(batchTarget).toBeDefined();
    expect(batchTarget?.category).toBe('database-ops');
  });

  it('covers all metric areas named in issue #96', () => {
    const names = PRODUCTION_TARGETS.map((t) => t.name.toLowerCase());
    const joined = names.join(' ');

    expect(joined).toContain('insert'); // insert throughput
    expect(joined).toContain('batch'); // batch insert throughput
    expect(joined).toContain('search latency'); // search latency
    expect(joined).toContain('recall'); // recall
    expect(joined).toContain('memory'); // memory use
    expect(joined).toContain('startup'); // startup time
    expect(joined).toContain('rebuild'); // index rebuild time
    expect(joined).toContain('retrieval'); // storage throughput
    expect(joined).toContain('compression'); // compression cost
    expect(joined).toContain('vector ops'); // acceleration thresholds
  });
});

describe('findTarget', () => {
  it('returns a target when the name matches exactly', () => {
    const first = PRODUCTION_TARGETS[0];
    expect(first).toBeDefined();
    const found = findTarget(first!.name);
    expect(found).toBe(first!);
  });

  it('returns undefined for an unknown name', () => {
    expect(findTarget('Non-existent metric')).toBeUndefined();
  });
});

describe('targetsForCategory', () => {
  it('returns all targets for a known category', () => {
    const searchTargets = targetsForCategory('search');
    expect(searchTargets.length).toBeGreaterThan(0);
    for (const t of searchTargets) {
      expect(t.category).toBe('search');
    }
  });

  it('returns an empty array for an unknown category', () => {
    expect(targetsForCategory('does-not-exist')).toHaveLength(0);
  });
});

describe('evaluateTarget', () => {
  const higherIsBetter: ProductionTarget = {
    name: 'Test ops',
    category: 'test',
    minimum: 1000,
    unit: 'ops/sec',
    direction: 'higher-is-better',
    tolerance: 0.2,
    dataset: { dimensions: 128, size: 1000 },
  };

  const lowerIsBetter: ProductionTarget = {
    name: 'Test latency',
    category: 'test',
    minimum: 50,
    unit: 'MB',
    direction: 'lower-is-better',
    tolerance: 0.3,
    dataset: { dimensions: 128, size: 1000 },
  };

  it('passes when measured exceeds minimum for higher-is-better', () => {
    const result = evaluateTarget(higherIsBetter, 1200);
    expect(result.passed).toBe(true);
  });

  it('passes at exactly the minimum for higher-is-better', () => {
    const result = evaluateTarget(higherIsBetter, 1000);
    expect(result.passed).toBe(true);
  });

  it('passes within tolerance for higher-is-better', () => {
    // 20% below minimum: threshold = 1000 * (1 - 0.2) = 800
    const result = evaluateTarget(higherIsBetter, 800);
    expect(result.passed).toBe(true);
  });

  it('fails beyond tolerance for higher-is-better', () => {
    // 21% below minimum: 790 < 800 threshold
    const result = evaluateTarget(higherIsBetter, 790);
    expect(result.passed).toBe(false);
  });

  it('passes when measured is below minimum for lower-is-better', () => {
    const result = evaluateTarget(lowerIsBetter, 30);
    expect(result.passed).toBe(true);
  });

  it('passes within tolerance for lower-is-better', () => {
    // threshold = 50 * (1 + 0.3) = 65; 65 should pass
    const result = evaluateTarget(lowerIsBetter, 65);
    expect(result.passed).toBe(true);
  });

  it('fails beyond tolerance for lower-is-better', () => {
    // 66 > 65 threshold
    const result = evaluateTarget(lowerIsBetter, 66);
    expect(result.passed).toBe(false);
  });

  it('computes delta correctly for higher-is-better', () => {
    const result = evaluateTarget(higherIsBetter, 1200);
    expect(result.delta).toBe(200); // 1200 - 1000
    expect(result.deltaPercent).toBeCloseTo(20, 1); // (200/1000)*100
  });

  it('computes delta correctly for lower-is-better', () => {
    const result = evaluateTarget(lowerIsBetter, 30);
    expect(result.delta).toBe(20); // 50 - 30 = positive means better
    expect(result.deltaPercent).toBeCloseTo(40, 1); // (20/50)*100
  });

  it('exposes measured and minimum in the result', () => {
    const result = evaluateTarget(higherIsBetter, 1100);
    expect(result.measured).toBe(1100);
    expect(result.minimum).toBe(1000);
  });

  it('marks withinTolerance consistently with passed', () => {
    const pass = evaluateTarget(higherIsBetter, 900);
    expect(pass.withinTolerance).toBe(pass.passed);

    const fail = evaluateTarget(higherIsBetter, 100);
    expect(fail.withinTolerance).toBe(fail.passed);
  });
});
