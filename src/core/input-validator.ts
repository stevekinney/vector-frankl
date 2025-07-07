/**
 * Input validation utilities for vector database operations
 */

export interface ValidationOptions {
  /** Maximum allowed string length */
  maxStringLength?: number;
  /** Maximum allowed array length */
  maxArrayLength?: number;
  /** Maximum allowed object depth */
  maxObjectDepth?: number;
  /** Maximum allowed number of object properties */
  maxObjectProperties?: number;
  /** Allowed metadata value types */
  allowedTypes?: Set<string>;
}

export class InputValidator {
  private static readonly DEFAULT_OPTIONS: Required<ValidationOptions> = {
    maxStringLength: 10000,
    maxArrayLength: 10000,
    maxObjectDepth: 10,
    maxObjectProperties: 1000,
    allowedTypes: new Set(['string', 'number', 'boolean', 'object'])
  };

  /**
   * Validate vector ID
   */
  static validateVectorId(id: unknown): string {
    if (typeof id !== 'string') {
      throw new Error('Vector ID must be a string');
    }

    if (id.length === 0) {
      throw new Error('Vector ID cannot be empty');
    }

    if (id.length > 255) {
      throw new Error('Vector ID cannot exceed 255 characters');
    }

    // Check for invalid characters that could cause issues
    // eslint-disable-next-line no-control-regex
    const invalidChars = /[<>:"/\\|?*\x00-\x1f]/;
    if (invalidChars.test(id)) {
      throw new Error('Vector ID contains invalid characters');
    }

    return id;
  }

  /**
   * Validate dimension parameter
   */
  static validateDimension(dimension: unknown): number {
    if (typeof dimension !== 'number') {
      throw new Error('Dimension must be a number');
    }

    if (!Number.isInteger(dimension)) {
      throw new Error('Dimension must be an integer');
    }

    if (dimension <= 0) {
      throw new Error('Dimension must be positive');
    }

    if (dimension > 100000) {
      throw new Error('Dimension cannot exceed 100,000');
    }

    return dimension;
  }

  /**
   * Validate search parameter k
   */
  static validateK(k: unknown): number {
    if (typeof k !== 'number') {
      throw new Error('Search parameter k must be a number');
    }

    if (!Number.isInteger(k)) {
      throw new Error('Search parameter k must be an integer');
    }

    if (k <= 0) {
      throw new Error('Search parameter k must be positive');
    }

    if (k > 10000) {
      throw new Error('Search parameter k cannot exceed 10,000');
    }

    return k;
  }

  /**
   * Validate distance parameter
   */
  static validateDistance(distance: unknown): number {
    if (typeof distance !== 'number') {
      throw new Error('Distance must be a number');
    }

    if (!isFinite(distance)) {
      throw new Error('Distance must be finite');
    }

    if (distance < 0) {
      throw new Error('Distance must be non-negative');
    }

    if (distance > 1000) {
      throw new Error('Distance cannot exceed 1000');
    }

    return distance;
  }

  /**
   * Validate metadata object
   */
  static validateMetadata(
    metadata: unknown, 
    options: ValidationOptions = {}
  ): Record<string, unknown> {
    const opts = { ...this.DEFAULT_OPTIONS, ...options };

    if (metadata === null || metadata === undefined) {
      return {};
    }

    if (typeof metadata !== 'object' || Array.isArray(metadata)) {
      throw new Error('Metadata must be an object');
    }

    const validatedMetadata = metadata as Record<string, unknown>;
    
    // Check number of properties
    const propertyCount = Object.keys(validatedMetadata).length;
    if (propertyCount > opts.maxObjectProperties) {
      throw new Error(`Metadata cannot have more than ${opts.maxObjectProperties} properties`);
    }

    // Recursively validate metadata
    this.validateObjectRecursive(validatedMetadata, opts, 0);

    return validatedMetadata;
  }

  /**
   * Validate an array of vector IDs
   */
  static validateVectorIds(ids: unknown): string[] {
    if (!Array.isArray(ids)) {
      throw new Error('Vector IDs must be an array');
    }

    if (ids.length === 0) {
      throw new Error('Vector IDs array cannot be empty');
    }

    if (ids.length > 10000) {
      throw new Error('Cannot process more than 10,000 vector IDs at once');
    }

    const validatedIds: string[] = [];
    const seen = new Set<string>();

    for (let i = 0; i < ids.length; i++) {
      const id = this.validateVectorId(ids[i]);
      
      if (seen.has(id)) {
        throw new Error(`Duplicate vector ID found: ${id}`);
      }
      
      seen.add(id);
      validatedIds.push(id);
    }

    return validatedIds;
  }

  /**
   * Validate batch operations array
   */
  static validateBatchData<T>(
    data: unknown,
    itemValidator: (item: unknown, index: number) => T,
    maxItems: number = 1000
  ): T[] {
    if (!Array.isArray(data)) {
      throw new Error('Batch data must be an array');
    }

    if (data.length === 0) {
      throw new Error('Batch data cannot be empty');
    }

    if (data.length > maxItems) {
      throw new Error(`Batch operation cannot exceed ${maxItems} items`);
    }

    return data.map((item, index) => {
      try {
        return itemValidator(item, index);
      } catch (error) {
        throw new Error(`Invalid item at index ${index}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    });
  }

  /**
   * Validate database name
   */
  static validateDatabaseName(name: unknown): string {
    if (typeof name !== 'string') {
      throw new Error('Database name must be a string');
    }

    if (name.length === 0) {
      throw new Error('Database name cannot be empty');
    }

    if (name.length > 64) {
      throw new Error('Database name cannot exceed 64 characters');
    }

    // Check for valid database name pattern
    const validPattern = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
    if (!validPattern.test(name)) {
      throw new Error('Database name must start with a letter and contain only letters, numbers, underscores, and hyphens');
    }

    return name;
  }

  /**
   * Validate namespace name
   */
  static validateNamespace(namespace: unknown): string {
    if (typeof namespace !== 'string') {
      throw new Error('Namespace must be a string');
    }

    if (namespace.length === 0) {
      throw new Error('Namespace cannot be empty');
    }

    if (namespace.length > 64) {
      throw new Error('Namespace cannot exceed 64 characters');
    }

    // Check for valid namespace pattern
    const validPattern = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
    if (!validPattern.test(namespace)) {
      throw new Error('Namespace must start with a letter and contain only letters, numbers, underscores, and hyphens');
    }

    return namespace;
  }

  /**
   * Recursively validate object structure
   */
  private static validateObjectRecursive(
    obj: Record<string, unknown>,
    options: Required<ValidationOptions>,
    currentDepth: number
  ): void {
    if (currentDepth >= options.maxObjectDepth) {
      throw new Error(`Metadata object depth cannot exceed ${options.maxObjectDepth}`);
    }

    for (const [key, value] of Object.entries(obj)) {
      // Validate key
      if (typeof key !== 'string') {
        throw new Error('Metadata keys must be strings');
      }

      if (key.length > 100) {
        throw new Error('Metadata keys cannot exceed 100 characters');
      }

      // Check for dangerous key patterns
      if (key.startsWith('__') || key.includes('..') || key.includes('/')) {
        throw new Error(`Invalid metadata key: ${key}`);
      }

      // Validate value
      this.validateValue(value, options, currentDepth + 1);
    }
  }

  /**
   * Validate individual value
   */
  private static validateValue(
    value: unknown,
    options: Required<ValidationOptions>,
    currentDepth: number
  ): void {
    if (value === null || value === undefined) {
      return;
    }

    const valueType = typeof value;

    if (!options.allowedTypes.has(valueType)) {
      throw new Error(`Invalid metadata value type: ${valueType}`);
    }

    switch (valueType) {
      case 'string': {
        const strValue = value as string;
        if (strValue.length > options.maxStringLength) {
          throw new Error(`String value cannot exceed ${options.maxStringLength} characters`);
        }
        break;
      }

      case 'number': {
        const numValue = value as number;
        if (!isFinite(numValue)) {
          throw new Error('Number values must be finite');
        }
        break;
      }

      case 'object': {
        if (Array.isArray(value)) {
          const arrValue = value as unknown[];
          if (arrValue.length > options.maxArrayLength) {
            throw new Error(`Array cannot exceed ${options.maxArrayLength} elements`);
          }
          
          for (const item of arrValue) {
            this.validateValue(item, options, currentDepth);
          }
        } else {
          const objValue = value as Record<string, unknown>;
          this.validateObjectRecursive(objValue, options, currentDepth);
        }
        break;
      }
    }
  }

  /**
   * Sanitize string input to prevent injection attacks
   */
  static sanitizeString(input: string): string {
    // Remove null bytes and control characters
    // eslint-disable-next-line no-control-regex
    return input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  }

  /**
   * Validate search options
   */
  static validateSearchOptions(options: unknown): Record<string, unknown> {
    if (options === null || options === undefined) {
      return {};
    }

    if (typeof options !== 'object' || Array.isArray(options)) {
      throw new Error('Search options must be an object');
    }

    const opts = options as Record<string, unknown>;
    const validated: Record<string, unknown> = {};

    // Validate each known option
    for (const [key, value] of Object.entries(opts)) {
      switch (key) {
        case 'filter':
          validated[key] = this.validateMetadata(value);
          break;
        case 'includeMetadata':
        case 'includeVector':
          if (typeof value !== 'boolean') {
            throw new Error(`${key} must be a boolean`);
          }
          validated[key] = value;
          break;
        case 'maxResults':
        case 'batchSize':
          if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
            throw new Error(`${key} must be a positive integer`);
          }
          if (value > 50000) {
            throw new Error(`${key} cannot exceed 50,000`);
          }
          validated[key] = value;
          break;
        default:
          // Allow unknown options but don't validate them
          validated[key] = value;
      }
    }

    return validated;
  }
}