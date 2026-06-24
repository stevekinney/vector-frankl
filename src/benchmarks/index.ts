/**
 * Performance benchmarking system for Vector Frankl
 */

export {
  BenchmarkSuite,
  type BenchmarkConfig,
  type BenchmarkResult,
  type BenchmarkSummary,
} from './benchmark-suite.js';
export {
  BenchmarkRunner,
  QuickBenchmark,
  type BenchmarkRunnerOptions,
} from './runner.js';
export {
  runHNSWRecallBenchmarks,
  RecallBenchmarkFailureError,
  DEFAULT_RECALL_FIXTURES,
  type RecallFixture,
  type RecallResult,
} from './hnsw-recall-benchmark.js';
export {
  PRODUCTION_TARGETS,
  evaluateTarget,
  findTarget,
  targetsForCategory,
  type ProductionTarget,
  type TargetDirection,
  type TargetUnit,
} from './production-targets.js';
