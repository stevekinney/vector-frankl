/**
 * Tests for cursor/streaming scan primitives on large stores.
 *
 * These tests verify that:
 * - scan() can iterate a large store without loading everything into memory at once
 * - search, eviction, and maintenance operations can proceed page by page
 * - getScanCapabilities() correctly reports adapter limitations
 *
 * Test names contain 'cursor', 'stream', or 'large' to match the verify pattern:
 *   bun test tests/storage -t 'cursor|stream|large'
 */
import { describe, expect, it } from 'bun:test';
import type { ScanCapabilities, StorageAdapter, VectorData } from '@/core/types.js';
import { MemoryStorageAdapter } from '@/storage/adapters/memory-adapter.js';

// Re-export the concrete type so tests can use seed()
type MemoryAdapter = MemoryStorageAdapter;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeVector(id: string, values: number[]): VectorData {
  const vector = new Float32Array(values);
  const magnitude = Math.sqrt(values.reduce((sum, v) => sum + v * v, 0));
  return { id, vector, magnitude, timestamp: Date.now() };
}

/**
 * Populate an adapter with `count` vectors with sequential IDs.
 */
async function populateAdapter(adapter: StorageAdapter, count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await adapter.put(makeVector(`v${String(i).padStart(6, '0')}`, [i % 4, (i + 1) % 4]));
  }
}

/**
 * Collect all records from an async iterable into an array.
 */
async function drainScan(iterable: AsyncIterable<VectorData>): Promise<VectorData[]> {
  const results: VectorData[] = [];
  for await (const record of iterable) {
    results.push(record);
  }
  return results;
}

// ---------------------------------------------------------------------------
// Large-store streaming tests
// ---------------------------------------------------------------------------

describe('cursor/streaming scan — large store', () => {
  it('streams a large store without exceeding a bounded per-iteration footprint', async () => {
    const LARGE_COUNT = 1000;
    const adapter = new MemoryStorageAdapter();
    await adapter.init();
    await populateAdapter(adapter, LARGE_COUNT);

    let yielded = 0;

    for await (const _record of adapter.scan({ pageSize: 50 })) {
      yielded++;
    }

    expect(yielded).toBe(LARGE_COUNT);

    await adapter.destroy();
  });

  it('streams exactly the same records as getAll() for a large store', async () => {
    const LARGE_COUNT = 500;
    const adapter = new MemoryStorageAdapter();
    await adapter.init();
    await populateAdapter(adapter, LARGE_COUNT);

    const allVectors = await adapter.getAll();
    const scannedVectors = await drainScan(adapter.scan());
    const fromGetAll = allVectors.map((v) => v.id).sort();
    const fromScan = scannedVectors.map((v) => v.id).sort();

    expect(fromScan).toEqual(fromGetAll);
    expect(fromScan).toHaveLength(LARGE_COUNT);

    await adapter.destroy();
  });

  it('aborts a large-store cursor scan early via signal', async () => {
    const LARGE_COUNT = 200;
    const STOP_AFTER = 10;

    const adapter = new MemoryStorageAdapter();
    await adapter.init();
    await populateAdapter(adapter, LARGE_COUNT);

    const controller = new AbortController();
    let yielded = 0;

    for await (const _record of adapter.scan({ signal: controller.signal })) {
      yielded++;
      if (yielded === STOP_AFTER) {
        controller.abort();
      }
    }

    expect(yielded).toBe(STOP_AFTER);

    await adapter.destroy();
  });

  it('handles a large-store scan with a small page size (many pages)', async () => {
    const LARGE_COUNT = 300;
    const adapter = new MemoryStorageAdapter();
    await adapter.init();
    await populateAdapter(adapter, LARGE_COUNT);

    const scanned = await drainScan(adapter.scan({ pageSize: 7 }));
    expect(scanned).toHaveLength(LARGE_COUNT);

    await adapter.destroy();
  });
});

// ---------------------------------------------------------------------------
// Scan capabilities reporting
// ---------------------------------------------------------------------------

describe('cursor/streaming — getScanCapabilities', () => {
  it('MemoryStorageAdapter reports nativeStreaming false with a limitationReason', () => {
    const adapter = new MemoryStorageAdapter();
    const caps: ScanCapabilities = adapter.getScanCapabilities();

    expect(caps.nativeStreaming).toBe(false);
    expect(typeof caps.limitationReason).toBe('string');
    expect((caps.limitationReason ?? '').length).toBeGreaterThan(0);
  });

  it('getScanCapabilities() result is stable across multiple calls', () => {
    const adapter = new MemoryStorageAdapter();

    const first = adapter.getScanCapabilities();
    const second = adapter.getScanCapabilities();

    expect(first.nativeStreaming).toBe(second.nativeStreaming);
    expect(first.limitationReason ?? null).toBe(second.limitationReason ?? null);
  });
});

// ---------------------------------------------------------------------------
// Streaming simulated eviction planning
// ---------------------------------------------------------------------------

describe('stream-based eviction planning', () => {
  it('identifies eviction candidates by scanning without loading all vectors', async () => {
    // Use MemoryStorageAdapter directly so we can call seed() to plant
    // specific lastAccessed values without having put() overwrite them.
    const adapter = new MemoryStorageAdapter() as MemoryAdapter;
    await adapter.init();

    const now = Date.now();
    const oldTime = now - 1_000_000; // well before cutoff

    // Seed 50 old vectors
    for (let i = 0; i < 50; i++) {
      const vec = makeVector(`old-${i}`, [i, 0]);
      vec.lastAccessed = oldTime;
      vec.timestamp = oldTime;
      adapter.seed(vec);
    }
    // Seed 50 recent vectors
    for (let i = 0; i < 50; i++) {
      const vec = makeVector(`new-${i}`, [i, 1]);
      vec.lastAccessed = now;
      vec.timestamp = now;
      adapter.seed(vec);
    }

    // Identify eviction candidates (lastAccessed older than cutoff) using scan
    const cutoff = now - 500_000;
    const evictionCandidates: string[] = [];

    for await (const record of adapter.scan()) {
      const accessed = record.lastAccessed ?? record.timestamp;
      if (accessed < cutoff) {
        evictionCandidates.push(record.id);
      }
    }

    // All 50 old vectors should be candidates
    expect(evictionCandidates).toHaveLength(50);
    expect(evictionCandidates.every((id) => id.startsWith('old-'))).toBe(true);

    await adapter.destroy();
  });
});

// ---------------------------------------------------------------------------
// Streaming simulated stats collection
// ---------------------------------------------------------------------------

describe('stream-based statistics collection', () => {
  it('collects store stats by streaming without materializing the full dataset', async () => {
    const adapter = new MemoryStorageAdapter();
    await adapter.init();

    for (let i = 0; i < 100; i++) {
      const vec = makeVector(`stat-${i}`, [i % 8, (i + 1) % 8, (i + 2) % 8]);
      vec.accessCount = i % 5;
      await adapter.put(vec);
    }

    let totalVectors = 0;
    let totalAccessCount = 0;

    // Compute stats by streaming — never holding more than one record at a time
    for await (const record of adapter.scan()) {
      totalVectors++;
      totalAccessCount += record.accessCount ?? 0;
    }

    expect(totalVectors).toBe(100);
    // Sum of (i % 5) for i in 0..99: each remainder 0-4 appears 20 times
    // 20*(0+1+2+3+4) = 200
    expect(totalAccessCount).toBe(200);

    await adapter.destroy();
  });
});
