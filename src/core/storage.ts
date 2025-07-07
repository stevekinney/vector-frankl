import { VectorDatabase } from './database.js';
import { BatchOperationError, TransactionError, VectorNotFoundError } from './errors.js';
import type { BatchOptions, BatchProgress, VectorData } from './types.js';

// Default batch size constant
const DEFAULT_BATCH_SIZE = 1000;

/**
 * Storage operations for vectors
 */
export class VectorStorage {
  constructor(private database: VectorDatabase) {}

  /**
   * Store a single vector
   */
  async put(vector: VectorData): Promise<void> {
    await this.database.executeTransaction(
      VectorDatabase.STORES.VECTORS,
      'readwrite',
      async (transaction) => {
        const store = transaction.objectStore(VectorDatabase.STORES.VECTORS);

        // Update timestamp
        const vectorToStore = {
          ...vector,
          timestamp: vector.timestamp || Date.now(),
          lastAccessed: Date.now(),
        };

        return new Promise<void>((resolve, reject) => {
          const request = store.put(vectorToStore);

          request.onsuccess = () => resolve();
          request.onerror = () =>
            reject(
              new TransactionError(
                'put vector',
                `Failed to store vector with ID: ${vector.id}`,
                request.error || undefined,
              ),
            );
        });
      },
    );
  }

  /**
   * Get a vector by ID
   */
  async get(id: string): Promise<VectorData> {
    const result = await this.database.executeTransaction(
      VectorDatabase.STORES.VECTORS,
      'readwrite', // readwrite to update lastAccessed
      async (transaction) => {
        const store = transaction.objectStore(VectorDatabase.STORES.VECTORS);

        return new Promise<VectorData>((resolve, reject) => {
          const request = store.get(id);

          request.onsuccess = () => {
            const vector = request.result;

            if (!vector) {
              reject(new VectorNotFoundError(id));
              return;
            }

            // Update access metadata
            vector.lastAccessed = Date.now();
            vector.accessCount = (vector.accessCount || 0) + 1;

            // Store updated metadata
            const updateRequest = store.put(vector);

            updateRequest.onsuccess = () => resolve(vector);
            updateRequest.onerror = () =>
              reject(
                new TransactionError(
                  'update access metadata',
                  `Failed to update access metadata for vector: ${id}`,
                  updateRequest.error || undefined,
                ),
              );
          };

          request.onerror = () =>
            reject(
              new TransactionError(
                'get vector',
                `Failed to retrieve vector with ID: ${id}`,
                request.error || undefined,
              ),
            );
        });
      },
    );

    return result;
  }

  /**
   * Get multiple vectors by IDs
   */
  async getMany(ids: string[]): Promise<VectorData[]> {
    const results = await this.database.executeTransaction(
      VectorDatabase.STORES.VECTORS,
      'readwrite',
      async (transaction) => {
        const store = transaction.objectStore(VectorDatabase.STORES.VECTORS);
        const vectors: VectorData[] = [];
        const errors: Array<{ id: string; error: Error }> = [];

        await Promise.all(
          ids.map(
            (id) =>
              new Promise<void>((resolve) => {
                const request = store.get(id);

                request.onsuccess = () => {
                  const vector = request.result;

                  if (vector) {
                    // Update access metadata
                    vector.lastAccessed = Date.now();
                    vector.accessCount = (vector.accessCount || 0) + 1;

                    const updateRequest = store.put(vector);
                    updateRequest.onsuccess = () => {
                      vectors.push(vector);
                      resolve();
                    };
                    updateRequest.onerror = () => {
                      errors.push({
                        id,
                        error: new TransactionError(
                          'update access metadata',
                          `Failed to update metadata for vector: ${id}`,
                          updateRequest.error || undefined,
                        ),
                      });
                      resolve();
                    };
                  } else {
                    errors.push({ id, error: new VectorNotFoundError(id) });
                    resolve();
                  }
                };

                request.onerror = () => {
                  errors.push({
                    id,
                    error: new TransactionError(
                      'get vector',
                      `Failed to retrieve vector: ${id}`,
                      request.error || undefined,
                    ),
                  });
                  resolve();
                };
              }),
          ),
        );

        if (errors.length > 0 && errors.length === ids.length) {
          throw new BatchOperationError(0, errors.length, errors);
        }

        return { vectors, errors };
      },
    );

    if (results.errors.length > 0) {
      console.warn(
        `Failed to retrieve ${results.errors.length} vectors:`,
        results.errors,
      );
    }

    return results.vectors;
  }

  /**
   * Check if a vector exists
   */
  async exists(id: string): Promise<boolean> {
    return this.database.executeTransaction(
      VectorDatabase.STORES.VECTORS,
      'readonly',
      async (transaction) => {
        const store = transaction.objectStore(VectorDatabase.STORES.VECTORS);

        return new Promise<boolean>((resolve, reject) => {
          const request = store.count(id);

          request.onsuccess = () => resolve(request.result > 0);
          request.onerror = () =>
            reject(
              new TransactionError(
                'check existence',
                `Failed to check if vector exists: ${id}`,
                request.error || undefined,
              ),
            );
        });
      },
    );
  }

  /**
   * Delete a vector by ID
   */
  async delete(id: string): Promise<void> {
    await this.database.executeTransaction(
      VectorDatabase.STORES.VECTORS,
      'readwrite',
      async (transaction) => {
        const store = transaction.objectStore(VectorDatabase.STORES.VECTORS);

        return new Promise<void>((resolve, reject) => {
          const request = store.delete(id);

          request.onsuccess = () => resolve();
          request.onerror = () =>
            reject(
              new TransactionError(
                'delete vector',
                `Failed to delete vector with ID: ${id}`,
                request.error || undefined,
              ),
            );
        });
      },
    );
  }

  /**
   * Delete multiple vectors by IDs
   */
  async deleteMany(ids: string[]): Promise<number> {
    const result = await this.database.executeTransaction(
      VectorDatabase.STORES.VECTORS,
      'readwrite',
      async (transaction) => {
        const store = transaction.objectStore(VectorDatabase.STORES.VECTORS);
        let deletedCount = 0;
        const errors: Array<{ id: string; error: Error }> = [];

        await Promise.all(
          ids.map(
            (id) =>
              new Promise<void>((resolve) => {
                const request = store.delete(id);

                request.onsuccess = () => {
                  deletedCount++;
                  resolve();
                };

                request.onerror = () => {
                  errors.push({
                    id,
                    error: new TransactionError(
                      'delete vector',
                      `Failed to delete vector: ${id}`,
                      request.error || undefined,
                    ),
                  });
                  resolve();
                };
              }),
          ),
        );

        if (errors.length > 0 && errors.length === ids.length) {
          throw new BatchOperationError(0, errors.length, errors);
        }

        return { deletedCount, errors };
      },
    );

    if (result.errors.length > 0) {
      console.warn(`Failed to delete ${result.errors.length} vectors:`, result.errors);
    }

    return result.deletedCount;
  }

  /**
   * Get all vectors
   */
  async getAll(): Promise<VectorData[]> {
    return this.database.executeTransaction(
      VectorDatabase.STORES.VECTORS,
      'readonly',
      async (transaction) => {
        const store = transaction.objectStore(VectorDatabase.STORES.VECTORS);

        return new Promise<VectorData[]>((resolve, reject) => {
          const request = store.getAll();

          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () =>
            reject(
              new TransactionError(
                'get all vectors',
                'Failed to retrieve all vectors',
                request.error || undefined,
              ),
            );
        });
      },
    );
  }

  /**
   * Get vector count
   */
  async count(): Promise<number> {
    return this.database.executeTransaction(
      VectorDatabase.STORES.VECTORS,
      'readonly',
      async (transaction) => {
        const store = transaction.objectStore(VectorDatabase.STORES.VECTORS);

        return new Promise<number>((resolve, reject) => {
          const request = store.count();

          request.onsuccess = () => resolve(request.result);
          request.onerror = () =>
            reject(
              new TransactionError(
                'count vectors',
                'Failed to count vectors',
                request.error || undefined,
              ),
            );
        });
      },
    );
  }

  /**
   * Clear all vectors
   */
  async clear(): Promise<void> {
    await this.database.executeTransaction(
      VectorDatabase.STORES.VECTORS,
      'readwrite',
      async (transaction) => {
        const store = transaction.objectStore(VectorDatabase.STORES.VECTORS);

        return new Promise<void>((resolve, reject) => {
          const request = store.clear();

          request.onsuccess = () => resolve();
          request.onerror = () =>
            reject(
              new TransactionError(
                'clear vectors',
                'Failed to clear all vectors',
                request.error || undefined,
              ),
            );
        });
      },
    );
  }

  /**
   * Batch put vectors with progress reporting
   */
  async putBatch(vectors: VectorData[], options: BatchOptions = {}): Promise<void> {
    const { batchSize = 1000, onProgress, abortSignal } = options;

    const total = vectors.length;
    let completed = 0;
    let failed = 0;
    const errors: Array<{ id: string; error: Error }> = [];

    // Process in batches
    for (let i = 0; i < total; i += batchSize) {
      if (abortSignal?.aborted) {
        throw new Error('Batch operation aborted');
      }

      const batch = vectors.slice(i, i + batchSize);
      const batchResult = await this.processBatch(batch);

      completed += batchResult.succeeded;
      failed += batchResult.failed;
      errors.push(...batchResult.errors);

      if (onProgress) {
        const progress: BatchProgress = {
          total,
          completed,
          failed,
          percentage: Math.round((completed / total) * 100),
          currentBatch: Math.floor(i / batchSize) + 1,
          totalBatches: Math.ceil(total / batchSize),
        };
        onProgress(progress);
      }
    }

    if (failed > 0) {
      throw new BatchOperationError(completed, failed, errors);
    }
  }

  /**
   * Process a single batch of vectors
   */
  private async processBatch(vectors: VectorData[]): Promise<{
    succeeded: number;
    failed: number;
    errors: Array<{ id: string; error: Error }>;
  }> {
    return this.database.executeTransaction(
      VectorDatabase.STORES.VECTORS,
      'readwrite',
      async (transaction) => {
        const store = transaction.objectStore(VectorDatabase.STORES.VECTORS);
        let succeeded = 0;
        let failed = 0;
        const errors: Array<{ id: string; error: Error }> = [];

        await Promise.all(
          vectors.map(
            (vector) =>
              new Promise<void>((resolve) => {
                const vectorToStore = {
                  ...vector,
                  timestamp: vector.timestamp || Date.now(),
                  lastAccessed: Date.now(),
                };

                const request = store.put(vectorToStore);

                request.onsuccess = () => {
                  succeeded++;
                  resolve();
                };

                request.onerror = () => {
                  failed++;
                  errors.push({
                    id: vector.id,
                    error: new TransactionError(
                      'put vector',
                      `Failed to store vector: ${vector.id}`,
                      request.error || undefined,
                    ),
                  });
                  resolve();
                };
              }),
          ),
        );

        return { succeeded, failed, errors };
      },
    );
  }

  /**
   * Update a vector's data
   */
  async updateVector(
    id: string,
    vector: Float32Array,
    options?: {
      updateMagnitude?: boolean;
      updateTimestamp?: boolean;
    },
  ): Promise<void> {
    await this.database.executeTransaction(
      VectorDatabase.STORES.VECTORS,
      'readwrite',
      async (transaction) => {
        const store = transaction.objectStore(VectorDatabase.STORES.VECTORS);

        const existingVector = await this.getVectorFromStore(store, id);
        if (!existingVector) {
          throw new VectorNotFoundError(id);
        }

        // Update vector data
        existingVector.vector = vector;

        // Update magnitude if requested or if it doesn't exist
        if (options?.updateMagnitude !== false || !existingVector.magnitude) {
          let magnitude = 0;
          for (let i = 0; i < vector.length; i++) {
            magnitude += vector[i]! * vector[i]!;
          }
          existingVector.magnitude = Math.sqrt(magnitude);
        }

        // Update timestamp if requested (default true)
        if (options?.updateTimestamp !== false) {
          existingVector.timestamp = Date.now();
        }

        await this.putVectorInStore(store, existingVector);
      },
    );
  }

  /**
   * Update a vector's metadata
   */
  async updateMetadata(
    id: string,
    metadata: Record<string, unknown>,
    options?: {
      merge?: boolean;
      updateTimestamp?: boolean;
    },
  ): Promise<void> {
    await this.database.executeTransaction(
      VectorDatabase.STORES.VECTORS,
      'readwrite',
      async (transaction) => {
        const store = transaction.objectStore(VectorDatabase.STORES.VECTORS);

        const existingVector = await this.getVectorFromStore(store, id);
        if (!existingVector) {
          throw new VectorNotFoundError(id);
        }

        // Update metadata - merge by default
        if (options?.merge !== false) {
          existingVector.metadata = {
            ...existingVector.metadata,
            ...metadata,
          };
        } else {
          existingVector.metadata = metadata;
        }

        // Update timestamp if requested (default true)
        if (options?.updateTimestamp !== false) {
          existingVector.timestamp = Date.now();
        }

        await this.putVectorInStore(store, existingVector);
      },
    );
  }

  /**
   * Update multiple vectors in a batch
   */
  async updateBatch(
    updates: Array<{
      id: string;
      vector?: Float32Array;
      metadata?: Record<string, unknown>;
    }>,
    options?: BatchOptions,
  ): Promise<{
    succeeded: number;
    failed: number;
    errors: Array<{ id: string; error: Error }>;
  }> {
    const batchSize = options?.batchSize || DEFAULT_BATCH_SIZE;
    const chunks = [];

    for (let i = 0; i < updates.length; i += batchSize) {
      chunks.push(updates.slice(i, i + batchSize));
    }

    let succeeded = 0;
    let failed = 0;
    const errors: Array<{ id: string; error: Error }> = [];

    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      const chunk = chunks[chunkIndex]!;

      if (options?.abortSignal?.aborted) {
        throw new BatchOperationError(succeeded, failed, [
          { id: 'batch', error: new Error('Batch update aborted') },
        ]);
      }

      const result = await this.database.executeTransaction(
        VectorDatabase.STORES.VECTORS,
        'readwrite',
        async (transaction) => {
          const store = transaction.objectStore(VectorDatabase.STORES.VECTORS);
          const chunkSucceeded: string[] = [];
          const chunkErrors: Array<{ id: string; error: Error }> = [];

          await Promise.all(
            chunk.map(async (update) => {
              try {
                const existingVector = await this.getVectorFromStore(store, update.id);
                if (!existingVector) {
                  throw new VectorNotFoundError(update.id);
                }

                // Update vector if provided
                if (update.vector) {
                  existingVector.vector = update.vector;
                  // Recalculate magnitude
                  let magnitude = 0;
                  for (let i = 0; i < update.vector.length; i++) {
                    magnitude += update.vector[i]! * update.vector[i]!;
                  }
                  existingVector.magnitude = Math.sqrt(magnitude);
                }

                // Update metadata if provided
                if (update.metadata !== undefined) {
                  existingVector.metadata = {
                    ...existingVector.metadata,
                    ...update.metadata,
                  };
                }

                // Update timestamp
                existingVector.timestamp = Date.now();

                await this.putVectorInStore(store, existingVector);
                chunkSucceeded.push(update.id);
              } catch (error) {
                chunkErrors.push({
                  id: update.id,
                  error: error instanceof Error ? error : new Error(String(error)),
                });
              }
            }),
          );

          return { succeeded: chunkSucceeded, errors: chunkErrors };
        },
      );

      succeeded += result.succeeded.length;
      failed += result.errors.length;
      errors.push(...result.errors);

      // Report progress
      if (options?.onProgress) {
        const completed = (chunkIndex + 1) * batchSize;
        const total = updates.length;
        options.onProgress({
          completed: Math.min(completed, total),
          total,
          failed,
          percentage: Math.round((Math.min(completed, total) / total) * 100),
          currentBatch: chunkIndex + 1,
          totalBatches: chunks.length,
        });
      }
    }

    return { succeeded, failed, errors };
  }

  /**
   * Get a vector from store within a transaction
   */
  private async getVectorFromStore(
    store: IDBObjectStore,
    id: string,
  ): Promise<VectorData | null> {
    return new Promise((resolve, reject) => {
      const request = store.get(id);

      request.onsuccess = () => {
        resolve(request.result || null);
      };

      request.onerror = () => {
        reject(
          new TransactionError(
            'get vector from store',
            `Failed to get vector ${id} from store`,
            request.error || undefined,
          ),
        );
      };
    });
  }

  /**
   * Put a vector into store within a transaction
   */
  private async putVectorInStore(
    store: IDBObjectStore,
    vector: VectorData,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const vectorToStore = {
        ...vector,
        lastAccessed: Date.now(),
      };

      const request = store.put(vectorToStore);

      request.onsuccess = () => {
        resolve();
      };

      request.onerror = () => {
        reject(
          new TransactionError(
            'put vector in store',
            `Failed to put vector ${vector.id} into store`,
            request.error || undefined,
          ),
        );
      };
    });
  }
}
