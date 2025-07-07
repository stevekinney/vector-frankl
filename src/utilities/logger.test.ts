import { describe, expect, it } from 'bun:test';

import { Logger } from './logger';

describe('Logger', () => {
  it('should create logger instance', () => {
    const testLogger = new Logger();
    expect(testLogger).toBeDefined();
    expect(testLogger.info).toBeDefined();
    expect(testLogger.warn).toBeDefined();
    expect(testLogger.error).toBeDefined();
    expect(testLogger.debug).toBeDefined();
  });

  it('should handle different log contexts', () => {
    const testLogger = new Logger();

    // Just verify methods don't throw
    expect(() => testLogger.info('Test message')).not.toThrow();
    expect(() => testLogger.warn('Test warning')).not.toThrow();
    expect(() => testLogger.error('Test error')).not.toThrow();
    expect(() => testLogger.debug('Test debug')).not.toThrow();

    // Test with context
    expect(() => testLogger.info('Test', { data: 'value' })).not.toThrow();
  });

  it('should handle time methods', () => {
    const testLogger = new Logger();

    expect(() => testLogger.time('test-label')).not.toThrow();
    expect(() => testLogger.timeEnd('test-label')).not.toThrow();
  });

  it('should change log level', () => {
    const testLogger = new Logger();

    expect(() => testLogger.setLevel('ERROR')).not.toThrow();
    expect(() => testLogger.setLevel('WARN')).not.toThrow();
    expect(() => testLogger.setLevel('INFO')).not.toThrow();
    expect(() => testLogger.setLevel('DEBUG')).not.toThrow();
  });
});
