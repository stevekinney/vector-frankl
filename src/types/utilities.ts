export type AsyncFunction<T = unknown> = (...args: unknown[]) => Promise<T>;
export type SyncFunction<T = unknown> = (...args: unknown[]) => T;
export type AnyFunction = AsyncFunction | SyncFunction;

export interface Success<T> {
  success: true;
  data: T;
  error?: never;
}

export interface Failure<E = Error> {
  success: false;
  data?: never;
  error: E;
}

export type Result<T, E = Error> = Success<T> | Failure<E>;

export function ok<T>(data: T): Success<T> {
  return { success: true, data };
}

export function uhoh<E = Error>(error: E): Failure<E> {
  return { success: false, error };
}

export function isOk<T, E>(result: Result<T, E>): result is Success<T> {
  return result.success === true;
}

export function isError<T, E>(result: Result<T, E>): result is Failure<E> {
  return result.success === false;
}

export type Constructor<T = object> = new (...args: unknown[]) => T;

export type Awaitable<T> = T | Promise<T>;

export type Arrayable<T> = T | T[];

export type Promisable<T> = T | PromiseLike<T>;
