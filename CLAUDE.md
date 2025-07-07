# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Essential Commands

### Development

```bash
bun run dev                # Start development with watch mode
bun run build             # Build for production (outputs to dist/)
bun run start             # Run production build
```

### Testing

```bash
bun test                  # Run all tests
bun test src/utils        # Run tests in specific directory
bun test logger          # Run tests matching pattern
bun test --watch         # Watch mode
bun test --coverage      # Generate coverage report
```

### End-to-End Testing

```bash
bun run test:end-to-end             # Run all end-to-end tests
bun run test:end-to-end:ui          # Run with Playwright UI
bun run test:end-to-end:headed      # Run with visible browser
bun run test:end-to-end:chromium    # Run only in Chromium
bun run test:end-to-end:firefox     # Run only in Firefox
bun run test:end-to-end:webkit      # Run only in Safari/WebKit
bun run test:end-to-end:mobile      # Run on mobile browsers
bun run test:all                    # Run unit tests and end-to-end tests
```

### Code Quality

```bash
bun run lint             # Check linting errors
bun run lint:fix         # Auto-fix linting errors
bun run typecheck        # TypeScript type checking
bun run format           # Format all files with Prettier
bun run format:check     # Check formatting without changes
```

### Utilities

```bash
bun run clean            # Clean build artifacts (dist/, coverage/, caches)
bun run check:env        # Validate .env against .env.example
```

### Performance & Benchmarking

```bash
bun run scripts/benchmark.ts        # Run quick performance benchmark
bun run scripts/benchmark.ts --full # Run comprehensive benchmark suite
```

## Architecture Overview

### Core Design Principles

1. **Type Safety First**: All code runs with TypeScript strict mode (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`). Zero TypeScript errors are tolerated.

2. **Security by Design**: Input validation, ReDoS protection, memory guards, and WASM integrity checks are built into the core architecture.

3. **Performance Optimized**: Synchronous vector operations where possible, avoiding unnecessary async/await overhead. 30-50% performance improvements achieved.

4. **Browser-First Database**: Built entirely on IndexedDB with namespace isolation, quota management, and eviction policies.

### Key Architectural Decisions

- **Vector Operations**: All basic vector operations (dot product, magnitude, normalize) are synchronous for performance
- **Security Hardening**: InputValidator class validates all user inputs, metadata filters protect against regex injection
- **Memory Management**: Vector size limits (100k dimensions, 512MB max per vector) prevent exhaustion attacks
- **WASM Safety**: All WASM modules validated for integrity before loading
- **Error Sanitization**: Sensitive data automatically redacted from error contexts

### Git Hooks Architecture

The `.husky/` directory contains sophisticated git hooks:

- **utilities.sh**: Shared functions for colorful output, CI detection, and performance timing
- **Helper scripts**: `check-secrets.sh`, `check-dependencies.sh`, `validate-environment.sh`
- Hooks automatically skip in CI environments and run checks in parallel where possible

### Type System Architecture

The codebase leverages TypeScript's strict mode for maximum safety:

- **Exact Optional Properties**: All optional properties must be explicitly defined or omitted
- **Indexed Access Safety**: All array/object access checked for undefined values
- **Non-null Assertions**: Used only after explicit bounds checking
- **Type Guards**: Comprehensive runtime type validation for all external inputs

## Development Patterns

### Vector Database Architecture

```
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│   Simple API    │  │  Namespace API  │  │   Worker Pool   │
│   (VectorDB)    │  │ (VectorFrankl)  │  │                 │
└─────────┬───────┘  └─────────┬───────┘  └─────────┬───────┘
          └──────────┬─────────┴────────────────────┘
                     ▼
         ┌───────────────────────┐
         │   Security Layer      │ (Input validation, ReDoS protection)
         └───────────┬───────────┘
                     ▼
         ┌───────────────────────┐
         │   Search Engine       │ (HNSW index, distance metrics)
         └───────────┬───────────┘
                     ▼
         ┌───────────────────────┐
         │   Vector Storage      │ (IndexedDB, compression, eviction)
         └───────────────────────┘
```

### Adding New Features

1. **Input Validation**: All user inputs must pass through `InputValidator` class
2. **Vector Operations**: Prefer synchronous operations for performance
3. **Memory Safety**: Check vector dimensions against limits before processing
4. **Error Handling**: Use VectorDBError with proper error codes and sanitized contexts

### Testing & Security

- **Type Safety**: Run `bun run typecheck` to ensure zero TypeScript errors
- **Security Checks**: All regex patterns validated against ReDoS attacks
- **Memory Testing**: Verify operations stay within memory limits
- **Performance Benchmarks**: Use `BenchmarkSuite` for comprehensive testing
- **Input Fuzzing**: Test with malformed inputs to ensure proper validation

### Security Best Practices

1. **Input Validation**: Always validate vector IDs, dimensions, and metadata
2. **Regex Safety**: Use `MetadataFilter.safeRegexTest()` for pattern matching
3. **Memory Limits**: Respect `MAX_VECTOR_DIMENSION` and `MAX_MEMORY_PER_VECTOR`
4. **WASM Validation**: All WASM modules must pass integrity checks
5. **Error Context**: Never expose sensitive data in error messages

## Bun-Specific Considerations

- Always use `bun` commands, not `npm` or `yarn`
- Prefer Bun's built-in APIs (e.g., `Bun.serve()` over Express)
- The lockfile is `bun.lockb` (binary format)
- Bun provides native TypeScript execution without compilation
- Use `bunx` for one-off package execution (like `npx`)

### Bun-Optimized Utilities

The codebase includes Bun-specific utilities for maximum performance:

1. **File Operations** (`src/utilities/bun-file.ts`):

   - `readFile()`, `writeFile()` - Using Bun.file() and Bun.write()
   - `readJSON()`, `writeJSON()` - Native JSON parsing
   - `getFileHash()` - Using Bun.CryptoHasher
   - `streamFile()` - Efficient file streaming

2. **Shell Operations** (`src/utilities/bun-shell.ts`):

   - `exec()`, `execSync()` - Cross-platform command execution
   - `commandExists()` - Check command availability
   - `execParallel()` - Run commands in parallel
   - `createTaskRunner()` - Simple task runner

3. **Performance** (`src/utilities/bun-performance.ts`):
   - `PerformanceTimer` - High-resolution timing with Bun.nanoseconds()
   - `measureAsync()`, `measureSync()` - Function timing
   - `createPerformanceMonitor()` - Statistical performance tracking
   - `forceGC()` - Manual garbage collection with Bun.gc()

### Configuration Optimizations

- **bunfig.toml**: Configured with aggressive minification, tree-shaking, and dead code elimination
- **TypeScript**: Removed Node.js types, using only Bun types
- **Testing**: Parallel test execution enabled by default
- **No peerDependencies**: TypeScript runs natively in Bun

## Vector Database Features

### Core Capabilities

- **Multiple Vector Formats**: Float32Array, Float64Array, Int8Array, Uint8Array, regular arrays
- **Distance Metrics**: Cosine, Euclidean, Manhattan, Hamming, Jaccard
- **Compression**: Scalar quantization, product quantization, binary compression
- **Indexing**: HNSW for fast approximate search, automatic strategy selection
- **Storage Management**: Quota monitoring, LRU/LFU/TTL eviction policies

### Performance Acceleration

- **SIMD Operations**: Automatic detection and fallback
- **WebGPU**: GPU-accelerated similarity search
- **WebAssembly**: High-performance vector operations
- **Web Workers**: Parallel processing with worker pools

### API Examples

```typescript
// Simple API
const db = new VectorDB('my-vectors', 384);
await db.init();
await db.addVector('doc1', embedding, { category: 'AI' });
const results = await db.search(queryVector, 5);

// Namespace API
const vf = new VectorFrankl();
await vf.init();
const products = await vf.createNamespace('products', {
  dimension: 384,
  distanceMetric: 'cosine',
});
```

## CI/CD Pipeline

The GitHub Actions workflow (`verify.yml`) includes:

- Parallel execution of tests, linting, and builds
- TypeScript strict mode checking (zero errors required)
- Security scanning with CodeQL
- Memory usage validation
- Performance regression testing
