import { describe, expect, it } from 'bun:test';

import { VectorDB } from '@/index.js';

import { cleanupIndexedDBMocks, setupIndexedDBMocks } from './mocks/indexeddb-mock.js';

describe('Debug Mock Test', () => {
  it('should work with basic IndexedDB operations', async () => {
    setupIndexedDBMocks();

    const request = global.indexedDB.open('test-direct', 1);
    let upgradeNeeded = false;

    await new Promise((resolve, reject) => {
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        reject(request.error);
      };
      request.onupgradeneeded = () => {
        upgradeNeeded = true;
        expect(request.result).toBeTruthy();
      };
    });
    expect(upgradeNeeded).toBe(true);

    try {
      const db = new VectorDB('test-debug', 3);
      await db.init();

      const vector = new Float32Array([1, 0, 0]);
      await db.addVector('test', vector, { test: true });

      const retrieved = await db.getVector('test');

      expect(retrieved).toBeTruthy();
    } finally {
      cleanupIndexedDBMocks();
    }
  });
});
