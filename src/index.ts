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
export type { VectorFranklOptions } from './api/vector-frankl.js';

// Simple API (without namespace support)
export { VectorDB } from './api/database.js';

// Namespace management
export { AdapterNamespaceRegistry } from './namespaces/adapter-registry.js';
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
  FilterTypeString,
  RegexFilter,
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
  ErrorCode,
  VectorDatabaseError,
  DimensionMismatchError,
  QuotaExceededError,
  VectorNotFoundError,
  InvalidFormatError,
  NamespaceExistsError,
  NamespaceNotFoundError,
  NamespaceDeletionBlockedError,
  DatabaseInitializationError,
  TransactionError,
  BatchOperationError,
  IndexError,
  BrowserSupportError,
  SearchAbortedError,
  SearchTimeoutError,
  StorageCorruptionError,
  StorageFormatError,
  QuotaSafetyMarginError,
  isVectorDatabaseError,
  sanitizeContext,
} from './core/errors.js';
export type { ErrorCodeValue } from './core/errors.js';

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
/** @experimental HNSW recall, deletion, update, persistence, and rebuild guarantees are unvalidated. See {@link HNSWIndex} for details. */
export { HNSWIndex } from './search/hnsw-index.js';
export {
  IndexPersistence,
  IndexCache,
  type IndexHealthState,
  type IndexHealthReport,
} from './search/index-persistence.js';

// Storage adapters (universally usable)
export { MemoryStorageAdapter } from './storage/adapters/memory-adapter.js';
export { IndexedDatabaseStorageAdapter } from './storage/adapters/indexed-database-adapter.js';
export {
  OPFSStorageAdapter,
  CorruptVectorFileError,
} from './storage/adapters/opfs-adapter.js';
export {
  ChromeStorageAdapter,
  CHROME_STORAGE_MAX_SERIALIZED_BYTES,
} from './storage/adapters/chrome-storage-adapter.js';

// Storage adapter resolution
export {
  resolveStorageAdapter,
  isIndexedDBAvailable,
  type ResolveStorageAdapterOptions,
  type StorageBackend,
} from './storage/resolve-storage-adapter.js';

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

// Observability and health (deep-import: vector-frankl/debug)
// These are also available from the main entry point for convenience.
export { ObservabilityManager, observability } from './debug/observability.js';
export type {
  ObservabilityEvent,
  ObservabilityEventType,
  ObservabilityHandler,
  SearchLatencyEvent,
  StorageLatencyEvent,
  IndexRebuildEvent,
  QuotaWarningEvent,
  EvictionEvent,
  WorkerFailureEvent,
  GPUFallbackEvent,
  WASMFallbackEvent,
  AdapterConnectivityEvent,
  CorruptionRecoveryEvent,
} from './debug/observability.js';

export { HealthMonitor, createHealthMonitor } from './debug/health.js';
export type {
  HealthStatus,
  StorageHealth,
  IndexHealth,
  AccelerationHealth,
  AdapterConnectivityResult,
  DiagnosticsReport,
} from './debug/health.js';

// Version
export { VERSION } from './version.js';
