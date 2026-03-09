import { describe, expect, it } from 'bun:test';

import type { MetadataFilter } from '@/core/types.js';
import { MetadataFilterCompiler } from '@/search/metadata-filter.js';

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
});
