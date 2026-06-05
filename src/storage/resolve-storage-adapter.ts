import type { StorageAdapter } from '../core/types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StorageAdapterPreference =
  | 'sqlite'
  | 'opfs'
  | 'chromeStorage'
  | 'indexedDatabase'
  | 'memory';

export interface StorageResolutionOptions {
  sqlite?: { filename: string };
  opfs?: { directory: string; format?: 'binary' | 'json' };
  chromeStorage?: { prefix: string; area?: 'local' | 'session' };
  indexedDatabase?: { name: string; version?: number };
  memory?: { cloneOnRead?: boolean; cloneOnWrite?: boolean };
  /** Override the default preference order. */
  preference?: StorageAdapterPreference[];
}

export interface ResolvedStorageAdapter {
  adapter: StorageAdapter;
  name: StorageAdapterPreference;
}

// ---------------------------------------------------------------------------
// Default preference order
// ---------------------------------------------------------------------------

const DEFAULT_PREFERENCE: StorageAdapterPreference[] = [
  'sqlite',
  'opfs',
  'chromeStorage',
  'indexedDatabase',
  'memory',
];

// ---------------------------------------------------------------------------
// Capability probes
//
// These mirror the static `isAvailable()` methods on each adapter class but
// avoid importing the adapter modules, which may reference Node-only APIs
// (e.g. `node:fs/promises` in SQLiteStorageAdapter) and would break in
// browser environments.
// ---------------------------------------------------------------------------

const isAvailable: Record<StorageAdapterPreference, () => boolean> = {
  sqlite: () => typeof globalThis.Bun !== 'undefined',
  opfs: () =>
    typeof globalThis.navigator !== 'undefined' &&
    typeof navigator.storage?.getDirectory === 'function',
  chromeStorage: () => {
    const g = globalThis as Record<string, unknown>;
    const chrome = g['chrome'];
    return (
      typeof chrome === 'object' &&
      chrome !== null &&
      typeof (chrome as Record<string, unknown>)['storage'] !== 'undefined'
    );
  },
  indexedDatabase: () => typeof globalThis.indexedDB !== 'undefined',
  memory: () => true,
};

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

/**
 * Walk a preference-ordered list of storage adapters and return the first one
 * whose required runtime APIs are available and whose options have been
 * provided. Falls back to {@link MemoryStorageAdapter} when nothing else
 * matches.
 *
 * This function is async because each adapter module is loaded via dynamic
 * `import()` to avoid pulling Node-specific (or browser-specific) top-level
 * imports into environments that cannot satisfy them.
 *
 * The returned adapter has **not** been initialized — callers must still call
 * `adapter.init()` before use.
 */
export async function resolveStorageAdapter(
  options: StorageResolutionOptions = {},
): Promise<ResolvedStorageAdapter> {
  const preference = options.preference ?? DEFAULT_PREFERENCE;

  for (const name of preference) {
    if (!isAvailable[name]()) continue;

    switch (name) {
      case 'sqlite': {
        if (options.sqlite === undefined) continue;
        const { SQLiteStorageAdapter } = await import('./adapters/sqlite-adapter.js');
        return { adapter: new SQLiteStorageAdapter(options.sqlite), name };
      }
      case 'opfs': {
        if (options.opfs === undefined) continue;
        const { OPFSStorageAdapter } = await import('./adapters/opfs-adapter.js');
        return { adapter: new OPFSStorageAdapter(options.opfs), name };
      }
      case 'chromeStorage': {
        if (options.chromeStorage === undefined) continue;
        const { ChromeStorageAdapter } = await import(
          './adapters/chrome-storage-adapter.js'
        );
        return { adapter: new ChromeStorageAdapter(options.chromeStorage), name };
      }
      case 'indexedDatabase': {
        if (options.indexedDatabase === undefined) continue;
        const { IndexedDatabaseStorageAdapter } = await import(
          './adapters/indexed-database-adapter.js'
        );
        return {
          adapter: new IndexedDatabaseStorageAdapter(options.indexedDatabase),
          name,
        };
      }
      case 'memory': {
        const { MemoryStorageAdapter } = await import('./adapters/memory-adapter.js');
        return { adapter: new MemoryStorageAdapter(options.memory), name };
      }
    }
  }

  // Unreachable when preference includes 'memory' (the default), but a
  // consumer could pass a custom list that excludes it.
  const { MemoryStorageAdapter } = await import('./adapters/memory-adapter.js');
  return { adapter: new MemoryStorageAdapter(options.memory), name: 'memory' };
}
