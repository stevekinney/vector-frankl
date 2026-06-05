# Roadmap

**Production readiness verdict:** Vector Frankl is not ready for a production
release yet. The library has a promising beta foundation and the current local
quality gates pass, but several public claims are ahead of the implementation.
The biggest blockers are index consistency, package/export contract drift,
placeholder acceleration code, incomplete search option semantics, storage
adapter maturity, and missing release-grade verification.

Do not publish a stable production release until every required item below is
complete and the verification commands pass in a clean checkout.

## Audit Baseline

The production-readiness audit used these checks as the baseline:

- `bun --version` returned `1.3.13`.
- `bun run typecheck` passed.
- `bun run lint` passed.
- `bun run format:check` passed.
- `bun run build` passed and produced `dist/` plus CommonJS output.
- `bun run test` passed across the configured unit, integration, search,
  vector, WebAssembly, worker, GPU, debug, compression, and storage groups.
- `bun run test:coverage` passed, but it did not leave a durable
  `coverage/lcov.info` or enforce a production-grade aggregate threshold.
- `bun run test:end-to-end:chromium` passed with `32 passed`.
- `npm pack --dry-run --json --ignore-scripts` produced a package containing
  `dist/`, `README.md`, `CHANGELOG.md`, `LICENSE`, and `package.json`.
- Node import smoke checks passed for the declared package export map:
  `.`, `./gpu`, `./workers`, `./debug`, `./benchmarks`, and `./compression`.
- CommonJS `require()` smoke checks passed for the same declared exports.
- Public README examples that import `vector-frankl/src/...` failed package
  export-map validation because those subpaths are not exported.
- Targeted executable checks confirmed that indexed databases can return
  stale results after `clear()`, `updateMetadata()`, and `updateBatch()`.

## Release Completion Gate

- [ ] Define a single production release command that runs every required gate
      from a clean checkout.

  Acceptance: one documented command fails when any required type, lint,
  formatting, test, coverage, package, export-map, browser, or benchmark gate
  fails.

  Verification: `bun run verify:production`

- [ ] Add a clean-checkout verification script that removes build artifacts,
      reinstalls dependencies with Bun, runs the production gate, packs the package,
      installs the tarball into temporary ESM and CommonJS consumers, and imports
      every documented public entrypoint.

  Acceptance: the script does not rely on existing local `dist/`, global
  packages, or untracked generated files.

  Verification: `bun run verify:package-consumers`

- [ ] Update `prepublishOnly` or an equivalent release-only script so publishing
      cannot happen without the full production gate.

  Acceptance: `prepublishOnly` includes linting, type checking, formatting,
  tests, aggregate coverage, end-to-end browser tests, package-consumer smoke
  tests, and export-map checks.

  Verification: `bun run prepublishOnly`

## Core Correctness

- [ ] Fix indexed `clear()` so it removes every indexed node and persisted index
      entry before returning.

  Acceptance: after `clear()`, `count()` is zero, `getIndexStats().nodeCount` is
  zero, and `search()` returns no results with indexing enabled and disabled.

  Verification: `bun test tests/unit/core/database.test.ts tests/search`

- [ ] Add a regression test proving `clear()` cannot return stale vectors from
      an HNSW index.

  Acceptance: the test fails against the audited implementation and passes after
  the index is cleared.

  Verification: `bun test tests/unit/core/database.test.ts -t clear`

- [ ] Fix `updateMetadata()` so the search index returns current metadata.

  Acceptance: `search(query, k, { includeMetadata: true })` returns the updated
  metadata immediately after `updateMetadata()` when indexing is enabled.

  Verification: `bun test tests/unit/core/database.test.ts -t updateMetadata`

- [ ] Add input validation to `updateMetadata()` for vector ID and metadata.

  Acceptance: invalid IDs, prototype-pollution keys, oversized metadata, invalid
  numbers, functions, and excessive nesting are rejected before storage writes.

  Verification: `bun test tests/unit/core/input-validator.test.ts tests/unit/core/database.test.ts -t updateMetadata`

- [ ] Fix `updateBatch()` so vector and metadata updates keep the index
      synchronized.

  Acceptance: batch-updated vectors search from their new coordinates, stale
  coordinates no longer rank as if unchanged, and included metadata is current.

  Verification: `bun test tests/unit/core/database.test.ts tests/search -t updateBatch`

- [ ] Add input validation to `updateBatch()` for duplicate IDs, invalid IDs,
      metadata, dimensions, and batch size before any partial writes occur.

  Acceptance: invalid batch input is rejected atomically and does not mutate
  storage or the index.

  Verification: `bun test tests/unit/core/database.test.ts tests/unit/core/input-validator.test.ts -t batch`

- [ ] Validate `exists(id)` with the same vector ID rules used by `getVector()`,
      `deleteVector()`, and `updateVector()`.

  Acceptance: malformed IDs are rejected consistently across all public ID-based
  methods.

  Verification: `bun test tests/unit/core/database.test.ts -t exists`

- [ ] Validate `searchRange()` inputs before search execution.

  Acceptance: query vector format, vector dimension, maximum distance, filters,
  result limits, timeout, and abort signal are validated consistently with
  `search()`.

  Verification: `bun test tests/unit/core/database.test.ts tests/search -t searchRange`

- [ ] Validate `searchStream()` inputs before streaming starts.

  Acceptance: invalid query vectors and options throw before the first yielded
  batch, and valid options are passed through with typed semantics.

  Verification: `bun test tests/unit/core/database.test.ts tests/search -t searchStream`

- [ ] Rebuild or invalidate the index when `setDistanceMetric()` changes the
      metric.

  Acceptance: changing the metric cannot leave an empty, stale, or old-metric
  HNSW index behind.

  Verification: `bun test tests/search tests/unit/core/database.test.ts -t distance`

- [ ] Define atomicity semantics for every multi-vector write method.

  Acceptance: `addBatch()`, `updateBatch()`, and `deleteMany()` document whether
  they are all-or-nothing or partial-success operations, and tests assert the
  chosen behavior for storage and index state.

  Verification: `bun test tests/storage tests/unit/core/database.test.ts -t batch`

- [ ] Make storage mutation and index mutation failure handling explicit.

  Acceptance: if index updates fail after storage writes, the method either
  rolls back storage, marks the index dirty and rebuilds before future indexed
  search, or disables indexed search until recovery completes.

  Verification: `bun test tests/search tests/unit/core/database.test.ts -t index`

- [ ] Add invariants that compare storage state and index state after every
      public mutation in test builds.

  Acceptance: tests can detect missing, stale, duplicated, or deleted index
  entries after `addVector()`, `addBatch()`, `deleteVector()`, `deleteMany()`,
  `clear()`, `updateVector()`, `updateMetadata()`, and `updateBatch()`.

  Verification: `bun test tests/search tests/integration`

## Search Semantics

- [ ] Implement or remove `SearchOptions.timeout`.

  Acceptance: timeout either aborts every search path within a bounded interval
  or is removed from the public type, documentation, and examples.

  Verification: `bun test tests/search tests/unit/core/database.test.ts -t timeout`

- [ ] Implement or remove `SearchOptions.signal`.

  Acceptance: an aborted `AbortSignal` stops brute-force search, indexed search,
  range search, streamed search, worker search, and GPU fallback search, or the
  option is removed from the public contract.

  Verification: `bun test tests/search tests/workers tests/gpu -t abort`

- [ ] Define and enforce `SearchOptions` as a closed, typed public contract.

  Acceptance: unknown option keys are rejected or explicitly captured in a typed
  extension point; they are not silently passed through unvalidated.

  Verification: `bun test tests/unit/core/input-validator.test.ts -t validateSearchOptions`

- [ ] Reconcile `FilterOperator` with `MetadataFilterCompiler`.

  Acceptance: the public TypeScript type, runtime compiler, README, API
  documentation, and tests support the exact same operators.

  Verification: `bun test tests/search/metadata-filter.test.ts && bun run typecheck`

- [ ] Either implement `$contains` and `$between` or remove them from
      `FilterOperator`.

  Acceptance: every operator in `FilterOperator` has runtime tests and
  documentation examples.

  Verification: `bun test tests/search/metadata-filter.test.ts -t '\\$contains|\\$between'`

- [ ] Add public types for `$exists`, `$type`, `$regex`, `$size`, `$all`, and
      `$elemMatch` if those operators remain supported.

  Acceptance: TypeScript consumers can express every supported filter without
  casts.

  Verification: `bun run typecheck`

- [ ] Add edge-case tests for nested filters and invalid filter shapes.

  Acceptance: invalid `$and`, `$or`, `$not`, operator operands, regex flags, and
  nested object paths fail predictably with sanitized errors.

  Verification: `bun test tests/search/metadata-filter.test.ts`

- [ ] Add indexed or adapter-assisted metadata filtering for large datasets, or
      document the current in-memory filter path as beta-only.

  Acceptance: filtered search does not require `storage.getAll()` for production
  dataset sizes unless the selected adapter explicitly lacks indexing
  capabilities and the fallback is documented.

  Verification: `bun test tests/search tests/storage && bun run scripts/benchmark.ts --full`

- [ ] Define stable score and distance semantics for every distance metric.

  Acceptance: cosine, dot, euclidean, manhattan, hamming, and jaccard have
  documented score ranges, sort order, threshold behavior, and round-trip tests
  across brute-force, HNSW, worker, WebAssembly, and GPU paths.

  Verification: `bun test tests/search tests/vectors tests/workers tests/wasm tests/gpu -t 'distance|score|metric'`

- [ ] Add deterministic tie-breaking for equal scores.

  Acceptance: equal-distance results have a documented stable ordering and do
  not reorder unpredictably across runtimes.

  Verification: `bun test tests/search -t 'tie|stable'`

- [ ] Define exact stream-search ordering, duplication, cancellation, and
      backpressure behavior.

  Acceptance: streamed search never yields duplicate IDs, respects `maxResults`,
  handles cancellation, and documents whether progressive batches are
  approximate or final.

  Verification: `bun test tests/search -t searchStream`

## HNSW Indexing

- [ ] Replace the basic HNSW implementation with a production-quality algorithm
      or explicitly scope it as experimental.

  Acceptance: connection selection, level assignment, search traversal,
  insertion, deletion, and rebuild behavior are documented and tested against
  known HNSW expectations.

  Verification: `bun test tests/search/hnsw-index.test.ts`

- [ ] Add recall benchmarks against brute-force search.

  Acceptance: recall targets are defined per dataset size, vector dimension,
  metric, `m`, and `efConstruction`, and the benchmark fails when recall drops
  below target.

  Verification: `bun run scripts/benchmark.ts --full`

- [ ] Add deletion and update stress tests for HNSW connectivity.

  Acceptance: repeated insert, update, delete, and rebuild cycles preserve
  recall and never return deleted vectors.

  Verification: `bun test tests/search/hnsw-index.test.ts -t 'delete|update|rebuild|recall'`

- [ ] Persist dirty indexes durably before eviction from `IndexCache`.

  Acceptance: dirty index eviction awaits persistence or leaves the dirty entry
  in cache with a retryable error; it cannot drop unsaved changes silently.

  Verification: `bun test tests/search -t IndexCache`

- [ ] Replace rough index storage estimates with byte-accurate measurements.

  Acceptance: index storage usage is measured from serialized data or adapter
  storage metadata, not `nodeCount * 500`.

  Verification: `bun test tests/search -t storage`

- [ ] Add index persistence compatibility tests.

  Acceptance: indexes serialized by the previous supported version can be loaded
  or explicitly rejected with a migration error that explains how to rebuild.

  Verification: `bun test tests/search -t persistence`

- [ ] Add a public index health check.

  Acceptance: consumers can detect dirty, stale, missing, incompatible, or
  rebuilding index state without running a search.

  Verification: `bun test tests/search tests/unit/core/database.test.ts -t health`

## WebAssembly

- [ ] Replace the demo WebAssembly manager with a real compiled WebAssembly
      module, or remove WebAssembly acceleration claims from the production API.

  Acceptance: runtime code no longer creates mock exports whose operations are
  computed in JavaScript while logging "demo mode".

  Verification: `rg -n 'demo mode|For demonstration|mock WASM|In production' src/wasm` returns no production-runtime matches.

- [ ] Add real WebAssembly correctness tests.

  Acceptance: dot product, magnitude, normalization, addition, subtraction, and
  distance operations match the JavaScript reference implementation within
  documented numerical tolerances.

  Verification: `bun test tests/wasm`

- [ ] Add WebAssembly fallback tests.

  Acceptance: unsupported WebAssembly, invalid modules, failed integrity
  validation, memory allocation failures, and runtime traps fall back or fail
  according to documented behavior.

  Verification: `bun test tests/wasm -t 'fallback|invalid|memory|trap'`

- [ ] Implement real WebAssembly module integrity validation.

  Acceptance: published WebAssembly assets are content-addressed or checksummed,
  the expected hash is committed, and tampered modules fail before execution.

  Verification: `bun test tests/wasm -t integrity`

- [ ] Decide how WebAssembly assets are packaged.

  Acceptance: tarball consumers can load the WebAssembly asset in Node, Bun, and
  browser builds without relying on repository source paths.

  Verification: `npm pack --dry-run --json --ignore-scripts && bun run verify:package-consumers`

- [ ] Add WebAssembly performance regression budgets.

  Acceptance: WebAssembly is only advertised when it beats or justifies parity
  with the JavaScript reference for documented vector sizes.

  Verification: `bun run scripts/benchmark.ts --full`

## WebGPU And SIMD

- [ ] Add real-browser WebGPU shader compilation and correctness tests.

  Acceptance: tests run against an actual browser WebGPU implementation when
  available, skip with an explicit capability reason when unavailable, and
  compare GPU results to CPU reference results.

  Verification: `bun run test:end-to-end:chromium -- --grep WebGPU`

- [ ] Keep mock WebGPU tests separate from production correctness tests.

  Acceptance: mock tests only validate control flow; they cannot satisfy the
  production WebGPU correctness gate.

  Verification: `bun test tests/gpu && bun run test:end-to-end:chromium -- --grep WebGPU`

- [ ] Validate WebGPU buffer allocation limits before creating buffers.

  Acceptance: query, vector, metadata, and result buffers are checked against
  adapter limits with useful errors before GPU allocation.

  Verification: `bun test tests/gpu -t 'buffer|limit'`

- [ ] Define supported WebGPU metrics exactly.

  Acceptance: unsupported metrics fail clearly or route through a tested CPU
  path; fallback code cannot silently return placeholder distances.

  Verification: `bun test tests/gpu -t 'metric|fallback'`

- [ ] Add GPU result edge-case tests for zero scores, infinities, NaN input,
      empty candidates, large dimensions, and non-normalized vectors.

  Acceptance: GPU and CPU paths agree or reject invalid input consistently.

  Verification: `bun test tests/gpu tests/end-to-end -t 'edge|NaN|Infinity|zero'`

- [ ] Audit SIMD claims and implementation.

  Acceptance: SIMD support has capability detection, correctness tests,
  fallback tests, and benchmark evidence before it is described as production
  acceleration.

  Verification: `bun test tests/vectors tests/search -t SIMD && bun run scripts/benchmark.ts --full`

## Workers And Shared Memory

- [ ] Replace `SharedMemoryManager.processChunkInWorkers()` with a real worker
      delegation implementation or remove the public path.

  Acceptance: `sharedMemoryBatchSearch()` cannot return an empty result set from
  a placeholder implementation when vectors and queries are present.

  Verification: `bun test tests/workers/shared-memory.test.ts -t batch`

- [ ] Add shared-memory correctness tests against brute-force search.

  Acceptance: shared-memory search matches reference results for multiple
  query counts, vector counts, dimensions, and metrics.

  Verification: `bun test tests/workers/shared-memory.test.ts`

- [ ] Add worker cancellation and timeout behavior.

  Acceptance: worker searches honor `AbortSignal` and timeout semantics, clean
  up pending work, and do not leak workers after cancellation.

  Verification: `bun test tests/workers -t 'abort|timeout|cleanup'`

- [ ] Add worker error propagation tests.

  Acceptance: worker exceptions, serialization errors, and worker startup
  failures produce sanitized, actionable errors at the public API boundary.

  Verification: `bun test tests/workers -t 'error|failure'`

- [ ] Define worker pool lifecycle ownership.

  Acceptance: `close()`, `delete()`, garbage-collection scenarios, and repeated
  initialization all terminate workers and release shared memory predictably.

  Verification: `bun test tests/workers tests/integration -t 'lifecycle|cleanup'`

## Storage Adapters

- [ ] Decide the supported production adapter matrix.

  Acceptance: every adapter is classified as production-supported,
  experimental, or internal-only, with runtime, persistence, concurrency,
  quota, and durability guarantees documented.

  Verification: `bun run typecheck && rg -n 'experimental|production-supported|internal-only' README.md docs`

- [ ] Fix the public export contract for every supported adapter.

  Acceptance: every documented adapter import path is exported by
  `package.json`, has a declaration file, and works from a packed tarball.

  Verification: `bun run build && npm pack --dry-run --json --ignore-scripts && bun run verify:package-consumers`

- [ ] Remove or correct README imports that use `vector-frankl/src/...`.

  Acceptance: no consumer-facing documentation imports from source paths or
  private build output paths.

  Verification: `rg -n 'vector-frankl/src|from [\"'\"']\\.\\.?/src' README.md docs`

- [ ] Export public adapter option types for every supported adapter.

  Acceptance: TypeScript consumers can configure supported adapters without
  relying on internal interfaces.

  Verification: `bun run typecheck && bun run verify:package-consumers`

- [ ] Make direct adapter usage safe or document adapters as low-level.

  Acceptance: direct adapter calls validate IDs, dimensions, metadata, and batch
  sizes, or documentation clearly states that validation only happens through
  `VectorDB` and `VectorFrankl`.

  Verification: `bun test tests/storage tests/unit/core/input-validator.test.ts`

- [ ] Fix `FileSystemStorageAdapter` runtime documentation or implementation.

  Acceptance: it either works in Node and Bun as documented, or the README and
  package metadata state Bun-only support.

  Verification: `bun test tests/storage/adapters/file-system-adapter.test.ts && node -e \"import('vector-frankl')\"` from a packed consumer.

- [ ] Add real SQLite persistence and recovery tests.

  Acceptance: SQLite data survives close/reopen, process restart simulation,
  corrupted rows, large batches, metadata updates, and deletion/index rebuilds.

  Verification: `bun test tests/storage/adapters/sqlite-adapter.test.ts tests/integration`

- [ ] Add real OPFS browser persistence tests.

  Acceptance: OPFS data survives page reloads, multiple database instances,
  binary and JSON formats, quota pressure, and deletion.

  Verification: `bun run test:end-to-end:chromium -- --grep OPFS`

- [ ] Add Chrome extension storage quota and chunking support or document the
      adapter as experimental.

  Acceptance: large vectors and batches either chunk safely within Chrome
  storage limits or fail before partial writes with a clear quota error.

  Verification: `bun test tests/storage/adapters/chrome-storage-adapter.test.ts`

- [ ] Add Redis integration tests against a real Redis service.

  Acceptance: tests cover connection failures, authentication or TLS
  configuration, pipelined batches, concurrent writes, expiration behavior,
  prefix isolation, and cleanup.

  Verification: `bun test tests/storage/adapters/redis-adapter.test.ts --preload tests/storage/redis-integration-setup.ts`

- [ ] Add S3 or MinIO integration tests against a real object store.

  Acceptance: tests cover manifest consistency, concurrent writers, eventual
  consistency behavior, multipart-size payloads, missing objects, retries, and
  cleanup.

  Verification: `bun test tests/storage/adapters/s3-adapter.test.ts --preload tests/storage/s3-integration-setup.ts`

- [ ] Fix S3 multi-writer manifest consistency.

  Acceptance: two adapter instances cannot lose IDs when they write
  concurrently, or the adapter is explicitly documented as single-writer only.

  Verification: `bun test tests/storage/adapters/s3-adapter.test.ts -t concurrent`

- [ ] Add adapter capability metadata.

  Acceptance: each adapter reports persistence, transactions, batch atomicity,
  metadata indexing, quota reporting, concurrent-writer support, and browser or
  server compatibility.

  Verification: `bun test tests/storage -t capability && bun run typecheck`

- [ ] Add storage migration tests for IndexedDB schema changes.

  Acceptance: old schema versions upgrade cleanly, failed upgrades are surfaced
  without silent data loss, and rollback or rebuild instructions are documented.

  Verification: `bun test tests/storage/adapters/indexed-database-adapter.test.ts -t migration`

- [ ] Add corruption detection and repair behavior.

  Acceptance: malformed vector payloads, missing metadata, missing index
  manifests, and partial writes are detected with a documented recovery path.

  Verification: `bun test tests/storage tests/search -t 'corrupt|repair|missing'`

## Browser And Runtime Support

- [ ] Publish a precise runtime support matrix.

  Acceptance: README and API documentation state supported versions for Bun,
  Node, Chrome, Firefox, Safari/WebKit, mobile browsers, WebGPU, OPFS,
  IndexedDB, Chrome extensions, Redis, S3, SQLite, and LMDB if retained.

  Verification: `rg -n 'Runtime Support|Browser Support|Storage Adapter Support' README.md docs`

- [ ] Clarify server-side default behavior.

  Acceptance: Node and Bun examples pass an explicit server-capable storage
  adapter or resolver; default IndexedDB behavior is documented as browser-only.

  Verification: `bun run verify:package-consumers`

- [ ] Run the full Playwright browser matrix before production release.

  Acceptance: Chromium, Firefox, WebKit, mobile Chrome, and mobile Safari pass
  or have documented capability skips for unsupported browser APIs.

  Verification: `bun run test:end-to-end`

- [ ] Add feature detection tests for every optional browser primitive.

  Acceptance: missing IndexedDB, OPFS, WebGPU, WebAssembly, workers,
  SharedArrayBuffer, and Chrome storage produce documented fallbacks or errors.

  Verification: `bun run test:end-to-end && bun test tests/integration`

- [ ] Add cross-origin isolation documentation for `SharedArrayBuffer`.

  Acceptance: shared-memory features document required headers, browser support,
  and fallback behavior.

  Verification: `rg -n 'Cross-Origin-Opener-Policy|Cross-Origin-Embedder-Policy|SharedArrayBuffer' README.md docs`

## Security And Safety

- [ ] Complete input validation coverage for every public API method.

  Acceptance: every public method in `VectorDB`, `VectorFrankl`, namespaces,
  adapters, compression, workers, WebAssembly, and GPU entrypoints validates
  untrusted input or delegates to a validated lower layer with tests.

  Verification: `bun test tests/unit/core/input-validator.test.ts tests/integration`

- [ ] Add a public threat model.

  Acceptance: documentation clearly states what the library protects against
  and what it does not protect against, including browser storage plaintext,
  XSS, same-origin access, server adapter credentials, and local file access.

  Verification: `rg -n 'Threat Model|plaintext|same-origin|credentials' docs README.md`

- [ ] Either implement optional encryption at rest or remove privacy claims that
      imply encrypted local storage.

  Acceptance: data-at-rest behavior is explicit for IndexedDB, OPFS, Chrome
  storage, file system, SQLite, Redis, and S3.

  Verification: `rg -n 'encryption|encrypted|plaintext|at rest' README.md docs`

- [ ] Audit error sanitization across all thrown errors and log paths.

  Acceptance: vector data, metadata values, storage credentials, URLs, database
  names, file paths, S3 keys, Redis URLs, and user-provided regex patterns are
  redacted or intentionally included according to a documented policy.

  Verification: `bun test tests/debug tests/unit/core -t 'sanitize|redact|error'`

- [ ] Add dependency and supply-chain checks to the production gate.

  Acceptance: known-vulnerability checks, license checks, lockfile integrity,
  and packed-file review run before release.

  Verification: `bun run verify:supply-chain`

- [ ] Add ReDoS regression tests for supported regex filters.

  Acceptance: dangerous patterns are rejected before execution and long input
  values cannot hang search.

  Verification: `bun test tests/search/metadata-filter.test.ts -t 'regex|ReDoS'`

- [ ] Add memory exhaustion tests.

  Acceptance: maximum vector dimension, maximum vector memory, batch size,
  worker buffer size, GPU buffer size, WebAssembly memory size, and metadata
  size limits reject unsafe input before allocation.

  Verification: `bun test tests/unit/core/input-validator.test.ts tests/workers tests/gpu tests/wasm -t 'memory|limit'`

## Documentation

- [ ] Rewrite README claims to match implemented, verified behavior.

  Acceptance: performance, WebGPU, SIMD, WebAssembly, storage adapter,
  browser-first, server-side, privacy, and scalability claims each point to
  implemented APIs and verification evidence.

  Verification: `bun run verify:documentation`

- [ ] Add a production-readiness status section to the README.

  Acceptance: beta-only and experimental features are labeled, and stable
  features have clear support guarantees.

  Verification: `rg -n 'Production Readiness|Experimental|Stable' README.md`

- [ ] Update `docs/API.md` to match the current public API exactly.

  Acceptance: every documented method, option, return type, adapter, and import
  path type-checks in documentation examples.

  Verification: `bun run verify:documentation-examples`

- [ ] Add installation and import examples for ESM, CommonJS, Bun, Node, and
      browser bundlers.

  Acceptance: every example is compiled or executed from the packed package.

  Verification: `bun run verify:package-consumers`

- [ ] Add adapter-specific setup guides.

  Acceptance: each supported adapter has setup, runtime requirements, limits,
  persistence guarantees, concurrency guarantees, and cleanup instructions.

  Verification: `rg -n 'IndexedDB|OPFS|Chrome storage|SQLite|Redis|S3|File system' README.md docs`

- [ ] Add a migration and upgrade guide.

  Acceptance: consumers know how to move between package versions, rebuild
  indexes, migrate storage schemas, and recover from incompatible index
  persistence versions.

  Verification: `rg -n 'Migration|Upgrade|Rebuild Index|Schema' README.md docs`

- [ ] Add failure-mode documentation.

  Acceptance: quota errors, unsupported runtime APIs, corrupted data, aborted
  searches, timeout errors, worker failures, WebGPU failures, WebAssembly
  failures, and storage connectivity failures are documented.

  Verification: `rg -n 'Quota|Unsupported|Corrupt|Abort|Timeout|Worker|WebGPU|WebAssembly' README.md docs`

- [ ] Add API examples that do not rely on placeholder data as production
      guidance.

  Acceptance: examples use realistic names and explain omitted concerns such as
  embedding generation, persistence choice, index rebuilding, and error
  handling.

  Verification: `bun run verify:documentation-examples`

## Testing And Coverage

- [ ] Make aggregate coverage durable and enforceable.

  Acceptance: `bun run test:coverage` writes `coverage/lcov.info`, reports one
  aggregate repository-wide result, and fails below the required threshold.

  Verification: `bun run test:coverage && test -s coverage/lcov.info`

- [ ] Raise production coverage thresholds to 100 percent or record narrowly
      justified, file-specific exclusions in a tracked coverage policy.

  Acceptance: uncovered production lines, functions, and branches are either
  tested or explicitly justified in a small reviewed allowlist.

  Verification: `bun run test:coverage`

- [ ] Add regression tests for every correctness blocker found in this audit.

  Acceptance: tests cover indexed `clear()`, indexed `updateMetadata()`, indexed
  `updateBatch()`, unsupported public import paths, placeholder shared-memory
  search, demo WebAssembly, ignored timeout, ignored abort signal, and filter
  type/runtime drift.

  Verification: `bun test`

- [ ] Add package-consumer tests from the packed tarball.

  Acceptance: ESM, CommonJS, TypeScript declarations, browser bundler,
  subpath exports, and documented adapter imports are tested from the package
  tarball, not repository source.

  Verification: `bun run verify:package-consumers`

- [ ] Add documentation example tests.

  Acceptance: code blocks in README and API documentation are compiled or run
  automatically.

  Verification: `bun run verify:documentation-examples`

- [ ] Run benchmark tests in a dedicated gate.

  Acceptance: benchmark tests are not silently excluded from every meaningful
  quality gate; performance regressions fail against documented budgets.

  Verification: `bun run test:benchmark && bun run scripts/benchmark.ts --full`

- [ ] Add adapter integration services to continuous integration.

  Acceptance: Redis and S3-compatible integration tests run in continuous
  integration with disposable services and safe credentials.

  Verification: `bun test tests/storage/adapters`

- [ ] Add flaky-test detection for browser and worker tests.

  Acceptance: the browser and worker suites pass repeated runs without hidden
  shared global state.

  Verification: `for i in 1 2 3 4 5; do bun run test:end-to-end:chromium || exit 1; done`

- [ ] Add mutation or property-based tests for vector math and filters.

  Acceptance: randomized vectors and metadata filters are checked against simple
  reference implementations.

  Verification: `bun test tests/vectors tests/search -t 'property|random|fuzz'`

## Build And Package Surface

- [ ] Remove or stabilize the `./benchmarks` public export.

  Acceptance: benchmark code is either intentionally supported as public API
  with documentation and declarations, or removed from the package export map.

  Verification: `bun run verify:package-consumers`

- [ ] Add export-map validation.

  Acceptance: every exported path has JavaScript, declaration, ESM, CommonJS,
  and documentation coverage, and no documentation references unexported paths.

  Verification: `bun run verify:exports`

- [ ] Add bundle size budgets.

  Acceptance: browser, ESM, CommonJS, debug, GPU, worker, compression, and
  optional adapter entrypoints each have a documented maximum size and fail when
  exceeded.

  Verification: `bun run verify:bundle-size`

- [ ] Audit `sideEffects: false`.

  Acceptance: tree-shaking metadata is correct for singleton managers, debug
  hooks, worker setup, WebAssembly initialization, and adapter modules.

  Verification: `bun run verify:tree-shaking`

- [ ] Synchronize version metadata from one source.

  Acceptance: `package.json`, `VERSION`, changelog release headings, debug trace
  metadata, and generated package metadata cannot drift.

  Verification: `bun test src/index.test.ts tests/debug -t version`

- [ ] Add package file allowlist tests.

  Acceptance: the tarball contains only intentional production files and does
  not omit required assets such as WebAssembly modules, worker scripts,
  declarations, documentation needed by package users, or source maps if
  promised.

  Verification: `npm pack --dry-run --json --ignore-scripts`

- [ ] Decide whether source maps belong in the production package.

  Acceptance: source map inclusion is intentional, documented, and covered by
  package size budgets.

  Verification: `npm pack --dry-run --json --ignore-scripts`

- [ ] Verify Node engine support.

  Acceptance: the package either works on the documented Node versions with
  explicit storage adapters, or the Node engine claim is narrowed.

  Verification: `bun run verify:package-consumers`

## Performance And Scalability

- [ ] Define production performance targets.

  Acceptance: documented targets cover insertion throughput, search latency,
  recall, memory use, package size, startup time, index rebuild time, and
  storage adapter throughput for realistic dataset sizes.

  Verification: `bun run scripts/benchmark.ts --full`

- [ ] Add performance regression budgets to continuous integration.

  Acceptance: benchmark output is compared against committed baselines with a
  documented tolerance.

  Verification: `bun run test:benchmark`

- [ ] Add large-dataset search tests.

  Acceptance: representative datasets validate brute-force, indexed, filtered,
  worker, GPU, and streaming search behavior beyond toy vectors.

  Verification: `bun run scripts/benchmark.ts --full`

- [ ] Add memory profiling for indexing and search.

  Acceptance: memory growth is bounded and measured for add, batch add, search,
  rebuild, compression, GPU, WebAssembly, and worker paths.

  Verification: `bun run scripts/benchmark.ts --full`

- [ ] Define when each acceleration path activates.

  Acceptance: thresholds for synchronous JavaScript, workers, shared memory,
  WebAssembly, SIMD, and WebGPU are documented and supported by benchmark data.

  Verification: `bun run scripts/benchmark.ts --full && rg -n 'threshold|WebGPU|WebAssembly|worker' README.md docs`

- [ ] Add backpressure behavior for large writes and streamed reads.

  Acceptance: large batch operations and stream consumers cannot exhaust memory
  unexpectedly.

  Verification: `bun test tests/integration tests/search -t 'backpressure|large'`

## Observability And Operations

- [ ] Define production observability hooks.

  Acceptance: consumers can observe search latency, storage latency, index
  rebuilds, quota warnings, eviction, worker failures, GPU fallback,
  WebAssembly fallback, and adapter connectivity without parsing logs.

  Verification: `bun test tests/debug tests/integration -t 'observe|event|metric'`

- [ ] Add structured error codes for public failures.

  Acceptance: common production failures have stable error codes and sanitized
  context.

  Verification: `bun test tests/unit/core tests/storage tests/search -t 'error code'`

- [ ] Add health and diagnostics APIs.

  Acceptance: consumers can inspect storage adapter health, index health,
  acceleration availability, package version, quota state, and pending
  background work.

  Verification: `bun test tests/debug tests/integration -t 'health|diagnostic'`

- [ ] Add graceful shutdown coverage.

  Acceptance: `close()` and `delete()` flush dirty indexes, stop workers, close
  storage adapters, release GPU resources, and reject future operations with
  clear errors.

  Verification: `bun test tests/integration tests/workers tests/gpu -t 'close|delete|shutdown'`

## Release Documentation And Maintenance

- [ ] Create a stable release checklist.

  Acceptance: the checklist includes clean checkout, production verification,
  packed package inspection, changelog update, version synchronization,
  continuous integration status, release notes, npm provenance, and post-release
  install smoke tests.

  Verification: `rg -n 'Release Checklist|npm provenance|post-release' README.md docs .github`

- [ ] Add compatibility policy.

  Acceptance: documentation states semantic versioning expectations, supported
  runtimes, support window, experimental API policy, and deprecation policy.

  Verification: `rg -n 'Compatibility|Semantic Versioning|Deprecation|Experimental' README.md docs`

- [ ] Add changelog verification.

  Acceptance: the current package version has a changelog entry and release
  links do not drift from `package.json`.

  Verification: `bun run verify:changelog`

- [ ] Add issue templates for production support.

  Acceptance: bug reports collect runtime, adapter, package version, dataset
  size, vector dimension, search metric, reproduction, and logs.

  Verification: `rg -n 'runtime|adapter|dimension|metric' .github`

- [ ] Decide whether ignored `REQUIREMENTS.md` and `requirements/` are
      production documentation, planning artifacts, or dead files.

  Acceptance: requirements are either published where maintainers can use them
  or removed from the release readiness story.

  Verification: `git check-ignore REQUIREMENTS.md requirements || true`

## Final Production Acceptance

- [ ] Run the complete production gate in a clean checkout.

  Acceptance: all required quality, correctness, browser, package, coverage,
  performance, documentation, and supply-chain checks pass without manual
  intervention.

  Verification: `bun run verify:production`

- [ ] Install the packed package into fresh ESM, CommonJS, Bun, Node, and browser
      consumer projects.

  Acceptance: each consumer imports documented APIs, creates a database with an
  appropriate storage adapter, adds vectors, searches vectors, updates vectors,
  clears vectors, closes cleanly, and type-checks.

  Verification: `bun run verify:package-consumers`

- [ ] Confirm continuous integration is green for the release commit.

  Acceptance: every required check passes on the release commit, including the
  full browser matrix and adapter integration services.

  Verification: `gh run list --limit 5 --json status,conclusion,headSha,workflowName`

- [ ] Publish only after the above checks pass.

  Acceptance: stable release notes list supported features, experimental
  features, known limitations, migration notes, and verification evidence.

  Verification: `npm view vector-frankl version`
