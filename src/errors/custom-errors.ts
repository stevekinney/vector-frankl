import { ERROR_CODES } from '../configuration/constants';

export class BaseError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly timestamp: Date;

  constructor(message: string, code: string, statusCode: number, isOperational = true) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.timestamp = new Date();

    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends BaseError {
  constructor(
    message: string,
    public readonly fields?: Record<string, string[]>,
  ) {
    super(message, ERROR_CODES.VALIDATION_ERROR, 400);
  }
}

export class NotFoundError extends BaseError {
  constructor(resource: string, identifier?: string) {
    const message = identifier
      ? `${resource} with identifier "${identifier}" not found`
      : `${resource} not found`;
    super(message, ERROR_CODES.NOT_FOUND, 404);
  }
}

export class UnauthorizedError extends BaseError {
  constructor(message = 'Unauthorized access') {
    super(message, ERROR_CODES.UNAUTHORIZED, 401);
  }
}

export class ForbiddenError extends BaseError {
  constructor(message = 'Access forbidden') {
    super(message, ERROR_CODES.FORBIDDEN, 403);
  }
}

export class TimeoutError extends BaseError {
  constructor(operation: string, timeout: number) {
    super(
      `Operation "${operation}" timed out after ${timeout}ms`,
      ERROR_CODES.TIMEOUT,
      408,
    );
  }
}

export class RateLimitError extends BaseError {
  constructor(public readonly retryAfter?: number) {
    const message = retryAfter
      ? `Rate limit exceeded. Retry after ${retryAfter} seconds`
      : 'Rate limit exceeded';
    super(message, ERROR_CODES.RATE_LIMIT, 429);
  }
}

export class InternalError extends BaseError {
  public override readonly cause?: Error;

  constructor(message = 'An internal error occurred', cause?: Error) {
    super(message, ERROR_CODES.INTERNAL_ERROR, 500, false);
    if (cause) {
      this.cause = cause;
    }
  }
}
