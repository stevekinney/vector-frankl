# Vector Frankl 🚀

A high-performance vector database built on IndexedDB for browser-based storage, with pluggable storage adapters for server-side runtimes. Perfect for building AI-powered applications with semantic search capabilities, vector similarity search, and machine learning workflows.

[![CI](https://github.com/stevekinney/vector-frankl/workflows/CI/badge.svg)](https://github.com/stevekinney/vector-frankl/actions)
[![TypeScript](https://img.shields.io/badge/TypeScript-100%25_Type_Safe-blue.svg)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-Optimized-yellow.svg)](https://bun.sh/)
[![Security](https://img.shields.io/badge/Security-Hardened-green.svg)](docs/SECURITY.md)

## ✨ Why Vector Frankl is Awesome

- **Unparalleled Performance:** Leveraging SIMD, WebAssembly, and WebGPU, Vector Frankl delivers near-native speed for vector operations, ensuring your AI features are responsive and efficient, even with large datasets.
- **Runs Anywhere:** Defaults to IndexedDB in the browser for zero-config client-side AI, but pluggable storage adapters let you run the same API on top of SQLite, LevelDB, LMDB, Redis, S3, or the file system in Bun and Node.
- **Rich Feature Set:** From advanced vector compression and multiple distance metrics to robust namespace management and comprehensive debugging tools, Vector Frankl provides everything you need to build sophisticated vector-based applications.
- **Developer-Friendly:** With 100% TypeScript support, a clear API, and built-in performance monitoring, integrating and optimizing your AI workflows has never been easier.

## Use Cases

The broader pattern here is moving vector search compute to the edge—the browser—which unlocks use cases where latency, privacy, cost, or offline access are constraints. The tradeoff is index size and embedding compute, but with quantized models and WebGPU acceleration, that ceiling keeps rising.

- **Privacy-first semantic search:** All embeddings stay on the user's device. You could build a personal knowledge base, journal, or note-taking app where semantic search works entirely offline with zero data leaving the browser. No API calls, no cloud storage, no privacy policy needed.

- **Offline-capable RAG:** Pair it with a small local model (like one running via WebLLM or ONNX Runtime Web) and you've got a fully client-side retrieval-augmented generation pipeline. Think a field technician querying a maintenance manual on a tablet with no connectivity.

- **Personalized UI without a backend:** Embed user interactions—clicks, searches, navigation patterns—as vectors and do nearest-neighbor lookups to surface contextually relevant UI elements, recommendations, or shortcuts. All without a single network request.

- **Cross-tab and cross-session memory:** Since IndexedDB persists across sessions and is shared across tabs for the same origin, you could build agents or assistants that accumulate semantic memory over time. A support chatbot that "remembers" what the user struggled with last week, entirely client-side.

- **Edge-computed semantic caching:** Cache LLM responses keyed by embedding similarity rather than exact string match. If a user asks something semantically close to a previous query, serve the cached response instantly. This cuts API costs and latency dramatically for conversational UIs.

- **Federated or hybrid search architectures:** Run a first-pass vector search locally against the user's personal corpus, then only fan out to the server for the public or shared corpus. You reduce server load and latency while keeping personal data local.

- **Progressive enrichment:** As a user browses, background-embed page content (or snippets they highlight and bookmark) into the local vector store, gradually building a personal semantic index of "everything I've read." Then offer recall like "you read something about X last month" without any server involvement.

- **Developer tooling in the browser:** Imagine a browser DevTools extension that embeds console errors, network responses, and component trees, then lets you do semantic search across your debugging session. "Find me the request that looked like the one that failed yesterday."

## 🌟 Features

### ✅ Core Features

**Vector Storage & Management**

- 🗄️ **Pluggable Storage**: IndexedDB (browser default), SQLite, LevelDB, LMDB, Redis, S3, OPFS, Chrome Storage, file system, or in-memory
- 📊 **Multiple Vector Formats**: Support for Float32Array, Float64Array, Int8Array, Uint8Array, and regular arrays
- 🔍 **Similarity Search**: Fast brute-force and optimized search algorithms
- 📝 **Rich Metadata**: Attach and filter by custom metadata with advanced query support
- 🔧 **Batch Operations**: Efficient bulk insert/update/delete with progress tracking

**Advanced Architecture**

- 🏗️ **Namespace Management**: Isolated vector collections with independent configurations
- 🎯 **Multiple Distance Metrics**: Cosine, Euclidean, Manhattan, Hamming, Jaccard, and custom metrics
- 🚀 **Performance Optimizations**: SIMD operations, WebAssembly, and WebGPU acceleration
- 📦 **Vector Compression**: Scalar quantization, product quantization, and binary compression
- 🔄 **Background Processing**: Web Workers for parallel operations

**Developer Experience**

- 📘 **Full TypeScript Support**: 100% type-safe with strict mode, zero TypeScript errors
- 🛠️ **Debug & Profiling Tools**: Built-in performance monitoring and debugging utilities
- 📈 **Benchmarking Suite**: Comprehensive performance testing framework
- 🔐 **Advanced Error Handling**: Detailed error types with context and recovery suggestions
- 🛡️ **Security First**: Input validation, ReDoS protection, and memory safeguards

### 🚧 Advanced Features

**Storage Management**

- 🔌 **Pluggable Adapters**: 10 storage backends behind a single `StorageAdapter` interface
- 📊 **Quota Monitoring**: Track storage usage with automatic cleanup policies
- 🗑️ **Eviction Strategies**: LRU, LFU, TTL, score-based, and hybrid policies
- 💾 **Memory Management**: Shared memory pools for efficient data handling

**Search & Indexing**

- 🔍 **HNSW Index**: Hierarchical Navigable Small World graphs for fast approximate search
- 🔗 **Index Persistence**: Save and load search indices for improved performance
- 🎛️ **Search Filters**: Complex metadata filtering with range queries and operators

**Performance Acceleration**

- ⚡ **SIMD Operations**: Single Instruction, Multiple Data for vectorized computations
- 🌐 **WebGPU Support**: GPU-accelerated search and mathematical operations
- 🔧 **WebAssembly**: High-performance computing modules for critical operations

## 📋 Prerequisites

- [Bun](https://bun.sh) >= 1.3.0
- Modern browser with IndexedDB support
- Chrome/Edge recommended for optimal performance (SIMD, WebGPU)

## 🚀 Quick Start

### Installation

```bash
# Install Vector Frankl
npm install vector-frankl
# or
bun add vector-frankl
# or
yarn add vector-frankl
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

## 📖 API Documentation

### Simple API (VectorDB)

Perfect for single collections with straightforward requirements:

```typescript
import { VectorDB } from 'vector-frankl';

const db = new VectorDB('collection-name', 384);
await db.init();

// Basic operations
await db.addVector(id, vector, metadata);
const vector = await db.getVector(id);
await db.deleteVector(id);

// Batch operations
await db.addBatch(vectors, { onProgress: (p) => console.log(p) });
const count = await db.deleteMany(['id1', 'id2']);

// Search
const results = await db.search(queryVector, k, {
  filter: { category: 'AI' },
  distanceMetric: 'cosine',
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
  useIndex: true,
  indexConfig: {
    m: 16,
    efConstruction: 200,
  },
});

// Work with namespaces independently
await products.addVector('prod-1', embedding, metadata);
const results = await products.search(query, 10);

// Namespace management
const namespaces = await db.listNamespaces();
await db.deleteNamespace('old-collection');
```

### Storage Adapters

By default, `VectorDB` and `VectorFrankl` use IndexedDB. Pass a `StorageAdapter` or `StorageAdapterFactory` to swap in a different backend. `MemoryStorageAdapter` and `IndexedDatabaseStorageAdapter` are exported from the main entry point; server-side adapters are imported directly from their files.

```typescript
import { VectorDB, MemoryStorageAdapter } from 'vector-frankl';

// In-memory (useful for tests)
const memory = new MemoryStorageAdapter();
const db = new VectorDB('test', 384, { storage: memory });
await db.init();
```

```typescript
// SQLite (Bun runtime only)
import { SQLiteStorageAdapter } from 'vector-frankl/src/storage/adapters/sqlite-adapter';

const sqlite = new SQLiteStorageAdapter({ filename: './vectors.db' });
const db = new VectorDB('my-vectors', 384, { storage: sqlite });
await db.init();
```

```typescript
// Use a factory so each namespace gets its own storage
import { VectorFrankl } from 'vector-frankl';
import { SQLiteStorageAdapter } from 'vector-frankl/src/storage/adapters/sqlite-adapter';

const frankl = new VectorFrankl(
  'my-vectors',
  384,
  (name) => new SQLiteStorageAdapter({ filename: `./${name}.db` }),
);
await frankl.init();
```

Available adapters:

| Adapter                         | Backend                    | Environment       |
| ------------------------------- | -------------------------- | ----------------- |
| `IndexedDatabaseStorageAdapter` | IndexedDB                  | Browser           |
| `MemoryStorageAdapter`          | In-memory `Map`            | Any               |
| `OPFSStorageAdapter`            | Origin Private File System | Browser           |
| `ChromeStorageAdapter`          | `chrome.storage`           | Chrome extensions |
| `SQLiteStorageAdapter`          | `bun:sqlite`               | Bun               |
| `FileSystemStorageAdapter`      | File system (JSON files)   | Bun / Node        |
| `LevelStorageAdapter`           | LevelDB via `level`        | Bun / Node        |
| `LmdbStorageAdapter`            | LMDB via `lmdb`            | Bun / Node        |
| `RedisStorageAdapter`           | `Bun.RedisClient`          | Bun               |
| `S3StorageAdapter`              | `Bun.s3`                   | Bun               |

## 🔧 Advanced Features

### Vector Compression

Reduce storage requirements while maintaining search quality:

```typescript
import {
  CompressionManager,
  compressVector,
  decompressVector,
} from 'vector-frankl/compression';

// Quick compression
const compressed = await compressVector(vector, {
  strategy: 'scalar',
  precision: 8,
});

// Advanced compression management
const manager = new CompressionManager({
  defaultStrategy: 'product',
  autoSelect: true,
  targetCompressionRatio: 4.0,
  maxPrecisionLoss: 0.05,
});

const result = await manager.compress(vector);
```

### Performance Acceleration

SIMD, WebAssembly, and WebGPU acceleration are used automatically by the search engine when available. You don't need to import or configure them directly — Vector Frankl detects browser capabilities and selects the fastest path.

#### WebGPU Acceleration

For explicit control over GPU-accelerated search:

```typescript
import { GPUSearchEngine } from 'vector-frankl/gpu';

const gpuSearch = new GPUSearchEngine({
  gpuThreshold: 1000, // Minimum dataset size to use GPU
  enableFallback: true, // Fall back to CPU if GPU unavailable
  batchSize: 256,
});

await gpuSearch.init();
const results = await gpuSearch.search(query, vectors, k);
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

### Debug & Profiling

```typescript
import { debugManager, profiler, withProfiling } from 'vector-frankl/debug';

// Enable debug mode
debugManager.enable({
  profile: true,
  traceLevel: 'detailed',
  memoryTracking: true,
});

// Instrument functions
const searchWithProfiling = withProfiling('vector-search', (query, k) =>
  db.search(query, k),
);
```

## 🏗️ Architecture

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
│     Acceleration: SIMD | WebGPU | WebAssembly | Workers    │
├─────────────────────────────────────────────────────────────┤
│        Core: Search | Storage | Compression | Index        │
├─────────────────────────────────────────────────────────────┤
│  Storage: IndexedDB | SQLite | LevelDB | LMDB | Redis | S3 │
└─────────────────────────────────────────────────────────────┘
```

## 📊 Benchmarks

Vector Frankl includes a comprehensive benchmarking suite:

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
  testAcceleration: true,
});

const results = await suite.runAll();
```

### Performance Characteristics

| Operation    | 1K vectors | 10K vectors | 100K vectors |
| ------------ | ---------- | ----------- | ------------ |
| Insert       | ~1ms       | ~5ms        | ~50ms        |
| Search       | ~10ms      | ~100ms      | ~800ms       |
| Batch Insert | ~50ms      | ~200ms      | ~1.5s        |
| With SIMD    | ~5ms       | ~50ms       | ~400ms       |
| With WebGPU  | ~2ms       | ~20ms       | ~150ms       |

### Security & Performance Improvements

- **ReDoS Protection**: All regex operations protected with timeout and pattern validation
- **Memory Guards**: Vector size limits (100k dimensions, 512MB max per vector)
- **Input Validation**: Comprehensive validation for all user inputs
- **Optimized Async**: Removed unnecessary async/await for 30-50% performance boost
- **Type Safety**: 100% TypeScript strict mode compliance with zero errors

## 🛠️ Development

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
├── wasm/               # WebAssembly modules
├── workers/            # Web Worker support
└── index.ts            # Main exports

examples/               # Usage examples
tests/                  # Test suites
docs/                   # Documentation
scripts/                # Build and benchmark scripts
```

## 🤝 Contributing

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

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.

## 🙏 Acknowledgments

- IndexedDB for persistent browser storage
- HNSW algorithm for efficient similarity search
- WebGPU, WebAssembly, and SIMD for performance acceleration

## 📚 Related Projects

- [Faiss](https://github.com/facebookresearch/faiss) - Library for efficient similarity search
- [Annoy](https://github.com/spotify/annoy) - Approximate nearest neighbors
- [Vector Database Comparison](https://github.com/erikbern/ann-benchmarks) - Benchmarking various implementations

---

Built with ❤️ by [Steve Kinney](https://github.com/stevekinney).
