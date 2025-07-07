/**
 * Debug and profiling types
 */

export type DebugLevel = 'none' | 'basic' | 'detailed' | 'verbose';
export type ExportFormat = 'json' | 'csv' | 'devtools' | 'html';

export interface DebugConfig {
  /** Enable debug mode */
  enabled: boolean;
  /** Enable automatic profiling */
  profile: boolean;
  /** Trace verbosity level */
  traceLevel: DebugLevel;
  /** Enable memory tracking */
  memoryTracking: boolean;
  /** Export format for debug data */
  exportFormat: ExportFormat;
  /** Sampling configuration */
  sampling: {
    /** Sample 1 in N operations */
    rate: number;
    /** Only profile operations > threshold ms */
    threshold: number;
  };
  /** Maximum number of profiling entries to keep */
  maxEntries: number;
  /** Enable console output */
  consoleOutput: boolean;
  /** Custom output handler */
  outputHandler?: (entry: DebugEntry) => void;
}

export interface DebugEntry {
  /** Unique ID for the entry */
  id: string;
  /** Timestamp when the entry was created */
  timestamp: number;
  /** Type of debug entry */
  type: 'profile' | 'trace' | 'memory' | 'error' | 'info';
  /** Operation being debugged */
  operation: string;
  /** Debug level */
  level: DebugLevel;
  /** Additional data */
  data: Record<string, unknown>;
  /** Parent entry ID for nested operations */
  parentId?: string;
  /** Duration in milliseconds (for profile entries) */
  duration?: number;
  /** Memory usage in bytes (for memory entries) */
  memoryUsage?: MemoryUsage;
  /** Error information (for error entries) */
  error?: {
    message: string;
    stack?: string;
    code?: string;
  };
}

export interface MemoryUsage {
  /** Heap used in bytes */
  heapUsed: number;
  /** Heap total in bytes */
  heapTotal: number;
  /** External memory in bytes */
  external: number;
  /** Array buffers in bytes */
  arrayBuffers: number;
  /** Change since last measurement */
  delta?: {
    heapUsed: number;
    heapTotal: number;
    external: number;
    arrayBuffers: number;
  };
}

export interface ProfileEntry {
  /** Operation name */
  operation: string;
  /** Start timestamp */
  startTime: number;
  /** End timestamp */
  endTime?: number;
  /** Duration in milliseconds */
  duration?: number;
  /** Operation metadata */
  metadata: Record<string, unknown>;
  /** Child operations */
  children: ProfileEntry[];
  /** Memory usage at start and end */
  memory?: {
    start: MemoryUsage;
    end?: MemoryUsage;
  };
  /** Performance marks */
  marks: Map<string, number>;
  /** Custom metrics */
  metrics: Map<string, number>;
}

export interface TraceEntry {
  /** Trace ID */
  id: string;
  /** Operation name */
  operation: string;
  /** Timestamp */
  timestamp: number;
  /** Call stack */
  stack?: string[];
  /** Input parameters */
  params?: unknown[];
  /** Return value */
  result?: unknown;
  /** Error if operation failed */
  error?: Error;
  /** Metadata */
  metadata: Record<string, unknown>;
}

export interface PerformanceStats {
  /** Operation name */
  operation: string;
  /** Number of calls */
  count: number;
  /** Total duration */
  totalDuration: number;
  /** Min duration */
  minDuration: number;
  /** Max duration */
  maxDuration: number;
  /** Average duration */
  avgDuration: number;
  /** Percentiles */
  percentiles: {
    p50: number;
    p90: number;
    p95: number;
    p99: number;
  };
  /** Memory stats */
  memory?: {
    avgHeapUsed: number;
    maxHeapUsed: number;
    avgArrayBuffers: number;
    maxArrayBuffers: number;
  };
}

export interface DebugReport {
  /** Report ID */
  id: string;
  /** Generation timestamp */
  timestamp: number;
  /** Time range */
  timeRange: {
    start: number;
    end: number;
  };
  /** Performance statistics */
  performanceStats: PerformanceStats[];
  /** Memory timeline */
  memoryTimeline: MemoryUsage[];
  /** Trace entries */
  traces: TraceEntry[];
  /** Error summary */
  errors: Array<{
    operation: string;
    count: number;
    samples: Error[];
  }>;
  /** System information */
  systemInfo: {
    userAgent: string;
    memory?: {
      jsHeapSizeLimit: number;
      totalJSHeapSize: number;
      usedJSHeapSize: number;
    };
    connection?: {
      effectiveType: string;
      downlink: number;
    };
  };
}