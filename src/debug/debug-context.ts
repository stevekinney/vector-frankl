/**
 * Debug context management
 */

export interface ContextInfo {
  /** Current namespace */
  namespace?: string;
  /** Current operation type */
  operationType?: string;
  /** Vector dimensions */
  vectorDimensions?: number;
  /** Vector count */
  vectorCount?: number;
  /** Custom tags */
  tags: Map<string, string>;
  /** Custom metadata */
  metadata: Map<string, unknown>;
}

/**
 * Build a Map from either a Map or a plain-object Record (or undefined). Callers reach
 * `createContext`/`updateContext` through `withContext`, whose public signature accepts plain
 * `Record<string, V>` objects, while `ContextInfo` stores Maps — so both shapes arrive at runtime.
 * `new Map(record)` throws and `new Map(Object.entries(map))` silently yields an empty Map, so
 * neither single form is correct; this normalizes both.
 */
function toEntryMap<V>(
  value: Map<string, V> | Record<string, V> | undefined,
): Map<string, V> {
  if (!value) return new Map<string, V>();
  if (value instanceof Map) return new Map(value);
  return new Map(Object.entries(value));
}

export class DebugContext {
  private static instance: DebugContext;
  private contexts = new Map<string, ContextInfo>();
  private currentContextId: string | null = null;
  private contextStack: string[] = [];

  private constructor() {}

  static getInstance(): DebugContext {
    if (!DebugContext.instance) {
      DebugContext.instance = new DebugContext();
    }
    return DebugContext.instance;
  }

  /**
   * Create a new context
   */
  createContext(id: string, info: Partial<ContextInfo> = {}): string {
    const context: ContextInfo = {
      tags: toEntryMap(info.tags),
      metadata: toEntryMap(info.metadata),
      ...(info.namespace && { namespace: info.namespace }),
      ...(info.operationType && { operationType: info.operationType }),
      ...(info.vectorDimensions !== undefined && {
        vectorDimensions: info.vectorDimensions,
      }),
      ...(info.vectorCount !== undefined && { vectorCount: info.vectorCount }),
    };

    this.contexts.set(id, context);
    return id;
  }

  /**
   * Push a context onto the stack
   */
  pushContext(id: string): void {
    if (!this.contexts.has(id)) {
      throw new Error(`Context ${id} not found`);
    }

    if (this.currentContextId) {
      this.contextStack.push(this.currentContextId);
    }
    this.currentContextId = id;
  }

  /**
   * Pop a context from the stack
   */
  popContext(): string | null {
    const popped = this.currentContextId;
    this.currentContextId = this.contextStack.pop() || null;
    return popped;
  }

  /**
   * Get current context
   */
  getCurrentContext(): ContextInfo | null {
    if (!this.currentContextId) return null;
    return this.contexts.get(this.currentContextId) || null;
  }

  /**
   * Update current context
   */
  updateContext(updates: Partial<ContextInfo>): void {
    if (!this.currentContextId) return;

    const context = this.contexts.get(this.currentContextId);
    if (!context) return;

    if (updates.namespace !== undefined) context.namespace = updates.namespace;
    if (updates.operationType !== undefined)
      context.operationType = updates.operationType;
    if (updates.vectorDimensions !== undefined)
      context.vectorDimensions = updates.vectorDimensions;
    if (updates.vectorCount !== undefined) context.vectorCount = updates.vectorCount;

    if (updates.tags) {
      toEntryMap(updates.tags).forEach((value, key) => {
        context.tags.set(key, value);
      });
    }

    if (updates.metadata) {
      toEntryMap(updates.metadata).forEach((value, key) => {
        context.metadata.set(key, value);
      });
    }
  }

  /**
   * Add a tag to current context
   */
  addTag(key: string, value: string): void {
    const context = this.getCurrentContext();
    if (context) {
      context.tags.set(key, value);
    }
  }

  /**
   * Add metadata to current context
   */
  addMetadata(key: string, value: unknown): void {
    const context = this.getCurrentContext();
    if (context) {
      context.metadata.set(key, value);
    }
  }

  /**
   * Clear a context
   */
  clearContext(id: string): void {
    this.contexts.delete(id);
    if (this.currentContextId === id) {
      this.currentContextId = this.contextStack.pop() || null;
    }
    this.contextStack = this.contextStack.filter((cid) => cid !== id);
  }

  /**
   * Clear all contexts
   */
  clearAll(): void {
    this.contexts.clear();
    this.currentContextId = null;
    this.contextStack = [];
  }

  /**
   * Get context summary
   */
  getContextSummary(): Record<string, unknown> {
    const context = this.getCurrentContext();
    if (!context) return {};

    return {
      namespace: context.namespace,
      operationType: context.operationType,
      vectorDimensions: context.vectorDimensions,
      vectorCount: context.vectorCount,
      tags: Object.fromEntries(context.tags),
      metadata: Object.fromEntries(context.metadata),
    };
  }

  /**
   * Execute function with context
   */
  async withContext<T>(
    id: string,
    info: Partial<ContextInfo>,
    fn: () => T | Promise<T>,
  ): Promise<T> {
    this.createContext(id, info);
    this.pushContext(id);

    try {
      return await fn();
    } finally {
      this.popContext();
      this.clearContext(id);
    }
  }
}
