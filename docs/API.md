# Vector Frankl API Reference

## Table of Contents

- [VectorDB (Simple API)](#vectordb-simple-api)
- [VectorFrankl (Namespace API)](#vectorfrankl-namespace-api)
- [Vector Operations](#vector-operations)
- [Distance Metrics](#distance-metrics)
- [Compression](#compression)
- [Search Engine](#search-engine)
- [Storage Management](#storage-management)
- [Worker Pool](#worker-pool)
- [Performance Acceleration](#performance-acceleration)
- [Debug & Profiling](#debug--profiling)
- [Error Types](#error-types)

## VectorDB (Simple API)

The simple API provides a straightforward interface for single-collection vector databases.

### Constructor

```typescript
new VectorDB(name: string, dimension: number, config?: VectorDBConfig)
```

#### Parameters

- `name`: Unique identifier for the database
- `dimension`: Vector dimension (must be consistent for all vectors)
- `config`: Optional configuration object

#### Config Options

```typescript
interface VectorDBConfig {
  distanceMetric?: 'cosine' | 'euclidean' | 'manhattan' | 'hamming' | 'jaccard';
  useIndex?: boolean;
  indexConfig?: {
    m?: number; // HNSW M parameter (default: 16)
    efConstruction?: number; // HNSW construction parameter (default: 200)
    seed?: number; // Random seed for reproducibility
  };
  compression?: {
    enabled?: boolean;
    strategy?: 'scalar' | 'product' | 'binary' | 'none';
    options?: Record<string, unknown>;
  };
  eviction?: {
    enabled?: boolean;
    policy?: 'lru' | 'lfu' | 'ttl' | 'score' | 'hybrid';
    maxVectors?: number;
    maxMemoryMB?: number;
  };
}
```

### Methods

#### init()

Initialize the database and create IndexedDB stores.

```typescript
await db.init(): Promise<void>
```

#### addVector()

Add a single vector with optional metadata.

```typescript
await db.addVector(
  id: string,
  vector: VectorInput,
  metadata?: Record<string, unknown>
): Promise<void>
```

**Parameters:**

- `id`: Unique identifier for the vector
- `vector`: Vector data (Float32Array, Float64Array, number[], etc.)
- `metadata`: Optional metadata object

**Example:**

```typescript
await db.addVector('doc1', embedding, {
  title: 'Introduction to AI',
  category: 'education',
  timestamp: Date.now(),
});
```

#### addBatch()

Add multiple vectors in a single transaction.

```typescript
await db.addBatch(
  vectors: VectorData[],
  options?: BatchOptions
): Promise<BatchResult>
```

**Parameters:**

```typescript
interface VectorData {
  id: string;
  vector: VectorInput;
  metadata?: Record<string, unknown>;
}

interface BatchOptions {
  onProgress?: (progress: BatchProgress) => void;
  batchSize?: number;
  continueOnError?: boolean;
}

interface BatchProgress {
  completed: number;
  total: number;
  percentage: number;
  errors: number;
}
```

**Example:**

```typescript
const vectors = [
  { id: 'vec1', vector: embedding1, metadata: { type: 'A' } },
  { id: 'vec2', vector: embedding2, metadata: { type: 'B' } },
];

await db.addBatch(vectors, {
  onProgress: (p) => console.log(`${p.percentage}% complete`),
  batchSize: 1000,
});
```

#### getVector()

Retrieve a vector by ID.

```typescript
await db.getVector(id: string): Promise<VectorRecord | null>
```

**Returns:**

```typescript
interface VectorRecord {
  id: string;
  vector: Float32Array;
  metadata?: Record<string, unknown>;
  magnitude: number;
  timestamp: number;
}
```

#### search()

Search for similar vectors.

```typescript
await db.search(
  query: VectorInput,
  k: number,
  options?: SearchOptions
): Promise<SearchResult[]>
```

**Parameters:**

```typescript
interface SearchOptions {
  filter?: MetadataFilter;
  distanceMetric?: DistanceMetric;
  includeMetadata?: boolean;
  includeVector?: boolean;
  threshold?: number;
}

interface SearchResult {
  id: string;
  score: number;
  vector?: Float32Array;
  metadata?: Record<string, unknown>;
}
```

**Example:**

```typescript
const results = await db.search(queryVector, 10, {
  filter: { category: 'education', year: { $gte: 2023 } },
  includeMetadata: true,
  threshold: 0.8,
});
```

#### deleteVector()

Delete a single vector.

```typescript
await db.deleteVector(id: string): Promise<boolean>
```

#### deleteMany()

Delete multiple vectors.

```typescript
await db.deleteMany(ids: string[]): Promise<number>
```

**Returns:** Number of vectors deleted

#### updateMetadata()

Update vector metadata.

```typescript
await db.updateMetadata(
  id: string,
  metadata: Record<string, unknown>,
  merge?: boolean
): Promise<void>
```

**Parameters:**

- `merge`: If true, merges with existing metadata; if false, replaces it

#### exists()

Check if a vector exists.

```typescript
await db.exists(id: string): Promise<boolean>
```

#### getStats()

Get database statistics.

```typescript
await db.getStats(): Promise<DatabaseStats>
```

**Returns:**

```typescript
interface DatabaseStats {
  vectorCount: number;
  dimension: number;
  distanceMetric: string;
  indexType?: string;
  storageUsage?: number;
  memoryUsage?: number;
}
```

#### clear()

Remove all vectors from the database.

```typescript
await db.clear(): Promise<void>
```

#### close()

Close database connections.

```typescript
await db.close(): Promise<void>
```

#### delete()

Delete the entire database.

```typescript
await db.delete(): Promise<void>
```

## VectorFrankl (Namespace API)

The namespace API provides multi-collection support with isolated storage.

### Constructor

```typescript
new VectorFrankl(rootName?: string)
```

### Methods

#### init()

Initialize the namespace manager.

```typescript
await vf.init(): Promise<void>
```

#### createNamespace()

Create a new namespace.

```typescript
await vf.createNamespace(
  name: string,
  config: NamespaceConfig
): Promise<VectorDB>
```

**Parameters:**

```typescript
interface NamespaceConfig {
  dimension: number;
  distanceMetric?: DistanceMetric;
  description?: string;
  useIndex?: boolean;
  indexConfig?: IndexConfig;
  compression?: CompressionConfig;
  eviction?: EvictionConfig;
}
```

**Example:**

```typescript
const products = await vf.createNamespace('products', {
  dimension: 384,
  distanceMetric: 'cosine',
  description: 'Product embeddings',
  useIndex: true,
  indexConfig: { m: 32, efConstruction: 400 },
});
```

#### getNamespace()

Get an existing namespace.

```typescript
await vf.getNamespace(name: string): Promise<VectorDB>
```

#### listNamespaces()

List all namespaces.

```typescript
await vf.listNamespaces(): Promise<NamespaceInfo[]>
```

**Returns:**

```typescript
interface NamespaceInfo {
  name: string;
  config: NamespaceConfig;
  stats: DatabaseStats;
  created: number;
  lastModified: number;
}
```

#### deleteNamespace()

Delete a namespace and all its data.

```typescript
await vf.deleteNamespace(name: string): Promise<void>
```

#### findNamespaces()

Find namespaces matching a pattern.

```typescript
await vf.findNamespaces(pattern: RegExp): Promise<NamespaceInfo[]>
```

#### getTotalStorageUsage()

Get total storage usage across all namespaces.

```typescript
await vf.getTotalStorageUsage(): Promise<number>
```

#### deleteAll()

Delete all namespaces.

```typescript
await vf.deleteAll(): Promise<void>
```

## Vector Operations

Utility functions for vector manipulation.

### normalize()

Normalize a vector to unit length.

```typescript
VectorOperations.normalizeSync(vector: VectorInput): Float32Array
```

### magnitude()

Calculate vector magnitude.

```typescript
VectorOperations.magnitudeSync(vector: VectorInput): number
```

### dotProduct()

Calculate dot product of two vectors.

```typescript
VectorOperations.dotProductSync(a: VectorInput, b: VectorInput): number
```

### randomUnit()

Generate a random unit vector.

```typescript
VectorOperations.randomUnit(dimension: number): Float32Array
```

### add()

Add two vectors.

```typescript
VectorOperations.addSync(a: VectorInput, b: VectorInput): Float32Array
```

### subtract()

Subtract vector b from vector a.

```typescript
VectorOperations.subtractSync(a: VectorInput, b: VectorInput): Float32Array
```

### scale()

Scale a vector by a scalar.

```typescript
VectorOperations.scaleSync(vector: VectorInput, scalar: number): Float32Array
```

## Distance Metrics

### Built-in Metrics

#### cosineDistance()

Cosine distance (1 - cosine similarity).

```typescript
DistanceMetrics.cosineDistance(a: Float32Array, b: Float32Array): number
```

#### euclideanDistance()

Euclidean (L2) distance.

```typescript
DistanceMetrics.euclideanDistance(a: Float32Array, b: Float32Array): number
```

#### manhattanDistance()

Manhattan (L1) distance.

```typescript
DistanceMetrics.manhattanDistance(a: Float32Array, b: Float32Array): number
```

#### hammingDistance()

Hamming distance for binary vectors.

```typescript
DistanceMetrics.hammingDistance(a: Uint8Array, b: Uint8Array): number
```

#### jaccardDistance()

Jaccard distance for sparse vectors.

```typescript
DistanceMetrics.jaccardDistance(a: Float32Array, b: Float32Array): number
```

### Custom Metrics

Register custom distance metrics.

```typescript
DistanceMetrics.register(
  name: string,
  metric: (a: Float32Array, b: Float32Array) => number
): void
```

**Example:**

```typescript
DistanceMetrics.register('custom', (a, b) => {
  // Custom distance calculation
  return customDistance;
});
```

## Compression

### CompressionManager

Manage vector compression strategies.

```typescript
const manager = new CompressionManager({
  defaultStrategy: 'scalar',
  autoSelect: true,
  targetCompressionRatio: 4.0,
  maxPrecisionLoss: 0.05,
});
```

### compressVector()

Compress a single vector.

```typescript
const compressed = await compressVector(vector, {
  strategy: 'scalar',
  precision: 8,
});
```

### decompressVector()

Decompress a vector.

```typescript
const vector = await decompressVector(compressed);
```

### Compression Strategies

#### Scalar Quantization

Reduce precision to 8-bit integers.

```typescript
const compressed = await compressVector(vector, {
  strategy: 'scalar',
  precision: 8,
});
```

#### Product Quantization

Divide vectors into subvectors and quantize separately.

```typescript
const compressed = await compressVector(vector, {
  strategy: 'product',
  numSubvectors: 8,
  codebookSize: 256,
});
```

#### Binary Quantization

Convert to binary representation.

```typescript
const compressed = await compressVector(vector, {
  strategy: 'binary',
});
```

## Search Engine

### SearchEngine

Advanced search capabilities.

```typescript
const engine = new SearchEngine(db, {
  useIndex: true,
  cacheSize: 1000,
  prefetch: true,
});
```

### Methods

#### buildIndex()

Build search index from existing vectors.

```typescript
await engine.buildIndex(options?: BuildOptions): Promise<void>
```

#### search()

Perform optimized search.

```typescript
await engine.search(
  query: VectorInput,
  k: number,
  options?: SearchOptions
): Promise<SearchResult[]>
```

#### searchRange()

Find vectors within a distance range.

```typescript
await engine.searchRange(
  query: VectorInput,
  minDistance: number,
  maxDistance: number,
  options?: SearchOptions
): Promise<SearchResult[]>
```

## Storage Management

### StorageManager

Monitor and manage IndexedDB storage.

```typescript
const storage = new StorageManager(db, {
  quotaSafetyMargin: 0.15,
  checkInterval: 1000,
});
```

### Methods

#### checkQuota()

Check storage quota status.

```typescript
await storage.checkQuota(): Promise<QuotaStatus>
```

**Returns:**

```typescript
interface QuotaStatus {
  usage: number;
  quota: number;
  available: number;
  percentUsed: number;
  needsEviction: boolean;
}
```

#### enableAutoEviction()

Enable automatic eviction when approaching quota.

```typescript
storage.enableAutoEviction({
  policy: 'lru',
  targetUsagePercent: 0.8,
});
```

#### getStorageBreakdown()

Get detailed storage usage.

```typescript
await storage.getStorageBreakdown(): Promise<StorageBreakdown>
```

## Worker Pool

### WorkerPool

Parallel processing using Web Workers.

```typescript
const pool = new WorkerPool({
  maxWorkers: 4,
  workerScript: 'vector-worker.js',
  fallbackToMain: true,
});
```

### Methods

#### parallelSearch()

Perform parallel similarity search.

```typescript
await pool.parallelSearch(
  vectors: VectorRecord[],
  queries: VectorInput[],
  k: number,
  metric: DistanceMetric
): Promise<SearchResult[][]>
```

#### parallelCompress()

Compress vectors in parallel.

```typescript
await pool.parallelCompress(
  vectors: VectorInput[],
  strategy: CompressionStrategy
): Promise<CompressedVector[]>
```

## Performance Acceleration

### SIMD Operations

Automatic SIMD acceleration when available.

```typescript
const simd = new SIMDOperations();

if (simd.isSupported()) {
  const similarity = simd.dotProduct(vectorA, vectorB);
  const normalized = simd.normalize(vector);
}
```

### WebGPU Acceleration

GPU-accelerated vector operations.

```typescript
const gpu = new GPUSearchEngine({
  device: await navigator.gpu.requestDevice(),
  workgroupSize: 64,
});

const results = await gpu.search(query, vectors, k);
```

### WebAssembly

High-performance WASM operations.

```typescript
const wasm = new WASMOperations();
await wasm.initialize();

const distances = await wasm.batchDistance(queries, vectors);
```

## Debug & Profiling

### Debug Manager

Enable debugging and profiling.

```typescript
import { debug } from 'vector-frankl';

debug.manager.enable({
  profile: true,
  traceLevel: 'detailed',
  memoryTracking: true,
  logOperations: true,
});
```

### Performance Profiling

```typescript
import { withProfiling } from 'vector-frankl';

const profiledSearch = withProfiling('vector-search', async (query, k) => {
  return await db.search(query, k);
});

const results = await profiledSearch(queryVector, 10);
```

### Debug Console

Export debug information.

```typescript
// Export as JSON
const report = await debug.console.export('json');

// Export as CSV
await debug.console.exportToFile('performance.csv', 'csv');

// Get summary
const summary = debug.console.getSummary();
```

## Error Types

### VectorDBError

Base error class for all vector database errors.

```typescript
class VectorDBError extends Error {
  code: string;
  context?: Record<string, unknown>;
  timestamp: number;
}
```

### Error Codes

- `DIMENSION_MISMATCH`: Vector dimension doesn't match database dimension
- `VECTOR_NOT_FOUND`: Requested vector ID not found
- `INVALID_VECTOR_FORMAT`: Unsupported vector format
- `QUOTA_EXCEEDED`: Storage quota exceeded
- `INDEX_BUILD_FAILED`: Failed to build search index
- `INVALID_METRIC`: Unknown distance metric
- `COMPRESSION_FAILED`: Vector compression failed
- `NAMESPACE_EXISTS`: Namespace already exists
- `NAMESPACE_NOT_FOUND`: Namespace not found
- `INVALID_INPUT`: Invalid input validation failed
- `MEMORY_LIMIT_EXCEEDED`: Vector size exceeds memory limit
- `REGEX_TIMEOUT`: Regular expression execution timeout
- `WASM_VALIDATION_FAILED`: WASM module validation failed

### Error Handling

```typescript
try {
  await db.addVector('id', vector);
} catch (error) {
  if (error instanceof VectorDBError) {
    console.error(`Error ${error.code}:`, error.message);
    console.error('Context:', error.context);
  }
}
```

## Metadata Filtering

### Filter Syntax

```typescript
interface MetadataFilter {
  // Exact match
  field: value;

  // Comparison operators
  field: {
    $eq?: any; // Equal
    $ne?: any; // Not equal
    $gt?: any; // Greater than
    $gte?: any; // Greater than or equal
    $lt?: any; // Less than
    $lte?: any; // Less than or equal
    $in?: any[]; // In array
    $nin?: any[]; // Not in array
    $regex?: string | RegExp; // Pattern match (ReDoS protected)
  };

  // Logical operators
  $and?: MetadataFilter[];
  $or?: MetadataFilter[];
  $not?: MetadataFilter;
}
```

### Examples

```typescript
// Simple equality
{ category: 'education' }

// Range query
{ year: { $gte: 2023, $lte: 2024 } }

// Array membership
{ tags: { $in: ['AI', 'ML'] } }

// Pattern matching (ReDoS protected)
{ title: { $regex: /^Introduction/ } }

// Complex query
{
  $and: [
    { category: 'education' },
    { $or: [
      { year: 2024 },
      { featured: true }
    ] }
  ]
}
```

## Type Definitions

### VectorInput

Supported vector input types:

```typescript
type VectorInput = Float32Array | Float64Array | Int8Array | Uint8Array | number[];
```

### DistanceMetric

Available distance metrics:

```typescript
type DistanceMetric =
  | 'cosine'
  | 'euclidean'
  | 'manhattan'
  | 'hamming'
  | 'jaccard'
  | string; // Custom registered metric
```

### CompressionStrategy

Compression strategies:

```typescript
type CompressionStrategy = 'none' | 'scalar' | 'product' | 'binary';
```

### EvictionPolicy

Eviction policies:

```typescript
type EvictionPolicy =
  | 'lru' // Least Recently Used
  | 'lfu' // Least Frequently Used
  | 'ttl' // Time To Live
  | 'score' // Score-based
  | 'hybrid'; // Combined strategy
```
