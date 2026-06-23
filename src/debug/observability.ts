/**
 * Production observability hooks for Vector Frankl.
 *
 * Provides structured event signals for runtime events so consumers can
 * observe search latency, storage latency, index rebuilds, quota warnings,
 * eviction, worker failures, GPU fallback, WebAssembly fallback, adapter
 * connectivity, and corruption recovery without parsing logs.
 */

/** Categories of observable runtime events. */
export type ObservabilityEventType =
  | 'search_latency'
  | 'storage_latency'
  | 'index_rebuild'
  | 'quota_warning'
  | 'eviction'
  | 'worker_failure'
  | 'gpu_fallback'
  | 'wasm_fallback'
  | 'adapter_connectivity'
  | 'corruption_recovery';

/** Base shape for all observability events. */
export interface ObservabilityEventBase {
  /** Event type discriminant. */
  type: ObservabilityEventType;
  /** Monotonic timestamp (ms) at emission time. */
  timestamp: number;
  /** Optional namespace or database name that generated the event. */
  source?: string | undefined;
}

/** Emitted after a vector similarity search completes. */
export interface SearchLatencyEvent extends ObservabilityEventBase {
  type: 'search_latency';
  /** Wall-clock duration of the search in milliseconds. */
  durationMs: number;
  /** Number of results returned. */
  resultCount: number;
  /** k requested by the caller. */
  k: number;
  /** Whether the HNSW index was used. */
  indexUsed: boolean;
}

/** Emitted after a storage read or write completes. */
export interface StorageLatencyEvent extends ObservabilityEventBase {
  type: 'storage_latency';
  /** Wall-clock duration of the storage operation in milliseconds. */
  durationMs: number;
  /** Read or write direction. */
  operation: 'read' | 'write' | 'delete' | 'batch_write' | 'batch_delete';
  /** Number of vectors touched. */
  vectorCount: number;
}

/** Emitted when an HNSW index rebuild starts or finishes. */
export interface IndexRebuildEvent extends ObservabilityEventBase {
  type: 'index_rebuild';
  /** Whether this marks the start or end of the rebuild. */
  phase: 'start' | 'complete' | 'error';
  /** Number of vectors in the rebuilt index (present on `complete`). */
  nodeCount?: number | undefined;
  /** Duration of the rebuild in ms (present on `complete`). */
  durationMs?: number | undefined;
  /** Error message (present on `error`). */
  error?: string | undefined;
}

/** Emitted when storage quota crosses a threshold. */
export interface QuotaWarningEvent extends ObservabilityEventBase {
  type: 'quota_warning';
  /** Severity of the warning. */
  level: 'warning' | 'critical' | 'emergency';
  /** Bytes currently in use. */
  usedBytes: number;
  /** Total quota in bytes. */
  quotaBytes: number;
  /** Usage as a fraction 0–1. */
  usageRatio: number;
}

/** Emitted after an eviction pass runs. */
export interface EvictionEvent extends ObservabilityEventBase {
  type: 'eviction';
  /** Strategy used for this eviction pass. */
  strategy: string;
  /** Number of vectors removed. */
  evictedCount: number;
  /** Approximate bytes freed. */
  freedBytes: number;
  /** Whether the eviction was triggered automatically by quota pressure. */
  automatic: boolean;
}

/** Emitted when a Web Worker in the pool fails. */
export interface WorkerFailureEvent extends ObservabilityEventBase {
  type: 'worker_failure';
  /** Sanitized error message. */
  error: string;
  /** Whether the system fell back to sequential processing. */
  fellBackToSequential: boolean;
}

/** Emitted when GPU acceleration fails and the system falls back. */
export interface GPUFallbackEvent extends ObservabilityEventBase {
  type: 'gpu_fallback';
  /** Sanitized reason the GPU path was abandoned. */
  reason: string;
  /** Fallback path chosen. */
  fallbackTo: 'workers' | 'sequential';
}

/** Emitted when WebAssembly acceleration fails and the system falls back. */
export interface WASMFallbackEvent extends ObservabilityEventBase {
  type: 'wasm_fallback';
  /** Sanitized reason the WASM path was abandoned. */
  reason: string;
  /** Fallback path chosen. */
  fallbackTo: 'javascript';
}

/** Emitted when the system tests or loses adapter connectivity. */
export interface AdapterConnectivityEvent extends ObservabilityEventBase {
  type: 'adapter_connectivity';
  /** Whether the adapter is currently reachable. */
  connected: boolean;
  /** Adapter name or type. */
  adapterType: string;
  /** Round-trip latency in ms when connected. */
  latencyMs?: number | undefined;
  /** Sanitized error when disconnected. */
  error?: string | undefined;
}

/** Emitted when the system detects and attempts to recover from data corruption. */
export interface CorruptionRecoveryEvent extends ObservabilityEventBase {
  type: 'corruption_recovery';
  /** Whether recovery was successful. */
  recovered: boolean;
  /** Number of vectors affected. */
  affectedCount: number;
  /** Sanitized description of the corruption detected. */
  description: string;
}

/** Discriminated union of all observable event types. */
export type ObservabilityEvent =
  | SearchLatencyEvent
  | StorageLatencyEvent
  | IndexRebuildEvent
  | QuotaWarningEvent
  | EvictionEvent
  | WorkerFailureEvent
  | GPUFallbackEvent
  | WASMFallbackEvent
  | AdapterConnectivityEvent
  | CorruptionRecoveryEvent;

/** Callback type for observability subscribers. */
export type ObservabilityHandler<T extends ObservabilityEvent = ObservabilityEvent> = (
  event: T,
) => void;

/**
 * Observability manager: a lightweight, type-safe event bus for structured
 * runtime signals. Consumers register handlers per event type and receive
 * structured objects instead of raw log strings.
 *
 * @example
 * ```ts
 * const obs = ObservabilityManager.getInstance();
 * obs.on('search_latency', (event) => {
 *   metrics.histogram('vector.search.duration', event.durationMs);
 * });
 * ```
 */
export class ObservabilityManager {
  private static instance: ObservabilityManager;

  /** Per-type listener sets. Using Map<type, Set<handler>>. */
  private listeners = new Map<ObservabilityEventType, Set<ObservabilityHandler>>();

  /** Wildcard listeners that receive every event. */
  private wildcardListeners = new Set<ObservabilityHandler>();

  private constructor() {}

  /** Return the process-wide singleton. */
  static getInstance(): ObservabilityManager {
    if (!ObservabilityManager.instance) {
      ObservabilityManager.instance = new ObservabilityManager();
    }
    return ObservabilityManager.instance;
  }

  /**
   * Register a listener for a specific event type.
   * Returns an unsubscribe function for convenient cleanup.
   */
  on<T extends ObservabilityEventType>(
    eventType: T,
    handler: ObservabilityHandler<Extract<ObservabilityEvent, { type: T }>>,
  ): () => void {
    let bucket = this.listeners.get(eventType);
    if (!bucket) {
      bucket = new Set();
      this.listeners.set(eventType, bucket);
    }
    bucket.add(handler as ObservabilityHandler);
    return () => this.off(eventType, handler);
  }

  /**
   * Register a listener that receives all events regardless of type.
   * Returns an unsubscribe function.
   */
  onAll(handler: ObservabilityHandler): () => void {
    this.wildcardListeners.add(handler);
    return () => this.wildcardListeners.delete(handler);
  }

  /**
   * Remove a previously registered typed listener.
   */
  off<T extends ObservabilityEventType>(
    eventType: T,
    handler: ObservabilityHandler<Extract<ObservabilityEvent, { type: T }>>,
  ): void {
    this.listeners.get(eventType)?.delete(handler as ObservabilityHandler);
  }

  /**
   * Remove all listeners for a given event type, or all listeners when no
   * type is provided.
   */
  removeAllListeners(eventType?: ObservabilityEventType): void {
    if (eventType) {
      this.listeners.delete(eventType);
    } else {
      this.listeners.clear();
      this.wildcardListeners.clear();
    }
  }

  /**
   * Emit an event to all registered listeners synchronously.
   * Errors thrown by individual listeners are caught and suppressed so that
   * a misbehaving consumer cannot disrupt normal operation.
   */
  emit(event: ObservabilityEvent): void {
    const typed = this.listeners.get(event.type);
    if (typed) {
      for (const handler of typed) {
        try {
          handler(event);
        } catch {
          // Observability errors must never affect the calling operation.
        }
      }
    }

    for (const handler of this.wildcardListeners) {
      try {
        handler(event);
      } catch {
        // Same isolation guarantee for wildcard listeners.
      }
    }
  }

  /**
   * Convenience helper: wrap an async function and emit a latency event when
   * it completes.
   */
  async measureSearch<T>(
    fn: () => Promise<T>,
    getMetrics: (result: T) => { resultCount: number; k: number; indexUsed: boolean },
    source?: string,
  ): Promise<T> {
    const start = performance.now();
    const result = await fn();
    const durationMs = performance.now() - start;
    const metrics = getMetrics(result);
    this.emit({
      type: 'search_latency',
      timestamp: start,
      durationMs,
      ...(source !== undefined && { source }),
      ...metrics,
    });
    return result;
  }

  /**
   * Convenience helper: wrap an async function and emit a storage latency event.
   */
  async measureStorage<T>(
    operation: StorageLatencyEvent['operation'],
    vectorCount: number,
    fn: () => Promise<T>,
    source?: string,
  ): Promise<T> {
    const start = performance.now();
    const result = await fn();
    const durationMs = performance.now() - start;
    this.emit({
      type: 'storage_latency',
      timestamp: start,
      durationMs,
      operation,
      vectorCount,
      ...(source !== undefined && { source }),
    });
    return result;
  }

  /**
   * Return a count of registered listeners, useful for diagnostics.
   */
  listenerCount(eventType?: ObservabilityEventType): number {
    if (eventType) {
      return (this.listeners.get(eventType)?.size ?? 0) + this.wildcardListeners.size;
    }
    let total = this.wildcardListeners.size;
    for (const bucket of this.listeners.values()) {
      total += bucket.size;
    }
    return total;
  }
}

/** Process-wide singleton for observability. */
export const observability = ObservabilityManager.getInstance();
