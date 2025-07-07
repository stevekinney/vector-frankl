import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { debugManager } from '@/debug/debug-manager.js';
import type { DebugConfig } from '@/debug/types.js';

describe('DebugManager', () => {
  beforeEach(() => {
    // Completely reset the debug manager state
    debugManager.disable();
    debugManager.clearEntries();
    // Reset configuration to defaults
    debugManager.updateConfig({
      enabled: false,
      profile: false,
      traceLevel: 'none',
      memoryTracking: false,
      exportFormat: 'json',
      sampling: { rate: 1, threshold: 0 },
      maxEntries: 10000,
      consoleOutput: true
    });
  });

  afterEach(() => {
    debugManager.disable();
    debugManager.clearEntries();
  });

  describe('Configuration', () => {
    it('should have default configuration', () => {
      const config = debugManager.getConfig();
      
      expect(config.enabled).toBe(false);
      expect(config.profile).toBe(false);
      expect(config.traceLevel).toBe('none');
      expect(config.memoryTracking).toBe(false);
      expect(config.exportFormat).toBe('json');
      expect(config.maxEntries).toBe(10000);
      expect(config.consoleOutput).toBe(true);
    });

    it('should update configuration', () => {
      const updates: Partial<DebugConfig> = {
        profile: true,
        traceLevel: 'verbose',
        memoryTracking: true
      };

      debugManager.updateConfig(updates);
      const config = debugManager.getConfig();

      expect(config.profile).toBe(true);
      expect(config.traceLevel).toBe('verbose');
      expect(config.memoryTracking).toBe(true);
    });

    it('should enable and disable debug mode', () => {
      expect(debugManager.isEnabled()).toBe(false);

      debugManager.enable();
      expect(debugManager.isEnabled()).toBe(true);

      debugManager.disable();
      expect(debugManager.isEnabled()).toBe(false);
    });

    it('should enable with custom config', () => {
      debugManager.enable({
        profile: true,
        traceLevel: 'detailed'
      });

      const config = debugManager.getConfig();
      expect(config.enabled).toBe(true);
      expect(config.profile).toBe(true);
      expect(config.traceLevel).toBe('detailed');
    });
  });

  describe('Debug Entries', () => {
    beforeEach(() => {
      debugManager.enable();
    });

    it('should add debug entries when enabled', () => {
      debugManager.addEntry({
        type: 'info',
        operation: 'test-operation',
        level: 'basic',
        data: { test: true }
      });

      const entries = debugManager.getEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0]!.operation).toBe('test-operation');
      expect(entries[0]!.type).toBe('info');
      expect(entries[0]!.data['test']).toBe(true);
    });

    it('should not add entries when disabled', () => {
      debugManager.disable();

      debugManager.addEntry({
        type: 'info',
        operation: 'test-operation',
        level: 'basic',
        data: { test: true }
      });

      const entries = debugManager.getEntries();
      expect(entries).toHaveLength(0);
    });

    it('should filter entries by trace level', () => {
      debugManager.updateConfig({ traceLevel: 'basic' });

      // Should be added (basic level)
      debugManager.addEntry({
        type: 'info',
        operation: 'basic-op',
        level: 'basic',
        data: {}
      });

      // Should not be added (detailed level > basic)
      debugManager.addEntry({
        type: 'info',
        operation: 'detailed-op',
        level: 'detailed',
        data: {}
      });

      const entries = debugManager.getEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0]!.operation).toBe('basic-op');
    });

    it('should respect sampling rate', () => {
      debugManager.updateConfig({ 
        sampling: { rate: 10, threshold: 0 } 
      });

      // Add many entries - only some should be kept due to sampling
      for (let i = 0; i < 100; i++) {
        debugManager.addEntry({
          type: 'info',
          operation: `test-${i}`,
          level: 'basic',
          data: {}
        });
      }

      const entries = debugManager.getEntries();
      expect(entries.length).toBeLessThan(50); // Should be sampled down
    });

    it('should maintain max entries limit', () => {
      debugManager.updateConfig({ maxEntries: 5 });

      // Add more entries than the limit
      for (let i = 0; i < 10; i++) {
        debugManager.addEntry({
          type: 'info',
          operation: `test-${i}`,
          level: 'basic',
          data: {}
        });
      }

      const entries = debugManager.getEntries();
      expect(entries.length).toBeLessThanOrEqual(5);
    });

    it('should filter entries', () => {
      debugManager.addEntry({
        type: 'info',
        operation: 'search-vectors',
        level: 'basic',
        data: {}
      });

      debugManager.addEntry({
        type: 'error',
        operation: 'add-vector',
        level: 'basic',
        data: {}
      });

      debugManager.addEntry({
        type: 'profile',
        operation: 'search-vectors',
        level: 'basic',
        data: {}
      });

      // Filter by type
      const infoEntries = debugManager.getEntries({ type: 'info' });
      expect(infoEntries).toHaveLength(1);
      expect(infoEntries[0]!.type).toBe('info');

      // Filter by operation
      const searchEntries = debugManager.getEntries({ operation: 'search' });
      expect(searchEntries).toHaveLength(2);

      // Filter by type and operation
      const searchInfoEntries = debugManager.getEntries({ 
        type: 'info', 
        operation: 'search' 
      });
      expect(searchInfoEntries).toHaveLength(1);
    });

    it('should clear entries', () => {
      debugManager.addEntry({
        type: 'info',
        operation: 'test',
        level: 'basic',
        data: {}
      });

      expect(debugManager.getEntries()).toHaveLength(1);

      debugManager.clearEntries();
      expect(debugManager.getEntries()).toHaveLength(0);
    });
  });

  describe('Memory Usage', () => {
    it('should get memory usage if available', () => {
      const memory = debugManager.getMemoryUsage();
      
      // Memory might not be available in test environment
      if (memory) {
        expect(typeof memory.heapUsed).toBe('number');
        expect(typeof memory.heapTotal).toBe('number');
        expect(typeof memory.external).toBe('number');
        expect(typeof memory.arrayBuffers).toBe('number');
      }
    });
  });

  describe('Export', () => {
    beforeEach(() => {
      debugManager.enable();
      
      // Add some test data
      debugManager.addEntry({
        type: 'info',
        operation: 'test-operation',
        level: 'basic',
        data: { test: 'data' }
      });

      debugManager.addEntry({
        type: 'profile',
        operation: 'vector-search',
        level: 'basic',
        data: { vectors: 100 },
        duration: 25.5
      });
    });

    it('should export as JSON', async () => {
      const exported = await debugManager.exportData('json');
      const data = JSON.parse(exported);
      
      expect(Array.isArray(data)).toBe(true);
      expect(data).toHaveLength(2);
      expect(data[0].operation).toBe('test-operation');
      expect(data[1].operation).toBe('vector-search');
    });

    it('should export as CSV', async () => {
      const exported = await debugManager.exportData('csv');
      
      expect(typeof exported).toBe('string');
      expect(exported).toContain('id,timestamp,type,operation');
      expect(exported).toContain('test-operation');
      expect(exported).toContain('vector-search');
    });

    it('should export as DevTools format', async () => {
      const exported = await debugManager.exportData('devtools');
      const data = JSON.parse(exported);
      
      expect(data.traceEvents).toBeDefined();
      expect(Array.isArray(data.traceEvents)).toBe(true);
      expect(data.displayTimeUnit).toBe('ms');
    });

    it('should export as HTML', async () => {
      const exported = await debugManager.exportData('html');
      
      expect(typeof exported).toBe('string');
      expect(exported).toContain('<!DOCTYPE html>');
      expect(exported).toContain('Vector Frankl Debug Report');
      expect(exported).toContain('test-operation');
    });
  });
});