/**
 * Performance benchmarking utilities
 * Import via: vector-frankl/benchmarks
 */
import { BenchmarkSuite } from './benchmarks/benchmark-suite.js';
import { BenchmarkRunner, QuickBenchmark } from './benchmarks/runner.js';

export type {
  BenchmarkConfig,
  BenchmarkResult,
  BenchmarkSummary,
} from './benchmarks/benchmark-suite.js';
export type { BenchmarkRunnerOptions } from './benchmarks/runner.js';
export { BenchmarkRunner, BenchmarkSuite, QuickBenchmark };
