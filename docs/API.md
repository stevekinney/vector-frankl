# Vector Frankl API Reference

## Table of Contents

- [VectorDB (Simple API)](#vectordb-simple-api)
- [VectorFrankl (Namespace API)](#vectorfrankl-namespace-api)
- [Vector Operations](#vector-operations)
- [Distance Metrics](#distance-metrics)
- [Compression](#compression)
- [Search Engine](#search-engine)
- [Storage Quota Monitor](#storage-quota-monitor)
- [Worker Pool](#worker-pool)
- [Performance Acceleration](#performance-acceleration)
- [Debug & Profiling](#debug--profiling)
- [Error Types](#error-types)

## VectorDB (Simple API)

The simple API provides a straightforward interface for single-collection vector databases.

Import via:

```typescript
import { VectorDB } from 'vector-frankl';
```

### Constructor

```typescript
new VectorDB(name: string, dimension: number, options?: VectorDBOptions)
```

#### Parameters

- `name`: Unique identifier for the database
- `dimension`: Vector dimension (must be consistent for all vectors)
- `options`: Optional configuration object

#### Options

```typescript
interface VectorDBOptions {
  distanceMetric?: DistanceMetric;
  useIndex?: boolean;
  indexConfig?: {
    m?: number; // HNSW M parameter
    efConstruction?: number; // HNSW construction parameter
    maxLevel?: number;
  };
  useWorkers?: boolean;
  autoEviction?: boolean;
  quotaConfig?: {
    safetyMargin?: number;
    checkInterval?: number;
  };
  storage?: StorageAdapter;
  storageFactory?: StorageAdapterFactory;
}
```

### Methods

#### init()

Initialize the database and create storage.

```typescript
await db.init(): Promise<void>
```

#### addVector()

Add a single vector with optional metadata.

```typescript
await db.addVector(
  id: string,
  vector: VectorFormat,
  metadata?: Record<string, unknown>
): Promise<void>
```

**Parameters:**

- `id`: Unique identifier for the vector
- `vector`: Vector data (`Float32Array`, `Float64Array`, `Int8Array`, `Uint8Array`, or `number[]`)
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

Add multiple vectors in batches.

```typescript
await db.addBatch(
  vectors: Array<{
    id: string;
    vector: VectorFormat;
    metadata?: Record<string, unknown>;
  }>,
  options?: BatchOptions
): Promise<void>
```

**BatchOptions:**

```typescript
interface BatchOptions {
  batchSize?: number;
  onProgress?: (progress: BatchProgress) => void;
  abortSignal?: VectorAbortSignal;
  parallel?: boolean;
}

interface BatchProgress {
  total: number;
  completed: number;
  failed: number;
  percentage: number;
  currentBatch: number;
  totalBatches: number;
}
```

**Example:**

```typescript
const vectors = [
  { id: 'vec1', vector: embedding1, metadata: { type: 'A' } },
  { id: 'vec2', vector: embedding2, metadata: { type: 'B' } },
];

await db.addBatch(vectors, {
  onProgress: (p) => process.stdout.write(`${p.percentage}% complete\n`),
  batchSize: 1000,
});
```

#### getVector()

Retrieve a vector by ID.

```typescript
await db.getVector(id: string): Promise<VectorData | null>
```

**VectorData:**

```typescript
interface VectorData {
  id: string;
  vector: Float32Array;
  metadata?: Record<string, unknown>;
  magnitude: number;
  timestamp: number;
  format?: string;
  normalized?: boolean;
  lastAccessed?: number;
  accessCount?: number;
}
```

#### search()

Search for similar vectors.

```typescript
await db.search(
  queryVector: VectorFormat,
  k?: number,
  options?: SearchOptions
): Promise<SearchResult[]>
```

**Parameters:**

```typescript
interface SearchOptions {
  filter?: MetadataFilter;
  includeVector?: boolean;
  includeMetadata?: boolean;
  timeout?: number;
  signal?: VectorAbortSignal;
}

interface SearchResult {
  id: string;
  score: number;
  distance?: number;
  vector?: Float32Array;
  metadata?: Record<string, unknown>;
  highlights?: Record<string, unknown>;
}
```

**Example:**

```typescript
const results = await db.search(queryVector, 10, {
  filter: { category: 'education' },
  includeMetadata: true,
});
```

#### searchRange()

Search for vectors within a distance threshold.

```typescript
await db.searchRange(
  queryVector: VectorFormat,
  maxDistance: number,
  options?: SearchOptions & { maxResults?: number }
): Promise<SearchResult[]>
```

#### searchStream()

Stream search results as an async generator.

```typescript
db.searchStream(
  queryVector: VectorFormat,
  options?: SearchOptions & { batchSize?: number; maxResults?: number; progressive?: boolean }
): AsyncGenerator<SearchResult[], void, unknown>
```

#### deleteVector()

Delete a single vector.

```typescript
await db.deleteVector(id: string): Promise<void>
```

#### deleteMany()

Delete multiple vectors.

```typescript
await db.deleteMany(ids: string[]): Promise<number>
```

**Returns:** Number of vectors deleted.

#### updateVector()

Update a vector's data.

```typescript
await db.updateVector(
  id: string,
  vector: VectorFormat,
  options?: { updateMagnitude?: boolean; updateTimestamp?: boolean }
): Promise<void>
```

#### updateMetadata()

Update vector metadata.

```typescript
await db.updateMetadata(
  id: string,
  metadata: Record<string, unknown>,
  options?: { merge?: boolean; updateTimestamp?: boolean }
): Promise<void>
```

#### updateBatch()

Update multiple vectors.

```typescript
await db.updateBatch(
  updates: Array<{
    id: string;
    vector?: VectorFormat;
    metadata?: Record<string, unknown>;
  }>,
  options?: BatchOptions
): Promise<{
  succeeded: number;
  failed: number;
  errors: Array<{ id: string; error: Error }>;
}>
```

#### exists()

Check if a vector exists.

```typescript
await db.exists(id: string): Promise<boolean>
```

#### getMany()

Get multiple vectors by IDs.

```typescript
await db.getMany(ids: string[]): Promise<VectorData[]>
```

#### getAllVectors()

Get all vectors (use with caution on large datasets).

```typescript
await db.getAllVectors(): Promise<VectorData[]>
```

#### getStats()

Get database statistics.

```typescript
await db.getStats(): Promise<{
  vectorCount: number;
  dimension: number;
  initialized: boolean;
}>
```

#### getStorageQuota()

Get current storage quota information.

```typescript
await db.getStorageQuota(): Promise<{
  usage: number;
  quota: number;
  usageRatio: number;
  available: number;
  breakdown?: {
    totalUsage: number;
    vectorDatabases: Array<{
      name: string;
      estimatedSize: number;
      vectorCount: number;
    }>;
    otherOriginData: number;
  };
} | null>
```

#### getIndexStats()

Get index statistics.

```typescript
db.getIndexStats(): {
  enabled: boolean;
  nodeCount: number;
  levels?: number[];
  avgConnections?: number;
}
```

#### setDistanceMetric()

Set the distance metric for search.

```typescript
db.setDistanceMetric(metric: DistanceMetric): void
```

#### setIndexing()

Enable or disable HNSW indexing.

```typescript
await db.setIndexing(enabled: boolean): Promise<void>
```

#### rebuildIndex()

Rebuild the search index.

```typescript
await db.rebuildIndex(): Promise<void>
```

#### evictVectors()

Manually trigger eviction.

```typescript
await db.evictVectors(config?: Partial<EvictionConfig>): Promise<EvictionResult>
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

Import via:

```typescript
import { VectorFrankl } from 'vector-frankl';
```

### Constructor

```typescript
new VectorFrankl(rootName?: string, options?: VectorFranklOptions)
```

| Parameter                  | Type                    | Default           | Description                                               |
| -------------------------- | ----------------------- | ----------------- | --------------------------------------------------------- |
| `rootName`                 | `string`                | `'vector-frankl'` | Root database name                                        |
| `options.defaultDimension` | `number`                | —                 | Dimension for the default namespace                       |
| `options.storageFactory`   | `StorageAdapterFactory` | —                 | Factory function to create storage adapters per namespace |

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
): Promise<VectorNamespace>
```

**NamespaceConfig:**

```typescript
interface NamespaceConfig {
  dimension: number;
  distanceMetric?: DistanceMetric;
  indexStrategy?: IndexStrategy;
  compression?: CompressionStrategy;
  compressionConfig?: {
    level?: number;
    targetRatio?: number;
    maxPrecisionLoss?: number;
    validateQuality?: boolean;
    autoSelect?: boolean;
  };
  description?: string;
}
```

**Example:**

```typescript
const products = await vf.createNamespace('products', {
  dimension: 384,
  distanceMetric: 'cosine',
  description: 'Product embeddings',
  indexStrategy: 'hnsw',
});
```

#### getNamespace()

Get an existing namespace.

```typescript
await vf.getNamespace(name: string): Promise<VectorNamespace>
```

#### listNamespaces()

List all namespaces.

```typescript
await vf.listNamespaces(): Promise<NamespaceInfo[]>
```

**NamespaceInfo:**

```typescript
interface NamespaceInfo {
  name: string;
  config: NamespaceConfig;
  stats: NamespaceStats;
  created: number;
  modified: number;
}

interface NamespaceStats {
  vectorCount: number;
  storageSize: number;
  lastAccessed?: number;
  indexSize?: number;
}
```

#### namespaceExists()

Check if a namespace exists.

```typescript
await vf.namespaceExists(name: string): Promise<boolean>
```

#### deleteNamespace()

Delete a namespace and all its data.

```typescript
await vf.deleteNamespace(name: string): Promise<void>
```

#### findNamespaces()

Find namespaces matching a pattern.

```typescript
await vf.findNamespaces(pattern: string | RegExp): Promise<NamespaceInfo[]>
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

#### close()

Close all connections.

```typescript
await vf.close(): Promise<void>
```

## Vector Operations

Utility functions for vector manipulation.

```typescript
import { VectorOperations } from 'vector-frankl';
```

### normalizeSync()

Normalize a vector to unit length.

```typescript
VectorOperations.normalizeSync(vector: VectorFormat): Float32Array
```

### magnitudeSync()

Calculate vector magnitude.

```typescript
VectorOperations.magnitudeSync(vector: VectorFormat): number
```

### dotProductSync()

Calculate dot product of two vectors.

```typescript
VectorOperations.dotProductSync(a: VectorFormat, b: VectorFormat): number
```

### randomUnit()

Generate a random unit vector.

```typescript
VectorOperations.randomUnit(dimension: number): Float32Array
```

### addSync()

Add two vectors.

```typescript
VectorOperations.addSync(a: VectorFormat, b: VectorFormat): Float32Array
```

### subtractSync()

Subtract vector b from vector a.

```typescript
VectorOperations.subtractSync(a: VectorFormat, b: VectorFormat): Float32Array
```

### scaleSync()

Scale a vector by a scalar.

```typescript
VectorOperations.scaleSync(vector: VectorFormat, scalar: number): Float32Array
```

## Distance Metrics

```typescript
import { DistanceMetrics, registerCustomMetric } from 'vector-frankl';
```

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
registerCustomMetric(
  name: string,
  metric: (a: Float32Array, b: Float32Array) => number
): void
```

## Compression

```typescript
import {
  CompressionManager,
  compressVector,
  decompressVector,
} from 'vector-frankl/compression';
```

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
const compressed = await compressVector(vector, { strategy: 'scalar' });
```

#### Product Quantization

Divide vectors into subvectors and quantize separately.

```typescript
const compressed = await compressVector(vector, { strategy: 'product' });
```

#### Binary Quantization

Convert to binary representation.

```typescript
const compressed = await compressVector(vector, { strategy: 'binary' });
```

## Search Engine

```typescript
import { SearchEngine } from 'vector-frankl';
```

The `SearchEngine` is used internally by `VectorDB`. For advanced use, it can be instantiated directly.

### search()

Perform optimized search.

```typescript
await engine.search(
  query: Float32Array,
  k: number,
  options?: SearchOptions
): Promise<SearchResult[]>
```

### searchRange()

Find vectors within a distance range.

```typescript
await engine.searchRange(
  query: Float32Array,
  maxDistance: number,
  options?: SearchOptions & { maxResults?: number }
): Promise<SearchResult[]>
```

## Storage Quota Monitor

```typescript
import { StorageQuotaMonitor } from 'vector-frankl';
```

Monitor IndexedDB storage quota.

```typescript
const monitor = StorageQuotaMonitor.getInstance({
  safetyMargin: 0.15,
  initialCheckInterval: 1000,
});
```

### Methods

#### checkQuota()

Check storage quota status.

```typescript
await monitor.checkQuota(): Promise<void>
```

#### forceCheck()

Force an immediate quota check and return the estimate.

```typescript
await monitor.forceCheck(): Promise<QuotaEstimate | null>
```

**QuotaEstimate:**

```typescript
interface QuotaEstimate {
  usage: number;
  quota: number;
  usageRatio: number;
  available: number;
}
```

#### addListener()

Add a quota warning listener.

```typescript
monitor.addListener((warning: QuotaWarning) => {
  // handle quota warning, e.g. trigger eviction or notify the user
  void warning.message;
});
```

**QuotaWarning:**

```typescript
interface QuotaWarning {
  type: 'warning' | 'critical' | 'emergency';
  usage: number;
  quota: number;
  usageRatio: number;
  availableBytes: number;
  estimatedTimeToFull?: number;
  message: string;
}
```

#### getStorageBreakdown()

Get detailed storage usage.

```typescript
await monitor.getStorageBreakdown(): Promise<StorageBreakdown>
```

**StorageBreakdown:**

```typescript
interface StorageBreakdown {
  totalUsage: number;
  vectorDatabases: Array<{
    name: string;
    estimatedSize: number;
    vectorCount: number;
  }>;
  otherOriginData: number;
}
```

## Worker Pool

```typescript
import { WorkerPool } from 'vector-frankl/workers';
```

Parallel processing using Web Workers.

```typescript
const pool = new WorkerPool({
  maxWorkers: 4,
  workerScript: 'vector-worker.js',
  timeout: 30000,
});
```

### PoolConfig

```typescript
interface PoolConfig {
  maxWorkers?: number;
  workerScript?: string;
  timeout?: number;
  retries?: number;
  sharedMemoryConfig?: {
    maxPoolSize?: number;
    enableOptimizations?: boolean;
    chunkSize?: number;
  };
}
```

### Methods

#### init()

Initialize the worker pool.

```typescript
await pool.init(): Promise<void>
```

#### execute()

Execute a task in the worker pool.

```typescript
await pool.execute<T>(task: WorkerTask): Promise<T>
```

#### parallelSimilaritySearch()

Perform parallel similarity search.

```typescript
await pool.parallelSimilaritySearch(
  vectors: VectorData[],
  queryVector: Float32Array,
  k: number,
  metric?: DistanceMetric
): Promise<SearchResult[]>
```

#### terminate()

Terminate all workers.

```typescript
await pool.terminate(): Promise<void>
```

### SharedMemoryManager

Zero-copy shared memory for vector data between the main thread and Web Workers.

> [!WARNING] Requires cross-origin isolation
> `SharedMemoryManager` uses `SharedArrayBuffer`, which is only available when the page is served with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`. Construction throws when `SharedArrayBuffer` is undefined. Always check `self.crossOriginIsolated` before instantiating. See [docs/shared-memory.md](./shared-memory.md) for setup instructions and fallback guidance.

```typescript
import { SharedMemoryManager } from 'vector-frankl/workers';

if (self.crossOriginIsolated) {
  const memory = new SharedMemoryManager({
    maxPoolSize: 100 * 1024 * 1024, // 100 MB pool
    initialBufferSize: 1024 * 1024, // 1 MB per allocation
    alignment: 8,
    enableStats: true,
  });
}
```

#### Config Options

```typescript
interface SharedMemoryConfig {
  /** Maximum memory pool size in bytes (default: 100 MB) */
  maxPoolSize?: number;
  /** Initial buffer size for new allocations (default: 1 MB) */
  initialBufferSize?: number;
  /** Memory alignment for optimal performance (default: 8) */
  alignment?: number;
  /** Enable memory statistics tracking (default: true) */
  enableStats?: boolean;
}
```

#### allocateVectorBuffer()

Allocate a shared buffer sized for a given number of vectors.

```typescript
const { buffer, layout } = memory.allocateVectorBuffer(
  vectorCount, // number of vectors
  dimension, // vector dimension
  bytesPerElement, // default: 4 (Float32)
);
```

#### releaseBuffer()

Return a buffer to the pool for reuse.

```typescript
memory.releaseBuffer(buffer);
```

#### sharedMemoryBatchSearch()

Similarity search over shared-memory buffers. This is an **experimental** method. Prefer `WorkerPool.parallelSearch()` for production use.

```typescript
const results = await memory.sharedMemoryBatchSearch(
  vectors, // Float32Array[]
  queries, // Float32Array[]
  k, // top-k results per query
  'cosine', // DistanceMetric
  { chunkSize: 1000, normalize: false },
);
```

#### getStats()

```typescript
const stats = memory.getStats();
// { totalAllocated, totalUsed, activeBlocks, poolHits, poolMisses, fragmentationRatio }
```

#### cleanup()

Remove pool entries older than `maxAge` milliseconds that are not in use.

```typescript
memory.cleanup(60_000); // evict blocks idle for more than 60 seconds
```

## Performance Acceleration

### WebGPU Acceleration

GPU-accelerated vector operations.

```typescript
import { GPUSearchEngine } from 'vector-frankl/gpu';

const gpu = new GPUSearchEngine({
  gpuThreshold: 1000,
  enableFallback: true,
  batchSize: 1024,
  enableProfiling: false,
});

await gpu.init();

const { results, stats } = await gpu.search(vectors, queryVector, k, 'cosine');
```

**GPUSearchEngine.search() signature:**

```typescript
await gpu.search(
  vectors: VectorData[],
  queryVector: Float32Array,
  k: number,
  metric?: DistanceMetric,
  options?: SearchOptions
): Promise<{ results: SearchResult[]; stats: GPUSearchStats }>
```

**GPUSearchConfig:**

```typescript
interface GPUSearchConfig {
  gpuThreshold?: number;
  enableFallback?: boolean;
  batchSize?: number;
  enableProfiling?: boolean;
  webGPUConfig?: {
    powerPreference?: 'low-power' | 'high-performance';
    debug?: boolean;
    maxBufferSize?: number;
  };
}
```

## Debug & Profiling

```typescript
import { getDebug, debugManager, withProfiling } from 'vector-frankl/debug';
```

### Enable Debugging

```typescript
import { debugManager } from 'vector-frankl/debug';

debugManager.enable({
  profile: true,
  traceLevel: 'detailed',
  memoryTracking: true,
});
```

### Performance Profiling

```typescript
import { withProfiling } from 'vector-frankl/debug';

const results = await withProfiling('vector-search', () => db.search(queryVector, 10));
```

### Debug Console

```typescript
const debug = getDebug();

// Get summary
const summary = debug.profiler.getSummary();

// Export debug information
const report = debug.manager.exportReport();
```

## Error Types

### VectorDatabaseError

Abstract base error class for all vector database errors.

```typescript
import { VectorDatabaseError, isVectorDatabaseError } from 'vector-frankl';

abstract class VectorDatabaseError extends Error {
  readonly code: string;
  readonly timestamp: Date;
  readonly context?: Record<string, unknown>;
}
```

### Concrete Error Classes

```typescript
import {
  DimensionMismatchError,
  QuotaExceededError,
  VectorNotFoundError,
  InvalidFormatError,
  NamespaceExistsError,
  NamespaceNotFoundError,
  DatabaseInitializationError,
  TransactionError,
  BatchOperationError,
  IndexError,
  BrowserSupportError,
} from 'vector-frankl';
```

### Error Codes

- `DIMENSION_MISMATCH`: Vector dimension doesn't match database dimension
- `VECTOR_NOT_FOUND`: Requested vector ID not found
- `INVALID_FORMAT`: Unsupported vector format
- `QUOTA_EXCEEDED`: Storage quota exceeded
- `INDEX_ERROR`: Index operation failed
- `NAMESPACE_EXISTS`: Namespace already exists
- `NAMESPACE_NOT_FOUND`: Namespace not found
- `DATABASE_INIT_FAILED`: Database initialization failed
- `TRANSACTION_FAILED`: Database transaction failed
- `BATCH_OPERATION_FAILED`: Batch operation partially or fully failed
- `BROWSER_NOT_SUPPORTED`: Required browser feature not available

### Error Handling

```typescript
import { isVectorDatabaseError, VectorDatabaseError } from 'vector-frankl';

try {
  await db.addVector('id', vector);
} catch (error) {
  if (isVectorDatabaseError(error)) {
    console.error(`Error ${error.code}:`, error.message);
    console.error('Context:', error.context);
  }
}
```

## Metadata Filtering

### Filter Syntax

```typescript
type MetadataFilter = SimpleFilter | AndFilter | OrFilter | NotFilter;

interface SimpleFilter {
  [field: string]: FilterValue | FilterOperator;
}

interface AndFilter {
  $and: MetadataFilter[];
}

interface OrFilter {
  $or: MetadataFilter[];
}

interface NotFilter {
  $not: MetadataFilter;
}

type FilterValue = string | number | boolean | null | undefined;

interface FilterOperator {
  $eq?: FilterValue;
  $ne?: FilterValue;
  $gt?: number;
  $gte?: number;
  $lt?: number;
  $lte?: number;
  $in?: FilterValue[];
  $nin?: FilterValue[];
  $contains?: string;
  $between?: [number, number];
}
```

### Examples

```typescript
// Simple equality
const f1: MetadataFilter = { category: 'education' };

// Range query
const f2: MetadataFilter = { year: { $gte: 2023, $lte: 2024 } };

// Array membership
const f3: MetadataFilter = { tags: { $in: ['AI', 'ML'] } };

// Complex query
const f4: MetadataFilter = {
  $and: [
    { category: 'education' },
    {
      $or: [{ year: 2024 }, { featured: true }],
    },
  ],
};
```

## Type Definitions

### VectorFormat

Supported vector input types:

```typescript
type VectorFormat = Float32Array | Float64Array | Int8Array | Uint8Array | number[];
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
  | 'dot';
```

### IndexStrategy

Available index strategies:

```typescript
type IndexStrategy = 'auto' | 'brute' | 'kdtree' | 'hnsw';
```

### CompressionStrategy

Compression strategies:

```typescript
type CompressionStrategy = 'none' | 'scalar' | 'product' | 'binary';
```

### EvictionPolicy

Eviction policies (used within `EvictionConfig`):

```typescript
interface EvictionConfig {
  strategy: 'lru' | 'lfu' | 'ttl' | 'score' | 'hybrid';
  targetBytes?: number;
  maxVectors?: number;
  ttlHours?: number;
  preservePermanent?: boolean;
  batchSize?: number;
}
```
