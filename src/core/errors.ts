/**
 * Base error class for all vector database errors
 */
export abstract class VectorDatabaseError extends Error {
  public readonly code: string;
  public readonly timestamp: Date;
  public readonly context?: Record<string, unknown> | undefined;

  constructor(message: string, code: string, context?: Record<string, unknown>) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.timestamp = new Date();
    this.context = context;

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
      context: this.sanitizeContext(this.context),
      // Stack trace removed for security - only include in development
      ...(process.env.NODE_ENV === 'development' && { stack: this.stack }),
    };
  }

  /**
   * Sanitize context to remove sensitive information
   */
  private sanitizeContext(
    context?: Record<string, unknown>,
  ): Record<string, unknown> | undefined {
    if (!context) return undefined;

    const sanitized: Record<string, unknown> = {};
    const sensitiveKeys = new Set([
      'password',
      'token',
      'secret',
      'key',
      'auth',
      'credential',
      'privateKey',
      'accessToken',
      'refreshToken',
      'sessionId',
      'cookie',
      'authorization',
      'x-api-key',
      'apiKey',
      'originalError', // Remove nested error details that might contain sensitive info
    ]);

    for (const [key, value] of Object.entries(context)) {
      const lowerKey = key.toLowerCase();

      // Skip sensitive keys
      if (
        sensitiveKeys.has(lowerKey) ||
        lowerKey.includes('password') ||
        lowerKey.includes('secret')
      ) {
        sanitized[key] = '[REDACTED]';
        continue;
      }

      // Handle nested objects recursively
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        sanitized[key] = this.sanitizeContext(value as Record<string, unknown>);
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
