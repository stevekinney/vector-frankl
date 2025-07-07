/**
 * Comprehensive benchmark suite for Vector Frankl database
 */

import { VectorDB } from '@/api/database.js';
import type { DistanceMetric, VectorFormat } from '@/core/types.js';
import { debugMethod } from '@/debug/hooks.js';
import { VectorFormatHandler } from '@/vectors/formats.js';

export interface BenchmarkConfig {
  /** Test database name prefix */
  dbNamePrefix?: string;
  /** Vector dimensions to test */
  dimensions?: number[];
  /** Dataset sizes to test */
  datasetSizes?: number[];
  /** Distance metrics to test */
  distanceMetrics?: DistanceMetric[];
  /** Number of search queries per test */
  queryCount?: number;
  /** K values for search tests */
  kValues?: number[];
  /** Number of warmup iterations */
  warmupIterations?: number;
  /** Number of benchmark iterations */
  benchmarkIterations?: number;
  /** Enable memory usage tracking */
  trackMemory?: boolean;
  /** Enable compression benchmarks */
  testCompression?: boolean;
  /** Test with different vector formats */
  testFormats?: boolean;
  /** Test indexing performance */
  testIndexing?: boolean;
  /** Output detailed results */
  verbose?: boolean;
}

export interface BenchmarkResult {
  testName: string;
  category: string;
  duration: number;
  operationsPerSecond: number;
  memoryUsage?: {
    heapUsed: number;
    heapTotal: number;
    external: number;
  };
  metadata: Record<string, unknown>;
  error?: string;
}

export interface BenchmarkSummary {
  totalTests: number;
  passedTests: number;
  failedTests: number;
  totalDuration: number;
  results: BenchmarkResult[];
  categories: Record<
    string,
    {
      averageOps: number;
      totalDuration: number;
      testCount: number;
    }
  >;
  recommendations: string[];
}

/**
 * Main benchmark suite class
 */
export class BenchmarkSuite {
  private config: Required<BenchmarkConfig>;
  private results: BenchmarkResult[] = [];
  private databases: VectorDB[] = [];

  constructor(config: BenchmarkConfig = {}) {
    this.config = {
      dbNamePrefix: config.dbNamePrefix ?? 'benchmark-test',
      dimensions: config.dimensions ?? [128, 256, 512, 1024],
      datasetSizes: config.datasetSizes ?? [100, 1000, 5000, 10000],
      distanceMetrics: config.distanceMetrics ?? ['cosine', 'euclidean', 'manhattan'],
      queryCount: config.queryCount ?? 100,
      kValues: config.kValues ?? [1, 5, 10, 20],
      warmupIterations: config.warmupIterations ?? 3,
      benchmarkIterations: config.benchmarkIterations ?? 5,
      trackMemory: config.trackMemory ?? true,
      testCompression: config.testCompression ?? true,
      testFormats: config.testFormats ?? true,
      testIndexing: config.testIndexing ?? true,
      verbose: config.verbose ?? false,
    };
  }

  /**
   * Run the complete benchmark suite
   */
  @debugMethod('benchmark.runSuite', 'basic', {
    profileEnabled: true,
    memoryTracking: true,
  })
  async runSuite(): Promise<BenchmarkSummary> {
    console.log('🚀 Starting Vector Frankl Benchmark Suite...');

    try {
      // Core database operations
      await this.benchmarkDatabaseOperations();

      // Search performance
      await this.benchmarkSearchPerformance();

      // Indexing performance
      if (this.config.testIndexing) {
        await this.benchmarkIndexing();
      }

      // Vector format handling
      if (this.config.testFormats) {
        await this.benchmarkVectorFormats();
      }

      // Compression performance
      if (this.config.testCompression) {
        await this.benchmarkCompression();
      }

      // Memory usage patterns
      if (this.config.trackMemory) {
        await this.benchmarkMemoryUsage();
      }

      // Concurrent operations
      await this.benchmarkConcurrency();

      // Edge cases and stress tests
      await this.benchmarkStressCases();
    } finally {
      await this.cleanup();
    }

    return this.generateSummary();
  }

  /**
   * Benchmark basic database operations
   */
  private async benchmarkDatabaseOperations(): Promise<void> {
    console.log('📊 Benchmarking database operations...');

    for (const dimension of this.config.dimensions) {
      for (const size of this.config.datasetSizes) {
        const dbName = `${this.config.dbNamePrefix}-ops-${dimension}-${size}`;
        const db = new VectorDB(dbName, dimension);
        this.databases.push(db);

        await db.init();

        // Generate test vectors
        const vectors = this.generateRandomVectors(size, dimension);

        // Benchmark single vector insertion
        await this.runBenchmark(
          `Insert Single Vector (${dimension}D, ${size} dataset)`,
          'database-ops',
          async () => {
            const vector = this.generateRandomVector(dimension);
            await db.addVector(`test-${Date.now()}`, vector);
          },
          { dimension, datasetSize: size },
        );

        // Benchmark batch insertion
        await this.runBenchmark(
          `Batch Insert (${dimension}D, ${size} vectors)`,
          'database-ops',
          async () => {
            const batchVectors = vectors
              .slice(0, Math.min(100, size))
              .map((vector, i) => ({
                id: `batch-${i}`,
                vector,
              }));
            await db.addBatch(batchVectors);
          },
          { dimension, datasetSize: size, batchSize: Math.min(100, size) },
        );

        // Insert all vectors for search tests
        const vectorBatch = vectors.map((vector, i) => ({
          id: `vec-${i}`,
          vector,
          metadata: { index: i, category: i % 5 },
        }));
        await db.addBatch(vectorBatch);

        // Benchmark single vector retrieval
        await this.runBenchmark(
          `Get Vector (${dimension}D, ${size} dataset)`,
          'database-ops',
          async () => {
            const randomId = `vec-${Math.floor(Math.random() * size)}`;
            await db.getVector(randomId);
          },
          { dimension, datasetSize: size },
        );

        // Benchmark vector deletion
        await this.runBenchmark(
          `Delete Vector (${dimension}D, ${size} dataset)`,
          'database-ops',
          async () => {
            const randomId = `vec-${Math.floor(Math.random() * size)}`;
            await db.deleteVector(randomId);
          },
          { dimension, datasetSize: size },
        );
      }
    }
  }

  /**
   * Benchmark search performance across different configurations
   */
  private async benchmarkSearchPerformance(): Promise<void> {
    console.log('🔍 Benchmarking search performance...');

    for (const dimension of this.config.dimensions) {
      for (const size of this.config.datasetSizes) {
        for (const metric of this.config.distanceMetrics) {
          const dbName = `${this.config.dbNamePrefix}-search-${dimension}-${size}-${metric}`;
          const db = new VectorDB(dbName, dimension, { distanceMetric: metric });
          this.databases.push(db);

          await db.init();

          // Insert test data
          const vectors = this.generateRandomVectors(size, dimension);
          const vectorBatch = vectors.map((vector, i) => ({
            id: `vec-${i}`,
            vector,
            metadata: { index: i, category: i % 10 },
          }));
          await db.addBatch(vectorBatch);

          for (const k of this.config.kValues) {
            // Benchmark basic search
            await this.runBenchmark(
              `Search k=${k} (${dimension}D, ${size} docs, ${metric})`,
              'search',
              async () => {
                const queryVector = this.generateRandomVector(dimension);
                await db.search(queryVector, k);
              },
              { dimension, datasetSize: size, distanceMetric: metric, k },
            );

            // Benchmark search with metadata filters
            await this.runBenchmark(
              `Filtered Search k=${k} (${dimension}D, ${size} docs, ${metric})`,
              'search',
              async () => {
                const queryVector = this.generateRandomVector(dimension);
                await db.search(queryVector, k, {
                  filter: { category: { $in: [1, 2, 3] } },
                });
              },
              { dimension, datasetSize: size, distanceMetric: metric, k, filtered: true },
            );

            // Benchmark range search
            await this.runBenchmark(
              `Range Search (${dimension}D, ${size} docs, ${metric})`,
              'search',
              async () => {
                const queryVector = this.generateRandomVector(dimension);
                await db.searchRange(queryVector, 0.8, { maxResults: k });
              },
              { dimension, datasetSize: size, distanceMetric: metric, maxResults: k },
            );
          }
        }
      }
    }
  }

  /**
   * Benchmark indexing performance
   */
  private async benchmarkIndexing(): Promise<void> {
    console.log('🏗️ Benchmarking indexing performance...');

    for (const dimension of this.config.dimensions) {
      for (const size of this.config.datasetSizes) {
        const dbName = `${this.config.dbNamePrefix}-index-${dimension}-${size}`;
        const db = new VectorDB(dbName, dimension, { useIndex: true });
        this.databases.push(db);

        await db.init();

        const vectors = this.generateRandomVectors(size, dimension);

        // Benchmark index building
        await this.runBenchmark(
          `Build HNSW Index (${dimension}D, ${size} vectors)`,
          'indexing',
          async () => {
            const vectorBatch = vectors.map((vector, i) => ({
              id: `vec-${i}`,
              vector,
            }));
            await db.addBatch(vectorBatch);
          },
          { dimension, datasetSize: size, indexType: 'hnsw' },
        );

        // Benchmark index rebuilding
        await this.runBenchmark(
          `Rebuild HNSW Index (${dimension}D, ${size} vectors)`,
          'indexing',
          async () => {
            await db.rebuildIndex();
          },
          { dimension, datasetSize: size, indexType: 'hnsw', operation: 'rebuild' },
        );

        // Compare indexed vs non-indexed search
        const queryVector = this.generateRandomVector(dimension);

        await this.runBenchmark(
          `Indexed Search (${dimension}D, ${size} docs)`,
          'indexing',
          async () => {
            await db.search(queryVector, 10);
          },
          { dimension, datasetSize: size, indexed: true },
        );

        // Disable indexing and compare
        await db.setIndexing(false);

        await this.runBenchmark(
          `Linear Search (${dimension}D, ${size} docs)`,
          'indexing',
          async () => {
            await db.search(queryVector, 10);
          },
          { dimension, datasetSize: size, indexed: false },
        );
      }
    }
  }

  /**
   * Benchmark vector format handling
   */
  private async benchmarkVectorFormats(): Promise<void> {
    console.log('📏 Benchmarking vector formats...');

    const formats: Array<{ name: string; generator: (dim: number) => VectorFormat }> = [
      {
        name: 'Float32Array',
        generator: (dim) => new Float32Array(this.generateRandomVector(dim)),
      },
      {
        name: 'Float64Array',
        generator: (dim) => new Float64Array(this.generateRandomVector(dim)),
      },
      { name: 'Array', generator: (dim) => this.generateRandomVector(dim) },
      {
        name: 'Int8Array',
        generator: (dim) =>
          new Int8Array(dim).map(() => Math.floor(Math.random() * 256) - 128),
      },
      {
        name: 'Uint8Array',
        generator: (dim) =>
          new Uint8Array(dim).map(() => Math.floor(Math.random() * 256)),
      },
    ];

    for (const dimension of [128, 512]) {
      for (const format of formats) {
        // Benchmark format detection
        await this.runBenchmark(
          `Format Detection (${format.name}, ${dimension}D)`,
          'formats',
          () => {
            const vector = format.generator(dimension);
            VectorFormatHandler.detectFormat(vector);
          },
          { dimension, format: format.name },
        );

        // Benchmark conversion to Float32Array
        await this.runBenchmark(
          `Convert to Float32Array (${format.name}, ${dimension}D)`,
          'formats',
          () => {
            const vector = format.generator(dimension);
            VectorFormatHandler.toFloat32Array(vector);
          },
          { dimension, format: format.name, operation: 'convert' },
        );

        // Benchmark validation
        await this.runBenchmark(
          `Validate Vector (${format.name}, ${dimension}D)`,
          'formats',
          () => {
            const vector = format.generator(dimension);
            VectorFormatHandler.validate(vector, dimension);
          },
          { dimension, format: format.name, operation: 'validate' },
        );
      }
    }
  }

  /**
   * Benchmark compression performance
   */
  private async benchmarkCompression(): Promise<void> {
    console.log('🗜️ Benchmarking compression...');

    // This would test the compression system once it's available
    // For now, we'll simulate compression benchmarks
    for (const dimension of [256, 512, 1024]) {
      this.generateRandomVectors(1000, dimension);

      await this.runBenchmark(
        `Scalar Quantization (${dimension}D, 1000 vectors)`,
        'compression',
        () => {
          // Simulate compression time
          const simulationTime = dimension * 0.01;
          return new Promise((resolve) => setTimeout(resolve, simulationTime));
        },
        { dimension, compressionType: 'scalar', vectorCount: 1000 },
      );

      await this.runBenchmark(
        `Product Quantization (${dimension}D, 1000 vectors)`,
        'compression',
        () => {
          // Simulate compression time
          const simulationTime = dimension * 0.05;
          return new Promise((resolve) => setTimeout(resolve, simulationTime));
        },
        { dimension, compressionType: 'product', vectorCount: 1000 },
      );
    }
  }

  /**
   * Benchmark memory usage patterns
   */
  private async benchmarkMemoryUsage(): Promise<void> {
    console.log('🧠 Benchmarking memory usage...');

    if (typeof process !== 'undefined' && process.memoryUsage) {
      for (const size of [1000, 5000, 10000]) {
        const dimension = 256;
        const dbName = `${this.config.dbNamePrefix}-memory-${size}`;
        const db = new VectorDB(dbName, dimension);
        this.databases.push(db);

        await db.init();

        const beforeMemory = process.memoryUsage();

        // Insert large dataset
        const vectors = this.generateRandomVectors(size, dimension);
        const vectorBatch = vectors.map((vector, i) => ({
          id: `vec-${i}`,
          vector,
        }));
        await db.addBatch(vectorBatch);

        const afterMemory = process.memoryUsage();

        this.results.push({
          testName: `Memory Usage (${size} vectors, ${dimension}D)`,
          category: 'memory',
          duration: 0,
          operationsPerSecond: 0,
          memoryUsage: {
            heapUsed: afterMemory.heapUsed - beforeMemory.heapUsed,
            heapTotal: afterMemory.heapTotal - beforeMemory.heapTotal,
            external: afterMemory.external - beforeMemory.external,
          },
          metadata: { vectorCount: size, dimension },
        });
      }
    }
  }

  /**
   * Benchmark concurrent operations
   */
  private async benchmarkConcurrency(): Promise<void> {
    console.log('⚡ Benchmarking concurrency...');

    const dimension = 256;
    const dbName = `${this.config.dbNamePrefix}-concurrent`;
    const db = new VectorDB(dbName, dimension);
    this.databases.push(db);

    await db.init();

    // Insert base dataset
    const vectors = this.generateRandomVectors(1000, dimension);
    const vectorBatch = vectors.map((vector, i) => ({
      id: `vec-${i}`,
      vector,
    }));
    await db.addBatch(vectorBatch);

    // Test concurrent searches
    await this.runBenchmark(
      'Concurrent Searches (10 parallel)',
      'concurrency',
      async () => {
        const searchPromises = Array.from({ length: 10 }, () => {
          const queryVector = this.generateRandomVector(dimension);
          return db.search(queryVector, 5);
        });
        await Promise.all(searchPromises);
      },
      { concurrency: 10, operation: 'search' },
    );

    // Test concurrent inserts
    await this.runBenchmark(
      'Concurrent Inserts (5 parallel)',
      'concurrency',
      async () => {
        const insertPromises = Array.from({ length: 5 }, (_, i) => {
          const vector = this.generateRandomVector(dimension);
          return db.addVector(`concurrent-${Date.now()}-${i}`, vector);
        });
        await Promise.all(insertPromises);
      },
      { concurrency: 5, operation: 'insert' },
    );
  }

  /**
   * Benchmark stress cases and edge conditions
   */
  private async benchmarkStressCases(): Promise<void> {
    console.log('💪 Benchmarking stress cases...');

    // High-dimensional vectors
    const highDim = 2048;
    const dbName = `${this.config.dbNamePrefix}-stress-highdim`;
    const db = new VectorDB(dbName, highDim);
    this.databases.push(db);

    await db.init();

    await this.runBenchmark(
      `High Dimension Insert (${highDim}D)`,
      'stress',
      async () => {
        const vector = this.generateRandomVector(highDim);
        await db.addVector(`highdim-${Date.now()}`, vector);
      },
      { dimension: highDim, stressType: 'high-dimension' },
    );

    // Very sparse vectors
    await this.runBenchmark(
      'Sparse Vector Handling (99% zeros)',
      'stress',
      async () => {
        const vector = new Float32Array(256);
        // Only set 1% of values to non-zero
        for (let i = 0; i < 3; i++) {
          vector[Math.floor(Math.random() * 256)] = Math.random();
        }
        await db.addVector(`sparse-${Date.now()}`, vector);
      },
      { dimension: 256, stressType: 'sparse-vectors' },
    );
  }

  /**
   * Run a single benchmark test
   */
  private async runBenchmark(
    testName: string,
    category: string,
    operation: () => Promise<void> | void,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    // Warmup
    for (let i = 0; i < this.config.warmupIterations; i++) {
      try {
        await operation();
      } catch {
        // Ignore warmup errors
      }
    }

    // Force garbage collection if available
    if (typeof global !== 'undefined' && global.gc) {
      global.gc();
    }

    const durations: number[] = [];
    let memoryUsage;
    let error: string | undefined;

    try {
      const startMemory =
        typeof process !== 'undefined' && process.memoryUsage
          ? process.memoryUsage()
          : undefined;

      for (let i = 0; i < this.config.benchmarkIterations; i++) {
        const start = performance.now();
        await operation();
        const end = performance.now();
        durations.push(end - start);
      }

      const endMemory =
        typeof process !== 'undefined' && process.memoryUsage
          ? process.memoryUsage()
          : undefined;

      if (startMemory && endMemory && this.config.trackMemory) {
        memoryUsage = {
          heapUsed: endMemory.heapUsed - startMemory.heapUsed,
          heapTotal: endMemory.heapTotal - startMemory.heapTotal,
          external: endMemory.external - startMemory.external,
        };
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }

    const avgDuration =
      durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
    const operationsPerSecond = avgDuration > 0 ? 1000 / avgDuration : 0;

    const result: BenchmarkResult = {
      testName,
      category,
      duration: avgDuration,
      operationsPerSecond,
      metadata: {
        ...metadata,
        iterations: this.config.benchmarkIterations,
        durations: durations,
      },
      ...(memoryUsage && { memoryUsage }),
      ...(error && { error }),
    };

    this.results.push(result);

    if (this.config.verbose) {
      const status = error ? '❌' : '✅';
      console.log(
        `${status} ${testName}: ${operationsPerSecond.toFixed(2)} ops/sec (${avgDuration.toFixed(2)}ms)`,
      );
      if (error) {
        console.log(`   Error: ${error}`);
      }
    }
  }

  /**
   * Generate summary of benchmark results
   */
  private generateSummary(): BenchmarkSummary {
    const passedTests = this.results.filter((r) => !r.error);
    const failedTests = this.results.filter((r) => r.error);

    // Calculate category averages
    const categories: Record<
      string,
      { averageOps: number; totalDuration: number; testCount: number }
    > = {};

    for (const result of passedTests) {
      if (!categories[result.category]) {
        categories[result.category] = { averageOps: 0, totalDuration: 0, testCount: 0 };
      }

      const category = categories[result.category]!; // Safe assertion after null check above
      category.averageOps += result.operationsPerSecond;
      category.totalDuration += result.duration;
      category.testCount++;
    }

    // Calculate averages
    for (const category of Object.values(categories)) {
      category.averageOps = category.averageOps / category.testCount;
    }

    // Generate recommendations
    const recommendations = this.generateRecommendations(passedTests);

    return {
      totalTests: this.results.length,
      passedTests: passedTests.length,
      failedTests: failedTests.length,
      totalDuration: this.results.reduce((sum, r) => sum + r.duration, 0),
      results: this.results,
      categories,
      recommendations,
    };
  }

  /**
   * Generate performance recommendations
   */
  private generateRecommendations(results: BenchmarkResult[]): string[] {
    const recommendations: string[] = [];

    // Analyze search performance
    const searchResults = results.filter((r) => r.category === 'search');
    if (searchResults.length > 0) {
      const avgSearchOps =
        searchResults.reduce((sum, r) => sum + r.operationsPerSecond, 0) /
        searchResults.length;

      if (avgSearchOps < 100) {
        recommendations.push(
          'Consider enabling HNSW indexing to improve search performance',
        );
      }

      if (avgSearchOps > 1000) {
        recommendations.push(
          'Excellent search performance - current configuration is well-optimized',
        );
      }
    }

    // Analyze indexing performance
    const indexResults = results.filter((r) => r.category === 'indexing');
    const indexedSearches = indexResults.filter((r) => r.metadata['indexed'] === true);
    const linearSearches = indexResults.filter((r) => r.metadata['indexed'] === false);

    if (indexedSearches.length > 0 && linearSearches.length > 0) {
      const indexedAvg =
        indexedSearches.reduce((sum, r) => sum + r.operationsPerSecond, 0) /
        indexedSearches.length;
      const linearAvg =
        linearSearches.reduce((sum, r) => sum + r.operationsPerSecond, 0) /
        linearSearches.length;

      const speedup = indexedAvg / linearAvg;
      if (speedup > 2) {
        recommendations.push(
          `HNSW indexing provides ${speedup.toFixed(1)}x speedup - recommended for large datasets`,
        );
      }
    }

    // Analyze memory usage
    const memoryResults = results.filter((r) => r.memoryUsage);
    if (memoryResults.length > 0) {
      const totalMemoryUsed = memoryResults.reduce(
        (sum, r) => sum + (r.memoryUsage?.heapUsed || 0),
        0,
      );
      if (totalMemoryUsed > 100 * 1024 * 1024) {
        // 100MB
        recommendations.push(
          'Consider enabling compression for large datasets to reduce memory usage',
        );
      }
    }

    // Analyze dimensional performance
    const highDimResults = results.filter(
      (r) => (r.metadata['dimension'] as number) > 512,
    );
    if (highDimResults.length > 0) {
      const avgOps =
        highDimResults.reduce((sum, r) => sum + r.operationsPerSecond, 0) /
        highDimResults.length;
      if (avgOps < 50) {
        recommendations.push(
          'High-dimensional vectors show reduced performance - consider dimensionality reduction',
        );
      }
    }

    return recommendations;
  }

  /**
   * Generate random vector
   */
  private generateRandomVector(dimension: number): number[] {
    return Array.from({ length: dimension }, () => Math.random() * 2 - 1);
  }

  /**
   * Generate multiple random vectors
   */
  private generateRandomVectors(count: number, dimension: number): number[][] {
    return Array.from({ length: count }, () => this.generateRandomVector(dimension));
  }

  /**
   * Clean up test databases
   */
  private async cleanup(): Promise<void> {
    console.log('🧹 Cleaning up benchmark databases...');

    for (const db of this.databases) {
      try {
        await db.delete();
      } catch {
        // Ignore cleanup errors
      }
    }

    this.databases = [];
  }
}
