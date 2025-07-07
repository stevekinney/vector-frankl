import { NamespaceManager } from '@/namespaces/manager.js';
import { VectorNamespace } from '@/namespaces/namespace.js';
import { VectorDB } from './database.js';
import type { 
  NamespaceConfig, 
  NamespaceInfo,
  VectorFormat,
  VectorData,
  SearchResult,
  SearchOptions,
  BatchOptions
} from '@/core/types.js';

/**
 * Main API for Vector Frankl - A browser-based vector database
 */
export class VectorFrankl {
  private namespaceManager: NamespaceManager;
  private defaultNamespace?: VectorNamespace;
  private initialized = false;

  constructor(
    private _rootDatabaseName = 'vector-frankl',
    private defaultDimension?: number
  ) {
    this.namespaceManager = new NamespaceManager(this._rootDatabaseName);
  }

  /**
   * Initialize the vector database
   */
  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }

    await this.namespaceManager.init();
    
    // If a default dimension is provided, create a default namespace
    if (this.defaultDimension) {
      // Check if default namespace exists
      const defaultExists = await this.namespaceManager.namespaceExists('default');
      
      if (!defaultExists) {
        // Create default namespace
        this.defaultNamespace = await this.namespaceManager.createNamespace('default', {
          dimension: this.defaultDimension,
          distanceMetric: 'cosine',
          description: 'Default namespace'
        });
      } else {
        // Load existing default namespace
        this.defaultNamespace = await this.namespaceManager.getNamespace('default');
      }
    }

    this.initialized = true;
  }

  // === Namespace Management ===

  /**
   * Create a new namespace
   */
  async createNamespace(
    name: string,
    config: NamespaceConfig
  ): Promise<VectorNamespace> {
    await this.ensureInitialized();
    return this.namespaceManager.createNamespace(name, config);
  }

  /**
   * Get an existing namespace
   */
  async getNamespace(name: string): Promise<VectorNamespace> {
    await this.ensureInitialized();
    return this.namespaceManager.getNamespace(name);
  }

  /**
   * Delete a namespace
   */
  async deleteNamespace(name: string): Promise<void> {
    await this.ensureInitialized();
    
    // Prevent deleting the default namespace if it's in use
    if (name === 'default' && this.defaultNamespace) {
      throw new Error('Cannot delete the default namespace while it is in use');
    }
    
    return this.namespaceManager.deleteNamespace(name);
  }

  /**
   * List all namespaces
   */
  async listNamespaces(): Promise<NamespaceInfo[]> {
    await this.ensureInitialized();
    return this.namespaceManager.listNamespaces();
  }

  /**
   * Check if a namespace exists
   */
  async namespaceExists(name: string): Promise<boolean> {
    await this.ensureInitialized();
    return this.namespaceManager.namespaceExists(name);
  }

  /**
   * Find namespaces by pattern
   */
  async findNamespaces(pattern: string | RegExp): Promise<NamespaceInfo[]> {
    await this.ensureInitialized();
    return this.namespaceManager.findNamespaces(pattern);
  }

  // === Direct Vector Operations (on default namespace) ===

  /**
   * Add a vector to the default namespace
   */
  async addVector(
    id: string,
    vector: VectorFormat,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    await this.ensureInitialized();
    const ns = await this.getDefaultNamespace();
    return ns.addVector(id, vector, metadata);
  }

  /**
   * Add multiple vectors to the default namespace
   */
  async addBatch(
    vectors: Array<{
      id: string;
      vector: VectorFormat;
      metadata?: Record<string, unknown>;
    }>,
    options?: BatchOptions
  ): Promise<void> {
    await this.ensureInitialized();
    const ns = await this.getDefaultNamespace();
    return ns.addBatch(vectors, options);
  }

  /**
   * Get a vector from the default namespace
   */
  async getVector(id: string): Promise<VectorData | null> {
    await this.ensureInitialized();
    const ns = await this.getDefaultNamespace();
    return ns.getVector(id);
  }

  /**
   * Delete a vector from the default namespace
   */
  async deleteVector(id: string): Promise<void> {
    await this.ensureInitialized();
    const ns = await this.getDefaultNamespace();
    return ns.deleteVector(id);
  }

  /**
   * Search in the default namespace
   */
  async search(
    queryVector: VectorFormat,
    k: number = 10,
    options?: SearchOptions
  ): Promise<SearchResult[]> {
    await this.ensureInitialized();
    const ns = await this.getDefaultNamespace();
    return ns.search(queryVector, k, options);
  }

  /**
   * Get statistics for the default namespace
   */
  async getStats(): Promise<{
    vectorCount: number;
    dimension: number;
    distanceMetric: string;
    description?: string;
  }> {
    await this.ensureInitialized();
    const ns = await this.getDefaultNamespace();
    return ns.getStats();
  }

  /**
   * Clear all vectors in the default namespace
   */
  async clear(): Promise<void> {
    await this.ensureInitialized();
    const ns = await this.getDefaultNamespace();
    return ns.clear();
  }

  // === Global Operations ===

  /**
   * Get total storage usage across all namespaces
   */
  async getTotalStorageUsage(): Promise<number> {
    await this.ensureInitialized();
    return this.namespaceManager.getTotalStorageUsage();
  }

  /**
   * Close all connections
   */
  async close(): Promise<void> {
    await this.namespaceManager.closeAll();
    this.initialized = false;
  }

  /**
   * Delete all data (dangerous!)
   */
  async deleteAll(): Promise<void> {
    await this.namespaceManager.deleteAll();
    this.initialized = false;
  }

  // === Backwards Compatibility ===

  /**
   * Create a simple vector database (without namespace management)
   * This provides backwards compatibility with the original VectorDB API
   */
  static createSimple(name: string, dimension: number): VectorDB {
    return new VectorDB(name, dimension);
  }

  // === Private Methods ===

  /**
   * Ensure the database is initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.init();
    }
  }

  /**
   * Get or create the default namespace
   */
  private async getDefaultNamespace(): Promise<VectorNamespace> {
    if (this.defaultNamespace) {
      return this.defaultNamespace;
    }

    if (!this.defaultDimension) {
      throw new Error(
        'No default dimension specified. Either provide a dimension in the constructor ' +
        'or use namespace operations directly.'
      );
    }

    // Create default namespace on demand
    const exists = await this.namespaceManager.namespaceExists('default');
    
    if (!exists) {
      this.defaultNamespace = await this.namespaceManager.createNamespace('default', {
        dimension: this.defaultDimension,
        distanceMetric: 'cosine',
        description: 'Default namespace'
      });
    } else {
      this.defaultNamespace = await this.namespaceManager.getNamespace('default');
    }

    return this.defaultNamespace;
  }

  /**
   * Set cache limit for namespace manager
   */
  async setCacheLimit(limit: number): Promise<void> {
    await this.ensureInitialized();
    return this.namespaceManager.setCacheLimit(limit);
  }

  /**
   * Get current cache size
   */
  getCacheSize(): number {
    return this.namespaceManager.getCacheSize();
  }

  /**
   * Evict a namespace from cache
   */
  evictFromCache(name: string): void {
    this.namespaceManager.evictFromCache(name);
  }
}