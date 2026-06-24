import { describe, expect, it } from 'bun:test';

import type { MetadataFilter } from '@/core/types.js';
import {
  MetadataFilterCompiler,
  metadataQuery,
  MetadataRangeQuery,
} from '@/search/metadata-filter.js';

describe('MetadataFilterCompiler', () => {
  describe('Field-level operators without $and wrapper', () => {
    it('should match $gt operator on a field', () => {
      const matcher = MetadataFilterCompiler.compile({ price: { $gt: 100 } });

      expect(matcher({ price: 200 })).toBe(true);
      expect(matcher({ price: 100 })).toBe(false);
      expect(matcher({ price: 50 })).toBe(false);
    });

    it('should match $lt operator on a field', () => {
      const matcher = MetadataFilterCompiler.compile({ price: { $lt: 100 } });

      expect(matcher({ price: 50 })).toBe(true);
      expect(matcher({ price: 100 })).toBe(false);
      expect(matcher({ price: 200 })).toBe(false);
    });

    it('should match $gte operator on a field', () => {
      const matcher = MetadataFilterCompiler.compile({ price: { $gte: 100 } });

      expect(matcher({ price: 100 })).toBe(true);
      expect(matcher({ price: 200 })).toBe(true);
      expect(matcher({ price: 50 })).toBe(false);
    });

    it('should match $lte operator on a field', () => {
      const matcher = MetadataFilterCompiler.compile({ price: { $lte: 100 } });

      expect(matcher({ price: 100 })).toBe(true);
      expect(matcher({ price: 50 })).toBe(true);
      expect(matcher({ price: 200 })).toBe(false);
    });

    it('should match $in operator on a field', () => {
      const matcher = MetadataFilterCompiler.compile({
        category: { $in: ['electronics', 'books'] },
      });

      expect(matcher({ category: 'electronics' })).toBe(true);
      expect(matcher({ category: 'books' })).toBe(true);
      expect(matcher({ category: 'clothing' })).toBe(false);
    });

    it('should match $nin operator on a field', () => {
      const matcher = MetadataFilterCompiler.compile({
        status: { $nin: ['deleted', 'archived'] },
      } as MetadataFilter);

      expect(matcher({ status: 'active' })).toBe(true);
      expect(matcher({ status: 'deleted' })).toBe(false);
      expect(matcher({ status: 'archived' })).toBe(false);
    });

    it('should match $regex operator on a field', () => {
      const matcher = MetadataFilterCompiler.compile({
        name: { $regex: '^test' },
      } as MetadataFilter);

      expect(matcher({ name: 'test-item' })).toBe(true);
      expect(matcher({ name: 'testing' })).toBe(true);
      expect(matcher({ name: 'my-test' })).toBe(false);
    });

    it('should match $ne operator on a field', () => {
      const matcher = MetadataFilterCompiler.compile({
        status: { $ne: 'deleted' },
      } as MetadataFilter);

      expect(matcher({ status: 'active' })).toBe(true);
      expect(matcher({ status: 'deleted' })).toBe(false);
    });

    it('should match $exists operator on a field', () => {
      const matcher = MetadataFilterCompiler.compile({
        description: { $exists: true },
      } as MetadataFilter);

      expect(matcher({ description: 'hello' })).toBe(true);
      expect(matcher({ title: 'hello' })).toBe(false);
    });

    it('should handle multiple field-level operators on different fields', () => {
      const matcher = MetadataFilterCompiler.compile({
        price: { $gt: 10 },
        category: { $in: ['electronics'] },
      });

      expect(matcher({ price: 20, category: 'electronics' })).toBe(true);
      expect(matcher({ price: 5, category: 'electronics' })).toBe(false);
      expect(matcher({ price: 20, category: 'books' })).toBe(false);
    });

    it('should handle mix of equality and operator fields', () => {
      const matcher = MetadataFilterCompiler.compile({
        status: 'active',
        price: { $gt: 10 },
      } as MetadataFilter);

      expect(matcher({ status: 'active', price: 20 })).toBe(true);
      expect(matcher({ status: 'active', price: 5 })).toBe(false);
      expect(matcher({ status: 'inactive', price: 20 })).toBe(false);
    });
  });

  describe('Simple equality filters', () => {
    it('should match exact values', () => {
      const matcher = MetadataFilterCompiler.compile({ color: 'red' } as MetadataFilter);

      expect(matcher({ color: 'red' })).toBe(true);
      expect(matcher({ color: 'blue' })).toBe(false);
    });

    it('should handle empty filter (match all)', () => {
      const matcher = MetadataFilterCompiler.compile({});
      expect(matcher({ anything: 'value' })).toBe(true);
    });
  });

  describe('Top-level operators', () => {
    it('should handle $and', () => {
      const matcher = MetadataFilterCompiler.compile({
        $and: [{ price: { $gt: 10 } }, { price: { $lt: 100 } }],
      });

      expect(matcher({ price: 50 })).toBe(true);
      expect(matcher({ price: 5 })).toBe(false);
      expect(matcher({ price: 200 })).toBe(false);
    });

    it('should handle $or', () => {
      const matcher = MetadataFilterCompiler.compile({
        $or: [{ color: 'red' }, { color: 'blue' }],
      } as MetadataFilter);

      expect(matcher({ color: 'red' })).toBe(true);
      expect(matcher({ color: 'blue' })).toBe(true);
      expect(matcher({ color: 'green' })).toBe(false);
    });
  });

  describe('$contains operator', () => {
    it('should match when the string field contains the substring', () => {
      const matcher = MetadataFilterCompiler.compile({
        title: { $contains: 'hello' },
      } as MetadataFilter);

      expect(matcher({ title: 'say hello world' })).toBe(true);
      expect(matcher({ title: 'hello' })).toBe(true);
      expect(matcher({ title: 'goodbye' })).toBe(false);
    });

    it('should return false when the field is not a string', () => {
      const matcher = MetadataFilterCompiler.compile({
        score: { $contains: '10' },
      } as MetadataFilter);

      expect(matcher({ score: 10 })).toBe(false);
      expect(matcher({ score: '10 points' })).toBe(true);
    });

    it('should return false when the operand is not a string', () => {
      const matcher = MetadataFilterCompiler.compile({
        title: { $contains: 42 },
      } as unknown as MetadataFilter);

      expect(matcher({ title: '42' })).toBe(false);
    });

    it('should be case-sensitive', () => {
      const matcher = MetadataFilterCompiler.compile({
        label: { $contains: 'Hello' },
      } as MetadataFilter);

      expect(matcher({ label: 'Hello World' })).toBe(true);
      expect(matcher({ label: 'hello world' })).toBe(false);
    });
  });

  describe('$between operator', () => {
    it('should match values within range (inclusive)', () => {
      const matcher = MetadataFilterCompiler.compile({
        price: { $between: [10, 100] },
      } as MetadataFilter);

      expect(matcher({ price: 10 })).toBe(true);
      expect(matcher({ price: 55 })).toBe(true);
      expect(matcher({ price: 100 })).toBe(true);
      expect(matcher({ price: 9 })).toBe(false);
      expect(matcher({ price: 101 })).toBe(false);
    });

    it('should return false for non-numeric field values', () => {
      const matcher = MetadataFilterCompiler.compile({
        score: { $between: [1, 10] },
      } as MetadataFilter);

      expect(matcher({ score: 'five' })).toBe(false);
      expect(matcher({ score: 5 })).toBe(true);
    });

    it('should return false for malformed operand', () => {
      const matcher = MetadataFilterCompiler.compile({
        score: { $between: [5] },
      } as unknown as MetadataFilter);

      expect(matcher({ score: 5 })).toBe(false);
    });
  });

  describe('$exists operator', () => {
    it('should match when field is present and $exists is true', () => {
      const matcher = MetadataFilterCompiler.compile({
        rating: { $exists: true },
      } as MetadataFilter);

      expect(matcher({ rating: 5 })).toBe(true);
      expect(matcher({ rating: 0 })).toBe(true);
      expect(matcher({ title: 'no rating' })).toBe(false);
    });

    it('should match when field is absent and $exists is false', () => {
      const matcher = MetadataFilterCompiler.compile({
        rating: { $exists: false },
      } as MetadataFilter);

      expect(matcher({ title: 'no rating' })).toBe(true);
      expect(matcher({ rating: 5 })).toBe(false);
    });

    it('should treat explicit undefined as non-existent', () => {
      const matcher = MetadataFilterCompiler.compile({
        rating: { $exists: true },
      } as MetadataFilter);

      expect(matcher({ rating: undefined })).toBe(false);
    });
  });

  describe('$type operator', () => {
    it('should match "string" type', () => {
      const matcher = MetadataFilterCompiler.compile({
        value: { $type: 'string' },
      } as MetadataFilter);

      expect(matcher({ value: 'hello' })).toBe(true);
      expect(matcher({ value: 42 })).toBe(false);
    });

    it('should match "number" type', () => {
      const matcher = MetadataFilterCompiler.compile({
        value: { $type: 'number' },
      } as MetadataFilter);

      expect(matcher({ value: 3.14 })).toBe(true);
      expect(matcher({ value: '3.14' })).toBe(false);
    });

    it('should match "boolean" type', () => {
      const matcher = MetadataFilterCompiler.compile({
        flag: { $type: 'boolean' },
      } as MetadataFilter);

      expect(matcher({ flag: true })).toBe(true);
      expect(matcher({ flag: false })).toBe(true);
      expect(matcher({ flag: 1 })).toBe(false);
    });

    it('should match "array" type', () => {
      const matcher = MetadataFilterCompiler.compile({
        tags: { $type: 'array' },
      } as MetadataFilter);

      expect(matcher({ tags: ['a', 'b'] })).toBe(true);
      expect(matcher({ tags: 'a' })).toBe(false);
    });

    it('should match "object" type (excludes null and arrays)', () => {
      const matcher = MetadataFilterCompiler.compile({
        meta: { $type: 'object' },
      } as MetadataFilter);

      expect(matcher({ meta: { key: 'val' } })).toBe(true);
      expect(matcher({ meta: null })).toBe(false);
      expect(matcher({ meta: ['a'] })).toBe(false);
    });

    it('should match "null" type', () => {
      const matcher = MetadataFilterCompiler.compile({
        value: { $type: 'null' },
      } as MetadataFilter);

      expect(matcher({ value: null })).toBe(true);
      expect(matcher({ value: 0 })).toBe(false);
      expect(matcher({ value: '' })).toBe(false);
    });

    it('should return false for unknown type strings', () => {
      const matcher = MetadataFilterCompiler.compile({
        value: { $type: 'integer' },
      } as unknown as MetadataFilter);

      expect(matcher({ value: 5 })).toBe(false);
    });
  });

  describe('$regex operator', () => {
    it('should match string patterns', () => {
      const matcher = MetadataFilterCompiler.compile({
        email: { $regex: '@example\\.com$' },
      } as MetadataFilter);

      expect(matcher({ email: 'user@example.com' })).toBe(true);
      expect(matcher({ email: 'user@other.com' })).toBe(false);
    });

    it('should accept RegExp objects', () => {
      const matcher = MetadataFilterCompiler.compile({
        name: { $regex: /^foo/i },
      } as MetadataFilter);

      expect(matcher({ name: 'FooBar' })).toBe(true);
      expect(matcher({ name: 'foobar' })).toBe(true);
      expect(matcher({ name: 'bar' })).toBe(false);
    });

    it('should accept {pattern, flags} objects', () => {
      const matcher = MetadataFilterCompiler.compile({
        name: { $regex: { pattern: '^foo', flags: 'i' } },
      } as MetadataFilter);

      expect(matcher({ name: 'FooBar' })).toBe(true);
      expect(matcher({ name: 'BAR' })).toBe(false);
    });

    it('should return false for non-string field values', () => {
      const matcher = MetadataFilterCompiler.compile({
        count: { $regex: '\\d+' },
      } as MetadataFilter);

      expect(matcher({ count: 5 })).toBe(false);
    });

    it('should reject dangerous regex patterns (ReDoS protection)', () => {
      const matcher = MetadataFilterCompiler.compile({
        text: { $regex: '(a+)+' },
      } as MetadataFilter);

      // Should return false (pattern rejected), not throw
      expect(matcher({ text: 'aaaa' })).toBe(false);
    });

    it('should reject patterns that exceed length limit', () => {
      const longPattern = 'a'.repeat(1001);
      const matcher = MetadataFilterCompiler.compile({
        text: { $regex: longPattern },
      } as MetadataFilter);

      expect(matcher({ text: 'aaaa' })).toBe(false);
    });

    it('should reject invalid regex flags', () => {
      const matcher = MetadataFilterCompiler.compile({
        text: { $regex: { pattern: 'foo', flags: 'z' } },
      } as MetadataFilter);

      expect(matcher({ text: 'foo' })).toBe(false);
    });
  });

  describe('$size operator', () => {
    it('should match arrays with the exact size', () => {
      const matcher = MetadataFilterCompiler.compile({
        tags: { $size: 2 },
      } as MetadataFilter);

      expect(matcher({ tags: ['a', 'b'] })).toBe(true);
      expect(matcher({ tags: ['a'] })).toBe(false);
      expect(matcher({ tags: ['a', 'b', 'c'] })).toBe(false);
    });

    it('should return false for non-array fields', () => {
      const matcher = MetadataFilterCompiler.compile({
        name: { $size: 3 },
      } as MetadataFilter);

      expect(matcher({ name: 'foo' })).toBe(false);
    });

    it('should support operator objects for $size comparison', () => {
      const matcher = MetadataFilterCompiler.compile({
        tags: { $size: { $gt: 1 } },
      } as unknown as MetadataFilter);

      expect(matcher({ tags: ['a', 'b'] })).toBe(true);
      expect(matcher({ tags: ['a'] })).toBe(false);
    });
  });

  describe('$all operator', () => {
    it('should match arrays containing all specified values', () => {
      const matcher = MetadataFilterCompiler.compile({
        tags: { $all: ['a', 'b'] },
      } as MetadataFilter);

      expect(matcher({ tags: ['a', 'b', 'c'] })).toBe(true);
      expect(matcher({ tags: ['a', 'b'] })).toBe(true);
      expect(matcher({ tags: ['a'] })).toBe(false);
      expect(matcher({ tags: ['c', 'd'] })).toBe(false);
    });

    it('should return false for non-array fields', () => {
      const matcher = MetadataFilterCompiler.compile({
        label: { $all: ['x'] },
      } as MetadataFilter);

      expect(matcher({ label: 'x' })).toBe(false);
    });

    it('should return false when operand is not an array', () => {
      const matcher = MetadataFilterCompiler.compile({
        tags: { $all: 'not-an-array' },
      } as unknown as MetadataFilter);

      expect(matcher({ tags: ['a', 'b'] })).toBe(false);
    });
  });

  describe('$elemMatch operator', () => {
    it('should match when any array element satisfies the sub-filter', () => {
      const matcher = MetadataFilterCompiler.compile({
        scores: { $elemMatch: { value: { $gt: 90 } } },
      } as MetadataFilter);

      expect(matcher({ scores: [{ value: 95 }, { value: 70 }] })).toBe(true);
      expect(matcher({ scores: [{ value: 80 }, { value: 70 }] })).toBe(false);
    });

    it('should match scalar values in arrays', () => {
      const matcher = MetadataFilterCompiler.compile({
        ids: { $elemMatch: 42 },
      } as MetadataFilter);

      expect(matcher({ ids: [10, 42, 99] })).toBe(true);
      expect(matcher({ ids: [10, 20, 99] })).toBe(false);
    });

    it('should return false for non-array fields', () => {
      const matcher = MetadataFilterCompiler.compile({
        value: { $elemMatch: { $gt: 5 } },
      } as MetadataFilter);

      expect(matcher({ value: 10 })).toBe(false);
    });

    it('should handle nested field conditions in sub-filter', () => {
      const matcher = MetadataFilterCompiler.compile({
        items: { $elemMatch: { price: { $lte: 50 }, inStock: true } },
      } as MetadataFilter);

      expect(
        matcher({
          items: [
            { price: 30, inStock: true },
            { price: 80, inStock: true },
          ],
        }),
      ).toBe(true);
      expect(
        matcher({
          items: [
            { price: 30, inStock: false },
            { price: 80, inStock: true },
          ],
        }),
      ).toBe(false);
    });
  });

  describe('Unsupported operator behavior', () => {
    it('should throw for unknown top-level operators', () => {
      const matcher = MetadataFilterCompiler.compile({
        $unknown: 'value',
      } as unknown as MetadataFilter);

      expect(() => matcher({ field: 'value' })).toThrow(
        'Unknown filter operator: $unknown',
      );
    });

    it('should throw for unknown field-level operators', () => {
      const matcher = MetadataFilterCompiler.compile({
        field: { $unknown: 'value' },
      } as unknown as MetadataFilter);

      expect(() => matcher({ field: 'value' })).toThrow(
        'Unknown field operator: $unknown',
      );
    });
  });
});

describe('MetadataRangeQuery', () => {
  it('should build a range filter', () => {
    const filter = metadataQuery().range('price', 10, 100).build();
    const matcher = MetadataFilterCompiler.compile(filter);

    expect(matcher({ price: 50 })).toBe(true);
    expect(matcher({ price: 10 })).toBe(true);
    expect(matcher({ price: 100 })).toBe(true);
    expect(matcher({ price: 9 })).toBe(false);
    expect(matcher({ price: 101 })).toBe(false);
  });

  it('should build an equals filter', () => {
    const filter = metadataQuery().equals('status', 'active').build();
    const matcher = MetadataFilterCompiler.compile(filter);

    expect(matcher({ status: 'active' })).toBe(true);
    expect(matcher({ status: 'inactive' })).toBe(false);
  });

  it('should build an $in filter', () => {
    const filter = metadataQuery().in('color', ['red', 'blue']).build();
    const matcher = MetadataFilterCompiler.compile(filter);

    expect(matcher({ color: 'red' })).toBe(true);
    expect(matcher({ color: 'blue' })).toBe(true);
    expect(matcher({ color: 'green' })).toBe(false);
  });

  it('should build a $nin filter', () => {
    const filter = metadataQuery().notIn('status', ['deleted', 'archived']).build();
    const matcher = MetadataFilterCompiler.compile(filter);

    expect(matcher({ status: 'active' })).toBe(true);
    expect(matcher({ status: 'deleted' })).toBe(false);
  });

  it('should build an $exists filter', () => {
    const filter = metadataQuery().exists('rating').build();
    const matcher = MetadataFilterCompiler.compile(filter);

    expect(matcher({ rating: 5 })).toBe(true);
    expect(matcher({ title: 'no rating' })).toBe(false);
  });

  it('should build a $regex filter', () => {
    const filter = metadataQuery().regex('name', '^test').build();
    const matcher = MetadataFilterCompiler.compile(filter);

    expect(matcher({ name: 'testing' })).toBe(true);
    expect(matcher({ name: 'other' })).toBe(false);
  });

  it('should build a combined AND filter', () => {
    const q1 = metadataQuery().range('price', 10, 50);
    const q2 = metadataQuery().equals('status', 'active');
    const filter = metadataQuery().and(q1, q2).build();
    const matcher = MetadataFilterCompiler.compile(filter);

    // The current query is initially empty, so AND'd with q1 and q2
    expect(matcher({ price: 30, status: 'active' })).toBe(true);
    expect(matcher({ price: 5, status: 'active' })).toBe(false);
    expect(matcher({ price: 30, status: 'inactive' })).toBe(false);
  });

  it('should build a combined OR filter', () => {
    // Use the first query as the "base" and OR in additional queries
    const q1 = metadataQuery().equals('color', 'red');
    const q2 = metadataQuery().equals('color', 'blue');
    // q1.or(q2) produces { $or: [{color:'red'}, {color:'blue'}] }
    const filter = q1.or(q2).build();
    const matcher = MetadataFilterCompiler.compile(filter);

    expect(matcher({ color: 'red' })).toBe(true);
    expect(matcher({ color: 'blue' })).toBe(true);
    expect(matcher({ color: 'green' })).toBe(false);
  });

  it('should build a negated filter', () => {
    const filter = metadataQuery().equals('status', 'deleted').not().build();
    const matcher = MetadataFilterCompiler.compile(filter);

    expect(matcher({ status: 'active' })).toBe(true);
    expect(matcher({ status: 'deleted' })).toBe(false);
  });

  it('should throw for dangerous regex patterns', () => {
    expect(() => metadataQuery().regex('name', '(a+)+')).toThrow(
      'Potentially dangerous regex pattern',
    );
  });

  it('should throw for overly long regex patterns', () => {
    expect(() => metadataQuery().regex('name', 'a'.repeat(1001))).toThrow(
      'Regex pattern too long',
    );
  });

  it('should throw for invalid regex flags', () => {
    expect(() => metadataQuery().regex('name', 'foo', 'z')).toThrow(
      'Invalid regex flags',
    );
  });
  describe('ReDoS regression tests', () => {
    // These tests verify that dangerous regex patterns are rejected
    // BEFORE execution, so they cannot hang. Each assertion is a
    // pre-execution rejection, not a timed gate.

    it('rejects nested quantifier pattern (.*)+', () => {
      const matcher = MetadataFilterCompiler.compile({
        name: { $regex: '(.*)+' },
      } as MetadataFilter);
      // safeRegexTest catches the dangerous pattern and returns false
      expect(matcher({ name: 'anything' })).toBe(false);
    });

    it('rejects nested quantifier pattern (.+)+', () => {
      const matcher = MetadataFilterCompiler.compile({
        name: { $regex: '(.+)+' },
      } as MetadataFilter);
      expect(matcher({ name: 'anything' })).toBe(false);
    });

    it('rejects nested quantifier pattern (.*)*', () => {
      const matcher = MetadataFilterCompiler.compile({
        name: { $regex: '(.*)*' },
      } as MetadataFilter);
      expect(matcher({ name: 'anything' })).toBe(false);
    });

    it('rejects nested quantifier pattern (.+)*', () => {
      const matcher = MetadataFilterCompiler.compile({
        name: { $regex: '(.+)*' },
      } as MetadataFilter);
      expect(matcher({ name: 'anything' })).toBe(false);
    });

    it('rejects alternation in quantified group (a|b)+', () => {
      const matcher = MetadataFilterCompiler.compile({
        name: { $regex: '(a|b)+' },
      } as MetadataFilter);
      expect(matcher({ name: 'aababab' })).toBe(false);
    });

    it('rejects alternation in quantified group (a|b)*', () => {
      const matcher = MetadataFilterCompiler.compile({
        name: { $regex: '(a|b)*' },
      } as MetadataFilter);
      expect(matcher({ name: 'aababab' })).toBe(false);
    });

    it('rejects overly complex pattern exceeding complexity threshold', () => {
      // Many quantifiers and groups push complexity score > 20
      const matcher = MetadataFilterCompiler.compile({
        name: { $regex: '(a+)(b+)(c+)(d+)(e+)(f+)' },
      } as MetadataFilter);
      expect(matcher({ name: 'abcdef' })).toBe(false);
    });

    it('rejects regex patterns exceeding 1000 characters', () => {
      const longPattern = 'a'.repeat(1001);
      const matcher = MetadataFilterCompiler.compile({
        name: { $regex: longPattern },
      } as MetadataFilter);
      expect(matcher({ name: 'a' })).toBe(false);
    });

    it('returns false (not hang) when input value exceeds 10,000 characters', () => {
      const matcher = MetadataFilterCompiler.compile({
        name: { $regex: '^test' },
      } as MetadataFilter);
      const longValue = 'x'.repeat(10_001);
      // Must reject before executing the regex, not hang
      expect(matcher({ name: longValue })).toBe(false);
    });

    it('rejects invalid regex flags', () => {
      const matcher = MetadataFilterCompiler.compile({
        name: { $regex: { pattern: '^test', flags: 'z' } } as unknown,
      } as MetadataFilter);
      expect(matcher({ name: 'test' })).toBe(false);
    });

    it('still matches safe patterns after dangerous ones are rejected', () => {
      // Confirm the guard does not break valid patterns
      const safeMatcher = MetadataFilterCompiler.compile({
        name: { $regex: '^safe' },
      } as MetadataFilter);
      expect(safeMatcher({ name: 'safe-value' })).toBe(true);
      expect(safeMatcher({ name: 'unsafe-value' })).toBe(false);
    });

    it('MetadataRangeQuery.regex rejects dangerous pattern before adding to filter', () => {
      const query = new MetadataRangeQuery();
      expect(() => query.regex('field', '(.*)+')).toThrow(
        'Potentially dangerous regex pattern',
      );
    });

    it('MetadataRangeQuery.regex rejects pattern exceeding 1000 characters', () => {
      const query = new MetadataRangeQuery();
      const longPattern = 'a'.repeat(1001);
      expect(() => query.regex('field', longPattern)).toThrow('Regex pattern too long');
    });

    it('MetadataRangeQuery.regex rejects invalid flags', () => {
      const query = new MetadataRangeQuery();
      expect(() => query.regex('field', '^test', 'z')).toThrow('Invalid regex flags');
    });
  });
});
