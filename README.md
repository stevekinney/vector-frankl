# Vector Frankl 🚀

A high-performance vector database that runs entirely in the browser, built on IndexedDB for persistent storage. Perfect for building AI-powered applications with semantic search capabilities, vector similarity search, and machine learning workflows directly in the browser.

[![CI](https://github.com/stevekinney/vector-frankl/workflows/CI/badge.svg)](https://github.com/stevekinney/vector-frankl/actions)
[![TypeScript](https://img.shields.io/badge/TypeScript-100%25_Type_Safe-blue.svg)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-Optimized-yellow.svg)](https://bun.sh/)
[![Security](https://img.shields.io/badge/Security-Hardened-green.svg)](docs/SECURITY.md)

## ✨ Why Vector Frankl is Awesome

Vector Frankl redefines what's possible for AI applications in the browser. By bringing a full-fledged, high-performance vector database directly to the client-side, it unlocks a new era of privacy-preserving, offline-capable, and lightning-fast AI experiences.

**Key Advantages:**

*   **Unparalleled Performance:** Leveraging SIMD, WebAssembly, and WebGPU, Vector Frankl delivers near-native speed for vector operations, ensuring your AI features are responsive and efficient, even with large datasets.
*   **True Client-Side AI:** All data storage and vector computations happen directly in the user's browser. This means enhanced privacy, reduced server costs, and the ability to build applications that work seamlessly offline.
*   **Rich Feature Set:** From advanced vector compression and multiple distance metrics to robust namespace management and comprehensive debugging tools, Vector Frankl provides everything you need to build sophisticated vector-based applications.
*   **Developer-Friendly:** With 100% TypeScript support, a clear API, and built-in performance monitoring, integrating and optimizing your AI workflows has never been easier.

## 💡 Potential Use Cases

*   **Privacy-Preserving AI:** Build applications where sensitive user data never leaves the device, enabling highly personalized experiences without compromising privacy.
*   **Offline-First Applications:** Develop AI features that function seamlessly without an internet connection, ideal for mobile web apps or environments with intermittent connectivity.
*   **Edge AI & Real-time Processing:** Perform real-time semantic search, content recommendations, or anomaly detection directly on the user's device, reducing latency and server load.
*   **Interactive Machine Learning Demos:** Create compelling, interactive AI prototypes and educational tools that run entirely in the browser, making them easily shareable and accessible.
*   **Personalized Content Filtering:** Implement client-side content filtering or recommendation engines that adapt instantly to user preferences and behavior.
*   **Local Document Search:** Enable semantic search capabilities over user-generated content or locally stored documents without relying on a backend server.

## 🌟 Features

### ✅ Core Features

**Vector Storage & Management**

- 🗄️ **Persistent Storage**: Built on IndexedDB for reliable browser-based storage
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

- [Bun](https://bun.sh) >= 1.13.0
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

## 🔧 Advanced Features

### Vector Compression

Reduce storage requirements while maintaining search quality:

```typescript
import { CompressionManager, compressVector, decompressVector } from 'vector-frankl';

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

#### SIMD Operations

```typescript
import { SIMDOperations } from 'vector-frankl';

// Automatic SIMD detection and fallback
const similarity = await SIMDOperations.dotProduct(vectorA, vectorB);
const normalized = await SIMDOperations.normalize(vector);
```

#### WebGPU Acceleration

```typescript
import { GPUSearchEngine } from 'vector-frankl';

const gpuSearch = new GPUSearchEngine({
  device: await navigator.gpu.requestDevice(),
  enableOptimizations: true,
});

const results = await gpuSearch.search(query, vectors, k);
```

#### WebAssembly Modules

```typescript
import { WASMOperations } from 'vector-frankl';

await WASMOperations.initialize();
const distances = await WASMOperations.batchDistance(queries, vectors);
```

### Background Processing

```typescript
import { WorkerPool } from 'vector-frankl';

const pool = new WorkerPool({
  maxWorkers: 4,
  workerScript: 'vector-worker.js',
});

// Parallel similarity search
const results = await pool.parallelSimilaritySearch(vectors, query, k, 'cosine');
```

### Debug & Profiling

```typescript
import { debug, profiler, withProfiling } from 'vector-frankl';

// Enable debug mode
debug.manager.enable({
  profile: true,
  traceLevel: 'detailed',
  memoryTracking: true,
});

// Instrument functions
const searchWithProfiling = withProfiling('vector-search', (query, k) =>
  db.search(query, k),
);

// Export performance reports
const report = await debug.console.export('json');
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
         │  │   IndexedDB     │   │
         │  │  Compression    │   │
         │  │   Eviction      │   │
         │  └─────────────────┘   │
         └────────────────────────┘
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
│              Browser: IndexedDB | WebWorkers               │
└─────────────────────────────────────────────────────────────┘
```

## 📊 Benchmarks

Vector Frankl includes a comprehensive benchmarking suite:

```typescript
import { BenchmarkSuite, QuickBenchmark } from 'vector-frankl';

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
bun run examples/benchmarks.ts
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
├── core/               # Core database functionality
├── debug/              # Debug and profiling tools
├── gpu/                # WebGPU acceleration
├── namespaces/         # Namespace management
├── search/             # Search algorithms and indexing
├── simd/               # SIMD optimizations
├── storage/            # Storage management
├── vectors/            # Vector operations and formats
├── wasm/               # WebAssembly modules
├── workers/            # Web Worker support
└── index.ts            # Main exports

examples/               # Usage examples
tests/                  # Test suites
docs/                   # Documentation
```

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

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
