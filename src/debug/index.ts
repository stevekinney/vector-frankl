/**
 * Debug and profiling module
 * 
 * Provides comprehensive debugging and profiling capabilities for Vector Frankl
 */

// Core debug system
import { debugManager, DebugManager } from './debug-manager.js';
import { profiler, Profiler, NestedProfiler } from './profiler.js';
import { DebugContext } from './debug-context.js';
import { createDebugConsole } from './console.js';

export { debugManager, DebugManager };
export { profiler, Profiler, NestedProfiler };
export { DebugContext };
export { createDebugConsole };
export type {
  DebugConsole,
  ProfilerConsole,
  TracerConsole,
  MemoryConsole,
  StatsConsole,
  ContextConsole
} from './console.js';

// Debug hooks and utilities
export {
  debugMethod,
  withProfiling,
  withContext,
  trace,
  logMetrics,
  logMemoryUsage,
  DebugTimer,
  createTimer,
  debugAssert,
  DebugBatch,
  createBatch
} from './hooks.js';

// Types
export type {
  DebugConfig,
  DebugEntry,
  DebugLevel,
  ExportFormat,
  MemoryUsage,
  ProfileEntry,
  TraceEntry,
  PerformanceStats,
  DebugReport
} from './types.js';

// Convenience exports
export const debug = {
  manager: debugManager,
  profiler,
  context: DebugContext.getInstance(),
  console: createDebugConsole()
};

// Initialize debug console in browser environment
if (typeof window !== 'undefined') {
  // Make debug tools globally available
  interface VectorFranklWindow extends Window {
    vectorFrankl?: {
      debug?: ReturnType<typeof createDebugConsole>;
    };
  }
  const windowWithDebug = window as VectorFranklWindow;
  windowWithDebug.vectorFrankl = windowWithDebug.vectorFrankl || {};
  windowWithDebug.vectorFrankl.debug = debug.console;
  
  // Add debug mode detection
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('debug') === 'true' || localStorage.getItem('VECTOR_FRANKL_DEBUG') === 'true') {
    debugManager.enable({
      profile: urlParams.get('profile') === 'true',
      traceLevel: (urlParams.get('trace') as 'basic' | 'detailed' | 'verbose') || 'basic',
      memoryTracking: urlParams.get('memory') === 'true'
    });
    
    console.log('Vector Frankl debug mode enabled');
    console.log('Use vectorFrankl.debug.* commands for debugging');
  }
}

// Default export
export default debug;