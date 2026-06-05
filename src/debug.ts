/**
 * Debug and profiling tools
 * Import via: vector-frankl/debug
 */
import {
  createDebugConsole,
  createTimer,
  debugManager,
  debugMethod,
  getDebug,
  profiler,
  withContext,
  withProfiling,
} from './debug/index.js';

export type { DebugConfig, DebugConsole, PerformanceStats } from './debug/index.js';
export {
  createDebugConsole,
  createTimer,
  debugManager,
  debugMethod,
  getDebug,
  profiler,
  withContext,
  withProfiling,
};
