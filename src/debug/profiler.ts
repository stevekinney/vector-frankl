/**
 * Performance profiler for vector operations
 */

import { DebugContext } from './debug-context.js';
import { debugManager } from './debug-manager.js';
import type { MemoryUsage, PerformanceStats, ProfileEntry } from './types.js';

// Performance memory interface for Chrome's non-standard API
interface PerformanceMemory {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

export class Profiler {
  private static instance: Profiler;
  private activeProfiles = new Map<string, ProfileEntry>();
  private completedProfiles: ProfileEntry[] = [];
  private performanceStats = new Map<string, number[]>();
  private context: DebugContext;

  private constructor() {
    this.context = DebugContext.getInstance();
  }

  static getInstance(): Profiler {
    if (!Profiler.instance) {
      Profiler.instance = new Profiler();
    }
    return Profiler.instance;
  }

  /**
   * Start profiling an operation
   */
  startProfile(operation: string, metadata: Record<string, unknown> = {}): string {
    if (!debugManager.isEnabled() || !debugManager.getConfig().profile) {
      return operation;
    }

    const profileId = `${operation}-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

    const entry: ProfileEntry = {
      operation,
      startTime: performance.now(),
      metadata: {
        ...metadata,
        context: this.context.getContextSummary(),
      },
      children: [],
      marks: new Map(),
      metrics: new Map(),
    };

    // Capture initial memory if tracking is enabled
    if (debugManager.getConfig().memoryTracking) {
      const memoryUsage = this.captureMemoryUsage();
      if (memoryUsage) {
        entry.memory = { start: memoryUsage };
      }
    }

    this.activeProfiles.set(profileId, entry);

    return profileId;
  }

  /**
   * End profiling an operation
   */
  endProfile(profileId: string, result?: unknown): ProfileEntry | null {
    if (!debugManager.isEnabled() || !debugManager.getConfig().profile) {
      return null;
    }

    const entry = this.activeProfiles.get(profileId);
    if (!entry) {
      console.warn(`Profile ${profileId} not found`);
      return null;
    }

    entry.endTime = performance.now();
    entry.duration = entry.endTime - entry.startTime;

    // Capture final memory if tracking is enabled
    if (debugManager.getConfig().memoryTracking && entry.memory) {
      const memoryUsage = this.captureMemoryUsage();
      if (memoryUsage) {
        entry.memory.end = memoryUsage;
      }
    }

    // Check if duration exceeds threshold
    const threshold = debugManager.getConfig().sampling.threshold;
    if (entry.duration < threshold) {
      this.activeProfiles.delete(profileId);
      return null;
    }

    // Store result metadata
    if (result !== undefined) {
      entry.metadata['result'] = result;
    }

    // Move to completed profiles
    this.activeProfiles.delete(profileId);
    this.completedProfiles.push(entry);

    // Update performance stats
    this.updatePerformanceStats(entry.operation, entry.duration);

    // Add debug entry
    debugManager.addEntry({
      type: 'profile',
      operation: entry.operation,
      level: 'basic',
      data: {
        duration: entry.duration,
        metadata: entry.metadata,
        marks: Object.fromEntries(entry.marks),
        metrics: Object.fromEntries(entry.metrics),
        memory: entry.memory,
      },
      ...(entry.duration !== undefined && { duration: entry.duration }),
      ...(entry.memory?.end && { memoryUsage: entry.memory.end }),
    });

    return entry;
  }

  /**
   * Add a performance mark
   */
  mark(profileId: string, markName: string): void {
    const entry = this.activeProfiles.get(profileId);
    if (!entry) return;

    entry.marks.set(markName, performance.now() - entry.startTime);
  }

  /**
   * Add a custom metric
   */
  metric(profileId: string, metricName: string, value: number): void {
    const entry = this.activeProfiles.get(profileId);
    if (!entry) return;

    entry.metrics.set(metricName, value);
  }

  /**
   * Profile a function execution
   */
  async profile<T>(
    operation: string,
    fn: () => T | Promise<T>,
    metadata: Record<string, unknown> = {},
  ): Promise<T> {
    const profileId = this.startProfile(operation, metadata);

    try {
      const result = await fn();
      this.endProfile(profileId, result);
      return result;
    } catch (error) {
      this.endProfile(profileId, {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Profile with nested operations
   */
  async profileNested<T>(
    operation: string,
    fn: (profiler: NestedProfiler) => T | Promise<T>,
    metadata: Record<string, unknown> = {},
  ): Promise<T> {
    const profileId = this.startProfile(operation, metadata);
    const parentEntry = this.activeProfiles.get(profileId);

    if (!parentEntry) {
      return fn(new NestedProfiler(this, null));
    }

    const nestedProfiler = new NestedProfiler(this, parentEntry);

    try {
      const result = await fn(nestedProfiler);
      this.endProfile(profileId, result);
      return result;
    } catch (error) {
      this.endProfile(profileId, {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Capture current memory usage
   */
  private captureMemoryUsage(): MemoryUsage | null {
    if (typeof performance === 'undefined' || !('memory' in performance)) {
      return null;
    }

    const memory = (performance as Performance & { memory?: PerformanceMemory }).memory;
    if (!memory) return null;
    const usage: MemoryUsage = {
      heapUsed: memory.usedJSHeapSize,
      heapTotal: memory.totalJSHeapSize,
      external: memory.jsHeapSizeLimit - memory.totalJSHeapSize,
      arrayBuffers: this.estimateArrayBufferUsage(),
    };

    // Calculate delta if we have previous measurements
    const lastMemory = this.getLastMemoryUsage();
    if (lastMemory) {
      usage.delta = {
        heapUsed: usage.heapUsed - lastMemory.heapUsed,
        heapTotal: usage.heapTotal - lastMemory.heapTotal,
        external: usage.external - lastMemory.external,
        arrayBuffers: usage.arrayBuffers - lastMemory.arrayBuffers,
      };
    }

    return usage;
  }

  /**
   * Estimate ArrayBuffer usage (simplified)
   */
  private estimateArrayBufferUsage(): number {
    // This is a simplified estimation
    // In a real implementation, you'd track ArrayBuffer allocations
    return 0;
  }

  /**
   * Get last memory usage measurement
   */
  private getLastMemoryUsage(): MemoryUsage | null {
    const lastProfile = this.completedProfiles[this.completedProfiles.length - 1];
    return lastProfile?.memory?.end || null;
  }

  /**
   * Update performance statistics
   */
  private updatePerformanceStats(operation: string, duration: number): void {
    if (!this.performanceStats.has(operation)) {
      this.performanceStats.set(operation, []);
    }

    const durations = this.performanceStats.get(operation)!;
    durations.push(duration);

    // Keep only last 1000 measurements
    if (durations.length > 1000) {
      durations.shift();
    }
  }

  /**
   * Get performance statistics for an operation
   */
  getStats(operation?: string): PerformanceStats[] {
    const operations = operation ? [operation] : Array.from(this.performanceStats.keys());

    return operations.map((op) => {
      const durations = this.performanceStats.get(op) || [];
      if (durations.length === 0) {
        return {
          operation: op,
          count: 0,
          totalDuration: 0,
          minDuration: 0,
          maxDuration: 0,
          avgDuration: 0,
          percentiles: { p50: 0, p90: 0, p95: 0, p99: 0 },
        };
      }

      const sorted = [...durations].sort((a, b) => a - b);
      const sum = sorted.reduce((acc, val) => acc + val, 0);

      return {
        operation: op,
        count: sorted.length,
        totalDuration: sum,
        minDuration: sorted[0]!,
        maxDuration: sorted[sorted.length - 1]!,
        avgDuration: sum / sorted.length,
        percentiles: {
          p50: this.percentile(sorted, 0.5),
          p90: this.percentile(sorted, 0.9),
          p95: this.percentile(sorted, 0.95),
          p99: this.percentile(sorted, 0.99),
        },
      };
    });
  }

  /**
   * Calculate percentile
   */
  private percentile(sorted: number[], p: number): number {
    const index = Math.ceil(sorted.length * p) - 1;
    return sorted[Math.max(0, Math.min(index, sorted.length - 1))]!;
  }

  /**
   * Clear profiling data
   */
  clear(): void {
    this.activeProfiles.clear();
    this.completedProfiles = [];
    this.performanceStats.clear();
  }

  /**
   * Get active profiles
   */
  getActiveProfiles(): ProfileEntry[] {
    return Array.from(this.activeProfiles.values());
  }

  /**
   * Get completed profiles
   */
  getCompletedProfiles(filter?: {
    operation?: string;
    minDuration?: number;
    maxDuration?: number;
  }): ProfileEntry[] {
    let filtered = [...this.completedProfiles];

    if (filter) {
      if (filter.operation) {
        filtered = filtered.filter((p) => p.operation.includes(filter.operation!));
      }
      if (filter.minDuration !== undefined) {
        filtered = filtered.filter((p) => (p.duration || 0) >= filter.minDuration!);
      }
      if (filter.maxDuration !== undefined) {
        filtered = filtered.filter((p) => (p.duration || 0) <= filter.maxDuration!);
      }
    }

    return filtered;
  }
}

/**
 * Nested profiler for child operations
 */
export class NestedProfiler {
  constructor(
    private profiler: Profiler,
    private parentEntry: ProfileEntry | null,
  ) {}

  async profile<T>(
    operation: string,
    fn: () => T | Promise<T>,
    metadata: Record<string, unknown> = {},
  ): Promise<T> {
    const result = await this.profiler.profile(operation, fn, metadata);

    // Add to parent's children if exists
    if (this.parentEntry) {
      const completed = this.profiler.getCompletedProfiles({ operation }).pop();
      if (completed) {
        this.parentEntry.children.push(completed);
      }
    }

    return result;
  }
}

// Export singleton instance
export const profiler = Profiler.getInstance();
