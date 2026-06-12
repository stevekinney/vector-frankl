import { describe, expect, test } from 'bun:test';

import { resolveEnvironmentVariables } from './environment.js';

describe('resolveEnvironmentVariables', () => {
  test('prefers import.meta.env values when available', () => {
    const resolvedEnvironment = resolveEnvironmentVariables({
      importMetaEnvironment: {
        NODE_ENV: 'production',
        VECTOR_FRANKL_SOURCE: 'import-meta',
      },
      processEnvironment: {
        NODE_ENV: 'development',
        VECTOR_FRANKL_SOURCE: 'process',
      },
    });

    expect(resolvedEnvironment['NODE_ENV']).toBe('production');
    expect(resolvedEnvironment['VECTOR_FRANKL_SOURCE']).toBe('import-meta');
  });

  test('falls back to process.env values when import.meta.env is unavailable', () => {
    const resolvedEnvironment = resolveEnvironmentVariables({
      processEnvironment: {
        NODE_ENV: 'test',
        VECTOR_FRANKL_SOURCE: 'process',
      },
    });

    expect(resolvedEnvironment['NODE_ENV']).toBe('test');
    expect(resolvedEnvironment['VECTOR_FRANKL_SOURCE']).toBe('process');
  });

  test('returns an empty environment for browser-like runtimes with no source', () => {
    expect(resolveEnvironmentVariables()).toEqual({});
  });
});
