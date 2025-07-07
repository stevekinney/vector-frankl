import { sleep } from 'bun';

import { log } from './logger';

export interface RetryOptions {
  maxAttempts?: number;
  delay?: number;
  backoff?: 'fixed' | 'exponential' | 'linear';
  maxDelay?: number;
  onRetry?: (error: Error, attempt: number) => void;
  shouldRetry?: (error: Error) => boolean;
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'onRetry' | 'shouldRetry'>> = {
  maxAttempts: 3,
  delay: 1000,
  backoff: 'exponential',
  maxDelay: 30000,
};

export async function retry<T>(
  operation: () => Promise<T>,
  options?: RetryOptions,
): Promise<T> {
  const config = { ...DEFAULT_OPTIONS, ...options };
  let lastError: Error;

  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt === config.maxAttempts) {
        break;
      }

      if (options?.shouldRetry && !options.shouldRetry(lastError)) {
        throw lastError;
      }

      const delay = calculateDelay(attempt, config);

      log.debug(`Retry attempt ${attempt}/${config.maxAttempts} after ${delay}ms`, {
        error: lastError.message,
      });

      options?.onRetry?.(lastError, attempt);

      await sleep(delay);
    }
  }

  throw lastError!;
}

function calculateDelay(
  attempt: number,
  config: Required<Omit<RetryOptions, 'onRetry' | 'shouldRetry'>>,
): number {
  let delay: number;

  switch (config.backoff) {
    case 'exponential':
      delay = config.delay * Math.pow(2, attempt - 1);
      break;
    case 'linear':
      delay = config.delay * attempt;
      break;
    case 'fixed':
    default:
      delay = config.delay;
  }

  return Math.min(delay, config.maxDelay);
}
