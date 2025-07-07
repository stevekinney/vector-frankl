import { describe, expect, it } from 'bun:test';

import { VectorDB } from '@/index.js';
import { cleanupIndexedDBMocks, setupIndexedDBMocks } from './mocks/indexeddb-mock.js';

describe('Debug Mock Test', () => {
  it('should work with basic IndexedDB operations', async () => {
    setupIndexedDBMocks();

    // Test IndexedDB directly first
    console.log('Testing IndexedDB directly...');
    const request = global.indexedDB.open('test-direct', 1);

    await new Promise((resolve, reject) => {
      request.onsuccess = () => {
        console.log('Direct IndexedDB open success, result:', request.result);
        resolve(request.result);
      };
      request.onerror = () => {
        console.log('Direct IndexedDB open error:', request.error);
        reject(request.error);
      };
      request.onupgradeneeded = () => {
        console.log('Direct IndexedDB upgrade needed');
        const db = request.result;
        console.log('DB in upgrade:', db);
      };
    });

    try {
      const db = new VectorDB('test-debug', 3);
      await db.init();

      console.log('Database initialized');

      const vector = new Float32Array([1, 0, 0]);
      await db.addVector('test', vector, { test: true });

      console.log('Vector added');

      const retrieved = await db.getVector('test');
      console.log('Retrieved:', retrieved);

      expect(retrieved).toBeTruthy();
    } finally {
      cleanupIndexedDBMocks();
    }
  });
});
