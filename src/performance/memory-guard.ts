/**
 * Memory profiling and backpressure enforcement for production paths.
 *
 * This module provides two utilities:
 *
 * 1. **MemoryProfiler** – lightweight snapshot-based profiling that records
 *    heap usage before and after an operation. Works in Bun (via
 *    `process.memoryUsage()`) and in browsers (via `performance.memory` when
 *    available). Results are informational only—they do not block execution.
 *
 * 2. **enforceMemoryBounds** – hard cap for batch write sub-batching. Splits
 *    an input array into sub-batches whose estimated in-flight heap footprint
 *    stays within a caller-supplied byte budget. This is the mechanism that
 *    prevents a single large `addBatch` call from exhausting the JS heap.
 *
 * Both utilities are designed to be zero-dependency and environment-agnostic.
 */

import {
  BATCH_MEMORY_LIMIT_BYTES,
  STREAM_MEMORY_LIMIT_BYTES,
} from './execution-thresholds.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A snapshot of heap memory at a single point in time.
 */
export interface MemorySnapshot {
  /** Heap bytes actively used by JS objects at snapshot time. */
  heapUsed: number;
  /** Total heap size committed to the V8 runtime (or 0 if unavailable). */
  heapTotal: number;
  /** External (off-heap) memory held by native objects (or 0 if unavailable). */
  external: number;
  /** Wall-clock timestamp (ms since epoch) when the snapshot was taken. */
  timestamp: number;
}

/**
 * A memory delta between two snapshots (after – before).
 */
export interface MemoryDelta {
  /** Change in heap used (bytes). Positive = growth. */
  heapUsedDelta: number;
  /** Change in heap total (bytes). */
  heapTotalDelta: number;
  /** Change in external memory (bytes). */
  externalDelta: number;
  /** Wall-clock duration (ms) between the two snapshots. */
  durationMs: number;
}

/**
 * A complete memory profile recorded by {@link MemoryProfiler.profile}.
 */
export interface MemoryProfile {
  /** Operation name supplied by the caller. */
  operation: string;
  /** Snapshot taken immediately before the operation. */
  before: MemorySnapshot;
  /** Snapshot taken immediately after the operation. */
  after: MemorySnapshot;
  /** Computed delta (after – before). */
  delta: MemoryDelta;
}

// ---------------------------------------------------------------------------
// MemoryProfiler
// ---------------------------------------------------------------------------

/**
 * Lightweight memory profiler for production operation paths.
 *
 * Uses `process.memoryUsage()` in Bun/Node and `performance.memory` in
 * browsers (Chrome DevTools only). In environments where neither API exists
 * all values are 0—profiling becomes a no-op with negligible overhead.
 *
 * @example
 * ```ts
 * const profiler = new MemoryProfiler();
 * const profile = await profiler.profile('batch-add', async () => {
 *   await db.addBatch(vectors);
 * });
 * // profile.delta.heapUsedDelta is the heap growth in bytes
 * ```
 */
export class MemoryProfiler {
  private profiles: MemoryProfile[] = [];

  /**
   * Take a snapshot of current heap usage.
   */
  snapshot(): MemorySnapshot {
    const timestamp = Date.now();

    // Bun / Node environment
    if (typeof process !== 'undefined' && typeof process.memoryUsage === 'function') {
      const mem = process.memoryUsage();
      return {
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
        external: mem.external,
        timestamp,
      };
    }

    // Browser with performance.memory (Chrome DevTools / some Chromium builds)
    const perfMemory = (
      performance as unknown as {
        memory?: { usedJSHeapSize: number; totalJSHeapSize: number };
      }
    ).memory;
    if (perfMemory) {
      return {
        heapUsed: perfMemory.usedJSHeapSize,
        heapTotal: perfMemory.totalJSHeapSize,
        external: 0,
        timestamp,
      };
    }

    // Fallback: no memory info available
    return { heapUsed: 0, heapTotal: 0, external: 0, timestamp };
  }

  /**
   * Profile a single async operation, returning a {@link MemoryProfile}.
   *
   * The returned profile is also appended to {@link profiles} so callers can
   * accumulate profiles over time.
   */
  async profile<T>(
    operation: string,
    fn: () => Promise<T>,
  ): Promise<{ result: T; profile: MemoryProfile }> {
    const before = this.snapshot();
    const result = await fn();
    const after = this.snapshot();

    const profile: MemoryProfile = {
      operation,
      before,
      after,
      delta: {
        heapUsedDelta: after.heapUsed - before.heapUsed,
        heapTotalDelta: after.heapTotal - before.heapTotal,
        externalDelta: after.external - before.external,
        durationMs: after.timestamp - before.timestamp,
      },
    };

    this.profiles.push(profile);
    return { result, profile };
  }

  /**
   * All profiles recorded since this instance was created (or last reset).
   */
  getProfiles(): readonly MemoryProfile[] {
    return this.profiles;
  }

  /**
   * Clear accumulated profiles.
   */
  reset(): void {
    this.profiles = [];
  }
}

// ---------------------------------------------------------------------------
// enforceMemoryBounds (batch write backpressure)
// ---------------------------------------------------------------------------

/**
 * Estimated bytes per Float32 element stored in a vector.
 * Float32 = 4 bytes; we add 2× overhead for object wrappers, metadata, etc.
 */
const BYTES_PER_FLOAT32_WITH_OVERHEAD = 4 * 2;

/**
 * Estimate the in-flight heap cost of storing a batch of `Float32Array`
 * vectors, given a common dimensionality.
 */
function estimateBatchBytes(count: number, dimension: number): number {
  return count * dimension * BYTES_PER_FLOAT32_WITH_OVERHEAD;
}

/**
 * Split an array into sub-batches whose estimated heap footprint stays within
 * `memoryLimitBytes`. Items that do not have a `dimension` property (or for
 * which no dimension is provided) use `fallbackDimension`.
 *
 * This is the core backpressure primitive: callers iterate over the returned
 * sub-batches one at a time, allowing GC to reclaim memory between batches.
 *
 * @param items - The full input array.
 * @param dimension - Vector dimensionality used for the memory estimate.
 * @param memoryLimitBytes - Maximum bytes per sub-batch.
 * @returns An iterator of sub-batch arrays.
 *
 * @example
 * ```ts
 * for (const subBatch of splitByMemoryBudget(vectors, 256)) {
 *   await storage.putBatch(subBatch);
 * }
 * ```
 */
export function* splitByMemoryBudget<T>(
  items: readonly T[],
  dimension: number,
  memoryLimitBytes: number = BATCH_MEMORY_LIMIT_BYTES,
): Generator<T[]> {
  if (items.length === 0) return;

  // How many items fit in the budget?
  const bytesPerItem = dimension * BYTES_PER_FLOAT32_WITH_OVERHEAD;
  // Guard against zero/negative dimension
  const safeItemBytes = Math.max(bytesPerItem, 1);
  const maxItemsPerBatch = Math.max(1, Math.floor(memoryLimitBytes / safeItemBytes));

  for (let i = 0; i < items.length; i += maxItemsPerBatch) {
    yield items.slice(i, i + maxItemsPerBatch) as T[];
  }
}

/**
 * Verify that a proposed batch write falls within the memory budget. Returns
 * `true` when the batch is safe to proceed as a single operation; `false`
 * when the caller should split it via {@link splitByMemoryBudget}.
 *
 * @param count - Number of vectors in the batch.
 * @param dimension - Vector dimensionality.
 * @param memoryLimitBytes - Budget in bytes (default:
 *   {@link BATCH_MEMORY_LIMIT_BYTES}).
 */
export function isWithinMemoryBudget(
  count: number,
  dimension: number,
  memoryLimitBytes: number = BATCH_MEMORY_LIMIT_BYTES,
): boolean {
  return estimateBatchBytes(count, dimension) <= memoryLimitBytes;
}

// ---------------------------------------------------------------------------
// Stream backpressure helpers
// ---------------------------------------------------------------------------

/**
 * Options for a memory-bounded streaming result buffer.
 */
export interface StreamBackpressureOptions {
  /**
   * Maximum bytes that result batches may collectively occupy in the buffer
   * before the stream pauses. Default: {@link STREAM_MEMORY_LIMIT_BYTES}.
   */
  memoryLimitBytes?: number;
  /**
   * Estimated bytes per search result object (id string + score float +
   * optional metadata). A conservative default of 512 bytes is used when not
   * provided.
   */
  bytesPerResult?: number;
}

/**
 * Estimate bytes used by a batch of search results.
 *
 * This is intentionally conservative. Real metadata objects can be larger;
 * callers can supply a custom `bytesPerResult` estimate.
 */
export function estimateResultBatchBytes(
  resultCount: number,
  bytesPerResult: number = 512,
): number {
  return resultCount * bytesPerResult;
}

/**
 * Calculate the maximum batch size (number of search results) that fits
 * within the stream memory limit.
 *
 * Used by streaming search to size its yield batches so that a slow consumer
 * cannot cause unbounded heap growth.
 *
 * @param options - Backpressure configuration.
 * @returns Maximum results per yielded batch.
 */
export function maxStreamBatchSize(options: StreamBackpressureOptions = {}): number {
  const memoryLimit = options.memoryLimitBytes ?? STREAM_MEMORY_LIMIT_BYTES;
  const bytesPerResult = options.bytesPerResult ?? 512;
  return Math.max(1, Math.floor(memoryLimit / bytesPerResult));
}
