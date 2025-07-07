/**
 * Debug console commands for browser integration
 */

import { DebugContext } from './debug-context.js';
import { debugManager } from './debug-manager.js';
import { profiler } from './profiler.js';
import type { DebugConfig, DebugLevel, ExportFormat } from './types.js';

export interface DebugConsole {
  /** Enable debug mode */
  enable: (config?: Partial<DebugConfig>) => void;
  /** Disable debug mode */
  disable: () => void;
  /** Check if debug is enabled */
  isEnabled: () => boolean;
  /** Get current configuration */
  config: () => DebugConfig;
  /** Update configuration */
  setConfig: (config: Partial<DebugConfig>) => void;
  /** Clear debug entries */
  clear: () => void;
  /** Export debug data */
  export: (format?: ExportFormat) => Promise<string>;
  /** Download debug data as file */
  download: (format?: ExportFormat, filename?: string) => Promise<void>;
  /** Profiler commands */
  profile: ProfilerConsole;
  /** Tracer commands */
  trace: TracerConsole;
  /** Memory commands */
  memory: MemoryConsole;
  /** Stats commands */
  stats: StatsConsole;
  /** Context commands */
  context: ContextConsole;
}

export interface ProfilerConsole {
  /** Start profiling */
  start: () => void;
  /** Stop profiling */
  stop: () => void;
  /** Show profiling results */
  show: (operation?: string) => void;
  /** Clear profiling data */
  clear: () => void;
  /** Profile a function */
  run: <T>(name: string, fn: () => T | Promise<T>) => Promise<T>;
}

export interface TracerConsole {
  /** Set trace level */
  setLevel: (level: DebugLevel) => void;
  /** Show trace entries */
  show: (operation?: string) => void;
  /** Clear trace entries */
  clear: () => void;
}

export interface MemoryConsole {
  /** Show current memory usage */
  current: () => void;
  /** Analyze memory usage */
  analyze: () => void;
  /** Show memory timeline */
  timeline: () => void;
}

export interface StatsConsole {
  /** Show performance stats */
  performance: (operation?: string) => void;
  /** Show operation summary */
  operations: () => void;
  /** Show error summary */
  errors: () => void;
}

export interface ContextConsole {
  /** Show current context */
  current: () => void;
  /** Set context metadata */
  set: (key: string, value: unknown) => void;
  /** Add context tag */
  tag: (key: string, value: string) => void;
  /** Clear context */
  clear: () => void;
}

/**
 * Create debug console interface
 */
export function createDebugConsole(): DebugConsole {
  const context = DebugContext.getInstance();

  const profilerConsole: ProfilerConsole = {
    start: () => {
      debugManager.updateConfig({ profile: true });
      console.log('Profiling started');
    },

    stop: () => {
      debugManager.updateConfig({ profile: false });
      console.log('Profiling stopped');
    },

    show: (operation?: string) => {
      const stats = profiler.getStats(operation);
      if (stats.length === 0) {
        console.log('No profiling data available');
        return;
      }

      console.table(
        stats.map((s) => ({
          operation: s.operation,
          count: s.count,
          avg: `${s.avgDuration.toFixed(2)}ms`,
          min: `${s.minDuration.toFixed(2)}ms`,
          max: `${s.maxDuration.toFixed(2)}ms`,
          p95: `${s.percentiles.p95.toFixed(2)}ms`,
        })),
      );
    },

    clear: () => {
      profiler.clear();
      console.log('Profiling data cleared');
    },

    run: async <T>(name: string, fn: () => T | Promise<T>): Promise<T> => {
      console.log(`Profiling: ${name}`);
      const result = await profiler.profile(name, fn);
      const stats = profiler.getStats(name);
      if (stats.length > 0) {
        const latest = stats[0]!;
        console.log(`Completed: ${name} (${latest.avgDuration.toFixed(2)}ms)`);
      }
      return result;
    },
  };

  const tracerConsole: TracerConsole = {
    setLevel: (level: DebugLevel) => {
      debugManager.updateConfig({ traceLevel: level });
      console.log(`Trace level set to: ${level}`);
    },

    show: (operation?: string) => {
      const entries = debugManager.getEntries({
        type: 'trace',
        ...(operation && { operation }),
      });

      if (entries.length === 0) {
        console.log('No trace entries available');
        return;
      }

      console.group('Trace Entries');
      entries.forEach((entry) => {
        console.log(`[${entry.timestamp.toFixed(2)}ms] ${entry.operation}`, entry.data);
      });
      console.groupEnd();
    },

    clear: () => {
      const entries = debugManager.getEntries({ type: 'trace' });
      debugManager.clearEntries();
      console.log(`Cleared ${entries.length} trace entries`);
    },
  };

  const memoryConsole: MemoryConsole = {
    current: () => {
      const memory = debugManager.getMemoryUsage();
      if (!memory) {
        console.log('Memory tracking not available');
        return;
      }

      console.table({
        'Heap Used': `${(memory.heapUsed / 1024 / 1024).toFixed(2)} MB`,
        'Heap Total': `${(memory.heapTotal / 1024 / 1024).toFixed(2)} MB`,
        'Heap Limit': `${(memory.external / 1024 / 1024).toFixed(2)} MB`,
        'Array Buffers': `${(memory.arrayBuffers / 1024 / 1024).toFixed(2)} MB`,
      });
    },

    analyze: () => {
      const memoryEntries = debugManager.getEntries({ type: 'memory' });
      if (memoryEntries.length === 0) {
        console.log('No memory data available');
        return;
      }

      const analysis = memoryEntries.reduce(
        (acc, entry) => {
          if (entry.memoryUsage?.delta) {
            acc.totalHeapDelta += entry.memoryUsage.delta.heapUsed;
            acc.totalArrayBufferDelta += entry.memoryUsage.delta.arrayBuffers;
            acc.operations++;
          }
          return acc;
        },
        { totalHeapDelta: 0, totalArrayBufferDelta: 0, operations: 0 },
      );

      console.log('Memory Analysis:');
      console.table({
        Operations: analysis.operations,
        'Avg Heap Delta': `${(analysis.totalHeapDelta / analysis.operations / 1024).toFixed(2)} KB`,
        'Avg Buffer Delta': `${(analysis.totalArrayBufferDelta / analysis.operations / 1024).toFixed(2)} KB`,
      });
    },

    timeline: () => {
      const memoryEntries = debugManager.getEntries({ type: 'memory' });
      if (memoryEntries.length === 0) {
        console.log('No memory timeline available');
        return;
      }

      console.log('Memory Timeline:');
      memoryEntries.forEach((entry) => {
        if (entry.memoryUsage) {
          const heap = (entry.memoryUsage.heapUsed / 1024 / 1024).toFixed(2);
          console.log(
            `[${entry.timestamp.toFixed(2)}ms] ${entry.operation}: ${heap}MB heap`,
          );
        }
      });
    },
  };

  const statsConsole: StatsConsole = {
    performance: (operation?: string) => {
      profilerConsole.show(operation);
    },

    operations: () => {
      const entries = debugManager.getEntries();
      const operationCounts = entries.reduce(
        (acc, entry) => {
          acc[entry.operation] = (acc[entry.operation] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      );

      console.table(
        Object.entries(operationCounts)
          .sort(([, a], [, b]) => b - a)
          .reduce(
            (acc, [op, count]) => {
              acc[op] = count;
              return acc;
            },
            {} as Record<string, number>,
          ),
      );
    },

    errors: () => {
      const errorEntries = debugManager.getEntries({ type: 'error' });
      if (errorEntries.length === 0) {
        console.log('No errors recorded');
        return;
      }

      const errorGroups = errorEntries.reduce(
        (acc, entry) => {
          const key = entry.operation;
          if (!acc[key]) acc[key] = [];
          acc[key].push(entry);
          return acc;
        },
        {} as Record<string, typeof errorEntries>,
      );

      console.log('Error Summary:');
      Object.entries(errorGroups).forEach(([operation, errors]) => {
        console.group(`${operation} (${errors.length} errors)`);
        errors.forEach((error) => {
          console.error(
            `[${error.timestamp.toFixed(2)}ms]`,
            error.error?.message,
            error.data,
          );
        });
        console.groupEnd();
      });
    },
  };

  const contextConsole: ContextConsole = {
    current: () => {
      const currentContext = context.getCurrentContext();
      if (!currentContext) {
        console.log('No active context');
        return;
      }

      console.table({
        Namespace: currentContext.namespace || 'N/A',
        'Operation Type': currentContext.operationType || 'N/A',
        'Vector Dimensions': currentContext.vectorDimensions || 'N/A',
        'Vector Count': currentContext.vectorCount || 'N/A',
      });

      if (currentContext.tags.size > 0) {
        console.log('Tags:', Object.fromEntries(currentContext.tags));
      }

      if (currentContext.metadata.size > 0) {
        console.log('Metadata:', Object.fromEntries(currentContext.metadata));
      }
    },

    set: (key: string, value: unknown) => {
      context.addMetadata(key, value);
      console.log(`Set context metadata: ${key} = ${value}`);
    },

    tag: (key: string, value: string) => {
      context.addTag(key, value);
      console.log(`Added context tag: ${key} = ${value}`);
    },

    clear: () => {
      context.clearAll();
      console.log('Context cleared');
    },
  };

  return {
    enable: (config?: Partial<DebugConfig>) => {
      debugManager.enable(config);
      console.log('Debug mode enabled');
    },

    disable: () => {
      debugManager.disable();
      console.log('Debug mode disabled');
    },

    isEnabled: () => {
      return debugManager.isEnabled();
    },

    config: () => {
      return debugManager.getConfig();
    },

    setConfig: (config: Partial<DebugConfig>) => {
      debugManager.updateConfig(config);
      console.log('Debug configuration updated', config);
    },

    clear: () => {
      debugManager.clearEntries();
      profiler.clear();
      console.log('All debug data cleared');
    },

    export: async (format?: ExportFormat) => {
      return debugManager.exportData(format);
    },

    download: async (format: ExportFormat = 'json', filename?: string) => {
      if (typeof window === 'undefined' || !window.document) {
        console.error('Download not available in this environment');
        return;
      }

      const data = await debugManager.exportData(format);
      const blob = new Blob([data], {
        type: format === 'json' ? 'application/json' : 'text/plain',
      });

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename || `vector-frankl-debug.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      console.log(`Debug data downloaded as ${a.download}`);
    },

    profile: profilerConsole,
    trace: tracerConsole,
    memory: memoryConsole,
    stats: statsConsole,
    context: contextConsole,
  };
}

// Global debug console (if in browser)
if (typeof window !== 'undefined') {
  // Add to window object for easy access
  (window as Window & { vectorFranklDebug?: DebugConsole }).vectorFranklDebug =
    createDebugConsole();
}
