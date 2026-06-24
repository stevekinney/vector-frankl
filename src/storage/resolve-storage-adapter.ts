import { BrowserSupportError } from '@/core/errors.js';
import type { StorageAdapter } from '@/core/types.js';
import { IndexedDatabaseStorageAdapter } from './adapters/indexed-database-adapter.js';
import { MemoryStorageAdapter } from './adapters/memory-adapter.js';

/**
 * Storage backend options for resolveStorageAdapter.
 *
 * - `'indexeddb'` — use IndexedDB (the durable browser default). Throws a
 *   BrowserSupportError when IndexedDB is unavailable.
 * - `'memory'` — use the in-memory adapter. Never durable; only appropriate
 *   for tests or ephemeral sessions where the caller explicitly opts out of
 *   persistence.
 */
export type StorageBackend = 'indexeddb' | 'memory';

/**
 * Options for resolveStorageAdapter.
 */
export interface ResolveStorageAdapterOptions {
  /**
   * Name used to identify the IndexedDB database.
   * Required when backend is (or defaults to) 'indexeddb'.
   */
  name: string;

  /**
   * Explicit backend selection. Defaults to 'indexeddb'.
   *
   * Pass `'memory'` only when persistence is intentionally unwanted (e.g. unit
   * tests). The adapter will not silently fall back to memory when IndexedDB is
   * unavailable — callers that need a durable store must handle the error.
   */
  backend?: StorageBackend;

  /**
   * IndexedDB schema version. Forwarded to IndexedDatabaseStorageAdapter when
   * the IndexedDB backend is used. Defaults to 1.
   */
  version?: number;
}

/**
 * Resolve the appropriate StorageAdapter for a browser context.
 *
 * In supported browsers the default backend is IndexedDB, which provides
 * durable, origin-scoped storage that survives page reloads. When IndexedDB
 * is not available (e.g. private-browsing restrictions on some browsers,
 * non-browser environments without a polyfill) the function throws a
 * BrowserSupportError rather than silently returning a MemoryStorageAdapter.
 * Silent memory fallback violates the principle of least surprise: callers
 * who expect their data to persist across reloads would lose it without any
 * warning.
 *
 * The only way to obtain a MemoryStorageAdapter through this function is to
 * explicitly pass `backend: 'memory'`, making the choice visible at the call
 * site.
 *
 * @example
 * // Durable default — throws if IndexedDB is unavailable
 * const adapter = resolveStorageAdapter({ name: 'my-vectors' });
 *
 * @example
 * // Explicit in-memory adapter for tests
 * const adapter = resolveStorageAdapter({ name: 'test', backend: 'memory' });
 *
 * @throws {BrowserSupportError} When the requested backend (or the default
 *   'indexeddb' backend) is unavailable in the current environment.
 */
export function resolveStorageAdapter(
  options: ResolveStorageAdapterOptions,
): StorageAdapter {
  const backend: StorageBackend = options.backend ?? 'indexeddb';

  if (backend === 'memory') {
    return new MemoryStorageAdapter();
  }

  // backend === 'indexeddb'
  if (!isIndexedDBAvailable()) {
    throw new BrowserSupportError('IndexedDB');
  }

  const adapterOptions =
    options.version !== undefined
      ? { name: options.name, version: options.version }
      : { name: options.name };

  return new IndexedDatabaseStorageAdapter(adapterOptions);
}

/**
 * Returns true when IndexedDB is accessible in the current environment.
 *
 * A simple existence check is sufficient here. The VectorDatabase constructor
 * (and IndexedDatabaseStorageAdapter.init()) will surface any deeper failure
 * (e.g. quota restrictions, security policy) when the adapter is initialized.
 */
export function isIndexedDBAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}
