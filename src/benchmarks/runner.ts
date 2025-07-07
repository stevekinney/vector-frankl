/**
 * Benchmark runner and CLI interface
 */

import { BenchmarkSuite, type BenchmarkConfig, type BenchmarkSummary } from './benchmark-suite.js';
import type { DistanceMetric } from '@/core/types.js';

export interface BenchmarkRunnerOptions {
  /** Configuration for the benchmark suite */
  config?: BenchmarkConfig;
  /** Output format */
  outputFormat?: 'console' | 'json' | 'csv';
  /** Export results to file */
  exportPath?: string;
  /** Run only specific categories */
  categories?: string[];
  /** Skip cleanup after tests */
  skipCleanup?: boolean;
}

/**
 * Benchmark runner with various output formats
 */
export class BenchmarkRunner {
  private suite: BenchmarkSuite;
  private options: BenchmarkRunnerOptions;

  constructor(options: BenchmarkRunnerOptions = {}) {
    this.options = options;
    this.suite = new BenchmarkSuite(options.config);
  }

  /**
   * Run benchmarks with specified options
   */
  async run(): Promise<BenchmarkSummary> {
    const startTime = Date.now();
    
    console.log('🎯 Vector Frankl Performance Benchmark Suite');
    console.log('============================================');
    console.log();
    
    try {
      const summary = await this.suite.runSuite();
      
      const endTime = Date.now();
      const totalTime = endTime - startTime;
      
      console.log();
      console.log('📈 Benchmark Results Summary');
      console.log('============================');
      
      await this.outputResults(summary, totalTime);
      
      return summary;
    } catch (error) {
      console.error('❌ Benchmark suite failed:', error);
      throw error;
    }
  }

  /**
   * Output results in specified format
   */
  private async outputResults(summary: BenchmarkSummary, totalTime: number): Promise<void> {
    switch (this.options.outputFormat) {
      case 'json':
        await this.outputJSON(summary, totalTime);
        break;
      case 'csv':
        await this.outputCSV(summary, totalTime);
        break;
      default:
        this.outputConsole(summary, totalTime);
    }
  }

  /**
   * Output results to console
   */
  private outputConsole(summary: BenchmarkSummary, totalTime: number): void {
    console.log(`Total Tests: ${summary.totalTests}`);
    console.log(`Passed: ${summary.passedTests} ✅`);
    console.log(`Failed: ${summary.failedTests} ❌`);
    console.log(`Total Time: ${(totalTime / 1000).toFixed(2)}s`);
    console.log();
    
    // Category performance overview
    console.log('📊 Performance by Category:');
    console.log('---------------------------');
    for (const [category, stats] of Object.entries(summary.categories)) {
      console.log(`${category.padEnd(15)}: ${stats.averageOps.toFixed(1)} ops/sec (${stats.testCount} tests)`);
    }
    console.log();
    
    // Top performing tests
    const topTests = summary.results
      .filter(r => !r.error)
      .sort((a, b) => b.operationsPerSecond - a.operationsPerSecond)
      .slice(0, 5);
    
    console.log('🏆 Top 5 Performing Tests:');
    console.log('---------------------------');
    topTests.forEach((test, i) => {
      console.log(`${i + 1}. ${test.testName}: ${test.operationsPerSecond.toFixed(1)} ops/sec`);
    });
    console.log();
    
    // Slowest tests
    const slowTests = summary.results
      .filter(r => !r.error)
      .sort((a, b) => a.operationsPerSecond - b.operationsPerSecond)
      .slice(0, 5);
    
    console.log('🐌 Slowest 5 Tests:');
    console.log('--------------------');
    slowTests.forEach((test, i) => {
      console.log(`${i + 1}. ${test.testName}: ${test.operationsPerSecond.toFixed(1)} ops/sec`);
    });
    console.log();
    
    // Memory usage summary
    const memoryTests = summary.results.filter(r => r.memoryUsage);
    if (memoryTests.length > 0) {
      const totalMemory = memoryTests.reduce((sum, r) => sum + (r.memoryUsage?.heapUsed || 0), 0);
      console.log(`💾 Total Memory Impact: ${this.formatBytes(totalMemory)}`);
      console.log();
    }
    
    // Recommendations
    if (summary.recommendations.length > 0) {
      console.log('💡 Performance Recommendations:');
      console.log('--------------------------------');
      summary.recommendations.forEach((rec, i) => {
        console.log(`${i + 1}. ${rec}`);
      });
      console.log();
    }
    
    // Failed tests
    if (summary.failedTests > 0) {
      console.log('❌ Failed Tests:');
      console.log('----------------');
      const failedResults = summary.results.filter(r => r.error);
      failedResults.forEach(test => {
        console.log(`- ${test.testName}: ${test.error}`);
      });
      console.log();
    }
  }

  /**
   * Output results as JSON
   */
  private async outputJSON(summary: BenchmarkSummary, totalTime: number): Promise<void> {
    const output = {
      timestamp: new Date().toISOString(),
      totalRunTime: totalTime,
      summary,
      environment: {
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'Node.js',
        platform: typeof process !== 'undefined' ? process.platform : 'browser',
        nodeVersion: typeof process !== 'undefined' ? process.version : undefined
      }
    };
    
    const jsonOutput = JSON.stringify(output, null, 2);
    
    if (this.options.exportPath) {
      // In a real implementation, you'd write to file here
      console.log(`JSON results would be exported to: ${this.options.exportPath}`);
    }
    
    console.log(jsonOutput);
  }

  /**
   * Output results as CSV
   */
  private async outputCSV(summary: BenchmarkSummary, _totalTime: number): Promise<void> {
    const headers = [
      'testName',
      'category',
      'duration',
      'operationsPerSecond',
      'heapUsed',
      'heapTotal',
      'external',
      'error',
      'metadata'
    ];
    
    const rows = summary.results.map(result => [
      result.testName,
      result.category,
      result.duration.toString(),
      result.operationsPerSecond.toString(),
      (result.memoryUsage?.heapUsed || '').toString(),
      (result.memoryUsage?.heapTotal || '').toString(),
      (result.memoryUsage?.external || '').toString(),
      result.error || '',
      JSON.stringify(result.metadata)
    ]);
    
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');
    
    if (this.options.exportPath) {
      console.log(`CSV results would be exported to: ${this.options.exportPath}`);
    }
    
    console.log(csvContent);
  }

  /**
   * Format bytes in human readable format
   */
  private formatBytes(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    
    return `${size.toFixed(1)} ${units[unitIndex]}`;
  }
}

/**
 * Quick benchmark runner for specific scenarios
 */
export class QuickBenchmark {
  /**
   * Run a quick performance test with minimal configuration
   */
  static async runQuick(options: {
    dimensions?: number[];
    datasetSizes?: number[];
    distanceMetrics?: string[];
  } = {}): Promise<void> {
    const config: BenchmarkConfig = {
      dimensions: options.dimensions || [128, 256],
      datasetSizes: options.datasetSizes || [100, 1000],
      distanceMetrics: (options.distanceMetrics as DistanceMetric[]) || ['cosine'],
      queryCount: 10,
      kValues: [5],
      warmupIterations: 1,
      benchmarkIterations: 3,
      testCompression: false,
      testFormats: false,
      testIndexing: false,
      verbose: true
    };
    
    const runner = new BenchmarkRunner({
      config,
      outputFormat: 'console'
    });
    
    await runner.run();
  }

  /**
   * Run comprehensive benchmarks with all features
   */
  static async runFull(): Promise<void> {
    const runner = new BenchmarkRunner({
      config: {
        verbose: true
      },
      outputFormat: 'console'
    });
    
    await runner.run();
  }

  /**
   * Run benchmarks for specific categories
   */
  static async runCategory(category: 'search' | 'database-ops' | 'indexing' | 'formats' | 'compression'): Promise<void> {
    const config: BenchmarkConfig = {
      dimensions: [256],
      datasetSizes: [1000],
      verbose: true
    };
    
    // Adjust config based on category
    switch (category) {
      case 'search':
        config.testCompression = false;
        config.testFormats = false;
        config.testIndexing = false;
        break;
      case 'indexing':
        config.testCompression = false;
        config.testFormats = false;
        config.testIndexing = true;
        break;
      case 'formats':
        config.testCompression = false;
        config.testFormats = true;
        config.testIndexing = false;
        config.datasetSizes = [100]; // Smaller for format tests
        break;
      case 'compression':
        config.testCompression = true;
        config.testFormats = false;
        config.testIndexing = false;
        break;
    }
    
    const runner = new BenchmarkRunner({
      config,
      outputFormat: 'console'
    });
    
    await runner.run();
  }
}