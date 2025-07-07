import { describe, expect, it } from 'bun:test';

import { ERROR_CODES } from '../configuration/constants';
import {
  BaseError,
  InternalError,
  NotFoundError,
  RateLimitError,
  TimeoutError,
  ValidationError,
} from './custom-errors';

describe('Custom Errors', () => {
  describe('BaseError', () => {
    it('should create error with correct properties', () => {
      const error = new BaseError('Test error', 'TEST_ERROR', 500);

      expect(error.message).toBe('Test error');
      expect(error.code).toBe('TEST_ERROR');
      expect(error.statusCode).toBe(500);
      expect(error.isOperational).toBe(true);
      expect(error.timestamp).toBeInstanceOf(Date);
      expect(error.name).toBe('BaseError');
    });
  });

  describe('ValidationError', () => {
    it('should create validation error', () => {
      const error = new ValidationError('Invalid input');

      expect(error.code).toBe(ERROR_CODES.VALIDATION_ERROR);
      expect(error.statusCode).toBe(400);
      expect(error.message).toBe('Invalid input');
    });

    it('should include field errors', () => {
      const fields = { email: ['Invalid format'], password: ['Too short'] };
      const error = new ValidationError('Validation failed', fields);

      expect(error.fields).toEqual(fields);
    });
  });

  describe('NotFoundError', () => {
    it('should create not found error without identifier', () => {
      const error = new NotFoundError('User');

      expect(error.message).toBe('User not found');
      expect(error.code).toBe(ERROR_CODES.NOT_FOUND);
      expect(error.statusCode).toBe(404);
    });

    it('should create not found error with identifier', () => {
      const error = new NotFoundError('User', '123');

      expect(error.message).toBe('User with identifier "123" not found');
    });
  });

  describe('TimeoutError', () => {
    it('should create timeout error', () => {
      const error = new TimeoutError('database query', 5000);

      expect(error.message).toBe('Operation "database query" timed out after 5000ms');
      expect(error.code).toBe(ERROR_CODES.TIMEOUT);
      expect(error.statusCode).toBe(408);
    });
  });

  describe('RateLimitError', () => {
    it('should create rate limit error without retry after', () => {
      const error = new RateLimitError();

      expect(error.message).toBe('Rate limit exceeded');
      expect(error.code).toBe(ERROR_CODES.RATE_LIMIT);
      expect(error.statusCode).toBe(429);
    });

    it('should create rate limit error with retry after', () => {
      const error = new RateLimitError(60);

      expect(error.message).toBe('Rate limit exceeded. Retry after 60 seconds');
      expect(error.retryAfter).toBe(60);
    });
  });

  describe('InternalError', () => {
    it('should create internal error', () => {
      const cause = new Error('Database connection failed');
      const error = new InternalError('Database error', cause);

      expect(error.message).toBe('Database error');
      expect(error.cause).toBe(cause);
      expect(error.isOperational).toBe(false);
      expect(error.statusCode).toBe(500);
    });
  });
});
