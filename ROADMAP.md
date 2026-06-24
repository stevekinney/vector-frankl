# Roadmap

**Production readiness verdict:** Vector Frankl is not ready for a stable
production release. It has a useful beta foundation, but the current public
claims are ahead of the implementation and the release gates are not strong
enough to prove the library is safe to publish as a production-ready
IndexedDB-backed, browser-native vector database.

This roadmap is the production readiness source of truth. A task is complete
only when its acceptance criteria are true in a clean checkout and its
verification command passes.

## What Is Already Done

The current codebase already has a broad beta implementation:

- A simple `VectorDB` API and a namespace-oriented `VectorFrankl` API.
- IndexedDB-backed browser storage through `VectorDatabase`,
  `VectorStorage`, and `IndexedDatabaseStorageAdapter`.
- Additional storage adapters for memory, OPFS, Chrome storage, SQLite, LMDB,
  Redis, S3, and file-system storage.
- Vector format conversion, vector math, distance metrics, metadata filtering,
  HNSW indexing, index persistence, quota monitoring, eviction policies,
  compression managers, worker utilities, WebGPU utilities, WebAssembly
  utilities, debugging, profiling, and benchmark infrastructure.
- Strict TypeScript settings, Bun-based scripts, unit tests, integration tests,
  Playwright end-to-end tests, benchmark tests, and package export entries for
  `.`, `./gpu`, `./workers`, `./debug`, `./benchmarks`, and `./compression`.

The previous audit work also closed several concrete correctness gaps:

- Indexed `clear()` no longer leaves stale HNSW entries.
- `updateMetadata()` refreshes indexed metadata and validates vector IDs and
  metadata input.
- `updateBatch()` validates batch input and keeps indexed vectors and metadata
  synchronized.
- `exists()`, `searchRange()`, and `searchStream()` have input validation.
- Changing the distance metric rebuilds or invalidates the index.

Those are necessary foundations, not sufficient production readiness.

## Actionable Comment Inventory

The codebase has many ordinary explanatory comments. The production-relevant
comments are the ones that admit incomplete behavior, simulated coverage, or
future work:

- `src/search/search-engine.ts:175` and
  `src/search/search-engine.ts:542-543`: search still loads all candidates and
  has a `TODO` to add metadata indexes.
- `src/workers/shared-memory.ts:503-519`: shared-memory worker delegation is a
  placeholder and returns empty results.
- `src/wasm/wasm-manager.ts:158-199` and
  `src/wasm/wasm-manager.ts:420-511`: WebAssembly runtime code is explicitly
  demo/mock plumbing and performs real calculations in JavaScript.
- `src/wasm/wasm-manager.ts:366`: WebAssembly memory uses a placeholder
  allocation strategy.
- `src/gpu/gpu-search-engine.ts:442`: unsupported GPU fallback metrics return a
  default distance instead of correct metric behavior.
- `src/compression/compression-manager.ts:154`: binary quantization is deferred
  to a future phase.
- `src/benchmarks/benchmark-suite.ts:426-428`: compression benchmarks are
  simulated.
- `src/namespaces/adapter-registry.ts:23`: namespace metadata is stored as
  vector records with a placeholder vector because of the adapter contract.
- `tests/mocks/indexeddb-mock.ts`, `tests/gpu/*`, and
  `tests/end-to-end/web-workers.e2e.ts`: important browser, WebGPU, and worker
  coverage uses mocks or local test-only implementations rather than proving
  the shipped package paths.

Every item below either resolves one of those comments, reconciles a public
claim with real behavior, or adds the release gate needed to prevent drift.

## Release Verification

- [ ] Implement `verify:production` as the single stable-release gate.

  Acceptance: one command fails when any required lint, formatting,
  type-checking, unit, integration, browser, coverage, export-map,
  package-consumer, documentation-example, acceleration, benchmark, supply-chain,
  or changelog check fails.

  Verification: `bun run verify:production`

- [ ] Add the verification scripts already referenced by this roadmap.

  Acceptance: `package.json` defines `verify:production`,
  `verify:package-consumers`, `verify:exports`,
  `verify:documentation-examples`, `verify:acceleration`,
  `verify:benchmarks`, `verify:bundle-size`, `verify:supply-chain`, and
  `verify:changelog`.

  Verification: `bun run verify:production`

- [ ] Make `prepublishOnly` run the full production gate.

  Acceptance: publishing cannot proceed unless `verify:production` passes in
  the package checkout.

  Verification: `bun run prepublishOnly`

- [ ] Run the production gate in continuous integration.

  Acceptance: the release workflow runs `verify:production` and fails on any
  missing script, skipped required browser project, benchmark budget failure, or
  package-consumer failure.

  Verification: `gh run list --limit 5 --json status,conclusion,workflowName`

- [ ] Add clean-checkout package verification.

  Acceptance: a script removes build artifacts, installs dependencies with Bun,
  builds from source, packs the package, installs the tarball into fresh ESM,
  CommonJS, Bun, Node, TypeScript, and browser-bundler consumers, and imports
  every documented public entrypoint.

  Verification: `bun run verify:package-consumers`

- [ ] Add export-map validation.

  Acceptance: every documented `vector-frankl/...` import is exported by
  `package.json`, has JavaScript and declaration output, works from the packed
  tarball, and no public documentation imports from `vector-frankl/src/...`.

  Verification: `bun run verify:exports && ! rg -n 'vector-frankl/src' README.md docs examples`

- [ ] Add package file allowlist tests.

  Acceptance: the tarball contains only intentional production files and does
  not omit required declarations, worker assets, WebAssembly assets,
  documentation promised to package users, or source maps if source maps remain
  supported.

  Verification: `npm pack --dry-run --json --ignore-scripts`

- [ ] Synchronize release metadata.

  Acceptance: `package.json`, exported `VERSION`, changelog headings and links,
  debug metadata, and any generated package metadata cannot drift.

  Verification: `bun test src/index.test.ts tests/debug -t version && bun run verify:changelog`

## Core Database And Search Correctness

- [ ] Fix persisted HNSW index lifecycle.

  Acceptance: after close and reopen with indexing enabled,
  `getIndexStats().nodeCount` matches stored vector count, persisted indexes are
  validated against storage state before use, and indexed search returns the
  same deterministic top result as before close.

  Verification: `bun test tests/integration/vector-database.integration.test.ts tests/search/index-persistence.test.ts`

- [ ] Make cosine semantics consistent across all search paths.

  Acceptance: brute-force, HNSW, worker, WebGPU, WebAssembly, SIMD, and batch
  search either normalize consistently or document a different metric-specific
  representation; scaled collinear vectors cannot produce scores above `1`.

  Verification: `bun test tests/search tests/workers tests/gpu tests/wasm tests/vectors -t 'cosine|score|distance|parity'`

- [ ] Correct `searchRange()` limiting.

  Acceptance: `maxResults` returns the nearest matching vectors within the
  threshold independent of insertion order.

  Verification: `bun test tests/search/search-engine.test.ts -t searchRange`

- [ ] Define exact search result ordering.

  Acceptance: equal-distance results have stable documented tie-breaking across
  brute-force, HNSW, worker, WebGPU, and streamed search.

  Verification: `bun test tests/search tests/workers tests/gpu -t 'tie|stable|order'`

- [ ] Implement or remove `SearchOptions.timeout`.

  Acceptance: timeout stops brute-force, HNSW, filtered, streamed, worker,
  shared-memory, WebGPU, and fallback search paths within a bounded interval, or
  the option is removed from public types, documentation, and examples.

  Verification: `bun test tests/search tests/workers tests/gpu -t timeout && bun run typecheck`

- [ ] Implement or remove `SearchOptions.signal`.

  Acceptance: an aborted signal stops every search path before results are
  returned, cleans up pending worker and GPU work, and produces a documented
  error, or the option is removed from the public contract.

  Verification: `bun test tests/search tests/workers tests/gpu -t 'abort|signal' && bun run typecheck`

- [ ] Make `SearchOptions` a closed public contract.

  Acceptance: unknown search option keys are rejected or accepted through a
  typed extension point; options are not silently passed through unvalidated.

  Verification: `bun test tests/unit/core/input-validator.test.ts -t validateSearchOptions`

- [ ] Reconcile `FilterOperator` with `MetadataFilterCompiler`.

  Acceptance: every typed operator is implemented and tested, every implemented
  operator is typed, and README, API documentation, examples, and runtime
  behavior agree on `$contains`, `$between`, `$exists`, `$type`, `$regex`,
  `$size`, `$all`, and `$elemMatch`.

  Verification: `bun test tests/search/metadata-filter.test.ts && bun run typecheck`

- [ ] Add metadata index or adapter-assisted filtered search.

  Acceptance: production adapters do not require `storage.getAll()` for
  filtered search at production dataset sizes unless the adapter is explicitly
  documented as lacking metadata indexing.

  Verification: `bun test tests/search tests/storage -t 'filter|metadata|index' && bun run scripts/benchmark.ts --full`

- [ ] Add cursor or streaming candidate APIs.

  Acceptance: search, eviction planning, statistics, and maintenance operations
  can scan large stores without materializing the full database into memory.

  Verification: `bun test tests/search tests/storage -t 'cursor|stream|large'`

- [ ] Define atomicity semantics for multi-vector mutations.

  Acceptance: `addBatch()`, `updateBatch()`, and `deleteMany()` document
  all-or-nothing or partial-success behavior, and tests assert storage and index
  state for failure cases.

  Verification: `bun test tests/unit/core/database.test.ts tests/storage -t batch`

- [ ] Make storage mutation and index mutation failure handling explicit.

  Acceptance: if index updates fail after storage writes, the method rolls back
  storage, marks the index dirty and rebuilds before future indexed search, or
  disables indexed search until recovery completes.

  Verification: `bun test tests/search tests/unit/core/database.test.ts -t 'index|rollback|dirty'`

- [ ] Add storage-index invariants in tests.

  Acceptance: test helpers can detect missing, stale, duplicated, or deleted
  index entries after every public mutation.

  Verification: `bun test tests/search tests/integration -t invariant`

- [ ] Align namespace configuration with behavior.

  Acceptance: `NamespaceConfig` fields such as `indexStrategy`, `compression`,
  and `compressionConfig` either control namespace behavior with tests or are
  removed from public types and documentation.

  Verification: `bun run typecheck && bun test src/namespaces tests/integration/vector-database.integration.test.ts`

- [ ] Make namespace deletion settle atomically.

  Acceptance: blocked IndexedDB deletion rejects instead of hanging, and
  registry state remains unchanged when deletion fails.

  Verification: `bun test src/namespaces/manager.test.ts -t deleteNamespace`

- [ ] Replace the namespace placeholder-vector storage contract.

  Acceptance: namespace metadata storage no longer requires fake vector records,
  or the placeholder-vector representation is documented as an internal detail
  and covered by corruption, migration, and adapter compatibility tests.

  Verification: `bun test src/namespaces tests/storage -t namespace`

## HNSW Indexing

- [ ] Classify the current HNSW implementation honestly.

  Acceptance: HNSW is either replaced with a production-quality algorithm or
  explicitly scoped as experimental until recall, deletion, update, persistence,
  and rebuild guarantees pass.

  Verification: `bun test tests/search/hnsw-index.test.ts`

- [ ] Add recall benchmarks against brute-force search.

  Acceptance: recall targets are defined per dataset size, dimension, metric,
  `m`, `efConstruction`, and search `ef`, and the benchmark fails when recall
  drops below target.

  Verification: `bun run scripts/benchmark.ts --full`

- [ ] Add HNSW mutation stress tests.

  Acceptance: repeated insert, update, delete, clear, close, reopen, and rebuild
  cycles preserve recall and never return deleted vectors.

  Verification: `bun test tests/search/hnsw-index.test.ts tests/search/index-persistence.test.ts -t 'delete|update|rebuild|recall|persist'`

- [ ] Persist dirty indexes durably before eviction from `IndexCache`.

  Acceptance: dirty index eviction awaits persistence or leaves the dirty entry
  in cache with a retryable error; unsaved index mutations cannot be dropped
  silently.

  Verification: `bun test tests/search -t IndexCache`

- [ ] Replace rough index storage estimates with measured sizes.

  Acceptance: index storage usage is measured from serialized bytes or adapter
  storage metadata rather than fixed node-count estimates.

  Verification: `bun test tests/search -t storage`

- [ ] Add index persistence compatibility tests.

  Acceptance: indexes serialized by the previous supported version can be
  loaded or explicitly rejected with a migration error that explains how to
  rebuild.

  Verification: `bun test tests/search -t persistence`

- [ ] Add public index health checks.

  Acceptance: consumers can detect dirty, stale, missing, incompatible,
  rebuilding, or disabled index state without running a search.

  Verification: `bun test tests/search tests/unit/core/database.test.ts -t health`

## Browser-Native Storage

- [ ] Make durable browser defaults explicit.

  Acceptance: `VectorDB` and adapter resolution either default to initialized
  IndexedDB in browsers or require an explicit storage choice; no browser path
  silently falls back to memory when durable storage was expected.

  Verification: `bun test tests/storage/resolve-storage-adapter.test.ts && bun run test:end-to-end:chromium -- --grep storage`

- [ ] Publish an adapter support matrix.

  Acceptance: every adapter is classified as production-supported,
  experimental, or internal-only with runtime, persistence, transaction,
  concurrency, quota, indexing, and cleanup guarantees.

  Verification: `rg -n 'Storage Adapter Support|production-supported|experimental|internal-only' README.md docs`

- [ ] Add adapter capability metadata.

  Acceptance: every adapter reports persistence, transactions, batch atomicity,
  metadata indexing, quota reporting, concurrent-writer support, and browser or
  server compatibility.

  Verification: `bun test tests/storage -t capability && bun run typecheck`

- [ ] Add real browser IndexedDB durability tests.

  Acceptance: Playwright covers persistence, reload recovery, multiple
  instances, blocked upgrades, version-change behavior, transaction aborts,
  quota failures, clear/update/delete index consistency, and migration behavior
  in Chromium, Firefox, WebKit, mobile Chrome, and mobile Safari.

  Verification: `bun run build && bun run test:end-to-end`

- [ ] Make browser end-to-end tests build the served package first.

  Acceptance: Playwright cannot serve stale `dist/`; the end-to-end command
  builds or verifies current build output before starting the test server.

  Verification: `bun run build && bun run test:end-to-end`

- [ ] Harden quota checks and auto-eviction.

  Acceptance: single writes and batch writes check quota before allocation,
  simulated quota failures leave no dangling IDs or partial records, auto-
  eviction is awaited when enabled, and typed quota errors are emitted.

  Verification: `bun test tests/storage tests/integration -t 'quota|eviction' && bun run test:end-to-end:chromium -- --grep quota`

- [ ] Version the storage serialization format.

  Acceptance: every serialized record has a format marker, version, vector
  length, metadata length, checksum or equivalent integrity check, and bounded
  parse behavior; invalid payloads produce documented recovery errors.

  Verification: `bun test tests/storage tests/search -t 'serialization|corrupt|migration'`

- [ ] Add corruption detection and repair behavior.

  Acceptance: malformed vectors, missing metadata, missing index manifests,
  partial writes, and incompatible serialized records are detected with a
  documented repair, rebuild, or fail-closed path.

  Verification: `bun test tests/storage tests/search -t 'corrupt|repair|missing'`

- [ ] Harden OPFS or keep it experimental.

  Acceptance: JSON and binary OPFS data survive reloads, two adapter instances,
  delete/recreate cycles, quota pressure, and corrupt file recovery, or OPFS is
  documented as experimental.

  Verification: `bun run test:end-to-end:chromium -- --grep OPFS`

- [ ] Harden Chrome storage or keep it experimental.

  Acceptance: large vectors chunk safely or fail before any write, concurrent
  extension contexts cannot lose IDs, partial writes are repaired or rolled
  back, and quota limits are tested.

  Verification: `bun test tests/storage/adapters/chrome-storage-adapter.test.ts && bun run test:end-to-end:chromium -- --grep 'Chrome storage'`

- [ ] Verify server-side adapter support.

  Acceptance: SQLite, LMDB, Redis, S3, and file-system adapters have tested
  runtime requirements and are not labeled Node-compatible unless they pass Node
  consumer tests from the packed tarball.

  Verification: `bun run verify:package-consumers && bun test tests/storage/adapters`

- [ ] Add real Redis integration tests.

  Acceptance: tests cover connection failure, authentication or TLS
  configuration, pipelined batches, concurrent writes, expiration behavior,
  prefix isolation, and cleanup against a disposable Redis service.

  Verification: `bun test tests/storage/adapters/redis-adapter.test.ts --preload tests/storage/redis-integration-setup.ts`

- [ ] Add real S3-compatible integration tests.

  Acceptance: tests cover manifest consistency, concurrent writers,
  eventually-consistent reads, multipart-size payloads, missing objects,
  retries, and cleanup against a disposable S3-compatible service.

  Verification: `bun test tests/storage/adapters/s3-adapter.test.ts --preload tests/storage/s3-integration-setup.ts`

- [ ] Fix S3 multi-writer manifest consistency or document single-writer only.

  Acceptance: two adapter instances cannot lose IDs when they write
  concurrently, or the adapter is explicitly documented and typed as
  single-writer.

  Verification: `bun test tests/storage/adapters/s3-adapter.test.ts -t concurrent`

- [ ] Make direct adapter usage safe.

  Acceptance: direct adapter calls validate IDs, dimensions, metadata, batch
  sizes, and serialized payloads, or documentation clearly states validation is
  only guaranteed through `VectorDB` and `VectorFrankl`.

  Verification: `bun test tests/storage tests/unit/core/input-validator.test.ts`

## Acceleration

- [ ] Decide which acceleration paths are production features.

  Acceptance: SIMD, WebAssembly, WebGPU, workers, and shared memory are each
  marked production-supported or experimental, and README/API claims only
  describe paths with passing correctness and benchmark evidence.

  Verification: `bun run verify:acceleration && rg -n 'Experimental|Production-supported|SIMD|WebAssembly|WebGPU|worker|shared memory' README.md docs`

- [ ] Make automatic acceleration claims true or remove them.

  Acceptance: the main API either exposes and passes through the configuration
  needed for automatic WebGPU, WebAssembly, SIMD, and worker selection, or the
  documentation stops claiming automatic acceleration.

  Verification: `bun run verify:documentation-examples && bun test tests/search tests/gpu tests/wasm tests/workers -t acceleration`

- [ ] Replace demo WebAssembly with a real packaged module or remove production
      WebAssembly claims.

  Acceptance: no production runtime matches remain for `mock WASM`,
  `For demonstration`, `demo mode`, or `In production`; operations execute in a
  real WebAssembly module or WebAssembly is documented as experimental or
  absent.

  Verification: `bun test tests/wasm -t 'wasm|fallback|integrity|enableWASM' && ! rg -n 'mock WASM|For demonstration|demo mode|In production' src/wasm`

- [ ] Enforce `enableWASM: false`.

  Acceptance: disabled WebAssembly does not initialize WebAssembly, does not
  report WebAssembly capability as active, and routes operations through the
  documented fallback.

  Verification: `bun test tests/wasm -t enableWASM`

- [ ] Add WebAssembly asset packaging and integrity checks.

  Acceptance: published WebAssembly assets are content-addressed or checksummed,
  expected hashes are committed, tampered modules fail before execution, and
  packed consumers can load the asset in supported runtimes.

  Verification: `bun test tests/wasm -t integrity && bun run verify:package-consumers -- --entry wasm`

- [ ] Reclassify SIMD unless real SIMD is proven.

  Acceptance: capability detection only reports SIMD when a real SIMD execution
  path is active, or README/API rename the feature as optimized JavaScript and
  remove hardware SIMD performance claims.

  Verification: `bun test tests/vectors tests/search -t 'SIMD|capability|fallback|parity' && bun run test:benchmark`

- [ ] Add WebGPU CPU parity tests.

  Acceptance: WebGPU and CPU produce the same top-k order, scores, and distances
  within documented tolerance for every supported metric.

  Verification: `bun test tests/gpu tests/search -t 'GPU|WebGPU|parity|score|distance' && bun run test:end-to-end:chromium -- --grep WebGPU`

- [ ] Fix unsupported WebGPU metrics.

  Acceptance: hamming and jaccard either compute correctly in GPU and fallback
  paths or fail clearly before returning placeholder distances.

  Verification: `bun test tests/gpu -t 'hamming|jaccard|fallback'`

- [ ] Add WebGPU resource limit validation.

  Acceptance: query, vector, metadata, and result buffers are checked against
  adapter limits before GPU allocation with actionable errors.

  Verification: `bun test tests/gpu -t 'buffer|limit'`

- [ ] Implement shared-memory batch search or remove it from public production
      paths.

  Acceptance: non-empty vectors and queries cannot return empty placeholder
  results; shared-memory search matches brute-force results for multiple
  dimensions and metrics.

  Verification: `bun test tests/workers/shared-memory.test.ts -t 'sharedMemoryBatchSearch|brute force|parity'`

- [ ] Make worker script resolution package-safe.

  Acceptance: packed ESM, CommonJS, and browser consumers can construct
  `WorkerPool` without manually hosting a repository-local `vector-worker.js`,
  or `workerScript` is documented as required with a working packaged example.

  Verification: `bun run verify:package-consumers -- --entry workers`

- [ ] Add worker lifecycle, cancellation, and error propagation tests.

  Acceptance: worker startup failures, task failures, serialization errors,
  timeouts, aborts, repeated initialization, `close()`, and cleanup produce
  documented behavior and do not leak workers.

  Verification: `bun test tests/workers -t 'lifecycle|cleanup|abort|timeout|error|failure'`

- [ ] Document cross-origin isolation for shared memory.

  Acceptance: shared-memory features document required
  `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` headers,
  runtime support, and fallback behavior.

  Verification: `rg -n 'Cross-Origin-Opener-Policy|Cross-Origin-Embedder-Policy|SharedArrayBuffer' README.md docs`

## Compression And Vector Operations

- [ ] Implement binary quantization or remove it from production claims.

  Acceptance: `CompressionStrategy` and public documentation only advertise
  strategies with implementation, tests, quality budgets, persistence support,
  and examples.

  Verification: `bun test tests/compression && bun run verify:documentation-examples`

- [ ] Replace simulated compression benchmarks.

  Acceptance: compression benchmarks execute the real scalar, product, and
  binary strategies that remain public and fail against documented performance
  and quality budgets.

  Verification: `bun run test:benchmark && bun run scripts/benchmark.ts --full`

- [ ] Add compression quality and persistence tests.

  Acceptance: compressed vectors round-trip through every supported production
  storage adapter, search quality loss stays within documented tolerances, and
  corrupted compressed payloads fail predictably.

  Verification: `bun test tests/compression tests/storage tests/search -t 'compression|quality|round trip|corrupt'`

- [ ] Add property-based vector math tests.

  Acceptance: randomized vector operations and distance metrics are checked
  against simple reference implementations across supported vector formats and
  edge cases.

  Verification: `bun test tests/vectors tests/search -t 'property|random|fuzz|edge'`

## Documentation And Public API

- [ ] Rewrite README claims to match verified behavior.

  Acceptance: performance, WebGPU, SIMD, WebAssembly, storage adapter,
  browser-first, server-side, privacy, compression, and scalability claims each
  point to implemented APIs and verification evidence.

  Verification: `bun run verify:documentation`

- [ ] Add a production-readiness status section to the README.

  Acceptance: stable, beta, experimental, and unsupported features are labeled
  with clear support guarantees.

  Verification: `rg -n 'Production Readiness|Stable|Beta|Experimental|Unsupported' README.md`

- [ ] Correct `docs/API.md` against the exported source.

  Acceptance: every documented method, option, return type, namespace
  configuration field, adapter, import path, and code example type-checks
  against the packed package.

  Verification: `bun run verify:documentation-examples`

- [ ] Fix documented API signature drift.

  Acceptance: `addBatch()`, `SearchOptions`, `createNamespace()`,
  `NamespaceConfig`, `GPUSearchEngine.search()`, benchmark APIs, and debug APIs
  are documented with the same signatures the source exports.

  Verification: `bun run verify:documentation-examples && bun run typecheck`

- [ ] Rewrite security documentation against public APIs.

  Acceptance: every referenced class, function, and error is public, or the
  section is labeled as an implementation detail; ReDoS protection is described
  as pattern and input guarding rather than interruptible regex timeouts.

  Verification: `bun run verify:documentation-examples && ! rg -n 'MetadataFilter\\.safeRegexTest|REGEX_TIMEOUT|StorageManager' docs/SECURITY.md`

- [ ] Publish a precise runtime support matrix.

  Acceptance: README and API documentation state supported versions for Bun,
  Node, Chromium, Firefox, WebKit, mobile browsers, IndexedDB, OPFS, WebGPU,
  WebAssembly, workers, SharedArrayBuffer, Chrome extensions, Redis, S3, SQLite,
  LMDB, and file-system storage if retained.

  Verification: `rg -n 'Runtime Support|Browser Support|Storage Adapter Support' README.md docs`

- [ ] Add adapter-specific setup guides.

  Acceptance: each supported adapter has setup, runtime requirements, limits,
  persistence guarantees, concurrency guarantees, quota behavior, and cleanup
  instructions.

  Verification: `rg -n 'IndexedDB|OPFS|Chrome storage|SQLite|LMDB|Redis|S3|File system' README.md docs`

- [ ] Add migration and upgrade documentation.

  Acceptance: consumers know how to move between package versions, migrate
  IndexedDB schemas, rebuild indexes, handle incompatible persisted indexes,
  and recover from corrupt storage records.

  Verification: `rg -n 'Migration|Upgrade|Rebuild Index|Schema|Recovery' README.md docs`

- [ ] Add failure-mode documentation.

  Acceptance: quota errors, unsupported runtime APIs, corrupted data, aborted
  searches, timeout errors, worker failures, WebGPU failures, WebAssembly
  failures, adapter connectivity failures, and blocked IndexedDB upgrades are
  documented.

  Verification: `rg -n 'Quota|Unsupported|Corrupt|Abort|Timeout|Worker|WebGPU|WebAssembly|blocked' README.md docs`

- [ ] Compile documentation examples from the packed tarball.

  Acceptance: README code blocks, `docs/API.md` code blocks, and `examples/*.ts`
  type-check or run against `npm pack` output rather than repository source.

  Verification: `bun run verify:documentation-examples && bun run verify:package-consumers`

## Testing And Coverage

- [ ] Make aggregate coverage durable and enforceable.

  Acceptance: `bun run test:coverage` writes one repository-wide
  `coverage/lcov.info`, reports aggregate results, and fails below the required
  threshold.

  Verification: `bun run test:coverage && test -s coverage/lcov.info`

- [ ] Raise production coverage to 100 percent or track narrow exclusions.

  Acceptance: uncovered production lines, functions, and branches are either
  tested or listed in a reviewed file-specific coverage policy.

  Verification: `bun run test:coverage`

- [ ] Replace permissive mocks with real-browser gates where browser semantics
      matter.

  Acceptance: IndexedDB, WebGPU, WebAssembly, OPFS, workers, SharedArrayBuffer,
  and quota behavior have real-browser tests or explicit capability skips that
  cannot satisfy production correctness with mocks alone.

  Verification: `bun run test:end-to-end`

- [ ] Make end-to-end assertions fail on broken behavior.

  Acceptance: browser tests do not log warnings in place of failing assertions,
  and placeholder UI paths do not count as production coverage.

  Verification: `bun run test:end-to-end:chromium`

- [ ] Add package-consumer browser tests.

  Acceptance: a browser-bundler consumer installs the packed tarball, imports
  documented entrypoints, creates a database, writes vectors, searches, updates,
  clears, closes, and reloads successfully.

  Verification: `bun run verify:package-consumers`

- [ ] Add large-dataset tests.

  Acceptance: representative datasets validate brute-force, indexed, filtered,
  worker, WebGPU, streamed, compressed, and persisted search behavior beyond toy
  vector counts.

  Verification: `bun run scripts/benchmark.ts --full`

- [ ] Add flaky-test detection for browser and worker suites.

  Acceptance: browser and worker suites pass repeated runs without hidden
  shared global state.

  Verification: `for i in 1 2 3 4 5; do bun run test:end-to-end:chromium || exit 1; done`

- [ ] Add adapter integration services to continuous integration.

  Acceptance: Redis and S3-compatible tests run against disposable services
  with safe credentials.

  Verification: `bun test tests/storage/adapters`

## Performance And Benchmarks

- [ ] Define production performance targets.

  Acceptance: documented targets cover insert throughput, batch insert
  throughput, search latency, recall, memory use, package size, startup time,
  index rebuild time, storage throughput, compression cost, and acceleration
  thresholds for realistic dataset sizes.

  Verification: `bun run scripts/benchmark.ts --full`

- [ ] Replace published timing tables with generated benchmark evidence.

  Acceptance: README performance numbers are generated from committed baselines
  with tolerances, and continuous integration fails on regressions beyond the
  documented tolerance.

  Verification: `bun run benchmark:production && bun run verify:benchmarks`

- [ ] Define when each execution path activates.

  Acceptance: thresholds for synchronous JavaScript, optimized JavaScript,
  workers, shared memory, WebAssembly, SIMD, and WebGPU are documented and
  supported by benchmark data.

  Verification: `bun run scripts/benchmark.ts --full && rg -n 'threshold|WebGPU|WebAssembly|worker|SIMD' README.md docs`

- [ ] Add memory profiling for production paths.

  Acceptance: memory growth is bounded and measured for add, batch add, search,
  filtered search, index rebuild, compression, WebGPU, WebAssembly, workers,
  shared memory, and adapter scans.

  Verification: `bun run scripts/benchmark.ts --full`

- [ ] Add backpressure behavior for large writes and streamed reads.

  Acceptance: large batch operations and stream consumers cannot exhaust memory
  unexpectedly, and backpressure behavior is documented.

  Verification: `bun test tests/integration tests/search -t 'backpressure|large|stream'`

## Security, Safety, And Operations

- [ ] Complete public input validation coverage.

  Acceptance: every public method in `VectorDB`, `VectorFrankl`, namespaces,
  adapters, compression, workers, WebAssembly, WebGPU, and debug entrypoints
  validates untrusted input or delegates to a validated lower layer with tests.

  Verification: `bun test tests/unit/core/input-validator.test.ts tests/integration`

- [ ] Add a public threat model.

  Acceptance: documentation states what the library protects against and what it
  does not protect against, including plaintext browser storage, same-origin
  access, cross-site scripting, server adapter credentials, local file access,
  and untrusted metadata filters.

  Verification: `rg -n 'Threat Model|plaintext|same-origin|credentials|metadata filter' docs README.md`

- [ ] Clarify encryption-at-rest behavior.

  Acceptance: docs explicitly state whether IndexedDB, OPFS, Chrome storage,
  file-system, SQLite, Redis, and S3 data are plaintext or encrypted, and any
  privacy claims are narrowed accordingly unless optional encryption is
  implemented.

  Verification: `rg -n 'encryption|encrypted|plaintext|at rest' README.md docs`

- [ ] Add ReDoS regression tests.

  Acceptance: dangerous patterns are rejected before execution and long input
  values cannot hang search.

  Verification: `bun test tests/search/metadata-filter.test.ts -t 'regex|ReDoS'`

- [ ] Add memory exhaustion tests.

  Acceptance: vector dimension, vector memory, batch size, metadata size,
  worker buffer size, GPU buffer size, WebAssembly memory size, and serialized
  payload limits reject unsafe input before allocation.

  Verification: `bun test tests/unit/core/input-validator.test.ts tests/workers tests/gpu tests/wasm tests/storage -t 'memory|limit'`

- [ ] Audit error sanitization across thrown errors and logs.

  Acceptance: vector data, metadata values, storage credentials, URLs, database
  names, file paths, S3 keys, Redis URLs, and regex patterns are redacted or
  intentionally included according to a documented policy.

  Verification: `bun test tests/debug tests/unit/core -t 'sanitize|redact|error'`

- [ ] Add dependency and supply-chain checks.

  Acceptance: known-vulnerability checks, license checks, lockfile integrity,
  npm provenance requirements, and packed-file review run before release.

  Verification: `bun run verify:supply-chain`

- [ ] Add production observability hooks.

  Acceptance: consumers can observe search latency, storage latency, index
  rebuilds, quota warnings, eviction, worker failures, GPU fallback,
  WebAssembly fallback, adapter connectivity, and corruption recovery without
  parsing logs.

  Verification: `bun test tests/debug tests/integration -t 'observe|event|metric'`

- [ ] Add structured error codes for public failures.

  Acceptance: common production failures have stable error codes, sanitized
  context, and recovery guidance.

  Verification: `bun test tests/unit/core tests/storage tests/search -t 'error code'`

- [ ] Add health and diagnostics APIs.

  Acceptance: consumers can inspect storage health, index health, acceleration
  availability, package version, quota state, dirty indexes, pending background
  work, and adapter connectivity.

  Verification: `bun test tests/debug tests/integration -t 'health|diagnostic'`

- [ ] Add graceful shutdown coverage.

  Acceptance: `close()` and `delete()` flush dirty indexes, stop workers, close
  adapters, release GPU resources, release WebAssembly resources, and reject
  future operations with clear errors.

  Verification: `bun test tests/integration tests/workers tests/gpu tests/wasm -t 'close|delete|shutdown|cleanup'`

## Release Documentation And Maintenance

- [ ] Create a stable release checklist.

  Acceptance: the checklist includes clean checkout setup, production
  verification, packed package inspection, changelog update, version
  synchronization, continuous integration status, release notes, npm provenance,
  and post-release install smoke tests.

  Verification: `rg -n 'Release Checklist|npm provenance|post-release' README.md docs .github`

- [ ] Add a compatibility policy.

  Acceptance: documentation states semantic versioning expectations, supported
  runtimes, support window, experimental API policy, and deprecation policy.

  Verification: `rg -n 'Compatibility|Semantic Versioning|Deprecation|Experimental' README.md docs`

- [ ] Add production support issue templates.

  Acceptance: bug reports collect runtime, adapter, package version, dataset
  size, vector dimension, search metric, reproduction, browser details,
  acceleration path, and sanitized logs.

  Verification: `rg -n 'runtime|adapter|dimension|metric|browser|logs' .github`

- [x] Decide whether ignored `REQUIREMENTS.md` and `requirements/` are active
      production documents.

  Decision: neither `REQUIREMENTS.md` nor `requirements/` exists in the
  repository. The `.gitignore` entries for both were dead weight—added when
  the files were historical planning artifacts that were never committed. The
  ignore rules have been removed; they are no longer part of the release
  readiness story.

  Verification: `git check-ignore REQUIREMENTS.md requirements || true`
  (returns no output—neither path is ignored or tracked)

## Final Production Acceptance

- [ ] Run the full production gate in a clean checkout.

  Acceptance: quality, correctness, browser, package, coverage, performance,
  documentation, acceleration, adapter integration, security, and supply-chain
  checks pass without manual intervention.

  Verification: `bun run verify:production`

- [ ] Install the packed package into fresh consumers.

  Acceptance: ESM, CommonJS, Bun, Node, TypeScript, and browser consumers import
  documented APIs, create a database with an appropriate storage adapter, add
  vectors, search, update, clear, close, and type-check.

  Verification: `bun run verify:package-consumers`

- [ ] Confirm continuous integration is green for the release commit.

  Acceptance: every required check is terminal and passing on the release
  commit, including the full browser matrix and adapter integration services.

  Verification: `gh run list --limit 5 --json status,conclusion,headSha,workflowName`

- [ ] Publish only after all production acceptance checks pass.

  Acceptance: stable release notes list supported features, experimental
  features, known limitations, migration notes, verification evidence, and
  post-release smoke-test results.

  Verification: `npm view vector-frankl version`
