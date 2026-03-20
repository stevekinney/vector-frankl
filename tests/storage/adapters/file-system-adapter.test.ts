import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSystemStorageAdapter } from '@/storage/adapters/file-system-adapter.js';
import { runStorageAdapterTests } from './adapter-test-suite.js';

let tempDirectory: string;

runStorageAdapterTests(
  'FileSystemStorageAdapter',
  async () => {
    tempDirectory = await mkdtemp(join(tmpdir(), 'vf-fs-test-'));
    return new FileSystemStorageAdapter({ directory: tempDirectory });
  },
  async () => {
    await rm(tempDirectory, { recursive: true, force: true });
  },
);
