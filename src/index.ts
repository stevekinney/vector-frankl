/**
 * Vector Database for IndexedDB
 * 
 * A high-performance vector database that runs entirely in the browser,
 * built on top of IndexedDB for persistent storage.
 */

// Main API (with namespace support)
export { VectorFrankl } from './api/vector-frankl.js';

// Simple API (without namespace support)
export { VectorDB } from './api/database.js';

// Namespace management
export { NamespaceManager } from './namespaces/manager.js';
export { VectorNamespace } from './namespaces/namespace.js';
export { NamespaceRegistry } from './namespaces/registry.js';

// Core types
export type {
  // Database types
  DatabaseConfig,
  VectorData,
  VectorFormat,
  
  // Namespace types
  NamespaceConfig,
  NamespaceInfo,
  NamespaceStats,
  
  // Search types
  SearchOptions,
  SearchResult,
  DistanceMetric,
  MetadataFilter,
  
  // Batch operations
  BatchOptions,
  BatchProgress,
  
  // Storage types
  StorageEstimate,
  
  // Index types
  IndexStrategy,
  IndexConfig,
  CompressionStrategy,
} from './core/types.js';

// Errors
export {
  VectorDatabaseError,
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
  isVectorDatabaseError,
} from './core/errors.js';

// Vector utilities (for advanced users)
export { VectorOperations } from './vectors/operations.js';
export { VectorFormatHandler } from './vectors/formats.js';

// Search utilities
export { SearchEngine } from './search/search-engine.js';
export { 
  DistanceMetrics, 
  DistanceCalculator, 
  createDistanceCalculator, 
  registerCustomMetric, 
  listAvailableMetrics 
} from './search/distance-metrics.js';
export { 
  MetadataFilterCompiler, 
  MetadataRangeQuery, 
  metadataQuery 
} from './search/metadata-filter.js';
export { HNSWIndex } from './search/hnsw-index.js';
export { IndexPersistence, IndexCache } from './search/index-persistence.js';

// Storage management utilities
export { 
  StorageQuotaMonitor,
  type QuotaEstimate,
  type QuotaWarning,
  type StorageBreakdown
} from './storage/quota-monitor.js';
export { 
  EvictionManager,
  LRUEvictionPolicy,
  LFUEvictionPolicy,
  TTLEvictionPolicy,
  ScoreBasedEvictionPolicy,
  HybridEvictionPolicy,
  type EvictionConfig,
  type EvictionResult
} from './storage/eviction-policy.js';

// Worker management utilities
export { 
  WorkerPool,
  type WorkerTask,
  type WorkerResponse,
  type PoolConfig
} from './workers/worker-pool.js';
export {
  SharedMemoryManager,
  sharedMemoryManager,
  type SharedMemoryConfig,
  type MemoryBlock,
  type SharedMemoryLayout,
  type SharedMemoryStats
} from './workers/shared-memory.js';

// GPU acceleration utilities
export {
  WebGPUManager,
  webGPUManager,
  type WebGPUConfig,
  type GPUComputeResult,
  type GPUCapabilities
} from './gpu/webgpu-manager.js';
export {
  GPUSearchEngine,
  type GPUSearchConfig,
  type GPUSearchStats
} from './gpu/gpu-search-engine.js';

// Vector compression utilities
export {
  CompressionManager,
  ScalarQuantizer,
  ProductQuantizer,
  BaseCompressor,
  compressVector,
  decompressVector,
  getCompressionRecommendation,
  compareCompressionStrategies,
  type CompressionConfig,
  type CompressionMetadata,
  type CompressionQuality,
  type CompressedVector,
  type CompressionManagerConfig,
  type CompressionRecommendation,
  type ScalarQuantizationConfig,
  type QuantizationStrategy,
  type PQConfig,
  type PQCodebook,
  type PQInitMethod
} from './compression/index.js';

// Debug and profiling tools
export {
  debug,
  debugManager,
  profiler,
  createDebugConsole,
  withProfiling,
  withContext,
  debugMethod,
  createTimer,
  type DebugConfig,
  type DebugConsole,
  type PerformanceStats
} from './debug/index.js';

// Performance benchmarking
export {
  BenchmarkSuite,
  BenchmarkRunner,
  QuickBenchmark,
  type BenchmarkConfig,
  type BenchmarkResult,
  type BenchmarkSummary,
  type BenchmarkRunnerOptions
} from './benchmarks/index.js';

// Version
export const VERSION = '0.1.0'; // Bumped for namespace support

// Example usage with namespaces:
/*
import { VectorFrankl } from 'vector-frankl';

// Create the main database instance
const db = new VectorFrankl();
await db.init();

// Create namespaces for different types of embeddings
const products = await db.createNamespace('products', {
  dimension: 384,
  distanceMetric: 'cosine',
  description: 'Product embeddings from e-commerce catalog'
});

const docs = await db.createNamespace('documents', {
  dimension: 768,
  distanceMetric: 'euclidean',
  description: 'Document embeddings from knowledge base'
});

// Add vectors to specific namespaces
await products.addVector('product-1', productEmbedding, { name: 'Widget' });
await docs.addVector('doc-1', docEmbedding, { title: 'User Manual' });

// Search within namespaces
const productResults = await products.search(queryEmbedding, 10);
const docResults = await docs.search(queryEmbedding, 5);

// Use the simple API for backwards compatibility
import { VectorDB } from 'vector-frankl';
const simpleDb = new VectorDB('my-vectors', 384);
await simpleDb.init();
*/
