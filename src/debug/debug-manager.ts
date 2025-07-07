/**
 * Central debug management system
 */

import { log } from '@/utilities/logger.js';
import { DebugContext } from './debug-context.js';
import type { DebugConfig, DebugEntry, DebugLevel, ExportFormat } from './types.js';

export class DebugManager {
  private static instance: DebugManager;
  private config: DebugConfig;
  private entries: DebugEntry[] = [];
  private enabled: boolean;
  private context: DebugContext;
  private startTime: number;
  private entryCounter = 0;

  private constructor() {
    this.context = DebugContext.getInstance();
    this.startTime = performance.now();

    // Default configuration
    this.config = {
      enabled: false,
      profile: false,
      traceLevel: 'none',
      memoryTracking: false,
      exportFormat: 'json',
      sampling: {
        rate: 1,
        threshold: 0,
      },
      maxEntries: 10000,
      consoleOutput: true,
    };

    // Check environment variables
    this.enabled = this.checkEnvironment();
    if (this.enabled) {
      this.config.enabled = true;
      this.config.profile = this.checkEnvFlag('VECTOR_FRANKL_PROFILE');
      this.config.traceLevel = this.getEnvTraceLevel();
      this.config.memoryTracking = this.checkEnvFlag('VECTOR_FRANKL_MEMORY_TRACKING');
    }
  }

  static getInstance(): DebugManager {
    if (!DebugManager.instance) {
      DebugManager.instance = new DebugManager();
    }
    return DebugManager.instance;
  }

  /**
   * Check if debug mode should be enabled from environment
   */
  private checkEnvironment(): boolean {
    if (typeof process !== 'undefined' && process.env) {
      return process.env['VECTOR_FRANKL_DEBUG'] === 'true';
    }

    // Check browser environment
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage.getItem('VECTOR_FRANKL_DEBUG') === 'true';
    }

    return false;
  }

  /**
   * Check environment flag
   */
  private checkEnvFlag(key: string): boolean {
    if (typeof process !== 'undefined' && process.env) {
      return process.env[key] === 'true';
    }

    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage.getItem(key) === 'true';
    }

    return false;
  }

  /**
   * Get trace level from environment
   */
  private getEnvTraceLevel(): DebugLevel {
    let level: string | null = null;

    if (typeof process !== 'undefined' && process.env) {
      level = process.env['VECTOR_FRANKL_TRACE_LEVEL'] || null;
    } else if (typeof window !== 'undefined' && window.localStorage) {
      level = window.localStorage.getItem('VECTOR_FRANKL_TRACE_LEVEL');
    }

    if (level && ['none', 'basic', 'detailed', 'verbose'].includes(level)) {
      return level as DebugLevel;
    }

    return 'basic';
  }

  /**
   * Enable debug mode
   */
  enable(config?: Partial<DebugConfig>): void {
    this.enabled = true;
    this.config = {
      ...this.config,
      enabled: true,
      // Default to 'basic' trace level when enabling if still 'none'
      traceLevel: this.config.traceLevel === 'none' ? 'basic' : this.config.traceLevel,
      ...config,
    };

    if (this.config.consoleOutput) {
      log.info('Debug mode enabled', { config: this.config });
    }
  }

  /**
   * Disable debug mode
   */
  disable(): void {
    this.enabled = false;
    this.config.enabled = false;

    if (this.config.consoleOutput) {
      log.info('Debug mode disabled');
    }
  }

  /**
   * Check if debug mode is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<DebugConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): DebugConfig {
    return { ...this.config };
  }

  /**
   * Check if should sample this operation
   */
  private shouldSample(): boolean {
    if (this.config.sampling.rate <= 1) return true;
    return Math.random() < 1 / this.config.sampling.rate;
  }

  /**
   * Check if level is enabled
   */
  private isLevelEnabled(level: DebugLevel): boolean {
    const levels: DebugLevel[] = ['none', 'basic', 'detailed', 'verbose'];
    const currentIndex = levels.indexOf(this.config.traceLevel);
    const requestedIndex = levels.indexOf(level);
    return currentIndex >= requestedIndex;
  }

  /**
   * Add debug entry
   */
  addEntry(entry: Omit<DebugEntry, 'id' | 'timestamp'>): void {
    if (!this.enabled || !this.shouldSample()) return;
    if (!this.isLevelEnabled(entry.level)) return;

    const fullEntry: DebugEntry = {
      ...entry,
      id: `${Date.now()}-${++this.entryCounter}`,
      timestamp: performance.now() - this.startTime,
    };

    // Add context information
    const contextSummary = this.context.getContextSummary();
    if (Object.keys(contextSummary).length > 0) {
      fullEntry.data = { ...fullEntry.data, context: contextSummary };
    }

    // Store entry
    this.entries.push(fullEntry);

    // Maintain max entries limit
    if (this.entries.length > this.config.maxEntries) {
      this.entries.shift();
    }

    // Output to console if enabled
    if (this.config.consoleOutput) {
      this.outputToConsole(fullEntry);
    }

    // Call custom handler if provided
    if (this.config.outputHandler) {
      this.config.outputHandler(fullEntry);
    }
  }

  /**
   * Output entry to console
   */
  private outputToConsole(entry: DebugEntry): void {
    const prefix = `[DEBUG:${entry.type.toUpperCase()}]`;
    const time = `+${entry.timestamp.toFixed(2)}ms`;

    switch (entry.type) {
      case 'error':
        console.error(`${prefix} ${time} ${entry.operation}`, entry.data, entry.error);
        break;
      case 'profile':
        console.log(
          `${prefix} ${time} ${entry.operation} (${entry.duration?.toFixed(2)}ms)`,
          entry.data,
        );
        break;
      case 'memory':
        console.log(
          `${prefix} ${time} ${entry.operation}`,
          entry.memoryUsage,
          entry.data,
        );
        break;
      default:
        console.log(`${prefix} ${time} ${entry.operation}`, entry.data);
    }
  }

  /**
   * Get current memory usage
   */
  getMemoryUsage(): MemoryUsage | null {
    if (typeof performance === 'undefined' || !('memory' in performance)) {
      return null;
    }

    const memory = (performance as Performance & { memory?: PerformanceMemory }).memory;
    if (!memory) return null;
    return {
      heapUsed: memory.usedJSHeapSize,
      heapTotal: memory.totalJSHeapSize,
      external: memory.jsHeapSizeLimit - memory.totalJSHeapSize,
      arrayBuffers: 0, // Would need to track manually
    };
  }

  /**
   * Clear debug entries
   */
  clearEntries(): void {
    this.entries = [];
  }

  /**
   * Get debug entries
   */
  getEntries(filter?: {
    type?: DebugEntry['type'];
    operation?: string;
    level?: DebugLevel;
    startTime?: number;
    endTime?: number;
  }): DebugEntry[] {
    let filtered = [...this.entries];

    if (filter) {
      if (filter.type) {
        filtered = filtered.filter((e) => e.type === filter.type);
      }
      if (filter.operation) {
        filtered = filtered.filter((e) => e.operation.includes(filter.operation!));
      }
      if (filter.level) {
        filtered = filtered.filter((e) => e.level === filter.level);
      }
      if (filter.startTime !== undefined) {
        filtered = filtered.filter((e) => e.timestamp >= filter.startTime!);
      }
      if (filter.endTime !== undefined) {
        filtered = filtered.filter((e) => e.timestamp <= filter.endTime!);
      }
    }

    return filtered;
  }

  /**
   * Export debug data
   */
  async exportData(format?: ExportFormat): Promise<string> {
    const exportFormat = format || this.config.exportFormat;
    const entries = this.getEntries();

    switch (exportFormat) {
      case 'json':
        return JSON.stringify(entries, null, 2);

      case 'csv':
        return this.exportAsCSV(entries);

      case 'devtools':
        return this.exportAsDevTools(entries);

      case 'html':
        return this.exportAsHTML(entries);

      default:
        throw new Error(`Unsupported export format: ${exportFormat}`);
    }
  }

  /**
   * Export as CSV
   */
  private exportAsCSV(entries: DebugEntry[]): string {
    const headers = ['id', 'timestamp', 'type', 'operation', 'level', 'duration', 'data'];
    const rows = entries.map((e) => [
      e.id,
      e.timestamp.toFixed(2),
      e.type,
      e.operation,
      e.level,
      e.duration?.toFixed(2) || '',
      JSON.stringify(e.data),
    ]);

    return [headers, ...rows].map((row) => row.join(',')).join('\n');
  }

  /**
   * Export as Chrome DevTools format
   */
  private exportAsDevTools(entries: DebugEntry[]): string {
    const profileEntries = entries.filter((e) => e.type === 'profile');

    const traceEvents = profileEntries.map((e) => ({
      name: e.operation,
      cat: 'vector-frankl',
      ph: 'X', // Complete event
      ts: e.timestamp * 1000, // Convert to microseconds
      dur: (e.duration || 0) * 1000,
      pid: 1,
      tid: 1,
      args: e.data,
    }));

    return JSON.stringify({
      traceEvents,
      displayTimeUnit: 'ms',
      metadata: {
        'vector-frankl-version': '1.0.0',
      },
    });
  }

  /**
   * Export as HTML report
   */
  private exportAsHTML(entries: DebugEntry[]): string {
    const stats = this.calculateStats(entries);

    return `
<!DOCTYPE html>
<html>
<head>
  <title>Vector Frankl Debug Report</title>
  <style>
    body { font-family: monospace; margin: 20px; }
    .summary { background: #f0f0f0; padding: 10px; margin-bottom: 20px; }
    .entry { margin: 5px 0; padding: 5px; border-left: 3px solid #ccc; }
    .entry.error { border-color: #f00; }
    .entry.profile { border-color: #00f; }
    .entry.memory { border-color: #0f0; }
    .timestamp { color: #666; }
    .duration { color: #00f; font-weight: bold; }
  </style>
</head>
<body>
  <h1>Vector Frankl Debug Report</h1>
  <div class="summary">
    <h2>Summary</h2>
    <p>Total Entries: ${entries.length}</p>
    <p>Duration: ${(entries[entries.length - 1]?.timestamp || 0).toFixed(2)}ms</p>
    <p>Operations: ${stats.operations}</p>
    <p>Errors: ${stats.errors}</p>
  </div>
  <h2>Entries</h2>
  ${entries
    .map(
      (e) => `
    <div class="entry ${e.type}">
      <span class="timestamp">${e.timestamp.toFixed(2)}ms</span>
      <strong>${e.type.toUpperCase()}</strong>
      ${e.operation}
      ${e.duration ? `<span class="duration">(${e.duration.toFixed(2)}ms)</span>` : ''}
      <pre>${JSON.stringify(e.data, null, 2)}</pre>
    </div>
  `,
    )
    .join('')}
</body>
</html>`;
  }

  /**
   * Calculate statistics from entries
   */
  private calculateStats(entries: DebugEntry[]) {
    return {
      operations: new Set(entries.map((e) => e.operation)).size,
      errors: entries.filter((e) => e.type === 'error').length,
    };
  }
}

// Export singleton instance
export const debugManager = DebugManager.getInstance();

// Type for MemoryUsage
interface MemoryUsage {
  heapUsed: number;
  heapTotal: number;
  external: number;
  arrayBuffers: number;
}

// Performance memory interface for Chrome's non-standard API
interface PerformanceMemory {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

// Re-export ExportFormat type
export type { ExportFormat } from './types.js';
