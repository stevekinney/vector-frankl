/**
 * Vector database Web Worker for parallel processing
 */

import type { DistanceMetric, VectorData } from '../core/types.js';
import { createDistanceCalculator } from '../search/distance-metrics.js';

// Worker message types
interface WorkerTask {
  taskId: string;
  operation: string;
  data: unknown;
}

interface WorkerResponse {
  taskId: string;
  result?: unknown;
  error?: string;
}

// Helper function to convert distance to score
function distanceToScore(distance: number, metric: DistanceMetric): number {
  switch (metric) {
    case 'cosine':
      // Cosine distance is in range [0, 2], convert to similarity [0, 1]
      return 1 - distance / 2;
    case 'dot':
      // Dot product is negative distance, convert back
      return -distance;
    case 'euclidean':
    case 'manhattan':
      // Convert distance to similarity using exponential decay
      return Math.exp(-distance);
    case 'hamming':
    case 'jaccard':
      // These are already in [0, 1] range
      return 1 - distance;
    default:
      // Generic conversion
      return 1 / (1 + distance);
  }
}

// Main message handler
self.onmessage = async (event: MessageEvent<WorkerTask>) => {
  const { taskId, operation, data } = event.data;

  try {
    let result;

    switch (operation) {
      case 'similarity_search':
        result = await performSimilaritySearch(
          data as Parameters<typeof performSimilaritySearch>[0],
        );
        break;

      case 'batch_similarity':
        result = await performBatchSimilarity(
          data as Parameters<typeof performBatchSimilarity>[0],
        );
        break;

      case 'vector_normalize':
        result = normalizeVectors(data as Parameters<typeof normalizeVectors>[0]);
        break;

      case 'distance_calculation':
        result = calculateDistances(data as Parameters<typeof calculateDistances>[0]);
        break;

      case 'vector_quantization':
        result = quantizeVectors(data as Parameters<typeof quantizeVectors>[0]);
        break;

      default:
        throw new Error(`Unknown operation: ${operation}`);
    }

    const response: WorkerResponse = { taskId, result };
    self.postMessage(response);
  } catch (error) {
    const response: WorkerResponse = {
      taskId,
      error: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(response);
  }
};

/**
 * Perform similarity search on a subset of vectors
 */
async function performSimilaritySearch(data: {
  vectors: VectorData[];
  queryVector: Float32Array;
  k: number;
  metric: DistanceMetric;
  filter?: (metadata: Record<string, unknown>) => boolean;
}): Promise<
  Array<{
    id: string;
    distance: number;
    score: number;
    metadata?: Record<string, unknown>;
  }>
> {
  const { vectors, queryVector, k, metric, filter } = data;

  const calculator = createDistanceCalculator(metric);
  const results: Array<{
    id: string;
    distance: number;
    score: number;
    metadata?: Record<string, unknown>;
  }> = [];

  for (const vector of vectors) {
    // Apply filter if provided
    if (filter && !filter(vector.metadata || {})) {
      continue;
    }

    const distance = calculator.calculate(queryVector, vector.vector);
    const score = distanceToScore(distance, metric);

    const result: {
      id: string;
      distance: number;
      score: number;
      metadata?: Record<string, unknown>;
    } = {
      id: vector.id,
      distance,
      score,
    };
    if (vector.metadata) {
      result.metadata = vector.metadata;
    }
    results.push(result);
  }

  // Sort by score (highest first) and return top k
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, k);
}

/**
 * Calculate similarities for multiple queries against multiple vectors
 */
async function performBatchSimilarity(data: {
  vectors: VectorData[];
  queries: Float32Array[];
  metric: DistanceMetric;
}): Promise<number[][]> {
  const { vectors, queries, metric } = data;
  const calculator = createDistanceCalculator(metric);

  const results: number[][] = [];

  for (const query of queries) {
    const similarities: number[] = [];

    for (const vector of vectors) {
      const distance = calculator.calculate(query, vector.vector);
      const score = distanceToScore(distance, metric);
      similarities.push(score);
    }

    results.push(similarities);
  }

  return results;
}

/**
 * Normalize a batch of vectors
 */
function normalizeVectors(data: { vectors: Float32Array[] }): Float32Array[] {
  return data.vectors.map((vector) => {
    const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));

    if (magnitude === 0) return vector;

    const normalized = new Float32Array(vector.length);
    for (let i = 0; i < vector.length; i++) {
      normalized[i] = vector[i]! / magnitude;
    }

    return normalized;
  });
}

/**
 * Calculate distances between vectors
 */
function calculateDistances(data: {
  vectorsA: Float32Array[];
  vectorsB: Float32Array[];
  metric: DistanceMetric;
}): number[][] {
  const { vectorsA, vectorsB, metric } = data;
  const calculator = createDistanceCalculator(metric);

  const results: number[][] = [];

  for (const vecA of vectorsA) {
    const distances: number[] = [];

    for (const vecB of vectorsB) {
      distances.push(calculator.calculate(vecA, vecB));
    }

    results.push(distances);
  }

  return results;
}

/**
 * Quantize vectors to reduce memory usage
 */
function quantizeVectors(data: { vectors: Float32Array[]; bits: number }): {
  quantized: Int8Array[];
  scales: number[];
} {
  const { vectors, bits } = data;

  if (bits !== 8) {
    throw new Error('Only 8-bit quantization is currently supported');
  }

  const quantized: Int8Array[] = [];
  const scales: number[] = [];

  for (const vector of vectors) {
    // Find min and max values
    let min = Infinity;
    let max = -Infinity;

    for (const val of vector) {
      min = Math.min(min, val);
      max = Math.max(max, val);
    }

    // Calculate scale factor
    const range = Math.max(Math.abs(min), Math.abs(max));
    const scale = range > 0 ? 127 / range : 1;

    // Quantize
    const quantizedVector = new Int8Array(vector.length);
    for (let i = 0; i < vector.length; i++) {
      quantizedVector[i] = Math.round(Math.max(-128, Math.min(127, vector[i]! * scale)));
    }

    quantized.push(quantizedVector);
    scales.push(1 / scale);
  }

  return { quantized, scales };
}

// Handle SharedArrayBuffer operations if available
if (typeof SharedArrayBuffer !== 'undefined') {
  // Register handler for shared memory operations
  self.onmessage = async (event: MessageEvent) => {
    const { taskId, operation, data } = event.data;

    if (operation === 'shared_similarity_search') {
      try {
        const result = await performSharedSimilaritySearch(data);
        self.postMessage({ taskId, result });
      } catch (error) {
        self.postMessage({
          taskId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  };
}

/**
 * Perform similarity search using SharedArrayBuffer for zero-copy
 */
async function performSharedSimilaritySearch(data: {
  sharedBuffer: SharedArrayBuffer;
  vectorCount: number;
  dimension: number;
  queryVector?: Float32Array;
  queryOffset?: number;
  k: number;
  metric: DistanceMetric;
  startIdx: number;
  endIdx: number;
  layout?: {
    headerSize: number;
    dataOffset: number;
    vectorCount: number;
    dimension: number;
  };
}): Promise<Array<{ index: number; distance: number; score: number }>> {
  const {
    sharedBuffer,
    dimension,
    queryVector,
    queryOffset,
    k,
    metric,
    startIdx,
    endIdx,
    layout,
  } = data;

  const calculator = createDistanceCalculator(metric);
  const results: Array<{ index: number; distance: number; score: number }> = [];

  // Determine data layout
  const dataOffset = layout?.dataOffset || 0;
  const sharedArray = new Float32Array(sharedBuffer, dataOffset);

  // Get query vector (either provided directly or from shared buffer)
  let query: Float32Array;
  if (queryVector) {
    query = queryVector;
  } else if (queryOffset !== undefined) {
    query = new Float32Array(sharedBuffer, queryOffset, dimension);
  } else {
    throw new Error('No query vector provided');
  }

  // Check if data is quantized (basic check)
  const isQuantized =
    layout && sharedBuffer.byteLength < layout.vectorCount * dimension * 4;

  for (let i = startIdx; i < endIdx; i++) {
    let vector: Float32Array;

    if (isQuantized) {
      // Handle quantized data
      const quantizedData = new Int8Array(
        sharedBuffer,
        dataOffset + i * dimension,
        dimension,
      );
      vector = dequantizeVector(quantizedData);
    } else {
      // Handle regular float32 data
      const vectorStart = i * dimension;
      vector = sharedArray.slice(vectorStart, vectorStart + dimension);
    }

    const distance = calculator.calculate(query, vector);
    const score = distanceToScore(distance, metric);

    results.push({ index: i, distance, score });
  }

  // Sort by score and return top k
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, k);
}

/**
 * Dequantize a quantized vector back to Float32Array
 */
function dequantizeVector(quantized: Int8Array, scale: number = 1 / 127): Float32Array {
  const result = new Float32Array(quantized.length);
  for (let i = 0; i < quantized.length; i++) {
    result[i] = quantized[i]! * scale;
  }
  return result;
}

export {};
