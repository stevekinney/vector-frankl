import { VectorDB } from '@/api/database.js';
import type {
  BatchOptions,
  NamespaceConfig,
  SearchOptions,
  SearchResult,
  VectorData,
  VectorFormat,
} from '@/core/types.js';

/**
 * A namespace-scoped vector database
 */
export class VectorNamespace {
  private vectorDatabase: VectorDB;
  private databaseName: string;

  constructor(
    public readonly name: string,
    public readonly config: NamespaceConfig,
    rootDatabaseName: string,
  ) {
    // Create a unique database name for this namespace
    this.databaseName = `${rootDatabaseName}-ns-${name}`;

    // Create the vector database with namespace config
    this.vectorDatabase = new VectorDB(this.databaseName, config.dimension, {
      name: this.databaseName,
      version: 1,
    });
  }

  /**
   * Initialize the namespace database
   */
  async init(): Promise<void> {
    await this.vectorDatabase.init();
  }

  /**
   * Add a single vector
   */
  async addVector(
    id: string,
    vector: VectorFormat,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    return this.vectorDatabase.addVector(id, vector, metadata);
  }

  /**
   * Add multiple vectors
   */
  async addBatch(
    vectors: Array<{
      id: string;
      vector: VectorFormat;
      metadata?: Record<string, unknown>;
    }>,
    options?: BatchOptions,
  ): Promise<void> {
    return this.vectorDatabase.addBatch(vectors, options);
  }

  /**
   * Get a vector by ID
   */
  async getVector(id: string): Promise<VectorData | null> {
    return this.vectorDatabase.getVector(id);
  }

  /**
   * Delete a vector
   */
  async deleteVector(id: string): Promise<void> {
    return this.vectorDatabase.deleteVector(id);
  }

  /**
   * Search for similar vectors
   */
  async search(
    queryVector: VectorFormat,
    k: number = 10,
    options?: SearchOptions,
  ): Promise<SearchResult[]> {
    return this.vectorDatabase.search(queryVector, k, options);
  }

  /**
   * Search for vectors within a distance threshold
   */
  async searchRange(
    queryVector: VectorFormat,
    maxDistance: number,
    options?: SearchOptions & { maxResults?: number },
  ): Promise<SearchResult[]> {
    return this.vectorDatabase.searchRange(queryVector, maxDistance, options);
  }

  /**
   * Stream search results
   */
  async *searchStream(
    queryVector: VectorFormat,
    options?: SearchOptions & {
      batchSize?: number;
      maxResults?: number;
      progressive?: boolean;
    },
  ): AsyncGenerator<SearchResult[], void, unknown> {
    yield* this.vectorDatabase.searchStream(queryVector, options);
  }

  /**
   * Get namespace statistics
   */
  async getStats(): Promise<{
    vectorCount: number;
    dimension: number;
    distanceMetric: string;
    description?: string;
  }> {
    const baseStats = await this.vectorDatabase.getStats();

    return {
      ...baseStats,
      distanceMetric: this.config.distanceMetric || 'cosine',
      ...(this.config.description && { description: this.config.description }),
    };
  }

  /**
   * Clear all vectors in the namespace
   */
  async clear(): Promise<void> {
    return this.vectorDatabase.clear();
  }

  /**
   * Close the namespace database
   */
  async close(): Promise<void> {
    return this.vectorDatabase.close();
  }

  /**
   * Delete the namespace database
   */
  async delete(): Promise<void> {
    return this.vectorDatabase.delete();
  }

  /**
   * Check if a vector exists
   */
  async exists(id: string): Promise<boolean> {
    return this.vectorDatabase.exists(id);
  }

  /**
   * Get multiple vectors by IDs
   */
  async getMany(ids: string[]): Promise<VectorData[]> {
    return this.vectorDatabase.getMany(ids);
  }

  /**
   * Delete multiple vectors
   */
  async deleteMany(ids: string[]): Promise<number> {
    return this.vectorDatabase.deleteMany(ids);
  }

  /**
   * Get all vectors (use with caution on large datasets)
   */
  async getAllVectors(): Promise<VectorData[]> {
    return this.vectorDatabase.getAllVectors();
  }

  /**
   * Estimate storage usage for this namespace
   */
  async estimateStorageUsage(): Promise<{
    vectorCount: number;
    estimatedBytes: number;
  }> {
    const stats = await this.getStats();
    const vectors = stats.vectorCount;

    // Estimate: vector size + metadata + overhead
    // Float32Array = 4 bytes per dimension
    // Plus ~200 bytes overhead per vector for metadata and indices
    const bytesPerVector = this.config.dimension * 4 + 200;
    const estimatedBytes = vectors * bytesPerVector;

    return {
      vectorCount: vectors,
      estimatedBytes,
    };
  }

  /**
   * Get the distance metric for this namespace
   */
  getDistanceMetric(): string {
    return this.config.distanceMetric || 'cosine';
  }

  /**
   * Get the index strategy for this namespace
   */
  getIndexStrategy(): string {
    return this.config.indexStrategy || 'auto';
  }

  /**
   * Get the compression strategy for this namespace
   */
  getCompressionStrategy(): string {
    return this.config.compression || 'none';
  }

  /**
   * Get the full database name for this namespace
   */
  getDatabaseName(): string {
    return this.databaseName;
  }

  /**
   * Update a vector's data
   */
  async updateVector(
    id: string,
    vector: VectorFormat,
    options?: {
      updateMagnitude?: boolean;
      updateTimestamp?: boolean;
    },
  ): Promise<void> {
    return this.vectorDatabase.updateVector(id, vector, options);
  }

  /**
   * Update a vector's metadata
   */
  async updateMetadata(
    id: string,
    metadata: Record<string, unknown>,
    options?: {
      merge?: boolean;
      updateTimestamp?: boolean;
    },
  ): Promise<void> {
    return this.vectorDatabase.updateMetadata(id, metadata, options);
  }

  /**
   * Update multiple vectors
   */
  async updateBatch(
    updates: Array<{
      id: string;
      vector?: VectorFormat;
      metadata?: Record<string, unknown>;
    }>,
    options?: BatchOptions,
  ): Promise<{
    succeeded: number;
    failed: number;
    errors: Array<{ id: string; error: Error }>;
  }> {
    return this.vectorDatabase.updateBatch(updates, options);
  }
}
