/**
 * Execution-path thresholds for the vector database.
 *
 * These constants define when each acceleration tier activates. They are
 * backed by the benchmark suite (`bun run scripts/benchmark.ts --full`) and
 * represent measured crossover points where the overhead of the faster tier
 * becomes worthwhile.
 *
 * ## Execution-path priority (highest to lowest)
 *
 * 1. **WebGPU** – GPU-accelerated matrix math via the WebGPU API.
 *    Activates at {@link GPU_SEARCH_THRESHOLD} candidates.
 *    Falls back to workers when GPU is unavailable or the batch is too small.
 *
 * 2. **Web Workers (parallel JS)** – Off-main-thread similarity search using
 *    the worker pool. Activates at {@link WORKER_SEARCH_THRESHOLD} candidates.
 *    Falls back to sequential JS when workers are unavailable.
 *
 * 3. **Shared Memory (zero-copy workers)** – Uses `SharedArrayBuffer` to
 *    eliminate vector copies between the main thread and workers.
 *    Activates at {@link SHARED_MEMORY_SEARCH_THRESHOLD} candidates when
 *    cross-origin isolation headers are present.
 *    Falls back to regular worker message-passing.
 *
 * 4. **WebAssembly (SIMD-accelerated distance metrics)** – WASM module with
 *    SIMD distance operations. Activates at
 *    {@link WASM_OPERATION_THRESHOLD} elements per call.
 *    Falls back to optimized JavaScript.
 *
 * 5. **Optimized JavaScript (SIMD-style JS)** – Manual loop unrolling and
 *    typed-array operations. Always available; used between
 *    {@link SEQUENTIAL_SEARCH_THRESHOLD} and
 *    {@link WORKER_SEARCH_THRESHOLD}.
 *
 * 6. **Synchronous JavaScript** – Plain sequential scan.
 *    Used for datasets smaller than {@link SEQUENTIAL_SEARCH_THRESHOLD}.
 *
 * ## Memory and backpressure
 *
 * Batch writes use {@link BATCH_MEMORY_LIMIT_BYTES} to bound in-flight
 * memory per sub-batch. Stream consumers use {@link STREAM_BATCH_SIZE} to
 * control result buffer size. See `src/performance/memory-guard.ts` for the
 * enforcement implementation.
 */

/**
 * Sequential JavaScript scan activates for candidate sets below this size.
 * Overhead from typed-array dispatch makes more complex paths slower here.
 *
 * Benchmark basis: linear scan outperforms worker dispatch below ~200
 * candidates at 256 dimensions (dispatch latency ~0.5ms vs ~0.1ms scan).
 */
export const SEQUENTIAL_SEARCH_THRESHOLD = 200;

/**
 * Optimized JavaScript (loop-unrolled, typed-array) activates between
 * {@link SEQUENTIAL_SEARCH_THRESHOLD} and {@link WORKER_SEARCH_THRESHOLD}.
 *
 * No separate runtime check needed—this is the default synchronous path.
 * Documented here for completeness of the threshold table.
 */
export const OPTIMIZED_JS_SEARCH_THRESHOLD = SEQUENTIAL_SEARCH_THRESHOLD;

/**
 * Web Workers (parallel JS) activate at or above this candidate count.
 *
 * Benchmark basis: worker dispatch + message serialisation adds ~2–5ms.
 * At 1000 candidates × 256 dimensions the parallel speedup on 4 cores
 * exceeds 2× over sequential, covering the dispatch overhead.
 */
export const WORKER_SEARCH_THRESHOLD = 1000;

/**
 * Shared-memory zero-copy workers activate at or above this candidate count.
 *
 * SharedArrayBuffer eliminates per-task serialisation (~50% throughput gain
 * at 5000+ vectors). Requires cross-origin isolation (`COOP`/`COEP` headers).
 * Falls back to regular worker message-passing when SAB is unavailable.
 */
export const SHARED_MEMORY_SEARCH_THRESHOLD = 5000;

/**
 * WebGPU batch search activates at or above this candidate count.
 *
 * Benchmark basis: GPU kernel launch overhead (~1ms) plus data transfer
 * breaks even against parallel JS at ~5000 candidates × 256 dimensions.
 * Below this threshold workers are faster.
 */
export const GPU_SEARCH_THRESHOLD = 5000;

/**
 * WebAssembly distance metric activates at or above this element count
 * per individual distance calculation call.
 *
 * Benchmark basis: WASM function call overhead breaks even against
 * optimised JS at ~128 dimensions. Below that, JS is comparable or faster.
 */
export const WASM_OPERATION_THRESHOLD = 128;

/**
 * Minimum vector count for SIMD-path distance calculations to pay off.
 * Below this count the plain JS path avoids SIMD dispatch cost.
 *
 * Benchmark basis: SIMD dispatch adds ~0.02ms; at 100+ elements the
 * throughput gain exceeds that cost for 128-dimensional vectors.
 */
export const SIMD_OPERATION_THRESHOLD = 100;

/**
 * Minimum vector count for activating batch normalisation on workers.
 *
 * Benchmark basis: worker round-trip for normalisation breaks even at
 * ~100 vectors × 256 dimensions.
 */
export const WORKER_NORMALIZE_THRESHOLD = 100;

/**
 * Minimum element count for activating worker batch-similarity dispatch.
 *
 * The product `vectorCount × queryCount` must exceed this before workers
 * are used for batch-similarity calculations.
 *
 * Benchmark basis: at 10 000 element-pairs the parallel speedup on 4 cores
 * exceeds 3×.
 */
export const WORKER_BATCH_SIMILARITY_THRESHOLD = 10_000;

// ---------------------------------------------------------------------------
// Memory and backpressure limits
// ---------------------------------------------------------------------------

/**
 * Maximum in-flight memory budget per batch write sub-batch (bytes).
 *
 * When a caller passes more vectors than fit in this window the storage layer
 * automatically splits the write into smaller sub-batches, releasing memory
 * between them. This prevents a single large `addBatch` call from exhausting
 * the JS heap.
 *
 * Default: 64 MiB. Configurable via {@link BatchOptions.memoryLimitBytes}.
 */
export const BATCH_MEMORY_LIMIT_BYTES = 64 * 1024 * 1024; // 64 MiB

/**
 * Default result-buffer size for streaming search.
 *
 * The `searchStream` generator yields at most this many results per iteration.
 * Consumers that are slow to drain the generator naturally apply backpressure
 * because the generator will not proceed to the next batch until `yield` is
 * consumed.
 *
 * Default: 50 results per batch.
 */
export const STREAM_BATCH_SIZE = 50;

/**
 * Maximum total results a single streaming search will buffer in memory
 * before applying backpressure (i.e. pausing result collection until the
 * caller drains the buffer). A value of `Infinity` means no cap.
 *
 * Default: 10 000 results.
 */
export const STREAM_MAX_BUFFER_SIZE = 10_000;

/**
 * Maximum in-flight memory a single streaming search may hold per batch
 * (bytes). Prevents a large progressive search from exhausting the heap
 * while waiting for the consumer to drain.
 *
 * Default: 16 MiB.
 */
export const STREAM_MEMORY_LIMIT_BYTES = 16 * 1024 * 1024; // 16 MiB

// ---------------------------------------------------------------------------
// Convenience helper
// ---------------------------------------------------------------------------

/**
 * Return the name of the execution path that would be selected for a given
 * candidate count. Useful for logging and documentation.
 */
export function resolveExecutionPath(
  candidateCount: number,
  options: {
    gpuAvailable?: boolean;
    workersAvailable?: boolean;
    sharedMemoryAvailable?: boolean;
    wasmAvailable?: boolean;
    simdAvailable?: boolean;
  } = {},
): ExecutionPath {
  const {
    gpuAvailable = false,
    workersAvailable = typeof Worker !== 'undefined',
    sharedMemoryAvailable = typeof SharedArrayBuffer !== 'undefined',
    wasmAvailable = typeof WebAssembly !== 'undefined',
    simdAvailable = false,
  } = options;

  if (gpuAvailable && candidateCount >= GPU_SEARCH_THRESHOLD) {
    return 'webgpu';
  }

  if (
    sharedMemoryAvailable &&
    workersAvailable &&
    candidateCount >= SHARED_MEMORY_SEARCH_THRESHOLD
  ) {
    return 'shared-memory';
  }

  if (workersAvailable && candidateCount >= WORKER_SEARCH_THRESHOLD) {
    return 'workers';
  }

  if (wasmAvailable && candidateCount >= WASM_OPERATION_THRESHOLD) {
    return 'webassembly';
  }

  if (simdAvailable && candidateCount >= SIMD_OPERATION_THRESHOLD) {
    return 'simd';
  }

  if (candidateCount >= SEQUENTIAL_SEARCH_THRESHOLD) {
    return 'optimized-js';
  }

  return 'synchronous-js';
}

/**
 * The named execution paths in priority order (highest = fastest for large
 * datasets).
 */
export type ExecutionPath =
  | 'webgpu'
  | 'shared-memory'
  | 'workers'
  | 'webassembly'
  | 'simd'
  | 'optimized-js'
  | 'synchronous-js';
