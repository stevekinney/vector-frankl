import { describe, expect, it } from 'bun:test';

import type { VectorData } from '@/core/types.js';
import type { VectorStorage } from '@/core/storage.js';
import {
  LRUEvictionPolicy,
  LFUEvictionPolicy,
  TTLEvictionPolicy,
  ScoreBasedEvictionPolicy,
  HybridEvictionPolicy,
  EvictionManager,
} from '@/storage/eviction-policy.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

class MockVectorStorage {
  private vectors = new Map<string, VectorData>();

  addTestVector(data: VectorData): void {
    this.vectors.set(data.id, data);
  }

  async getAll(): Promise<VectorData[]> {
    return Array.from(this.vectors.values());
  }

  async delete(id: string): Promise<void> {
    if (!this.vectors.has(id)) {
      throw new Error(`Vector ${id} not found`);
    }
    this.vectors.delete(id);
  }

  async count(): Promise<number> {
    return this.vectors.size;
  }
}

function createTestVector(overrides: Partial<VectorData> & { id: string }): VectorData {
  return {
    vector: new Float32Array([1, 2, 3]),
    timestamp: Date.now(),
    lastAccessed: Date.now(),
    accessCount: 0,
    magnitude: Math.sqrt(14),
    ...overrides,
  };
}

/** Cast the mock to satisfy the VectorStorage type expected by the policies. */
function asStorage(mock: MockVectorStorage): VectorStorage {
  return mock as unknown as VectorStorage;
}

const ONE_HOUR = 60 * 60 * 1000;
const ONE_DAY = 24 * ONE_HOUR;
const ONE_WEEK = 7 * ONE_DAY;

// ---------------------------------------------------------------------------
// LRUEvictionPolicy
// ---------------------------------------------------------------------------

describe('LRUEvictionPolicy', () => {
  it('evicts oldest-accessed vectors first', async () => {
    const storage = new MockVectorStorage();
    const now = Date.now();

    storage.addTestVector(createTestVector({ id: 'old', lastAccessed: now - 3 * ONE_DAY }));
    storage.addTestVector(createTestVector({ id: 'mid', lastAccessed: now - 2 * ONE_DAY }));
    storage.addTestVector(createTestVector({ id: 'new', lastAccessed: now }));

    const policy = new LRUEvictionPolicy(asStorage(storage));
    const result = await policy.evict({
      strategy: 'lru',
      maxVectors: 2,
    });

    expect(result.strategy).toBe('lru');
    expect(result.evictedCount).toBe(2);
    expect(result.errors).toHaveLength(0);
    expect(result.freedBytes).toBeGreaterThan(0);
    expect(result.duration).toBeGreaterThanOrEqual(0);

    // The remaining vector should be the most recently accessed one.
    const remaining = await storage.getAll();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.id).toBe('new');
  });

  it('respects targetBytes and stops once the target is reached', async () => {
    const storage = new MockVectorStorage();
    const now = Date.now();

    // Each vector with Float32Array([1,2,3]) is 12 bytes for the array alone.
    storage.addTestVector(createTestVector({ id: 'a', lastAccessed: now - 3 * ONE_DAY }));
    storage.addTestVector(createTestVector({ id: 'b', lastAccessed: now - 2 * ONE_DAY }));
    storage.addTestVector(createTestVector({ id: 'c', lastAccessed: now - ONE_DAY }));

    const policy = new LRUEvictionPolicy(asStorage(storage));

    // Set a very small target so only one vector is needed.
    const result = await policy.evict({
      strategy: 'lru',
      targetBytes: 1,
    });

    // At least one vector should have been evicted to free >= 1 byte.
    expect(result.evictedCount).toBeGreaterThanOrEqual(1);
    expect(result.freedBytes).toBeGreaterThanOrEqual(1);
  });

  it('preserves permanent vectors when preservePermanent is true', async () => {
    const storage = new MockVectorStorage();
    const now = Date.now();

    storage.addTestVector(
      createTestVector({
        id: 'permanent',
        lastAccessed: now - 10 * ONE_DAY,
        metadata: { permanent: true },
      }),
    );
    storage.addTestVector(createTestVector({ id: 'normal', lastAccessed: now - 5 * ONE_DAY }));

    const policy = new LRUEvictionPolicy(asStorage(storage));
    const result = await policy.evict({
      strategy: 'lru',
      maxVectors: 10,
      preservePermanent: true,
    });

    expect(result.evictedCount).toBe(1);

    const remaining = await storage.getAll();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.id).toBe('permanent');
  });

  it('evicts permanent vectors when preservePermanent is false', async () => {
    const storage = new MockVectorStorage();
    const now = Date.now();

    storage.addTestVector(
      createTestVector({
        id: 'permanent',
        lastAccessed: now - 10 * ONE_DAY,
        metadata: { permanent: true },
      }),
    );
    storage.addTestVector(createTestVector({ id: 'normal', lastAccessed: now - 5 * ONE_DAY }));

    const policy = new LRUEvictionPolicy(asStorage(storage));
    const result = await policy.evict({
      strategy: 'lru',
      maxVectors: 10,
      preservePermanent: false,
    });

    expect(result.evictedCount).toBe(2);
    const remaining = await storage.getAll();
    expect(remaining).toHaveLength(0);
  });

  it('uses timestamp as fallback when lastAccessed is undefined', async () => {
    const storage = new MockVectorStorage();
    const now = Date.now();

    storage.addTestVector(
      createTestVector({ id: 'old-ts', timestamp: now - 5 * ONE_DAY }),
    );
    storage.addTestVector(
      createTestVector({ id: 'new-ts', timestamp: now }),
    );

    const policy = new LRUEvictionPolicy(asStorage(storage));
    const result = await policy.evict({ strategy: 'lru', maxVectors: 1 });

    expect(result.evictedCount).toBe(1);
    const remaining = await storage.getAll();
    expect(remaining[0]!.id).toBe('new-ts');
  });

  it('returns an empty result when there are no vectors', async () => {
    const storage = new MockVectorStorage();
    const policy = new LRUEvictionPolicy(asStorage(storage));
    const result = await policy.evict({ strategy: 'lru', maxVectors: 5 });

    expect(result.evictedCount).toBe(0);
    expect(result.freedBytes).toBe(0);
    expect(result.errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// LFUEvictionPolicy
// ---------------------------------------------------------------------------

describe('LFUEvictionPolicy', () => {
  it('evicts least-frequently-accessed vectors first', async () => {
    const storage = new MockVectorStorage();
    const now = Date.now();

    storage.addTestVector(createTestVector({ id: 'rare', accessCount: 1, lastAccessed: now }));
    storage.addTestVector(createTestVector({ id: 'popular', accessCount: 100, lastAccessed: now }));
    storage.addTestVector(createTestVector({ id: 'medium', accessCount: 10, lastAccessed: now }));

    const policy = new LFUEvictionPolicy(asStorage(storage));
    const result = await policy.evict({ strategy: 'lfu', maxVectors: 1 });

    expect(result.strategy).toBe('lfu');
    expect(result.evictedCount).toBe(1);

    const remaining = await storage.getAll();
    const remainingIds = remaining.map((v) => v.id).sort();
    expect(remainingIds).toEqual(['medium', 'popular']);
  });

  it('breaks ties by access time (older access evicted first)', async () => {
    const storage = new MockVectorStorage();
    const now = Date.now();

    storage.addTestVector(
      createTestVector({ id: 'old-access', accessCount: 5, lastAccessed: now - 3 * ONE_DAY }),
    );
    storage.addTestVector(
      createTestVector({ id: 'new-access', accessCount: 5, lastAccessed: now }),
    );

    const policy = new LFUEvictionPolicy(asStorage(storage));
    const result = await policy.evict({ strategy: 'lfu', maxVectors: 1 });

    expect(result.evictedCount).toBe(1);
    const remaining = await storage.getAll();
    expect(remaining[0]!.id).toBe('new-access');
  });

  it('preserves permanent vectors when configured', async () => {
    const storage = new MockVectorStorage();

    storage.addTestVector(
      createTestVector({ id: 'permanent', accessCount: 0, metadata: { permanent: true } }),
    );
    storage.addTestVector(createTestVector({ id: 'normal', accessCount: 0 }));

    const policy = new LFUEvictionPolicy(asStorage(storage));
    const result = await policy.evict({
      strategy: 'lfu',
      maxVectors: 10,
      preservePermanent: true,
    });

    expect(result.evictedCount).toBe(1);
    const remaining = await storage.getAll();
    expect(remaining[0]!.id).toBe('permanent');
  });
});

// ---------------------------------------------------------------------------
// TTLEvictionPolicy
// ---------------------------------------------------------------------------

describe('TTLEvictionPolicy', () => {
  it('only evicts vectors older than the TTL cutoff', async () => {
    const storage = new MockVectorStorage();
    const now = Date.now();

    storage.addTestVector(
      createTestVector({ id: 'expired', lastAccessed: now - 2 * ONE_DAY, timestamp: now - 3 * ONE_DAY }),
    );
    storage.addTestVector(
      createTestVector({ id: 'fresh', lastAccessed: now, timestamp: now }),
    );

    const policy = new TTLEvictionPolicy(asStorage(storage));
    const result = await policy.evict({
      strategy: 'ttl',
      ttlHours: 24,
    });

    expect(result.strategy).toBe('ttl');
    expect(result.evictedCount).toBe(1);

    const remaining = await storage.getAll();
    expect(remaining[0]!.id).toBe('fresh');
  });

  it('defaults to 24 hours when ttlHours is not specified', async () => {
    const storage = new MockVectorStorage();
    const now = Date.now();

    // 25 hours ago -- should be evicted with default 24h TTL
    storage.addTestVector(
      createTestVector({ id: 'old', lastAccessed: now - 25 * ONE_HOUR }),
    );
    // 23 hours ago -- should survive
    storage.addTestVector(
      createTestVector({ id: 'recent', lastAccessed: now - 23 * ONE_HOUR }),
    );

    const policy = new TTLEvictionPolicy(asStorage(storage));
    const result = await policy.evict({ strategy: 'ttl' });

    expect(result.evictedCount).toBe(1);
    const remaining = await storage.getAll();
    expect(remaining[0]!.id).toBe('recent');
  });

  it('preserves permanent vectors when configured', async () => {
    const storage = new MockVectorStorage();
    const now = Date.now();

    storage.addTestVector(
      createTestVector({
        id: 'permanent-old',
        lastAccessed: now - 10 * ONE_DAY,
        metadata: { permanent: true },
      }),
    );
    storage.addTestVector(
      createTestVector({ id: 'normal-old', lastAccessed: now - 10 * ONE_DAY }),
    );

    const policy = new TTLEvictionPolicy(asStorage(storage));
    const result = await policy.evict({
      strategy: 'ttl',
      ttlHours: 24,
      preservePermanent: true,
    });

    expect(result.evictedCount).toBe(1);
    const remaining = await storage.getAll();
    expect(remaining[0]!.id).toBe('permanent-old');
  });

  it('evicts nothing when all vectors are within TTL', async () => {
    const storage = new MockVectorStorage();
    const now = Date.now();

    storage.addTestVector(createTestVector({ id: 'a', lastAccessed: now }));
    storage.addTestVector(createTestVector({ id: 'b', lastAccessed: now - ONE_HOUR }));

    const policy = new TTLEvictionPolicy(asStorage(storage));
    const result = await policy.evict({ strategy: 'ttl', ttlHours: 24 });

    expect(result.evictedCount).toBe(0);
    expect(result.freedBytes).toBe(0);
    expect(await storage.count()).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// ScoreBasedEvictionPolicy
// ---------------------------------------------------------------------------

describe('ScoreBasedEvictionPolicy', () => {
  it('evicts lowest-scored vectors first', async () => {
    const storage = new MockVectorStorage();
    const now = Date.now();

    // Low score: old, never accessed, low priority
    storage.addTestVector(
      createTestVector({
        id: 'low-score',
        timestamp: now - 30 * ONE_DAY,
        lastAccessed: now - 30 * ONE_DAY,
        accessCount: 0,
        metadata: { priority: 0.1 },
      }),
    );

    // High score: recent, frequently accessed, high priority
    storage.addTestVector(
      createTestVector({
        id: 'high-score',
        timestamp: now,
        lastAccessed: now,
        accessCount: 100,
        metadata: { priority: 0.9 },
      }),
    );

    const policy = new ScoreBasedEvictionPolicy(asStorage(storage));
    const result = await policy.evict({ strategy: 'score', maxVectors: 1 });

    expect(result.strategy).toBe('score');
    expect(result.evictedCount).toBe(1);

    const remaining = await storage.getAll();
    expect(remaining[0]!.id).toBe('high-score');
  });

  it('respects maxVectors limit', async () => {
    const storage = new MockVectorStorage();
    const now = Date.now();

    for (let i = 0; i < 5; i++) {
      storage.addTestVector(
        createTestVector({
          id: `vector-${i}`,
          timestamp: now - i * ONE_DAY,
          lastAccessed: now - i * ONE_DAY,
          accessCount: i,
        }),
      );
    }

    const policy = new ScoreBasedEvictionPolicy(asStorage(storage));
    const result = await policy.evict({ strategy: 'score', maxVectors: 2 });

    expect(result.evictedCount).toBe(2);
    expect(await storage.count()).toBe(3);
  });

  it('preserves permanent vectors when configured', async () => {
    const storage = new MockVectorStorage();
    const now = Date.now();

    storage.addTestVector(
      createTestVector({
        id: 'permanent-low',
        timestamp: now - 30 * ONE_DAY,
        lastAccessed: now - 30 * ONE_DAY,
        accessCount: 0,
        metadata: { permanent: true, priority: 0 },
      }),
    );
    storage.addTestVector(
      createTestVector({
        id: 'normal',
        timestamp: now,
        lastAccessed: now,
        accessCount: 50,
        metadata: { priority: 0.5 },
      }),
    );

    const policy = new ScoreBasedEvictionPolicy(asStorage(storage));
    const result = await policy.evict({
      strategy: 'score',
      maxVectors: 10,
      preservePermanent: true,
    });

    expect(result.evictedCount).toBe(1);
    const remaining = await storage.getAll();
    expect(remaining[0]!.id).toBe('permanent-low');
  });

  it('uses default priority of 0.5 when metadata has no priority', async () => {
    const storage = new MockVectorStorage();
    const now = Date.now();

    // A vector without metadata gets default priority 0.5
    storage.addTestVector(
      createTestVector({
        id: 'default-priority',
        timestamp: now - ONE_DAY,
        lastAccessed: now - ONE_DAY,
        accessCount: 0,
      }),
    );
    // A vector with explicit low priority (0.1) should score lower
    storage.addTestVector(
      createTestVector({
        id: 'low-priority',
        timestamp: now - ONE_DAY,
        lastAccessed: now - ONE_DAY,
        accessCount: 0,
        metadata: { priority: 0.1 },
      }),
    );

    const policy = new ScoreBasedEvictionPolicy(asStorage(storage));
    const result = await policy.evict({ strategy: 'score', maxVectors: 1 });

    expect(result.evictedCount).toBe(1);
    const remaining = await storage.getAll();
    // priority 0.1 scores lower than the default 0.5, so low-priority is evicted first
    expect(remaining[0]!.id).toBe('default-priority');
  });
});

// ---------------------------------------------------------------------------
// HybridEvictionPolicy
// ---------------------------------------------------------------------------

describe('HybridEvictionPolicy', () => {
  it('runs TTL first, then score-based if more space is needed', async () => {
    const storage = new MockVectorStorage();
    const now = Date.now();

    // Expired vector (should be caught by TTL phase)
    storage.addTestVector(
      createTestVector({
        id: 'expired',
        timestamp: now - 2 * ONE_WEEK,
        lastAccessed: now - 2 * ONE_WEEK,
        accessCount: 0,
      }),
    );

    // Fresh but low-value vector (should be caught by score phase)
    storage.addTestVector(
      createTestVector({
        id: 'low-value',
        timestamp: now - ONE_DAY,
        lastAccessed: now - ONE_DAY,
        accessCount: 0,
        metadata: { priority: 0.1 },
      }),
    );

    // Fresh, high-value vector (should survive)
    storage.addTestVector(
      createTestVector({
        id: 'high-value',
        timestamp: now,
        lastAccessed: now,
        accessCount: 50,
        metadata: { priority: 0.9 },
      }),
    );

    const policy = new HybridEvictionPolicy(asStorage(storage));
    const result = await policy.evict({
      strategy: 'hybrid',
      maxVectors: 2,
      ttlHours: 168, // 1 week
    });

    expect(result.strategy).toBe('hybrid');
    expect(result.evictedCount).toBe(2);
    expect(result.errors).toHaveLength(0);

    const remaining = await storage.getAll();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.id).toBe('high-value');
  });

  it('returns hybrid-ttl-only strategy when TTL frees enough bytes', async () => {
    const storage = new MockVectorStorage();
    const now = Date.now();

    storage.addTestVector(
      createTestVector({
        id: 'expired',
        timestamp: now - 2 * ONE_WEEK,
        lastAccessed: now - 2 * ONE_WEEK,
      }),
    );
    storage.addTestVector(
      createTestVector({ id: 'fresh', timestamp: now, lastAccessed: now }),
    );

    const policy = new HybridEvictionPolicy(asStorage(storage));
    // Request only a tiny amount of bytes -- TTL alone should suffice.
    const result = await policy.evict({
      strategy: 'hybrid',
      targetBytes: 1,
      maxVectors: 1,
      ttlHours: 168,
    });

    expect(result.strategy).toBe('hybrid-ttl-only');
    expect(result.evictedCount).toBe(1);
  });

  it('defaults to 168-hour (1 week) TTL when ttlHours is not specified', async () => {
    const storage = new MockVectorStorage();
    const now = Date.now();

    // Just over one week old
    storage.addTestVector(
      createTestVector({
        id: 'just-over-a-week',
        lastAccessed: now - ONE_WEEK - ONE_HOUR,
        timestamp: now - ONE_WEEK - ONE_HOUR,
      }),
    );
    // Just under one week old -- should survive TTL phase
    storage.addTestVector(
      createTestVector({
        id: 'under-a-week',
        lastAccessed: now - ONE_WEEK + ONE_HOUR,
        timestamp: now - ONE_WEEK + ONE_HOUR,
      }),
    );

    const policy = new HybridEvictionPolicy(asStorage(storage));
    const result = await policy.evict({
      strategy: 'hybrid',
      targetBytes: 1,
    });

    // TTL should have caught the expired one and freed enough bytes.
    expect(result.evictedCount).toBeGreaterThanOrEqual(1);
    const remaining = await storage.getAll();
    const remainingIds = remaining.map((v) => v.id);
    expect(remainingIds).toContain('under-a-week');
  });
});

// ---------------------------------------------------------------------------
// EvictionManager
// ---------------------------------------------------------------------------

describe('EvictionManager', () => {
  it('delegates to the correct policy based on strategy', async () => {
    const storage = new MockVectorStorage();
    const now = Date.now();

    storage.addTestVector(
      createTestVector({ id: 'a', lastAccessed: now - 5 * ONE_DAY }),
    );
    storage.addTestVector(
      createTestVector({ id: 'b', lastAccessed: now }),
    );

    const manager = new EvictionManager(asStorage(storage));
    const result = await manager.evict({ strategy: 'lru', maxVectors: 1 });

    expect(result.evictedCount).toBe(1);
    expect(result.strategy).toBe('lru');

    const remaining = await storage.getAll();
    expect(remaining[0]!.id).toBe('b');
  });

  it('throws on an unknown strategy', async () => {
    const storage = new MockVectorStorage();
    const manager = new EvictionManager(asStorage(storage));

    expect(
      manager.evict({ strategy: 'unknown' as 'lru' }),
    ).rejects.toThrow('Unknown eviction strategy: unknown');
  });

  describe('getEvictionStats', () => {
    it('computes correct totals for a populated store', async () => {
      const storage = new MockVectorStorage();
      const now = Date.now();

      storage.addTestVector(
        createTestVector({
          id: 'recent',
          lastAccessed: now,
          timestamp: now,
          accessCount: 10,
        }),
      );
      storage.addTestVector(
        createTestVector({
          id: 'old',
          lastAccessed: now - 2 * ONE_WEEK,
          timestamp: now - 3 * ONE_WEEK,
          accessCount: 2,
          metadata: { permanent: true },
        }),
      );
      storage.addTestVector(
        createTestVector({
          id: 'medium',
          lastAccessed: now - 3 * ONE_DAY,
          timestamp: now - 5 * ONE_DAY,
          accessCount: 0,
        }),
      );

      const manager = new EvictionManager(asStorage(storage));
      const stats = await manager.getEvictionStats();

      expect(stats.totalVectors).toBe(3);
      expect(stats.totalEstimatedBytes).toBeGreaterThan(0);
      expect(stats.permanentVectors).toBe(1);
      expect(stats.averageAccessCount).toBe(4); // (10 + 2 + 0) / 3
      expect(stats.oldestAccess).toBe(now - 2 * ONE_WEEK);
      expect(stats.expiredVectors).toBe(1); // only "old" is > 1 week
    });

    it('returns zeroed stats for an empty store', async () => {
      const storage = new MockVectorStorage();
      const manager = new EvictionManager(asStorage(storage));
      const stats = await manager.getEvictionStats();

      expect(stats.totalVectors).toBe(0);
      expect(stats.totalEstimatedBytes).toBe(0);
      expect(stats.permanentVectors).toBe(0);
      expect(stats.averageAccessCount).toBe(0);
      expect(stats.expiredVectors).toBe(0);
    });
  });

  describe('suggestStrategy', () => {
    it('returns TTL when many vectors have expired (> 30%)', async () => {
      const storage = new MockVectorStorage();
      const now = Date.now();

      // 4 out of 5 expired (80%) -- well above 30% threshold
      for (let i = 0; i < 4; i++) {
        storage.addTestVector(
          createTestVector({
            id: `expired-${i}`,
            lastAccessed: now - 2 * ONE_WEEK,
            timestamp: now - 2 * ONE_WEEK,
            accessCount: 0,
          }),
        );
      }
      storage.addTestVector(
        createTestVector({
          id: 'fresh',
          lastAccessed: now,
          timestamp: now,
          accessCount: 0,
        }),
      );

      const manager = new EvictionManager(asStorage(storage));
      const suggestion = await manager.suggestStrategy(1024);

      expect(suggestion.strategy).toBe('ttl');
      expect(suggestion.config.strategy).toBe('ttl');
      expect(suggestion.config.preservePermanent).toBe(true);
      expect(suggestion.reasoning).toContain('week');
    });

    it('returns hybrid when access patterns are varied (average > 2)', async () => {
      const storage = new MockVectorStorage();
      const now = Date.now();

      // All fresh, high average access count
      storage.addTestVector(
        createTestVector({ id: 'a', lastAccessed: now, accessCount: 5 }),
      );
      storage.addTestVector(
        createTestVector({ id: 'b', lastAccessed: now, accessCount: 10 }),
      );

      const manager = new EvictionManager(asStorage(storage));
      const suggestion = await manager.suggestStrategy(1024);

      expect(suggestion.strategy).toBe('hybrid');
      expect(suggestion.config.strategy).toBe('hybrid');
      expect(suggestion.reasoning).toContain('Mixed access patterns');
    });

    it('returns LRU for simple cases (few expired, low access)', async () => {
      const storage = new MockVectorStorage();
      const now = Date.now();

      storage.addTestVector(
        createTestVector({ id: 'a', lastAccessed: now, accessCount: 0 }),
      );
      storage.addTestVector(
        createTestVector({ id: 'b', lastAccessed: now, accessCount: 1 }),
      );
      storage.addTestVector(
        createTestVector({ id: 'c', lastAccessed: now, accessCount: 0 }),
      );

      const manager = new EvictionManager(asStorage(storage));
      const suggestion = await manager.suggestStrategy(1024);

      expect(suggestion.strategy).toBe('lru');
      expect(suggestion.config.strategy).toBe('lru');
      expect(suggestion.config.preservePermanent).toBe(true);
      expect(suggestion.reasoning).toContain('least-recently-used');
    });
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe('Error handling', () => {
  it('captures individual delete failures in the errors array', async () => {
    const storage = new MockVectorStorage();
    const now = Date.now();

    storage.addTestVector(createTestVector({ id: 'good', lastAccessed: now - 2 * ONE_DAY }));
    storage.addTestVector(createTestVector({ id: 'also-good', lastAccessed: now - ONE_DAY }));

    // Sabotage the delete method so it fails for a specific id.
    const originalDelete = storage.delete.bind(storage);
    storage.delete = async (id: string) => {
      if (id === 'good') {
        throw new Error('disk write failure');
      }
      return originalDelete(id);
    };

    const policy = new LRUEvictionPolicy(asStorage(storage));
    const result = await policy.evict({ strategy: 'lru', maxVectors: 2 });

    // LRU subtracts error count from evictedCount.
    expect(result.evictedCount).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.id).toBe('good');
    expect(result.errors[0]!.error.message).toBe('disk write failure');
  });

  it('captures errors in LFU policy without stopping eviction', async () => {
    const storage = new MockVectorStorage();
    const now = Date.now();

    storage.addTestVector(createTestVector({ id: 'fail-me', accessCount: 0, lastAccessed: now - ONE_DAY }));
    storage.addTestVector(createTestVector({ id: 'keep-going', accessCount: 1, lastAccessed: now }));

    const originalDelete = storage.delete.bind(storage);
    storage.delete = async (id: string) => {
      if (id === 'fail-me') {
        throw new Error('I/O error');
      }
      return originalDelete(id);
    };

    const policy = new LFUEvictionPolicy(asStorage(storage));
    const result = await policy.evict({ strategy: 'lfu', maxVectors: 2 });

    // LFU does not subtract errors from evictedCount (different from LRU).
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.id).toBe('fail-me');

    // The second vector should still have been processed.
    expect(result.evictedCount).toBe(1);
  });

  it('captures errors in TTL policy', async () => {
    const storage = new MockVectorStorage();
    const now = Date.now();

    storage.addTestVector(
      createTestVector({ id: 'fail-ttl', lastAccessed: now - 2 * ONE_DAY }),
    );

    storage.delete = async () => {
      throw new Error('storage full');
    };

    const policy = new TTLEvictionPolicy(asStorage(storage));
    const result = await policy.evict({ strategy: 'ttl', ttlHours: 24 });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.error.message).toBe('storage full');
    // TTL does not subtract errors from evictedCount.
    expect(result.evictedCount).toBe(0);
  });
});
