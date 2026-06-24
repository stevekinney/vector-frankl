# Storage Adapter Support

Vector Frankl ships ten storage adapters behind a single `StorageAdapter` interface. Each
adapter targets a specific runtime and persistence model. This document covers setup,
runtime requirements, limits, persistence guarantees, concurrency behavior, quota
handling, and cleanup for each.

## Table of Contents

- [Choosing an adapter](#choosing-an-adapter)
- [MemoryStorageAdapter](#memorystoragereaderadapter)
- [IndexedDB](#indexeddb)
- [OPFS (Origin Private File System)](#opfs-origin-private-file-system)
- [Chrome storage](#chrome-storage)
- [SQLite](#sqlite)
- [File system](#file-system)
- [LevelDB](#leveldb)
- [LMDB](#lmdb)
- [Redis](#redis)
- [S3](#s3)

---

## Choosing an adapter

| Adapter                         | Backend                    | Runtime           | Persistence  |
| ------------------------------- | -------------------------- | ----------------- | ------------ |
| `MemoryStorageAdapter`          | In-process `Map`           | Any               | None         |
| `IndexedDatabaseStorageAdapter` | IndexedDB                  | Browser           | Durable      |
| `OPFSStorageAdapter`            | Origin Private File System | Browser           | Durable      |
| `ChromeStorageAdapter`          | `chrome.storage`           | Chrome extensions | Durable      |
| `SQLiteStorageAdapter`          | `bun:sqlite`               | Bun ≥ 1.0         | Durable      |
| `FileSystemStorageAdapter`      | File system (JSON/binary)  | Bun ≥ 1.0         | Durable      |
| `LevelStorageAdapter`           | LevelDB via `level`        | Bun / Node ≥ 18   | Durable      |
| `LmdbStorageAdapter`            | LMDB via `lmdb`            | Bun / Node ≥ 18   | Durable      |
| `RedisStorageAdapter`           | `Bun.RedisClient`          | Bun ≥ 1.1         | Server-side  |
| `S3StorageAdapter`              | `Bun.s3`                   | Bun ≥ 1.1         | Cloud object |

---

## MemoryStorageAdapter

An in-process store backed by a JavaScript `Map`. Data does not survive process exit.

### Setup

```typescript
import { MemoryStorageAdapter, VectorDB } from 'vector-frankl';

const adapter = new MemoryStorageAdapter();
const db = new VectorDB('test', 384, { storage: adapter });
await db.init();
```

### Options

```typescript
new MemoryStorageAdapter({
  cloneOnRead?: boolean;  // default: true  — deep-clone on every read
  cloneOnWrite?: boolean; // default: true  — deep-clone on every write
})
```

Disable cloning only when you control all references and never mutate returned data
outside the adapter.

### Limits

Bounded only by available process heap. No quota enforcement is applied.

### Persistence guarantees

None. All data is lost on process exit, GC, or when `destroy()` is called.

### Concurrency

Single-threaded; all operations complete synchronously on the JavaScript event loop.
Safe within a single process.

### Quota behavior

No quota is tracked. `StorageQuotaMonitor` does not monitor memory-adapter usage.

### Cleanup

```typescript
await adapter.destroy(); // clears the Map
```

---

## IndexedDB

The default browser adapter. Uses the browser's built-in IndexedDB API for
persistent, origin-scoped storage. Import is `IndexedDatabaseStorageAdapter`.

### Setup

```typescript
import { IndexedDatabaseStorageAdapter, VectorDB } from 'vector-frankl';

const adapter = new IndexedDatabaseStorageAdapter({ name: 'my-vectors' });
const db = new VectorDB('my-vectors', 384, { storage: adapter });
await db.init();
```

### Options

```typescript
new IndexedDatabaseStorageAdapter({
  name: string;     // IndexedDB database name
  version?: number; // Schema version (default: 1)
})
```

### Runtime requirements

- Chromium ≥ 80, Firefox ≥ 75, Safari/WebKit ≥ 14.0, Edge ≥ 80
- All modern mobile browsers (Chrome for Android ≥ 80, Firefox for Android ≥ 79,
  Safari on iOS ≥ 14)
- Web Workers (dedicated workers only; shared workers may work but are not tested)
- Not available in Chrome extensions' background service workers — use
  `ChromeStorageAdapter` instead

### Limits

- Maximum key size: 1,023 bytes
- Maximum value size: browser-dependent; typically 2 GB per object store
- Maximum total quota: browser-managed (see Quota behavior below)
- Maximum vector dimensions: 100,000 (enforced by Vector Frankl's `InputValidator`)

### Persistence guarantees

Data persists across page reloads, tab closes, and browser restarts. Cleared by
explicit `destroy()`, browser "clear site data", or user-initiated storage eviction.

### Concurrency

IndexedDB is accessible from multiple tabs on the same origin simultaneously. Each
tab opens its own connection; Vector Frankl serializes writes within a single
connection using IndexedDB transactions. Cross-tab writes may interleave — if you
need cross-tab coordination, use separate named databases per tab or implement
application-level locking.

### Quota behavior

IndexedDB shares the browser's origin storage quota (typically 60% of available disk
space up to a browser-specific cap). `StorageQuotaMonitor` calls `navigator.storage.estimate()`
to track usage. When usage exceeds the configured safety margin (default 85%), it
emits `warning`, `critical`, or `emergency` events.

```typescript
import { StorageQuotaMonitor } from 'vector-frankl';

const monitor = StorageQuotaMonitor.getInstance();
monitor.addListener((warning) => {
  console.warn(`Storage ${warning.type}: ${warning.message}`);
});
```

### Cleanup

```typescript
await db.clear(); // remove all vectors, keep the database
await db.delete(); // drop the entire IndexedDB database
```

---

## OPFS (Origin Private File System)

Uses the browser's Origin Private File System API for high-performance,
origin-scoped file storage. Faster than IndexedDB for large sequential reads/writes.

### Setup

```typescript
import { OPFSStorageAdapter } from 'vector-frankl/adapters/opfs';
import { VectorDB } from 'vector-frankl';

const adapter = new OPFSStorageAdapter({ directory: 'my-vectors' });
const db = new VectorDB('my-vectors', 384, { storage: adapter });
await db.init();
```

### Options

```typescript
new OPFSStorageAdapter({
  directory: string; // Sub-directory within the OPFS root
})
```

### Runtime requirements

- Chromium ≥ 86, Firefox ≥ 111, Safari/WebKit ≥ 15.2
- Chrome for Android ≥ 86, Safari on iOS ≥ 15.2
- OPFS synchronous access (`createSyncAccessHandle`) requires a dedicated Worker
  context; the async API used here works in the main thread

### Limits

- Individual file size: OS file system dependent
- No enforced per-entry size limit beyond available quota

### Persistence guarantees

Durable across page reloads and browser restarts. Shares the same origin quota as
IndexedDB. Cleared by `destroy()` or browser "clear site data".

### Concurrency

Concurrent reads across instances are safe. Concurrent writes to the same file from
multiple contexts can corrupt data — serialize writes within your application if you
open the same OPFS directory from multiple tabs.

### Quota behavior

OPFS shares the origin quota with IndexedDB. Use `StorageQuotaMonitor` to track
combined usage.

### Cleanup

```typescript
await db.clear(); // remove all vector files in the directory
await db.delete(); // remove the OPFS directory and all its contents
```

---

## Chrome storage

Uses `chrome.storage.local` or `chrome.storage.session` for Chrome extension
contexts where IndexedDB access may be restricted.

### Setup

```typescript
import { ChromeStorageAdapter } from 'vector-frankl/adapters/chrome-storage';
import { VectorDB } from 'vector-frankl';

const adapter = new ChromeStorageAdapter({
  prefix: 'my-vectors',
  area: 'local', // or 'session'
});
const db = new VectorDB('my-vectors', 384, { storage: adapter });
await db.init();
```

### Options

```typescript
new ChromeStorageAdapter({
  prefix: string;              // Key namespace prefix
  area?: 'local' | 'session'; // default: 'local'
})
```

### Runtime requirements

- Chrome extensions Manifest V2 and V3
- `"storage"` permission in `manifest.json`
- Chrome ≥ 80 (for promise-based `chrome.storage` API)

### Limits

- `chrome.storage.local`: 10 MB by default; can be raised to `chrome.storage.local.QUOTA_BYTES` via `unlimitedStorage` permission
- `chrome.storage.session`: 10 MB (Chrome 102+, non-persistent, cleared on extension
  reload or browser close)
- Maximum item size: 8 KB per key-value pair for `sync` storage (not used here), no
  per-item limit for `local`

### Persistence guarantees

`local`: survives extension reloads and browser restarts.
`session`: cleared when the extension is reloaded or the browser closes.

### Concurrency

`chrome.storage` operations are atomic at the item level. Index mutations within
`ChromeStorageAdapter` are serialized via an internal promise-based mutex to prevent
lost-update races.

### Quota behavior

`chrome.storage.local` does not integrate with `navigator.storage.estimate()`.
Monitor usage via `chrome.storage.local.getBytesInUse()` separately.

### Cleanup

```typescript
await db.clear(); // remove all vectors
await db.delete(); // remove all keys under the configured prefix
```

---

## SQLite

Backed by Bun's built-in `bun:sqlite`. Each adapter instance owns a single database
file. Uses WAL journal mode for performance.

### Setup

```typescript
import { SQLiteStorageAdapter } from 'vector-frankl/adapters/sqlite';
import { VectorDB } from 'vector-frankl';

// File-based
const adapter = new SQLiteStorageAdapter({ filename: './vectors.db' });

// In-memory
const memAdapter = new SQLiteStorageAdapter({ filename: ':memory:' });

const db = new VectorDB('my-vectors', 384, { storage: adapter });
await db.init();
```

### Options

```typescript
new SQLiteStorageAdapter({
  filename: string; // File path or ':memory:'
})
```

### Runtime requirements

- Bun ≥ 1.0 (uses `bun:sqlite` built-in)
- Not available in Node.js

### Limits

- File size: limited by the host file system (SQLite theoretical max: 281 TB)
- Row size: limited by SQLite's `SQLITE_MAX_LENGTH` (default 1 GB per field)
- Concurrent writer processes: 1 (WAL mode allows many concurrent readers and one
  writer)

### Persistence guarantees

ACID-compliant via SQLite transactions. WAL mode (`PRAGMA journal_mode=WAL`) ensures
durability: committed transactions survive process crashes. A clean `close()` flushes
the WAL to the main database file.

Companion files (`*.db-wal`, `*.db-shm`) are created alongside the database file.
Include them in backups.

### Concurrency

Multiple `SQLiteStorageAdapter` instances in the same process can share a file; WAL
mode serializes writes at the SQLite level. Cross-process writes to the same file are
safe via WAL but may increase lock contention under high write throughput.

### Quota behavior

No quota enforcement. Monitor disk usage externally.

### Cleanup

```typescript
await db.clear(); // DELETE all rows from the vectors table
await db.delete(); // close + DELETE the .db, .db-wal, and .db-shm files
```

---

## File system

Stores each vector as an individual JSON or binary file in a directory. Primarily
useful for debugging, export/import workflows, or environments where SQLite is not
available.

### Setup

```typescript
import { FileSystemStorageAdapter } from 'vector-frankl/adapters/file-system';
import { VectorDB } from 'vector-frankl';

const adapter = new FileSystemStorageAdapter({
  directory: './vector-store',
  format: 'binary', // or 'json' (default)
});
const db = new VectorDB('my-vectors', 384, { storage: adapter });
await db.init();
```

### Options

```typescript
new FileSystemStorageAdapter({
  directory: string;              // Base directory; created if it doesn't exist
  format?: 'binary' | 'json';    // default: 'json'
})
```

`binary` format is more compact and faster to read/write; `json` is human-readable
and portable across runtimes.

### Runtime requirements

- Bun ≥ 1.0 (constructor throws immediately if `typeof Bun === 'undefined'`)
- Write permission on the target directory

### Limits

- No per-vector size limit beyond available disk space
- ID characters unsafe for file names (`/ \ : * ? " < > |`) are percent-encoded
  automatically

### Persistence guarantees

Files are written atomically per-vector. No transactional guarantees across multiple
writes. If a process crashes mid-batch, some vectors may be written and others not.
For atomic multi-vector commits, use `SQLiteStorageAdapter` instead.

### Concurrency

Multiple processes writing to the same directory concurrently can produce
inconsistent state. The adapter does not implement cross-process locking.

### Quota behavior

No quota enforcement. Monitor disk usage externally.

### Cleanup

```typescript
await db.clear(); // delete all files in the vectors/ sub-directory
await db.delete(); // delete the entire base directory recursively
```

---

## LevelDB

Uses the `level` npm package (LevelDB). Suitable for Bun and Node.js server
workloads that need a fast embedded key-value store without a native dependency tree
as large as LMDB.

### Setup

```bash
bun add level
```

```typescript
import { LevelStorageAdapter } from 'vector-frankl/adapters/level';
import { VectorDB } from 'vector-frankl';

const adapter = new LevelStorageAdapter({ directory: './level-store' });
const db = new VectorDB('my-vectors', 384, { storage: adapter });
await db.init();
```

### Options

```typescript
new LevelStorageAdapter({
  directory: string; // LevelDB database directory; created if absent
})
```

### Runtime requirements

- Bun ≥ 1.0 or Node.js ≥ 18
- `level` package installed as a peer dependency

### Limits

- Key size: 16 KB default (configurable)
- Value size: limited by available memory for the LevelDB write buffer
- Concurrent writers from separate processes are **not** supported (LevelDB uses a
  file lock)

### Persistence guarantees

LevelDB writes are durable after the write is flushed. The default `level` sync mode
buffers writes; for strict durability set `sync: true` in your LevelDB options.

### Concurrency

Single-writer model. Multiple concurrent reads within the same process are safe.
Cross-process access to the same directory will fail with a lock error.

### Quota behavior

No quota enforcement. Monitor disk usage externally.

### Cleanup

```typescript
await db.clear(); // remove all key-value pairs (LevelDB `clear()`)
await db.delete(); // close + recursively delete the directory
```

---

## LMDB

Uses the `lmdb` npm package. Offers memory-mapped I/O for high read throughput and
supports multiple readers with a single writer simultaneously.

### Setup

```bash
bun add lmdb
```

```typescript
import { LmdbStorageAdapter } from 'vector-frankl/adapters/lmdb';
import { VectorDB } from 'vector-frankl';

const adapter = new LmdbStorageAdapter({
  directory: './lmdb-store',
  mapSize: 1024 * 1024 * 1024, // 1 GB map size (optional)
});
const db = new VectorDB('my-vectors', 384, { storage: adapter });
await db.init();
```

### Options

```typescript
new LmdbStorageAdapter({
  directory: string;   // LMDB environment directory; created if absent
  mapSize?: number;    // Maximum memory-map size in bytes (default: LMDB default)
})
```

Set `mapSize` larger than your expected dataset. LMDB cannot grow the map without
reopening the environment.

### Runtime requirements

- Bun ≥ 1.0 or Node.js ≥ 18
- `lmdb` package installed as a peer dependency
- 64-bit OS (32-bit hosts have a much smaller address space for mmap)

### Limits

- Map size: set at open time, cannot be changed without closing and reopening
- Maximum number of concurrent readers: 126 by default
- Maximum databases per environment: 1 (one unnamed database is used)

### Persistence guarantees

LMDB uses copy-on-write B+ trees and writes are durable after `put` completes.
ACID transactions are used for all mutations.

### Concurrency

Multiple readers in separate processes can open the same LMDB environment
simultaneously. Only one writer may hold a transaction at a time (LMDB's
single-writer multiple-reader model).

### Quota behavior

No quota enforcement. Set `mapSize` appropriate for expected dataset growth.

### Cleanup

```typescript
await db.clear(); // LMDB `drop()` on the database
await db.delete(); // close + recursively delete the directory
```

---

## Redis

Uses Bun's built-in `Bun.RedisClient` for networked key-value storage. Suitable for
distributed server deployments where multiple processes share a single vector store.

### Setup

```typescript
import { RedisStorageAdapter } from 'vector-frankl/adapters/redis';
import { VectorDB } from 'vector-frankl';

const adapter = new RedisStorageAdapter({
  url: 'redis://localhost:6379', // optional; defaults to localhost:6379
  prefix: 'vf:prod',
});
const db = new VectorDB('my-vectors', 384, { storage: adapter });
await db.init();
```

### Options

```typescript
new RedisStorageAdapter({
  url?: string;   // Redis connection URL (default: redis://localhost:6379)
  prefix: string; // Key prefix for namespace isolation
})
```

Each adapter instance manages two Redis key structures:

- `<prefix>:v:<id>` — JSON-serialized vector data
- `<prefix>:ids` — Redis SET of all vector IDs

### Runtime requirements

- Bun ≥ 1.1 (for `Bun.RedisClient` built-in)
- Redis server ≥ 6.0 accessible from the Bun process
- Not available in Node.js or browsers

### Limits

- Maximum value size: limited by Redis `maxmemory` policy and available RAM
- `MGET` batch size: all IDs fetched in a single command; very large stores may
  generate large responses

### Persistence guarantees

Redis persistence depends on your Redis server configuration:

- RDB snapshots: data may be lost since the last snapshot
- AOF (append-only file): near-durable, depending on `appendfsync` setting
- `appendfsync always`: fully durable but slower

For durable storage, enable AOF or use Redis Cluster with replication.

### Concurrency

Multiple Bun processes can read and write to the same Redis prefix concurrently.
Index mutations (adds to and removes from the `ids` SET) are individual Redis
commands. Concurrent writes are safe at the Redis level but not transactional
across multiple commands — a crash between `SET` and `SADD` can leave dangling
data.

### Quota behavior

Redis respects the `maxmemory` setting. When the server is full, writes fail with an
`OOM` error. Implement eviction policies at the Redis level (`maxmemory-policy`).
No quota integration with `StorageQuotaMonitor`.

### Cleanup

```typescript
await db.clear(); // DEL all vector keys + the id-set key
await adapter.close(); // closes the Bun.RedisClient connection
```

`destroy()` calls `clear()` then closes the connection. Call `close()` (not
`destroy()`) when you want to release the connection without deleting data.

---

## S3

Uses Bun's built-in `Bun.s3` for object storage. Suitable for long-term archival,
cross-region replication, or serverless deployments where disk-based storage is not
available.

### Setup

```typescript
import { S3StorageAdapter } from 'vector-frankl/adapters/s3';
import { VectorDB } from 'vector-frankl';

const adapter = new S3StorageAdapter({
  bucket: 'my-vector-bucket',
  prefix: 'embeddings/',
  region: 'us-east-1',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
});
const db = new VectorDB('my-vectors', 384, { storage: adapter });
await db.init();
```

### Options

```typescript
new S3StorageAdapter({
  bucket: string;           // S3 bucket name
  prefix?: string;          // Object key prefix (default: '')
  region?: string;          // AWS region
  endpoint?: string;        // Custom endpoint for S3-compatible stores (MinIO, R2, etc.)
  accessKeyId?: string;     // AWS access key (falls back to environment/IAM role)
  secretAccessKey?: string; // AWS secret key
})
```

Compatible with any S3-compatible object store: AWS S3, Cloudflare R2, MinIO,
Backblaze B2, DigitalOcean Spaces.

### Runtime requirements

- Bun ≥ 1.1 (for `Bun.s3` built-in)
- Network access to the S3 endpoint
- Not available in Node.js or browsers

### Limits

- Maximum object size: 5 TB (AWS S3); up to provider
- In-memory index: all vector IDs are loaded into a `Set` at `init()`. For very
  large collections (> 1M vectors), this Set can consume significant memory
- `getAll()` fetches all vectors; not suitable for scans over millions of entries

### Persistence guarantees

S3 offers 11 nines of durability (AWS S3 Standard). Writes are eventually durable
after the `PUT` returns. The S3 adapter maintains an in-memory ID index that is
flushed to an `index.json` object in the bucket at every write. A crash between a
vector PUT and the index flush leaves the vector orphaned (accessible by ID but not
listed). Re-initialize after a crash to reconcile.

### Concurrency

Multiple processes writing to the same prefix concurrently can corrupt the in-memory
index. The adapter uses a per-instance promise mutex to serialize writes within a
single process. For multi-process writes, implement external coordination (e.g.,
S3 conditional writes or a distributed lock).

### Quota behavior

S3 storage is billed by usage. No quota enforcement within the adapter. Monitor
bucket size via AWS CloudWatch or S3 Storage Lens.

### Cleanup

```typescript
await db.clear(); // DELETE all vector objects + the index manifest
await adapter.close(); // no-op for S3; included for interface consistency
```

`destroy()` calls `clear()`. There is no connection to close.
