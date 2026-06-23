# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0-beta.3] - 2026-06-23

Production-readiness release resolving the full ROADMAP audit (issues #45–#107):
correctness, packaging, acceleration honesty, documentation accuracy, security,
and a unified release-verification gate. See the
[Production Readiness](README.md#production-readiness) section for per-feature
support tiers.

### Supported (Stable)

- Core vector database on IndexedDB with namespace isolation, quota monitoring, and eviction policies (LRU/LFU/TTL/score-based/hybrid)
- Distance metrics: cosine, euclidean, manhattan, hamming, jaccard, dot — with property-based tests
- Storage adapters: Memory, IndexedDB (browser); Memory, SQLite, LevelDB, LMDB, Redis, S3, file system (server) — each with a published `static capabilities` descriptor and a support-matrix entry
- Scalar and product quantization compression with quality/persistence/corruption tests
- SIMD-accelerated and scalar vector operations (Workers for parallel batch work)
- Cursor/streaming scan APIs for large stores; mutation atomicity with index-recovery semantics
- Dual ESM + CommonJS publishing, verified across Bun/Node/TypeScript/browser consumers from the packed tarball

### Experimental

- WebGPU acceleration (CPU parity + resource limits; falls back to CPU when unavailable)
- WebAssembly integration (`WASMManager`) — no module bundled by default; consumers supply their own
- SharedArrayBuffer-backed batch search (requires cross-origin isolation — see [docs/shared-memory.md](docs/shared-memory.md))
- HNSW approximate index (classified experimental; recall/deletion/persistence documented, not yet guaranteed)
- OPFS and Chrome-storage adapters (hardened, experimental)

### Changed

- WASM operations report unavailable unless a real backend is loaded, preserving SIMD/scalar fallback instead of advertising placeholder acceleration
- README, `docs/API.md`, `docs/ADAPTERS.md`, and `docs/MIGRATIONS.md` rewritten so every claim maps to verified, exported behavior
- All production `console.*` calls replaced with a structured logger so output can be suppressed
- HNSW `pruneConnections` lookup converted from `Array.includes()` (O(n)) to `Set.has()` (O(1))
- `SearchOptions` is now a closed, validated contract; `maxResults`/`batchSize` are bounded (≤ 50,000) to prevent memory exhaustion

### Fixed

- ESM bundle was tree-shaken to broken empty exports by `sideEffects: false`; scoped to `["./src/**/*.ts"]` so the published bundle is valid and consumer tree-shaking still works
- CommonJS bundle crashed Node's parser on `import.meta`; per-format shims keep `import.meta` out of CJS output
- `SharedMemoryManager.sharedMemoryBatchSearch()` returns top-k results instead of an empty placeholder
- Persisted HNSW index lifecycle: validates against storage on reopen, rebuilds/disables stale indexes
- WebGPU `uncapturederror` listener removed in `cleanup()`, preventing accumulation across `init()` calls
- HNSW entry-point re-election crash on deletion of the current entry point

### Added

- Unified `verify:production` release gate composing lint, format, typecheck, tests, build, export-map, package-consumer, documentation-example, acceleration, benchmark-regression, bundle-size, supply-chain, and changelog checks; `prepublishOnly` delegates to it
- `vector-frankl/adapters/*` subpath exports and `WASMManager` on the main entry
- Observability hooks, health/diagnostics reporting, and graceful-shutdown coverage
- Complete public input validation, ReDoS + memory-exhaustion regression tests, structured error codes, and a public threat model (`docs/SECURITY.md`)
- Real benchmark regression gates with committed baselines; large-dataset and flaky-test detection
- CI production-verification job, dependency/license/provenance/packed-file supply-chain checks, and GitHub production issue templates

### Known limitations

- HNSW recall, deletion, update, and persistence are not yet guaranteed (experimental)
- WebGPU requires compatible hardware/browser; WebAssembly ships no default module
- SharedArrayBuffer features require cross-origin isolation (COOP/COEP headers)
- IndexedDB stores vectors as plaintext (no encryption at rest) — see [Encryption at Rest](docs/SECURITY.md#encryption-at-rest)
- S3 adapter is single-writer; benchmark baselines are measured against the in-memory adapter under Bun

### Migration

No breaking changes to the core `VectorDB`/`VectorFrankl` method signatures since `1.0.0-beta.1`. The following are **behavior changes** that could affect existing consumers — review them before upgrading. See [docs/MIGRATIONS.md](docs/MIGRATIONS.md) for details.

- **Search-option validation is now strict.** `SearchOptions` is a closed contract: unknown keys are rejected, and `maxResults`/`batchSize` must be positive integers `≤ 50,000`. Code that previously passed unrecognized or out-of-range options (silently ignored before) will now throw at validation time.
- **Cosine scores are normalized.** Cosine similarity is clamped to `[-1, 1]` and scores to `[0, 1]` (`score = 1 - distance / 2`) consistently across CPU, worker, and GPU paths. Absolute score values and ranking thresholds may shift slightly versus beta.1; re-tune any hard-coded score cutoffs.
- **Acceleration claims are honest now.** WebAssembly reports unavailable unless you supply a real module (none is bundled); "SIMD" is optimized JavaScript, not hardware SIMD. Behavior is unchanged at runtime (fallbacks already applied) but capability reporting differs.
- **CommonJS consumers must pass `workerScript`.** In CJS builds, `new WorkerPool()` without an explicit `workerScript` throws synchronously at construction (ESM resolves it automatically via `import.meta.url`).
- **Removed dead `NamespaceConfig` fields** (`indexStrategy`, `compression`, `compressionConfig`) that never affected runtime.

### Verification evidence

- `bun run verify:production` passes end-to-end (all 13 sub-gates green); 2,200 unit tests pass (0 failures); all 6 packed-tarball consumers (Bun/Node × ESM/CJS, TypeScript, browser) import and run core flows.
- Post-release smoke test: after publish, run `npm view vector-frankl version` and import `vector-frankl` in a fresh ESM + CJS consumer to confirm the published tarball loads.

## [1.0.0-beta.1] - 2025-01-07

### Added

- Initial beta release of Vector Frankl
- Core vector database functionality with IndexedDB storage
- Multiple namespace support for isolated vector collections
- Support for multiple vector formats (Float32Array, Float64Array, Int8Array, Uint8Array, arrays)
- Multiple distance metrics (Cosine, Euclidean, Manhattan, Hamming, Jaccard)
- HNSW (Hierarchical Navigable Small World) indexing for fast similarity search
- Vector compression strategies (Scalar quantization, Product quantization, Binary)
- Storage quota management with eviction policies (LRU, LFU, TTL, Score-based)
- Web Worker pool for parallel processing
- SIMD acceleration for vector operations
- WebGPU support for GPU-accelerated search
- WebAssembly capability detection for optional acceleration
- Comprehensive input validation and security features
- ReDoS (Regular Expression Denial of Service) protection
- Memory safety with configurable limits
- Debug and profiling tools
- Comprehensive benchmarking suite
- Full TypeScript support with strict mode compliance
- Detailed API documentation
- Security best practices guide

### Security

- Input validation for all user inputs
- ReDoS protection with timeout and pattern validation
- Memory limits to prevent exhaustion attacks
- WebAssembly capability detection
- Sanitized error messages to prevent information leakage

### Performance

- Synchronous vector operations for 30-50% performance improvement
- Automatic batch size optimization
- Adaptive index strategy selection
- Zero-copy operations with SharedArrayBuffer support
- Efficient storage with compression options

### Known Issues

- SharedArrayBuffer support limited in some browser contexts
- WebGPU requires compatible hardware and browser
- Some advanced features may not work in all environments

[1.0.0-beta.3]: https://github.com/stevekinney/vector-frankl/releases/tag/v1.0.0-beta.3
[1.0.0-beta.1]: https://github.com/stevekinney/vector-frankl/releases/tag/v1.0.0-beta.1
