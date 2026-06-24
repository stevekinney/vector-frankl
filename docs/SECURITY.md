# Security Guide

Vector Frankl is designed with security as a core principle. This document covers the library's security features, the public APIs you interact with, the underlying threat model, and best practices for safe usage.

## Table of Contents

- [Threat Model](#threat-model)
- [Input Validation](#input-validation)
- [ReDoS Protection](#redos-protection)
- [Memory Safety](#memory-safety)
- [WASM Security](#wasm-security)
- [Error Handling](#error-handling)
- [Storage Security](#storage-security)
- [Encryption at Rest](#encryption-at-rest)
- [Best Practices](#best-practices)
- [Security Checklist](#security-checklist)
- [Reporting Security Issues](#reporting-security-issues)

## Threat Model

### What the library protects against

Vector Frankl's security controls target threats that arise within an application that uses the library:

- **Malformed or oversized inputs.** All public methods on `VectorDB` and `VectorFrankl` validate IDs, dimensions, and metadata before any storage operation runs. Oversized vectors, deeply nested metadata, and strings that exceed length limits are rejected before reaching the index or database.
- **Catastrophic regex backtracking (ReDoS).** Metadata filter expressions that contain known-dangerous regex patterns (nested quantifiers, catastrophic alternation, high complexity scores) are rejected at filter compilation time before any string matching occurs. Input strings passed to regex filters are also length-checked.
- **Memory exhaustion from vector data.** Vector dimensions are bounded at 100,000 and per-vector memory at 512 MB. Operations that would exceed these limits throw before allocation.
- **Prototype pollution through metadata.** The metadata validator rejects keys that would mutate `Object.prototype` (e.g., `__proto__`, `constructor`, `prototype`).
- **WASM module substitution.** WebAssembly modules are checked for magic number, version byte, and size limits before compilation.
- **Sensitive data leakage in error context.** `VectorDatabaseError` and its subclasses strip keys like `password`, `token`, `secret`, `auth`, and `credential` from error context before the object is serialized or logged.

### What the library does NOT protect against

These are out-of-scope threats you must address at the application layer:

- **Plaintext browser storage.** IndexedDB, OPFS, and in-memory storage do not encrypt data at rest. Any JavaScript running in the same origin—including injected scripts—can open the same IndexedDB database and read every stored vector and metadata record. If vectors encode sensitive embeddings (health, financial, biometric), you must encrypt the data before storing it with this library.
- **Same-origin access.** The browser's same-origin policy is the only isolation boundary between your application's IndexedDB data and other code running at the same origin. Subdomain sharing, `document.domain` relaxation, or postMessage bridges can all widen that boundary beyond what this library can control.
- **Cross-site scripting (XSS).** If an attacker can execute arbitrary JavaScript in your application's origin, they can call every public method in this library with attacker-controlled inputs. Input validation will reject structurally invalid inputs, but a valid vector crafted to encode adversarial content is not detectable. Defense against XSS is a Content Security Policy and output encoding concern, not a database concern.
- **Server adapter credentials.** The Redis, S3, SQLite, LevelDB, and LMDB adapters require connection credentials (URLs, access keys, passwords). The library passes those credentials to the underlying driver and does not store or log them, but it cannot protect credentials that are embedded in client-side code or transmitted over an unencrypted channel. Keep adapter credentials server-side; do not bundle them into browser builds.
- **Local file access via file-system adapter.** The file-system adapter reads and writes files at paths you supply. The library validates that arguments are strings, but it does not enforce path sandboxing. A path traversal sequence in an application-constructed path can reach files outside the intended directory.
- **Untrusted metadata filters.** The metadata filter compiler (`MetadataFilterCompiler`) rejects patterns with known-dangerous structure, but it is not a security sandbox. Do not pass metadata filter expressions that were composed from untrusted user input without sanitizing them at the application layer first. A filter that passes the structural check can still be expensive to evaluate on large result sets.
- **Denial of service at the application layer.** The library enforces per-operation limits (vector count, batch sizes, metadata depth), but it does not implement rate limiting or per-user quotas. Applications that expose vector search over a network should add their own rate limiting.

## Input Validation

All public methods on `VectorDB` and `VectorFrankl` perform validation internally before processing. The validation logic is an implementation detail—you do not need to call it directly. These are the constraints enforced:

### Vector IDs

- Must be a non-empty string
- Maximum 255 characters
- No control characters (`\x00`–`\x1f`), path separators, or shell-special characters

### Dimensions

- Must be a positive integer
- Maximum 100,000

### Metadata

- Must be a plain object (not an array)
- Maximum 1,000 top-level keys
- Key names must not start with `__`, contain `..`, or contain `/`
- Maximum object nesting depth: 10
- String values capped at 10,000 characters
- Array values capped at 10,000 elements

### Error behavior

Validation failures throw typed errors from the public error hierarchy. Catch `VectorDatabaseError` (the base class) to handle any validation failure:

```typescript
import {
  VectorDB,
  VectorDatabaseError,
  DimensionMismatchError,
  isVectorDatabaseError,
} from 'vector-frankl';

try {
  await db.addVector('', embedding, { category: 'AI' }); // empty ID
} catch (error) {
  if (isVectorDatabaseError(error)) {
    console.error(error.code, error.message);
    // error.context is already sanitized
  }
}
```

## ReDoS Protection

### How it works

The metadata filter system guards against ReDoS at two points:

**Pattern rejection at filter compilation time.** When a `$regex` operator appears in a filter, `MetadataFilterCompiler.compile()` checks the pattern for known-dangerous structures before constructing the `RegExp` object:

- Nested quantifiers: `(.*)+`, `(.+)*`, `(a+)+`
- Alternation in quantified groups: `(foo|bar)+`
- High overall pattern complexity score (quantifier count × group count × alternation count)

Patterns that fail this check cause the search call to throw rather than compile the regex.

**Input length limits.** Metadata string values are capped at 10,000 characters by the input validator, so the worst-case input length for any regex match is bounded regardless of the pattern.

> [!NOTE] No runtime timeout
> The library does not interrupt regex execution mid-run. Protection is entirely preventive: dangerous patterns are rejected before the `RegExp` is constructed, and input lengths are bounded. There is no mid-execution timeout or abort mechanism.

### Safe and unsafe patterns

```typescript
// Safe: simple, anchored, bounded
{
  name: {
    $regex: /^user_\d+$/;
  }
}
{
  category: {
    $regex: /^(news|blog|docs)$/;
  }
}
{
  path: {
    $regex: /\.json$/i;
  }
}

// Rejected: nested quantifiers, catastrophic backtracking
{
  name: {
    $regex: /(a+)+b/;
  }
}
{
  text: {
    $regex: /(\w+\s*)+$/;
  }
}
{
  data: {
    $regex: /(.*)*x/;
  }
}
```

## Memory Safety

### Vector size limits

The following limits are enforced before any vector is stored or indexed:

| Limit                     | Value   |
| ------------------------- | ------- |
| Maximum dimensions        | 100,000 |
| Maximum memory per vector | 512 MB  |

Exceeding either limit throws a `VectorDatabaseError` before the allocation is attempted.

### Batch operations

`addBatch()` processes items in adaptive chunks based on available heap. The batch size is calculated internally; you do not need to tune it for memory safety. If a single item in the batch fails validation, the batch throws a `BatchOperationError` that identifies the failing index.

### Quota monitoring

Use `StorageQuotaMonitor` to track IndexedDB quota and receive warnings before the database fills:

```typescript
import { StorageQuotaMonitor } from 'vector-frankl';

const monitor = StorageQuotaMonitor.getInstance();

monitor.onWarning((warning) => {
  console.warn(`Storage ${warning.type}: ${warning.usageRatio * 100}% used`);
  // warning.type is 'warning' | 'critical' | 'emergency'
});

const estimate = await monitor.getEstimate();
// estimate.usage / estimate.quota gives bytes used vs. total quota
```

### Eviction

When quota pressure is high, `EvictionManager` removes low-priority vectors according to a configurable policy:

```typescript
import { VectorDB, EvictionManager, LRUEvictionPolicy } from 'vector-frankl';

const db = new VectorDB('my-vectors', 384);
await db.init();

const eviction = new EvictionManager(db.adapter, new LRUEvictionPolicy(), {
  strategy: 'lru',
  targetBytes: 100 * 1024 * 1024, // free until under 100 MB
});

const result = await eviction.evict();
// result.evictedCount and result.freedBytes report what was removed
```

## WASM Security

> [!NOTE] Implementation detail
> WASM module validation is performed internally by the WASM subsystem before any module is compiled. The validator class is not part of the public API surface.

When a WASM module is loaded, the following checks run automatically:

- **Magic number**: bytes 0–3 must be `00 61 73 6D`
- **Version**: bytes 4–7 must be `01 00 00 00`
- **Size limit**: module must be under 10 MB
- **Suspicious patterns**: known shellcode and memory-stomping byte sequences are checked

If any check fails, `BrowserSupportError` is thrown before the module is compiled.

## Error Handling

### Error hierarchy

All errors thrown by public methods extend `VectorDatabaseError`. Import the specific subclasses you want to catch:

```typescript
import {
  VectorDatabaseError,
  DimensionMismatchError,
  QuotaExceededError,
  VectorNotFoundError,
  InvalidFormatError,
  NamespaceExistsError,
  NamespaceNotFoundError,
  DatabaseInitializationError,
  TransactionError,
  BatchOperationError,
  IndexError,
  BrowserSupportError,
  isVectorDatabaseError,
} from 'vector-frankl';
```

### Secure error context

`VectorDatabaseError` automatically sanitizes the `context` object before exposing it:

- Keys matching `password`, `token`, `secret`, `key`, `auth`, or `credential` (case-insensitive) are replaced with `[REDACTED]`
- String values longer than 1,000 characters are truncated

The sanitized context is safe to log or include in a response object. The raw original context is never exposed.

### Handling errors safely

```typescript
try {
  await db.addVector(id, vector, metadata);
} catch (error) {
  if (error instanceof DimensionMismatchError) {
    // Wrong vector length for this database
    return { error: 'Dimension mismatch', expected: error.context?.expected };
  }

  if (error instanceof QuotaExceededError) {
    // Storage is full — trigger eviction or inform the user
    return { error: 'Storage full' };
  }

  if (isVectorDatabaseError(error)) {
    // Catch-all for other library errors
    logger.error({ code: error.code, message: error.message, context: error.context });
    return { error: 'Operation failed' };
  }

  throw error; // Re-throw unexpected errors
}
```

## Storage Security

### Plaintext data at rest

**All storage adapters write plaintext.** IndexedDB, OPFS, the in-memory adapter, and every server-side adapter (Redis, S3, SQLite, LevelDB, LMDB, file system) store vector data without encryption. Assume that any party with filesystem or database access can read every vector and metadata value.

If your application stores sensitive embeddings—medical, financial, biometric, or personally identifying—you are responsible for encrypting the data before passing it to this library.

### Same-origin isolation (browser adapters)

Browser adapters (IndexedDB, OPFS, Chrome storage) are isolated by the browser's same-origin policy. Data stored at `https://example.com` is not accessible to `https://other.com`. However:

- Any JavaScript that runs at your origin—including third-party scripts loaded via `<script>` tags—shares the same origin and can open the same databases.
- Content Security Policy is your primary defense against untrusted scripts. This library cannot enforce CSP on your behalf.

### Server adapter credentials

The Redis, S3, SQLite, LevelDB, and LMDB adapters require connection URLs or credentials at construction time:

```typescript
import { RedisStorageAdapter } from 'vector-frankl/adapters/redis';

// ❌ Do not include credentials in browser bundles
const adapter = new RedisStorageAdapter({ url: 'redis://user:password@host:6379' });

// ✅ Keep credentials server-side; inject via environment variables on the server
const adapter = new RedisStorageAdapter({ url: process.env.REDIS_URL });
```

The library passes credentials to the underlying driver and does not log or persist them, but credentials embedded in browser bundles are visible to anyone who inspects the bundle.

## Encryption at Rest

**Vector Frankl does not encrypt stored data.** All storage backends persist data as plaintext. The table below is the authoritative statement of encryption-at-rest behavior for every supported backend.

| Backend                                  | Storage mechanism                | Encrypted at rest             | Notes                                                                                                                                         |
| ---------------------------------------- | -------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| IndexedDB                                | Browser-managed key/value store  | **No — plaintext**            | Accessible to any same-origin script; readable by the browser vendor and OS-level processes with device access                                |
| OPFS (Origin Private File System)        | Browser-managed file system      | **No — plaintext**            | Scoped to origin but not encrypted; readable by browser internals and OS-level processes                                                      |
| Chrome Storage (`chrome.storage`)        | Extension storage API            | **No — plaintext**            | Accessible to the extension and potentially to Chrome profile sync; subject to Google account access                                          |
| File system (`FileSystemStorageAdapter`) | JSON files on disk               | **No — plaintext**            | Standard OS file permissions apply; no application-level encryption                                                                           |
| SQLite (`SQLiteStorageAdapter`)          | `.db` file on disk               | **No — plaintext**            | Standard OS file permissions apply; readable by any process with file access                                                                  |
| Redis (`RedisStorageAdapter`)            | In-memory + optional persistence | **No — plaintext**            | Data is plaintext in memory and in RDB/AOF files; requires transport-layer encryption (TLS) and authentication to be configured separately    |
| S3 (`S3StorageAdapter`)                  | Object storage                   | **No — plaintext by default** | S3 server-side encryption (SSE-S3, SSE-KMS, SSE-C) must be enabled on the bucket independently; Vector Frankl does not configure or verify it |
| In-memory (`MemoryStorageAdapter`)       | JavaScript `Map`                 | **No — plaintext**            | Process memory only; not persisted across restarts                                                                                            |
| LevelDB (`LevelStorageAdapter`)          | LevelDB files on disk            | **No — plaintext**            | Standard OS file permissions apply                                                                                                            |
| LMDB (`LmdbStorageAdapter`)              | LMDB memory-mapped files on disk | **No — plaintext**            | Standard OS file permissions apply                                                                                                            |

### Optional encryption

Vector Frankl does not provide built-in encryption. If your application requires encryption at rest, you must implement it externally before passing data to any storage adapter—for example, encrypting vector payloads and metadata values with the Web Crypto API before insertion and decrypting after retrieval. Vector Frankl makes no assertions about the confidentiality of stored content.

## Best Practices

### Validate inputs before calling the library

The library validates every public method argument, but the error messages are oriented toward developers, not end users. If you surface errors to users, catch `VectorDatabaseError` and return a generic message:

```typescript
// ❌ Surfaces internal detail to users
const id = req.body.id; // could be empty, too long, or contain control chars
await db.addVector(id, vector);

// ✅ Validate at the boundary, return user-appropriate errors
import { isVectorDatabaseError } from 'vector-frankl';

try {
  await db.addVector(req.body.id, vector, req.body.metadata);
} catch (error) {
  if (isVectorDatabaseError(error)) {
    return res.status(400).json({ error: 'Invalid input' });
  }
  return res.status(500).json({ error: 'Internal error' });
}
```

### Use safe metadata filter patterns

Do not pass metadata filter expressions constructed from untrusted user input without sanitizing them first. If users can specify filter values, accept only specific field names and value types—do not pass a raw `$regex` from user input:

```typescript
// ❌ Passes raw user-supplied regex to the filter compiler
const results = await db.search(query, 10, {
  filter: { name: { $regex: new RegExp(req.query.pattern) } },
});

// ✅ Accept structured values; never accept user-supplied patterns
const allowedCategory = validateEnum(req.query.category, ['news', 'blog', 'docs']);
const results = await db.search(query, 10, {
  filter: { category: allowedCategory },
});
```

### Monitor quota before bulk operations

Check storage quota before large ingestion jobs to avoid `QuotaExceededError` mid-batch:

```typescript
import { StorageQuotaMonitor } from 'vector-frankl';

const monitor = StorageQuotaMonitor.getInstance();
const estimate = await monitor.getEstimate();

if (estimate.usageRatio > 0.8) {
  throw new Error('Insufficient storage quota for bulk operation');
}

await db.addBatch(vectors);
```

### Handle errors and avoid leaking stack traces

Always wrap database operations and avoid surfacing stack traces to end users:

```typescript
try {
  await db.search(queryVector, 10);
} catch (error) {
  if (isVectorDatabaseError(error)) {
    // Safe to log — context is sanitized
    logger.error({ code: error.code, context: error.context });
    return { results: [], error: 'Search failed' };
  }
  // Unknown error — log internally, return generic message
  logger.error({ error: String(error) });
  return { results: [], error: 'Internal error' };
}
```

## Security Checklist

### Pre-deployment

- [ ] All inputs validated using `InputValidator`
- [ ] Regex patterns tested for ReDoS vulnerabilities
- [ ] Memory limits configured appropriately
- [ ] WASM modules validated before loading
- [ ] Error messages don't leak sensitive information
- [ ] Storage quotas monitored
- [ ] Rate limiting implemented
- [ ] Security headers configured (for web deployment)
- [ ] Vectors containing sensitive data are encrypted before storage (Vector Frankl stores plaintext; see [Encryption at Rest](#encryption-at-rest))
- [ ] For Redis: TLS and authentication configured at the infrastructure level
- [ ] For S3: server-side encryption (SSE) enabled on the bucket independently of Vector Frankl
- [ ] Metadata filter patterns are validated before being passed to search
- [ ] Server adapter credentials are not bundled in browser builds
- [ ] Content Security Policy is configured to prevent unauthorized script execution
- [ ] Application error responses return generic messages, not raw error details
- [ ] Quota monitoring is set up for production IndexedDB deployments
- [ ] File-system adapter paths are constructed from an allowlist, not from user input

### Ongoing

- [ ] Review metadata filter patterns whenever filter logic changes
- [ ] Monitor storage quota trends and configure eviction before limits are hit
- [ ] Keep the library up to date — check the CHANGELOG for security-related updates
- [ ] Run `bun run lint` and `bun run typecheck` in CI to catch type-safety regressions

## Reporting Security Issues

If you discover a security vulnerability in Vector Frankl, please report it responsibly:

1. **Do not** open a public issue
2. Email security concerns to: security@vector-frankl.dev
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

We aim to respond within 48 hours and will work with you to understand and address the issue.

## Additional Resources

- [OWASP Secure Coding Practices](https://owasp.org/www-project-secure-coding-practices-quick-reference-guide/)
- [ReDoS Prevention](https://owasp.org/www-community/attacks/Regular_expression_Denial_of_Service_-_ReDoS)
- [WebAssembly Security](https://webassembly.org/docs/security/)
- [IndexedDB Security](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)
