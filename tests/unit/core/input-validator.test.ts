import { describe, test, expect } from 'bun:test';

import { InputValidator } from '@/core/input-validator.js';

describe('InputValidator', () => {
  describe('validateVectorId', () => {
    test('accepts a valid string identifier', () => {
      expect(InputValidator.validateVectorId('doc-123')).toBe('doc-123');
    });

    test('accepts a single-character identifier', () => {
      expect(InputValidator.validateVectorId('a')).toBe('a');
    });

    test('accepts an identifier at the 255-character boundary', () => {
      const maxId = 'a'.repeat(255);
      expect(InputValidator.validateVectorId(maxId)).toBe(maxId);
    });

    test('returns the validated string (not a copy or transformation)', () => {
      const id = 'my-vector';
      const result = InputValidator.validateVectorId(id);
      expect(result).toBe(id);
    });

    test('throws when the identifier is not a string', () => {
      expect(() => InputValidator.validateVectorId(123)).toThrow(
        'Vector ID must be a string',
      );
      expect(() => InputValidator.validateVectorId(null)).toThrow(
        'Vector ID must be a string',
      );
      expect(() => InputValidator.validateVectorId(undefined)).toThrow(
        'Vector ID must be a string',
      );
      expect(() => InputValidator.validateVectorId(true)).toThrow(
        'Vector ID must be a string',
      );
      expect(() => InputValidator.validateVectorId({})).toThrow(
        'Vector ID must be a string',
      );
      expect(() => InputValidator.validateVectorId([])).toThrow(
        'Vector ID must be a string',
      );
    });

    test('throws when the identifier is an empty string', () => {
      expect(() => InputValidator.validateVectorId('')).toThrow(
        'Vector ID cannot be empty',
      );
    });

    test('throws when the identifier exceeds 255 characters', () => {
      const longId = 'a'.repeat(256);
      expect(() => InputValidator.validateVectorId(longId)).toThrow(
        'Vector ID cannot exceed 255 characters',
      );
    });

    test('throws when the identifier contains angle brackets', () => {
      expect(() => InputValidator.validateVectorId('id<script>')).toThrow(
        'Vector ID contains invalid characters',
      );
      expect(() => InputValidator.validateVectorId('id>test')).toThrow(
        'Vector ID contains invalid characters',
      );
    });

    test('throws when the identifier contains filesystem-unsafe characters', () => {
      const unsafeCharacters = [':', '"', '/', '\\', '|', '?', '*'];
      for (const character of unsafeCharacters) {
        expect(() => InputValidator.validateVectorId(`id${character}test`)).toThrow(
          'Vector ID contains invalid characters',
        );
      }
    });

    test('throws when the identifier contains control characters', () => {
      expect(() => InputValidator.validateVectorId('id\x00test')).toThrow(
        'Vector ID contains invalid characters',
      );
      expect(() => InputValidator.validateVectorId('id\x1Ftest')).toThrow(
        'Vector ID contains invalid characters',
      );
      expect(() => InputValidator.validateVectorId('id\ntest')).toThrow(
        'Vector ID contains invalid characters',
      );
      expect(() => InputValidator.validateVectorId('id\ttest')).toThrow(
        'Vector ID contains invalid characters',
      );
    });

    test('accepts identifiers with spaces, dots, and other safe characters', () => {
      expect(InputValidator.validateVectorId('doc 123')).toBe('doc 123');
      expect(InputValidator.validateVectorId('doc.123')).toBe('doc.123');
      expect(InputValidator.validateVectorId('doc-123_456')).toBe('doc-123_456');
      expect(InputValidator.validateVectorId('doc@email.com')).toBe('doc@email.com');
    });
  });

  describe('validateDimension', () => {
    test('accepts a valid positive integer', () => {
      expect(InputValidator.validateDimension(384)).toBe(384);
    });

    test('accepts 1 as the minimum valid dimension', () => {
      expect(InputValidator.validateDimension(1)).toBe(1);
    });

    test('accepts 100000 as the maximum valid dimension', () => {
      expect(InputValidator.validateDimension(100000)).toBe(100000);
    });

    test('throws when the value is not a number', () => {
      expect(() => InputValidator.validateDimension('384')).toThrow(
        'Dimension must be a number',
      );
      expect(() => InputValidator.validateDimension(null)).toThrow(
        'Dimension must be a number',
      );
      expect(() => InputValidator.validateDimension(undefined)).toThrow(
        'Dimension must be a number',
      );
    });

    test('throws when the value is not an integer', () => {
      expect(() => InputValidator.validateDimension(3.14)).toThrow(
        'Dimension must be an integer',
      );
      expect(() => InputValidator.validateDimension(384.5)).toThrow(
        'Dimension must be an integer',
      );
    });

    test('throws when the value is zero', () => {
      expect(() => InputValidator.validateDimension(0)).toThrow(
        'Dimension must be positive',
      );
    });

    test('throws when the value is negative', () => {
      expect(() => InputValidator.validateDimension(-1)).toThrow(
        'Dimension must be positive',
      );
      expect(() => InputValidator.validateDimension(-100)).toThrow(
        'Dimension must be positive',
      );
    });

    test('throws when the value exceeds 100,000', () => {
      expect(() => InputValidator.validateDimension(100001)).toThrow(
        'Dimension cannot exceed 100,000',
      );
    });

    test('throws when the value is NaN', () => {
      expect(() => InputValidator.validateDimension(NaN)).toThrow(
        'Dimension must be an integer',
      );
    });

    test('throws when the value is Infinity', () => {
      expect(() => InputValidator.validateDimension(Infinity)).toThrow(
        'Dimension must be an integer',
      );
    });
  });

  describe('validateK', () => {
    test('accepts a valid positive integer', () => {
      expect(InputValidator.validateK(10)).toBe(10);
    });

    test('accepts 1 as the minimum valid value', () => {
      expect(InputValidator.validateK(1)).toBe(1);
    });

    test('accepts 10000 as the maximum valid value', () => {
      expect(InputValidator.validateK(10000)).toBe(10000);
    });

    test('throws when the value is not a number', () => {
      expect(() => InputValidator.validateK('5')).toThrow(
        'Search parameter k must be a number',
      );
      expect(() => InputValidator.validateK(null)).toThrow(
        'Search parameter k must be a number',
      );
    });

    test('throws when the value is not an integer', () => {
      expect(() => InputValidator.validateK(5.5)).toThrow(
        'Search parameter k must be an integer',
      );
    });

    test('throws when the value is zero', () => {
      expect(() => InputValidator.validateK(0)).toThrow(
        'Search parameter k must be positive',
      );
    });

    test('throws when the value is negative', () => {
      expect(() => InputValidator.validateK(-1)).toThrow(
        'Search parameter k must be positive',
      );
    });

    test('throws when the value exceeds 10,000', () => {
      expect(() => InputValidator.validateK(10001)).toThrow(
        'Search parameter k cannot exceed 10,000',
      );
    });
  });

  describe('validateDistance', () => {
    test('accepts a valid finite non-negative number', () => {
      expect(InputValidator.validateDistance(0.5)).toBe(0.5);
    });

    test('accepts zero as a valid distance', () => {
      expect(InputValidator.validateDistance(0)).toBe(0);
    });

    test('accepts 1000 as the maximum valid distance', () => {
      expect(InputValidator.validateDistance(1000)).toBe(1000);
    });

    test('accepts fractional values', () => {
      expect(InputValidator.validateDistance(0.001)).toBe(0.001);
      expect(InputValidator.validateDistance(999.999)).toBe(999.999);
    });

    test('throws when the value is not a number', () => {
      expect(() => InputValidator.validateDistance('0.5')).toThrow(
        'Distance must be a number',
      );
      expect(() => InputValidator.validateDistance(null)).toThrow(
        'Distance must be a number',
      );
    });

    test('throws when the value is Infinity', () => {
      expect(() => InputValidator.validateDistance(Infinity)).toThrow(
        'Distance must be finite',
      );
      expect(() => InputValidator.validateDistance(-Infinity)).toThrow(
        'Distance must be finite',
      );
    });

    test('throws when the value is NaN', () => {
      expect(() => InputValidator.validateDistance(NaN)).toThrow(
        'Distance must be finite',
      );
    });

    test('throws when the value is negative', () => {
      expect(() => InputValidator.validateDistance(-0.001)).toThrow(
        'Distance must be non-negative',
      );
      expect(() => InputValidator.validateDistance(-1)).toThrow(
        'Distance must be non-negative',
      );
    });

    test('throws when the value exceeds 1000', () => {
      expect(() => InputValidator.validateDistance(1000.001)).toThrow(
        'Distance cannot exceed 1000',
      );
      expect(() => InputValidator.validateDistance(1001)).toThrow(
        'Distance cannot exceed 1000',
      );
    });
  });

  describe('validateMetadata', () => {
    test('returns an empty object when metadata is null', () => {
      expect(InputValidator.validateMetadata(null)).toEqual({});
    });

    test('returns an empty object when metadata is undefined', () => {
      expect(InputValidator.validateMetadata(undefined)).toEqual({});
    });

    test('accepts a valid flat metadata object', () => {
      const metadata = { category: 'AI', score: 0.95, active: true };
      expect(InputValidator.validateMetadata(metadata)).toEqual(metadata);
    });

    test('throws when metadata is an array', () => {
      expect(() => InputValidator.validateMetadata([1, 2, 3])).toThrow(
        'Metadata must be an object',
      );
    });

    test('throws when metadata is a primitive', () => {
      expect(() => InputValidator.validateMetadata('string')).toThrow(
        'Metadata must be an object',
      );
      expect(() => InputValidator.validateMetadata(42)).toThrow(
        'Metadata must be an object',
      );
      expect(() => InputValidator.validateMetadata(true)).toThrow(
        'Metadata must be an object',
      );
    });

    test('throws when the number of properties exceeds the default limit of 1000', () => {
      const metadata: Record<string, string> = {};
      for (let i = 0; i <= 1000; i++) {
        metadata[`key${i}`] = 'value';
      }
      expect(() => InputValidator.validateMetadata(metadata)).toThrow(
        'Metadata cannot have more than 1000 properties',
      );
    });

    test('respects a custom maxObjectProperties option', () => {
      const metadata = { a: 1, b: 2, c: 3 };
      expect(() =>
        InputValidator.validateMetadata(metadata, { maxObjectProperties: 2 }),
      ).toThrow('Metadata cannot have more than 2 properties');
    });

    test('allows null and undefined metadata values', () => {
      const metadata = { a: null, b: undefined };
      expect(InputValidator.validateMetadata(metadata)).toEqual(metadata);
    });

    describe('key validation', () => {
      test('throws when a metadata key exceeds 100 characters', () => {
        const longKey = 'k'.repeat(101);
        expect(() => InputValidator.validateMetadata({ [longKey]: 'value' })).toThrow(
          'Metadata keys cannot exceed 100 characters',
        );
      });

      test('accepts a metadata key at the 100-character boundary', () => {
        const maxKey = 'k'.repeat(100);
        expect(InputValidator.validateMetadata({ [maxKey]: 'value' })).toEqual({
          [maxKey]: 'value',
        });
      });

      test('throws when a key starts with double underscores (prototype pollution attempt)', () => {
        expect(() =>
          InputValidator.validateMetadata({ __constructor__: 'value' }),
        ).toThrow('Invalid metadata key');
        expect(() => InputValidator.validateMetadata({ __lookup__: 'value' })).toThrow(
          'Invalid metadata key',
        );
      });

      test('silently ignores __proto__ because Object.entries does not enumerate it', () => {
        // This is safe because __proto__ is not iterable via Object.entries,
        // so it never reaches the key validation logic
        expect(InputValidator.validateMetadata({ __proto__: {} })).toEqual({});
      });

      test('throws when a key contains path traversal characters (..)', () => {
        expect(() => InputValidator.validateMetadata({ '../secret': 'value' })).toThrow(
          'Invalid metadata key',
        );
        expect(() => InputValidator.validateMetadata({ 'a..b': 'value' })).toThrow(
          'Invalid metadata key',
        );
      });

      test('throws when a key contains a forward slash', () => {
        expect(() =>
          InputValidator.validateMetadata({ 'path/to/file': 'value' }),
        ).toThrow('Invalid metadata key');
      });
    });

    describe('value validation', () => {
      test('accepts string, number, and boolean values', () => {
        const metadata = { s: 'text', n: 42, b: false };
        expect(InputValidator.validateMetadata(metadata)).toEqual(metadata);
      });

      test('throws when a string value exceeds the default maxStringLength of 10000', () => {
        const longString = 'x'.repeat(10001);
        expect(() => InputValidator.validateMetadata({ text: longString })).toThrow(
          'String value cannot exceed 10000 characters',
        );
      });

      test('respects a custom maxStringLength option', () => {
        expect(() =>
          InputValidator.validateMetadata({ text: 'hello' }, { maxStringLength: 3 }),
        ).toThrow('String value cannot exceed 3 characters');
      });

      test('throws when a number value is not finite', () => {
        expect(() => InputValidator.validateMetadata({ value: Infinity })).toThrow(
          'Number values must be finite',
        );
        expect(() => InputValidator.validateMetadata({ value: NaN })).toThrow(
          'Number values must be finite',
        );
        expect(() => InputValidator.validateMetadata({ value: -Infinity })).toThrow(
          'Number values must be finite',
        );
      });

      test('throws when a value has a disallowed type (e.g. function)', () => {
        expect(() => InputValidator.validateMetadata({ fn: () => {} })).toThrow(
          'Invalid metadata value type: function',
        );
      });

      test('rejects a type when it is excluded from the allowedTypes set', () => {
        expect(() =>
          InputValidator.validateMetadata(
            { score: 42 },
            { allowedTypes: new Set(['string', 'boolean', 'object']) },
          ),
        ).toThrow('Invalid metadata value type: number');
      });
    });

    describe('nested object validation', () => {
      test('accepts nested objects within the default depth limit', () => {
        const metadata = { level1: { level2: { level3: 'deep' } } };
        expect(InputValidator.validateMetadata(metadata)).toEqual(metadata);
      });

      test('throws when nesting exceeds the default depth limit of 10', () => {
        let current: Record<string, unknown> = { value: 'leaf' };
        for (let i = 0; i < 10; i++) {
          current = { nested: current };
        }
        expect(() => InputValidator.validateMetadata(current)).toThrow(
          'Metadata object depth cannot exceed 10',
        );
      });

      test('respects a custom maxObjectDepth option', () => {
        const metadata = { a: { b: { c: 'deep' } } };
        expect(() =>
          InputValidator.validateMetadata(metadata, { maxObjectDepth: 2 }),
        ).toThrow('Metadata object depth cannot exceed 2');
      });
    });

    describe('array value validation', () => {
      test('accepts arrays within metadata values', () => {
        const metadata = { tags: ['a', 'b', 'c'] };
        expect(InputValidator.validateMetadata(metadata)).toEqual(metadata);
      });

      test('throws when an array exceeds the default maxArrayLength of 10000', () => {
        const largeArray = new Array(10001).fill('item');
        expect(() => InputValidator.validateMetadata({ items: largeArray })).toThrow(
          'Array cannot exceed 10000 elements',
        );
      });

      test('respects a custom maxArrayLength option', () => {
        expect(() =>
          InputValidator.validateMetadata({ items: [1, 2, 3] }, { maxArrayLength: 2 }),
        ).toThrow('Array cannot exceed 2 elements');
      });

      test('validates individual elements within an array', () => {
        expect(() =>
          InputValidator.validateMetadata({ items: [1, 'text', () => {}] }),
        ).toThrow('Invalid metadata value type: function');
      });
    });
  });

  describe('validateVectorIds', () => {
    test('accepts a valid array of unique string identifiers', () => {
      const ids = ['id1', 'id2', 'id3'];
      expect(InputValidator.validateVectorIds(ids)).toEqual(ids);
    });

    test('accepts an array with a single identifier', () => {
      expect(InputValidator.validateVectorIds(['only-one'])).toEqual(['only-one']);
    });

    test('throws when the argument is not an array', () => {
      expect(() => InputValidator.validateVectorIds('not-an-array')).toThrow(
        'Vector IDs must be an array',
      );
      expect(() => InputValidator.validateVectorIds(null)).toThrow(
        'Vector IDs must be an array',
      );
      expect(() => InputValidator.validateVectorIds({})).toThrow(
        'Vector IDs must be an array',
      );
    });

    test('throws when the array is empty', () => {
      expect(() => InputValidator.validateVectorIds([])).toThrow(
        'Vector IDs array cannot be empty',
      );
    });

    test('throws when the array exceeds 10,000 items', () => {
      const ids = Array.from({ length: 10001 }, (_, i) => `id-${i}`);
      expect(() => InputValidator.validateVectorIds(ids)).toThrow(
        'Cannot process more than 10,000 vector IDs at once',
      );
    });

    test('accepts exactly 10,000 unique identifiers', () => {
      const ids = Array.from({ length: 10000 }, (_, i) => `id-${i}`);
      expect(InputValidator.validateVectorIds(ids)).toEqual(ids);
    });

    test('throws when duplicate identifiers are present', () => {
      expect(() => InputValidator.validateVectorIds(['id1', 'id2', 'id1'])).toThrow(
        'Duplicate vector ID found: id1',
      );
    });

    test('validates each individual identifier (rejects invalid IDs within the array)', () => {
      expect(() =>
        InputValidator.validateVectorIds(['valid', 123 as unknown as string]),
      ).toThrow('Vector ID must be a string');
      expect(() => InputValidator.validateVectorIds(['valid', ''])).toThrow(
        'Vector ID cannot be empty',
      );
    });
  });

  describe('validateBatchData', () => {
    const identityValidator = (item: unknown, _index: number) => item as number;

    test('applies the item validator to each element and returns results', () => {
      const doubleValidator = (item: unknown, _index: number) => (item as number) * 2;
      expect(InputValidator.validateBatchData([1, 2, 3], doubleValidator)).toEqual([
        2, 4, 6,
      ]);
    });

    test('throws when the data is not an array', () => {
      expect(() =>
        InputValidator.validateBatchData('not-array', identityValidator),
      ).toThrow('Batch data must be an array');
      expect(() => InputValidator.validateBatchData(null, identityValidator)).toThrow(
        'Batch data must be an array',
      );
    });

    test('throws when the data is an empty array', () => {
      expect(() => InputValidator.validateBatchData([], identityValidator)).toThrow(
        'Batch data cannot be empty',
      );
    });

    test('throws when the data exceeds the default max of 1000 items', () => {
      const data = new Array(1001).fill(1);
      expect(() => InputValidator.validateBatchData(data, identityValidator)).toThrow(
        'Batch operation cannot exceed 1000 items',
      );
    });

    test('respects a custom maxItems parameter', () => {
      const data = [1, 2, 3, 4, 5];
      expect(() => InputValidator.validateBatchData(data, identityValidator, 3)).toThrow(
        'Batch operation cannot exceed 3 items',
      );
    });

    test('wraps item validator errors with the index information', () => {
      const failingValidator = (_item: unknown, _index: number) => {
        throw new Error('bad value');
      };
      expect(() => InputValidator.validateBatchData([1, 2], failingValidator)).toThrow(
        'Invalid item at index 0: bad value',
      );
    });

    test('reports the correct index when a later item fails validation', () => {
      const failOnThirdValidator = (_item: unknown, index: number) => {
        if (index === 2) throw new Error('third item is bad');
        return index;
      };
      expect(() =>
        InputValidator.validateBatchData([1, 2, 3], failOnThirdValidator),
      ).toThrow('Invalid item at index 2: third item is bad');
    });

    test('handles non-Error exceptions in the item validator', () => {
      const throwsString = () => {
        throw 'just a string';
      };
      expect(() => InputValidator.validateBatchData([1], throwsString)).toThrow(
        'Invalid item at index 0: Unknown error',
      );
    });
  });

  describe('validateDatabaseName', () => {
    test('accepts a valid database name starting with a letter', () => {
      expect(InputValidator.validateDatabaseName('myDatabase')).toBe('myDatabase');
    });

    test('accepts names with letters, numbers, underscores, and hyphens', () => {
      expect(InputValidator.validateDatabaseName('my-db_123')).toBe('my-db_123');
      expect(InputValidator.validateDatabaseName('A')).toBe('A');
    });

    test('accepts a name at the 64-character boundary', () => {
      const maxName = 'a' + 'b'.repeat(63);
      expect(InputValidator.validateDatabaseName(maxName)).toBe(maxName);
    });

    test('throws when the name is not a string', () => {
      expect(() => InputValidator.validateDatabaseName(123)).toThrow(
        'Database name must be a string',
      );
      expect(() => InputValidator.validateDatabaseName(null)).toThrow(
        'Database name must be a string',
      );
    });

    test('throws when the name is empty', () => {
      expect(() => InputValidator.validateDatabaseName('')).toThrow(
        'Database name cannot be empty',
      );
    });

    test('throws when the name exceeds 64 characters', () => {
      const longName = 'a'.repeat(65);
      expect(() => InputValidator.validateDatabaseName(longName)).toThrow(
        'Database name cannot exceed 64 characters',
      );
    });

    test('throws when the name starts with a number', () => {
      expect(() => InputValidator.validateDatabaseName('1database')).toThrow(
        'Database name must start with a letter',
      );
    });

    test('throws when the name starts with an underscore', () => {
      expect(() => InputValidator.validateDatabaseName('_database')).toThrow(
        'Database name must start with a letter',
      );
    });

    test('throws when the name starts with a hyphen', () => {
      expect(() => InputValidator.validateDatabaseName('-database')).toThrow(
        'Database name must start with a letter',
      );
    });

    test('throws when the name contains special characters', () => {
      expect(() => InputValidator.validateDatabaseName('my database')).toThrow(
        'Database name must start with a letter',
      );
      expect(() => InputValidator.validateDatabaseName('my.database')).toThrow(
        'Database name must start with a letter',
      );
      expect(() => InputValidator.validateDatabaseName('my@database')).toThrow(
        'Database name must start with a letter',
      );
    });
  });

  describe('validateNamespace', () => {
    test('accepts a valid namespace starting with a letter', () => {
      expect(InputValidator.validateNamespace('products')).toBe('products');
    });

    test('accepts names with letters, numbers, underscores, and hyphens', () => {
      expect(InputValidator.validateNamespace('my-namespace_v2')).toBe('my-namespace_v2');
    });

    test('accepts a name at the 64-character boundary', () => {
      const maxName = 'n' + 's'.repeat(63);
      expect(InputValidator.validateNamespace(maxName)).toBe(maxName);
    });

    test('throws when the namespace is not a string', () => {
      expect(() => InputValidator.validateNamespace(42)).toThrow(
        'Namespace must be a string',
      );
      expect(() => InputValidator.validateNamespace(null)).toThrow(
        'Namespace must be a string',
      );
    });

    test('throws when the namespace is empty', () => {
      expect(() => InputValidator.validateNamespace('')).toThrow(
        'Namespace cannot be empty',
      );
    });

    test('throws when the namespace exceeds 64 characters', () => {
      const longName = 'n'.repeat(65);
      expect(() => InputValidator.validateNamespace(longName)).toThrow(
        'Namespace cannot exceed 64 characters',
      );
    });

    test('throws when the namespace starts with a number', () => {
      expect(() => InputValidator.validateNamespace('1namespace')).toThrow(
        'Namespace must start with a letter',
      );
    });

    test('throws when the namespace contains special characters', () => {
      expect(() => InputValidator.validateNamespace('name space')).toThrow(
        'Namespace must start with a letter',
      );
      expect(() => InputValidator.validateNamespace('name.space')).toThrow(
        'Namespace must start with a letter',
      );
    });
  });

  describe('sanitizeString', () => {
    test('returns the original string when it contains no control characters', () => {
      expect(InputValidator.sanitizeString('hello world')).toBe('hello world');
    });

    test('removes null bytes', () => {
      expect(InputValidator.sanitizeString('hello\x00world')).toBe('helloworld');
    });

    test('removes control characters in the range 0x00-0x08', () => {
      expect(InputValidator.sanitizeString('a\x01b\x02c\x08d')).toBe('abcd');
    });

    test('removes vertical tab (0x0B) and form feed (0x0C)', () => {
      expect(InputValidator.sanitizeString('a\x0Bb\x0Cc')).toBe('abc');
    });

    test('removes control characters in the range 0x0E-0x1F', () => {
      expect(InputValidator.sanitizeString('a\x0Eb\x1Fc')).toBe('abc');
    });

    test('removes the DEL character (0x7F)', () => {
      expect(InputValidator.sanitizeString('hello\x7Fworld')).toBe('helloworld');
    });

    test('preserves newline (0x0A), carriage return (0x0D), and tab (0x09)', () => {
      expect(InputValidator.sanitizeString('line1\nline2\r\n\ttabbed')).toBe(
        'line1\nline2\r\n\ttabbed',
      );
    });

    test('returns an empty string when the input is empty', () => {
      expect(InputValidator.sanitizeString('')).toBe('');
    });

    test('handles a string composed entirely of control characters', () => {
      expect(InputValidator.sanitizeString('\x00\x01\x02\x03\x04\x05\x06\x07\x08')).toBe(
        '',
      );
    });

    test('preserves unicode characters', () => {
      expect(InputValidator.sanitizeString('caf\u00E9 \u2603 \uD83D\uDE00')).toBe(
        'caf\u00E9 \u2603 \uD83D\uDE00',
      );
    });
  });

  describe('validateSearchOptions', () => {
    test('returns an empty object when options is null', () => {
      expect(InputValidator.validateSearchOptions(null)).toEqual({});
    });

    test('returns an empty object when options is undefined', () => {
      expect(InputValidator.validateSearchOptions(undefined)).toEqual({});
    });

    test('throws when options is not an object', () => {
      expect(() => InputValidator.validateSearchOptions('string')).toThrow(
        'Search options must be an object',
      );
      expect(() => InputValidator.validateSearchOptions(42)).toThrow(
        'Search options must be an object',
      );
    });

    test('throws when options is an array', () => {
      expect(() => InputValidator.validateSearchOptions([1, 2])).toThrow(
        'Search options must be an object',
      );
    });

    test('validates the filter property as metadata', () => {
      const options = { filter: { category: 'AI' } };
      const result = InputValidator.validateSearchOptions(options);
      expect(result).toEqual({ filter: { category: 'AI' } });
    });

    test('throws when the filter property is not valid metadata', () => {
      expect(() =>
        InputValidator.validateSearchOptions({ filter: 'not-an-object' }),
      ).toThrow('Metadata must be an object');
    });

    test('validates includeMetadata as a boolean', () => {
      expect(InputValidator.validateSearchOptions({ includeMetadata: true })).toEqual({
        includeMetadata: true,
      });
      expect(InputValidator.validateSearchOptions({ includeMetadata: false })).toEqual({
        includeMetadata: false,
      });
    });

    test('throws when includeMetadata is not a boolean', () => {
      expect(() => InputValidator.validateSearchOptions({ includeMetadata: 1 })).toThrow(
        'includeMetadata must be a boolean',
      );
      expect(() =>
        InputValidator.validateSearchOptions({ includeMetadata: 'true' }),
      ).toThrow('includeMetadata must be a boolean');
    });

    test('validates includeVector as a boolean', () => {
      expect(InputValidator.validateSearchOptions({ includeVector: true })).toEqual({
        includeVector: true,
      });
    });

    test('throws when includeVector is not a boolean', () => {
      expect(() => InputValidator.validateSearchOptions({ includeVector: 0 })).toThrow(
        'includeVector must be a boolean',
      );
    });

    test('validates maxResults as a positive integer', () => {
      expect(InputValidator.validateSearchOptions({ maxResults: 100 })).toEqual({
        maxResults: 100,
      });
    });

    test('throws when maxResults is not a positive integer', () => {
      expect(() => InputValidator.validateSearchOptions({ maxResults: 0 })).toThrow(
        'maxResults must be a positive integer',
      );
      expect(() => InputValidator.validateSearchOptions({ maxResults: -5 })).toThrow(
        'maxResults must be a positive integer',
      );
      expect(() => InputValidator.validateSearchOptions({ maxResults: 3.14 })).toThrow(
        'maxResults must be a positive integer',
      );
      expect(() => InputValidator.validateSearchOptions({ maxResults: 'ten' })).toThrow(
        'maxResults must be a positive integer',
      );
    });

    test('throws when maxResults exceeds 50,000', () => {
      expect(() => InputValidator.validateSearchOptions({ maxResults: 50001 })).toThrow(
        'maxResults cannot exceed 50,000',
      );
    });

    test('validates batchSize as a positive integer', () => {
      expect(InputValidator.validateSearchOptions({ batchSize: 500 })).toEqual({
        batchSize: 500,
      });
    });

    test('throws when batchSize is not a positive integer', () => {
      expect(() => InputValidator.validateSearchOptions({ batchSize: 0 })).toThrow(
        'batchSize must be a positive integer',
      );
    });

    test('throws when batchSize exceeds 50,000', () => {
      expect(() => InputValidator.validateSearchOptions({ batchSize: 50001 })).toThrow(
        'batchSize cannot exceed 50,000',
      );
    });

    test('passes through unknown options without validation', () => {
      const options = { customOption: 'anything', includeMetadata: true };
      const result = InputValidator.validateSearchOptions(options);
      expect(result).toEqual({ customOption: 'anything', includeMetadata: true });
    });

    test('validates multiple options together', () => {
      const options = {
        filter: { category: 'AI' },
        includeMetadata: true,
        includeVector: false,
        maxResults: 50,
        batchSize: 100,
      };
      const result = InputValidator.validateSearchOptions(options);
      expect(result).toEqual(options);
    });
  });
});
