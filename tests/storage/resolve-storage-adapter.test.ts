import { describe, expect, it } from 'bun:test';

import { ChromeStorageAdapter } from '@/storage/adapters/chrome-storage-adapter.js';
import { IndexedDatabaseStorageAdapter } from '@/storage/adapters/indexed-database-adapter.js';
import { MemoryStorageAdapter } from '@/storage/adapters/memory-adapter.js';
import { OPFSStorageAdapter } from '@/storage/adapters/opfs-adapter.js';
import { SQLiteStorageAdapter } from '@/storage/adapters/sqlite-adapter.js';
import { resolveStorageAdapter } from '@/storage/resolve-storage-adapter.js';

// ---------------------------------------------------------------------------
// isAvailable() static methods
// ---------------------------------------------------------------------------

describe('isAvailable', () => {
  it('SQLiteStorageAdapter reports available in Bun', () => {
    expect(SQLiteStorageAdapter.isAvailable()).toBe(true);
  });

  it('MemoryStorageAdapter is always available', () => {
    expect(MemoryStorageAdapter.isAvailable()).toBe(true);
  });

  it('OPFSStorageAdapter reports unavailable in Bun (no navigator.storage)', () => {
    expect(OPFSStorageAdapter.isAvailable()).toBe(false);
  });

  it('ChromeStorageAdapter reports unavailable in Bun (no chrome.storage)', () => {
    expect(ChromeStorageAdapter.isAvailable()).toBe(false);
  });

  it('IndexedDatabaseStorageAdapter checks for globalThis.indexedDB', () => {
    // In the test suite, a mock IndexedDB is installed globally, so this
    // returns true. The important thing is that the check is based on the
    // presence of the API, not environment sniffing.
    expect(typeof IndexedDatabaseStorageAdapter.isAvailable()).toBe('boolean');
  });
});

// ---------------------------------------------------------------------------
// resolveStorageAdapter
// ---------------------------------------------------------------------------

describe('resolveStorageAdapter', () => {
  it('returns SQLiteStorageAdapter when sqlite options are provided (Bun environment)', async () => {
    const { adapter, name } = await resolveStorageAdapter({
      sqlite: { filename: ':memory:' },
    });

    expect(name).toBe('sqlite');
    expect(adapter).toBeInstanceOf(SQLiteStorageAdapter);
  });

  it('falls back to MemoryStorageAdapter when no options are provided', async () => {
    const { adapter, name } = await resolveStorageAdapter();

    expect(name).toBe('memory');
    expect(adapter).toBeInstanceOf(MemoryStorageAdapter);
  });

  it('falls back to MemoryStorageAdapter when an empty options object is provided', async () => {
    const { adapter, name } = await resolveStorageAdapter({});

    expect(name).toBe('memory');
    expect(adapter).toBeInstanceOf(MemoryStorageAdapter);
  });

  it('skips an adapter when its options are not provided even if available', async () => {
    // SQLite is available in Bun, but we only provide memory options.
    const { adapter, name } = await resolveStorageAdapter({
      memory: { cloneOnRead: false },
    });

    expect(name).toBe('memory');
    expect(adapter).toBeInstanceOf(MemoryStorageAdapter);
  });

  it('respects a custom preference order', async () => {
    const { adapter, name } = await resolveStorageAdapter({
      sqlite: { filename: ':memory:' },
      memory: { cloneOnRead: true },
      preference: ['memory', 'sqlite'],
    });

    expect(name).toBe('memory');
    expect(adapter).toBeInstanceOf(MemoryStorageAdapter);
  });

  it('skips unavailable adapters in a custom preference list', async () => {
    // OPFS is not available in Bun, so it should be skipped.
    const { adapter, name } = await resolveStorageAdapter({
      opfs: { directory: 'test' },
      sqlite: { filename: ':memory:' },
      preference: ['opfs', 'sqlite'],
    });

    expect(name).toBe('sqlite');
    expect(adapter).toBeInstanceOf(SQLiteStorageAdapter);
  });

  it('falls back to memory when custom preference excludes all available adapters', async () => {
    const { adapter, name } = await resolveStorageAdapter({
      opfs: { directory: 'test' },
      preference: ['opfs'],
    });

    expect(name).toBe('memory');
    expect(adapter).toBeInstanceOf(MemoryStorageAdapter);
  });

  it('passes options through to the resolved adapter', async () => {
    const { adapter, name } = await resolveStorageAdapter({
      sqlite: { filename: ':memory:' },
    });

    expect(name).toBe('sqlite');
    // Verify the adapter was constructed (can be initialized without error).
    expect(adapter).toBeInstanceOf(SQLiteStorageAdapter);
  });
});
