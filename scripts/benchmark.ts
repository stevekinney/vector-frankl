#!/usr/bin/env bun

/**
 * Benchmark runner script for Vector Frankl
 * 
 * Usage:
 *   bun run scripts/benchmark.ts [options]
 *   
 * Examples:
 *   bun run scripts/benchmark.ts                    # Quick benchmark
 *   bun run scripts/benchmark.ts --full             # Full benchmark suite
 *   bun run scripts/benchmark.ts --category search  # Search benchmarks only
 *   bun run scripts/benchmark.ts --export results.json --format json
 */

import { QuickBenchmark } from '../src/benchmarks/index.js';

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  full: args.includes('--full'),
  category: args.includes('--category') ? args[args.indexOf('--category') + 1] : null,
  export: args.includes('--export') ? args[args.indexOf('--export') + 1] : null,
  format: args.includes('--format') ? args[args.indexOf('--format') + 1] : 'console',
  help: args.includes('--help') || args.includes('-h')
};

if (options.help) {
  console.log(`
Vector Frankl Benchmark Runner

Usage: bun run scripts/benchmark.ts [options]

Options:
  --full                 Run comprehensive benchmark suite
  --category <name>      Run benchmarks for specific category (search, database-ops, indexing, formats, compression)
  --export <path>        Export results to file
  --format <format>      Output format (console, json, csv)
  --help, -h             Show this help message

Examples:
  bun run scripts/benchmark.ts                      # Quick benchmark
  bun run scripts/benchmark.ts --full               # Full benchmark suite
  bun run scripts/benchmark.ts --category search    # Search benchmarks only
  bun run scripts/benchmark.ts --export results.json --format json
`);
  process.exit(0);
}

async function main() {
  try {
    console.log('🚀 Vector Frankl Performance Benchmarks\n');
    
    if (options.category) {
      console.log(`Running ${options.category} benchmarks...\n`);
      const validCategories = ['search', 'database-ops', 'indexing', 'formats', 'compression'] as const;
      type CategoryType = typeof validCategories[number];
      
      if (!validCategories.includes(options.category as CategoryType)) {
        console.error(`❌ Invalid category: ${options.category}`);
        console.error(`Valid categories are: ${validCategories.join(', ')}`);
        process.exit(1);
      }
      
      await QuickBenchmark.runCategory(options.category as CategoryType);
    } else if (options.full) {
      console.log('Running comprehensive benchmark suite...\n');
      await QuickBenchmark.runFull();
    } else {
      console.log('Running quick benchmark...\n');
      await QuickBenchmark.runQuick();
    }
    
    console.log('\n✅ Benchmarks completed successfully!');
    
  } catch (error) {
    console.error('\n❌ Benchmark failed:', error);
    process.exit(1);
  }
}

// Run if this file is executed directly
if (import.meta.main) {
  void main();
}