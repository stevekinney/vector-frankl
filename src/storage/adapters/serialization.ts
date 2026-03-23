import type { VectorData } from '@/core/types.js';

// ---------------------------------------------------------------------------
// Shared serialization utilities used by multiple storage adapters
// ---------------------------------------------------------------------------

/**
 * Intermediate JSON-safe representation of a VectorData record.
 * Float32Array is stored as a plain number array for JSON.stringify().
 */
export interface SerializedVectorData {
  id: string;
  vector: number[];
  metadata?: Record<string, unknown>;
  magnitude: number;
  format?: string;
  normalized?: boolean;
  timestamp: number;
  lastAccessed?: number;
  accessCount?: number;
  compression?: VectorData['compression'];
}

/** Calculate the magnitude (L2 norm) of a vector. */
export function calculateMagnitude(vector: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < vector.length; i++) {
    sum += vector[i]! * vector[i]!;
  }
  return Math.sqrt(sum);
}

/** Serialize a VectorData record to a JSON string. */
export function vectorDataToJson(data: VectorData): string {
  const serialized: SerializedVectorData = {
    id: data.id,
    vector: Array.from(data.vector),
    magnitude: data.magnitude,
    timestamp: data.timestamp,
  };

  if (data.metadata !== undefined) {
    serialized.metadata = data.metadata;
  }
  if (data.format !== undefined) {
    serialized.format = data.format;
  }
  if (data.normalized !== undefined) {
    serialized.normalized = data.normalized;
  }
  if (data.lastAccessed !== undefined) {
    serialized.lastAccessed = data.lastAccessed;
  }
  if (data.accessCount !== undefined) {
    serialized.accessCount = data.accessCount;
  }
  if (data.compression !== undefined) {
    serialized.compression = data.compression;
  }

  return JSON.stringify(serialized);
}

/** Deserialize a JSON string into a VectorData record. */
export function jsonToVectorData(json: string): VectorData {
  const parsed = JSON.parse(json) as SerializedVectorData;
  const result: VectorData = {
    id: parsed.id,
    vector: new Float32Array(parsed.vector),
    magnitude: parsed.magnitude,
    timestamp: parsed.timestamp,
  };

  if (parsed.metadata !== undefined) {
    result.metadata = parsed.metadata;
  }
  if (parsed.format !== undefined) {
    result.format = parsed.format;
  }
  if (parsed.normalized !== undefined) {
    result.normalized = parsed.normalized;
  }
  if (parsed.lastAccessed !== undefined) {
    result.lastAccessed = parsed.lastAccessed;
  }
  if (parsed.accessCount !== undefined) {
    result.accessCount = parsed.accessCount;
  }
  if (parsed.compression !== undefined) {
    result.compression = parsed.compression;
  }

  return result;
}
