import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LevelStorageAdapter } from '@/storage/adapters/level-adapter.js';
import { runStorageAdapterTests } from './adapter-test-suite.js';

let tempDirectory: string;

runStorageAdapterTests(
  'LevelStorageAdapter',
  async () => {
    tempDirectory = await mkdtemp(join(tmpdir(), 'vf-level-test-'));
    return new LevelStorageAdapter({ directory: tempDirectory });
  },
  async (adapter) => {
    await adapter.destroy();
    await rm(tempDirectory, { recursive: true, force: true });
  },
);
