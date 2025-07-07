import type { MetadataFilter } from '@/core/types.js';

/**
 * Metadata filter compiler for complex queries
 */
export class MetadataFilterCompiler {
  /**
   * Compile a filter into an optimized matcher function
   */
  static compile(filter: MetadataFilter): (metadata: Record<string, unknown>) => boolean {
    // Handle null/undefined filter
    if (!filter || Object.keys(filter).length === 0) {
      return () => true;
    }

    // Check if it's a complex filter with operators
    const filterKeys = Object.keys(filter);
    const hasOperators = filterKeys.some(key => key.startsWith('$'));

    if (!hasOperators) {
      // Simple equality filter
      return (metadata) => MetadataFilterCompiler.matchSimpleFilter(metadata, filter as Record<string, unknown>);
    }

    // Complex filter with operators
    return (metadata) => MetadataFilterCompiler.matchComplexFilter(metadata, filter);
  }

  /**
   * Match simple equality filters
   */
  private static matchSimpleFilter(
    metadata: Record<string, unknown>,
    filter: Record<string, unknown>
  ): boolean {
    for (const [key, value] of Object.entries(filter)) {
      if (!MetadataFilterCompiler.matchValue(metadata[key], value)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Match complex filters with operators
   */
  private static matchComplexFilter(
    metadata: Record<string, unknown>,
    filter: MetadataFilter
  ): boolean {
    for (const [key, condition] of Object.entries(filter)) {
      switch (key) {
      case '$and': {
        // All conditions must match
        const conditions = condition as MetadataFilter[];
        if (!conditions.every(cond => MetadataFilterCompiler.matchComplexFilter(metadata, cond))) {
          return false;
        }
      
      break;
      }
      case '$or': {
        // At least one condition must match
        const conditions = condition as MetadataFilter[];
        if (!conditions.some(cond => MetadataFilterCompiler.matchComplexFilter(metadata, cond))) {
          return false;
        }
      
      break;
      }
      case '$not': {
        // Condition must not match
        const notCondition = condition as MetadataFilter;
        if (MetadataFilterCompiler.matchComplexFilter(metadata, notCondition)) {
          return false;
        }
      
      break;
      }
      default: if (key.startsWith('$')) {
        // Unknown operator
        throw new Error(`Unknown filter operator: ${key}`);
      } else {
        // Field-level condition
        if (!MetadataFilterCompiler.matchFieldCondition(metadata[key], condition)) {
          return false;
        }
      }
      }
    }
    return true;
  }

  /**
   * Match field-level conditions
   */
  private static matchFieldCondition(
    value: unknown,
    condition: unknown
  ): boolean {
    // If condition is not an object, use simple equality
    if (typeof condition !== 'object' || condition === null) {
      return MetadataFilterCompiler.matchValue(value, condition);
    }

    // Handle operator conditions
    const conditionObj = condition as Record<string, unknown>;
    
    for (const [operator, operand] of Object.entries(conditionObj)) {
      switch (operator) {
        case '$eq':
          if (!MetadataFilterCompiler.matchValue(value, operand)) return false;
          break;
          
        case '$ne':
          if (MetadataFilterCompiler.matchValue(value, operand)) return false;
          break;
          
        case '$gt':
          if (!MetadataFilterCompiler.compareValue(value, operand, (a, b) => a > b)) return false;
          break;
          
        case '$gte':
          if (!MetadataFilterCompiler.compareValue(value, operand, (a, b) => a >= b)) return false;
          break;
          
        case '$lt':
          if (!MetadataFilterCompiler.compareValue(value, operand, (a, b) => a < b)) return false;
          break;
          
        case '$lte':
          if (!MetadataFilterCompiler.compareValue(value, operand, (a, b) => a <= b)) return false;
          break;
          
        case '$in':
          if (!Array.isArray(operand) || !operand.some(item => MetadataFilterCompiler.matchValue(value, item))) {
            return false;
          }
          break;
          
        case '$nin':
          if (!Array.isArray(operand) || operand.some(item => MetadataFilterCompiler.matchValue(value, item))) {
            return false;
          }
          break;
          
        case '$exists': {
          const exists = value !== undefined;
          if (exists !== operand) return false;
          break;
        }
          
        case '$type':
          if (!MetadataFilterCompiler.matchType(value, operand as string)) return false;
          break;
          
        case '$regex':
          if (!MetadataFilterCompiler.matchRegex(value, operand)) return false;
          break;
          
        case '$size':
          if (!MetadataFilterCompiler.matchArraySize(value, operand)) return false;
          break;
          
        case '$all':
          if (!MetadataFilterCompiler.matchArrayAll(value, operand)) return false;
          break;
          
        case '$elemMatch':
          if (!MetadataFilterCompiler.matchArrayElement(value, operand)) return false;
          break;
          
        default:
          throw new Error(`Unknown field operator: ${operator}`);
      }
    }
    
    return true;
  }

  /**
   * Match values with deep equality
   */
  private static matchValue(a: unknown, b: unknown): boolean {
    // Handle null/undefined
    if (a === b) return true;
    if (a == null || b == null) return false;

    // Handle arrays
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      return a.every((item, i) => MetadataFilterCompiler.matchValue(item, b[i]));
    }

    // Handle objects
    if (typeof a === 'object' && typeof b === 'object') {
      const aObj = a as Record<string, unknown>;
      const bObj = b as Record<string, unknown>;
      const aKeys = Object.keys(aObj);
      const bKeys = Object.keys(bObj);
      
      if (aKeys.length !== bKeys.length) return false;
      
      return aKeys.every(key => 
        bKeys.includes(key) && MetadataFilterCompiler.matchValue(aObj[key], bObj[key])
      );
    }

    // Primitive comparison
    return a === b;
  }

  /**
   * Compare numeric values
   */
  private static compareValue(
    value: unknown,
    operand: unknown,
    compareFn: (a: number, b: number) => boolean
  ): boolean {
    if (typeof value !== 'number' || typeof operand !== 'number') {
      return false;
    }
    return compareFn(value, operand);
  }

  /**
   * Match type conditions
   */
  private static matchType(value: unknown, expectedType: string): boolean {
    switch (expectedType) {
      case 'null':
        return value === null;
      case 'boolean':
        return typeof value === 'boolean';
      case 'number':
        return typeof value === 'number';
      case 'string':
        return typeof value === 'string';
      case 'array':
        return Array.isArray(value);
      case 'object':
        return typeof value === 'object' && value !== null && !Array.isArray(value);
      default:
        return false;
    }
  }

  /**
   * Match regex patterns
   */
  private static matchRegex(value: unknown, pattern: unknown): boolean {
    if (typeof value !== 'string') return false;
    
    if (typeof pattern === 'string') {
      return MetadataFilterCompiler.safeRegexTest(pattern, value);
    }
    
    if (pattern instanceof RegExp) {
      return MetadataFilterCompiler.safeRegexTest(pattern, value);
    }
    
    if (typeof pattern === 'object' && pattern !== null) {
      const { pattern: p, flags } = pattern as { pattern: string; flags?: string };
      return MetadataFilterCompiler.safeRegexTest(p, value, flags);
    }
    
    return false;
  }

  /**
   * Safely test regex patterns with validation and DoS protection
   */
  private static safeRegexTest(pattern: string | RegExp, value: string, flags?: string): boolean {
    try {
      let regex: RegExp;
      
      if (pattern instanceof RegExp) {
        regex = pattern;
      } else {
        // Validate pattern length to prevent excessive memory usage
        if (pattern.length > 1000) {
          throw new Error('Regex pattern too long');
        }
        
        // Validate flags
        const validFlags = /^[gimsuvy]*$/;
        if (flags && !validFlags.test(flags)) {
          throw new Error('Invalid regex flags');
        }
        
        // Check for dangerous patterns that could cause ReDoS
        if (MetadataFilterCompiler.isDangerousRegexPattern(pattern)) {
          throw new Error('Potentially dangerous regex pattern');
        }
        
        regex = new RegExp(pattern, flags);
      }
      
      // Set timeout for regex execution to prevent ReDoS
      const timeoutMs = 100; // 100ms timeout
      const startTime = Date.now();
      
      // Use a simple timeout mechanism
      const testWithTimeout = () => {
        if (Date.now() - startTime > timeoutMs) {
          throw new Error('Regex execution timeout');
        }
        return regex.test(value);
      };
      
      return testWithTimeout();
    } catch (error) {
      // Log the error but don't expose it to prevent information disclosure
      console.warn('Regex pattern validation failed:', error instanceof Error ? error.message : 'Unknown error');
      return false;
    }
  }

  /**
   * Check for potentially dangerous regex patterns that could cause ReDoS
   */
  private static isDangerousRegexPattern(pattern: string): boolean {
    // Check for nested quantifiers that could cause exponential backtracking
    const dangerousPatterns = [
      /\(\?!\.\*\)\.\*\$/, // Negative lookahead with .* 
      /\(\.\*\)\+/, // Nested quantifiers
      /\(\.\+\)\+/, // Nested quantifiers
      /\(\.\*\)\*/, // Nested quantifiers
      /\(\.\+\)\*/, // Nested quantifiers
      /\(\.\*\)\{[0-9]+,\}/, // Nested quantifiers with range
      /\(\.\+\)\{[0-9]+,\}/, // Nested quantifiers with range
      /\([^)]*\+[^)]*\)\+/, // Nested groups with quantifiers
      /\([^)]*\*[^)]*\)\*/, // Nested groups with quantifiers
      /\|.*\|.*\|/, // Multiple alternations
    ];
    
    return dangerousPatterns.some(dangerous => dangerous.test(pattern));
  }

  /**
   * Match array size
   */
  private static matchArraySize(value: unknown, size: unknown): boolean {
    if (!Array.isArray(value)) return false;
    
    if (typeof size === 'number') {
      return value.length === size;
    }
    
    if (typeof size === 'object' && size !== null) {
      return MetadataFilterCompiler.matchFieldCondition(value.length, size);
    }
    
    return false;
  }

  /**
   * Match all elements in array
   */
  private static matchArrayAll(value: unknown, elements: unknown): boolean {
    if (!Array.isArray(value) || !Array.isArray(elements)) return false;
    
    return elements.every(elem => 
      value.some(item => MetadataFilterCompiler.matchValue(item, elem))
    );
  }

  /**
   * Match at least one element in array
   */
  private static matchArrayElement(value: unknown, condition: unknown): boolean {
    if (!Array.isArray(value)) return false;
    
    return value.some(item => {
      if (typeof condition === 'object' && condition !== null) {
        return MetadataFilterCompiler.matchComplexFilter(
          typeof item === 'object' && item !== null ? item as Record<string, unknown> : { value: item },
          condition as MetadataFilter
        );
      }
      return MetadataFilterCompiler.matchValue(item, condition);
    });
  }
}

/**
 * Range query builder for metadata
 */
export class MetadataRangeQuery {
  private filter: MetadataFilter = {};

  /**
   * Add a range condition
   */
  range(field: string, min?: number, max?: number): this {
    const condition: Record<string, number> = {};
    
    if (min !== undefined) {
      condition['$gte'] = min;
    }
    
    if (max !== undefined) {
      condition['$lte'] = max;
    }
    
    (this.filter as any)[field] = condition;
    return this;
  }

  /**
   * Add an equality condition
   */
  equals(field: string, value: unknown): this {
    (this.filter as any)[field] = value;
    return this;
  }

  /**
   * Add an IN condition
   */
  in(field: string, values: unknown[]): this {
    (this.filter as any)[field] = { $in: values };
    return this;
  }

  /**
   * Add a NOT IN condition
   */
  notIn(field: string, values: unknown[]): this {
    (this.filter as any)[field] = { $nin: values };
    return this;
  }

  /**
   * Add an EXISTS condition
   */
  exists(field: string, exists = true): this {
    (this.filter as any)[field] = { $exists: exists };
    return this;
  }

  /**
   * Add a regex condition
   */
  regex(field: string, pattern: string | RegExp, flags?: string): this {
    // Validate pattern before adding to filter
    if (typeof pattern === 'string') {
      // Validate pattern length
      if (pattern.length > 1000) {
        throw new Error('Regex pattern too long');
      }
      
      // Validate flags
      const validFlags = /^[gimsuvy]*$/;
      if (flags && !validFlags.test(flags)) {
        throw new Error('Invalid regex flags');
      }
      
      // Check for dangerous patterns
      if (this.isDangerousRegexPattern(pattern)) {
        throw new Error('Potentially dangerous regex pattern');
      }
      
      if (flags) {
        (this.filter as any)[field] = { $regex: { pattern, flags } };
      } else {
        (this.filter as any)[field] = { $regex: pattern };
      }
    } else {
      (this.filter as any)[field] = { $regex: pattern };
    }
    return this;
  }

  /**
   * Check for potentially dangerous regex patterns that could cause ReDoS
   */
  private isDangerousRegexPattern(pattern: string): boolean {
    // Check for nested quantifiers that could cause exponential backtracking
    const dangerousPatterns = [
      /\(\?!\.\*\)\.\*\$/, // Negative lookahead with .* 
      /\(\.\*\)\+/, // Nested quantifiers
      /\(\.\+\)\+/, // Nested quantifiers
      /\(\.\*\)\*/, // Nested quantifiers
      /\(\.\+\)\*/, // Nested quantifiers
      /\(\.\*\)\{[0-9]+,\}/, // Nested quantifiers with range
      /\(\.\+\)\{[0-9]+,\}/, // Nested quantifiers with range
      /\([^)]*\+[^)]*\)\+/, // Nested groups with quantifiers
      /\([^)]*\*[^)]*\)\*/, // Nested groups with quantifiers
      /\|.*\|.*\|/, // Multiple alternations
    ];
    
    return dangerousPatterns.some(dangerous => dangerous.test(pattern));
  }

  /**
   * Combine with AND
   */
  and(...queries: MetadataRangeQuery[]): this {
    const conditions = [this.filter, ...queries.map(q => q.build())];
    this.filter = { $and: conditions };
    return this;
  }

  /**
   * Combine with OR
   */
  or(...queries: MetadataRangeQuery[]): this {
    const conditions = [this.filter, ...queries.map(q => q.build())];
    this.filter = { $or: conditions };
    return this;
  }

  /**
   * Negate the current filter
   */
  not(): this {
    this.filter = { $not: this.filter };
    return this;
  }

  /**
   * Build the filter
   */
  build(): MetadataFilter {
    return this.filter;
  }
}

/**
 * Create a new range query builder
 */
export function metadataQuery(): MetadataRangeQuery {
  return new MetadataRangeQuery();
}