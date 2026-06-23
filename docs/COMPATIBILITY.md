# Compatibility Policy

This document states Vector Frankl's Semantic Versioning expectations, supported runtimes and browsers, support window, Experimental API policy, and Deprecation policy.

## Semantic Versioning

Vector Frankl follows [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html).

Given a version number `MAJOR.MINOR.PATCH`:

- **MAJOR** increments on incompatible API changes. A major bump means at least one public symbol was removed, renamed, or changed in a way that requires callers to update their code.
- **MINOR** increments on new backwards-compatible functionality. Existing call sites continue to work without modification.
- **PATCH** increments on backwards-compatible bug fixes. No API surface changes.

Pre-release identifiers (`-alpha.N`, `-beta.N`, `-rc.N`) signal that the API is not yet stable and any part of it may change between pre-release builds without a major version bump.

> [!NOTE] The current version is `1.0.0-beta.1`. Until `1.0.0` stable ships, MINOR and PATCH releases may include breaking changes. Evaluate beta upgrades carefully.

## Supported Runtimes

### Browsers

| Runtime | Minimum Version | Notes |
|---------|----------------|-------|
| Chrome / Edge (Chromium) | 90 | Full support including SIMD and WebGPU where available |
| Firefox | 90 | Full support; WebGPU behind flag until broadly enabled |
| Safari / WebKit | 15.4 | Full support; SharedArrayBuffer requires COOP/COEP headers |

IndexedDB, Web Workers, and `crypto.subtle` are required. Environments that disable these APIs (certain private-browsing modes, locked-down WebViews) will not work.

### Server-Side Runtimes

| Runtime | Minimum Version | Storage Adapter |
|---------|----------------|----------------|
| Bun | 1.3.0 | `FileSystemAdapter`, `SQLiteAdapter`, in-memory |
| Node.js | 18.0.0 | `FileSystemAdapter`, `LevelDBAdapter`, `LMDBAdapter`, in-memory |

Node.js support is provided on a best-effort basis. Bun is the primary server-side target and receives the most testing.

## Support Window

| Release track | Active support | Security fixes only |
|---------------|---------------|-------------------|
| Current stable MAJOR | Until next MAJOR | 12 months after next MAJOR |
| Previous stable MAJOR | 6 months after new MAJOR | Until end of security window |
| Pre-release (`alpha`, `beta`, `rc`) | None—upgrade to stable | None |

A "supported" release receives bug fixes and security patches. An "end of life" release receives nothing; users are expected to upgrade.

## Experimental API Policy

Some features are shipped early to gather feedback. These are marked **Experimental** in their JSDoc and in this documentation.

Rules for Experimental APIs:

- They ship under a feature-flag import path (e.g., `vector-frankl/experimental`) **or** are annotated with `@experimental` in their JSDoc comments.
- They may change or be removed in any MINOR or PATCH release without a MAJOR bump.
- They are excluded from the Deprecation policy below—Experimental features can be removed without a deprecation cycle.
- They are not covered by the support window above.

Current Experimental features:

- **WebGPU acceleration** (`WebGPUAccelerator`): the GPU pipeline API may change as browser implementations stabilize.
- **Shared memory batch search** (`SharedMemoryManager.sharedMemoryBatchSearch`): zero-copy search across `SharedArrayBuffer`; requires COOP/COEP headers and may be redesigned.
- **Product quantization** (`compression: { strategy: 'product' }`): codebook training API is not yet stable.

When an Experimental feature graduates to stable it will be announced in the changelog and the `@experimental` annotation will be removed.

## Deprecation Policy

When a stable public API needs to change, the following process applies:

**Step 1 — Deprecation notice.** The symbol is annotated with `@deprecated` in its JSDoc, naming the replacement and the version in which the old form will be removed. A `DeprecationWarning` is logged at runtime (using the structured logger, so it can be suppressed) the first time the deprecated path is exercised.

**Step 2 — Migration window.** The deprecated symbol remains functional for at least one full MINOR release cycle (or 90 days, whichever is longer) after the deprecation notice ships.

**Step 3 — Removal.** The symbol is removed in the next MAJOR release after the migration window closes. The removal is documented in the changelog and the migration guide.

### What is covered

The Deprecation policy applies to all public exports that are not marked `@experimental` or `@internal`.

### What is not covered

- `@internal` symbols (not exported, or explicitly marked internal)
- `@experimental` symbols (see Experimental API Policy above)
- Anything under `vector-frankl/internal/*` import paths
- Behaviour that was always undocumented or never part of the public API contract

## Reporting Compatibility Issues

If you encounter behaviour that contradicts this policy—an undocumented breaking change in a MINOR release, a deprecated symbol removed early, a supported runtime that doesn't work—please open an issue:

```bash
gh issue create --repo stevekinney/vector-frankl \
  --title "Compatibility: <brief description>" \
  --label "compatibility"
```

Include the package version, runtime and version, and a minimal reproduction.
