import { describe, expect, it } from 'bun:test';

import { HealthMonitor, createHealthMonitor } from '@/debug/health.js';
import type { DiagnosticsReport } from '@/debug/health.js';

// ──────────────────────────────────────────────────────────────────────────────
// Stub DiagnosticsSource
// ──────────────────────────────────────────────────────────────────────────────

interface StubStats {
  vectorCount: number;
  dimension: number;
  initialized: boolean;
}

interface StubQuota {
  usage: number;
  quota: number;
  usageRatio: number;
  available: number;
}

interface StubIndexStats {
  enabled: boolean;
  nodeCount: number;
  dirtyCount: number;
  levels?: number[];
  avgConnections?: number;
}

interface StubWorkerStats {
  enabled: boolean;
  initialized: boolean;
  stats?: {
    totalWorkers: number;
    busyWorkers: number;
    queueLength: number;
  };
}

interface StubGPUStats {
  enabled: boolean;
  available: boolean;
  initialized: boolean;
}

function makeSource(overrides: {
  stats?: StubStats | null;
  quota?: StubQuota | null;
  indexStats?: StubIndexStats;
  workerStats?: StubWorkerStats;
  gpuStats?: StubGPUStats;
  statsThrows?: boolean;
}) {
  return {
    async getStats(): Promise<StubStats> {
      if (overrides.statsThrows) throw new Error('storage unavailable');
      if (overrides.stats === null) throw new Error('source returned null');
      return (
        overrides.stats ?? {
          vectorCount: 100,
          dimension: 128,
          initialized: true,
        }
      );
    },
    async getStorageQuota(): Promise<StubQuota | null> {
      if (overrides.quota === undefined) {
        return {
          usage: 100_000,
          quota: 10_000_000,
          usageRatio: 0.01,
          available: 9_900_000,
        };
      }
      return overrides.quota;
    },
    getIndexStats(): StubIndexStats {
      return (
        overrides.indexStats ?? {
          enabled: true,
          nodeCount: 100,
          dirtyCount: 0,
        }
      );
    },
    getWorkerStats(): StubWorkerStats {
      return overrides.workerStats ?? { enabled: true, initialized: true };
    },
    getGPUStats(): StubGPUStats {
      return (
        overrides.gpuStats ?? { enabled: false, available: false, initialized: false }
      );
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

describe('HealthMonitor', () => {
  // ── storage health ─────────────────────────────────────────────────────────

  describe('health diagnostic: storage health', () => {
    it('returns healthy when initialized with low quota usage', async () => {
      const monitor = createHealthMonitor(makeSource({}));
      const result = await monitor.getStorageHealth();

      expect(result.status).toBe('healthy');
      expect(result.initialized).toBe(true);
      expect(result.vectorCount).toBe(100);
      expect(result.quotaPressure).toBe('none');
    });

    it('returns degraded when quota usage ≥ 80%', async () => {
      const monitor = createHealthMonitor(
        makeSource({
          quota: {
            usage: 800_000,
            quota: 1_000_000,
            usageRatio: 0.8,
            available: 200_000,
          },
        }),
      );
      const result = await monitor.getStorageHealth();

      expect(result.status).toBe('degraded');
      expect(result.quotaPressure).toBe('moderate');
    });

    it('returns degraded when quota usage ≥ 95%', async () => {
      const monitor = createHealthMonitor(
        makeSource({
          quota: {
            usage: 960_000,
            quota: 1_000_000,
            usageRatio: 0.96,
            available: 40_000,
          },
        }),
      );
      const result = await monitor.getStorageHealth();

      expect(result.status).toBe('degraded');
      expect(result.quotaPressure).toBe('critical');
    });

    it('returns unhealthy when source throws', async () => {
      const monitor = createHealthMonitor(makeSource({ statsThrows: true }));
      const result = await monitor.getStorageHealth();

      expect(result.status).toBe('unhealthy');
      expect(result.initialized).toBe(false);
    });

    it('returns quota field when quota API is available', async () => {
      const monitor = createHealthMonitor(makeSource({}));
      const result = await monitor.getStorageHealth();

      expect(result.quota).toBeDefined();
      expect(result.quota!.usageRatio).toBeCloseTo(0.01);
    });

    it('omits quota field when quota API returns null', async () => {
      const monitor = createHealthMonitor(makeSource({ quota: null }));
      const result = await monitor.getStorageHealth();

      expect(result.quota).toBeUndefined();
      expect(result.quotaPressure).toBe('unknown');
    });

    it('returns unhealthy when storage is not initialized', async () => {
      const monitor = createHealthMonitor(
        makeSource({ stats: { vectorCount: 0, dimension: 128, initialized: false } }),
      );
      const result = await monitor.getStorageHealth();

      expect(result.status).toBe('unhealthy');
    });
  });

  // ── index health ───────────────────────────────────────────────────────────

  describe('health diagnostic: index health', () => {
    it('returns healthy when index is enabled with no dirty entries', () => {
      const monitor = createHealthMonitor(makeSource({}));
      const result = monitor.getIndexHealth();

      expect(result.status).toBe('healthy');
      expect(result.enabled).toBe(true);
      expect(result.nodeCount).toBe(100);
      expect(result.dirtyCount).toBe(0);
      expect(result.hasDirtyIndexes).toBe(false);
    });

    it('returns degraded when dirty indexes are present', () => {
      const monitor = createHealthMonitor(
        makeSource({ indexStats: { enabled: true, nodeCount: 50, dirtyCount: 3 } }),
      );
      const result = monitor.getIndexHealth();

      expect(result.status).toBe('degraded');
      expect(result.hasDirtyIndexes).toBe(true);
      expect(result.dirtyCount).toBe(3);
    });

    it('returns healthy when index is disabled', () => {
      const monitor = createHealthMonitor(
        makeSource({ indexStats: { enabled: false, nodeCount: 0, dirtyCount: 0 } }),
      );
      const result = monitor.getIndexHealth();

      expect(result.status).toBe('healthy');
      expect(result.enabled).toBe(false);
    });

    it('exposes levels and avgConnections when available', () => {
      const monitor = createHealthMonitor(
        makeSource({
          indexStats: {
            enabled: true,
            nodeCount: 50,
            dirtyCount: 0,
            levels: [50, 10, 2],
            avgConnections: 8,
          },
        }),
      );
      const result = monitor.getIndexHealth();

      expect(result.levels).toEqual([50, 10, 2]);
      expect(result.avgConnections).toBe(8);
    });
  });

  // ── acceleration health ────────────────────────────────────────────────────

  describe('health diagnostic: acceleration availability', () => {
    it('reports workers as enabled and initialized', () => {
      const monitor = createHealthMonitor(
        makeSource({
          workerStats: {
            enabled: true,
            initialized: true,
            stats: { totalWorkers: 4, busyWorkers: 1, queueLength: 0 },
          },
        }),
      );
      const result = monitor.getAccelerationHealth();

      expect(result.workers.enabled).toBe(true);
      expect(result.workers.initialized).toBe(true);
      expect(result.workers.totalWorkers).toBe(4);
      expect(result.workers.busyWorkers).toBe(1);
    });

    it('reports GPU as available when GPU is enabled and available', () => {
      const monitor = createHealthMonitor(
        makeSource({
          gpuStats: { enabled: true, available: true, initialized: true },
        }),
      );
      const result = monitor.getAccelerationHealth();

      expect(result.gpu.enabled).toBe(true);
      expect(result.gpu.available).toBe(true);
    });

    it('reports WASM supported when WebAssembly is in the environment', () => {
      const monitor = createHealthMonitor(makeSource({}));
      const result = monitor.getAccelerationHealth();

      // Bun supports WebAssembly natively.
      expect(result.wasm.supported).toBe(true);
    });

    it('reports workers not enabled when disabled', () => {
      const monitor = createHealthMonitor(
        makeSource({ workerStats: { enabled: false, initialized: false } }),
      );
      const result = monitor.getAccelerationHealth();

      expect(result.workers.enabled).toBe(false);
    });
  });

  // ── adapter connectivity ───────────────────────────────────────────────────

  describe('health diagnostic: adapter connectivity', () => {
    it('returns connected with latency when stats call succeeds', async () => {
      const monitor = createHealthMonitor(makeSource({}));
      const result = await monitor.getConnectivity();

      expect(result.connected).toBe(true);
      expect(result.adapterType).toBe('indexed-database');
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(result.error).toBeUndefined();
    });

    it('returns disconnected with error when stats call fails', async () => {
      const monitor = createHealthMonitor(makeSource({ statsThrows: true }));
      const result = await monitor.getConnectivity();

      expect(result.connected).toBe(false);
      expect(typeof result.error).toBe('string');
    });
  });

  // ── full diagnostics report ────────────────────────────────────────────────

  describe('health diagnostic: full diagnostics report', () => {
    it('returns healthy status for a healthy source', async () => {
      const monitor = createHealthMonitor(makeSource({}));
      const report = await monitor.getDiagnostics();

      expect(report.status).toBe('healthy');
      expect(typeof report.version).toBe('string');
      expect(report.version.length).toBeGreaterThan(0);
      expect(typeof report.timestamp).toBe('number');
      expect(report.issues).toHaveLength(0);
      expect(report.hasPendingBackgroundWork).toBe(false);
    });

    it('includes version from the package', async () => {
      const monitor = createHealthMonitor(makeSource({}));
      const report = await monitor.getDiagnostics();

      // VERSION is something like "1.0.0-beta.1"
      expect(report.version).toMatch(/^\d+\.\d+/);
    });

    it('returns degraded and surfaces quota issue', async () => {
      const monitor = createHealthMonitor(
        makeSource({
          quota: {
            usage: 960_000,
            quota: 1_000_000,
            usageRatio: 0.96,
            available: 40_000,
          },
        }),
      );
      const report = await monitor.getDiagnostics();

      expect(report.status).toBe('degraded');
      expect(report.issues.some((i) => i.includes('quota'))).toBe(true);
    });

    it('returns degraded when dirty indexes are detected', async () => {
      const monitor = createHealthMonitor(
        makeSource({ indexStats: { enabled: true, nodeCount: 20, dirtyCount: 5 } }),
      );
      const report = await monitor.getDiagnostics();

      expect(report.status).toBe('degraded');
      expect(report.hasPendingBackgroundWork).toBe(true);
      expect(report.issues.some((i) => i.includes('dirty'))).toBe(true);
    });

    it('returns unhealthy when adapter connectivity fails', async () => {
      const monitor = createHealthMonitor(makeSource({ statsThrows: true }));
      const report = await monitor.getDiagnostics();

      expect(report.status).toBe('unhealthy');
      expect(report.connectivity.connected).toBe(false);
      expect(report.issues.some((i) => i.toLowerCase().includes('connect'))).toBe(true);
    });

    it('surfaces a GPU misconfiguration issue without downgrading status', async () => {
      const monitor = createHealthMonitor(
        makeSource({ gpuStats: { enabled: true, available: false, initialized: false } }),
      );
      const report = await monitor.getDiagnostics();

      // GPU mismatch is noted in issues, but system remains functional
      expect(report.issues.some((i) => i.toLowerCase().includes('gpu'))).toBe(true);
    });

    it('has all required fields in the report', async () => {
      const monitor = createHealthMonitor(makeSource({}));
      const report: DiagnosticsReport = await monitor.getDiagnostics();

      expect(report).toHaveProperty('version');
      expect(report).toHaveProperty('timestamp');
      expect(report).toHaveProperty('status');
      expect(report).toHaveProperty('storage');
      expect(report).toHaveProperty('index');
      expect(report).toHaveProperty('acceleration');
      expect(report).toHaveProperty('connectivity');
      expect(report).toHaveProperty('hasPendingBackgroundWork');
      expect(report).toHaveProperty('issues');
    });

    it('acceleration field contains workers, gpu, and wasm keys', async () => {
      const monitor = createHealthMonitor(makeSource({}));
      const report = await monitor.getDiagnostics();

      expect(report.acceleration).toHaveProperty('workers');
      expect(report.acceleration).toHaveProperty('gpu');
      expect(report.acceleration).toHaveProperty('wasm');
    });
  });

  // ── createHealthMonitor factory ────────────────────────────────────────────

  describe('createHealthMonitor factory', () => {
    it('returns a HealthMonitor instance', () => {
      const monitor = createHealthMonitor(makeSource({}));
      expect(monitor).toBeInstanceOf(HealthMonitor);
    });
  });
});
