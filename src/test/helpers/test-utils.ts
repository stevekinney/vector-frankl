import { expect } from 'bun:test';

export function expectToThrow(
  fn: () => unknown,
  errorType?: unknown,
  message?: string,
): void {
  let thrown = false;
  let error: unknown;

  try {
    fn();
  } catch (e) {
    thrown = true;
    error = e;
  }

  expect(thrown).toBe(true);

  if (errorType) {
    expect(error).toBeInstanceOf(errorType);
  }

  if (message && error instanceof Error) {
    expect(error.message).toContain(message);
  }
}

export async function expectToThrowAsync(
  fn: () => Promise<unknown>,
  errorType?: unknown,
  message?: string,
): Promise<void> {
  let thrown = false;
  let error: unknown;

  try {
    await fn();
  } catch (e) {
    thrown = true;
    error = e;
  }

  expect(thrown).toBe(true);

  if (errorType) {
    expect(error).toBeInstanceOf(errorType);
  }

  if (message && error instanceof Error) {
    expect(error.message).toContain(message);
  }
}

export function createMockFunction<T extends (...args: unknown[]) => unknown>(): T & {
  mock: { calls: unknown[][] };
} {
  const calls: unknown[][] = [];
  const fn = ((...args: unknown[]) => {
    calls.push(args);
    return undefined;
  }) as T & { mock: { calls: unknown[][] } };

  fn.mock = { calls };
  return fn;
}

export function waitFor(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function measureTime<T>(fn: () => T): [T, number] {
  const start = performance.now();
  const result = fn();
  const end = performance.now();
  return [result, end - start];
}

export async function measureTimeAsync<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const start = performance.now();
  const result = await fn();
  const end = performance.now();
  return [result, end - start];
}
