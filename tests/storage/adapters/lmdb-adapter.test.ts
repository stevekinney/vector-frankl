import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LmdbStorageAdapter } from '@/storage/adapters/lmdb-adapter.js';
import { runStorageAdapterTests } from './adapter-test-suite.js';

let tempDirectory: string;

runStorageAdapterTests(
  'LmdbStorageAdapter',
  async () => {
    tempDirectory = await mkdtemp(join(tmpdir(), 'vf-lmdb-test-'));
    return new LmdbStorageAdapter({ directory: tempDirectory });
  },
  async () => {
    await rm(tempDirectory, { recursive: true, force: true });
  },
);
