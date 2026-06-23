/**
 * Stable error codes for all public failure modes.
 *
 * These codes are part of the public API surface and must not be renamed
 * without a major version bump. Add new codes freely; never reuse a retired
 * code for a different meaning.
 */
export const ErrorCode = {
  // ── Vector errors ────────────────────────────────────────────────────────
  DIMENSION_MISMATCH: 'DIMENSION_MISMATCH',
  VECTOR_NOT_FOUND: 'VECTOR_NOT_FOUND',
  INVALID_FORMAT: 'INVALID_FORMAT',
  // ── Storage / quota errors ───────────────────────────────────────────────
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  DATABASE_INIT_FAILED: 'DATABASE_INIT_FAILED',
  TRANSACTION_FAILED: 'TRANSACTION_FAILED',
  // ── Namespace errors ─────────────────────────────────────────────────────
  NAMESPACE_EXISTS: 'NAMESPACE_EXISTS',
  NAMESPACE_NOT_FOUND: 'NAMESPACE_NOT_FOUND',
  // ── Batch / index errors ─────────────────────────────────────────────────
  BATCH_OPERATION_FAILED: 'BATCH_OPERATION_FAILED',
  INDEX_ERROR: 'INDEX_ERROR',
  // ── Environment errors ───────────────────────────────────────────────────
  BROWSER_NOT_SUPPORTED: 'BROWSER_NOT_SUPPORTED',
  // ── Catch-all ────────────────────────────────────────────────────────────
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
} as const;

/** Union type of all stable error codes. */
export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

/**
 * Recovery guidance for common production failures.
 *
 * Consumers can use `error.recovery` to surface actionable next steps
 * without parsing the error message string.
 */
const RECOVERY_GUIDANCE: Partial<Record<ErrorCodeValue, string>> = {
  DIMENSION_MISMATCH:
    'Ensure all vectors added to this store have the same dimension as the one ' +
    'specified during initialization. Re-embed your data if the model changed.',
  VECTOR_NOT_FOUND:
    'Verify the vector ID exists before fetching. Use `listVectors()` to enumerate ' +
    'stored IDs, or catch this error and handle the missing-vector case explicitly.',
  INVALID_FORMAT:
    'Pass a Float32Array, Float64Array, Int8Array, Uint8Array, or plain number[] as ' +
    'the vector value.',
  QUOTA_EXCEEDED:
    'Free storage space by deleting unused vectors or namespaces, increase the quota ' +
    'if your environment allows it, or enable an eviction policy (LRU / LFU / TTL) ' +
    'to automatically remove stale entries.',
  DATABASE_INIT_FAILED:
    'Check that IndexedDB is available and not blocked by a private-browsing ' +
    'restriction. Verify the database name contains only safe characters and retry ' +
    'initialization after a short delay.',
  TRANSACTION_FAILED:
    'The IndexedDB transaction was aborted. This is usually transient — retry the ' +
    'operation. If the error persists, check available disk space and browser ' +
    'storage permissions.',
  NAMESPACE_EXISTS:
    'Use `getNamespace()` to retrieve the existing namespace, or choose a different ' +
    'name. Call `deleteNamespace()` first if you need to recreate it.',
  NAMESPACE_NOT_FOUND:
    'Call `createNamespace()` before operating on a namespace, or list available ' +
    'namespaces with `listNamespaces()` to verify the name.',
  BATCH_OPERATION_FAILED:
    'Inspect `error.errors` for per-item failure details. Items that succeeded were ' +
    'committed; only the failed items need to be retried.',
  INDEX_ERROR:
    'The HNSW index encountered an internal inconsistency. Try rebuilding the index ' +
    'with `rebuildIndex()`. If the error recurs, file a bug with the operation name ' +
    'and index type from `error.context`.',
  BROWSER_NOT_SUPPORTED:
    'This feature requires a modern browser. Check the MDN compatibility table for ' +
    'the feature named in `error.feature` and upgrade or use a polyfill.',
};

/**
 * Keys that are always redacted regardless of context position.
 *
 * Policy: sensitive authentication material and raw vector data are never
 * included in serialized error output. Safe operational values (vector IDs,
 * namespace names, dimension counts) are intentionally preserved to aid
 * debugging without leaking secrets.
 */
const REDACTED_KEYS: ReadonlySet<string> = new Set([
  // Authentication & credentials
  'password',
  'token',
  'secret',
  'key',
  'auth',
  'credential',
  'privatekey',
  'accesstoken',
  'refreshtoken',
  'sessionid',
  'cookie',
  'authorization',
  'x-api-key',
  'apikey',
  // Storage connection strings and paths
  'url',
  'connectionstring',
  'connectionurl',
  'redisurl',
  'databaseurl',
  'dburl',
  's3key',
  's3url',
  'endpoint',
  'filepath',
  'filename',
  'path',
  'dbname',
  'databasename',
  // Raw vector data and metadata values that could reconstruct embeddings
  'vector',
  'vectordata',
  'embedding',
  'metadata',
  'metadatavalue',
  'metadatavalues',
  // Regex patterns that could expose filter logic
  'pattern',
  'regex',
  'regexpattern',
  // Nested error details that may carry their own sensitive context
  'originalerror',
]);

/**
 * Base error class for all vector database errors.
 *
 * Subclasses carry a stable `code` (see {@link ErrorCode}) and optional
 * `recovery` guidance. The `toJSON()` serialization automatically sanitizes
 * context values according to the redaction policy documented on
 * {@link REDACTED_KEYS}.
 */
export abstract class VectorDatabaseError extends Error {
  public readonly code: string;
  public readonly timestamp: Date;
  public readonly context?: Record<string, unknown> | undefined;
  /** Actionable recovery guidance for this error code, if available. */
  public readonly recovery?: string | undefined;

  constructor(message: string, code: string, context?: Record<string, unknown>) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.timestamp = new Date();
    this.context = context;
    this.recovery = RECOVERY_GUIDANCE[code as ErrorCodeValue];

    // Maintains proper stack trace for where our error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      timestamp: this.timestamp,
      context: sanitizeContext(this.context),
      ...(this.recovery !== undefined && { recovery: this.recovery }),
      // Stack trace removed for security - only include in development
      ...(typeof process !== 'undefined' &&
        process.env?.NODE_ENV === 'development' && { stack: this.stack }),
    };
  }
}

/**
 * Sanitize an error context object, redacting values whose keys match the
 * documented policy ({@link REDACTED_KEYS}).
 *
 * Rules:
 * - Keys in {@link REDACTED_KEYS} (case-insensitive, stripped of separators) → `'[REDACTED]'`
 * - Keys whose lower-case form contains `'password'`, `'secret'`, `'token'`,
 *   `'key'`, or `'url'` → `'[REDACTED]'`
 * - Strings longer than 1000 characters → truncated to 100 chars + `'... [TRUNCATED]'`
 * - Nested plain objects → recursed
 * - Everything else → passed through unchanged
 *
 * This function is exported so that other modules (adapters, workers) can
 * apply the same policy when constructing their own error contexts.
 */
export function sanitizeContext(
  context?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!context) return undefined;

  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(context)) {
    if (isSensitiveKey(key)) {
      sanitized[key] = '[REDACTED]';
      continue;
    }

    // Handle nested objects recursively
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      sanitized[key] = sanitizeContext(value as Record<string, unknown>);
    } else if (typeof value === 'string') {
      // Truncate very long strings that might contain sensitive data
      sanitized[key] =
        value.length > 1000 ? `${value.substring(0, 100)}... [TRUNCATED]` : value;
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Returns `true` when the context key should be redacted.
 *
 * The normalised key (lower-case, hyphens/underscores stripped) is checked
 * against the exact-match set first, then against substring patterns.
 */
function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  // Normalised form strips separators so 'access_key_id' → 'accesskeyid'
  const normalised = lower.replace(/[-_]/g, '');

  if (REDACTED_KEYS.has(lower) || REDACTED_KEYS.has(normalised)) return true;

  // Substring patterns that indicate credentials or connection info
  return (
    lower.includes('password') ||
    lower.includes('secret') ||
    lower.includes('token') ||
    lower.includes('credential') ||
    lower.includes('apikey') ||
    normalised.includes('apikey') ||
    lower.includes('accesskey') ||
    normalised.includes('accesskey')
  );
}

/**
 * Thrown when vector dimensions don't match expected dimensions
 */
export class DimensionMismatchError extends VectorDatabaseError {
  public readonly expected: number;
  public readonly actual: number;

  constructor(expected: number, actual: number, vectorId?: string) {
    super(
      `Vector dimension mismatch: expected ${expected}, got ${actual}`,
      'DIMENSION_MISMATCH',
      { vectorId },
    );
    this.expected = expected;
    this.actual = actual;
  }
}

/**
 * Thrown when storage quota is exceeded
 */
export class QuotaExceededError extends VectorDatabaseError {
  public readonly usage: number;
  public readonly quota: number;
  public readonly percentage: number;

  constructor(usage: number, quota: number) {
    const percentage = Math.round((usage / quota) * 100);
    super(
      `Storage quota exceeded: ${usage}/${quota} bytes (${percentage}%)`,
      'QUOTA_EXCEEDED',
      { usage, quota, percentage },
    );
    this.usage = usage;
    this.quota = quota;
    this.percentage = percentage;
  }
}

/**
 * Thrown when a requested vector is not found
 */
export class VectorNotFoundError extends VectorDatabaseError {
  public readonly vectorId: string;

  constructor(vectorId: string, namespace?: string) {
    super(
      `Vector with ID '${vectorId}' not found${namespace ? ` in namespace '${namespace}'` : ''}`,
      'VECTOR_NOT_FOUND',
      { vectorId, namespace },
    );
    this.vectorId = vectorId;
  }
}

/**
 * Thrown when an invalid vector format is provided
 */
export class InvalidFormatError extends VectorDatabaseError {
  public readonly format: string;
  public readonly supportedFormats: string[];

  constructor(format: string, supportedFormats: string[]) {
    super(
      `Invalid vector format '${format}'. Supported formats: ${supportedFormats.join(', ')}`,
      'INVALID_FORMAT',
      { format, supportedFormats },
    );
    this.format = format;
    this.supportedFormats = supportedFormats;
  }
}

/**
 * Thrown when a namespace already exists
 */
export class NamespaceExistsError extends VectorDatabaseError {
  public readonly namespace: string;

  constructor(namespace: string) {
    super(`Namespace '${namespace}' already exists`, 'NAMESPACE_EXISTS', { namespace });
    this.namespace = namespace;
  }
}

/**
 * Thrown when a namespace is not found
 */
export class NamespaceNotFoundError extends VectorDatabaseError {
  public readonly namespace: string;

  constructor(namespace: string) {
    super(`Namespace '${namespace}' not found`, 'NAMESPACE_NOT_FOUND', { namespace });
    this.namespace = namespace;
  }
}

/**
 * Thrown when database initialization fails
 */
export class DatabaseInitializationError extends VectorDatabaseError {
  public readonly originalError?: Error | undefined;

  constructor(message: string, originalError?: Error) {
    super(`Database initialization failed: ${message}`, 'DATABASE_INIT_FAILED', {
      originalError: originalError?.message,
    });
    this.originalError = originalError;
  }
}

/**
 * Thrown when a database transaction fails
 */
export class TransactionError extends VectorDatabaseError {
  public readonly operation: string;
  public readonly originalError?: Error | undefined;

  constructor(operation: string, message: string, originalError?: Error) {
    super(`Transaction failed during ${operation}: ${message}`, 'TRANSACTION_FAILED', {
      operation,
      originalError: originalError?.message,
    });
    this.operation = operation;
    this.originalError = originalError;
  }
}

/**
 * Thrown when batch operations partially fail
 */
export class BatchOperationError extends VectorDatabaseError {
  public readonly succeeded: number;
  public readonly failed: number;
  public readonly errors: Array<{ id: string; error: Error }>;

  constructor(
    succeeded: number,
    failed: number,
    errors: Array<{ id: string; error: Error }>,
  ) {
    super(
      `Batch operation partially failed: ${succeeded} succeeded, ${failed} failed`,
      'BATCH_OPERATION_FAILED',
      { succeeded, failed, errorCount: errors.length },
    );
    this.succeeded = succeeded;
    this.failed = failed;
    this.errors = errors;
  }
}

/**
 * Thrown when index operations fail
 */
export class IndexError extends VectorDatabaseError {
  public readonly indexType: string;
  public readonly operation: string;

  constructor(indexType: string, operation: string, message: string) {
    super(
      `Index operation '${operation}' failed for ${indexType}: ${message}`,
      'INDEX_ERROR',
      { indexType, operation },
    );
    this.indexType = indexType;
    this.operation = operation;
  }
}

/**
 * Thrown when IndexedDB namespace deletion is blocked by an open connection
 */
export class NamespaceDeletionBlockedError extends VectorDatabaseError {
  public readonly namespace: string;

  constructor(namespace: string) {
    super(
      `Deletion of namespace '${namespace}' was blocked by an open connection`,
      'NAMESPACE_DELETION_BLOCKED',
      { namespace },
    );
    this.namespace = namespace;
  }
}

/**
 * Thrown when browser features are not supported
 */
export class BrowserSupportError extends VectorDatabaseError {
  public readonly feature: string;
  public readonly browser?: string | undefined;

  constructor(feature: string, browser?: string) {
    super(
      `Browser feature '${feature}' is not supported${browser ? ` in ${browser}` : ''}`,
      'BROWSER_NOT_SUPPORTED',
      { feature, browser },
    );
    this.feature = feature;
    this.browser = browser;
  }
}

/**
 * Thrown when a search operation is aborted via an AbortSignal
 */
export class SearchAbortedError extends VectorDatabaseError {
  constructor(context?: Record<string, unknown>) {
    super('Search was aborted', 'SEARCH_ABORTED', context);
  }
}

/**
 * Thrown when a search operation exceeds its configured timeout
 */
export class SearchTimeoutError extends VectorDatabaseError {
  public readonly timeoutMs: number;

  constructor(timeoutMs: number, context?: Record<string, unknown>) {
    super(`Search timed out after ${timeoutMs}ms`, 'SEARCH_TIMEOUT', {
      timeoutMs,
      ...context,
    });
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Type guard to check if an error is a VectorDatabaseError
 */
export function isVectorDatabaseError(error: unknown): error is VectorDatabaseError {
  return error instanceof VectorDatabaseError;
}

/**
 * Helper to create error from unknown type
 */
export function toVectorDatabaseError(
  error: unknown,
  code = 'UNKNOWN_ERROR',
): VectorDatabaseError {
  if (isVectorDatabaseError(error)) {
    return error;
  }

  if (error instanceof Error) {
    return new (class extends VectorDatabaseError {
      constructor() {
        super((error as Error).message, code, { originalError: (error as Error).name });
      }
    })();
  }

  return new (class extends VectorDatabaseError {
    constructor() {
      super(String(error), code);
    }
  })();
}
