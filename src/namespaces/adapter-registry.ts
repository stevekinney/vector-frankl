import {
  NamespaceExistsError,
  NamespaceNotFoundError,
  VectorNotFoundError,
} from '@/core/errors.js';
import { validateNamespaceName } from './validate-namespace-name.js';
import type {
  NamespaceConfig,
  NamespaceInfo,
  NamespaceStats,
  StorageAdapter,
} from '@/core/types.js';

/**
 * Namespace registry backed by a StorageAdapter.
 *
 * Stores namespace metadata as VectorData entries where:
 * - `id` is the namespace name
 * - `metadata` contains the serialized NamespaceInfo
 * - `vector` is a placeholder (required by the StorageAdapter contract)
 *
 * This allows NamespaceManager to work in non-browser environments where
 * IndexedDB is unavailable (e.g. Node/Bun with SQLite, LevelDB, Redis, etc.).
 */
export class AdapterNamespaceRegistry {
  private adapter: StorageAdapter;
  private initialized = false;

  constructor(adapter: StorageAdapter) {
    this.adapter = adapter;
  }

  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }

    await this.adapter.init();
    this.initialized = true;
  }

  async register(name: string, config: NamespaceConfig): Promise<NamespaceInfo> {
    await this.ensureInitialized();
    validateNamespaceName(name);

    if (await this.adapter.exists(name)) {
      throw new NamespaceExistsError(name);
    }

    const now = Date.now();
    const info: NamespaceInfo = {
      name,
      config,
      stats: { vectorCount: 0, storageSize: 0 },
      created: now,
      modified: now,
    };

    await this.adapter.put({
      id: name,
      vector: new Float32Array([0]),
      magnitude: 0,
      normalized: false,
      timestamp: now,
      metadata: this.serializeInfo(info),
    });

    return info;
  }

  async get(name: string): Promise<NamespaceInfo | null> {
    await this.ensureInitialized();

    try {
      const entry = await this.adapter.get(name);
      return this.deserializeInfo(entry.metadata as Record<string, unknown>);
    } catch (error) {
      if (error instanceof VectorNotFoundError) {
        return null;
      }
      throw error;
    }
  }

  async list(): Promise<NamespaceInfo[]> {
    await this.ensureInitialized();

    const all = await this.adapter.getAll();
    return all.map((entry) =>
      this.deserializeInfo(entry.metadata as Record<string, unknown>),
    );
  }

  async updateStats(name: string, stats: Partial<NamespaceStats>): Promise<void> {
    await this.ensureInitialized();

    const info = await this.get(name);
    if (!info) {
      throw new NamespaceNotFoundError(name);
    }

    info.stats = { ...info.stats, ...stats };
    info.modified = Date.now();

    await this.adapter.put({
      id: name,
      vector: new Float32Array([0]),
      magnitude: 0,
      normalized: false,
      timestamp: info.modified,
      metadata: this.serializeInfo(info),
    });
  }

  async unregister(name: string): Promise<void> {
    await this.ensureInitialized();

    if (!(await this.adapter.exists(name))) {
      throw new NamespaceNotFoundError(name);
    }

    await this.adapter.delete(name);
  }

  async exists(name: string): Promise<boolean> {
    await this.ensureInitialized();

    try {
      return await this.adapter.exists(name);
    } catch {
      return false;
    }
  }

  async findByPattern(pattern: string | RegExp): Promise<NamespaceInfo[]> {
    await this.ensureInitialized();

    const all = await this.list();
    const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
    return all.filter((info) => regex.test(info.name));
  }

  async getTotalStorageUsage(): Promise<number> {
    await this.ensureInitialized();

    const all = await this.list();
    return all.reduce((total, info) => total + info.stats.storageSize, 0);
  }

  async close(): Promise<void> {
    await this.adapter.close();
    this.initialized = false;
  }

  async delete(): Promise<void> {
    await this.adapter.destroy();
    this.initialized = false;
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.init();
    }
  }

  private serializeInfo(info: NamespaceInfo): Record<string, unknown> {
    return {
      name: info.name,
      config: info.config,
      stats: info.stats,
      created: info.created,
      modified: info.modified,
    };
  }

  private deserializeInfo(metadata: Record<string, unknown>): NamespaceInfo {
    return {
      name: metadata['name'] as string,
      config: metadata['config'] as NamespaceConfig,
      stats: metadata['stats'] as NamespaceStats,
      created: metadata['created'] as number,
      modified: metadata['modified'] as number,
    };
  }
}
