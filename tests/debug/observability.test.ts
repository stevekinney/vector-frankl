import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { ObservabilityManager } from '@/debug/observability.js';
import type {
  EvictionEvent,
  GPUFallbackEvent,
  ObservabilityEvent,
  QuotaWarningEvent,
  SearchLatencyEvent,
  StorageLatencyEvent,
  WorkerFailureEvent,
} from '@/debug/observability.js';

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function freshManager(): ObservabilityManager {
  // Each test gets a new instance so we never share listener state.
  const m = new (ObservabilityManager as any)() as ObservabilityManager;
  return m;
}

function makeSearchEvent(
  overrides: Partial<SearchLatencyEvent> = {},
): SearchLatencyEvent {
  return {
    type: 'search_latency',
    timestamp: performance.now(),
    durationMs: 42,
    resultCount: 5,
    k: 10,
    indexUsed: true,
    ...overrides,
  };
}

function makeStorageEvent(
  overrides: Partial<StorageLatencyEvent> = {},
): StorageLatencyEvent {
  return {
    type: 'storage_latency',
    timestamp: performance.now(),
    durationMs: 15,
    operation: 'write',
    vectorCount: 1,
    ...overrides,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Observability event subscription and emission
// ──────────────────────────────────────────────────────────────────────────────

describe('ObservabilityManager', () => {
  let manager: ObservabilityManager;

  beforeEach(() => {
    manager = freshManager();
  });

  afterEach(() => {
    manager.removeAllListeners();
  });

  // ── singleton ──────────────────────────────────────────────────────────────

  describe('singleton', () => {
    it('getInstance returns the same object each time', () => {
      const a = ObservabilityManager.getInstance();
      const b = ObservabilityManager.getInstance();
      expect(a).toBe(b);
    });
  });

  // ── observe search latency event ──────────────────────────────────────────

  describe('observe search latency event', () => {
    it('emits and receives a search_latency event', () => {
      const received: SearchLatencyEvent[] = [];

      manager.on('search_latency', (e) => received.push(e));
      manager.emit(makeSearchEvent());

      expect(received).toHaveLength(1);
      const evt = received[0]!;
      expect(evt.type).toBe('search_latency');
      expect(typeof evt.durationMs).toBe('number');
      expect(evt.durationMs).toBeGreaterThan(0);
      expect(typeof evt.resultCount).toBe('number');
      expect(typeof evt.k).toBe('number');
      expect(typeof evt.indexUsed).toBe('boolean');
    });

    it('search latency event carries optional source', () => {
      const received: SearchLatencyEvent[] = [];
      manager.on('search_latency', (e) => received.push(e));
      manager.emit({ ...makeSearchEvent(), source: 'my-db' });
      expect(received[0]!.source).toBe('my-db');
    });

    it('search latency event without source has no source key', () => {
      const received: SearchLatencyEvent[] = [];
      manager.on('search_latency', (e) => received.push(e));
      manager.emit(makeSearchEvent());
      expect(received[0]!.source).toBeUndefined();
    });
  });

  // ── observe storage latency event ─────────────────────────────────────────

  describe('observe storage latency event', () => {
    it('emits and receives a storage_latency event', () => {
      const received: StorageLatencyEvent[] = [];

      manager.on('storage_latency', (e) => received.push(e));
      manager.emit(makeStorageEvent());

      expect(received).toHaveLength(1);
      const evt = received[0]!;
      expect(evt.type).toBe('storage_latency');
      expect(['read', 'write', 'delete', 'batch_write', 'batch_delete']).toContain(
        evt.operation,
      );
      expect(typeof evt.vectorCount).toBe('number');
      expect(typeof evt.durationMs).toBe('number');
    });

    it('supports all storage operation variants', () => {
      const ops: StorageLatencyEvent['operation'][] = [
        'read',
        'write',
        'delete',
        'batch_write',
        'batch_delete',
      ];

      const received: StorageLatencyEvent[] = [];
      manager.on('storage_latency', (e) => received.push(e));

      for (const operation of ops) {
        manager.emit(makeStorageEvent({ operation }));
      }

      expect(received).toHaveLength(ops.length);
      expect(received.map((e) => e.operation)).toEqual(ops);
    });
  });

  // ── observe quota warning event ───────────────────────────────────────────

  describe('observe quota warning event', () => {
    it('emits and receives a quota_warning event', () => {
      const received: QuotaWarningEvent[] = [];
      manager.on('quota_warning', (e) => received.push(e));

      const evt: QuotaWarningEvent = {
        type: 'quota_warning',
        timestamp: performance.now(),
        level: 'critical',
        usedBytes: 900_000_000,
        quotaBytes: 1_000_000_000,
        usageRatio: 0.9,
      };
      manager.emit(evt);

      expect(received).toHaveLength(1);
      expect(received[0]!.level).toBe('critical');
      expect(received[0]!.usageRatio).toBe(0.9);
    });

    it('supports all quota warning levels', () => {
      const levels: QuotaWarningEvent['level'][] = ['warning', 'critical', 'emergency'];
      const received: QuotaWarningEvent[] = [];
      manager.on('quota_warning', (e) => received.push(e));

      for (const level of levels) {
        manager.emit({
          type: 'quota_warning',
          timestamp: performance.now(),
          level,
          usedBytes: 100,
          quotaBytes: 1000,
          usageRatio: 0.1,
        });
      }

      expect(received.map((e) => e.level)).toEqual(levels);
    });
  });

  // ── observe eviction event ────────────────────────────────────────────────

  describe('observe eviction event', () => {
    it('emits and receives an eviction event with automatic flag', () => {
      const received: EvictionEvent[] = [];
      manager.on('eviction', (e) => received.push(e));

      const evt: EvictionEvent = {
        type: 'eviction',
        timestamp: performance.now(),
        strategy: 'lru',
        evictedCount: 10,
        freedBytes: 1024,
        automatic: true,
      };
      manager.emit(evt);

      expect(received).toHaveLength(1);
      expect(received[0]!.strategy).toBe('lru');
      expect(received[0]!.evictedCount).toBe(10);
      expect(received[0]!.automatic).toBe(true);
    });
  });

  // ── observe worker failure event ─────────────────────────────────────────

  describe('observe worker failure event', () => {
    it('emits and receives a worker_failure event', () => {
      const received: WorkerFailureEvent[] = [];
      manager.on('worker_failure', (e) => received.push(e));

      const evt: WorkerFailureEvent = {
        type: 'worker_failure',
        timestamp: performance.now(),
        error: 'Worker crashed unexpectedly',
        fellBackToSequential: true,
      };
      manager.emit(evt);

      expect(received).toHaveLength(1);
      expect(received[0]!.fellBackToSequential).toBe(true);
      expect(received[0]!.error).toBeTruthy();
    });
  });

  // ── observe GPU fallback event ────────────────────────────────────────────

  describe('observe gpu_fallback event', () => {
    it('emits and receives a gpu_fallback event', () => {
      const received: GPUFallbackEvent[] = [];
      manager.on('gpu_fallback', (e) => received.push(e));

      const evt: GPUFallbackEvent = {
        type: 'gpu_fallback',
        timestamp: performance.now(),
        reason: 'WebGPU not available',
        fallbackTo: 'sequential',
      };
      manager.emit(evt);

      expect(received).toHaveLength(1);
      expect(received[0]!.fallbackTo).toBe('sequential');
    });
  });

  // ── observe WebAssembly fallback event ───────────────────────────────────

  describe('observe wasm_fallback event', () => {
    it('emits and receives a wasm_fallback event', () => {
      const received: ObservabilityEvent[] = [];
      manager.on('wasm_fallback', (e) => received.push(e));

      manager.emit({
        type: 'wasm_fallback',
        timestamp: performance.now(),
        reason: 'WASM module failed to load',
        fallbackTo: 'javascript',
      });

      expect(received).toHaveLength(1);
      expect(received[0]!.type).toBe('wasm_fallback');
    });
  });

  // ── observe adapter connectivity event ───────────────────────────────────

  describe('observe adapter_connectivity event', () => {
    it('emits a connected event with latency', () => {
      const received: ObservabilityEvent[] = [];
      manager.on('adapter_connectivity', (e) => received.push(e));

      manager.emit({
        type: 'adapter_connectivity',
        timestamp: performance.now(),
        connected: true,
        adapterType: 'indexed-database',
        latencyMs: 3,
      });

      expect(received[0]!.type).toBe('adapter_connectivity');
    });

    it('emits a disconnected event with error', () => {
      const received: ObservabilityEvent[] = [];
      manager.on('adapter_connectivity', (e) => received.push(e));

      manager.emit({
        type: 'adapter_connectivity',
        timestamp: performance.now(),
        connected: false,
        adapterType: 'indexed-database',
        latencyMs: 0,
        error: 'Connection refused',
      });

      const evt = received[0] as any;
      expect(evt.connected).toBe(false);
      expect(evt.error).toBe('Connection refused');
    });
  });

  // ── observe corruption recovery event ────────────────────────────────────

  describe('observe corruption_recovery event', () => {
    it('emits and receives a corruption_recovery event', () => {
      const received: ObservabilityEvent[] = [];
      manager.on('corruption_recovery', (e) => received.push(e));

      manager.emit({
        type: 'corruption_recovery',
        timestamp: performance.now(),
        recovered: true,
        affectedCount: 3,
        description: 'Checksum mismatch in 3 vectors; re-computed from raw data.',
      });

      const evt = received[0] as any;
      expect(evt.recovered).toBe(true);
      expect(evt.affectedCount).toBe(3);
    });
  });

  // ── wildcard listener ─────────────────────────────────────────────────────

  describe('wildcard listener receives all events', () => {
    it('onAll callback is invoked for every event type', () => {
      const received: ObservabilityEvent[] = [];
      manager.onAll((e) => received.push(e));

      manager.emit(makeSearchEvent());
      manager.emit(makeStorageEvent());
      manager.emit({
        type: 'worker_failure',
        timestamp: performance.now(),
        error: 'boom',
        fellBackToSequential: true,
      });

      expect(received).toHaveLength(3);
      expect(received.map((e) => e.type)).toEqual([
        'search_latency',
        'storage_latency',
        'worker_failure',
      ]);
    });
  });

  // ── unsubscribe ───────────────────────────────────────────────────────────

  describe('unsubscribe', () => {
    it('off removes a specific typed listener', () => {
      const received: SearchLatencyEvent[] = [];
      const handler = (e: SearchLatencyEvent) => received.push(e);

      manager.on('search_latency', handler);
      manager.emit(makeSearchEvent());
      expect(received).toHaveLength(1);

      manager.off('search_latency', handler);
      manager.emit(makeSearchEvent());
      expect(received).toHaveLength(1); // no new event
    });

    it('unsubscribe function returned from on() removes the listener', () => {
      const received: SearchLatencyEvent[] = [];
      const unsubscribe = manager.on('search_latency', (e) => received.push(e));

      manager.emit(makeSearchEvent());
      expect(received).toHaveLength(1);

      unsubscribe();
      manager.emit(makeSearchEvent());
      expect(received).toHaveLength(1); // unchanged
    });

    it('unsubscribe function returned from onAll() removes the wildcard listener', () => {
      const received: ObservabilityEvent[] = [];
      const unsubscribe = manager.onAll((e) => received.push(e));

      manager.emit(makeSearchEvent());
      expect(received).toHaveLength(1);

      unsubscribe();
      manager.emit(makeSearchEvent());
      expect(received).toHaveLength(1); // unchanged
    });

    it('removeAllListeners for a type clears only that type', () => {
      const searchReceived: SearchLatencyEvent[] = [];
      const storageReceived: StorageLatencyEvent[] = [];

      manager.on('search_latency', (e) => searchReceived.push(e));
      manager.on('storage_latency', (e) => storageReceived.push(e));

      manager.removeAllListeners('search_latency');

      manager.emit(makeSearchEvent());
      manager.emit(makeStorageEvent());

      expect(searchReceived).toHaveLength(0);
      expect(storageReceived).toHaveLength(1);
    });

    it('removeAllListeners() clears everything', () => {
      const received: ObservabilityEvent[] = [];
      manager.on('search_latency', (e) => received.push(e));
      manager.onAll((e) => received.push(e));

      manager.removeAllListeners();
      manager.emit(makeSearchEvent());

      expect(received).toHaveLength(0);
    });
  });

  // ── error isolation ───────────────────────────────────────────────────────

  describe('error isolation', () => {
    it('a throwing listener does not interrupt other listeners', () => {
      const received: SearchLatencyEvent[] = [];

      manager.on('search_latency', () => {
        throw new Error('bad listener');
      });
      manager.on('search_latency', (e) => received.push(e));

      // Should not throw even though first handler throws
      expect(() => manager.emit(makeSearchEvent())).not.toThrow();
      expect(received).toHaveLength(1);
    });
  });

  // ── listener count ────────────────────────────────────────────────────────

  describe('listenerCount', () => {
    it('returns 0 for a type with no listeners', () => {
      expect(manager.listenerCount('search_latency')).toBe(0);
    });

    it('counts typed and wildcard listeners for a given type', () => {
      manager.on('search_latency', () => {});
      manager.onAll(() => {});
      expect(manager.listenerCount('search_latency')).toBe(2);
    });

    it('sums all listeners when no type is given', () => {
      manager.on('search_latency', () => {});
      manager.on('storage_latency', () => {});
      manager.onAll(() => {});
      expect(manager.listenerCount()).toBe(3);
    });
  });

  // ── measureSearch helper ──────────────────────────────────────────────────

  describe('measureSearch helper', () => {
    it('emits a search_latency event metric after the wrapped function resolves', async () => {
      const received: SearchLatencyEvent[] = [];
      manager.on('search_latency', (e) => received.push(e));

      const mockResults = [
        { id: '1', score: 0.9 },
        { id: '2', score: 0.8 },
      ];
      const result = await manager.measureSearch(
        async () => mockResults,
        (res) => ({ resultCount: res.length, k: 5, indexUsed: false }),
        'test-source',
      );

      expect(result).toBe(mockResults);
      expect(received).toHaveLength(1);
      const evt = received[0]!;
      expect(evt.resultCount).toBe(2);
      expect(evt.k).toBe(5);
      expect(evt.indexUsed).toBe(false);
      expect(evt.durationMs).toBeGreaterThanOrEqual(0);
      expect(evt.source).toBe('test-source');
    });
  });

  // ── measureStorage helper ─────────────────────────────────────────────────

  describe('measureStorage helper', () => {
    it('emits a storage_latency event metric after the wrapped function resolves', async () => {
      const received: StorageLatencyEvent[] = [];
      manager.on('storage_latency', (e) => received.push(e));

      const result = await manager.measureStorage('batch_write', 50, async () => 'done');

      expect(result).toBe('done');
      expect(received).toHaveLength(1);
      const evt = received[0]!;
      expect(evt.operation).toBe('batch_write');
      expect(evt.vectorCount).toBe(50);
      expect(evt.durationMs).toBeGreaterThanOrEqual(0);
    });
  });
});
