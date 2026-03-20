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

/**
 * Database configuration
 */
export interface DatabaseConfig {
  name: string;
  version?: number;
  persistence?: boolean;
  /** Optional callback to override default schema creation during upgrades */
  onUpgrade?: (database: IDBDatabase, oldVersion: number) => void;
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
  signal?: AbortSignal;
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

export interface FilterOperator {
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

/**
 * Batch operation options
 */
export interface BatchOptions {
  batchSize?: number;
  onProgress?: (progress: BatchProgress) => void;
  abortSignal?: AbortSignal;
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
  mode?: IDBTransactionMode;
  timeout?: number;
  retries?: number;
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
    updates: Array<{ id: string; vector?: Float32Array; metadata?: Record<string, unknown> }>,
    options?: BatchOptions,
  ): Promise<{ succeeded: number; failed: number; errors: Array<{ id: string; error: Error }> }>;
}

/**
 * Factory function that creates a StorageAdapter for a given database name.
 */
export type StorageAdapterFactory = (databaseName: string) => StorageAdapter;
