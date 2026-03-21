import { afterAll } from 'bun:test';
import { runStorageAdapterTests } from './adapter-test-suite.js';

// ---------------------------------------------------------------------------
// Mock Bun.s3 — in-memory object store
// ---------------------------------------------------------------------------

const objectStore = new Map<string, string>();

function createMockS3File(key: string): {
  text: () => Promise<string>;
  exists: () => Promise<boolean>;
  write: (data: string) => Promise<number>;
  delete: () => Promise<void>;
} {
  return {
    text: async () => {
      const body = objectStore.get(key);
      if (body === undefined) {
        throw new Error(`NoSuchKey: ${key}`);
      }
      return body;
    },
    exists: async () => objectStore.has(key),
    write: async (data: string) => {
      objectStore.set(key, data);
      return data.length;
    },
    delete: async () => {
      objectStore.delete(key);
    },
  };
}

const mockS3 = {
  file: (key: string, _options?: Record<string, unknown>) => createMockS3File(key),
  write: async (key: string, data: string, _options?: Record<string, unknown>) => {
    objectStore.set(key, data);
    return data.length;
  },
  delete: async (key: string, _options?: Record<string, unknown>) => {
    objectStore.delete(key);
  },
  exists: async (key: string, _options?: Record<string, unknown>) => objectStore.has(key),
};

// Patch Bun.s3 so the adapter's init() picks up the mock
const bunRecord = Bun as Record<string, unknown>;
const originalS3 = bunRecord['s3'];
bunRecord['s3'] = mockS3;

afterAll(() => {
  bunRecord['s3'] = originalS3;
});

// ---------------------------------------------------------------------------
// Import adapter AFTER mock is in place
// ---------------------------------------------------------------------------

const { S3StorageAdapter } = await import('@/storage/adapters/s3-adapter.js');

// ---------------------------------------------------------------------------
// Run the shared adapter test suite
// ---------------------------------------------------------------------------

runStorageAdapterTests('S3StorageAdapter', async () => {
  objectStore.clear();
  return new S3StorageAdapter({ bucket: 'test-bucket', prefix: 'test/' });
});
