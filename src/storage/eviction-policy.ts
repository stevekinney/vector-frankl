import { VectorStorage } from '@/core/storage.js';
import type { VectorData } from '@/core/types.js';

/**
 * Configuration for eviction policies
 */
export interface EvictionConfig {
  strategy: 'lru' | 'lfu' | 'ttl' | 'score' | 'hybrid';
  targetBytes?: number;
  maxVectors?: number;
  ttlHours?: number;
  preservePermanent?: boolean;
  batchSize?: number;
}

/**
 * Eviction result information
 */
export interface EvictionResult {
  evictedCount: number;
  freedBytes: number;
  errors: Array<{ id: string; error: Error }>;
  duration: number;
  strategy: string;
}

/**
 * Vector scoring information for eviction decisions
 */
interface VectorScore {
  id: string;
  score: number;
  size: number;
  isPermanent: boolean;
  vector: VectorData;
}

/**
 * Base class for eviction policies
 */
abstract class BaseEvictionPolicy {
  constructor(protected storage: VectorStorage) {}

  abstract evict(config: EvictionConfig): Promise<EvictionResult>;

  /**
   * Calculate the estimated size of a vector in bytes
   */
  protected estimateVectorSize(vector: VectorData): number {
    let size = 0;

    // Vector data (Float32Array)
    size += vector.vector.byteLength;

    // Metadata (rough estimation)
    if (vector.metadata) {
      size += this.estimateObjectSize(vector.metadata);
    }

    // String overhead (ID)
    size += vector.id.length * 2;

    // Other properties (timestamps, magnitude, etc.)
    size += 64; // Rough overhead

    return size;
  }

  /**
   * Estimate the size of a JavaScript object
   */
  private estimateObjectSize(obj: unknown): number {
    if (obj === null || obj === undefined) return 8;

    switch (typeof obj) {
      case 'boolean':
        return 4;
      case 'number':
        return 8;
      case 'string':
        return obj.length * 2;
      case 'object':
        if (Array.isArray(obj)) {
          return obj.reduce((sum, item) => sum + this.estimateObjectSize(item), 24);
        }

        {
          let size = 48; // Object overhead
          const objAsRecord = obj as Record<string, unknown>;
          for (const key in objAsRecord) {
            size += key.length * 2;
            size += this.estimateObjectSize(objAsRecord[key]);
          }
          return size;
        }
      default:
        return 8;
    }
  }

  /**
   * Check if a vector is marked as permanent
   */
  protected isPermanent(vector: VectorData): boolean {
    return vector.metadata?.['permanent'] === true;
  }
}

/**
 * Least Recently Used (LRU) eviction policy
 */
export class LRUEvictionPolicy extends BaseEvictionPolicy {
  async evict(config: EvictionConfig): Promise<EvictionResult> {
    const startTime = performance.now();
    const targetBytes = config.targetBytes || 0;
    const maxVectors = config.maxVectors || Infinity;
    const batchSize = config.batchSize || 1000;

    // Get all vectors sorted by last access time (oldest first)
    const allVectors = await this.storage.getAll();

    // Filter out permanent vectors if configured
    const candidates = config.preservePermanent
      ? allVectors.filter((v) => !this.isPermanent(v))
      : allVectors;

    // Sort by lastAccessed (oldest first), then by timestamp (oldest first)
    candidates.sort((a, b) => {
      const aAccess = a.lastAccessed || a.timestamp;
      const bAccess = b.lastAccessed || b.timestamp;
      return aAccess - bAccess;
    });

    let freedBytes = 0;
    let evictedCount = 0;
    const errors: Array<{ id: string; error: Error }> = [];
    const toDelete: string[] = [];

    // Select vectors for eviction
    for (const vector of candidates) {
      if (evictedCount >= maxVectors) break;
      if (freedBytes >= targetBytes && targetBytes > 0) break;

      const vectorSize = this.estimateVectorSize(vector);
      toDelete.push(vector.id);
      freedBytes += vectorSize;
      evictedCount++;
    }

    // Delete in batches to avoid blocking
    for (let i = 0; i < toDelete.length; i += batchSize) {
      const batch = toDelete.slice(i, i + batchSize);

      await Promise.all(
        batch.map(async (id) => {
          try {
            await this.storage.delete(id);
          } catch (error) {
            errors.push({
              id,
              error: error instanceof Error ? error : new Error(String(error)),
            });
          }
        }),
      );
    }

    const duration = performance.now() - startTime;

    return {
      evictedCount: evictedCount - errors.length,
      freedBytes,
      errors,
      duration,
      strategy: 'lru',
    };
  }
}

/**
 * Least Frequently Used (LFU) eviction policy
 */
export class LFUEvictionPolicy extends BaseEvictionPolicy {
  async evict(config: EvictionConfig): Promise<EvictionResult> {
    const startTime = performance.now();
    const targetBytes = config.targetBytes || 0;
    const maxVectors = config.maxVectors || Infinity;

    const allVectors = await this.storage.getAll();
    const candidates = config.preservePermanent
      ? allVectors.filter((v) => !this.isPermanent(v))
      : allVectors;

    // Sort by access count (least frequently used first)
    candidates.sort((a, b) => {
      const aCount = a.accessCount || 0;
      const bCount = b.accessCount || 0;
      if (aCount === bCount) {
        // If access counts are equal, prefer older vectors
        const aAccess = a.lastAccessed || a.timestamp;
        const bAccess = b.lastAccessed || b.timestamp;
        return aAccess - bAccess;
      }
      return aCount - bCount;
    });

    let freedBytes = 0;
    let evictedCount = 0;
    const errors: Array<{ id: string; error: Error }> = [];

    for (const vector of candidates) {
      if (evictedCount >= maxVectors) break;
      if (freedBytes >= targetBytes && targetBytes > 0) break;

      try {
        await this.storage.delete(vector.id);
        freedBytes += this.estimateVectorSize(vector);
        evictedCount++;
      } catch (error) {
        errors.push({
          id: vector.id,
          error: error instanceof Error ? error : new Error(String(error)),
        });
      }
    }

    return {
      evictedCount,
      freedBytes,
      errors,
      duration: performance.now() - startTime,
      strategy: 'lfu',
    };
  }
}

/**
 * Time To Live (TTL) eviction policy
 */
export class TTLEvictionPolicy extends BaseEvictionPolicy {
  async evict(config: EvictionConfig): Promise<EvictionResult> {
    const startTime = performance.now();
    const ttlMs = (config.ttlHours || 24) * 60 * 60 * 1000;
    const cutoffTime = Date.now() - ttlMs;

    const allVectors = await this.storage.getAll();
    const candidates = allVectors.filter((vector) => {
      // Skip permanent vectors if configured
      if (config.preservePermanent && this.isPermanent(vector)) {
        return false;
      }

      // Check if vector has expired
      const vectorTime = vector.lastAccessed || vector.timestamp;
      return vectorTime < cutoffTime;
    });

    let freedBytes = 0;
    let evictedCount = 0;
    const errors: Array<{ id: string; error: Error }> = [];

    for (const vector of candidates) {
      try {
        await this.storage.delete(vector.id);
        freedBytes += this.estimateVectorSize(vector);
        evictedCount++;
      } catch (error) {
        errors.push({
          id: vector.id,
          error: error instanceof Error ? error : new Error(String(error)),
        });
      }
    }

    return {
      evictedCount,
      freedBytes,
      errors,
      duration: performance.now() - startTime,
      strategy: 'ttl',
    };
  }
}

/**
 * Score-based eviction policy
 */
export class ScoreBasedEvictionPolicy extends BaseEvictionPolicy {
  async evict(config: EvictionConfig): Promise<EvictionResult> {
    const startTime = performance.now();
    const targetBytes = config.targetBytes || 0;
    const maxVectors = config.maxVectors || Infinity;

    const allVectors = await this.storage.getAll();
    const candidates = config.preservePermanent
      ? allVectors.filter((v) => !this.isPermanent(v))
      : allVectors;

    // Calculate scores for each vector
    const scoredVectors: VectorScore[] = candidates.map((vector) => ({
      id: vector.id,
      score: this.calculateEvictionScore(vector),
      size: this.estimateVectorSize(vector),
      isPermanent: this.isPermanent(vector),
      vector,
    }));

    // Sort by score (lowest scores evicted first)
    scoredVectors.sort((a, b) => a.score - b.score);

    let freedBytes = 0;
    let evictedCount = 0;
    const errors: Array<{ id: string; error: Error }> = [];

    for (const item of scoredVectors) {
      if (evictedCount >= maxVectors) break;
      if (freedBytes >= targetBytes && targetBytes > 0) break;

      try {
        await this.storage.delete(item.id);
        freedBytes += item.size;
        evictedCount++;
      } catch (error) {
        errors.push({
          id: item.id,
          error: error instanceof Error ? error : new Error(String(error)),
        });
      }
    }

    return {
      evictedCount,
      freedBytes,
      errors,
      duration: performance.now() - startTime,
      strategy: 'score',
    };
  }

  /**
   * Calculate eviction score for a vector
   * Lower scores are evicted first
   */
  private calculateEvictionScore(vector: VectorData): number {
    const now = Date.now();
    const age = now - vector.timestamp;
    const timeSinceAccess = now - (vector.lastAccessed || vector.timestamp);
    const accessCount = vector.accessCount || 0;
    const priority = (vector.metadata?.['priority'] as number) || 0.5; // 0-1 scale

    // Combine factors into a single score
    // Higher access count = higher score (less likely to evict)
    // Higher priority = higher score (less likely to evict)
    // Longer time since access = lower score (more likely to evict)
    // Older age = lower score (more likely to evict)

    const accessScore = Math.log(accessCount + 1) * 0.3;
    const priorityScore = priority * 0.4;
    const recencyScore = Math.exp(-timeSinceAccess / (1000 * 60 * 60 * 24)) * 0.2; // Decay over days
    const ageScore = Math.exp(-age / (1000 * 60 * 60 * 24 * 7)) * 0.1; // Decay over weeks

    return accessScore + priorityScore + recencyScore + ageScore;
  }
}

/**
 * Hybrid eviction policy that combines multiple strategies
 */
export class HybridEvictionPolicy extends BaseEvictionPolicy {
  async evict(config: EvictionConfig): Promise<EvictionResult> {
    const startTime = performance.now();

    // Phase 1: Remove expired vectors (TTL)
    const ttlPolicy = new TTLEvictionPolicy(this.storage);
    const ttlResult = await ttlPolicy.evict({
      ...config,
      strategy: 'ttl',
      ttlHours: config.ttlHours || 168, // 1 week default
    });

    // If TTL eviction freed enough space, we're done
    if (config.targetBytes && ttlResult.freedBytes >= config.targetBytes) {
      return {
        ...ttlResult,
        strategy: 'hybrid-ttl-only',
        duration: performance.now() - startTime,
      };
    }

    // Phase 2: Use score-based eviction for remaining space
    const remainingTarget = Math.max(0, (config.targetBytes || 0) - ttlResult.freedBytes);
    const remainingVectors = Math.max(
      0,
      (config.maxVectors || Infinity) - ttlResult.evictedCount,
    );

    if (remainingTarget > 0 || remainingVectors > 0) {
      const scorePolicy = new ScoreBasedEvictionPolicy(this.storage);
      const scoreResult = await scorePolicy.evict({
        ...config,
        targetBytes: remainingTarget,
        maxVectors: remainingVectors,
      });

      return {
        evictedCount: ttlResult.evictedCount + scoreResult.evictedCount,
        freedBytes: ttlResult.freedBytes + scoreResult.freedBytes,
        errors: [...ttlResult.errors, ...scoreResult.errors],
        duration: performance.now() - startTime,
        strategy: 'hybrid',
      };
    }

    return {
      ...ttlResult,
      strategy: 'hybrid-ttl-only',
      duration: performance.now() - startTime,
    };
  }
}

/**
 * Main eviction manager that coordinates different policies
 */
export class EvictionManager {
  private policies: Map<string, BaseEvictionPolicy> = new Map();

  constructor(private storage: VectorStorage) {
    this.policies.set('lru', new LRUEvictionPolicy(storage));
    this.policies.set('lfu', new LFUEvictionPolicy(storage));
    this.policies.set('ttl', new TTLEvictionPolicy(storage));
    this.policies.set('score', new ScoreBasedEvictionPolicy(storage));
    this.policies.set('hybrid', new HybridEvictionPolicy(storage));
  }

  /**
   * Execute eviction using the specified strategy
   */
  async evict(config: EvictionConfig): Promise<EvictionResult> {
    const policy = this.policies.get(config.strategy);

    if (!policy) {
      throw new Error(`Unknown eviction strategy: ${config.strategy}`);
    }

    const result = await policy.evict(config);

    // Log eviction results
    console.log(
      `Eviction completed: ${result.strategy} strategy freed ${this.formatBytes(result.freedBytes)} by removing ${result.evictedCount} vectors in ${result.duration.toFixed(2)}ms`,
    );

    if (result.errors.length > 0) {
      console.warn(`Eviction had ${result.errors.length} errors:`, result.errors);
    }

    return result;
  }

  /**
   * Get statistics about vectors for eviction planning
   */
  async getEvictionStats(): Promise<{
    totalVectors: number;
    totalEstimatedBytes: number;
    permanentVectors: number;
    oldestAccess: number;
    averageAccessCount: number;
    expiredVectors: number;
  }> {
    const allVectors = await this.storage.getAll();
    const now = Date.now();
    const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;

    let totalBytes = 0;
    let permanentCount = 0;
    let oldestAccess = now;
    let totalAccessCount = 0;
    let expiredCount = 0;

    for (const vector of allVectors) {
      totalBytes += this.estimateVectorSize(vector);

      if (this.isPermanent(vector)) {
        permanentCount++;
      }

      const lastAccess = vector.lastAccessed || vector.timestamp;
      if (lastAccess < oldestAccess) {
        oldestAccess = lastAccess;
      }

      totalAccessCount += vector.accessCount || 0;

      if (lastAccess < oneWeekAgo) {
        expiredCount++;
      }
    }

    return {
      totalVectors: allVectors.length,
      totalEstimatedBytes: totalBytes,
      permanentVectors: permanentCount,
      oldestAccess,
      averageAccessCount:
        allVectors.length > 0 ? totalAccessCount / allVectors.length : 0,
      expiredVectors: expiredCount,
    };
  }

  /**
   * Suggest optimal eviction strategy based on current data
   */
  async suggestStrategy(targetBytes: number): Promise<{
    strategy: EvictionConfig['strategy'];
    config: EvictionConfig;
    reasoning: string;
  }> {
    const stats = await this.getEvictionStats();

    // If many vectors have expired, use TTL
    if (stats.expiredVectors > stats.totalVectors * 0.3) {
      return {
        strategy: 'ttl',
        config: {
          strategy: 'ttl',
          targetBytes,
          ttlHours: 168, // 1 week
          preservePermanent: true,
        },
        reasoning: `${stats.expiredVectors} vectors (${((stats.expiredVectors / stats.totalVectors) * 100).toFixed(1)}%) haven't been accessed in over a week`,
      };
    }

    // If access patterns are varied, use hybrid
    if (stats.averageAccessCount > 2) {
      return {
        strategy: 'hybrid',
        config: {
          strategy: 'hybrid',
          targetBytes,
          ttlHours: 336, // 2 weeks
          preservePermanent: true,
        },
        reasoning:
          'Mixed access patterns detected, combining TTL and score-based eviction',
      };
    }

    // Default to LRU for simple cases
    return {
      strategy: 'lru',
      config: {
        strategy: 'lru',
        targetBytes,
        preservePermanent: true,
      },
      reasoning: 'Simple access patterns, using least-recently-used eviction',
    };
  }

  /**
   * Format bytes in human-readable format
   */
  private formatBytes(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(1)} ${units[unitIndex]}`;
  }

  /**
   * Estimate vector size (shared with policies)
   */
  private estimateVectorSize(vector: VectorData): number {
    const policy = this.policies.get('lru') as LRUEvictionPolicy;
    return policy['estimateVectorSize'](vector);
  }

  /**
   * Check if vector is permanent (shared with policies)
   */
  private isPermanent(vector: VectorData): boolean {
    const policy = this.policies.get('lru') as LRUEvictionPolicy;
    return policy['isPermanent'](vector);
  }
}
