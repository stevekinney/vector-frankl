# Vector Frankl

A vector database built on IndexedDB for browser-based storage, with pluggable storage adapters for server-side runtimes. Designed for AI-powered applications that need semantic search, vector similarity search, and machine learning workflows—especially in environments where latency, privacy, or offline access matter.

[![CI](https://github.com/stevekinney/vector-frankl/workflows/CI/badge.svg)](https://github.com/stevekinney/vector-frankl/actions)
[![TypeScript](https://img.shields.io/badge/TypeScript-100%25_Type_Safe-blue.svg)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-Optimized-yellow.svg)](https://bun.sh/)
[![Security](https://img.shields.io/badge/Security-Hardened-green.svg)](docs/SECURITY.md)

## Why Vector Frankl

**Browser-first, server-optional.** The core API defaults to IndexedDB with zero configuration, making client-side semantic search practical without a backend. Pluggable storage adapters let the same API run on SQLite, LevelDB, LMDB, Redis, S3, or the file system in Bun and Node when you need a server-side deployment.

**Performance through honest capability detection.** SIMD and WebGPU are used automatically when the environment supports them, with transparent fallback to scalar operations when they don't. The library reports which path it took rather than silently degrading.

**100% TypeScript, strict mode throughout.** Zero `any` escapes, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`. Types are not bolted on—they drive the API shape.

## Use Cases

Moving vector search compute to the browser unlocks use cases where latency, privacy, cost, or offline access are constraints. The tradeoff is index size and embedding compute, but with quantized models and WebGPU acceleration (where available), that ceiling keeps rising.

- **Privacy-first semantic search:** All embeddings stay on the user's device. Build a personal knowledge base, journal, or note-taking app where semantic search works entirely offline with zero data leaving the browser. Note that data is stored as **plaintext** in IndexedDB—it is not transmitted to a server, but it is readable by any same-origin script and by the underlying OS. See the [Encryption at Rest](docs/SECURITY.md#encryption-at-rest) section before storing sensitive content.

- **Offline-capable RAG:** Pair with a small local model ([WebLLM](https://github.com/mlc-ai/web-llm), [ONNX Runtime Web](https://onnxruntime.ai/docs/get-started/with-javascript/web.html)) for a fully client-side retrieval-augmented generation pipeline.

- **Personalized UI without a backend:** Embed user interactions as vectors and do nearest-neighbor lookups to surface contextually relevant UI elements or recommendations—without a single network request.

- **Cross-tab and cross-session memory:** IndexedDB persists across sessions and is shared across tabs for the same origin. Build assistants that accumulate semantic memory over time, entirely client-side.

- **Edge-computed semantic caching:** Cache LLM responses keyed by embedding similarity rather than exact string match, cutting API costs and latency for conversational UIs.

- **Federated or hybrid search:** Run a first-pass vector search locally against the user's personal corpus, then fan out to the server for the public corpus. Reduce server load while keeping personal data local.

- **Progressive enrichment:** As a user browses, background-embed page content into the local vector store, gradually building a personal semantic index of "everything I've read."

## Features

### Core Features

**Vector Storage & Management**

- **Pluggable Storage**: IndexedDB (browser default), SQLite, LevelDB, LMDB, Redis, S3, OPFS, Chrome Storage, file system, or in-memory
- **Multiple Vector Formats**: Float32Array, Float64Array, Int8Array, Uint8Array, and regular arrays
- **Similarity Search**: Brute-force and HNSW-indexed approximate search
- **Rich Metadata**: Attach and filter by custom metadata with advanced query support
- **Batch Operations**: Efficient bulk insert/update/delete with progress tracking

**Advanced Architecture**

- **Namespace Management**: Isolated vector collections with independent configurations
- **Multiple Distance Metrics**: Cosine, Euclidean, Manhattan, Hamming, Jaccard, and custom metrics
- **SIMD Acceleration**: Vectorized math operations with automatic capability detection and scalar fallback
- **WebGPU Acceleration**: GPU-accelerated similarity search via `GPUSearchEngine` (browser-dependent; falls back to CPU automatically)
- **Vector Compression**: Scalar quantization and product quantization
- **Background Processing**: Web Workers for parallel operations

**Developer Experience**

- **Full TypeScript Support**: 100% type-safe with strict mode, zero TypeScript errors
- **Debug & Profiling Tools**: Built-in performance monitoring and debugging utilities
- **Benchmarking Suite**: Comprehensive performance testing framework
- **Security First**: Input validation, ReDoS protection, and memory safeguards

### Storage Management

- **Quota Monitoring**: Track storage usage with automatic cleanup policies
- **Eviction Strategies**: LRU, LFU, TTL, score-based, and hybrid policies
- **Memory Management**: Shared memory pools for efficient data handling

### Search & Indexing

- **HNSW Index**: Hierarchical Navigable Small World graphs for fast approximate search
- **Index Persistence**: Save and load search indices for improved performance
- **Search Filters**: Complex metadata filtering with range queries and operators

## Production Readiness

Feature stability levels reflect the actual state of the implementation and its test coverage. Stability guarantees apply at the API level—interfaces marked **Stable** will not make breaking changes without a major version bump.

### Stable

These features are implemented, tested, and covered by CI.

| Feature                         | Description                                      |
| ------------------------------- | ------------------------------------------------ |
| `VectorDB`                      | Simple single-collection API                     |
| `VectorFrankl`                  | Namespace API for multi-collection use           |
| `MemoryStorageAdapter`          | In-memory storage for tests and ephemeral use    |
| `IndexedDatabaseStorageAdapter` | IndexedDB for browser persistence                |
| Distance metrics                | Cosine, Euclidean, Manhattan, Hamming, Jaccard   |
| `HNSWIndex`                     | Approximate nearest-neighbor indexing            |
| Metadata filtering              | Range queries, logical operators                 |
| Batch operations                | Insert, update, delete with progress callbacks   |
| Eviction policies               | LRU, LFU, TTL, score-based, hybrid               |
| Quota monitoring                | `StorageQuotaMonitor` for storage usage tracking |
| Compression                     | Scalar quantization, product quantization        |
| Error types                     | `VectorDatabaseError` and all subclasses         |

### Beta

These features are implemented and tested but depend on optional peer dependencies, specific runtimes, or browser capabilities that vary across environments.

| Feature                    | Description                          | Requirement                    |
| -------------------------- | ------------------------------------ | ------------------------------ |
| `OPFSStorageAdapter`       | Origin Private File System storage   | Browser with OPFS support      |
| `ChromeStorageAdapter`     | `chrome.storage` adapter             | Chrome extension context       |
| `SQLiteStorageAdapter`     | SQLite-backed storage                | Bun runtime                    |
| `FileSystemStorageAdapter` | File system (JSON files)             | Bun or Node.js                 |
| `LevelStorageAdapter`      | LevelDB via `level`                  | Optional peer dependency       |
| `LmdbStorageAdapter`       | LMDB via `lmdb`                      | Optional peer dependency       |
| `RedisStorageAdapter`      | Redis via `Bun.RedisClient`          | Bun runtime                    |
| `S3StorageAdapter`         | Object storage via `Bun.s3`          | Bun runtime                    |
| `GPUSearchEngine`          | WebGPU-accelerated similarity search | Browser with WebGPU support    |
| `SIMDOperations`           | WebAssembly SIMD vectorized math     | Browser/runtime with Wasm SIMD |
| `WorkerPool`               | Parallel search via Web Workers      | Browser with Worker support    |

### Experimental

These features are present in the codebase but are not complete or not fully integrated. Treat them as opt-in previews; their APIs may change.

| Feature                          | Description                                                                                                                                                                                                 |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WASMManager` / `WASMOperations` | WebAssembly capability detection and memory management. **No compiled vector-operation module is bundled.** The API exists for future integration; callers fall back to SIMD or scalar paths automatically. |
| `debugManager` / `profiler`      | Debug and profiling APIs under `vector-frankl/debug`. Functional but the interface is not yet finalized.                                                                                                    |

### Unsupported

These are not currently part of the public API and are not supported for external use.

| Area                    | Status                                                                             |
| ----------------------- | ---------------------------------------------------------------------------------- |
| Custom WASM modules     | No loader or interface for supplying a compiled WASM module is exposed             |
| Server-side IndexedDB   | IndexedDB requires a real browser environment; Node.js polyfills are not supported |
| React Native / Electron | Not tested; IndexedDB availability varies                                          |

## Prerequisites

- [Bun](https://bun.sh) >= 1.3.0
- Modern browser with IndexedDB support
- Chrome or Edge recommended for WebGPU acceleration (where used)

## Runtime Support

### Browser Support

Vector Frankl's browser-native path requires no build tooling beyond a standard
bundler. The minimum tested versions are:

| Browser             | Minimum Version | IndexedDB | OPFS    | WebGPU  | SIMD / WASM | SharedArrayBuffer | Workers |
| ------------------- | --------------- | --------- | ------- | ------- | ----------- | ----------------- | ------- |
| Chromium / Chrome   | 80              | ✅        | ✅ 86   | ✅ 113  | ✅ 91       | ✅ 92             | ✅      |
| Firefox             | 75              | ✅        | ✅ 111  | ❌ Beta | ✅ 89       | ✅ 79             | ✅      |
| Safari / WebKit     | 14.0            | ✅        | ✅ 15.2 | ❌ Beta | ✅ 16.4     | ✅ 15.2           | ✅      |
| Edge (Chromium)     | 80              | ✅        | ✅ 86   | ✅ 113  | ✅ 91       | ✅ 92             | ✅      |
| Chrome for Android  | 80              | ✅        | ✅ 86   | ❌      | ✅ 91       | ✅ 92             | ✅      |
| Firefox for Android | 79              | ✅        | ✅ 111  | ❌      | ✅ 89       | ✅ 79             | ✅      |
| Safari on iOS       | 14.0            | ✅        | ✅ 15.2 | ❌      | ✅ 16.4     | ✅ 15.2           | ✅      |

Notes:

- **WebGPU** is fully supported in Chrome/Edge 113+. Firefox and Safari ship
  WebGPU behind a flag as of mid-2026; Vector Frankl detects availability at
  runtime and falls back to SIMD or scalar operations automatically.
- **SharedArrayBuffer** requires a cross-origin-isolated context
  (`Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp`).
  Without it, the Worker pool runs without shared memory (slightly higher overhead).
- **Chrome extensions:** IndexedDB is unavailable in Manifest V3 background service
  workers. Use `ChromeStorageAdapter` (`chrome.storage.local`) instead.

### Server Runtime Support

| Runtime | Minimum Version | SQLite | File system | LevelDB | LMDB | Redis  | S3     |
| ------- | --------------- | ------ | ----------- | ------- | ---- | ------ | ------ |
| Bun     | 1.0             | ✅     | ✅          | ✅      | ✅   | ✅ 1.1 | ✅ 1.1 |
| Node.js | 18.0            | ❌     | ❌          | ✅      | ✅   | ❌     | ❌     |

Notes:

- `SQLiteStorageAdapter`, `FileSystemStorageAdapter`, `RedisStorageAdapter`, and
  `S3StorageAdapter` use Bun-native built-ins (`bun:sqlite`, `Bun.RedisClient`,
  `Bun.s3`). They throw at construction time if `typeof Bun === 'undefined'`.
- `LevelStorageAdapter` and `LmdbStorageAdapter` use optional peer dependencies
  (`level`, `lmdb`) and work in both Bun and Node.js ≥ 18.
- `MemoryStorageAdapter` and `IndexedDatabaseStorageAdapter` work in any runtime
  that has the required global (`Map` for memory; browser `indexedDB` global for
  IndexedDB).

### Storage Adapter Support

For full setup instructions, limits, persistence guarantees, concurrency behavior,
quota handling, and cleanup steps for each adapter, see [docs/ADAPTERS.md](docs/ADAPTERS.md).

| Adapter                         | Backend                    | Environment       | Peer dependency |
| ------------------------------- | -------------------------- | ----------------- | --------------- |
| `IndexedDatabaseStorageAdapter` | IndexedDB                  | Browser           | None            |
| `MemoryStorageAdapter`          | In-memory `Map`            | Any               | None            |
| `OPFSStorageAdapter`            | Origin Private File System | Browser           | None            |
| `ChromeStorageAdapter`          | `chrome.storage`           | Chrome extensions | None            |
| `SQLiteStorageAdapter`          | `bun:sqlite`               | Bun ≥ 1.0         | None            |
| `FileSystemStorageAdapter`      | File system (JSON/binary)  | Bun ≥ 1.0         | None            |
| `LevelStorageAdapter`           | LevelDB                    | Bun / Node ≥ 18   | `level`         |
| `LmdbStorageAdapter`            | LMDB                       | Bun / Node ≥ 18   | `lmdb`          |
| `RedisStorageAdapter`           | Redis                      | Bun ≥ 1.1         | None            |
| `S3StorageAdapter`              | S3 / S3-compatible         | Bun ≥ 1.1         | None            |

## Quick Start

### Installation

```bash
npm install vector-frankl
# or
bun add vector-frankl
```

### Simple Usage

```typescript
import { VectorDB } from 'vector-frankl';

// Create a database for 384-dimensional vectors
const db = new VectorDB('my-vectors', 384);
await db.init();

// Add vectors with metadata
await db.addVector('doc1', embeddings1, {
  title: 'Introduction to AI',
  category: 'education',
});

// Search for similar vectors
const results = await db.search(queryVector, 5, {
  filter: { category: 'education' },
  includeMetadata: true,
});

console.log(results);
```

## API Documentation

### Simple API (VectorDB)

Perfect for single collections with straightforward requirements:

```typescript
import { VectorDB } from 'vector-frankl';

const db = new VectorDB('collection-name', 384);
await db.init();

// Basic operations
await db.addVector(id, embedding, metadata);
const retrieved = await db.getVector(id);
await db.deleteVector(id);

// Batch operations
await db.addBatch(vectors, { onProgress: (p) => console.log(p) });
const count = await db.deleteMany(['id1', 'id2']);

// Search
const results = await db.search(queryVector, k, {
  filter: { category: 'AI' },
  includeMetadata: true,
});

// Management
const stats = await db.getStats();
await db.clear();
await db.delete();
```

### Namespace API (VectorFrankl)

For complex applications with multiple vector collections:

```typescript
import { VectorFrankl } from 'vector-frankl';

const db = new VectorFrankl();
await db.init();

// Create specialized namespaces
const products = await db.createNamespace('products', {
  dimension: 384,
  distanceMetric: 'cosine',
  description: 'Product embeddings',
});

const documents = await db.createNamespace('documents', {
  dimension: 768,
  distanceMetric: 'euclidean',
  indexStrategy: 'hnsw',
});

// Work with namespaces independently
await products.addVector('prod-1', embedding, metadata);
const results = await products.search(query, 10);

// Namespace management
const namespaces = await db.listNamespaces();
await db.deleteNamespace('old-collection');
```

### Storage Adapters

By default, `VectorDB` and `VectorFrankl` use IndexedDB. Pass a `StorageAdapter` or `StorageAdapterFactory` to swap in a different backend. `MemoryStorageAdapter` and `IndexedDatabaseStorageAdapter` are exported from the main entry point; all other adapters are imported via their own deep-import paths.

```typescript
import { VectorDB, MemoryStorageAdapter } from 'vector-frankl';

// In-memory (useful for tests)
const memory = new MemoryStorageAdapter();
const db = new VectorDB('test', 384, { storage: memory });
await db.init();
```

```typescript
// SQLite (Bun runtime only)
import { VectorDB } from 'vector-frankl';
import { SQLiteStorageAdapter } from 'vector-frankl/adapters/sqlite';

const sqlite = new SQLiteStorageAdapter({ filename: './vectors.db' });
const db = new VectorDB('my-vectors', 384, { storage: sqlite });
await db.init();
```

```typescript
// Use a factory so each namespace gets its own storage
import { VectorFrankl } from 'vector-frankl';
import { SQLiteStorageAdapter } from 'vector-frankl/adapters/sqlite';

const frankl = new VectorFrankl('my-vectors', {
  defaultDimension: 384,
  storageFactory: (name) => new SQLiteStorageAdapter({ filename: `./${name}.db` }),
});
await frankl.init();
```

### Storage Adapter Support Matrix

| Adapter                         | Import path                             | Backend                    | Environment       | Stability | Persist | Txn | Batch Atomic | Quota |
| ------------------------------- | --------------------------------------- | -------------------------- | ----------------- | --------- | ------- | --- | ------------ | ----- |
| `IndexedDatabaseStorageAdapter` | `vector-frankl`                         | IndexedDB                  | Browser           | Stable    | ✓       | ✓   | —            | ✓     |
| `MemoryStorageAdapter`          | `vector-frankl`                         | In-memory `Map`            | Any               | Stable    | —       | —   | —            | —     |
| `SQLiteStorageAdapter`          | `vector-frankl/adapters/sqlite`         | `bun:sqlite`               | Bun               | Beta      | ✓       | ✓   | ✓            | —     |
| `OPFSStorageAdapter`            | `vector-frankl/adapters/opfs`           | Origin Private File System | Browser           | Beta      | ✓       | —   | —            | ✓     |
| `ChromeStorageAdapter`          | `vector-frankl/adapters/chrome-storage` | `chrome.storage`           | Chrome extensions | Beta      | ✓       | —   | —            | —     |
| `FileSystemStorageAdapter`      | `vector-frankl/adapters/file-system`    | File system (JSON/binary)  | Bun / Node        | Beta      | ✓       | —   | —            | —     |
| `LevelStorageAdapter`           | `vector-frankl/adapters/level`          | LevelDB via `level`        | Bun / Node        | Beta      | ✓       | —   | ✓            | —     |
| `LmdbStorageAdapter`            | `vector-frankl/adapters/lmdb`           | LMDB via `lmdb`            | Bun / Node        | Beta      | ✓       | ✓   | ✓            | —     |
| `RedisStorageAdapter`           | `vector-frankl/adapters/redis`          | `Bun.RedisClient`          | Bun               | Beta      | ✓       | —   | —            | —     |
| `S3StorageAdapter`              | `vector-frankl/adapters/s3`             | `Bun.s3`                   | Bun               | Beta      | ✓       | —   | —            | —     |

## Advanced Features

### Vector Compression

Reduce storage requirements while maintaining search quality:

```typescript
import {
  CompressionManager,
  compressVector,
  decompressVector,
} from 'vector-frankl/compression';

// Quick compression with an explicit configuration
const compressed = await compressVector(vector, {
  level: 8,
  maxPrecisionLoss: 0.01,
});
const decompressed = await decompressVector(compressed);

// Advanced compression management
const manager = new CompressionManager({
  defaultStrategy: 'scalar',
  autoSelect: true,
  targetCompressionRatio: 4.0,
  maxPrecisionLoss: 0.05,
});

// Compress with explicit strategy ('scalar' or 'product')
const result = await manager.compress(vector, 'scalar');
```

### Performance Acceleration

SIMD and WebGPU acceleration are used automatically by the search engine when available. Capability detection runs at initialization; when an acceleration path is unavailable the library falls back silently to scalar operations.

#### WebGPU Acceleration

`GPUSearchEngine` (exported from `vector-frankl/gpu`) provides explicit control over GPU-accelerated search. WebGPU availability varies by browser and platform—`enableFallback: true` (the default) ensures CPU search is used when the GPU path is unavailable.

```typescript
import { GPUSearchEngine } from 'vector-frankl/gpu';

const gpuSearch = new GPUSearchEngine({
  gpuThreshold: 1000, // Minimum dataset size to use GPU
  enableFallback: true, // Fall back to CPU if GPU unavailable
  batchSize: 256,
});

await gpuSearch.init();
const results = await gpuSearch.search(vectors, query, k);
```

### Background Processing

```typescript
import { WorkerPool } from 'vector-frankl/workers';

const pool = new WorkerPool({
  maxWorkers: 4,
  workerScript: 'vector-worker.js',
});

// Parallel similarity search
const results = await pool.parallelSimilaritySearch(vectors, query, k, 'cosine');
```

#### Shared Memory (Experimental)

`SharedMemoryManager` uses `SharedArrayBuffer` to share vector data between the main thread and workers without copying. This requires your server to send cross-origin isolation headers on every document response:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Always check `self.crossOriginIsolated` before constructing `SharedMemoryManager`—it throws when `SharedArrayBuffer` is unavailable. `WorkerPool` (structured-clone transfer) works without these headers and is the production-supported fallback.

```typescript
import { SharedMemoryManager } from 'vector-frankl/workers';

if (self.crossOriginIsolated) {
  const memory = new SharedMemoryManager();
  const results = await memory.sharedMemoryBatchSearch(vectors, queries, k, 'cosine');
} else {
  // WorkerPool works without cross-origin isolation
  const results = await pool.parallelSimilaritySearch(vectors, query, k, 'cosine');
}
```

See [docs/shared-memory.md](docs/shared-memory.md) for server configuration examples (Express, Nginx, Vercel, Netlify) and a detailed explanation of fallback behavior.

### Debug & Profiling

The debug API is available under `vector-frankl/debug` and is currently **experimental**—functional but not yet API-stable.

```typescript
import { debugManager, withProfiling } from 'vector-frankl/debug';

// Enable debug mode
debugManager.enable({
  profile: true,
  traceLevel: 'detailed',
  memoryTracking: true,
});

// Profile a function call
const result = await withProfiling('vector-search', () => db.search(queryVector, 5));
```

## Architecture

### Core Components

```
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│   Simple API    │  │  Namespace API  │  │   Worker Pool   │
│   (VectorDB)    │  │ (VectorFrankl)  │  │                 │
└─────────┬───────┘  └─────────┬───────┘  └─────────┬───────┘
          │                    │                    │
          └──────────┬─────────┴────────────────────┘
                     │
         ┌───────────▼────────────┐
         │     Search Engine      │
         │  ┌─────────────────┐   │
         │  │ Distance Metrics│   │
         │  │ Metadata Filter │   │
         │  │ HNSW Index     │   │
         │  └─────────────────┘   │
         └───────────┬────────────┘
                     │
         ┌───────────▼────────────┐
         │   Security Layer       │
         │  ┌─────────────────┐   │
         │  │ Input Validation│   │
         │  │ ReDoS Protection│   │
         │  │ Memory Guards   │   │
         │  └─────────────────┘   │
         └───────────┬────────────┘
                     │
         ┌───────────▼────────────┐
         │    Vector Storage      │
         │  ┌─────────────────┐   │
         │  │ StorageAdapter  │   │
         │  │  Compression    │   │
         │  │   Eviction      │   │
         │  └────────┬────────┘   │
         └───────────┼────────────┘
                     │
    ┌────────┬───────┼───────┬────────┐
    ▼        ▼       ▼       ▼        ▼
 IndexedDB SQLite  Level   LMDB   Redis ...
```

### Performance Layers

```
┌─────────────────────────────────────────────────────────────┐
│                    Application Layer                        │
├─────────────────────────────────────────────────────────────┤
│  API Layer: VectorDB | VectorFrankl | Direct Modules       │
├─────────────────────────────────────────────────────────────┤
│        Acceleration: SIMD | WebGPU | Workers | Scalar      │
├─────────────────────────────────────────────────────────────┤
│        Core: Search | Storage | Compression | Index        │
├─────────────────────────────────────────────────────────────┤
│  Storage: IndexedDB | SQLite | LevelDB | LMDB | Redis | S3 │
└─────────────────────────────────────────────────────────────┘
```

## Benchmarks

Vector Frankl includes a benchmarking suite:

```typescript
import { BenchmarkSuite, QuickBenchmark } from 'vector-frankl/benchmarks';

// Quick performance check
await QuickBenchmark.runQuick();

// Comprehensive benchmarking
const suite = new BenchmarkSuite({
  dimensions: [128, 384, 768, 1536],
  datasetSizes: [1000, 10000, 50000],
  distanceMetrics: ['cosine', 'euclidean'],
  testCompression: true,
});

const results = await suite.runSuite();
```

Performance varies significantly by environment, browser, hardware, and whether SIMD or WebGPU acceleration is active. Run `bun run scripts/benchmark.ts` against your target environment for representative numbers.

## Security & Reliability

- **ReDoS Protection**: All regex operations guarded with pattern validation; no user input is passed to `RegExp` without sanitization
- **Memory Guards**: Vector size limits (100k dimensions, 512MB per vector) prevent exhaustion attacks
- **Input Validation**: Comprehensive validation for all user inputs via `InputValidator`
- **Type Safety**: 100% TypeScript strict mode with zero errors

## Development

### Setup

```bash
git clone https://github.com/stevekinney/vector-frankl.git
cd vector-frankl
bun install
```

### Development Commands

```bash
# Development server with hot reload
bun run dev

# Run tests
bun test
bun test --watch
bun test --coverage

# Code quality
bun run lint
bun run typecheck
bun run format

# Build
bun run build

# Benchmarks
bun run scripts/benchmark.ts

# Verify documentation claims
bun run verify:documentation
```

### Quality Assurance

- **ESLint**: Strict linting with security rules
- **TypeScript**: Full type checking with strict mode
- **Prettier**: Consistent code formatting
- **Husky**: Git hooks for code quality
- **GitHub Actions**: Automated CI/CD

### Project Structure

```
src/
├── api/                 # Public API interfaces
├── benchmarks/          # Performance testing
├── compression/         # Vector compression algorithms
├── configuration/       # Configuration management
├── core/               # Core database functionality
├── debug/              # Debug and profiling tools
├── gpu/                # WebGPU acceleration
├── namespaces/         # Namespace management
├── performance/        # Performance monitoring utilities
├── search/             # Search algorithms and indexing
├── simd/               # SIMD optimizations
├── storage/            # Storage adapters, eviction, and quota management
├── types/              # Shared type definitions
├── utilities/          # Logging, file I/O, and helpers
├── vectors/            # Vector operations and formats
├── wasm/               # WebAssembly capability detection and fallbacks
├── workers/            # Web Worker support
└── index.ts            # Main exports

examples/               # Usage examples
tests/                  # Test suites
docs/                   # Documentation
scripts/                # Build and benchmark scripts
```

## Contributing

We welcome contributions!

### Development Workflow

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Run the test suite: `bun test`
6. Submit a pull request

### Code Standards

- Follow TypeScript best practices
- Maintain 100% test coverage for new features
- Use semantic commit messages
- Document public APIs with JSDoc

## License

MIT License—see [LICENSE](LICENSE) for details.

## Acknowledgments

- IndexedDB for persistent browser storage
- HNSW algorithm for efficient similarity search
- WebGPU and SIMD for performance acceleration where available

## Related Projects

- [Faiss](https://github.com/facebookresearch/faiss)—library for efficient similarity search
- [Annoy](https://github.com/spotify/annoy)—approximate nearest neighbors
- [ANN Benchmarks](https://github.com/erikbern/ann-benchmarks)—benchmarking various implementations

---

Built by [Steve Kinney](https://github.com/stevekinney).
