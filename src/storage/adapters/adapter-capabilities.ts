/**
 * Adapter capability metadata and support matrix.
 *
 * Every adapter in this codebase carries a static `capabilities` property that
 * declares its support guarantees across seven axes. Callers (and humans) can
 * query that object without instantiating the adapter, which makes capability
 * checks safe and cheap.
 *
 * Support classification:
 * - **production-supported**: battle-tested, meets all quality bars, recommended
 *   for production use.
 * - **experimental**: functional but not yet proven at scale; subject to API
 *   change; usable in production at your own risk.
 * - **internal-only**: used internally for testing or tooling; not intended for
 *   production use.
 */

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

/**
 * Production-readiness tier for each adapter.
 *
 * - `production-supported`: recommended for production; stable API.
 * - `experimental`: functional, but subject to change; use with caution.
 * - `internal-only`: for testing/tooling only; not intended for production.
 */
export type AdapterSupportTier =
  | 'production-supported'
  | 'experimental'
  | 'internal-only';

/**
 * Runtime environments an adapter can operate in.
 * Multiple entries mean the adapter works in all of them.
 */
export type AdapterRuntime = 'browser' | 'bun' | 'node' | 'any' | 'chrome-extension';

// ---------------------------------------------------------------------------
// Capability shape
// ---------------------------------------------------------------------------

/**
 * Declared capability guarantees for a single storage adapter.
 *
 * @property tier - Support classification tier (production-supported, experimental, internal-only).
 * @property runtimes - Environments where the adapter is operational.
 * @property persistence - Data survives process/browser restart.
 * @property transactions - Atomic multi-write transactions (all-or-nothing).
 * @property batchAtomicity - `putBatch` is atomic (entire batch succeeds or rolls back).
 * @property metadataIndexing - Secondary indexes on metadata fields are maintained.
 * @property quotaReporting - The adapter can report used/available storage quota.
 * @property concurrentWriters - Multiple writers can operate safely without external locking.
 * @property notes - Human-readable caveats or clarifications.
 */
export interface AdapterCapabilities {
  readonly tier: AdapterSupportTier;
  readonly runtimes: readonly AdapterRuntime[];
  readonly persistence: boolean;
  readonly transactions: boolean;
  readonly batchAtomicity: boolean;
  readonly metadataIndexing: boolean;
  readonly quotaReporting: boolean;
  readonly concurrentWriters: boolean;
  readonly notes?: string;
}

// ---------------------------------------------------------------------------
// Per-adapter capability declarations
// ---------------------------------------------------------------------------

/**
 * IndexedDB adapter — production-supported browser backend.
 *
 * Persistence and transactions are provided by IndexedDB itself. Quota
 * reporting is available via the Storage API. Concurrent-writer safety is
 * limited by single-process tab semantics; cross-tab writes are not
 * coordinated.
 */
export const INDEXED_DATABASE_ADAPTER_CAPABILITIES: AdapterCapabilities = {
  tier: 'production-supported',
  runtimes: ['browser'],
  persistence: true,
  transactions: true,
  batchAtomicity: false,
  metadataIndexing: false,
  quotaReporting: true,
  concurrentWriters: false,
  notes:
    'Cross-tab concurrent writes are not coordinated; single-tab use is safe. ' +
    'Quota reporting requires the Storage API (navigator.storage.estimate).',
};

/**
 * In-memory adapter — internal-only; intended for tests and ephemeral use.
 *
 * Data is held in a JavaScript `Map` and is lost when the process exits.
 * There is no quota limit, no transactions, and no persistence.
 */
export const MEMORY_ADAPTER_CAPABILITIES: AdapterCapabilities = {
  tier: 'internal-only',
  runtimes: ['any'],
  persistence: false,
  transactions: false,
  batchAtomicity: false,
  metadataIndexing: false,
  quotaReporting: false,
  concurrentWriters: false,
  notes:
    'Data is ephemeral (process lifetime only). Use for tests and caching, not production.',
};

/**
 * OPFS adapter — experimental browser backend using the Origin Private File System.
 *
 * Persistence is durable at the browser-origin level. Transactions and
 * atomicity are not guaranteed because OPFS writes individual files without a
 * coordinating journal. Concurrent access from multiple workers is possible
 * but requires external coordination.
 */
export const OPFS_ADAPTER_CAPABILITIES: AdapterCapabilities = {
  tier: 'experimental',
  runtimes: ['browser'],
  persistence: true,
  transactions: false,
  batchAtomicity: false,
  metadataIndexing: false,
  quotaReporting: true,
  concurrentWriters: false,
  notes:
    'Requires OPFS support (Chrome 86+, Firefox 111+, Safari 15.2+). ' +
    'Each vector is stored as an individual file — no cross-file atomicity.',
};

/**
 * Chrome Storage adapter — experimental backend for Chrome extension contexts.
 *
 * Backed by `chrome.storage.local` or `chrome.storage.session`. Persistence
 * depends on the chosen area. Storage quota is bounded by Chrome's per-extension
 * limits (typically 10 MB for `local`). No transactions or atomicity guarantees.
 */
export const CHROME_STORAGE_ADAPTER_CAPABILITIES: AdapterCapabilities = {
  tier: 'experimental',
  runtimes: ['chrome-extension'],
  persistence: true,
  transactions: false,
  batchAtomicity: false,
  metadataIndexing: false,
  quotaReporting: false,
  concurrentWriters: false,
  notes:
    'Only available in Chrome extension service workers and content scripts. ' +
    'Storage quota is set by Chrome (≈ 10 MB for local, session is per-session).',
};

/**
 * SQLite adapter — production-supported Bun backend via `bun:sqlite`.
 *
 * Full ACID transactions; `putBatch` wraps writes in a single transaction for
 * atomicity. Concurrent write safety requires WAL mode (enabled by default in
 * this adapter). Quota reporting is not provided; disk space is the limit.
 */
export const SQLITE_ADAPTER_CAPABILITIES: AdapterCapabilities = {
  tier: 'production-supported',
  runtimes: ['bun'],
  persistence: true,
  transactions: true,
  batchAtomicity: true,
  metadataIndexing: false,
  quotaReporting: false,
  concurrentWriters: true,
  notes:
    'Uses bun:sqlite with WAL mode. Multiple concurrent readers; serialized writers. ' +
    'In-memory mode (:memory:) is available for testing.',
};

/**
 * File System adapter — experimental backend using Node/Bun file I/O.
 *
 * Each vector is serialized as a separate file (JSON or binary). Persistence
 * is filesystem-durable but there are no transactions; a crash mid-batch can
 * leave partial writes. Not safe for multiple concurrent writers.
 */
export const FILE_SYSTEM_ADAPTER_CAPABILITIES: AdapterCapabilities = {
  tier: 'experimental',
  runtimes: ['bun', 'node'],
  persistence: true,
  transactions: false,
  batchAtomicity: false,
  metadataIndexing: false,
  quotaReporting: false,
  concurrentWriters: false,
  notes:
    'One file per vector. No journaling — a crash during putBatch can leave partial state. ' +
    'Concurrent writers require external file locking.',
};

/**
 * LevelDB adapter — experimental backend via the `level` npm package.
 *
 * Ordered key-value store with atomic batch writes. Transactions across
 * multiple operations are not supported at the adapter level. Concurrent
 * access is not safe without external coordination.
 */
export const LEVEL_ADAPTER_CAPABILITIES: AdapterCapabilities = {
  tier: 'experimental',
  runtimes: ['bun', 'node'],
  persistence: true,
  transactions: false,
  batchAtomicity: true,
  metadataIndexing: false,
  quotaReporting: false,
  concurrentWriters: false,
  notes:
    'Requires the `level` npm package as a peer dependency. ' +
    'putBatch uses LevelDB atomic batch writes.',
};

/**
 * LMDB adapter — experimental backend via the `lmdb` npm package.
 *
 * Memory-mapped key-value store with ACID transactions. Very fast for
 * read-heavy workloads. A single writer at a time; multiple concurrent
 * readers are safe.
 */
export const LMDB_ADAPTER_CAPABILITIES: AdapterCapabilities = {
  tier: 'experimental',
  runtimes: ['bun', 'node'],
  persistence: true,
  transactions: true,
  batchAtomicity: true,
  metadataIndexing: false,
  quotaReporting: false,
  concurrentWriters: false,
  notes:
    'Requires the `lmdb` npm package as a peer dependency. ' +
    'Single writer, multiple concurrent readers.',
};

/**
 * Redis adapter — experimental backend via `Bun.RedisClient`.
 *
 * In-memory data store with optional AOF/RDB persistence. Atomic multi-key
 * operations use pipelines; full cross-command transactions are not exposed.
 * Suitable for caching or read-heavy workloads with a Redis server available.
 */
export const REDIS_ADAPTER_CAPABILITIES: AdapterCapabilities = {
  tier: 'experimental',
  runtimes: ['bun'],
  persistence: true,
  transactions: false,
  batchAtomicity: false,
  metadataIndexing: false,
  quotaReporting: false,
  concurrentWriters: true,
  notes:
    'Requires a Redis server and Bun runtime. Persistence depends on Redis server configuration ' +
    '(AOF/RDB). Multiple concurrent writers are safe via Redis serialization.',
};

/**
 * S3 adapter — experimental backend via `Bun.s3`.
 *
 * Object storage with eventual consistency. No transactions, no atomicity, no
 * quota reporting. Each vector is a separate S3 object. Suitable for archival
 * or large-scale read-heavy scenarios where latency is acceptable.
 */
export const S3_ADAPTER_CAPABILITIES: AdapterCapabilities = {
  tier: 'experimental',
  runtimes: ['bun'],
  persistence: true,
  transactions: false,
  batchAtomicity: false,
  metadataIndexing: false,
  quotaReporting: false,
  concurrentWriters: true,
  notes:
    'Requires a Bun runtime and AWS S3 (or compatible) credentials. ' +
    'Eventual consistency — concurrent writes to the same key may race.',
};

// ---------------------------------------------------------------------------
// Support matrix (read-only registry)
// ---------------------------------------------------------------------------

/**
 * Adapter name used as the key in the support matrix.
 */
export type AdapterName =
  | 'IndexedDatabaseStorageAdapter'
  | 'MemoryStorageAdapter'
  | 'OPFSStorageAdapter'
  | 'ChromeStorageAdapter'
  | 'SQLiteStorageAdapter'
  | 'FileSystemStorageAdapter'
  | 'LevelStorageAdapter'
  | 'LmdbStorageAdapter'
  | 'RedisStorageAdapter'
  | 'S3StorageAdapter';

/**
 * Complete Storage Adapter Support matrix.
 *
 * Maps every adapter name to its declared capability metadata. Use this to
 * inspect support guarantees without instantiating any adapter.
 *
 * @example
 * ```typescript
 * import { ADAPTER_SUPPORT_MATRIX } from 'vector-frankl/storage/adapters/adapter-capabilities';
 *
 * const caps = ADAPTER_SUPPORT_MATRIX['SQLiteStorageAdapter'];
 * const isProductionReady = caps.tier === 'production-supported' && caps.transactions;
 * ```
 */
export const ADAPTER_SUPPORT_MATRIX: Readonly<Record<AdapterName, AdapterCapabilities>> =
  {
    IndexedDatabaseStorageAdapter: INDEXED_DATABASE_ADAPTER_CAPABILITIES,
    MemoryStorageAdapter: MEMORY_ADAPTER_CAPABILITIES,
    OPFSStorageAdapter: OPFS_ADAPTER_CAPABILITIES,
    ChromeStorageAdapter: CHROME_STORAGE_ADAPTER_CAPABILITIES,
    SQLiteStorageAdapter: SQLITE_ADAPTER_CAPABILITIES,
    FileSystemStorageAdapter: FILE_SYSTEM_ADAPTER_CAPABILITIES,
    LevelStorageAdapter: LEVEL_ADAPTER_CAPABILITIES,
    LmdbStorageAdapter: LMDB_ADAPTER_CAPABILITIES,
    RedisStorageAdapter: REDIS_ADAPTER_CAPABILITIES,
    S3StorageAdapter: S3_ADAPTER_CAPABILITIES,
  } as const;

// ---------------------------------------------------------------------------
// Helper utilities
// ---------------------------------------------------------------------------

/**
 * Returns all adapter names classified under the given support tier.
 *
 * @example
 * ```typescript
 * const stable = getAdaptersByTier('production-supported');
 * // ['IndexedDatabaseStorageAdapter', 'SQLiteStorageAdapter']
 * ```
 */
export function getAdaptersByTier(tier: AdapterSupportTier): AdapterName[] {
  return (Object.entries(ADAPTER_SUPPORT_MATRIX) as [AdapterName, AdapterCapabilities][])
    .filter(([, caps]) => caps.tier === tier)
    .map(([name]) => name);
}

/**
 * Returns all adapter names that are compatible with the given runtime.
 *
 * @example
 * ```typescript
 * const browserAdapters = getAdaptersByRuntime('browser');
 * // ['IndexedDatabaseStorageAdapter', 'OPFSStorageAdapter']
 * ```
 */
export function getAdaptersByRuntime(runtime: AdapterRuntime): AdapterName[] {
  return (Object.entries(ADAPTER_SUPPORT_MATRIX) as [AdapterName, AdapterCapabilities][])
    .filter(
      ([, caps]) => caps.runtimes.includes(runtime) || caps.runtimes.includes('any'),
    )
    .map(([name]) => name);
}
