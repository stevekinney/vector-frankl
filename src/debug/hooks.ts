/**
 * Debug hooks for integrating with existing components
 */

import { debugManager } from './debug-manager.js';
import { profiler } from './profiler.js';
import { DebugContext } from './debug-context.js';
import type { DebugLevel } from './types.js';

const context = DebugContext.getInstance();

/**
 * Debug decorator for methods
 */
export function debugMethod(
  operation: string,
  level: DebugLevel = 'basic',
  options: {
    profileEnabled?: boolean;
    captureArgs?: boolean;
    captureResult?: boolean;
    memoryTracking?: boolean;
  } = {}
) {
  return function(
    target: any, 
    _propertyKey: string | symbol, 
    descriptor: PropertyDescriptor
  ): PropertyDescriptor {
    const originalMethod = descriptor.value;
    
    descriptor.value = async function(this: any, ...args: unknown[]) {
      if (!debugManager.isEnabled()) {
        return originalMethod.apply(this, args);
      }

      const operationName = `${target.constructor.name}.${operation}`;
      const metadata: Record<string, unknown> = {};
      
      if (options.captureArgs) {
        metadata['args'] = args;
      }

      // Start profiling if enabled
      let profileId: string | null = null;
      if (options.profileEnabled && debugManager.getConfig().profile) {
        profileId = profiler.startProfile(operationName, metadata);
      }

      // Add trace entry
      debugManager.addEntry({
        type: 'trace',
        operation: operationName,
        level,
        data: metadata
      });

      try {
        const result = await originalMethod.apply(this, args);
        
        if (options.captureResult) {
          metadata['result'] = result;
        }

        // End profiling
        if (profileId) {
          profiler.endProfile(profileId, result);
        }

        return result;
      } catch (error) {
        // Log error
        debugManager.addEntry({
          type: 'error',
          operation: operationName,
          level: 'basic',
          data: metadata,
          error: {
            message: error instanceof Error ? error.message : String(error),
            ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
            ...(error instanceof Error && 'code' in error && error.code ? { code: String(error.code) } : {})
          }
        });

        // End profiling with error
        if (profileId) {
          profiler.endProfile(profileId, { error: error instanceof Error ? error.message : String(error) });
        }

        throw error;
      }
    };

    return descriptor;
  };
}

/**
 * Profile a function execution
 */
export async function withProfiling<T>(
  operation: string,
  fn: () => T | Promise<T>,
  metadata: Record<string, unknown> = {}
): Promise<T> {
  if (!debugManager.isEnabled() || !debugManager.getConfig().profile) {
    return fn();
  }

  return profiler.profile(operation, fn, metadata);
}

/**
 * Add debug context
 */
export async function withContext<T>(
  contextInfo: {
    namespace?: string;
    operationType?: string;
    vectorDimensions?: number;
    vectorCount?: number;
    tags?: Record<string, string>;
    metadata?: Record<string, unknown>;
  },
  fn: () => T | Promise<T>
): Promise<T> {
  if (!debugManager.isEnabled()) {
    return fn();
  }

  const contextId = `context-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  
  return context.withContext(contextId, contextInfo as unknown as Partial<import('./debug-context.js').ContextInfo>, fn);
}

/**
 * Trace function execution
 */
export async function trace<T>(
  operation: string,
  fn: () => T | Promise<T>,
  level: DebugLevel = 'basic',
  captureArgs: boolean = false,
  ...args: unknown[]
): Promise<T> {
  if (!debugManager.isEnabled()) {
    return fn();
  }

  const metadata: Record<string, unknown> = {};
  if (captureArgs) {
    metadata['args'] = args;
  }

  debugManager.addEntry({
    type: 'trace',
    operation,
    level,
    data: metadata
  });

  try {
    const result = await fn();
    
    debugManager.addEntry({
      type: 'trace',
      operation: `${operation}:completed`,
      level,
      data: { ...metadata, completed: true }
    });

    return result;
  } catch (error) {
    debugManager.addEntry({
      type: 'error',
      operation,
      level: 'basic',
      data: metadata,
      error: {
        message: error instanceof Error ? error.message : String(error),
        ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
        ...(error instanceof Error && 'code' in error && error.code ? { code: String(error.code) } : {})
      }
    });

    throw error;
  }
}

/**
 * Log performance metrics
 */
export function logMetrics(
  operation: string,
  metrics: Record<string, number>,
  level: DebugLevel = 'detailed'
): void {
  if (!debugManager.isEnabled()) return;

  debugManager.addEntry({
    type: 'info',
    operation,
    level,
    data: { metrics }
  });
}

/**
 * Log memory usage
 */
export function logMemoryUsage(
  operation: string,
  level: DebugLevel = 'detailed'
): void {
  if (!debugManager.isEnabled() || !debugManager.getConfig().memoryTracking) {
    return;
  }

  const memory = debugManager.getMemoryUsage();
  if (!memory) return;

  debugManager.addEntry({
    type: 'memory',
    operation,
    level,
    data: {},
    memoryUsage: memory
  });
}

/**
 * Debug timer utility
 */
export class DebugTimer {
  private startTime: number;
  private marks: Map<string, number> = new Map();

  constructor(private operation: string) {
    this.startTime = performance.now();
  }

  mark(name: string): void {
    this.marks.set(name, performance.now() - this.startTime);
  }

  end(level: DebugLevel = 'basic'): number {
    const duration = performance.now() - this.startTime;
    
    if (debugManager.isEnabled()) {
      debugManager.addEntry({
        type: 'profile',
        operation: this.operation,
        level,
        data: {
          marks: Object.fromEntries(this.marks)
        },
        duration
      });
    }

    return duration;
  }
}

/**
 * Create debug timer
 */
export function createTimer(operation: string): DebugTimer {
  return new DebugTimer(operation);
}

/**
 * Debug assertion
 */
export function debugAssert(
  condition: boolean,
  message: string,
  operation: string = 'assertion'
): void {
  if (!condition && debugManager.isEnabled()) {
    debugManager.addEntry({
      type: 'error',
      operation,
      level: 'basic',
      data: { assertion: message },
      error: {
        message: `Assertion failed: ${message}`,
        ...(new Error().stack && { stack: new Error().stack })
      }
    });
  }
}

/**
 * Batch debug entries
 */
export class DebugBatch {
  private entries: Array<Omit<Parameters<typeof debugManager.addEntry>[0], 'timestamp' | 'id'>> = [];

  add(entry: Omit<Parameters<typeof debugManager.addEntry>[0], 'timestamp' | 'id'>): void {
    this.entries.push(entry);
  }

  flush(): void {
    if (!debugManager.isEnabled()) {
      this.entries = [];
      return;
    }

    this.entries.forEach(entry => debugManager.addEntry(entry));
    this.entries = [];
  }

  clear(): void {
    this.entries = [];
  }
}

/**
 * Create debug batch
 */
export function createBatch(): DebugBatch {
  return new DebugBatch();
}