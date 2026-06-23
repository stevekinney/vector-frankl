/**
 * Test helpers for checking storage-index invariants.
 *
 * These helpers detect inconsistencies between what is stored in the
 * `StorageAdapter` and what is tracked in the in-memory HNSW index
 * (or any index that supports `exportState()`). They are intentionally
 * kept in test support so that production code carries no diagnostic
 * overhead.
 *
 * Typical usage:
 *
 *   const result = await checkStorageIndexInvariants(db);
 *   assertStorageIndexInvariants(result);
 */

import type { StorageAdapter } from '@/core/types.js';
import type { HNSWIndex } from '@/search/hnsw-index.js';

/**
 * Internals of `VectorDB` that the invariant helpers need.
 * Accessed via `as unknown as VectorDBInternals` in tests.
 */
export interface VectorDBInternals {
  storage: StorageAdapter;
  searchEngine: {
    hnswIndex: HNSWIndex | null;
    useIndex: boolean;
  };
}

/**
 * A single violation found while checking invariants.
 */
export interface InvariantViolation {
  /** Machine-readable category of the violation. */
  kind:
    | 'missing_from_index'
    | 'stale_in_index'
    | 'duplicated_in_index'
    | 'deleted_still_indexed';
  /** Human-readable description with the vector ID that triggered it. */
  message: string;
  /** The vector ID involved in the violation. */
  id: string;
}

/**
 * Full result returned by `checkStorageIndexInvariants`.
 */
export interface InvariantCheckResult {
  /** True only when every invariant holds. */
  valid: boolean;
  /** All detected violations (empty when `valid` is true). */
  violations: InvariantViolation[];
  /** IDs present in storage but missing from the index. */
  missingFromIndex: string[];
  /** IDs present in the index but absent from storage ("stale" / ghost entries). */
  staleInIndex: string[];
  /** IDs that appear more than once in the index's node list. */
  duplicatedInIndex: string[];
  /** Alias of `staleInIndex` — emphasises the "was deleted" cause. */
  deletedStillIndexed: string[];
}

/**
 * Check all storage-index invariants for a `VectorDB` instance.
 *
 * @param dbInternals - The internals extracted from a `VectorDB` via
 *   `db as unknown as VectorDBInternals`.
 * @returns An `InvariantCheckResult` describing every violation found.
 */
export async function checkStorageIndexInvariants(
  dbInternals: VectorDBInternals,
): Promise<InvariantCheckResult> {
  const { storage, searchEngine } = dbInternals;

  const violations: InvariantViolation[] = [];

  // ── 1. Collect IDs from storage ──────────────────────────────────────────
  const allVectors = await storage.getAll();
  const storageIds = new Set(allVectors.map((v) => v.id));

  // ── 2. Collect IDs from the HNSW index ───────────────────────────────────
  // When indexing is disabled there is nothing to compare.
  if (!searchEngine.useIndex || searchEngine.hnswIndex === null) {
    return {
      valid: true,
      violations: [],
      missingFromIndex: [],
      staleInIndex: [],
      duplicatedInIndex: [],
      deletedStillIndexed: [],
    };
  }

  const state = searchEngine.hnswIndex.exportState();
  const rawIndexIds = state.nodes.map((n) => n.id);

  // ── 3. Detect duplicates in the raw list ─────────────────────────────────
  const indexIdCounts = new Map<string, number>();
  for (const id of rawIndexIds) {
    indexIdCounts.set(id, (indexIdCounts.get(id) ?? 0) + 1);
  }

  const duplicatedInIndex: string[] = [];
  for (const [id, count] of indexIdCounts) {
    if (count > 1) {
      duplicatedInIndex.push(id);
      violations.push({
        kind: 'duplicated_in_index',
        id,
        message: `Vector "${id}" appears ${count} times in the HNSW index (expected 1).`,
      });
    }
  }

  const indexIds = new Set(rawIndexIds);

  // ── 4. Detect vectors present in storage but absent from the index ────────
  const missingFromIndex: string[] = [];
  for (const id of storageIds) {
    if (!indexIds.has(id)) {
      missingFromIndex.push(id);
      violations.push({
        kind: 'missing_from_index',
        id,
        message: `Vector "${id}" exists in storage but has no entry in the HNSW index.`,
      });
    }
  }

  // ── 5. Detect ghost entries: present in the index but deleted from storage ─
  const staleInIndex: string[] = [];
  const deletedStillIndexed: string[] = [];
  for (const id of indexIds) {
    if (!storageIds.has(id)) {
      staleInIndex.push(id);
      deletedStillIndexed.push(id);
      violations.push({
        kind: 'deleted_still_indexed',
        id,
        message: `Vector "${id}" is present in the HNSW index but does not exist in storage (stale / ghost entry).`,
      });
    }
  }

  return {
    valid: violations.length === 0,
    violations,
    missingFromIndex,
    staleInIndex,
    duplicatedInIndex,
    deletedStillIndexed,
  };
}

/**
 * Assert that all invariants hold, throwing a descriptive error on failure.
 *
 * Use this inside `expect(...)` blocks:
 *
 *   const result = await checkStorageIndexInvariants(internals);
 *   assertStorageIndexInvariants(result);
 */
export function assertStorageIndexInvariants(result: InvariantCheckResult): void {
  if (result.valid) return;

  const lines = [
    `Storage-index invariant violation(s) detected (${result.violations.length} total):`,
    ...result.violations.map((v, i) => `  [${i + 1}] [${v.kind}] ${v.message}`),
  ];

  throw new Error(lines.join('\n'));
}

/**
 * Convenience wrapper: check invariants and immediately assert.
 * Equivalent to calling `checkStorageIndexInvariants` then `assertStorageIndexInvariants`.
 */
export async function assertInvariants(dbInternals: VectorDBInternals): Promise<void> {
  const result = await checkStorageIndexInvariants(dbInternals);
  assertStorageIndexInvariants(result);
}
