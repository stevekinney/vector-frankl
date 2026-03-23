#!/usr/bin/env bun

// Custom build script for browser e2e tests (unminified to preserve export names)
export {};

console.log('Building for browser...');

const result = await Bun.build({
  entrypoints: ['./src/index.ts'],
  outdir: './dist',
  format: 'esm',
  target: 'browser',
  minify: false,
  sourcemap: 'none',
  splitting: false,
});

if (!result.success) {
  console.error('Build failed:');
  for (const message of result.logs) {
    console.error(message);
  }
  process.exit(1);
}

// Build browser-compatible storage adapters (OPFS only — SQLite/FileSystem
// have non-browser dependencies and are excluded).
const storageResult = await Bun.build({
  entrypoints: ['./src/storage/adapters/opfs-adapter.ts'],
  outdir: './dist',
  format: 'esm',
  target: 'browser',
  minify: false,
  sourcemap: 'none',
  splitting: false,
  naming: '[dir]/storage.[ext]',
});

if (!storageResult.success) {
  console.error('Storage adapter build failed:');
  for (const message of storageResult.logs) {
    console.error(message);
  }
  process.exit(1);
}

console.log('Storage adapter build completed');
console.log('Build completed successfully');
console.log(`Output: ${result.outputs.map((o) => o.path).join(', ')}`);
