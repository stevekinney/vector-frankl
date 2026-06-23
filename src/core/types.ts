/**
 * Core type definitions for the vector database
 */

/**
 * Supported vector formats
 */
export type VectorFormat =
  | Float32Array
  | Float64Array
  | Int8Array
  | Uint8Array
  | number[];

/**
 * Vector data structure
 */
export interface VectorData {
  id: string;
  vector: Float32Array;
  metadata?: Record<string, unknown>;
  magnitude: number;
  format?: string;
  normalized?: boolean;
  timestamp: number;
  lastAccessed?: number;
  accessCount?: number;
  compression?: {
    strategy: CompressionStrategy;
    originalSize: number;
    compressedSize: number;
    compressionRatio: number;
    precisionLoss: number;
  };
}

export interface IndexedDatabaseObjectStoreNames {
  contains(name: string): boolean;
}

export interface IndexedDatabaseUpgradeDatabase {
  objectStoreNames: IndexedDatabaseObjectStoreNames;
  createObjectStore(
    name: string,
    options?: { keyPath?: string | string[]; autoIncrement?: boolean },
  ): IndexedDatabaseObjectStore;
  deleteObjectStore(name: string): void;
}

export interface IndexedDatabaseObjectStore {
  createIndex(
    name: string,
    keyPath: string | string[],
    options?: { unique?: boolean; multiEntry?: boolean },
  ): unknown;
  add<T = unknown>(value: T, key?: unknown): IndexedDatabaseRequest<unknown>;
  put<T = unknown>(value: T, key?: unknown): IndexedDatabaseRequest<unknown>;
  get<T = unknown>(query: unknown): IndexedDatabaseRequest<T | undefined>;
  getAll<T = unknown>(query?: unknown, count?: number): IndexedDatabaseRequest<T[]>;
  delete(query: unknown): IndexedDatabaseRequest<undefined>;
  clear(): IndexedDatabaseRequest<undefined>;
  count(query?: unknown): IndexedDatabaseRequest<number>;
  openCursor<T = unknown>(
    query?: unknown,
    direction?: string,
  ): IndexedDatabaseRequest<IndexedDatabaseCursor<T> | null>;
}

export type IndexedDatabaseTransactionMode = 'readonly' | 'readwrite' | 'versionchange';

export interface IndexedDatabaseRequest<T = unknown> {
  onsuccess: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  readonly result: T;
  readonly error: Error | null;
}

export interface IndexedDatabaseCursor<T = unknown> {
  readonly value: T;
  continue(): void;
}

export interface IndexedDatabaseTransaction {
  oncomplete: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onabort: ((event: unknown) => void) | null;
  readonly error: Error | null;
  readonly mode: IndexedDatabaseTransactionMode;
  objectStore(name: string): IndexedDatabaseObjectStore;
  abort(): void;
}

export interface IndexedDatabaseInfo {
  name?: string;
  version?: number;
}

export interface VectorAbortSignal {
  readonly aborted: boolean;
}

/**
 * Database configuration
 */
export interface DatabaseConfig {
  name: string;
  version?: number;
  persistence?: boolean;
  /** Optional callback to override default schema creation during upgrades */
  onUpgrade?: (database: IndexedDatabaseUpgradeDatabase, oldVersion: number) => void;
}

/**
 * Namespace configuration
 */
export interface NamespaceConfig {
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

/**
 * Namespace information
 */
export interface NamespaceInfo {
  name: string;
  config: NamespaceConfig;
  stats: NamespaceStats;
  created: number;
  modified: number;
}

/**
 * Namespace statistics
 */
export interface NamespaceStats {
  vectorCount: number;
  storageSize: number;
  lastAccessed?: number;
  indexSize?: number;
}

/**
 * Distance metrics
 */
export type DistanceMetric =
  | 'cosine'
  | 'euclidean'
  | 'manhattan'
  | 'hamming'
  | 'jaccard'
  | 'dot';

/**
 * Index strategies
 */
export type IndexStrategy = 'auto' | 'brute' | 'kdtree' | 'hnsw';

/**
 * Compression strategies
 */
export type CompressionStrategy = 'none' | 'scalar' | 'product' | 'binary';

/**
 * Search options
 */
export interface SearchOptions {
  filter?: MetadataFilter;
  includeVector?: boolean;
  includeMetadata?: boolean;
  timeout?: number;
  signal?: VectorAbortSignal;
}

/**
 * Search result
 */
export interface SearchResult {
  id: string;
  score: number;
  distance?: number;
  vector?: Float32Array;
  metadata?: Record<string, unknown>;
  highlights?: Record<string, unknown>;
}

/**
 * Metadata filter
 */
export type MetadataFilter = SimpleFilter | AndFilter | OrFilter | NotFilter;

export interface SimpleFilter {
  [field: string]: FilterValue | FilterOperator;
}

export interface AndFilter {
  $and: MetadataFilter[];
}

export interface OrFilter {
  $or: MetadataFilter[];
}

export interface NotFilter {
  $not: MetadataFilter;
}

export type FilterValue = string | number | boolean | null | undefined;

export type FilterTypeString =
  | 'null'
  | 'boolean'
  | 'number'
  | 'string'
  | 'array'
  | 'object';

export type RegexFilter =
  | string
  | RegExp
  | { pattern: string; flags?: string };

export interface FilterOperator {
  $eq?: FilterValue;
  $ne?: FilterValue;
  $gt?: number;
  $gte?: number;
  $lt?: number;
  $lte?: number;
  $in?: FilterValue[];
  $nin?: FilterValue[];
  /** Test whether a string field contains the given substring. */
  $contains?: string;
  /** Test whether a numeric field falls within [min, max] (inclusive). */
  $between?: [number, number];
  /** Test whether a field exists (true) or is absent (false). */
  $exists?: boolean;
  /** Test whether a field's JavaScript type matches the given type string. */
  $type?: FilterTypeString;
  /**
   * Test whether a string field matches a regex pattern.
   * Accepts a pattern string, a RegExp literal, or an object
   * with `pattern` and optional `flags` strings.
   * Patterns are validated against ReDoS heuristics before execution.
   */
  $regex?: RegexFilter;
  /** Test whether an array field has exactly the given length. */
  $size?: number;
  /** Test whether an array field contains all of the given values. */
  $all?: FilterValue[];
  /**
   * Test whether at least one element of an array field matches the
   * given sub-filter or value.
   */
  $elemMatch?: MetadataFilter | FilterValue;
}

/**
 * Batch operation options
 */
export interface BatchOptions {
  batchSize?: number;
  onProgress?: (progress: BatchProgress) => void;
  abortSignal?: VectorAbortSignal;
  parallel?: boolean;
}

/**
 * Batch progress
 */
export interface BatchProgress {
  total: number;
  completed: number;
  failed: number;
  percentage: number;
  currentBatch: number;
  totalBatches: number;
}

/**
 * Storage estimate
 */
export interface StorageEstimate {
  usage: number;
  quota: number;
  percentage: number;
  databases?: DatabaseStorageInfo[];
}

/**
 * Database storage info
 */
export interface DatabaseStorageInfo {
  name: string;
  size: number;
  namespaces?: NamespaceStorageInfo[];
}

/**
 * Namespace storage info
 */
export interface NamespaceStorageInfo {
  name: string;
  vectorCount: number;
  storageSize: number;
  indexSize?: number;
}

/**
 * Index configuration
 */
export interface IndexConfig {
  type: IndexStrategy;
  parameters?: HNSWParameters | KDTreeParameters;
}

/**
 * HNSW index parameters
 */
export interface HNSWParameters {
  M?: number;
  efConstruction?: number;
  ef?: number;
  seed?: number;
}

/**
 * KD-tree parameters
 */
export interface KDTreeParameters {
  leafSize?: number;
  rebalanceThreshold?: number;
}

/**
 * Transaction options
 */
export interface TransactionOptions {
  stores?: string[];
  mode?: IndexedDatabaseTransactionMode;
  timeout?: number;
  retries?: number;
}

/**
 * Options for cursor/streaming scans over the full store.
 */
export interface ScanOptions {
  /**
   * Hint to the adapter for how many records to fetch per internal page or
   * cursor advance. Adapters may ignore this if the underlying storage does
   * not support paging (e.g. in-memory Map).
   */
  pageSize?: number;
  /** Optional abort signal to cancel a long-running scan. */
  signal?: VectorAbortSignal;
}

/**
 * Describes whether a storage adapter supports native cursor/streaming scans
 * or falls back to a fully-materialized scan via `getAll()`.
 *
 * Adapters that cannot support streaming scans must set `nativeStreaming` to
 * `false` and document the limitation in `limitationReason`.
 */
export interface ScanCapabilities {
  /** True when the adapter streams records from storage without loading all into memory. */
  nativeStreaming: boolean;
  /** Human-readable explanation when `nativeStreaming` is false. */
  limitationReason?: string;
}

/**
 * Storage adapter interface for pluggable storage backends.
 *
 * Each adapter manages vector persistence for a single logical database.
 * Access tracking (lastAccessed / accessCount) is the adapter's responsibility
 * — update on get/getMany so callers don't need a wrapper layer.
 */
export interface StorageAdapter {
  // Lifecycle
  init(): Promise<void>;
  close(): Promise<void>;
  destroy(): Promise<void>;

  // Single-item CRUD
  put(vector: VectorData): Promise<void>;
  get(id: string): Promise<VectorData>;
  exists(id: string): Promise<boolean>;
  delete(id: string): Promise<void>;

  // Multi-item reads
  getMany(ids: string[]): Promise<VectorData[]>;
  getAll(): Promise<VectorData[]>;
  count(): Promise<number>;

  /**
   * Stream all vectors one at a time (or in pages, depending on the adapter).
   *
   * Prefer `scan()` over `getAll()` for search, eviction, and maintenance
   * operations that do not need the full store in memory at once.
   *
   * Callers should treat `scan()` as the canonical iteration primitive and
   * only fall back to `getAll()` when random access to the full slice is
   * genuinely required (e.g. sorting across the entire corpus).
   */
  scan(options?: ScanOptions): AsyncIterable<VectorData>;

  /**
   * Report whether this adapter natively streams records from storage or
   * materializes them in memory. Callers can inspect this to decide whether
   * `scan()` provides bounded-memory iteration on large stores.
   */
  getScanCapabilities(): ScanCapabilities;

  // Multi-item writes
  deleteMany(ids: string[]): Promise<number>;
  clear(): Promise<void>;
  putBatch(vectors: VectorData[], options?: BatchOptions): Promise<void>;

  // Partial updates (read-modify-write)
  updateVector(
    id: string,
    vector: Float32Array,
    options?: { updateMagnitude?: boolean; updateTimestamp?: boolean },
  ): Promise<void>;
  updateMetadata(
    id: string,
    metadata: Record<string, unknown>,
    options?: { merge?: boolean; updateTimestamp?: boolean },
  ): Promise<void>;
  updateBatch(
    updates: Array<{
      id: string;
      vector?: Float32Array;
      metadata?: Record<string, unknown>;
    }>,
    options?: BatchOptions,
  ): Promise<{
    succeeded: number;
    failed: number;
    errors: Array<{ id: string; error: Error }>;
  }>;
}

/**
 * Factory function that creates a StorageAdapter for a given database name.
 */
export type StorageAdapterFactory = (databaseName: string) => StorageAdapter;
