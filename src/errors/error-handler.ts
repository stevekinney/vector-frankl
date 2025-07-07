import { isProduction } from '../configuration/environment';
import { log } from '../utilities/logger';
import { BaseError } from './custom-errors';

export function isOperationalError(error: Error): boolean {
  if (error instanceof BaseError) {
    return error.isOperational;
  }
  return false;
}

export function handleError(error: Error): void {
  if (isOperationalError(error)) {
    log.error('Operational error occurred', { error });
  } else {
    log.error('Unexpected error occurred', { error });

    if (!isProduction()) {
      console.error('Stack trace:', error.stack);
    }
  }
}

export async function withErrorHandling<T>(
  operation: () => Promise<T>,
  context?: string,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const errorMessage = context
      ? `Error in ${context}: ${error instanceof Error ? error.message : String(error)}`
      : error instanceof Error
        ? error.message
        : String(error);

    if (error instanceof BaseError) {
      throw error;
    }

    throw new BaseError(errorMessage, 'OPERATION_FAILED', 500, false);
  }
}

export function createErrorResponse(error: Error): {
  error: {
    code: string;
    message: string;
    statusCode: number;
    timestamp: string;
    fields?: Record<string, string[]>;
  };
} {
  if (error instanceof BaseError) {
    return {
      error: {
        code: error.code,
        message: error.message,
        statusCode: error.statusCode,
        timestamp: error.timestamp.toISOString(),
        ...('fields' in error && error.fields
          ? { fields: error.fields as Record<string, string[]> }
          : {}),
      },
    };
  }

  return {
    error: {
      code: 'INTERNAL_ERROR',
      message: isProduction() ? 'An error occurred' : error.message,
      statusCode: 500,
      timestamp: new Date().toISOString(),
    },
  };
}
