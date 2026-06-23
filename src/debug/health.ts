/**
 * Health and diagnostics APIs for Vector Frankl.
 *
 * Exposes structured snapshots of storage health, index health, acceleration
 * availability, package version, quota state, dirty indexes, pending background
 * work, and adapter connectivity so operators can inspect runtime state without
 * parsing log output.
 */

import { VERSION } from '../index.js';

// ──────────────────────────────────────────────────────────────────────────────
// Public types
// ──────────────────────────────────────────────────────────────────────────────

/** Three-tier health assessment. */
export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

/** Health of the primary storage backend. */
export interface StorageHealth {
  status: HealthStatus;
  /** Whether the storage adapter is open and accepting operations. */
  initialized: boolean;
  /** Number of vectors currently stored. */
  vectorCount: number;
  /** Approximate bytes in use, if determinable. */
  estimatedBytes?: number | undefined;
  /** Quota usage information when available. */
  quota?:
    | {
        usedBytes: number;
        totalBytes: number;
        usageRatio: number;
        availableBytes: number;
      }
    | undefined;
  /** Whether the database is approaching or over its quota limit. */
  quotaPressure: 'none' | 'moderate' | 'critical' | 'unknown';
}

/** Health of the HNSW (or other) index. */
export interface IndexHealth {
  status: HealthStatus;
  /** Whether the index subsystem is active. */
  enabled: boolean;
  /** Number of nodes in the in-memory index. */
  nodeCount: number;
  /** Number of dirty (unsaved) index entries in the persistence cache. */
  dirtyCount: number;
  /** Whether the index has unsaved changes. */
  hasDirtyIndexes: boolean;
  /** Additional structural statistics when available. */
  levels?: number[] | undefined;
  avgConnections?: number | undefined;
}

/** Availability of hardware/WASM acceleration paths. */
export interface AccelerationHealth {
  /** Web Worker pool state. */
  workers: {
    enabled: boolean;
    initialized: boolean;
    totalWorkers?: number | undefined;
    busyWorkers?: number | undefined;
    queueLength?: number | undefined;
  };
  /** GPU (WebGPU) acceleration state. */
  gpu: {
    enabled: boolean;
    available: boolean;
    initialized: boolean;
  };
  /** WebAssembly acceleration state. */
  wasm: {
    supported: boolean;
  };
}

/** Adapter connectivity probe result. */
export interface AdapterConnectivityResult {
  /** Whether the adapter responded to a probe. */
  connected: boolean;
  /** Detected adapter type or name. */
  adapterType: string;
  /** Round-trip latency for the probe in ms (0 when unavailable). */
  latencyMs: number;
  /** Error message if not connected. */
  error?: string | undefined;
}

/** Complete diagnostic snapshot. */
export interface DiagnosticsReport {
  /** Package version at the time of the snapshot. */
  version: string;
  /** Monotonic timestamp when the snapshot was captured. */
  timestamp: number;
  /** Overall system health assessment. */
  status: HealthStatus;
  /** Storage subsystem details. */
  storage: StorageHealth;
  /** Index subsystem details. */
  index: IndexHealth;
  /** Hardware / WASM acceleration availability. */
  acceleration: AccelerationHealth;
  /** Adapter connectivity. */
  connectivity: AdapterConnectivityResult;
  /** Whether background work (flush, rebuild, eviction) is pending. */
  hasPendingBackgroundWork: boolean;
  /** Structured summary of any detected problems. */
  issues: string[];
}

// ──────────────────────────────────────────────────────────────────────────────
// Internal helper interfaces (duck-typed, not imported, to avoid coupling)
// ──────────────────────────────────────────────────────────────────────────────

/** Minimal VectorDB surface this module reads diagnostics from. */
interface DiagnosticsSource {
  getStats(): Promise<{ vectorCount: number; dimension: number; initialized: boolean }>;
  getIndexStats(): {
    enabled: boolean;
    nodeCount: number;
    dirtyCount?: number | undefined;
    levels?: number[] | undefined;
    avgConnections?: number | undefined;
  };
  getStorageQuota(): Promise<{
    usage: number;
    quota: number;
    usageRatio: number;
    available: number;
  } | null>;
  getWorkerStats(): {
    enabled: boolean;
    initialized: boolean;
    stats?:
      | {
          totalWorkers: number;
          busyWorkers: number;
          queueLength: number;
        }
      | undefined;
  };
  getGPUStats(): {
    enabled: boolean;
    available: boolean;
    initialized: boolean;
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// HealthMonitor
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Captures a health snapshot from a `VectorDB` (or compatible) instance.
 *
 * All fields are populated from public API calls so the health check does not
 * require access to private state. When a subsystem is unavailable the snapshot
 * degrades gracefully rather than throwing.
 *
 * @example
 * ```ts
 * const monitor = new HealthMonitor(db);
 * const report = await monitor.getDiagnostics();
 * if (report.status !== 'healthy') {
 *   alert(report.issues.join(', '));
 * }
 * ```
 */
export class HealthMonitor {
  constructor(private readonly source: DiagnosticsSource) {}

  /**
   * Inspect storage health.
   *
   * Pulls vector count, initialization state, and quota from the source.
   */
  async getStorageHealth(): Promise<StorageHealth> {
    let stats: { vectorCount: number; initialized: boolean } | null = null;
    let quotaInfo: {
      usage: number;
      quota: number;
      usageRatio: number;
      available: number;
    } | null = null;

    try {
      stats = await this.source.getStats();
    } catch {
      // Source unavailable — return unhealthy.
    }

    try {
      quotaInfo = await this.source.getStorageQuota();
    } catch {
      // Quota API not available in this environment; carry on.
    }

    if (!stats) {
      return {
        status: 'unhealthy',
        initialized: false,
        vectorCount: 0,
        quotaPressure: 'unknown',
      };
    }

    let quotaPressure: StorageHealth['quotaPressure'] = 'unknown';
    let quotaField: StorageHealth['quota'] = undefined;

    if (quotaInfo) {
      quotaField = {
        usedBytes: quotaInfo.usage,
        totalBytes: quotaInfo.quota,
        usageRatio: quotaInfo.usageRatio,
        availableBytes: quotaInfo.available,
      };
      if (quotaInfo.usageRatio >= 0.95) {
        quotaPressure = 'critical';
      } else if (quotaInfo.usageRatio >= 0.8) {
        quotaPressure = 'moderate';
      } else {
        quotaPressure = 'none';
      }
    }

    const status: HealthStatus = !stats.initialized
      ? 'unhealthy'
      : quotaPressure === 'critical' || quotaPressure === 'moderate'
        ? 'degraded'
        : 'healthy';

    return {
      status,
      initialized: stats.initialized,
      vectorCount: stats.vectorCount,
      ...(quotaField !== undefined && { quota: quotaField }),
      quotaPressure,
    };
  }

  /**
   * Inspect index health.
   *
   * Reads the in-memory index statistics. When the index is disabled the
   * health is still reported as `healthy` because the system operates without
   * one.
   */
  getIndexHealth(): IndexHealth {
    let indexStats: ReturnType<DiagnosticsSource['getIndexStats']> | null = null;

    try {
      indexStats = this.source.getIndexStats();
    } catch {
      // Source unavailable.
    }

    if (!indexStats) {
      return {
        status: 'unhealthy',
        enabled: false,
        nodeCount: 0,
        dirtyCount: 0,
        hasDirtyIndexes: false,
      };
    }

    const dirtyCount = indexStats.dirtyCount ?? 0;
    const hasDirtyIndexes = dirtyCount > 0;

    const status: HealthStatus = hasDirtyIndexes ? 'degraded' : 'healthy';

    return {
      status,
      enabled: indexStats.enabled,
      nodeCount: indexStats.nodeCount,
      dirtyCount,
      hasDirtyIndexes,
      ...(indexStats.levels !== undefined && { levels: indexStats.levels }),
      ...(indexStats.avgConnections !== undefined && {
        avgConnections: indexStats.avgConnections,
      }),
    };
  }

  /**
   * Inspect acceleration subsystem health (workers, GPU, WASM).
   */
  getAccelerationHealth(): AccelerationHealth {
    let workerStats: ReturnType<DiagnosticsSource['getWorkerStats']> | null = null;
    let gpuStats: ReturnType<DiagnosticsSource['getGPUStats']> | null = null;

    try {
      workerStats = this.source.getWorkerStats();
    } catch {
      // Not available.
    }

    try {
      gpuStats = this.source.getGPUStats();
    } catch {
      // Not available.
    }

    const wasmSupported =
      typeof WebAssembly !== 'undefined' && typeof WebAssembly.instantiate === 'function';

    return {
      workers: workerStats
        ? {
            enabled: workerStats.enabled,
            initialized: workerStats.initialized,
            ...(workerStats.stats && {
              totalWorkers: workerStats.stats.totalWorkers,
              busyWorkers: workerStats.stats.busyWorkers,
              queueLength: workerStats.stats.queueLength,
            }),
          }
        : { enabled: false, initialized: false },
      gpu: gpuStats
        ? {
            enabled: gpuStats.enabled,
            available: gpuStats.available,
            initialized: gpuStats.initialized,
          }
        : { enabled: false, available: false, initialized: false },
      wasm: { supported: wasmSupported },
    };
  }

  /**
   * Probe adapter connectivity by attempting a lightweight read.
   */
  async getConnectivity(): Promise<AdapterConnectivityResult> {
    const start = performance.now();

    try {
      // A stats call touches the adapter and confirms it is reachable.
      await this.source.getStats();
      const latencyMs = performance.now() - start;

      return {
        connected: true,
        adapterType: 'indexed-database',
        latencyMs,
      };
    } catch (error) {
      return {
        connected: false,
        adapterType: 'indexed-database',
        latencyMs: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Produce a complete `DiagnosticsReport` from all subsystems.
   *
   * The `status` field reflects the worst subsystem status across storage and
   * index. Acceleration degradation contributes to `issues` but does not
   * downgrade `status` because the system remains functional without it.
   */
  async getDiagnostics(): Promise<DiagnosticsReport> {
    const [storage, connectivity] = await Promise.all([
      this.getStorageHealth(),
      this.getConnectivity(),
    ]);

    const index = this.getIndexHealth();
    const acceleration = this.getAccelerationHealth();

    const issues: string[] = [];

    if (!storage.initialized) {
      issues.push('Storage adapter is not initialized.');
    }
    if (storage.quotaPressure === 'critical') {
      issues.push('Storage quota usage is critical (≥95%).');
    } else if (storage.quotaPressure === 'moderate') {
      issues.push('Storage quota usage is elevated (≥80%).');
    }
    if (index.hasDirtyIndexes) {
      issues.push(`Index has ${index.dirtyCount} unsaved (dirty) entries.`);
    }
    if (!connectivity.connected) {
      issues.push(
        `Adapter connectivity check failed: ${connectivity.error ?? 'unknown'}`,
      );
    }
    if (!acceleration.gpu.available && acceleration.gpu.enabled) {
      issues.push('GPU acceleration enabled but not available.');
    }

    const hasPendingBackgroundWork = index.hasDirtyIndexes;

    // Overall status: worst of storage and index, connectivity failure → unhealthy.
    const statuses: HealthStatus[] = [storage.status, index.status];
    if (!connectivity.connected) {
      statuses.push('unhealthy');
    }

    let status: HealthStatus = 'healthy';
    if (statuses.includes('unhealthy')) {
      status = 'unhealthy';
    } else if (statuses.includes('degraded')) {
      status = 'degraded';
    }

    return {
      version: VERSION,
      timestamp: Date.now(),
      status,
      storage,
      index,
      acceleration,
      connectivity,
      hasPendingBackgroundWork,
      issues,
    };
  }
}

/**
 * Create a `HealthMonitor` bound to the given source.
 *
 * @param source - A `VectorDB` instance or any object implementing the
 *   diagnostic surface.
 */
export function createHealthMonitor(source: DiagnosticsSource): HealthMonitor {
  return new HealthMonitor(source);
}
