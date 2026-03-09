import { describe, expect, it } from 'bun:test';
import packageJson from '../package.json';
import {
  BatchOperationError,
  BrowserSupportError,
  DatabaseInitializationError,
  DimensionMismatchError,
  IndexError,
  InvalidFormatError,
  NamespaceExistsError,
  NamespaceNotFoundError,
  QuotaExceededError,
  SearchEngine,
  TransactionError,
  VectorDB,
  VectorDatabaseError,
  VectorFormatHandler,
  VectorFrankl,
  VectorNotFoundError,
  VectorOperations,
  VERSION,
  isVectorDatabaseError,
} from './index.js';

describe('Public API exports', () => {
  it('exports VectorFrankl class', () => {
    expect(VectorFrankl).toBeDefined();
    expect(typeof VectorFrankl).toBe('function');
  });

  it('exports VectorDB class', () => {
    expect(VectorDB).toBeDefined();
    expect(typeof VectorDB).toBe('function');
  });

  it('exports SearchEngine class', () => {
    expect(SearchEngine).toBeDefined();
    expect(typeof SearchEngine).toBe('function');
  });

  it('exports VectorOperations class', () => {
    expect(VectorOperations).toBeDefined();
    expect(typeof VectorOperations).toBe('function');
  });

  it('exports VectorFormatHandler class', () => {
    expect(VectorFormatHandler).toBeDefined();
    expect(typeof VectorFormatHandler).toBe('function');
  });

  it('exports VERSION matching package.json', () => {
    expect(VERSION).toBe(packageJson.version);
  });
});

describe('Error class exports', () => {
  it('exports VectorDatabaseError as abstract base', () => {
    expect(VectorDatabaseError).toBeDefined();
  });

  it('exports all concrete error classes', () => {
    expect(DimensionMismatchError).toBeDefined();
    expect(QuotaExceededError).toBeDefined();
    expect(VectorNotFoundError).toBeDefined();
    expect(InvalidFormatError).toBeDefined();
    expect(NamespaceExistsError).toBeDefined();
    expect(NamespaceNotFoundError).toBeDefined();
    expect(DatabaseInitializationError).toBeDefined();
    expect(TransactionError).toBeDefined();
    expect(BatchOperationError).toBeDefined();
    expect(IndexError).toBeDefined();
    expect(BrowserSupportError).toBeDefined();
  });

  it('exports isVectorDatabaseError type guard', () => {
    expect(typeof isVectorDatabaseError).toBe('function');

    const error = new DimensionMismatchError(3, 5);
    expect(isVectorDatabaseError(error)).toBe(true);
    expect(isVectorDatabaseError(new Error('generic'))).toBe(false);
  });
});
