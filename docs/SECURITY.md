# Security Guide

Vector Frankl has been designed with security as a core principle. This document outlines the security features, best practices, and implementation details to help you use the library safely.

## Table of Contents

- [Security Features](#security-features)
- [Input Validation](#input-validation)
- [ReDoS Protection](#redos-protection)
- [Memory Safety](#memory-safety)
- [WASM Security](#wasm-security)
- [Error Handling](#error-handling)
- [Best Practices](#best-practices)
- [Security Checklist](#security-checklist)
- [Reporting Security Issues](#reporting-security-issues)

## Security Features

### 1. Comprehensive Input Validation

All user inputs are validated through the `InputValidator` class before processing:

```typescript
// Vector ID validation
const validId = InputValidator.validateVectorId(untrustedId);

// Dimension validation
const validDim = InputValidator.validateDimension(untrustedDimension);

// Metadata validation
const validMetadata = InputValidator.validateMetadata(untrustedMetadata);
```

### 2. ReDoS (Regular Expression Denial of Service) Protection

All regex operations are protected against ReDoS attacks:

```typescript
// Safe regex execution with timeout
const result = MetadataFilter.safeRegexTest(pattern, value);

// Dangerous patterns are detected and rejected
const dangerous = [
  /(a+)+b/, // Exponential backtracking
  /(\w+\s*)+$/, // Catastrophic backtracking
  /(x+x+)+y/, // Nested quantifiers
];
```

### 3. Memory Limits

Strict limits prevent memory exhaustion attacks:

```typescript
// Maximum vector dimensions
const MAX_VECTOR_DIMENSION = 100000; // 100k dimensions

// Maximum memory per vector
const MAX_MEMORY_PER_VECTOR = 512 * 1024 * 1024; // 512MB

// Automatic validation
if (vector.length > MAX_VECTOR_DIMENSION) {
  throw new VectorDBError('DIMENSION_LIMIT_EXCEEDED');
}
```

### 4. WASM Module Validation

All WebAssembly modules are validated before execution:

```typescript
// WASM integrity checks
- Magic number validation (0x00, 0x61, 0x73, 0x6D)
- Version validation (must be 0x01)
- Size limits (max 10MB)
- Suspicious pattern detection
- Import/export validation
```

### 5. Secure Error Messages

Sensitive information is automatically sanitized from error contexts:

```typescript
// Sensitive keys are redacted
const sanitized = {
  password: '[REDACTED]',
  apiKey: '[REDACTED]',
  secret: '[REDACTED]',
  token: '[REDACTED]',
  auth: '[REDACTED]',
};

// Long strings are truncated
const truncated = longString.substring(0, 1000) + '... (truncated)';
```

## Input Validation

### Vector ID Validation

```typescript
// Requirements:
// - Must be a non-empty string
// - Maximum 256 characters
// - No null bytes or control characters
// - Valid UTF-8

const validateVectorId = (id: unknown): string => {
  if (typeof id !== 'string' || id.length === 0) {
    throw new VectorDBError('INVALID_VECTOR_ID');
  }

  if (id.length > 256) {
    throw new VectorDBError('VECTOR_ID_TOO_LONG');
  }

  if (/[\x00-\x1F\x7F]/.test(id)) {
    throw new VectorDBError('INVALID_VECTOR_ID_CHARACTERS');
  }

  return id;
};
```

### Dimension Validation

```typescript
// Requirements:
// - Must be a positive integer
// - Between 1 and MAX_VECTOR_DIMENSION
// - Consistent across all vectors

const validateDimension = (dimension: unknown): number => {
  const dim = Number(dimension);

  if (!Number.isInteger(dim) || dim < 1) {
    throw new VectorDBError('INVALID_DIMENSION');
  }

  if (dim > MAX_VECTOR_DIMENSION) {
    throw new VectorDBError('DIMENSION_LIMIT_EXCEEDED');
  }

  return dim;
};
```

### Metadata Validation

```typescript
// Requirements:
// - Must be a plain object
// - No prototype pollution
// - Reasonable size limits
// - Safe key names

const validateMetadata = (metadata: unknown): Record<string, unknown> => {
  if (!isPlainObject(metadata)) {
    throw new VectorDBError('INVALID_METADATA');
  }

  // Prevent prototype pollution
  const clean = Object.create(null);

  for (const [key, value] of Object.entries(metadata)) {
    if (FORBIDDEN_KEYS.includes(key)) {
      throw new VectorDBError('FORBIDDEN_METADATA_KEY');
    }
    clean[key] = sanitizeValue(value);
  }

  return clean;
};
```

## ReDoS Protection

### Implementation Details

The `MetadataFilter` class implements comprehensive ReDoS protection:

```typescript
class MetadataFilter {
  private static readonly REGEX_TIMEOUT_MS = 100;
  private static readonly MAX_PATTERN_LENGTH = 1000;

  private static readonly DANGEROUS_PATTERNS = [
    /(\w+\s*)+$/, // Catastrophic backtracking
    /(a+)+b/, // Exponential backtracking
    /(x+x+)+y/, // Nested quantifiers
    /(\d+)+\w/, // Multiple quantifiers
    /(.*)*x/, // Nested wildcards
  ];

  private static isDangerousRegex(pattern: string): boolean {
    // Check for dangerous constructs
    const dangerous = [
      /\(\.\*\)\*/, // Nested wildcards
      /\([^)]*\+\)[+*]/, // Nested quantifiers
      /\([^)]*\*\)[+*]/, // Multiple quantifiers
      /\(\w\+\\s\*\)\+/, // Catastrophic patterns
    ];

    return dangerous.some((d) => d.test(pattern));
  }

  static safeRegexTest(pattern: string | RegExp, value: string, flags?: string): boolean {
    // Validate inputs
    if (value.length > 10000) {
      throw new VectorDBError('REGEX_VALUE_TOO_LONG');
    }

    // Check pattern safety
    const patternStr = pattern instanceof RegExp ? pattern.source : pattern;
    if (this.isDangerousRegex(patternStr)) {
      throw new VectorDBError('DANGEROUS_REGEX_PATTERN');
    }

    // Execute with timeout
    const start = Date.now();
    try {
      const regex = pattern instanceof RegExp ? pattern : new RegExp(pattern, flags);
      const result = regex.test(value);

      // Check execution time
      if (Date.now() - start > this.REGEX_TIMEOUT_MS) {
        throw new VectorDBError('REGEX_TIMEOUT');
      }

      return result;
    } catch (error) {
      if (error instanceof VectorDBError) throw error;
      throw new VectorDBError('REGEX_EXECUTION_ERROR');
    }
  }
}
```

### Safe Regex Examples

```typescript
// Safe patterns
/^user_\d+$/         // Simple anchored pattern
/category:\w+/       // Simple word matching
/\.json$/i           // File extension check

// Unsafe patterns (will be rejected)
/(a+)+b/             // Exponential backtracking
/(\w+\s*)+$/         // Catastrophic backtracking
/(.*)*anything/      // Nested wildcards
```

## Memory Safety

### Vector Size Limits

```typescript
// Constants
const MAX_VECTOR_DIMENSION = 100000; // 100k dimensions
const MAX_MEMORY_PER_VECTOR = 512 * 1024 * 1024; // 512MB
const MAX_TOTAL_MEMORY = 2 * 1024 * 1024 * 1024; // 2GB

// Validation
function validateVectorMemory(vector: VectorInput): void {
  const bytes = vector.length * vector.BYTES_PER_ELEMENT;

  if (bytes > MAX_MEMORY_PER_VECTOR) {
    throw new VectorDBError('VECTOR_MEMORY_LIMIT_EXCEEDED', {
      required: bytes,
      limit: MAX_MEMORY_PER_VECTOR,
    });
  }
}
```

### Batch Size Limits

```typescript
// Adaptive batch sizing
class BatchOptimizer {
  private maxMemoryUsage = 100 * 1024 * 1024; // 100MB

  determineBatchSize(vectorDimension: number): number {
    const bytesPerVector = vectorDimension * 4; // Float32
    const overhead = 200; // Metadata estimate

    return Math.floor(this.maxMemoryUsage / (bytesPerVector + overhead));
  }
}
```

### Memory Monitoring

```typescript
// Track memory usage
class MemoryMonitor {
  async checkMemory(): Promise<MemoryStatus> {
    if ('memory' in performance) {
      const usage = (performance as any).memory;
      return {
        usedJSHeapSize: usage.usedJSHeapSize,
        totalJSHeapSize: usage.totalJSHeapSize,
        jsHeapSizeLimit: usage.jsHeapSizeLimit,
      };
    }

    // Fallback estimation
    return this.estimateMemory();
  }
}
```

## WASM Security

### Module Validation

```typescript
class WASMValidator {
  private static readonly MAX_WASM_SIZE = 10 * 1024 * 1024; // 10MB

  async validateModule(wasmCode: Uint8Array): Promise<void> {
    // Check size
    if (wasmCode.length > this.MAX_WASM_SIZE) {
      throw new VectorDBError('WASM_TOO_LARGE');
    }

    // Validate magic number
    if (!this.hasValidMagicNumber(wasmCode)) {
      throw new VectorDBError('INVALID_WASM_MAGIC');
    }

    // Validate version
    if (!this.hasValidVersion(wasmCode)) {
      throw new VectorDBError('INVALID_WASM_VERSION');
    }

    // Check for suspicious patterns
    if (this.hasSuspiciousPatterns(wasmCode)) {
      throw new VectorDBError('SUSPICIOUS_WASM_CONTENT');
    }
  }

  private hasValidMagicNumber(code: Uint8Array): boolean {
    return code[0] === 0x00 && code[1] === 0x61 && code[2] === 0x73 && code[3] === 0x6d;
  }

  private hasValidVersion(code: Uint8Array): boolean {
    return code[4] === 0x01 && code[5] === 0x00 && code[6] === 0x00 && code[7] === 0x00;
  }
}
```

### Safe WASM Loading

```typescript
// Load WASM with validation
async function loadWASMModule(url: string): Promise<WebAssembly.Module> {
  const response = await fetch(url);
  const buffer = await response.arrayBuffer();
  const code = new Uint8Array(buffer);

  // Validate before compilation
  await WASMValidator.validateModule(code);

  // Compile with safety limits
  return WebAssembly.compile(buffer);
}
```

## Error Handling

### Secure Error Context

```typescript
class VectorDBError extends Error {
  constructor(code: string, message?: string, context?: Record<string, unknown>) {
    super(message || code);
    this.code = code;

    // Sanitize context
    this.context = context ? this.sanitizeContext(context) : undefined;
  }

  private sanitizeContext(ctx: Record<string, unknown>): Record<string, unknown> {
    const sanitized: Record<string, unknown> = {};
    const sensitiveKeys = ['password', 'token', 'secret', 'key', 'auth'];

    for (const [key, value] of Object.entries(ctx)) {
      // Redact sensitive keys
      if (sensitiveKeys.some((k) => key.toLowerCase().includes(k))) {
        sanitized[key] = '[REDACTED]';
        continue;
      }

      // Truncate long strings
      if (typeof value === 'string' && value.length > 1000) {
        sanitized[key] = value.substring(0, 1000) + '... (truncated)';
        continue;
      }

      sanitized[key] = value;
    }

    return sanitized;
  }
}
```

### Error Codes

```typescript
// Security-related error codes
const ERROR_CODES = {
  // Input validation
  INVALID_VECTOR_ID: 'Invalid vector ID format',
  INVALID_DIMENSION: 'Invalid vector dimension',
  INVALID_METADATA: 'Invalid metadata format',

  // Size limits
  DIMENSION_LIMIT_EXCEEDED: 'Vector dimension exceeds maximum',
  MEMORY_LIMIT_EXCEEDED: 'Operation exceeds memory limit',
  VECTOR_TOO_LARGE: 'Vector size exceeds maximum',

  // Regex safety
  DANGEROUS_REGEX_PATTERN: 'Potentially dangerous regex pattern',
  REGEX_TIMEOUT: 'Regex execution timeout',
  REGEX_VALUE_TOO_LONG: 'Value too long for regex matching',

  // WASM security
  WASM_TOO_LARGE: 'WASM module too large',
  INVALID_WASM_MAGIC: 'Invalid WASM magic number',
  SUSPICIOUS_WASM_CONTENT: 'WASM contains suspicious patterns',

  // General security
  FORBIDDEN_OPERATION: 'Operation not permitted',
  QUOTA_EXCEEDED: 'Storage quota exceeded',
};
```

## Best Practices

### 1. Always Validate Inputs

```typescript
// ❌ Bad: Direct usage
await db.addVector(userInput.id, userInput.vector);

// ✅ Good: Validated inputs
const validId = InputValidator.validateVectorId(userInput.id);
const validVector = InputValidator.validateVector(userInput.vector);
await db.addVector(validId, validVector);
```

### 2. Use Safe Regex Patterns

```typescript
// ❌ Bad: Dangerous pattern
const results = await db.search(query, 10, {
  filter: { name: { $regex: /(a+)+b/ } },
});

// ✅ Good: Safe pattern
const results = await db.search(query, 10, {
  filter: { name: { $regex: /^user_\w+$/ } },
});
```

### 3. Monitor Resource Usage

```typescript
// Set up monitoring
const storage = new StorageManager(db);

storage.on('quota-warning', (status) => {
  console.warn('Approaching storage quota:', status);
});

// Check before large operations
const quotaStatus = await storage.checkQuota();
if (quotaStatus.percentUsed > 80) {
  await storage.runEviction();
}
```

### 4. Handle Errors Securely

```typescript
try {
  await db.addVector(id, vector, metadata);
} catch (error) {
  if (error instanceof VectorDBError) {
    // Log sanitized error
    logger.error({
      code: error.code,
      message: error.message,
      // Context is already sanitized
      context: error.context,
    });

    // Return generic error to user
    return { error: 'Operation failed' };
  }
}
```

### 5. Implement Rate Limiting

```typescript
// Example rate limiter
class RateLimiter {
  private requests = new Map<string, number[]>();
  private maxRequests = 100;
  private windowMs = 60000; // 1 minute

  async checkLimit(clientId: string): Promise<boolean> {
    const now = Date.now();
    const requests = this.requests.get(clientId) || [];

    // Remove old requests
    const recent = requests.filter((t) => now - t < this.windowMs);

    if (recent.length >= this.maxRequests) {
      throw new VectorDBError('RATE_LIMIT_EXCEEDED');
    }

    recent.push(now);
    this.requests.set(clientId, recent);
    return true;
  }
}
```

## Security Checklist

### Pre-deployment Checklist

- [ ] All inputs validated using `InputValidator`
- [ ] Regex patterns tested for ReDoS vulnerabilities
- [ ] Memory limits configured appropriately
- [ ] WASM modules validated before loading
- [ ] Error messages don't leak sensitive information
- [ ] Storage quotas monitored
- [ ] Rate limiting implemented
- [ ] Security headers configured (for web deployment)

### Regular Security Tasks

- [ ] Review and update validation rules
- [ ] Test with malformed inputs
- [ ] Monitor for unusual patterns
- [ ] Update dependencies regularly
- [ ] Run security scanning tools
- [ ] Review error logs for sensitive data
- [ ] Test resource exhaustion scenarios
- [ ] Validate WASM module sources

### Security Configuration

```typescript
// Recommended security configuration
const securityConfig = {
  validation: {
    maxVectorDimension: 50000, // Lower than default
    maxMemoryPerVector: 256 * 1024 * 1024, // 256MB
    maxVectorIdLength: 128,
    maxMetadataSize: 10 * 1024, // 10KB
  },
  regex: {
    maxPatternLength: 500,
    timeoutMs: 50,
    maxValueLength: 5000,
  },
  wasm: {
    maxModuleSize: 5 * 1024 * 1024, // 5MB
    allowedSources: ['https://trusted-cdn.com'],
  },
  storage: {
    quotaSafetyMargin: 0.2, // 20% buffer
    evictionPolicy: 'lru',
    maxNamespaces: 100,
  },
  rateLimit: {
    windowMs: 60000,
    maxRequests: 100,
  },
};
```

## Reporting Security Issues

If you discover a security vulnerability in Vector Frankl, please report it responsibly:

1. **Do not** open a public issue
2. Email security concerns to: security@vector-frankl.dev
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

We aim to respond to security reports within 48 hours and will work with you to understand and address the issue promptly.

## Security Updates

Stay informed about security updates:

- Watch the [GitHub repository](https://github.com/stevekinney/vector-frankl) for security advisories
- Subscribe to security announcements
- Keep dependencies up to date
- Review the CHANGELOG for security-related updates

## Additional Resources

- [OWASP Secure Coding Practices](https://owasp.org/www-project-secure-coding-practices-quick-reference-guide/)
- [ReDoS Prevention](https://owasp.org/www-community/attacks/Regular_expression_Denial_of_Service_-_ReDoS)
- [WebAssembly Security](https://webassembly.org/docs/security/)
- [IndexedDB Security Best Practices](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Security)
