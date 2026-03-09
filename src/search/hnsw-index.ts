import type { DistanceMetric, VectorData } from '@/core/types.js';
import { createDistanceCalculator, DistanceCalculator } from './distance-metrics.js';

/**
 * HNSW (Hierarchical Navigable Small World) Index Node
 */
interface HNSWNode {
  id: string;
  vector: Float32Array;
  metadata?: Record<string, unknown>;
  level: number;
  connections: Map<number, Set<string>>; // level -> connected node IDs
}

/**
 * HNSW Index Configuration
 */
interface HNSWConfig {
  m: number; // Max connections per node
  mL: number; // Level generation multiplier
  efConstruction: number; // Size of candidate list during construction
  maxLevel: number; // Maximum level
  seed?: number; // Random seed for reproducibility
}

/**
 * Basic HNSW Index Implementation
 */
export class HNSWIndex {
  private nodes = new Map<string, HNSWNode>();
  private entryPoint: string | null = null;
  private distanceCalculator: DistanceCalculator;
  private config: HNSWConfig;
  private rng: () => number;

  constructor(
    distanceMetric: DistanceMetric = 'cosine',
    config: Partial<HNSWConfig> = {},
  ) {
    this.distanceCalculator = createDistanceCalculator(distanceMetric);
    this.config = {
      m: 16,
      mL: 2,
      efConstruction: 200,
      maxLevel: 5,
      seed: 42,
      ...config,
    };

    // Simple seeded random number generator
    this.rng = this.createSeededRNG(this.config.seed || 42);
  }

  /**
   * Add a vector to the index
   */
  async addVector(vectorData: VectorData): Promise<void> {
    const level = this.getRandomLevel();
    const node: HNSWNode = {
      id: vectorData.id,
      vector: vectorData.vector,
      level,
      connections: new Map(),
      ...(vectorData.metadata && { metadata: vectorData.metadata }),
    };

    // Initialize connections for each level
    for (let l = 0; l <= level; l++) {
      node.connections.set(l, new Set());
    }

    // If this is the first node, make it the entry point
    if (this.nodes.size === 0) {
      this.entryPoint = node.id;
      this.nodes.set(node.id, node);
      return;
    }

    this.nodes.set(node.id, node);

    // Find closest nodes for each level
    let currentClosest = this.entryPoint!;

    // Search from top to level+1
    for (
      let currentLevel = this.getNodeLevel(currentClosest);
      currentLevel > level;
      currentLevel--
    ) {
      const searchResults = this.searchLevel(
        node.vector,
        currentClosest,
        1,
        currentLevel,
      );
      if (searchResults.length > 0) {
        currentClosest = searchResults[0]!;
      }
    }

    // Search and connect from level down to 0
    for (
      let currentLevel = Math.min(level, this.getNodeLevel(currentClosest));
      currentLevel >= 0;
      currentLevel--
    ) {
      const candidates = this.searchLevel(
        node.vector,
        currentClosest,
        this.config.efConstruction,
        currentLevel,
      );

      // Select diverse connections
      const connections = this.selectConnections(
        node.vector,
        candidates,
        currentLevel === 0 ? this.config.m * 2 : this.config.m,
      );

      // Add bidirectional connections
      for (const candidateId of connections) {
        this.addConnection(node.id, candidateId, currentLevel);
        this.addConnection(candidateId, node.id, currentLevel);

        // Prune connections if needed
        this.pruneConnections(candidateId, currentLevel);
      }

      if (candidates.length > 0) {
        currentClosest = candidates[0]!;
      }
    }

    // Update entry point if necessary
    if (level > this.getNodeLevel(this.entryPoint!)) {
      this.entryPoint = node.id;
    }
  }

  /**
   * Search for k nearest neighbors
   */
  async search(
    queryVector: Float32Array,
    k: number,
    ef: number = this.config.efConstruction,
  ): Promise<
    Array<{ id: string; distance: number; metadata?: Record<string, unknown> }>
  > {
    if (this.nodes.size === 0 || !this.entryPoint) {
      return [];
    }

    // Search from entry point to level 1
    let currentClosest = this.entryPoint;
    for (let level = this.getNodeLevel(currentClosest); level > 0; level--) {
      const candidates = this.searchLevel(queryVector, currentClosest, 1, level);
      if (candidates.length > 0) {
        currentClosest = candidates[0]!;
      }
    }

    // Search level 0 with ef
    const candidates = this.searchLevel(queryVector, currentClosest, Math.max(ef, k), 0);

    // Return top k results
    return candidates.slice(0, k).map((nodeId) => {
      const node = this.nodes.get(nodeId)!;
      return {
        id: nodeId,
        distance: this.distanceCalculator.calculate(queryVector, node.vector),
        ...(node.metadata && { metadata: node.metadata }),
      };
    });
  }

  /**
   * Remove a vector from the index
   */
  async removeVector(id: string): Promise<void> {
    const node = this.nodes.get(id);
    if (!node) return;

    // Remove all connections to this node
    for (const [level, connections] of node.connections) {
      for (const connectedId of connections) {
        this.removeConnection(connectedId, id, level);
      }
    }

    // Find new entry point if needed
    if (this.entryPoint === id) {
      this.entryPoint = this.findNewEntryPoint();
    }

    this.nodes.delete(id);
  }

  /**
   * Get index statistics
   */
  getStats(): {
    nodeCount: number;
    levels: number[];
    entryPoint: string | null;
    avgConnections: number;
  } {
    const levels: number[] = [];
    let totalConnections = 0;

    for (const node of this.nodes.values()) {
      levels.push(node.level);
      for (const connections of node.connections.values()) {
        totalConnections += connections.size;
      }
    }

    return {
      nodeCount: this.nodes.size,
      levels,
      entryPoint: this.entryPoint,
      avgConnections: this.nodes.size > 0 ? totalConnections / this.nodes.size : 0,
    };
  }

  /**
   * Search within a specific level
   */
  private searchLevel(
    queryVector: Float32Array,
    entryPoint: string,
    ef: number,
    level: number,
  ): string[] {
    const visited = new Set<string>();
    const candidates = new Set<string>();
    const w = new Map<string, number>(); // nodeId -> distance

    // Initialize with entry point
    const entryDistance = this.distanceCalculator.calculate(
      queryVector,
      this.nodes.get(entryPoint)!.vector,
    );

    candidates.add(entryPoint);
    w.set(entryPoint, entryDistance);
    visited.add(entryPoint);

    while (candidates.size > 0) {
      // Get closest candidate
      let closest = '';
      let closestDistance = Infinity;

      for (const nodeId of candidates) {
        const distance = w.get(nodeId)!;
        if (distance < closestDistance) {
          closestDistance = distance;
          closest = nodeId;
        }
      }

      candidates.delete(closest);

      // If we have enough candidates and this is farther than the furthest kept candidate
      if (w.size >= ef) {
        const distances = Array.from(w.values()).sort((a, b) => a - b);
        if (closestDistance > distances[ef - 1]!) {
          break;
        }
      }

      // Explore neighbors
      const node = this.nodes.get(closest)!;
      const connections = node.connections.get(level) || new Set<string>();

      for (const neighborId of connections) {
        if (!visited.has(neighborId)) {
          visited.add(neighborId);

          const neighborDistance = this.distanceCalculator.calculate(
            queryVector,
            this.nodes.get(neighborId)!.vector,
          );

          candidates.add(neighborId);
          w.set(neighborId, neighborDistance);
        }
      }
    }

    // Return ef closest candidates
    return Array.from(w.entries())
      .sort((a, b) => a[1] - b[1])
      .slice(0, ef)
      .map(([nodeId]) => nodeId);
  }

  /**
   * Select connections using a simple heuristic
   */
  private selectConnections(
    queryVector: Float32Array,
    candidates: string[],
    m: number,
  ): string[] {
    // Simple: just take the closest m candidates
    return candidates
      .map((nodeId) => ({
        id: nodeId,
        distance: this.distanceCalculator.calculate(
          queryVector,
          this.nodes.get(nodeId)!.vector,
        ),
      }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, m)
      .map((candidate) => candidate.id);
  }

  /**
   * Add a connection between two nodes
   */
  private addConnection(nodeId: string, targetId: string, level: number): void {
    const node = this.nodes.get(nodeId);
    if (!node) return;

    const connections = node.connections.get(level) || new Set();
    connections.add(targetId);
    node.connections.set(level, connections);
  }

  /**
   * Remove a connection between two nodes
   */
  private removeConnection(nodeId: string, targetId: string, level: number): void {
    const node = this.nodes.get(nodeId);
    if (!node) return;

    const connections = node.connections.get(level);
    if (connections) {
      connections.delete(targetId);
    }
  }

  /**
   * Prune connections to maintain index quality
   */
  private pruneConnections(nodeId: string, level: number): void {
    const node = this.nodes.get(nodeId);
    if (!node) return;

    const connections = node.connections.get(level);
    if (!connections) return;

    const maxConnections = level === 0 ? this.config.m * 2 : this.config.m;
    if (connections.size <= maxConnections) return;

    // Select best connections to keep
    const candidates = Array.from(connections);
    const selectedSet = new Set(this.selectConnections(node.vector, candidates, maxConnections));

    // Collect IDs to remove, then process after iteration to avoid mutating Set during iteration
    const toRemove: string[] = [];
    for (const connectedId of connections) {
      if (!selectedSet.has(connectedId)) {
        toRemove.push(connectedId);
      }
    }
    for (const connectedId of toRemove) {
      this.removeConnection(nodeId, connectedId, level);
      this.removeConnection(connectedId, nodeId, level);
    }
  }

  /**
   * Get the level of a node
   */
  private getNodeLevel(nodeId: string): number {
    const node = this.nodes.get(nodeId);
    return node ? node.level : 0;
  }

  /**
   * Generate a random level for a new node
   */
  private getRandomLevel(): number {
    let level = 0;
    while (this.rng() < 1.0 / this.config.mL && level < this.config.maxLevel) {
      level++;
    }
    return level;
  }

  /**
   * Find a new entry point when the current one is removed
   */
  private findNewEntryPoint(): string | null {
    if (this.nodes.size === 0) return null;

    let highestLevel = -1;
    let newEntryPoint = '';

    for (const [nodeId, node] of this.nodes) {
      if (node.level > highestLevel) {
        highestLevel = node.level;
        newEntryPoint = nodeId;
      }
    }

    return newEntryPoint || null;
  }

  /**
   * Create a seeded random number generator using xoshiro128** seeded via splitmix32
   */
  private createSeededRNG(seed: number): () => number {
    // splitmix32 to derive initial state
    function splitmix32(state: number): number {
      state = (state + 0x9e3779b9) | 0;
      let z = state;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
      return (z ^ (z >>> 16)) >>> 0;
    }

    let s0 = splitmix32(seed);
    let s1 = splitmix32(s0);
    let s2 = splitmix32(s1);
    let s3 = splitmix32(s2);

    return () => {
      const result = Math.imul(s1 * 5, 7) >>> 0;
      const t = (s1 << 9) >>> 0;

      s2 ^= s0;
      s3 ^= s1;
      s1 ^= s2;
      s0 ^= s3;
      s2 ^= t;
      s3 = ((s3 << 11) | (s3 >>> 21)) >>> 0;

      return (result >>> 0) / 0x100000000;
    };
  }

  /**
   * Export the full internal state for serialization.
   */
  exportState(): {
    nodes: Array<{
      id: string;
      vector: number[];
      metadata?: Record<string, unknown>;
      level: number;
      connections: Array<[number, string[]]>;
    }>;
    entryPoint: string | null;
    config: HNSWConfig;
  } {
    const nodes: Array<{
      id: string;
      vector: number[];
      metadata?: Record<string, unknown>;
      level: number;
      connections: Array<[number, string[]]>;
    }> = [];

    for (const node of this.nodes.values()) {
      const connections: Array<[number, string[]]> = [];
      for (const [level, connSet] of node.connections) {
        connections.push([level, Array.from(connSet)]);
      }

      const exported: {
        id: string;
        vector: number[];
        metadata?: Record<string, unknown>;
        level: number;
        connections: Array<[number, string[]]>;
      } = {
        id: node.id,
        vector: Array.from(node.vector),
        level: node.level,
        connections,
      };
      if (node.metadata) {
        exported.metadata = node.metadata;
      }
      nodes.push(exported);
    }

    return {
      nodes,
      entryPoint: this.entryPoint,
      config: { ...this.config },
    };
  }

  /**
   * Import state from a previously exported snapshot, replacing all current data.
   */
  importState(state: {
    nodes: Array<{
      id: string;
      vector: number[];
      metadata?: Record<string, unknown>;
      level: number;
      connections: Array<[number, string[]]>;
    }>;
    entryPoint: string | null;
  }): void {
    this.nodes.clear();
    this.entryPoint = state.entryPoint;

    for (const serialized of state.nodes) {
      const connections = new Map<number, Set<string>>();
      for (const [level, ids] of serialized.connections) {
        connections.set(level, new Set(ids));
      }

      const node: HNSWNode = {
        id: serialized.id,
        vector: new Float32Array(serialized.vector),
        level: serialized.level,
        connections,
      };
      if (serialized.metadata) {
        node.metadata = serialized.metadata;
      }
      this.nodes.set(serialized.id, node);
    }
  }

  /**
   * Clear the index
   */
  clear(): void {
    this.nodes.clear();
    this.entryPoint = null;
  }

  /**
   * Get the size of the index
   */
  size(): number {
    return this.nodes.size;
  }
}
