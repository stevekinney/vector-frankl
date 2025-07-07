# Performance Benchmarking System

The Vector Frankl benchmarking system provides comprehensive performance testing capabilities to measure and analyze the database's performance across various scenarios.

## Quick Start

```typescript
import { QuickBenchmark } from 'vector-frankl';

// Run a quick performance test
await QuickBenchmark.runQuick();

// Run comprehensive benchmarks
await QuickBenchmark.runFull();

// Run specific category benchmarks
await QuickBenchmark.runCategory('search');
```

## Benchmark Categories

### 1. Database Operations (`database-ops`)

- Single vector insertion
- Batch vector insertion
- Vector retrieval
- Vector deletion
- Vector updates

### 2. Search Performance (`search`)

- K-nearest neighbor search
- Range search
- Filtered search with metadata
- Different distance metrics (cosine, euclidean, manhattan)
- Various dataset sizes and dimensions

### 3. Indexing (`indexing`)

- HNSW index building
- Index rebuilding
- Indexed vs linear search comparison
- Index persistence performance

### 4. Vector Formats (`formats`)

- Format detection
- Format conversion
- Validation performance
- Different typed arrays (Float32Array, Float64Array, Int8Array, Uint8Array)

### 5. Compression (`compression`)

- Scalar quantization
- Product quantization
- Compression ratio analysis
- Decompression performance

### 6. Memory Usage (`memory`)

- Memory consumption patterns
- Memory growth tracking
- Memory usage by operation type

### 7. Concurrency (`concurrency`)

- Concurrent search operations
- Concurrent insert operations
- Resource contention analysis

### 8. Stress Testing (`stress`)

- High-dimensional vectors
- Large datasets
- Sparse vectors
- Edge cases

## Configuration Options

```typescript
import { BenchmarkConfig, BenchmarkSuite } from 'vector-frankl';

const config: BenchmarkConfig = {
  // Test parameters
  dimensions: [128, 256, 512, 1024],
  datasetSizes: [100, 1000, 5000, 10000],
  distanceMetrics: ['cosine', 'euclidean', 'manhattan'],

  // Search parameters
  queryCount: 100,
  kValues: [1, 5, 10, 20],

  // Benchmark execution
  warmupIterations: 3,
  benchmarkIterations: 5,

  // Feature toggles
  trackMemory: true,
  testCompression: true,
  testFormats: true,
  testIndexing: true,
  verbose: true,
};

const suite = new BenchmarkSuite(config);
const results = await suite.runSuite();
```

## Output Formats

### Console Output (Default)

Provides human-readable results with:

- Performance summary by category
- Top performing tests
- Slowest tests
- Memory usage analysis
- Performance recommendations
- Failed test details

### JSON Output

Structured data format for analysis:

```typescript
import { BenchmarkRunner } from 'vector-frankl';

const runner = new BenchmarkRunner({
  outputFormat: 'json',
  exportPath: 'results.json',
});

await runner.run();
```

### CSV Output

Tabular format for spreadsheet analysis:

```typescript
const runner = new BenchmarkRunner({
  outputFormat: 'csv',
  exportPath: 'results.csv',
});

await runner.run();
```

## Performance Metrics

Each benchmark test measures:

- **Duration**: Time taken for operation (milliseconds)
- **Operations per Second**: Throughput metric
- **Memory Usage**: Heap and external memory consumption
- **Error Rate**: Failed operations
- **Metadata**: Test-specific context information

## CLI Usage

Run benchmarks from command line:

```bash
# Quick benchmark
bun run scripts/benchmark.ts

# Full benchmark suite
bun run scripts/benchmark.ts --full

# Category-specific benchmarks
bun run scripts/benchmark.ts --category search
bun run scripts/benchmark.ts --category indexing

# Export results
bun run scripts/benchmark.ts --export results.json --format json
```

## Interpreting Results

### Operations per Second (ops/sec)

- **Search**: 100+ ops/sec is good, 1000+ is excellent
- **Insert**: 500+ ops/sec is good, 2000+ is excellent
- **Database ops**: 1000+ ops/sec is typical

### Memory Usage

- Monitor heap growth for memory leaks
- External memory indicates efficient typed array usage
- Consider compression for high memory usage

### Performance Recommendations

The system automatically generates recommendations based on results:

- Index usage suggestions
- Compression recommendations
- Configuration optimizations

## Custom Benchmarks

Create your own benchmarks:

```typescript
import { BenchmarkSuite } from 'vector-frankl';

class CustomBenchmarkSuite extends BenchmarkSuite {
  async benchmarkCustomScenario() {
    await this.runBenchmark(
      'My Custom Test',
      'custom',
      async () => {
        // Your test logic here
      },
      { customMetadata: 'value' },
    );
  }
}
```

## Best Practices

1. **Consistent Environment**: Run benchmarks in consistent conditions
2. **Warmup**: Always include warmup iterations to stabilize JIT compilation
3. **Multiple Runs**: Use multiple iterations for statistical significance
4. **Realistic Data**: Use representative vector dimensions and dataset sizes
5. **Baseline Comparison**: Establish baseline performance for regression testing
6. **Resource Monitoring**: Monitor system resources during benchmarks

## Troubleshooting

### Common Issues

1. **Out of Memory**: Reduce dataset sizes or enable compression
2. **Slow Performance**: Check if indexing is enabled for large datasets
3. **Inconsistent Results**: Increase warmup and benchmark iterations
4. **Browser Crashes**: Reduce concurrency or dataset sizes

### Performance Optimization Tips

1. **Enable HNSW Indexing** for datasets > 1000 vectors
2. **Use Appropriate Distance Metrics** (cosine for normalized vectors)
3. **Consider Compression** for high-dimensional vectors
4. **Batch Operations** for better throughput
5. **Monitor Memory Usage** to prevent quota exceeded errors
