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
      tags: new Map(Object.entries(info.tags || {})),
      metadata: new Map(Object.entries(info.metadata || {})),
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
      Object.entries(updates.tags).forEach(([key, value]) => {
        context.tags.set(key, value);
      });
    }

    if (updates.metadata) {
      Object.entries(updates.metadata).forEach(([key, value]) => {
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
