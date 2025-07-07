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
export type IndexStrategy = 
  | 'auto' 
  | 'brute' 
  | 'kdtree' 
  | 'hnsw';

/**
 * Compression strategies
 */
export type CompressionStrategy = 
  | 'none' 
  | 'scalar' 
  | 'product' 
  | 'binary';

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
export type MetadataFilter = 
  | SimpleFilter 
  | AndFilter 
  | OrFilter 
  | NotFilter;

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