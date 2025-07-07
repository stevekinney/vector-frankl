/**
 * Storage quota monitoring and management for Vector Frankl
 */

export interface QuotaEstimate {
  usage: number;
  quota: number;
  usageRatio: number;
  available: number;
}

export interface QuotaWarning {
  type: 'warning' | 'critical' | 'emergency';
  usage: number;
  quota: number;
  usageRatio: number;
  availableBytes: number;
  estimatedTimeToFull?: number;
  message: string;
}

export interface StorageBreakdown {
  totalUsage: number;
  vectorDatabases: Array<{
    name: string;
    estimatedSize: number;
    vectorCount: number;
  }>;
  otherOriginData: number;
}

/**
 * Monitors storage quota and provides warnings/recommendations
 */
export class StorageQuotaMonitor {
  private static instance: StorageQuotaMonitor | null = null;

  private safetyMargin: number;
  private checkInterval: number;
  private operationCount = 0;
  private listeners = new Set<(warning: QuotaWarning) => void>();
  private lastCheck: QuotaEstimate | null = null;
  private usageHistory: Array<{ timestamp: number; usage: number }> = [];
  private maxHistoryEntries = 100;

  private constructor(
    options: {
      safetyMargin?: number;
      initialCheckInterval?: number;
    } = {},
  ) {
    this.safetyMargin = options.safetyMargin ?? 0.15; // 15% safety buffer
    this.checkInterval = options.initialCheckInterval ?? 1000; // Check every 1000 operations initially
  }

  /**
   * Get singleton instance
   */
  static getInstance(options?: {
    safetyMargin?: number;
    initialCheckInterval?: number;
  }): StorageQuotaMonitor {
    if (!StorageQuotaMonitor.instance) {
      StorageQuotaMonitor.instance = new StorageQuotaMonitor(options);
    }
    return StorageQuotaMonitor.instance;
  }

  /**
   * Add a quota warning listener
   */
  addListener(callback: (warning: QuotaWarning) => void): void {
    this.listeners.add(callback);
  }

  /**
   * Remove a quota warning listener
   */
  removeListener(callback: (warning: QuotaWarning) => void): void {
    this.listeners.delete(callback);
  }

  /**
   * Emit a quota warning to all listeners
   */
  private emit(warning: QuotaWarning): void {
    this.listeners.forEach((callback) => {
      try {
        callback(warning);
      } catch (error) {
        console.error('Error in quota warning listener:', error);
      }
    });
  }

  /**
   * Check quota and emit warnings if necessary
   */
  async checkQuota(force = false): Promise<QuotaEstimate | null> {
    // Only check periodically unless forced
    if (!force && ++this.operationCount % this.checkInterval !== 0) {
      return this.lastCheck;
    }

    if (!navigator.storage?.estimate) {
      console.warn('Storage quota estimation not supported in this browser');
      return null;
    }

    try {
      const estimate = await navigator.storage.estimate();
      const usage = estimate.usage || 0;
      const quota = estimate.quota || 0;

      if (quota === 0) {
        console.warn('Storage quota information not available');
        return null;
      }

      const quotaEstimate: QuotaEstimate = {
        usage,
        quota,
        usageRatio: usage / quota,
        available: quota - usage,
      };

      this.lastCheck = quotaEstimate;
      this.updateUsageHistory(usage);
      this.adaptCheckFrequency(quotaEstimate.usageRatio);
      this.checkForWarnings(quotaEstimate);

      return quotaEstimate;
    } catch (error) {
      console.error('Failed to check storage quota:', error);
      return null;
    }
  }

  /**
   * Update usage history for trend analysis
   */
  private updateUsageHistory(usage: number): void {
    this.usageHistory.push({
      timestamp: Date.now(),
      usage,
    });

    // Keep only recent history
    if (this.usageHistory.length > this.maxHistoryEntries) {
      this.usageHistory.shift();
    }
  }

  /**
   * Adapt check frequency based on current usage ratio
   */
  private adaptCheckFrequency(usageRatio: number): void {
    if (usageRatio > 0.9) {
      this.checkInterval = 10; // Check every 10 operations when critical
    } else if (usageRatio > 0.8) {
      this.checkInterval = 50; // Check every 50 operations when high
    } else if (usageRatio > 0.7) {
      this.checkInterval = 100; // Check every 100 operations when moderate
    } else if (usageRatio > 0.5) {
      this.checkInterval = 500; // Check every 500 operations when medium
    } else {
      this.checkInterval = 1000; // Check every 1000 operations when low
    }
  }

  /**
   * Check for quota warnings and emit appropriate events
   */
  private checkForWarnings(estimate: QuotaEstimate): void {
    const { usageRatio, usage, quota, available } = estimate;
    const warningThreshold = 1 - this.safetyMargin; // e.g., 0.85 for 15% margin

    if (usageRatio >= 0.95) {
      // Emergency: < 5% space remaining
      const warning: QuotaWarning = {
        type: 'emergency',
        usage,
        quota,
        usageRatio,
        availableBytes: available,
        message: `EMERGENCY: Storage critically low! Only ${this.formatBytes(available)} remaining (${(usageRatio * 100).toFixed(1)}% used). Immediate action required.`,
      };
      const estimatedTime = this.estimateTimeToFull();
      if (estimatedTime !== undefined) {
        warning.estimatedTimeToFull = estimatedTime;
      }
      this.emit(warning);
    } else if (usageRatio >= 0.9) {
      // Critical: < 10% space remaining
      const warning: QuotaWarning = {
        type: 'critical',
        usage,
        quota,
        usageRatio,
        availableBytes: available,
        message: `CRITICAL: Storage space running low! Only ${this.formatBytes(available)} remaining (${(usageRatio * 100).toFixed(1)}% used). Consider cleaning up data.`,
      };
      const estimatedTime = this.estimateTimeToFull();
      if (estimatedTime !== undefined) {
        warning.estimatedTimeToFull = estimatedTime;
      }
      this.emit(warning);
    } else if (usageRatio >= warningThreshold) {
      // Warning: Approaching safety margin
      const warning: QuotaWarning = {
        type: 'warning',
        usage,
        quota,
        usageRatio,
        availableBytes: available,
        message: `WARNING: Storage usage is high. ${this.formatBytes(available)} remaining (${(usageRatio * 100).toFixed(1)}% used). Monitor usage closely.`,
      };
      const estimatedTime = this.estimateTimeToFull();
      if (estimatedTime !== undefined) {
        warning.estimatedTimeToFull = estimatedTime;
      }
      this.emit(warning);
    }
  }

  /**
   * Estimate time until storage is full based on usage trends
   */
  private estimateTimeToFull(): number | undefined {
    if (this.usageHistory.length < 5) {
      return undefined; // Not enough data
    }

    // Calculate usage rate over recent history
    const recentHistory = this.usageHistory.slice(-10);
    const oldestEntry = recentHistory[0];
    const newestEntry = recentHistory[recentHistory.length - 1];

    if (!oldestEntry || !newestEntry) {
      return undefined;
    }

    const timeDelta = newestEntry.timestamp - oldestEntry.timestamp;
    const usageDelta = newestEntry.usage - oldestEntry.usage;

    if (timeDelta <= 0 || usageDelta <= 0) {
      return undefined; // No growth or insufficient time
    }

    const usageRate = usageDelta / timeDelta; // bytes per millisecond
    const remainingBytes = this.lastCheck?.available || 0;

    return remainingBytes / usageRate; // milliseconds until full
  }

  /**
   * Get detailed storage breakdown by database
   */
  async getStorageBreakdown(): Promise<StorageBreakdown> {
    try {
      // Get list of all IndexedDB databases
      const databases = await indexedDB.databases();
      const vectorDatabases: StorageBreakdown['vectorDatabases'] = [];

      let totalVectorDBSize = 0;

      for (const dbInfo of databases) {
        if (dbInfo.name?.includes('vector-frankl') || dbInfo.name?.includes('-ns-')) {
          const size = await this.estimateDBSize(dbInfo.name);
          const vectorCount = await this.getVectorCount(dbInfo.name);

          vectorDatabases.push({
            name: dbInfo.name,
            estimatedSize: size,
            vectorCount,
          });

          totalVectorDBSize += size;
        }
      }

      const totalUsage = this.lastCheck?.usage || 0;
      const otherOriginData = Math.max(0, totalUsage - totalVectorDBSize);

      return {
        totalUsage,
        vectorDatabases,
        otherOriginData,
      };
    } catch (error) {
      console.error('Failed to get storage breakdown:', error);
      return {
        totalUsage: this.lastCheck?.usage || 0,
        vectorDatabases: [],
        otherOriginData: this.lastCheck?.usage || 0,
      };
    }
  }

  /**
   * Estimate the size of a specific IndexedDB database
   */
  private async estimateDBSize(dbName: string): Promise<number> {
    try {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName);

        request.onsuccess = () => {
          const db = request.result;
          let totalSize = 0;

          try {
            const transaction = db.transaction(db.objectStoreNames, 'readonly');
            const promises: Promise<number>[] = [];

            for (const storeName of Array.from(db.objectStoreNames)) {
              const store = transaction.objectStore(storeName);
              promises.push(this.estimateStoreSize(store));
            }

            Promise.all(promises)
              .then((sizes) => {
                totalSize = sizes.reduce((sum, size) => sum + size, 0);
                db.close();
                resolve(totalSize);
              })
              .catch((error) => {
                db.close();
                reject(error);
              });
          } catch (error) {
            db.close();
            reject(error);
          }
        };

        request.onerror = () => {
          reject(request.error);
        };
      });
    } catch (error) {
      console.warn(`Failed to estimate size for database ${dbName}:`, error);
      return 0;
    }
  }

  /**
   * Estimate the size of an object store
   */
  private async estimateStoreSize(store: IDBObjectStore): Promise<number> {
    return new Promise((resolve, reject) => {
      let totalSize = 0;
      const request = store.openCursor();

      request.onsuccess = () => {
        const cursor = request.result;

        if (cursor) {
          // Rough size estimation
          const value = cursor.value;
          totalSize += this.estimateObjectSize(value);
          cursor.continue();
        } else {
          resolve(totalSize);
        }
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  /**
   * Estimate the size of a JavaScript object in bytes
   */
  private estimateObjectSize(obj: unknown): number {
    let size = 0;

    if (obj === null || obj === undefined) {
      return 8; // rough estimate
    }

    switch (typeof obj) {
      case 'boolean':
        return 4;
      case 'number':
        return 8;
      case 'string':
        return obj.length * 2; // UTF-16
      case 'object':
        if (obj instanceof Float32Array || obj instanceof Float64Array) {
          return obj.byteLength;
        }
        if (obj instanceof Int8Array || obj instanceof Uint8Array) {
          return obj.byteLength;
        }
        if (Array.isArray(obj)) {
          return obj.reduce((sum, item) => sum + this.estimateObjectSize(item), 0) + 24; // Array overhead
        }

        // Regular object
        const objAsRecord = obj as Record<string, unknown>;
        for (const key in objAsRecord) {
          size += key.length * 2; // Key size
          size += this.estimateObjectSize(objAsRecord[key]); // Value size
        }
        return size + 48; // Object overhead
      default:
        return 8;
    }
  }

  /**
   * Get vector count for a database
   */
  private async getVectorCount(dbName: string): Promise<number> {
    try {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName);

        request.onsuccess = () => {
          const db = request.result;

          try {
            if (db.objectStoreNames.contains('vectors')) {
              const transaction = db.transaction(['vectors'], 'readonly');
              const store = transaction.objectStore('vectors');
              const countRequest = store.count();

              countRequest.onsuccess = () => {
                db.close();
                resolve(countRequest.result);
              };

              countRequest.onerror = () => {
                db.close();
                reject(countRequest.error);
              };
            } else {
              db.close();
              resolve(0);
            }
          } catch (error) {
            db.close();
            reject(error);
          }
        };

        request.onerror = () => {
          reject(request.error);
        };
      });
    } catch (error) {
      console.warn(`Failed to get vector count for database ${dbName}:`, error);
      return 0;
    }
  }

  /**
   * Format bytes in a human-readable format
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';

    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const k = 1024;
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${units[i]}`;
  }

  /**
   * Get current quota information
   */
  getCurrentQuota(): QuotaEstimate | null {
    return this.lastCheck;
  }

  /**
   * Force a quota check
   */
  async forceCheck(): Promise<QuotaEstimate | null> {
    return this.checkQuota(true);
  }

  /**
   * Reset operation counter (useful for testing)
   */
  resetOperationCounter(): void {
    this.operationCount = 0;
  }

  /**
   * Get usage trend information
   */
  getUsageTrend(): {
    trend: 'increasing' | 'decreasing' | 'stable' | 'insufficient_data';
    rate?: number; // bytes per hour
    confidence: number; // 0-1
  } {
    if (this.usageHistory.length < 3) {
      return { trend: 'insufficient_data', confidence: 0 };
    }

    const recentEntries = this.usageHistory.slice(-5);
    let totalDelta = 0;
    let totalTime = 0;

    for (let i = 1; i < recentEntries.length; i++) {
      const prev = recentEntries[i - 1]!;
      const curr = recentEntries[i]!;
      totalDelta += curr.usage - prev.usage;
      totalTime += curr.timestamp - prev.timestamp;
    }

    if (totalTime === 0) {
      return { trend: 'stable', confidence: 0.5 };
    }

    const ratePerMs = totalDelta / totalTime;
    const ratePerHour = ratePerMs * 3600000; // Convert to per hour
    const confidence = Math.min(recentEntries.length / 10, 1); // More data = higher confidence

    if (Math.abs(ratePerHour) < 1024) {
      // Less than 1KB/hour change
      return { trend: 'stable', rate: ratePerHour, confidence };
    } else if (ratePerHour > 0) {
      return { trend: 'increasing', rate: ratePerHour, confidence };
    } else {
      return { trend: 'decreasing', rate: ratePerHour, confidence };
    }
  }
}
