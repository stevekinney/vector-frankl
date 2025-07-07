import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { debugManager } from '../../src/debug/debug-manager.js';
import { profiler } from '../../src/debug/profiler.js';

describe('Profiler', () => {
  beforeEach(() => {
    // Reset profiler state
    profiler.clear();

    // Reset debug manager state completely
    debugManager.disable();
    debugManager.clearEntries();

    // Configure and enable debug manager with profiling
    debugManager.updateConfig({
      enabled: false,
      profile: false,
      traceLevel: 'none',
      memoryTracking: false,
      exportFormat: 'json',
      sampling: { rate: 1, threshold: 0 },
      maxEntries: 10000,
      consoleOutput: true,
    });

    debugManager.enable({ profile: true });
  });

  afterEach(() => {
    profiler.clear();
    debugManager.disable();
    debugManager.clearEntries();
  });

  describe('Basic Profiling', () => {
    it('should start and end profiling', () => {
      const profileId = profiler.startProfile('test-operation', { test: true });
      expect(typeof profileId).toBe('string');

      const activeProfiles = profiler.getActiveProfiles();
      expect(activeProfiles).toHaveLength(1);
      expect(activeProfiles[0]!.operation).toBe('test-operation');

      const entry = profiler.endProfile(profileId);
      expect(entry).toBeTruthy();
      expect(entry!.duration).toBeGreaterThan(0);

      const completedProfiles = profiler.getCompletedProfiles();
      expect(completedProfiles).toHaveLength(1);
    });

    it('should handle non-existent profile IDs', () => {
      const entry = profiler.endProfile('non-existent');
      expect(entry).toBeNull();
    });

    it('should add marks to profiles', async () => {
      const profileId = profiler.startProfile('test-operation');

      profiler.mark(profileId, 'checkpoint-1');
      // Add small delay
      await new Promise((resolve) => setTimeout(resolve, 1));
      profiler.mark(profileId, 'checkpoint-2');

      const entry = profiler.endProfile(profileId);
      expect(entry!.marks.size).toBe(2);
      expect(entry!.marks.has('checkpoint-1')).toBe(true);
      expect(entry!.marks.has('checkpoint-2')).toBe(true);
      expect(entry!.marks.get('checkpoint-2')!).toBeGreaterThan(
        entry!.marks.get('checkpoint-1')!,
      );
    });

    it('should add metrics to profiles', () => {
      const profileId = profiler.startProfile('test-operation');

      profiler.metric(profileId, 'vectors-processed', 100);
      profiler.metric(profileId, 'memory-used', 1024);

      const entry = profiler.endProfile(profileId);
      expect(entry!.metrics.size).toBe(2);
      expect(entry!.metrics.get('vectors-processed')).toBe(100);
      expect(entry!.metrics.get('memory-used')).toBe(1024);
    });

    it('should respect duration threshold', () => {
      debugManager.updateConfig({
        sampling: { rate: 1, threshold: 100 }, // 100ms threshold
      });

      const profileId = profiler.startProfile('fast-operation');
      const entry = profiler.endProfile(profileId); // Should be very fast

      expect(entry).toBeNull(); // Should be filtered out due to threshold
    });
  });

  describe('Function Profiling', () => {
    it('should profile synchronous functions', async () => {
      const result = await profiler.profile('sync-operation', () => {
        return 'test-result';
      });

      expect(result).toBe('test-result');

      const completedProfiles = profiler.getCompletedProfiles();
      expect(completedProfiles).toHaveLength(1);
      expect(completedProfiles[0]!.operation).toBe('sync-operation');
    });

    it('should profile asynchronous functions', async () => {
      const result = await profiler.profile('async-operation', async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return 'async-result';
      });

      expect(result).toBe('async-result');

      const completedProfiles = profiler.getCompletedProfiles();
      expect(completedProfiles).toHaveLength(1);
      expect(completedProfiles[0]!.operation).toBe('async-operation');
      expect(completedProfiles[0]!.duration!).toBeGreaterThanOrEqual(10);
    });

    it('should handle function errors', async () => {
      const testError = new Error('Test error');

      expect(() =>
        profiler.profile('error-operation', () => {
          throw testError;
        }),
      ).toThrow('Test error');

      const completedProfiles = profiler.getCompletedProfiles();
      expect(completedProfiles).toHaveLength(1);
      expect((completedProfiles[0]!.metadata as any)['result'].error).toBe('Test error');
    });
  });

  describe('Nested Profiling', () => {
    it('should support nested profiling', async () => {
      const result = await profiler.profileNested('parent-operation', async (nested) => {
        await nested.profile('child-1', async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          return 'child-1-result';
        });

        await nested.profile('child-2', async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          return 'child-2-result';
        });

        return 'parent-result';
      });

      expect(result).toBe('parent-result');

      const completedProfiles = profiler.getCompletedProfiles();
      expect(completedProfiles.length).toBeGreaterThanOrEqual(1);

      const parentProfile = completedProfiles.find(
        (p) => p.operation === 'parent-operation',
      );
      expect(parentProfile).toBeTruthy();
      expect(parentProfile!.children).toHaveLength(2);
    });
  });

  describe('Performance Statistics', () => {
    beforeEach(async () => {
      // Generate some test data
      for (let i = 0; i < 5; i++) {
        await profiler.profile(`operation-${i % 2}`, async () => {
          await new Promise((resolve) => setTimeout(resolve, 10 + i * 2));
        });
      }
    });

    it('should calculate performance statistics', () => {
      const allStats = profiler.getStats();
      expect(allStats.length).toBeGreaterThan(0);

      const stats = allStats[0]!;
      expect(stats.count).toBeGreaterThan(0);
      expect(stats.avgDuration).toBeGreaterThan(0);
      expect(stats.minDuration).toBeLessThanOrEqual(stats.maxDuration);
      expect(stats.percentiles.p50).toBeGreaterThan(0);
      expect(stats.percentiles.p95).toBeGreaterThanOrEqual(stats.percentiles.p50);
    });

    it('should get stats for specific operation', () => {
      const stats = profiler.getStats('operation-0');
      expect(stats).toHaveLength(1);
      expect(stats[0]!.operation).toBe('operation-0');
    });

    it('should return empty stats for unknown operation', () => {
      const stats = profiler.getStats('unknown-operation');
      expect(stats).toHaveLength(1);
      expect(stats[0]!.count).toBe(0);
    });
  });

  describe('Profile Filtering', () => {
    beforeEach(async () => {
      await profiler.profile('fast-operation', async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
      });

      await profiler.profile('slow-operation', async () => {
        await new Promise((resolve) => setTimeout(resolve, 25));
      });

      await profiler.profile('medium-operation', async () => {
        await new Promise((resolve) => setTimeout(resolve, 15));
      });
    });

    it('should filter by operation name', () => {
      const profiles = profiler.getCompletedProfiles({ operation: 'fast' });
      expect(profiles).toHaveLength(1);
      expect(profiles[0]!.operation).toBe('fast-operation');
    });

    it('should filter by minimum duration', () => {
      const profiles = profiler.getCompletedProfiles({ minDuration: 20 });
      expect(profiles.length).toBeGreaterThan(0);
      profiles.forEach((p) => {
        expect(p.duration!).toBeGreaterThanOrEqual(20);
      });
    });

    it('should filter by maximum duration', () => {
      const profiles = profiler.getCompletedProfiles({ maxDuration: 10 });
      expect(profiles.length).toBeGreaterThan(0);
      profiles.forEach((p) => {
        expect(p.duration!).toBeLessThanOrEqual(10);
      });
    });
  });

  describe('Cleanup', () => {
    it('should clear all profiling data', async () => {
      await profiler.profile('test-operation', () => 'result');

      expect(profiler.getCompletedProfiles()).toHaveLength(1);
      expect(profiler.getStats()).toHaveLength(1);

      profiler.clear();

      expect(profiler.getCompletedProfiles()).toHaveLength(0);
      expect(profiler.getStats()).toHaveLength(0);
    });

    it('should handle clearing active profiles', () => {
      const profileId = profiler.startProfile('active-operation');
      expect(profiler.getActiveProfiles()).toHaveLength(1);

      profiler.clear();

      expect(profiler.getActiveProfiles()).toHaveLength(0);
      expect(profiler.endProfile(profileId)).toBeNull();
    });
  });
});
