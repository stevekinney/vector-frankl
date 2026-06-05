/**
 * Debug and profiling module
 *
 * Provides comprehensive debugging and profiling capabilities for Vector Frankl
 */

// Core debug system
import { createDebugConsole } from './console.js';
import { DebugContext } from './debug-context.js';
import { DebugManager, debugManager } from './debug-manager.js';
import { NestedProfiler, Profiler, profiler } from './profiler.js';

export { DebugManager, debugManager };
export { NestedProfiler, Profiler, profiler };
export { DebugContext };
export { createDebugConsole };
export type {
  ContextConsole,
  DebugConsole,
  MemoryConsole,
  ProfilerConsole,
  StatsConsole,
  TracerConsole,
} from './console.js';

// Debug hooks and utilities
export {
  createBatch,
  createTimer,
  debugAssert,
  DebugBatch,
  debugMethod,
  DebugTimer,
  logMemoryUsage,
  logMetrics,
  trace,
  withContext,
  withProfiling,
} from './hooks.js';

// Types
export type {
  DebugConfig,
  DebugEntry,
  DebugLevel,
  DebugReport,
  ExportFormat,
  MemoryUsage,
  PerformanceStats,
  ProfileEntry,
  TraceEntry,
} from './types.js';

// Lazy debug accessor — avoids import-time side effects
interface DebugTools {
  manager: typeof debugManager;
  profiler: typeof profiler;
  context: DebugContext;
  console: ReturnType<typeof createDebugConsole>;
}

let _debugInstance: DebugTools | null = null;
let _browserInitialized = false;

function initializeBrowserDebug(debugTools: DebugTools): void {
  if (_browserInitialized || typeof window === 'undefined') return;
  _browserInitialized = true;

  interface VectorFranklWindow extends Window {
    vectorFrankl?: {
      debug?: ReturnType<typeof createDebugConsole>;
    };
  }
  const windowWithDebug = window as VectorFranklWindow;
  windowWithDebug.vectorFrankl = windowWithDebug.vectorFrankl || {};
  windowWithDebug.vectorFrankl.debug = debugTools.console;

  const urlParams = new URLSearchParams(window.location.search);
  if (
    urlParams.get('debug') === 'true' ||
    localStorage.getItem('VECTOR_FRANKL_DEBUG') === 'true'
  ) {
    debugManager.enable({
      profile: urlParams.get('profile') === 'true',
      traceLevel: (urlParams.get('trace') as 'basic' | 'detailed' | 'verbose') || 'basic',
      memoryTracking: urlParams.get('memory') === 'true',
    });

    console.log('Vector Frankl debug mode enabled');
    console.log('Use vectorFrankl.debug.* commands for debugging');
  }
}

/**
 * Get the debug tools instance (lazy initialization).
 */
export function getDebug(): DebugTools {
  if (!_debugInstance) {
    _debugInstance = {
      manager: debugManager,
      profiler,
      context: DebugContext.getInstance(),
      console: createDebugConsole(),
    };
    initializeBrowserDebug(_debugInstance);
  }
  return _debugInstance;
}

// Default export
export default getDebug;
