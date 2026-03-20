import { MemoryStorageAdapter } from '@/storage/adapters/memory-adapter.js';
import { runStorageAdapterTests } from './adapter-test-suite.js';

runStorageAdapterTests(
  'MemoryStorageAdapter',
  () => new MemoryStorageAdapter(),
);
