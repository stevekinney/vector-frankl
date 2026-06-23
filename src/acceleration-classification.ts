/**
 * Acceleration path classification for vector-frankl.
 *
 * Each acceleration path is classified as one of:
 *   - "production" — implemented, tested, with verified correctness and a defined fallback.
 *   - "experimental" — present in the codebase but depends on optional browser APIs
 *     or lacks a bundled binary; not guaranteed to activate in any given environment.
 *
 * This module is the single source of truth consulted by `verify:acceleration`.
 */

/** Classification of a single acceleration path. */
export type AccelerationStatus = 'production' | 'experimental';

export interface AccelerationClassification {
  /** Short identifier used in docs and error messages. */
  name: string;
  /** Classification level. */
  status: AccelerationStatus;
  /**
   * One-sentence explanation of the classification rationale and the
   * fallback that activates when this path is unavailable.
   */
  rationale: string;
}

/**
 * Authoritative classification table for every acceleration path.
 *
 * **SIMD — Production-supported**
 * `SIMDOperations` is implemented entirely in JavaScript using TypedArray
 * loops and cache-friendly unrolled inner loops. This path activates on
 * every JS engine that supports TypedArrays (all modern browsers and Bun)
 * with no external dependencies. It also performs capability detection for
 * native WebAssembly SIMD and uses that information for threshold tuning,
 * but the core loop itself is pure JS and is therefore always available.
 * Fallback: the same scalar path reachable via `SIMDOperations` with
 * `enableSIMD: false` or vectors shorter than `simdThreshold`.
 *
 * **WebAssembly — Experimental**
 * `WASMManager` detects the WebAssembly platform API and feature flags
 * (SIMD, bulk-memory, threads), but no compiled `.wasm` vector-operation
 * module is bundled with the package. `isAvailable()` therefore always
 * returns `false` at runtime; callers fall through to SIMD/scalar.
 * A `modulePath` option is reserved for a future real module.
 *
 * **WebGPU — Experimental**
 * `WebGPUManager` and `GPUSearchEngine` implement full WGSL compute shaders
 * for cosine, euclidean, manhattan, and dot-product similarity. However,
 * WebGPU requires `navigator.gpu` which is only available in Chrome 113+,
 * Edge 113+, and behind flags in other browsers; it is entirely absent in
 * Node/Bun. Initialization is guarded by `typeof navigator !== 'undefined' &&
 * 'gpu' in navigator`. Fallback: workers → sequential SIMD/scalar.
 *
 * **Web Workers — Production-supported (browser only)**
 * `WorkerPool` uses the standard `Worker` constructor and runs entirely in
 * JavaScript. It is available in all modern browsers and is guarded by
 * `typeof Worker !== 'undefined'`. It is intentionally absent in Bun/Node
 * (no DOM Worker API), where the library falls back to sequential search.
 * Shared-memory optimisations within the pool are gated on
 * `SharedArrayBuffer` availability (see below).
 *
 * **Shared Memory — Experimental**
 * `SharedMemoryManager` and the shared-memory search path require
 * `SharedArrayBuffer`, which demands cross-origin isolation headers
 * (`Cross-Origin-Opener-Policy: same-origin` +
 * `Cross-Origin-Embedder-Policy: require-corp`). Without those headers
 * the API is undefined even in supporting browsers. Fallback: standard
 * structured-clone `postMessage` path in `WorkerPool`.
 */
export const ACCELERATION_CLASSIFICATIONS: readonly AccelerationClassification[] = [
  {
    name: 'SIMD',
    status: 'production',
    rationale:
      'Implemented as cache-friendly TypedArray loops in pure JavaScript; available on every modern runtime. Fallback: scalar path via enableSIMD:false.',
  },
  {
    name: 'WebAssembly',
    status: 'experimental',
    rationale:
      'Platform API detection succeeds on modern runtimes, but no compiled .wasm module is bundled; isAvailable() always returns false. Fallback: SIMD/scalar.',
  },
  {
    name: 'WebGPU',
    status: 'experimental',
    rationale:
      'Full WGSL compute-shader implementation exists but requires navigator.gpu (Chrome 113+ / Edge 113+). Absent in Node/Bun and older browsers. Fallback: workers then scalar.',
  },
  {
    name: 'Workers',
    status: 'production',
    rationale:
      'Standard Worker API; available in all modern browsers. Not available in Node/Bun (no DOM Worker). Fallback: sequential SIMD/scalar search.',
  },
  {
    name: 'SharedMemory',
    status: 'experimental',
    rationale:
      'Requires SharedArrayBuffer, which is gated on cross-origin isolation response headers. Fallback: structured-clone postMessage path.',
  },
] as const;

/** Convenience lookup by name (case-sensitive). */
export function getClassification(name: string): AccelerationClassification | undefined {
  return ACCELERATION_CLASSIFICATIONS.find((c) => c.name === name);
}

/** Returns all paths at a given status level. */
export function getByStatus(status: AccelerationStatus): AccelerationClassification[] {
  return ACCELERATION_CLASSIFICATIONS.filter((c) => c.status === status);
}
