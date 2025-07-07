import { NamespaceNotFoundError } from '@/core/errors.js';
import type { NamespaceConfig, NamespaceInfo, NamespaceStats } from '@/core/types.js';
import { VectorNamespace } from './namespace.js';
import { NamespaceRegistry } from './registry.js';

/**
 * Manager for handling multiple vector namespaces
 */
export class NamespaceManager {
  private registry: NamespaceRegistry;
  private namespaces: Map<string, VectorNamespace>;
  private initialized = false;

  constructor(private rootDatabaseName = 'vector-frankl-root') {
    this.registry = new NamespaceRegistry(rootDatabaseName);
    this.namespaces = new Map();
  }

  /**
   * Initialize the namespace manager
   */
  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }

    await this.registry.init();
    this.initialized = true;
  }

  /**
   * Create a new namespace
   */
  async createNamespace(name: string, config: NamespaceConfig): Promise<VectorNamespace> {
    await this.ensureInitialized();

    // Register the namespace first
    await this.registry.register(name, config);

    try {
      // Create the namespace instance
      const namespace = new VectorNamespace(name, config, this.rootDatabaseName);
      await namespace.init();

      // Cache the namespace
      this.namespaces.set(name, namespace);

      return namespace;
    } catch (error) {
      // Rollback registration on failure
      await this.registry.unregister(name);
      throw error;
    }
  }

  /**
   * Get an existing namespace
   */
  async getNamespace(name: string): Promise<VectorNamespace> {
    await this.ensureInitialized();

    // Check cache first
    if (this.namespaces.has(name)) {
      return this.namespaces.get(name)!;
    }

    // Load from registry
    const info = await this.registry.get(name);
    if (!info) {
      throw new NamespaceNotFoundError(name);
    }

    // Create and cache namespace instance
    const namespace = new VectorNamespace(name, info.config, this.rootDatabaseName);
    await namespace.init();

    this.namespaces.set(name, namespace);

    // Update last accessed time
    await this.registry.updateStats(name, {
      lastAccessed: Date.now(),
    });

    return namespace;
  }

  /**
   * Delete a namespace
   */
  async deleteNamespace(name: string): Promise<void> {
    await this.ensureInitialized();

    // Check if namespace exists
    const info = await this.registry.get(name);
    if (!info) {
      throw new NamespaceNotFoundError(name);
    }

    // Close and remove from cache if loaded
    if (this.namespaces.has(name)) {
      const namespace = this.namespaces.get(name)!;
      await namespace.close();
      this.namespaces.delete(name);
    }

    // Delete the namespace database
    const namespaceDatabaseName = this.getNamespaceDatabaseName(name);
    const databaseToDelete = indexedDB.deleteDatabase(namespaceDatabaseName);

    await new Promise<void>((resolve, reject) => {
      databaseToDelete.onsuccess = () => resolve();
      databaseToDelete.onerror = () => reject(databaseToDelete.error);
      databaseToDelete.onblocked = () => {
        console.warn(`Delete blocked for namespace database: ${namespaceDatabaseName}`);
      };
    });

    // Remove from registry
    await this.registry.unregister(name);
  }

  /**
   * List all namespaces
   */
  async listNamespaces(): Promise<NamespaceInfo[]> {
    await this.ensureInitialized();
    return this.registry.list();
  }

  /**
   * Check if a namespace exists
   */
  async namespaceExists(name: string): Promise<boolean> {
    await this.ensureInitialized();
    return this.registry.exists(name);
  }

  /**
   * Find namespaces by pattern
   */
  async findNamespaces(pattern: string | RegExp): Promise<NamespaceInfo[]> {
    await this.ensureInitialized();
    return this.registry.findByPattern(pattern);
  }

  /**
   * Get namespace information
   */
  async getNamespaceInfo(name: string): Promise<NamespaceInfo | null> {
    await this.ensureInitialized();
    return this.registry.get(name);
  }

  /**
   * Update namespace statistics
   */
  async updateNamespaceStats(
    name: string,
    stats: Partial<NamespaceStats>,
  ): Promise<void> {
    await this.ensureInitialized();
    await this.registry.updateStats(name, stats);
  }

  /**
   * Get total storage usage across all namespaces
   */
  async getTotalStorageUsage(): Promise<number> {
    await this.ensureInitialized();
    return this.registry.getTotalStorageUsage();
  }

  /**
   * Close all open namespaces
   */
  async closeAll(): Promise<void> {
    // Close all cached namespaces
    const closePromises = Array.from(this.namespaces.values()).map((namespace) =>
      namespace.close(),
    );
    await Promise.all(closePromises);

    this.namespaces.clear();

    // Close the registry
    await this.registry.close();
    this.initialized = false;
  }

  /**
   * Delete all namespaces and the registry
   */
  async deleteAll(): Promise<void> {
    await this.ensureInitialized();

    // Get all namespaces
    const allNamespaces = await this.listNamespaces();

    // Delete each namespace
    for (const nsInfo of allNamespaces) {
      await this.deleteNamespace(nsInfo.name);
    }

    // Delete the registry
    await this.registry.delete();
    this.initialized = false;
  }

  /**
   * Get the database name for a namespace
   */
  private getNamespaceDatabaseName(namespaceName: string): string {
    return `${this.rootDatabaseName}-ns-${namespaceName}`;
  }

  /**
   * Ensure the manager is initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.init();
    }
  }

  /**
   * Evict namespace from cache
   */
  evictFromCache(name: string): void {
    if (this.namespaces.has(name)) {
      const namespace = this.namespaces.get(name)!;
      // Don't await - just trigger close
      namespace.close().catch((error) => {
        console.error(`Error closing evicted namespace ${name}:`, error);
      });
      this.namespaces.delete(name);
    }
  }

  /**
   * Get cache size
   */
  getCacheSize(): number {
    return this.namespaces.size;
  }

  /**
   * Set cache limit (evict least recently used)
   */
  async setCacheLimit(limit: number): Promise<void> {
    if (this.namespaces.size <= limit) {
      return;
    }

    // Get all namespace info with last accessed times
    const namespaceInfos = await this.listNamespaces();

    // Sort by last accessed (oldest first)
    namespaceInfos.sort((a, b) => {
      const aTime = a.stats.lastAccessed || a.created;
      const bTime = b.stats.lastAccessed || b.created;
      return aTime - bTime;
    });

    // Evict oldest namespaces until we're under the limit
    let evictCount = this.namespaces.size - limit;
    for (const info of namespaceInfos) {
      if (evictCount <= 0) break;
      if (this.namespaces.has(info.name)) {
        this.evictFromCache(info.name);
        evictCount--;
      }
    }
  }
}
