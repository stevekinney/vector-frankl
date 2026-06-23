import { describe, expect, test } from 'bun:test';

import {
  ErrorCode,
  BatchOperationError,
  BrowserSupportError,
  DatabaseInitializationError,
  DimensionMismatchError,
  IndexError,
  InvalidFormatError,
  NamespaceExistsError,
  NamespaceNotFoundError,
  QuotaExceededError,
  TransactionError,
  VectorNotFoundError,
  isVectorDatabaseError,
  sanitizeContext,
} from '@/core/errors.js';

// ---------------------------------------------------------------------------
// sanitizeContext — redaction policy
// ---------------------------------------------------------------------------

describe('sanitizeContext — redaction policy', () => {
  test('returns undefined for undefined input', () => {
    expect(sanitizeContext(undefined)).toBeUndefined();
  });

  test('passes through safe operational values unchanged', () => {
    const result = sanitizeContext({
      vectorId: 'vec-123',
      namespace: 'products',
      dimension: 384,
      operation: 'search',
    });

    expect(result?.['vectorId']).toBe('vec-123');
    expect(result?.['namespace']).toBe('products');
    expect(result?.['dimension']).toBe(384);
    expect(result?.['operation']).toBe('search');
  });

  describe('redacts credentials and auth material', () => {
    test('redacts password keys', () => {
      const result = sanitizeContext({ password: 's3cr3t', dbPassword: 'also-secret' });
      expect(result?.['password']).toBe('[REDACTED]');
      expect(result?.['dbPassword']).toBe('[REDACTED]');
    });

    test('redacts token keys', () => {
      const result = sanitizeContext({
        token: 'tok_abc123',
        accessToken: 'at_xyz',
        refreshToken: 'rt_xyz',
      });
      expect(result?.['token']).toBe('[REDACTED]');
      expect(result?.['accessToken']).toBe('[REDACTED]');
      expect(result?.['refreshToken']).toBe('[REDACTED]');
    });

    test('redacts secret keys', () => {
      const result = sanitizeContext({
        secret: 'my-secret',
        secretKey: 'sk-abc',
        awsSecretAccessKey: 'aws-secret',
      });
      expect(result?.['secret']).toBe('[REDACTED]');
      expect(result?.['secretKey']).toBe('[REDACTED]');
      expect(result?.['awsSecretAccessKey']).toBe('[REDACTED]');
    });

    test('redacts apiKey variants', () => {
      const result = sanitizeContext({
        apiKey: 'key_abc',
        'x-api-key': 'header-key',
      });
      expect(result?.['apiKey']).toBe('[REDACTED]');
      expect(result?.['x-api-key']).toBe('[REDACTED]');
    });

    test('redacts authorization and credential keys', () => {
      const result = sanitizeContext({
        authorization: 'Bearer abc',
        credential: 'cred-value',
        cookie: 'session=abc',
      });
      expect(result?.['authorization']).toBe('[REDACTED]');
      expect(result?.['credential']).toBe('[REDACTED]');
      expect(result?.['cookie']).toBe('[REDACTED]');
    });
  });

  describe('redacts storage connection strings and URLs', () => {
    test('redacts url keys', () => {
      const result = sanitizeContext({ url: 'redis://user:pass@localhost:6379' });
      expect(result?.['url']).toBe('[REDACTED]');
    });

    test('redacts redisUrl keys', () => {
      const result = sanitizeContext({ redisUrl: 'redis://user:pass@host:6379/0' });
      expect(result?.['redisUrl']).toBe('[REDACTED]');
    });

    test('redacts databaseUrl keys', () => {
      const result = sanitizeContext({
        databaseUrl: 'postgres://user:pass@host/db',
        dbUrl: 'sqlite:///data/vectors.db',
      });
      expect(result?.['databaseUrl']).toBe('[REDACTED]');
      expect(result?.['dbUrl']).toBe('[REDACTED]');
    });

    test('redacts s3Key and endpoint keys', () => {
      const result = sanitizeContext({
        s3Key: 'vectors/index.json',
        endpoint: 'https://s3.custom-region.amazonaws.com',
      });
      expect(result?.['s3Key']).toBe('[REDACTED]');
      expect(result?.['endpoint']).toBe('[REDACTED]');
    });

    test('redacts file path keys', () => {
      const result = sanitizeContext({
        filePath: '/home/user/.vector-frankl/db',
        path: '/etc/secrets/keyfile',
        filename: 'secret-index.bin',
      });
      expect(result?.['filePath']).toBe('[REDACTED]');
      expect(result?.['path']).toBe('[REDACTED]');
      expect(result?.['filename']).toBe('[REDACTED]');
    });

    test('redacts database name keys', () => {
      const result = sanitizeContext({
        dbName: 'production-vectors',
        databaseName: 'my-secret-db',
      });
      expect(result?.['dbName']).toBe('[REDACTED]');
      expect(result?.['databaseName']).toBe('[REDACTED]');
    });
  });

  describe('redacts vector data and metadata values', () => {
    test('redacts vector data keys', () => {
      const result = sanitizeContext({
        vector: [0.1, 0.2, 0.3],
        vectorData: new Float32Array([1, 2, 3]),
        embedding: [0.5, 0.6],
      });
      expect(result?.['vector']).toBe('[REDACTED]');
      expect(result?.['vectorData']).toBe('[REDACTED]');
      expect(result?.['embedding']).toBe('[REDACTED]');
    });

    test('redacts metadata keys', () => {
      const result = sanitizeContext({
        metadata: { category: 'confidential', userId: '42' },
        metadataValue: 'sensitive-tag',
      });
      expect(result?.['metadata']).toBe('[REDACTED]');
      expect(result?.['metadataValue']).toBe('[REDACTED]');
    });
  });

  describe('redacts regex patterns', () => {
    test('redacts pattern and regex keys', () => {
      const result = sanitizeContext({
        pattern: '^secret-prefix-.*',
        regex: '/user-data/gi',
        regexPattern: '(?i)password',
      });
      expect(result?.['pattern']).toBe('[REDACTED]');
      expect(result?.['regex']).toBe('[REDACTED]');
      expect(result?.['regexPattern']).toBe('[REDACTED]');
    });
  });

  describe('redacts originalError chain', () => {
    test('redacts originalError to prevent nested error leakage', () => {
      const result = sanitizeContext({
        originalError: 'connection refused to redis://...',
      });
      expect(result?.['originalError']).toBe('[REDACTED]');
    });
  });

  describe('handles case-insensitive and separator-normalised keys', () => {
    test('redacts PASSWORD (upper-case)', () => {
      const result = sanitizeContext({ PASSWORD: 'secret' });
      expect(result?.['PASSWORD']).toBe('[REDACTED]');
    });

    test('redacts access_key_id (underscore-separated)', () => {
      const result = sanitizeContext({ access_key_id: 'AKID...' });
      expect(result?.['access_key_id']).toBe('[REDACTED]');
    });

    test('redacts ACCESS-KEY-ID (hyphen-separated)', () => {
      const result = sanitizeContext({ 'ACCESS-KEY-ID': 'AKID...' });
      expect(result?.['ACCESS-KEY-ID']).toBe('[REDACTED]');
    });
  });

  describe('handles nested objects', () => {
    test('sanitizes sensitive keys inside nested plain objects', () => {
      const result = sanitizeContext({
        storage: {
          url: 'redis://host:6379',
          prefix: 'vf:',
          connectionOptions: {
            host: 'localhost',
            dbPassword: 's3cret',
          },
        },
        vectorId: 'safe-id',
      });

      const storage = result?.['storage'] as Record<string, unknown>;
      expect(storage?.['url']).toBe('[REDACTED]');
      expect(storage?.['prefix']).toBe('vf:');
      const connectionOptions = storage?.['connectionOptions'] as Record<string, unknown>;
      expect(connectionOptions?.['host']).toBe('localhost');
      expect(connectionOptions?.['dbPassword']).toBe('[REDACTED]');
      expect(result?.['vectorId']).toBe('safe-id');
    });

    test('redacts entire nested object when the key itself is sensitive', () => {
      const result = sanitizeContext({
        credentials: { user: 'admin', password: 'secret' },
        vectorId: 'safe-id',
      });

      // 'credentials' key is itself sensitive — the whole value is redacted
      expect(result?.['credentials']).toBe('[REDACTED]');
      expect(result?.['vectorId']).toBe('safe-id');
    });
  });

  describe('truncates very long strings', () => {
    test('truncates strings longer than 1000 characters', () => {
      const longString = 'x'.repeat(1001);
      const result = sanitizeContext({ safeKey: longString });
      expect(result?.['safeKey']).toBe('x'.repeat(100) + '... [TRUNCATED]');
    });

    test('passes through strings of exactly 1000 characters', () => {
      const exactString = 'a'.repeat(1000);
      const result = sanitizeContext({ safeKey: exactString });
      expect(result?.['safeKey']).toBe(exactString);
    });
  });
});

// ---------------------------------------------------------------------------
// Error codes — stable public identifiers
// ---------------------------------------------------------------------------

describe('ErrorCode — stable error codes', () => {
  test('ErrorCode object defines all expected error code strings', () => {
    expect(ErrorCode.DIMENSION_MISMATCH).toBe('DIMENSION_MISMATCH');
    expect(ErrorCode.VECTOR_NOT_FOUND).toBe('VECTOR_NOT_FOUND');
    expect(ErrorCode.INVALID_FORMAT).toBe('INVALID_FORMAT');
    expect(ErrorCode.QUOTA_EXCEEDED).toBe('QUOTA_EXCEEDED');
    expect(ErrorCode.DATABASE_INIT_FAILED).toBe('DATABASE_INIT_FAILED');
    expect(ErrorCode.TRANSACTION_FAILED).toBe('TRANSACTION_FAILED');
    expect(ErrorCode.NAMESPACE_EXISTS).toBe('NAMESPACE_EXISTS');
    expect(ErrorCode.NAMESPACE_NOT_FOUND).toBe('NAMESPACE_NOT_FOUND');
    expect(ErrorCode.BATCH_OPERATION_FAILED).toBe('BATCH_OPERATION_FAILED');
    expect(ErrorCode.INDEX_ERROR).toBe('INDEX_ERROR');
    expect(ErrorCode.BROWSER_NOT_SUPPORTED).toBe('BROWSER_NOT_SUPPORTED');
    expect(ErrorCode.UNKNOWN_ERROR).toBe('UNKNOWN_ERROR');
  });

  test('DimensionMismatchError carries the DIMENSION_MISMATCH error code', () => {
    const error = new DimensionMismatchError(128, 256);
    expect(error.code).toBe(ErrorCode.DIMENSION_MISMATCH);
  });

  test('VectorNotFoundError carries the VECTOR_NOT_FOUND error code', () => {
    const error = new VectorNotFoundError('vec-1');
    expect(error.code).toBe(ErrorCode.VECTOR_NOT_FOUND);
  });

  test('InvalidFormatError carries the INVALID_FORMAT error code', () => {
    const error = new InvalidFormatError('Map', ['Float32Array', 'number[]']);
    expect(error.code).toBe(ErrorCode.INVALID_FORMAT);
  });

  test('QuotaExceededError carries the QUOTA_EXCEEDED error code', () => {
    const error = new QuotaExceededError(1000, 500);
    expect(error.code).toBe(ErrorCode.QUOTA_EXCEEDED);
  });

  test('DatabaseInitializationError carries the DATABASE_INIT_FAILED error code', () => {
    const error = new DatabaseInitializationError('IndexedDB unavailable');
    expect(error.code).toBe(ErrorCode.DATABASE_INIT_FAILED);
  });

  test('TransactionError carries the TRANSACTION_FAILED error code', () => {
    const error = new TransactionError('write', 'aborted');
    expect(error.code).toBe(ErrorCode.TRANSACTION_FAILED);
  });

  test('NamespaceExistsError carries the NAMESPACE_EXISTS error code', () => {
    const error = new NamespaceExistsError('products');
    expect(error.code).toBe(ErrorCode.NAMESPACE_EXISTS);
  });

  test('NamespaceNotFoundError carries the NAMESPACE_NOT_FOUND error code', () => {
    const error = new NamespaceNotFoundError('missing-ns');
    expect(error.code).toBe(ErrorCode.NAMESPACE_NOT_FOUND);
  });

  test('BatchOperationError carries the BATCH_OPERATION_FAILED error code', () => {
    const error = new BatchOperationError(5, 2, []);
    expect(error.code).toBe(ErrorCode.BATCH_OPERATION_FAILED);
  });

  test('IndexError carries the INDEX_ERROR error code', () => {
    const error = new IndexError('hnsw', 'insert', 'graph full');
    expect(error.code).toBe(ErrorCode.INDEX_ERROR);
  });

  test('BrowserSupportError carries the BROWSER_NOT_SUPPORTED error code', () => {
    const error = new BrowserSupportError('IndexedDB');
    expect(error.code).toBe(ErrorCode.BROWSER_NOT_SUPPORTED);
  });
});

// ---------------------------------------------------------------------------
// Recovery guidance
// ---------------------------------------------------------------------------

describe('recovery guidance', () => {
  test('DimensionMismatchError provides recovery guidance', () => {
    const error = new DimensionMismatchError(128, 256);
    expect(typeof error.recovery).toBe('string');
    expect(error.recovery!.length).toBeGreaterThan(0);
  });

  test('VectorNotFoundError provides recovery guidance', () => {
    const error = new VectorNotFoundError('missing-id');
    expect(typeof error.recovery).toBe('string');
  });

  test('QuotaExceededError provides recovery guidance', () => {
    const error = new QuotaExceededError(1_000_000, 500_000);
    expect(typeof error.recovery).toBe('string');
  });

  test('DatabaseInitializationError provides recovery guidance', () => {
    const error = new DatabaseInitializationError('unavailable');
    expect(typeof error.recovery).toBe('string');
  });

  test('recovery guidance is included in toJSON() output', () => {
    const error = new DimensionMismatchError(128, 256);
    const json = error.toJSON();
    expect(json['recovery']).toBeDefined();
    expect(typeof json['recovery']).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// toJSON sanitization integration
// ---------------------------------------------------------------------------

describe('toJSON — context sanitization in serialized errors', () => {
  test('VectorNotFoundError toJSON does not leak namespace URL-like values', () => {
    const error = new VectorNotFoundError('vec-1', 'my-namespace');
    const json = error.toJSON();

    // vectorId is safe to include — it's an operational identifier
    const context = json['context'] as Record<string, unknown>;
    expect(context?.['vectorId']).toBe('vec-1');
    // namespace is also safe
    expect(context?.['namespace']).toBe('my-namespace');
  });

  test('TransactionError toJSON redacts originalError chain', () => {
    const cause = new Error('connection refused to redis://user:pass@host:6379');
    const error = new TransactionError('write', 'aborted', cause);
    const json = error.toJSON();

    const context = json['context'] as Record<string, unknown>;
    // originalError should be redacted in the context
    expect(context?.['originalError']).toBe('[REDACTED]');
  });

  test('toJSON always includes the stable error code', () => {
    const error = new DimensionMismatchError(128, 256);
    const json = error.toJSON();
    expect(json['code']).toBe('DIMENSION_MISMATCH');
  });

  test('toJSON includes error name and message', () => {
    const error = new NamespaceNotFoundError('missing-ns');
    const json = error.toJSON();
    expect(json['name']).toBe('NamespaceNotFoundError');
    expect(typeof json['message']).toBe('string');
    expect((json['message'] as string).length).toBeGreaterThan(0);
  });

  test('toJSON includes timestamp', () => {
    const error = new QuotaExceededError(1000, 500);
    const json = error.toJSON();
    expect(json['timestamp']).toBeInstanceOf(Date);
  });

  test('stack trace is absent in non-development environments', () => {
    const error = new IndexError('hnsw', 'insert', 'capacity exceeded');
    const json = error.toJSON();
    // In test environment NODE_ENV is not 'development', so stack must be absent
    if (typeof process !== 'undefined' && process.env?.['NODE_ENV'] !== 'development') {
      expect(json['stack']).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// isVectorDatabaseError type guard
// ---------------------------------------------------------------------------

describe('isVectorDatabaseError', () => {
  test('returns true for any VectorDatabaseError subclass', () => {
    expect(isVectorDatabaseError(new DimensionMismatchError(3, 5))).toBe(true);
    expect(isVectorDatabaseError(new VectorNotFoundError('x'))).toBe(true);
    expect(isVectorDatabaseError(new QuotaExceededError(1, 1))).toBe(true);
  });

  test('returns false for plain Error', () => {
    expect(isVectorDatabaseError(new Error('generic'))).toBe(false);
  });

  test('returns false for non-error values', () => {
    expect(isVectorDatabaseError(null)).toBe(false);
    expect(isVectorDatabaseError(undefined)).toBe(false);
    expect(isVectorDatabaseError('error string')).toBe(false);
    expect(isVectorDatabaseError(42)).toBe(false);
  });
});
