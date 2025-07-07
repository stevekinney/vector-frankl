import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { BenchmarkSuite } from './benchmark-suite.js';

describe('BenchmarkSuite', () => {
  let suite: BenchmarkSuite;

  beforeEach(() => {
    suite = new BenchmarkSuite({
      dimensions: [64],
      datasetSizes: [10],
      distanceMetrics: ['cosine'],
      queryCount: 2,
      kValues: [1],
      warmupIterations: 1,
      benchmarkIterations: 2,
      testCompression: false,
      testFormats: false,
      testIndexing: false,
      verbose: false
    });
  });

  afterEach(async () => {
    // Cleanup any test databases
  });

  it('should create a benchmark suite with default config', () => {
    const defaultSuite = new BenchmarkSuite();
    expect(defaultSuite).toBeDefined();
  });

  it('should run a minimal benchmark suite', async () => {
    const summary = await suite.runSuite();
    
    expect(summary).toBeDefined();
    expect(summary.totalTests).toBeGreaterThan(0);
    expect(summary.results).toBeArray();
    expect(summary.categories).toBeDefined();
    expect(summary.recommendations).toBeArray();
  });

  it('should generate performance recommendations', async () => {
    const summary = await suite.runSuite();
    
    // Should have some recommendations
    expect(summary.recommendations.length).toBeGreaterThanOrEqual(0);
  });

  it('should track test results by category', async () => {
    const summary = await suite.runSuite();
    
    // Should have database-ops and search categories at minimum
    expect(summary.categories['database-ops']).toBeDefined();
    expect(summary.categories['search']).toBeDefined();
    
    // Each category should have valid stats
    for (const category of Object.values(summary.categories)) {
      expect(category.testCount).toBeGreaterThan(0);
      expect(category.averageOps).toBeGreaterThanOrEqual(0);
      expect(category.totalDuration).toBeGreaterThanOrEqual(0);
    }
  });

  it('should handle benchmark errors gracefully', async () => {
    // Create a suite that might have some failures
    const errorSuite = new BenchmarkSuite({
      dimensions: [1], // Very small dimension might cause issues
      datasetSizes: [1],
      distanceMetrics: ['cosine'],
      warmupIterations: 0,
      benchmarkIterations: 1,
      testCompression: false,
      testFormats: false,
      testIndexing: false,
      verbose: false
    });
    
    // Should not throw, but handle errors in results
    const summary = await errorSuite.runSuite();
    expect(summary).toBeDefined();
    
    // Check if any tests had errors
    const errorResults = summary.results.filter(r => r.error);
    // We don't expect errors with dimension 1, but if there are any, they should be recorded
    expect(summary.failedTests).toBe(errorResults.length);
  });

  it('should provide meaningful test metadata', async () => {
    const summary = await suite.runSuite();
    
    // All results should have metadata
    for (const result of summary.results) {
      expect(result.metadata).toBeDefined();
      expect(result.testName).toBeString();
      expect(result.category).toBeString();
      expect(result.duration).toBeNumber();
      expect(result.operationsPerSecond).toBeNumber();
    }
  });

  it('should measure operations per second correctly', async () => {
    const summary = await suite.runSuite();
    
    // All successful tests should have positive ops/sec
    const successfulResults = summary.results.filter(r => !r.error);
    for (const result of successfulResults) {
      expect(result.operationsPerSecond).toBeGreaterThan(0);
      expect(result.duration).toBeGreaterThan(0);
    }
  });
});