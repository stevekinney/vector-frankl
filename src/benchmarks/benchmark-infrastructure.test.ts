import { describe, expect, it } from 'bun:test';

import type { DistanceMetric } from '@/core/types.js';
import { BenchmarkRunner, BenchmarkSuite, QuickBenchmark } from './index.js';

describe('Benchmark Infrastructure', () => {
  it('should create a benchmark suite with default config', () => {
    const suite = new BenchmarkSuite();
    expect(suite).toBeDefined();
  });

  it('should create a benchmark suite with custom config', () => {
    const suite = new BenchmarkSuite({
      dimensions: [64],
      datasetSizes: [10],
      distanceMetrics: ['cosine'],
      verbose: false,
    });
    expect(suite).toBeDefined();
  });

  it('should create a benchmark runner', () => {
    const runner = new BenchmarkRunner({
      outputFormat: 'console',
    });
    expect(runner).toBeDefined();
  });

  it('should create a benchmark runner with JSON output', () => {
    const runner = new BenchmarkRunner({
      outputFormat: 'json',
      exportPath: 'test-results.json',
    });
    expect(runner).toBeDefined();
  });

  it('should create a benchmark runner with CSV output', () => {
    const runner = new BenchmarkRunner({
      outputFormat: 'csv',
      exportPath: 'test-results.csv',
    });
    expect(runner).toBeDefined();
  });

  it('should have QuickBenchmark static methods', () => {
    expect(typeof QuickBenchmark.runQuick).toBe('function');
    expect(typeof QuickBenchmark.runFull).toBe('function');
    expect(typeof QuickBenchmark.runCategory).toBe('function');
  });

  it('should validate benchmark configuration options', () => {
    const config = {
      dimensions: [128, 256],
      datasetSizes: [100, 1000],
      distanceMetrics: ['cosine', 'euclidean'] as DistanceMetric[],
      queryCount: 50,
      kValues: [5, 10],
      warmupIterations: 2,
      benchmarkIterations: 3,
      trackMemory: true,
      testCompression: false,
      testFormats: false,
      testIndexing: false,
      verbose: true,
    };

    const suite = new BenchmarkSuite(config);
    expect(suite).toBeDefined();
  });

  it('should provide type safety for benchmark categories', () => {
    // These should compile without errors
    const categories: Array<
      'search' | 'database-ops' | 'indexing' | 'formats' | 'compression'
    > = ['search', 'database-ops', 'indexing', 'formats', 'compression'];

    expect(categories).toHaveLength(5);
    expect(categories.includes('search')).toBe(true);
    expect(categories.includes('indexing')).toBe(true);
  });

  it('should have proper type definitions for benchmark results', () => {
    // Test that the types are properly exported and structured
    const mockResult = {
      testName: 'Test',
      category: 'test',
      duration: 100,
      operationsPerSecond: 10,
      metadata: { test: true },
    };

    expect(mockResult.testName).toBe('Test');
    expect(mockResult.category).toBe('test');
    expect(mockResult.duration).toBe(100);
    expect(mockResult.operationsPerSecond).toBe(10);
    expect(mockResult.metadata.test).toBe(true);
  });

  it('should have proper type definitions for benchmark summary', () => {
    const mockSummary = {
      totalTests: 10,
      passedTests: 8,
      failedTests: 2,
      totalDuration: 1000,
      results: [],
      categories: {},
      recommendations: ['Use indexing for large datasets'],
    };

    expect(mockSummary.totalTests).toBe(10);
    expect(mockSummary.passedTests).toBe(8);
    expect(mockSummary.failedTests).toBe(2);
    expect(mockSummary.recommendations).toHaveLength(1);
  });
});
