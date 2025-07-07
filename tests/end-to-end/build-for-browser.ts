#!/usr/bin/env bun

// Custom build script for browser compatibility
import { file } from 'bun';

console.log('Building for browser...');

const result = await Bun.build({
  entrypoints: ['./src/index.ts'],
  outdir: './dist',
  format: 'esm',
  target: 'browser',
  minify: true,
  sourcemap: 'external',
  splitting: false,
  naming: '[dir]/[name].[ext]',
});

if (!result.success) {
  console.error('Build failed:');
  for (const message of result.logs) {
    console.error(message);
  }
  process.exit(1);
}

// Read the built file and ensure it has proper exports
const builtFile = await file('./dist/index.js').text();

// Check if exports are present
const hasVectorDB = builtFile.includes('class c{') || builtFile.includes('VectorDB');
const hasVectorFrankl =
  builtFile.includes('class k1{') || builtFile.includes('VectorFrankl');

if (!hasVectorDB || !hasVectorFrankl) {
  console.warn('Main classes may not be properly exported, checking build...');
}

// Check if main exports are present
const hasMainExports =
  builtFile.includes('VectorDB') && builtFile.includes('VectorFrankl');

if (!hasMainExports) {
  console.warn('Main exports not found in built file');
  // Only add exports that aren't already present
  let exportCode = '';

  if (!builtFile.includes('export { c as VectorDB }')) {
    exportCode += 'export { c as VectorDB };\n';
  }
  if (!builtFile.includes('export { k1 as VectorFrankl }')) {
    exportCode += 'export { k1 as VectorFrankl };\n';
  }

  if (exportCode) {
    const newContent = builtFile + '\n' + exportCode;
    await Bun.write('./dist/index.js', newContent);
    console.log('Added missing exports to built file');
  }
} else {
  console.log('Exports already present in built file');
}

console.log('Build completed successfully');
console.log(`Output: ${result.outputs.map((o) => o.path).join(', ')}`);
