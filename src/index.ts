/**
 * Vector Database for IndexedDB
 *
 * A high-performance vector database that runs entirely in the browser,
 * built on top of IndexedDB for persistent storage.
 *
 * Optional subsystems available via deep imports:
 *   vector-frankl/gpu         — GPU acceleration
 *   vector-frankl/workers     — Web Worker pool
 *   vector-frankl/debug       — Debug/profiling tools
 *   vector-frankl/benchmarks  — Performance benchmarks
 *   vector-frankl/compression — Compression internals
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
  FilterOperator,
  FilterValue,
  SimpleFilter,
  AndFilter,
  OrFilter,
  NotFilter,

  // Batch operations
  BatchOptions,
  BatchProgress,

  // Storage types
  StorageAdapter,
  StorageAdapterFactory,
  StorageEstimate,

  // Index types
  IndexStrategy,
  IndexConfig,
  HNSWParameters,
  KDTreeParameters,
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

// Vector utilities
export { VectorOperations } from './vectors/operations.js';
export { VectorFormatHandler } from './vectors/formats.js';

// Search utilities
export { SearchEngine } from './search/search-engine.js';
export {
  DistanceMetrics,
  DistanceCalculator,
  createDistanceCalculator,
  registerCustomMetric,
  listAvailableMetrics,
  type DistanceMetricImplementation,
} from './search/distance-metrics.js';
export {
  MetadataFilterCompiler,
  MetadataRangeQuery,
  metadataQuery,
} from './search/metadata-filter.js';
export { HNSWIndex } from './search/hnsw-index.js';
export { IndexPersistence, IndexCache } from './search/index-persistence.js';

// Storage adapters (universally usable)
export { MemoryStorageAdapter } from './storage/adapters/memory-adapter.js';
export { IndexedDatabaseStorageAdapter } from './storage/adapters/indexed-database-adapter.js';

// Storage management utilities
export {
  StorageQuotaMonitor,
  type QuotaEstimate,
  type QuotaWarning,
  type StorageBreakdown,
} from './storage/quota-monitor.js';
export {
  EvictionManager,
  LRUEvictionPolicy,
  LFUEvictionPolicy,
  TTLEvictionPolicy,
  ScoreBasedEvictionPolicy,
  HybridEvictionPolicy,
  type EvictionConfig,
  type EvictionResult,
} from './storage/eviction-policy.js';

// Version — sourced from package.json to maintain a single source of truth
export { version as VERSION } from '../package.json';
