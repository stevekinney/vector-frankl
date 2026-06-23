import { expect } from 'bun:test';

/**
 * The minimal subset of VectorDB's public API that assertInvariants needs.
 *
 * Cast your VectorDB instance to this type before passing it to
 * assertInvariants. The cast is intentionally loose (`as unknown as
 * VectorDBInternals`) so that the helper doesn't need to import the
 * concrete class.
 */
export interface VectorDBInternals {
  getStats(): Promise<{ vectorCount: number; dimension: number; initialized: boolean }>;
  getIndexStats(): { enabled: boolean; nodeCount: number };
}

/**
 * Assert that the search index and the storage layer are in agreement.
 *
 * When the HNSW index is enabled, its node count must equal the number of
 * records in storage. When the index is disabled, there is nothing to
 * compare against storage.
 *
 * Call this after any mutating operation (clear, update, delete, rebuild) to
 * ensure the two subsystems did not diverge.
 */
export async function assertInvariants(db: VectorDBInternals): Promise<void> {
  const stats = await db.getStats();
  const indexStats = db.getIndexStats();

  if (indexStats.enabled) {
    expect(indexStats.nodeCount).toBe(stats.vectorCount);
  }
}
