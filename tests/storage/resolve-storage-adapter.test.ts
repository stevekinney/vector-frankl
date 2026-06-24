import { describe, expect, it } from 'bun:test';
import { BrowserSupportError } from '@/core/errors.js';
import { IndexedDatabaseStorageAdapter } from '@/storage/adapters/indexed-database-adapter.js';
import { MemoryStorageAdapter } from '@/storage/adapters/memory-adapter.js';
import {
  isIndexedDBAvailable,
  resolveStorageAdapter,
} from '@/storage/resolve-storage-adapter.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Save and restore the global indexedDB for controlled test isolation. */
function withIndexedDB<T>(value: unknown, fn: () => T): T {
  const hadProp = 'indexedDB' in globalThis;
  const original = (globalThis as Record<string, unknown>)['indexedDB'];
  (globalThis as Record<string, unknown>)['indexedDB'] = value;
  try {
    return fn();
  } finally {
    if (hadProp) {
      (globalThis as Record<string, unknown>)['indexedDB'] = original;
    } else {
      delete (globalThis as Record<string, unknown>)['indexedDB'];
    }
  }
}

// ---------------------------------------------------------------------------
// isIndexedDBAvailable
// ---------------------------------------------------------------------------

describe('isIndexedDBAvailable', () => {
  it('returns true when indexedDB is a non-null object', () => {
    const result = withIndexedDB({}, () => isIndexedDBAvailable());
    expect(result).toBe(true);
  });

  it('returns false when indexedDB is undefined', () => {
    const result = withIndexedDB(undefined, () => isIndexedDBAvailable());
    expect(result).toBe(false);
  });

  it('returns false when indexedDB is null', () => {
    const result = withIndexedDB(null, () => isIndexedDBAvailable());
    expect(result).toBe(false);
  });

  it('returns a boolean', () => {
    const result = isIndexedDBAvailable();
    expect(typeof result).toBe('boolean');
  });
});

// ---------------------------------------------------------------------------
// resolveStorageAdapter — explicit memory backend
// ---------------------------------------------------------------------------

describe('resolveStorageAdapter with backend: memory', () => {
  it('returns a MemoryStorageAdapter', () => {
    const adapter = resolveStorageAdapter({ name: 'test-db', backend: 'memory' });
    expect(adapter).toBeInstanceOf(MemoryStorageAdapter);
  });

  it('does not throw even when IndexedDB is unavailable', () => {
    withIndexedDB(undefined, () => {
      expect(() =>
        resolveStorageAdapter({ name: 'test-db', backend: 'memory' }),
      ).not.toThrow();
    });
  });

  it('ignores the name and version options for memory backend', () => {
    const adapter = resolveStorageAdapter({
      name: 'irrelevant',
      version: 42,
      backend: 'memory',
    });
    expect(adapter).toBeInstanceOf(MemoryStorageAdapter);
  });
});

// ---------------------------------------------------------------------------
// resolveStorageAdapter — IndexedDB backend when unavailable
// ---------------------------------------------------------------------------

describe('resolveStorageAdapter with backend: indexeddb (unavailable)', () => {
  it('throws BrowserSupportError when IndexedDB is absent', () => {
    withIndexedDB(undefined, () => {
      expect(() =>
        resolveStorageAdapter({ name: 'test-db', backend: 'indexeddb' }),
      ).toThrow(BrowserSupportError);
    });
  });

  it('throws BrowserSupportError with default backend when IndexedDB is absent', () => {
    // The default backend is indexeddb.  Without IndexedDB it must throw, not
    // silently fall back to an in-memory adapter.
    withIndexedDB(undefined, () => {
      expect(() => resolveStorageAdapter({ name: 'test-db' })).toThrow(
        BrowserSupportError,
      );
    });
  });

  it('includes IndexedDB in the error message', () => {
    withIndexedDB(undefined, () => {
      let error: unknown;
      try {
        resolveStorageAdapter({ name: 'test-db' });
      } catch (thrown) {
        error = thrown;
      }
      expect(error).toBeInstanceOf(BrowserSupportError);
      expect((error as BrowserSupportError).message).toContain('IndexedDB');
    });
  });

  it('error has feature property set to IndexedDB', () => {
    withIndexedDB(undefined, () => {
      let error: unknown;
      try {
        resolveStorageAdapter({ name: 'test-db' });
      } catch (thrown) {
        error = thrown;
      }
      expect(error).toBeInstanceOf(BrowserSupportError);
      expect((error as BrowserSupportError).feature).toBe('IndexedDB');
    });
  });

  it('does NOT return a MemoryStorageAdapter as silent fallback', () => {
    withIndexedDB(undefined, () => {
      let result: unknown;
      try {
        result = resolveStorageAdapter({ name: 'test-db' });
      } catch {
        // expected path
      }
      // result should remain undefined (the call threw)
      expect(result).toBeUndefined();
    });
  });
});

// ---------------------------------------------------------------------------
// resolveStorageAdapter — IndexedDB backend when available
// ---------------------------------------------------------------------------

describe('resolveStorageAdapter with backend: indexeddb (available)', () => {
  it('returns an IndexedDatabaseStorageAdapter when IndexedDB is available', () => {
    withIndexedDB({} as IDBFactory, () => {
      const adapter = resolveStorageAdapter({ name: 'my-db', backend: 'indexeddb' });
      expect(adapter).toBeInstanceOf(IndexedDatabaseStorageAdapter);
    });
  });

  it('returns an IndexedDatabaseStorageAdapter with default backend', () => {
    withIndexedDB({} as IDBFactory, () => {
      const adapter = resolveStorageAdapter({ name: 'my-db' });
      expect(adapter).toBeInstanceOf(IndexedDatabaseStorageAdapter);
    });
  });

  it('accepts an optional version number', () => {
    withIndexedDB({} as IDBFactory, () => {
      const adapter = resolveStorageAdapter({
        name: 'versioned-db',
        version: 3,
        backend: 'indexeddb',
      });
      expect(adapter).toBeInstanceOf(IndexedDatabaseStorageAdapter);
    });
  });
});

// ---------------------------------------------------------------------------
// No silent memory fallback — the core contract
// ---------------------------------------------------------------------------

describe('no silent memory fallback', () => {
  it('explicit memory backend always yields MemoryStorageAdapter regardless of IndexedDB', () => {
    // This test captures the positive case: memory is available on demand.
    const adapter = resolveStorageAdapter({ name: 'any', backend: 'memory' });
    expect(adapter).toBeInstanceOf(MemoryStorageAdapter);
  });

  it('default backend throws rather than silently returning memory when IndexedDB absent', () => {
    // This test captures the contract: no silent fallback.
    withIndexedDB(undefined, () => {
      expect(() => resolveStorageAdapter({ name: 'any' })).toThrow(BrowserSupportError);
    });
  });
});
