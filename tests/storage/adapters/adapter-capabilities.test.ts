import { describe, expect, it } from 'bun:test';
import {
  ADAPTER_SUPPORT_MATRIX,
  type AdapterCapabilities,
  type AdapterName,
  type AdapterRuntime,
  type AdapterSupportTier,
  CHROME_STORAGE_ADAPTER_CAPABILITIES,
  FILE_SYSTEM_ADAPTER_CAPABILITIES,
  INDEXED_DATABASE_ADAPTER_CAPABILITIES,
  LEVEL_ADAPTER_CAPABILITIES,
  LMDB_ADAPTER_CAPABILITIES,
  MEMORY_ADAPTER_CAPABILITIES,
  OPFS_ADAPTER_CAPABILITIES,
  REDIS_ADAPTER_CAPABILITIES,
  S3_ADAPTER_CAPABILITIES,
  SQLITE_ADAPTER_CAPABILITIES,
  getAdaptersByRuntime,
  getAdaptersByTier,
} from '@/storage/adapters/adapter-capabilities.js';
import { ChromeStorageAdapter } from '@/storage/adapters/chrome-storage-adapter.js';
import { FileSystemStorageAdapter } from '@/storage/adapters/file-system-adapter.js';
import { IndexedDatabaseStorageAdapter } from '@/storage/adapters/indexed-database-adapter.js';
import { LevelStorageAdapter } from '@/storage/adapters/level-adapter.js';
import { LmdbStorageAdapter } from '@/storage/adapters/lmdb-adapter.js';
import { MemoryStorageAdapter } from '@/storage/adapters/memory-adapter.js';
import { OPFSStorageAdapter } from '@/storage/adapters/opfs-adapter.js';
import { RedisStorageAdapter } from '@/storage/adapters/redis-adapter.js';
import { S3StorageAdapter } from '@/storage/adapters/s3-adapter.js';
import { SQLiteStorageAdapter } from '@/storage/adapters/sqlite-adapter.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Assert that an object fully satisfies the AdapterCapabilities shape. */
function assertCapabilitiesShape(caps: unknown, label: string): void {
  expect(caps, `${label}: must be an object`).toBeTruthy();
  const c = caps as AdapterCapabilities;

  // tier
  const validTiers: AdapterSupportTier[] = [
    'production-supported',
    'experimental',
    'internal-only',
  ];
  expect(
    validTiers.includes(c.tier),
    `${label}: tier "${c.tier}" must be a valid AdapterSupportTier`,
  ).toBe(true);

  // runtimes — at least one entry, all valid
  const validRuntimes: AdapterRuntime[] = [
    'browser',
    'bun',
    'node',
    'any',
    'chrome-extension',
  ];
  expect(c.runtimes.length, `${label}: runtimes must not be empty`).toBeGreaterThan(0);
  for (const rt of c.runtimes) {
    expect(
      validRuntimes.includes(rt),
      `${label}: runtime "${rt}" must be a valid AdapterRuntime`,
    ).toBe(true);
  }

  // boolean fields
  const boolFields: Array<keyof AdapterCapabilities> = [
    'persistence',
    'transactions',
    'batchAtomicity',
    'metadataIndexing',
    'quotaReporting',
    'concurrentWriters',
  ];
  for (const field of boolFields) {
    expect(typeof c[field], `${label}: "${field}" must be boolean`).toBe('boolean');
  }
}

// ---------------------------------------------------------------------------
// capability shape tests
// ---------------------------------------------------------------------------

describe('capability — AdapterCapabilities shape', () => {
  const cases: Array<[string, AdapterCapabilities]> = [
    ['IndexedDatabase', INDEXED_DATABASE_ADAPTER_CAPABILITIES],
    ['Memory', MEMORY_ADAPTER_CAPABILITIES],
    ['OPFS', OPFS_ADAPTER_CAPABILITIES],
    ['ChromeStorage', CHROME_STORAGE_ADAPTER_CAPABILITIES],
    ['SQLite', SQLITE_ADAPTER_CAPABILITIES],
    ['FileSystem', FILE_SYSTEM_ADAPTER_CAPABILITIES],
    ['Level', LEVEL_ADAPTER_CAPABILITIES],
    ['Lmdb', LMDB_ADAPTER_CAPABILITIES],
    ['Redis', REDIS_ADAPTER_CAPABILITIES],
    ['S3', S3_ADAPTER_CAPABILITIES],
  ];

  for (const [label, caps] of cases) {
    it(`${label} capabilities have a valid shape`, () => {
      assertCapabilitiesShape(caps, label);
    });
  }
});

// ---------------------------------------------------------------------------
// capability — per-adapter tier assertions
// ---------------------------------------------------------------------------

describe('capability — support tier classification', () => {
  it('IndexedDatabaseStorageAdapter is production-supported', () => {
    expect(INDEXED_DATABASE_ADAPTER_CAPABILITIES.tier).toBe('production-supported');
  });

  it('SQLiteStorageAdapter is production-supported', () => {
    expect(SQLITE_ADAPTER_CAPABILITIES.tier).toBe('production-supported');
  });

  it('MemoryStorageAdapter is internal-only', () => {
    expect(MEMORY_ADAPTER_CAPABILITIES.tier).toBe('internal-only');
  });

  it('OPFSStorageAdapter is experimental', () => {
    expect(OPFS_ADAPTER_CAPABILITIES.tier).toBe('experimental');
  });

  it('ChromeStorageAdapter is experimental', () => {
    expect(CHROME_STORAGE_ADAPTER_CAPABILITIES.tier).toBe('experimental');
  });

  it('FileSystemStorageAdapter is experimental', () => {
    expect(FILE_SYSTEM_ADAPTER_CAPABILITIES.tier).toBe('experimental');
  });

  it('LevelStorageAdapter is experimental', () => {
    expect(LEVEL_ADAPTER_CAPABILITIES.tier).toBe('experimental');
  });

  it('LmdbStorageAdapter is experimental', () => {
    expect(LMDB_ADAPTER_CAPABILITIES.tier).toBe('experimental');
  });

  it('RedisStorageAdapter is experimental', () => {
    expect(REDIS_ADAPTER_CAPABILITIES.tier).toBe('experimental');
  });

  it('S3StorageAdapter is experimental', () => {
    expect(S3_ADAPTER_CAPABILITIES.tier).toBe('experimental');
  });
});

// ---------------------------------------------------------------------------
// capability — persistence guarantees
// ---------------------------------------------------------------------------

describe('capability — persistence', () => {
  it('MemoryStorageAdapter declares no persistence', () => {
    expect(MEMORY_ADAPTER_CAPABILITIES.persistence).toBe(false);
  });

  it('IndexedDatabaseStorageAdapter declares persistence', () => {
    expect(INDEXED_DATABASE_ADAPTER_CAPABILITIES.persistence).toBe(true);
  });

  it('SQLiteStorageAdapter declares persistence', () => {
    expect(SQLITE_ADAPTER_CAPABILITIES.persistence).toBe(true);
  });

  it('OPFSStorageAdapter declares persistence', () => {
    expect(OPFS_ADAPTER_CAPABILITIES.persistence).toBe(true);
  });

  it('FileSystemStorageAdapter declares persistence', () => {
    expect(FILE_SYSTEM_ADAPTER_CAPABILITIES.persistence).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// capability — transaction guarantees
// ---------------------------------------------------------------------------

describe('capability — transactions', () => {
  it('SQLiteStorageAdapter declares transaction support', () => {
    expect(SQLITE_ADAPTER_CAPABILITIES.transactions).toBe(true);
  });

  it('LmdbStorageAdapter declares transaction support', () => {
    expect(LMDB_ADAPTER_CAPABILITIES.transactions).toBe(true);
  });

  it('IndexedDatabaseStorageAdapter declares transaction support', () => {
    expect(INDEXED_DATABASE_ADAPTER_CAPABILITIES.transactions).toBe(true);
  });

  it('MemoryStorageAdapter declares no transactions', () => {
    expect(MEMORY_ADAPTER_CAPABILITIES.transactions).toBe(false);
  });

  it('FileSystemStorageAdapter declares no transactions', () => {
    expect(FILE_SYSTEM_ADAPTER_CAPABILITIES.transactions).toBe(false);
  });

  it('OPFSStorageAdapter declares no transactions', () => {
    expect(OPFS_ADAPTER_CAPABILITIES.transactions).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// capability — batch atomicity
// ---------------------------------------------------------------------------

describe('capability — batchAtomicity', () => {
  it('SQLiteStorageAdapter declares batch atomicity', () => {
    expect(SQLITE_ADAPTER_CAPABILITIES.batchAtomicity).toBe(true);
  });

  it('LmdbStorageAdapter declares batch atomicity', () => {
    expect(LMDB_ADAPTER_CAPABILITIES.batchAtomicity).toBe(true);
  });

  it('LevelStorageAdapter declares batch atomicity', () => {
    expect(LEVEL_ADAPTER_CAPABILITIES.batchAtomicity).toBe(true);
  });

  it('MemoryStorageAdapter declares no batch atomicity', () => {
    expect(MEMORY_ADAPTER_CAPABILITIES.batchAtomicity).toBe(false);
  });

  it('FileSystemStorageAdapter declares no batch atomicity', () => {
    expect(FILE_SYSTEM_ADAPTER_CAPABILITIES.batchAtomicity).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// capability — quota reporting
// ---------------------------------------------------------------------------

describe('capability — quotaReporting', () => {
  it('IndexedDatabaseStorageAdapter declares quota reporting', () => {
    expect(INDEXED_DATABASE_ADAPTER_CAPABILITIES.quotaReporting).toBe(true);
  });

  it('OPFSStorageAdapter declares quota reporting', () => {
    expect(OPFS_ADAPTER_CAPABILITIES.quotaReporting).toBe(true);
  });

  it('MemoryStorageAdapter declares no quota reporting', () => {
    expect(MEMORY_ADAPTER_CAPABILITIES.quotaReporting).toBe(false);
  });

  it('SQLiteStorageAdapter declares no quota reporting', () => {
    expect(SQLITE_ADAPTER_CAPABILITIES.quotaReporting).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// capability — runtime compatibility
// ---------------------------------------------------------------------------

describe('capability — runtime compatibility', () => {
  it('IndexedDatabaseStorageAdapter targets the browser', () => {
    expect(INDEXED_DATABASE_ADAPTER_CAPABILITIES.runtimes).toContain('browser');
  });

  it('MemoryStorageAdapter targets any runtime', () => {
    expect(MEMORY_ADAPTER_CAPABILITIES.runtimes).toContain('any');
  });

  it('SQLiteStorageAdapter targets bun', () => {
    expect(SQLITE_ADAPTER_CAPABILITIES.runtimes).toContain('bun');
  });

  it('FileSystemStorageAdapter targets bun and node', () => {
    expect(FILE_SYSTEM_ADAPTER_CAPABILITIES.runtimes).toContain('bun');
    expect(FILE_SYSTEM_ADAPTER_CAPABILITIES.runtimes).toContain('node');
  });

  it('ChromeStorageAdapter targets chrome-extension', () => {
    expect(CHROME_STORAGE_ADAPTER_CAPABILITIES.runtimes).toContain('chrome-extension');
  });

  it('S3StorageAdapter targets bun', () => {
    expect(S3_ADAPTER_CAPABILITIES.runtimes).toContain('bun');
  });

  it('RedisStorageAdapter targets bun', () => {
    expect(REDIS_ADAPTER_CAPABILITIES.runtimes).toContain('bun');
  });
});

// ---------------------------------------------------------------------------
// capability — ADAPTER_SUPPORT_MATRIX completeness
// ---------------------------------------------------------------------------

describe('capability — ADAPTER_SUPPORT_MATRIX', () => {
  const expectedAdapters: AdapterName[] = [
    'IndexedDatabaseStorageAdapter',
    'MemoryStorageAdapter',
    'OPFSStorageAdapter',
    'ChromeStorageAdapter',
    'SQLiteStorageAdapter',
    'FileSystemStorageAdapter',
    'LevelStorageAdapter',
    'LmdbStorageAdapter',
    'RedisStorageAdapter',
    'S3StorageAdapter',
  ];

  it('contains an entry for every known adapter', () => {
    for (const name of expectedAdapters) {
      expect(
        ADAPTER_SUPPORT_MATRIX[name],
        `ADAPTER_SUPPORT_MATRIX is missing entry for ${name}`,
      ).toBeDefined();
    }
  });

  it('has exactly ten entries', () => {
    expect(Object.keys(ADAPTER_SUPPORT_MATRIX).length).toBe(10);
  });

  it('every entry satisfies the AdapterCapabilities shape', () => {
    for (const [name, caps] of Object.entries(ADAPTER_SUPPORT_MATRIX)) {
      assertCapabilitiesShape(caps, name);
    }
  });
});

// ---------------------------------------------------------------------------
// capability — getAdaptersByTier
// ---------------------------------------------------------------------------

describe('capability — getAdaptersByTier', () => {
  it('returns IndexedDatabase and SQLite as production-supported', () => {
    const result = getAdaptersByTier('production-supported');
    expect(result).toContain('IndexedDatabaseStorageAdapter');
    expect(result).toContain('SQLiteStorageAdapter');
  });

  it('returns only internal-only adapters for that tier', () => {
    const result = getAdaptersByTier('internal-only');
    expect(result).toContain('MemoryStorageAdapter');
    expect(result).not.toContain('IndexedDatabaseStorageAdapter');
    expect(result).not.toContain('SQLiteStorageAdapter');
  });

  it('returns experimental adapters including OPFS and FileSystem', () => {
    const result = getAdaptersByTier('experimental');
    expect(result).toContain('OPFSStorageAdapter');
    expect(result).toContain('FileSystemStorageAdapter');
    expect(result).toContain('ChromeStorageAdapter');
    expect(result).toContain('LevelStorageAdapter');
    expect(result).toContain('LmdbStorageAdapter');
    expect(result).toContain('RedisStorageAdapter');
    expect(result).toContain('S3StorageAdapter');
  });

  it('every adapter appears in exactly one tier', () => {
    const production = new Set(getAdaptersByTier('production-supported'));
    const experimental = new Set(getAdaptersByTier('experimental'));
    const internal = new Set(getAdaptersByTier('internal-only'));

    const allAdapters = [...production, ...experimental, ...internal];
    const uniqueAdapters = new Set(allAdapters);
    expect(allAdapters.length).toBe(uniqueAdapters.size);
  });

  it('all ten adapters appear across tiers', () => {
    const all = [
      ...getAdaptersByTier('production-supported'),
      ...getAdaptersByTier('experimental'),
      ...getAdaptersByTier('internal-only'),
    ];
    expect(all.length).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// capability — getAdaptersByRuntime
// ---------------------------------------------------------------------------

describe('capability — getAdaptersByRuntime', () => {
  it('browser runtime includes IndexedDatabase and OPFS', () => {
    const result = getAdaptersByRuntime('browser');
    expect(result).toContain('IndexedDatabaseStorageAdapter');
    expect(result).toContain('OPFSStorageAdapter');
  });

  it('browser runtime includes MemoryStorageAdapter (via "any")', () => {
    const result = getAdaptersByRuntime('browser');
    expect(result).toContain('MemoryStorageAdapter');
  });

  it('bun runtime includes SQLite, FileSystem, Redis, S3, Level, Lmdb', () => {
    const result = getAdaptersByRuntime('bun');
    expect(result).toContain('SQLiteStorageAdapter');
    expect(result).toContain('FileSystemStorageAdapter');
    expect(result).toContain('RedisStorageAdapter');
    expect(result).toContain('S3StorageAdapter');
    expect(result).toContain('LevelStorageAdapter');
    expect(result).toContain('LmdbStorageAdapter');
  });

  it('chrome-extension runtime includes ChromeStorageAdapter', () => {
    const result = getAdaptersByRuntime('chrome-extension');
    expect(result).toContain('ChromeStorageAdapter');
  });

  it('node runtime includes FileSystem, Level, Lmdb', () => {
    const result = getAdaptersByRuntime('node');
    expect(result).toContain('FileSystemStorageAdapter');
    expect(result).toContain('LevelStorageAdapter');
    expect(result).toContain('LmdbStorageAdapter');
  });

  it('"any" runtime matches MemoryStorageAdapter', () => {
    const result = getAdaptersByRuntime('any');
    expect(result).toContain('MemoryStorageAdapter');
  });
});

// ---------------------------------------------------------------------------
// capability — static capabilities property on adapter classes
// ---------------------------------------------------------------------------

describe('capability — static capabilities property on adapter classes', () => {
  it('MemoryStorageAdapter.capabilities matches the constant', () => {
    expect(MemoryStorageAdapter.capabilities).toBe(MEMORY_ADAPTER_CAPABILITIES);
  });

  it('IndexedDatabaseStorageAdapter.capabilities matches the constant', () => {
    expect(IndexedDatabaseStorageAdapter.capabilities).toBe(
      INDEXED_DATABASE_ADAPTER_CAPABILITIES,
    );
  });

  it('OPFSStorageAdapter.capabilities matches the constant', () => {
    expect(OPFSStorageAdapter.capabilities).toBe(OPFS_ADAPTER_CAPABILITIES);
  });

  it('ChromeStorageAdapter.capabilities matches the constant', () => {
    expect(ChromeStorageAdapter.capabilities).toBe(CHROME_STORAGE_ADAPTER_CAPABILITIES);
  });

  it('SQLiteStorageAdapter.capabilities matches the constant', () => {
    expect(SQLiteStorageAdapter.capabilities).toBe(SQLITE_ADAPTER_CAPABILITIES);
  });

  it('FileSystemStorageAdapter.capabilities matches the constant', () => {
    expect(FileSystemStorageAdapter.capabilities).toBe(FILE_SYSTEM_ADAPTER_CAPABILITIES);
  });

  it('LevelStorageAdapter.capabilities matches the constant', () => {
    expect(LevelStorageAdapter.capabilities).toBe(LEVEL_ADAPTER_CAPABILITIES);
  });

  it('LmdbStorageAdapter.capabilities matches the constant', () => {
    expect(LmdbStorageAdapter.capabilities).toBe(LMDB_ADAPTER_CAPABILITIES);
  });

  it('RedisStorageAdapter.capabilities matches the constant', () => {
    expect(RedisStorageAdapter.capabilities).toBe(REDIS_ADAPTER_CAPABILITIES);
  });

  it('S3StorageAdapter.capabilities matches the constant', () => {
    expect(S3StorageAdapter.capabilities).toBe(S3_ADAPTER_CAPABILITIES);
  });

  it('every adapter class has a capabilities property with a valid tier', () => {
    const adapterClasses = [
      MemoryStorageAdapter,
      OPFSStorageAdapter,
      ChromeStorageAdapter,
      SQLiteStorageAdapter,
      FileSystemStorageAdapter,
      LevelStorageAdapter,
      LmdbStorageAdapter,
      RedisStorageAdapter,
      S3StorageAdapter,
    ];

    const validTiers: AdapterSupportTier[] = [
      'production-supported',
      'experimental',
      'internal-only',
    ];

    for (const AdapterClass of adapterClasses) {
      assertCapabilitiesShape(AdapterClass.capabilities, AdapterClass.name);
      expect(
        validTiers.includes(AdapterClass.capabilities.tier),
        `${AdapterClass.name}.capabilities.tier must be a valid tier`,
      ).toBe(true);
    }
  });
});
