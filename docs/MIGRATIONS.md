# Migrations, Upgrades, and Failure Modes

This guide covers upgrading between Vector Frankl versions, migrating IndexedDB schemas, rebuilding indexes, recovering from corrupt storage, and handling every production failure mode the library surfaces.

## Table of Contents

- [Upgrading Between Versions](#upgrading-between-versions)
- [IndexedDB Schema Migrations](#indexeddb-schema-migrations)
- [Rebuilding Indexes](#rebuilding-indexes)
- [Incompatible Persisted Indexes](#incompatible-persisted-indexes)
- [Recovering from Corrupt Storage](#recovering-from-corrupt-storage)
- [Failure Modes Reference](#failure-modes-reference)
  - [Quota Errors](#quota-errors)
  - [Unsupported Runtime APIs](#unsupported-runtime-apis)
  - [Corrupted Data](#corrupted-data)
  - [Aborted Searches and Batch Operations](#aborted-searches-and-batch-operations)
  - [Timeout Errors](#timeout-errors)
  - [Worker Failures](#worker-failures)
  - [WebGPU Failures](#webgpu-failures)
  - [WebAssembly Failures](#webassembly-failures)
  - [Adapter Connectivity Failures](#adapter-connectivity-failures)
  - [Blocked IndexedDB Upgrades](#blocked-indexeddb-upgrades)

---

## Upgrading Between Versions

Vector Frankl follows [Semantic Versioning](https://semver.org/). Patch releases are safe to apply without any migration steps. Minor releases are backwards-compatible. Major releases may change the IndexedDB schema version or persisted index format.

### 1.0.0-beta.x releases

The library is currently in `1.0.0-beta.*`. Beta releases may introduce breaking changes in any release. Read the `CHANGELOG.md` entry for each beta before upgrading.

### General upgrade procedure

Close every open database connection before the page loads the new package version. IndexedDB schema upgrades only run when no other tab holds an open connection, so a lingering tab from the old version will block the upgrade indefinitely.

```typescript
// In every tab that holds an open VectorDB or VectorFrankl instance,
// close connections before a service-worker or page refresh delivers the
// new bundle.
await db.close();
```

If you use a service worker to cache assets, send a `skipWaiting()` and `clients.claim()` sequence so the new worker takes over all tabs simultaneously, then have each tab call `db.close()` on the `controllerchange` event before reloading.

---

## IndexedDB Schema Migrations

Vector Frankl manages its own IndexedDB schema. The default schema contains five object stores:

| Store          | Key path | Purpose                                |
| -------------- | -------- | -------------------------------------- |
| `vectors`      | `id`     | Raw vector data and metadata           |
| `indices`      | `name`   | Secondary index metadata               |
| `config`       | `key`    | Per-database configuration             |
| `namespaces`   | `name`   | Namespace registry (VectorFrankl only) |
| `hnsw_indices` | `id`     | Persisted HNSW graph nodes             |

The `VectorDatabase` constructor accepts an `onUpgrade` callback that receives the live `IDBDatabase` reference and the previous schema version number. Use this when a future release requires you to rename a store, add an index, or transform stored records.

```typescript
import { VectorDatabase } from 'vector-frankl/core';

const database = new VectorDatabase({
  name: 'my-vectors',
  version: 2, // bump when schema changes
  onUpgrade(upgradeDb, oldVersion) {
    if (oldVersion < 2) {
      // Example: add a new index on the vectors store for a field
      // that did not exist in version 1.
      const transaction = upgradeDb as unknown as IDBDatabase;
      const vectorStore = (transaction as unknown as IDBTransaction).objectStore(
        'vectors',
      );
      if (!vectorStore.indexNames.contains('category')) {
        vectorStore.createIndex('category', 'metadata.category', { unique: false });
      }
    }
  },
});

await database.init();
```

> [!WARNING] Never perform async work (network requests, `await` expressions) inside an `onUpgrade` callback. IndexedDB upgrade transactions auto-commit as soon as the event loop is yielded. All schema changes must be synchronous.

### Migrating stored records in place

To transform existing vector records during an upgrade (for example, to rename a metadata field), read every record in the upgrade callback's transaction and write it back:

```typescript
onUpgrade(upgradeDb, oldVersion) {
  if (oldVersion < 3) {
    const store = (upgradeDb as unknown as IDBTransaction).objectStore('vectors');
    const cursorRequest = store.openCursor();

    cursorRequest.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result;
      if (!cursor) return;

      const record = cursor.value as { metadata?: Record<string, unknown> };
      if (record.metadata?.['old_field'] !== undefined) {
        record.metadata['new_field'] = record.metadata['old_field'];
        delete record.metadata['old_field'];
        cursor.update(record);
      }
      cursor.continue();
    };
  }
}
```

---

## Rebuilding Indexes

HNSW index data is persisted in the `hnsw_indices` store alongside vector data. If you change the distance metric, alter HNSW construction parameters, or suspect the persisted graph is corrupted, delete the stored index and let the library rebuild it on the next search.

### Via the VectorDB API

```typescript
import { VectorDB } from 'vector-frankl';

const db = new VectorDB('my-vectors', 384, { useIndex: true });
await db.init();

// Clear the HNSW index. The next call to db.search() rebuilds it
// from the stored vectors.
await db.clearIndex();

// Trigger an immediate rebuild instead of waiting for the next search.
await db.rebuildIndex();
```

### Via the namespace API

```typescript
import { VectorFrankl } from 'vector-frankl';

const vf = new VectorFrankl();
await vf.init();

const ns = await vf.getNamespace('products');
await ns.clearIndex();
await ns.rebuildIndex();
```

### When to rebuild

- After changing `distanceMetric` in the config.
- After changing HNSW construction parameters (`m`, `efConstruction`).
- After restoring vectors from a backup that does not include the `hnsw_indices` store.
- After receiving an `IndexError` with code `INDEX_ERROR` during search.

---

## Incompatible Persisted Indexes

When an index persisted by an older version of the library is loaded by a newer version that changed the HNSW node format, `init()` or the first search may throw an `IndexError`. The safe recovery path is to delete the incompatible index data and rebuild:

```typescript
import { VectorDB } from 'vector-frankl';
import { IndexError } from 'vector-frankl/errors';

const db = new VectorDB('my-vectors', 384);
await db.init();

try {
  const results = await db.search(query, 10);
} catch (error) {
  if (error instanceof IndexError) {
    console.warn('Index incompatible, rebuilding…', error.message);
    await db.clearIndex();
    await db.rebuildIndex();
    // Retry the search with the rebuilt index.
    const results = await db.search(query, 10);
  } else {
    throw error;
  }
}
```

---

## Recovering from Corrupt Storage

### Corrupt vector records

Individual records can become corrupt if a write was interrupted mid-flight (for example, by a browser crash). The library throws a `TransactionError` (code `TRANSACTION_FAILED`) when it cannot deserialize a stored record.

Recovery options, in order of preference:

**Option 1 — Delete only the corrupt record.**

```typescript
import { VectorDB } from 'vector-frankl';
import { TransactionError } from 'vector-frankl/errors';

const db = new VectorDB('my-vectors', 384);
await db.init();

try {
  const vector = await db.getVector('suspect-id');
} catch (error) {
  if (error instanceof TransactionError) {
    await db.deleteVector('suspect-id');
    // Re-embed and re-insert the source document.
  }
}
```

**Option 2 — Export, destroy, and reimport.**

```typescript
import { VectorDB } from 'vector-frankl';

const db = new VectorDB('my-vectors', 384);
await db.init();

// Export everything that can be read.
const allVectors = await db.list({ limit: Infinity });

// Destroy and recreate the database.
await db.destroy();
const freshDb = new VectorDB('my-vectors', 384);
await freshDb.init();

// Reimport the successfully-read vectors.
await freshDb.addBatch(allVectors);
```

**Option 3 — Full reset (all data lost).**

```typescript
await db.destroy();
```

### Detecting corruption proactively

Use `StorageQuotaMonitor` to track usage trends. An unexpected sudden drop in reported usage can indicate that the browser evicted data under quota pressure.

```typescript
import { StorageQuotaMonitor } from 'vector-frankl/storage';

const monitor = StorageQuotaMonitor.getInstance();
monitor.addListener((warning) => {
  if (warning.type === 'critical' || warning.type === 'emergency') {
    console.error('Storage under pressure — risk of data loss', warning);
  }
});
```

---

## Failure Modes Reference

### Quota Errors

**Error class:** `QuotaExceededError` (code `QUOTA_EXCEEDED`)

**When it occurs:** A write operation would push storage usage past the browser's origin quota. The browser enforces an origin-level limit that varies by browser, operating system, and available disk space. IndexedDB writes that would exceed the quota throw a `QuotaExceededError` natively; the library surfaces this as a typed `QuotaExceededError` with `usage`, `quota`, and `percentage` fields.

**Recovery:**

```typescript
import { VectorDB } from 'vector-frankl';
import { QuotaExceededError } from 'vector-frankl/errors';

try {
  await db.addVector('id', vector, metadata);
} catch (error) {
  if (error instanceof QuotaExceededError) {
    console.error(`Quota at ${error.percentage}%: ${error.usage}/${error.quota} bytes`);

    // Option A — evict old vectors and retry.
    await db.evictOldest(100);
    await db.addVector('id', vector, metadata);

    // Option B — enable compression to shrink existing records.
    // (Set compression in config before calling init() on a new database.)
  }
}
```

**Prevention:** Configure an eviction policy so the library automatically removes low-priority vectors before quota is exhausted:

```typescript
const db = new VectorDB('my-vectors', 384, {
  eviction: {
    enabled: true,
    policy: 'lru',
    maxVectors: 50_000,
    maxMemoryMB: 200,
  },
});
```

---

### Unsupported Runtime APIs

**Error class:** `BrowserSupportError` (code `BROWSER_NOT_SUPPORTED`)

**When it occurs:** The library checks for IndexedDB, Web Workers, WebGPU, WebAssembly, SharedArrayBuffer, or OPFS at initialization time. If a required API is missing, it throws `BrowserSupportError` with a `feature` field naming the missing capability.

**IndexedDB is required.** If it is absent (for example, in private-browsing mode in certain browsers, or in a Node.js environment), `VectorDatabase` throws immediately in its constructor. There is no fallback.

**Web Workers, WebGPU, and WebAssembly are optional.** Their absence is handled gracefully:

```typescript
import { WorkerPool } from 'vector-frankl/workers';
import { BrowserSupportError } from 'vector-frankl/errors';

let pool: WorkerPool | null = null;
try {
  pool = new WorkerPool({ maxWorkers: 4 });
  await pool.init();
} catch (error) {
  if (error instanceof BrowserSupportError || error instanceof Error) {
    // Proceed without the worker pool; operations run on the main thread.
    console.warn('Worker pool unavailable, falling back to main thread.', error.message);
    pool = null;
  }
}
```

**WebGPU:** The `WebGPUManager` checks `navigator.gpu` at initialization. If the API is absent or the device returns `null`, it throws an `Error` (not a typed `VectorDatabaseError`) with a message of `'WebGPU is not supported in this browser'`. Catch this and fall back to SIMD or scalar search.

**WebAssembly:** `WASMManager` reports its module as unavailable when no compiled module is configured. The search engine automatically falls back to SIMD or scalar code paths. No application-level catch is required.

---

### Corrupted Data

**Error class:** `TransactionError` (code `TRANSACTION_FAILED`) or a `DOMException` from IndexedDB

**When it occurs:** A stored record cannot be deserialized, an IndexedDB transaction is unexpectedly aborted, or a record's vector data is malformed.

**Recovery:** See [Recovering from Corrupt Storage](#recovering-from-corrupt-storage) above.

**IDB transaction auto-abort:** IndexedDB transactions commit automatically when the event loop is not busy. If any code `await`s a non-IDB promise inside a transaction callback, the transaction may commit before the awaited work completes, causing subsequent operations on that transaction to throw. The library logs a diagnostic message when this occurs:

```
Transaction aborted. IDB transactions auto-commit when the event loop is
yielded…
```

If you extend the library with a custom `onUpgrade` callback or raw `VectorDatabase.transaction()` calls, keep all transaction work synchronous or use IDB request chaining instead of `await`.

---

### Aborted Searches and Batch Operations

**When it occurs:** Callers pass a `VectorAbortSignal` via the `signal` (search) or `abortSignal` (batch write/update) option. When `signal.aborted` is `true` at the start of a batch iteration, the operation stops and throws a `DOMException` with name `'AbortError'` (adapters) or a plain `Error` with message `'Batch operation aborted'` (core storage).

```typescript
const controller = { aborted: false };

// Start a long batch import.
const importPromise = db.addBatch(largeVectorSet, {
  abortSignal: controller,
  onProgress(progress) {
    process.stdout.write(`${progress.completed}/${progress.total}\n`);
  },
});

// Cancel mid-way.
setTimeout(() => {
  controller.aborted = true;
}, 2000);

try {
  await importPromise;
} catch (error) {
  if (error instanceof DOMException && error.name === 'AbortError') {
    // Handle caller-initiated abort.
  } else if (error instanceof Error && error.message.includes('aborted')) {
    // Handle storage-layer abort.
  } else {
    throw error;
  }
}
```

Aborts are cooperative, not preemptive. The abort is checked between individual vector writes, so a single very large write may not see the signal immediately.

---

### Timeout Errors

**When it occurs:** Worker pool tasks that exceed the configured `timeout` (default: 30 seconds) reject with `Error: Task timeout after <N>ms`. This applies to any task dispatched through `WorkerPool.executeTask()`.

**Recovery:**

```typescript
import { WorkerPool } from 'vector-frankl/workers';

const pool = new WorkerPool({ timeout: 60_000 }); // 60-second timeout
await pool.init();

try {
  const result = await pool.executeTask({
    taskId: crypto.randomUUID(),
    operation: 'search',
    data: payload,
  });
} catch (error) {
  if (error instanceof Error && error.message.startsWith('Task timeout')) {
    // The worker is still running; wait for pool.terminate() before
    // reinitializing to avoid orphaned workers.
    await pool.terminate();
    // Reinitialize and retry with a smaller batch or longer timeout.
  }
}
```

**Tuning timeouts:** The default 30-second timeout is generous for most operations. If you are searching across very large indexes (>1 million vectors) with a worker pool, increase `timeout` proportionally. Do not set an arbitrarily large timeout to avoid diagnosing a real hang.

---

### Worker Failures

**When it occurs:**

- `Worker` constructor fails (script not found, CSP blocks worker creation) — `WorkerPool.init()` logs a warning per worker. If zero workers are created, `init()` throws `Error: 'Failed to create any workers'`.
- A worker crashes at runtime — the `onerror` handler on the worker object rejects the active task with the worker's error message.
- A worker becomes unresponsive — the task timeout fires (see [Timeout Errors](#timeout-errors)).

**Recovery after init failure:**

```typescript
import { WorkerPool } from 'vector-frankl/workers';

let pool: WorkerPool | null = null;

try {
  pool = new WorkerPool({ maxWorkers: navigator.hardwareConcurrency || 4 });
  await pool.init();
} catch {
  // Fall back to single-threaded search on the main thread.
  pool = null;
}
```

**Recovery after a worker crash:**

The pool removes crashed workers automatically. If the pool drops below one active worker, subsequent `executeTask` calls will queue and block until `terminate()` is called. Call `terminate()` and then `init()` again to restart the pool:

```typescript
await pool.terminate();
await pool.init();
```

---

### WebGPU Failures

**When it occurs:**

- `navigator.gpu` is `undefined` (unsupported browser or non-secure context) — `WebGPUManager.init()` throws `Error: 'WebGPU is not supported in this browser'`.
- `navigator.gpu.requestAdapter()` returns `null` — `init()` throws `Error: 'Failed to get WebGPU adapter'`.
- The GPU device is lost at runtime (driver crash, device reset) — the `GPUDevice.lost` promise resolves and the `WebGPUManager` becomes non-functional until `cleanup()` and `init()` are called again.
- A compute shader encounters an uncaptured GPU error — logged via `log.error` with the error string.
- An unsupported distance metric is requested — `Error: 'Unsupported distance metric for GPU: <metric>'`.

**Recovery:**

```typescript
import { WebGPUManager } from 'vector-frankl/gpu';

const gpu = new WebGPUManager({ powerPreference: 'high-performance' });

try {
  await gpu.init();
} catch (error) {
  // WebGPU unavailable — the search engine falls back to SIMD/scalar.
  console.warn('WebGPU unavailable:', (error as Error).message);
}

// If the device is lost mid-session, reinitialize:
async function reinitializeGPU(manager: WebGPUManager): Promise<void> {
  await manager.cleanup();
  await manager.init();
}
```

**Important:** WebGPU requires a [secure context](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts) (`https://` or `localhost`). Plain `http://` origins will not have `navigator.gpu`.

---

### WebAssembly Failures

**When it occurs:**

- `WebAssembly` is not available in the runtime — `WASMManager.init()` detects this during capability probing and sets `supported: false`. No error is thrown; the library falls back to SIMD/scalar implementations silently.
- No compiled module is configured (`modulePath` is empty, the default) — `init()` logs a debug message and returns without loading a module. All WASM operation calls will throw `Error: 'WebAssembly not available'` until a module is provided.
- Memory allocation fails — `allocateMemory()` throws `Error: 'Failed to allocate WASM memory: …'`.
- Vector dimension mismatch in a WASM operation — throws `Error: 'Vector dimensions must match'`.

**Recovery:**

The library does not require WebAssembly. If `WASMManager.getCapabilities().supported` is `false`, the search engine routes all operations through SIMD or scalar code with no action required from your application.

If you integrate your own compiled WASM module and it fails to load:

```typescript
import { WASMManager } from 'vector-frankl/wasm';

const wasm = new WASMManager({ enableWASM: true, modulePath: '/wasm/vectors.wasm' });

try {
  await wasm.init();
} catch (error) {
  console.error('WASM module failed to load:', (error as Error).message);
  // Fall back to SIMD or scalar operations.
}
```

---

### Adapter Connectivity Failures

This section covers the server-side adapters (Redis, S3, LevelDB, SQLite, LMDB) and the browser-only Chrome extension adapter. IndexedDB, OPFS, and in-memory adapters do not have connectivity concerns.

#### Redis adapter

The `RedisStorageAdapter` wraps Bun's built-in Redis client. Connection failures surface as runtime errors from the underlying client when an operation is first attempted (the adapter connects lazily, not at `init()` time).

```typescript
import { RedisStorageAdapter } from 'vector-frankl/adapters/redis';
import { VectorDB } from 'vector-frankl';

const db = new VectorDB('my-vectors', 384, {
  adapter: new RedisStorageAdapter({ url: 'redis://localhost:6379', prefix: 'vf' }),
});

await db.init(); // Does not connect to Redis.

try {
  await db.addVector('id', vector); // Connects here.
} catch (error) {
  // Redis unavailable — inspect error.message for connection details.
  console.error('Redis connection failed:', (error as Error).message);
}
```

If Redis becomes unreachable mid-session, each operation will throw. Implement a reconnect strategy at the application level (for example, exponential backoff with a cap of five retries).

#### S3 adapter

The `S3StorageAdapter` calls the AWS S3 API on every read and write. Network or authentication failures propagate as thrown errors from the adapter methods.

```typescript
import { S3StorageAdapter } from 'vector-frankl/adapters/s3';

const adapter = new S3StorageAdapter({
  bucket: 'my-bucket',
  prefix: 'vectors/',
  region: 'us-east-1',
});
```

Transient S3 failures (network timeouts, throttling) should be retried at the application level. The adapter does not implement automatic retry logic.

#### LevelDB / LMDB adapters

Both adapters open a local file-based database. If the file path is invalid, the directory does not exist, or the process lacks write permission, `init()` throws an error from the underlying LevelDB or LMDB driver.

#### Chrome extension adapter

The `ChromeStorageAdapter` uses `chrome.storage.local`. If the extension context is invalidated (the extension is reloaded or disabled mid-session), subsequent calls throw `Error: 'Extension context invalidated'`. Detect this by catching errors and checking the message:

```typescript
try {
  await db.addVector('id', vector);
} catch (error) {
  const msg = (error as Error).message ?? '';
  if (msg.includes('Extension context invalidated')) {
    // The extension was reloaded. Prompt the user to refresh the tab.
  }
}
```

---

### Blocked IndexedDB Upgrades

**When it occurs:** When Vector Frankl tries to open a higher database version (triggered by a package upgrade that bumps the schema version), IndexedDB fires the `onblocked` event if another tab or window already has the database open at the old version. The library rejects the `init()` promise with:

```
DatabaseInitializationError: Database upgrade blocked by other connections
```

Similarly, `VectorDatabase.delete()` (called by `destroy()`) fires `onblocked` when another tab holds an open connection, rejecting with:

```
DatabaseInitializationError: Database deletion blocked by other connections
```

**Recovery:**

The most reliable solution is to close all connections before the new version attempts to open. Coordinate this with a page reload or a service-worker lifecycle event:

```typescript
// Existing tabs: listen for a versionchange event.
// The library sets up a versionchange handler in setupEventHandlers(),
// but you can add your own logic at the application level.
indexedDB.open('my-vectors', 1).onsuccess = (event) => {
  const db = (event.target as IDBOpenDBRequest).result;
  db.onversionchange = () => {
    db.close(); // Release the connection so the upgrade can proceed.
    window.location.reload(); // Or show a "please refresh" toast.
  };
};
```

If you control the application lifecycle (for example, a PWA with a service worker), use a `message` event to notify all tabs before the new worker activates:

```typescript
// In the service worker activate handler:
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window' });
      for (const client of clients) {
        client.postMessage({ type: 'CLOSE_DB' });
      }
      await self.clients.claim();
    })(),
  );
});

// In each app tab:
navigator.serviceWorker.addEventListener('message', async (event) => {
  if (event.data?.type === 'CLOSE_DB') {
    await db.close();
  }
});
```

> [!NOTE] The `onblocked` event is not an error in the traditional sense—it means the upgrade is waiting, not that it has failed. Once all tabs close their connections, IndexedDB will automatically complete the blocked upgrade. If you cannot coordinate tab closures, consider implementing a "please close other tabs to continue" UI.
