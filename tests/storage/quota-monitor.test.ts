import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { StorageQuotaMonitor } from '@/storage/quota-monitor.js';
import type { QuotaWarning } from '@/storage/quota-monitor.js';

/**
 * Reset the singleton instance so each test group starts fresh.
 */
function resetSingleton(): void {
	(StorageQuotaMonitor as any)['instance'] = null;
}

/**
 * Access the private usageHistory array on a monitor instance.
 */
function getUsageHistory(
	monitor: StorageQuotaMonitor,
): Array<{ timestamp: number; usage: number }> {
	return (monitor as any)['usageHistory'] as Array<{ timestamp: number; usage: number }>;
}

describe('StorageQuotaMonitor', () => {
	beforeEach(() => {
		resetSingleton();
	});

	afterEach(() => {
		resetSingleton();
	});

	describe('Singleton behavior', () => {
		test('getInstance returns the same instance on subsequent calls', () => {
			const first = StorageQuotaMonitor.getInstance();
			const second = StorageQuotaMonitor.getInstance();

			expect(first).toBe(second);
		});

		test('getInstance returns a new instance after singleton reset', () => {
			const first = StorageQuotaMonitor.getInstance();
			resetSingleton();
			const second = StorageQuotaMonitor.getInstance();

			expect(first).not.toBe(second);
		});

		test('options are only applied on first instantiation', () => {
			const first = StorageQuotaMonitor.getInstance({ safetyMargin: 0.25 });
			const second = StorageQuotaMonitor.getInstance({ safetyMargin: 0.5 });

			expect(first).toBe(second);
			// The safety margin should be 0.25 from the first call, not 0.5
			expect((first as any)['safetyMargin']).toBe(0.25);
		});
	});

	describe('Listener management', () => {
		test('addListener registers a callback', () => {
			const monitor = StorageQuotaMonitor.getInstance();
			const listener = (_warning: QuotaWarning) => {};

			monitor.addListener(listener);

			const listeners = (monitor as any)['listeners'] as Set<(warning: QuotaWarning) => void>;
			expect(listeners.size).toBe(1);
			expect(listeners.has(listener)).toBe(true);
		});

		test('removeListener removes a previously registered callback', () => {
			const monitor = StorageQuotaMonitor.getInstance();
			const listener = (_warning: QuotaWarning) => {};

			monitor.addListener(listener);
			monitor.removeListener(listener);

			const listeners = (monitor as any)['listeners'] as Set<(warning: QuotaWarning) => void>;
			expect(listeners.size).toBe(0);
		});

		test('removeListener is a no-op for an unregistered callback', () => {
			const monitor = StorageQuotaMonitor.getInstance();
			const registeredListener = (_warning: QuotaWarning) => {};
			const unregisteredListener = (_warning: QuotaWarning) => {};

			monitor.addListener(registeredListener);
			monitor.removeListener(unregisteredListener);

			const listeners = (monitor as any)['listeners'] as Set<(warning: QuotaWarning) => void>;
			expect(listeners.size).toBe(1);
			expect(listeners.has(registeredListener)).toBe(true);
		});

		test('the same listener is not added twice', () => {
			const monitor = StorageQuotaMonitor.getInstance();
			const listener = (_warning: QuotaWarning) => {};

			monitor.addListener(listener);
			monitor.addListener(listener);

			const listeners = (monitor as any)['listeners'] as Set<(warning: QuotaWarning) => void>;
			expect(listeners.size).toBe(1);
		});

		test('multiple distinct listeners can be registered', () => {
			const monitor = StorageQuotaMonitor.getInstance();
			const listenerA = (_warning: QuotaWarning) => {};
			const listenerB = (_warning: QuotaWarning) => {};
			const listenerC = (_warning: QuotaWarning) => {};

			monitor.addListener(listenerA);
			monitor.addListener(listenerB);
			monitor.addListener(listenerC);

			const listeners = (monitor as any)['listeners'] as Set<(warning: QuotaWarning) => void>;
			expect(listeners.size).toBe(3);
		});
	});

	describe('checkQuota without navigator.storage', () => {
		let originalStorage: StorageManager | undefined;

		beforeEach(() => {
			originalStorage = navigator.storage;
			Object.defineProperty(navigator, 'storage', { value: undefined, configurable: true });
		});

		afterEach(() => {
			Object.defineProperty(navigator, 'storage', { value: originalStorage, configurable: true });
		});

		test('returns null when navigator.storage is not available', async () => {
			const monitor = StorageQuotaMonitor.getInstance();
			const result = await monitor.checkQuota(true);

			expect(result).toBeNull();
		});

		test('getCurrentQuota returns null when no successful check has occurred', () => {
			const monitor = StorageQuotaMonitor.getInstance();

			expect(monitor.getCurrentQuota()).toBeNull();
		});

		test('getCurrentQuota remains null after a failed forced check', async () => {
			const monitor = StorageQuotaMonitor.getInstance();
			await monitor.forceCheck();

			expect(monitor.getCurrentQuota()).toBeNull();
		});
	});

	describe('forceCheck', () => {
		let originalStorage: StorageManager | undefined;

		beforeEach(() => {
			originalStorage = navigator.storage;
			Object.defineProperty(navigator, 'storage', { value: undefined, configurable: true });
		});

		afterEach(() => {
			Object.defineProperty(navigator, 'storage', { value: originalStorage, configurable: true });
		});

		test('returns null when navigator.storage is not available', async () => {
			const monitor = StorageQuotaMonitor.getInstance();
			const result = await monitor.forceCheck();

			expect(result).toBeNull();
		});
	});

	describe('resetOperationCounter', () => {
		test('resets the operation counter to zero', () => {
			const monitor = StorageQuotaMonitor.getInstance();

			// Increment the counter by calling checkQuota (non-forced) a few times
			// These calls increment operationCount internally
			void monitor.checkQuota(false);
			void monitor.checkQuota(false);
			void monitor.checkQuota(false);

			const countBefore = (monitor as any)['operationCount'];
			expect(countBefore).toBeGreaterThan(0);

			monitor.resetOperationCounter();

			const countAfter = (monitor as any)['operationCount'];
			expect(countAfter).toBe(0);
		});
	});

	describe('getUsageTrend', () => {
		test('returns insufficient_data when history has fewer than 3 entries', () => {
			const monitor = StorageQuotaMonitor.getInstance();
			const history = getUsageHistory(monitor);
			history.length = 0;

			const trend = monitor.getUsageTrend();

			expect(trend.trend).toBe('insufficient_data');
			expect(trend.confidence).toBe(0);
			expect(trend.rate).toBeUndefined();
		});

		test('returns insufficient_data with exactly 2 history entries', () => {
			const monitor = StorageQuotaMonitor.getInstance();
			const history = getUsageHistory(monitor);
			history.length = 0;

			const now = Date.now();
			history.push({ timestamp: now - 2000, usage: 1000 });
			history.push({ timestamp: now - 1000, usage: 2000 });

			const trend = monitor.getUsageTrend();
			expect(trend.trend).toBe('insufficient_data');
			expect(trend.confidence).toBe(0);
		});

		test('returns stable when usage rate is less than 1 KB per hour', () => {
			const monitor = StorageQuotaMonitor.getInstance();
			const history = getUsageHistory(monitor);
			history.length = 0;

			const now = Date.now();
			// Entries with very small usage deltas relative to time
			history.push({ timestamp: now - 4000, usage: 1000 });
			history.push({ timestamp: now - 3000, usage: 1000 });
			history.push({ timestamp: now - 2000, usage: 1000 });
			history.push({ timestamp: now - 1000, usage: 1000 });

			const trend = monitor.getUsageTrend();
			expect(trend.trend).toBe('stable');
			expect(trend.rate).toBeDefined();
			expect(trend.confidence).toBeGreaterThan(0);
		});

		test('returns increasing when usage is growing significantly', () => {
			const monitor = StorageQuotaMonitor.getInstance();
			const history = getUsageHistory(monitor);
			history.length = 0;

			const now = Date.now();
			// Large usage increases: growing by 10 MB per second (huge rate)
			history.push({ timestamp: now - 4000, usage: 10_000_000 });
			history.push({ timestamp: now - 3000, usage: 20_000_000 });
			history.push({ timestamp: now - 2000, usage: 30_000_000 });
			history.push({ timestamp: now - 1000, usage: 40_000_000 });

			const trend = monitor.getUsageTrend();
			expect(trend.trend).toBe('increasing');
			expect(trend.rate).toBeDefined();
			expect(trend.rate!).toBeGreaterThan(0);
		});

		test('returns decreasing when usage is shrinking significantly', () => {
			const monitor = StorageQuotaMonitor.getInstance();
			const history = getUsageHistory(monitor);
			history.length = 0;

			const now = Date.now();
			// Large usage decreases
			history.push({ timestamp: now - 4000, usage: 40_000_000 });
			history.push({ timestamp: now - 3000, usage: 30_000_000 });
			history.push({ timestamp: now - 2000, usage: 20_000_000 });
			history.push({ timestamp: now - 1000, usage: 10_000_000 });

			const trend = monitor.getUsageTrend();
			expect(trend.trend).toBe('decreasing');
			expect(trend.rate).toBeDefined();
			expect(trend.rate!).toBeLessThan(0);
		});

		test('confidence increases with more data points', () => {
			const monitor = StorageQuotaMonitor.getInstance();
			const history = getUsageHistory(monitor);
			history.length = 0;

			const now = Date.now();

			// 3 entries: confidence should be low
			history.push({ timestamp: now - 3000, usage: 1_000_000 });
			history.push({ timestamp: now - 2000, usage: 2_000_000 });
			history.push({ timestamp: now - 1000, usage: 3_000_000 });

			const trendWith3 = monitor.getUsageTrend();

			// Reset and add more entries
			history.length = 0;
			for (let i = 10; i >= 1; i--) {
				history.push({
					timestamp: now - i * 1000,
					usage: (11 - i) * 1_000_000,
				});
			}

			const trendWith10 = monitor.getUsageTrend();

			expect(trendWith10.confidence).toBeGreaterThan(trendWith3.confidence);
		});

		test('returns stable with zero time delta between entries', () => {
			const monitor = StorageQuotaMonitor.getInstance();
			const history = getUsageHistory(monitor);
			history.length = 0;

			const now = Date.now();
			// All entries at the same timestamp (only last 5 are used)
			history.push({ timestamp: now, usage: 1000 });
			history.push({ timestamp: now, usage: 2000 });
			history.push({ timestamp: now, usage: 3000 });

			const trend = monitor.getUsageTrend();
			expect(trend.trend).toBe('stable');
			expect(trend.confidence).toBe(0.5);
		});

		test('uses only the last 5 history entries for trend calculation', () => {
			const monitor = StorageQuotaMonitor.getInstance();
			const history = getUsageHistory(monitor);
			history.length = 0;

			const now = Date.now();

			// Add 8 entries: first 3 show decrease, last 5 show increase
			history.push({ timestamp: now - 8000, usage: 50_000_000 });
			history.push({ timestamp: now - 7000, usage: 40_000_000 });
			history.push({ timestamp: now - 6000, usage: 30_000_000 });
			history.push({ timestamp: now - 5000, usage: 10_000_000 });
			history.push({ timestamp: now - 4000, usage: 20_000_000 });
			history.push({ timestamp: now - 3000, usage: 30_000_000 });
			history.push({ timestamp: now - 2000, usage: 40_000_000 });
			history.push({ timestamp: now - 1000, usage: 50_000_000 });

			const trend = monitor.getUsageTrend();
			// The last 5 entries show increasing usage, so trend should be increasing
			expect(trend.trend).toBe('increasing');
		});
	});

	describe('Default configuration', () => {
		test('default safety margin is 0.15', () => {
			const monitor = StorageQuotaMonitor.getInstance();
			expect((monitor as any)['safetyMargin']).toBe(0.15);
		});

		test('default check interval is 1000', () => {
			const monitor = StorageQuotaMonitor.getInstance();
			expect((monitor as any)['checkInterval']).toBe(1000);
		});

		test('custom options are applied to the instance', () => {
			const monitor = StorageQuotaMonitor.getInstance({
				safetyMargin: 0.2,
				initialCheckInterval: 500,
			});

			expect((monitor as any)['safetyMargin']).toBe(0.2);
			expect((monitor as any)['checkInterval']).toBe(500);
		});
	});

	describe('checkQuota periodic behavior', () => {
		test('non-forced checkQuota returns lastCheck without hitting navigator.storage', async () => {
			const monitor = StorageQuotaMonitor.getInstance();

			// The operation counter starts at 0. A non-forced call increments it
			// and only performs a real check when operationCount % checkInterval === 0.
			// Since the default checkInterval is 1000, the first non-forced call
			// (operationCount becomes 1) should skip the real check and return lastCheck.
			const result = await monitor.checkQuota(false);

			// lastCheck starts as null, so it should return null without performing a check
			expect(result).toBeNull();
			expect(monitor.getCurrentQuota()).toBeNull();
		});
	});
});
