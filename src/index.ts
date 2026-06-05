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

import { VectorDB } from './api/database.js';
import { VectorFrankl } from './api/vector-frankl.js';
import {
  BatchOperationError,
  BrowserSupportError,
  DatabaseInitializationError,
  DimensionMismatchError,
  IndexError,
  InvalidFormatError,
  isVectorDatabaseError,
  NamespaceExistsError,
  NamespaceNotFoundError,
  QuotaExceededError,
  TransactionError,
  VectorDatabaseError,
  VectorNotFoundError,
} from './core/errors.js';
import { AdapterNamespaceRegistry } from './namespaces/adapter-registry.js';
import { NamespaceManager } from './namespaces/manager.js';
import { VectorNamespace } from './namespaces/namespace.js';
import { NamespaceRegistry } from './namespaces/registry.js';
import {
  createDistanceCalculator,
  DistanceCalculator,
  DistanceMetrics,
  listAvailableMetrics,
  registerCustomMetric,
} from './search/distance-metrics.js';
import { HNSWIndex } from './search/hnsw-index.js';
import { IndexCache, IndexPersistence } from './search/index-persistence.js';
import {
  MetadataFilterCompiler,
  metadataQuery,
  MetadataRangeQuery,
} from './search/metadata-filter.js';
import { SearchEngine } from './search/search-engine.js';
import {
  EvictionManager,
  HybridEvictionPolicy,
  LFUEvictionPolicy,
  LRUEvictionPolicy,
  ScoreBasedEvictionPolicy,
  TTLEvictionPolicy,
} from './storage/eviction-policy.js';
import { ChromeStorageAdapter } from './storage/adapters/chrome-storage-adapter.js';
import { IndexedDatabaseStorageAdapter } from './storage/adapters/indexed-database-adapter.js';
import { MemoryStorageAdapter } from './storage/adapters/memory-adapter.js';
import { OPFSStorageAdapter } from './storage/adapters/opfs-adapter.js';
import { SQLiteStorageAdapter } from './storage/adapters/sqlite-adapter.js';
import { StorageQuotaMonitor } from './storage/quota-monitor.js';
import { resolveStorageAdapter } from './storage/resolve-storage-adapter.js';
import { systemTimeSource } from './utilities/time-source.js';
import { VectorFormatHandler } from './vectors/formats.js';
import { VectorOperations } from './vectors/operations.js';

const VERSION = '1.0.0-beta.1';

// Main API (with namespace support)
export type { VectorFranklOptions } from './api/vector-frankl.js';
export { VectorFrankl };

// Simple API (without namespace support)
export { VectorDB };

// Namespace management
export { AdapterNamespaceRegistry, NamespaceManager, NamespaceRegistry, VectorNamespace };

// Core types
export type {
  AndFilter,
  // Batch operations
  BatchOptions,
  BatchProgress,
  CompressionStrategy,
  // Database types
  DatabaseConfig,
  DistanceMetric,
  FilterOperator,
  FilterValue,
  HNSWParameters,
  IndexConfig,
  // Index types
  IndexStrategy,
  KDTreeParameters,
  MetadataFilter,
  // Namespace types
  NamespaceConfig,
  NamespaceInfo,
  NamespaceStats,
  NotFilter,
  OrFilter,
  // Search types
  SearchOptions,
  SearchResult,
  SimpleFilter,
  // Storage types
  StorageAdapter,
  StorageAdapterFactory,
  StorageEstimate,
  VectorData,
  VectorFormat,
} from './core/types.js';

// Errors
export {
  BatchOperationError,
  BrowserSupportError,
  DatabaseInitializationError,
  DimensionMismatchError,
  IndexError,
  InvalidFormatError,
  isVectorDatabaseError,
  NamespaceExistsError,
  NamespaceNotFoundError,
  QuotaExceededError,
  TransactionError,
  VectorDatabaseError,
  VectorNotFoundError,
};

// Vector utilities
export type { TimeSource } from './utilities/time-source.js';
export { systemTimeSource, VectorFormatHandler, VectorOperations };

// Search utilities
export type { DistanceMetricImplementation } from './search/distance-metrics.js';
export {
  createDistanceCalculator,
  DistanceCalculator,
  DistanceMetrics,
  HNSWIndex,
  IndexCache,
  IndexPersistence,
  listAvailableMetrics,
  MetadataFilterCompiler,
  metadataQuery,
  MetadataRangeQuery,
  registerCustomMetric,
  SearchEngine,
};

// Storage adapters (universally usable)
export {
  ChromeStorageAdapter,
  IndexedDatabaseStorageAdapter,
  MemoryStorageAdapter,
  OPFSStorageAdapter,
  SQLiteStorageAdapter,
};

// Storage adapter resolution
export type {
  ResolvedStorageAdapter,
  StorageAdapterPreference,
  StorageResolutionOptions,
} from './storage/resolve-storage-adapter.js';
export { resolveStorageAdapter };

// Storage management utilities
export type { EvictionConfig, EvictionResult } from './storage/eviction-policy.js';
export {
  EvictionManager,
  HybridEvictionPolicy,
  LFUEvictionPolicy,
  LRUEvictionPolicy,
  ScoreBasedEvictionPolicy,
  StorageQuotaMonitor,
  TTLEvictionPolicy,
};
export type {
  QuotaEstimate,
  QuotaWarning,
  StorageBreakdown,
} from './storage/quota-monitor.js';

// Version — keep this in sync with the canonical package metadata.
export { VERSION };
