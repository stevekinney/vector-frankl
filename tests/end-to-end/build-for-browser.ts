#!/usr/bin/env bun

import { $ } from 'bun';

console.log('Building for browser...');

await $`bun run build`;

console.log('Build completed successfully');
console.log('Output: dist/index.js');
