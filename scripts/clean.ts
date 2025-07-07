#!/usr/bin/env bun
import { rm } from 'node:fs/promises';
import { join } from 'node:path';

const directoriesToClean = ['dist', 'coverage', '.bun', 'node_modules/.cache'];

console.log('🧹 Cleaning project directories...');

for (const dir of directoriesToClean) {
  try {
    await rm(join(process.cwd(), dir), { recursive: true, force: true });
    console.log(`✅ Cleaned ${dir}`);
  } catch (error) {
    console.error(`❌ Failed to clean ${dir}:`, error);
  }
}

console.log('✨ Clean complete!');
