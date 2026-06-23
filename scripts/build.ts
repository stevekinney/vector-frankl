#!/usr/bin/env bun

/**
 * Build script for Vector Frankl JS bundles (ESM and CJS).
 *
 * For CJS builds, a Bun.build onResolve plugin swaps in the CJS-safe shims:
 *   import-meta-environment.js  →  import-meta-environment.cjs.ts
 *   default-worker-script.js    →  default-worker-script.cjs.ts
 *
 * Usage:
 *   bun run scripts/build.ts            # build both ESM and CJS
 *   bun run scripts/build.ts --format=esm
 *   bun run scripts/build.ts --format=cjs
 */

import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';

const ROOT = join(import.meta.dirname, '..');

const entrypoints = [
  join(ROOT, 'src/index.ts'),
  join(ROOT, 'src/gpu.ts'),
  join(ROOT, 'src/workers.ts'),
  join(ROOT, 'src/debug.ts'),
  join(ROOT, 'src/benchmarks.ts'),
  join(ROOT, 'src/compression.ts'),
];

const args = process.argv.slice(2);
const formatArg = args.find((a) => a.startsWith('--format='))?.split('=')[1];

type BuildFormat = 'esm' | 'cjs';

function assertBuildFormat(value: string | undefined): BuildFormat {
  if (value === 'esm' || value === 'cjs') return value;
  if (value !== undefined) {
    console.error(`Unknown --format value: ${value}. Expected 'esm' or 'cjs'.`);
    process.exit(1);
  }
  // undefined means build both
  return 'esm'; // not used when both
}

/**
 * Create a Bun.build onResolve plugin that rewires the two ESM shim modules to
 * their CJS-safe counterparts.  Only applied when building the CJS bundle.
 */
function makeCjsShimPlugin(): import('bun').BunPlugin {
  return {
    name: 'cjs-shims',
    setup(build) {
      // Map the compiled .js imports back to the CJS .ts source files so Bun
      // picks up the CJS-safe implementations instead of the ESM ones.
      const shimMap: Record<string, string> = {
        'import-meta-environment.js': join(
          ROOT,
          'src/configuration/import-meta-environment.cjs.ts',
        ),
        'default-worker-script.js': join(
          ROOT,
          'src/workers/default-worker-script.cjs.ts',
        ),
      };

      build.onResolve({ filter: /import-meta-environment\.(?:js|ts)$/ }, (_args) => {
        return { path: shimMap['import-meta-environment.js']! };
      });

      build.onResolve({ filter: /default-worker-script\.(?:js|ts)$/ }, (_args) => {
        return { path: shimMap['default-worker-script.js']! };
      });
    },
  };
}

async function buildEsm(): Promise<void> {
  console.log('Building ESM bundle…');
  const result = await Bun.build({
    entrypoints,
    outdir: join(ROOT, 'dist'),
    format: 'esm',
    target: 'browser',
    minify: true,
    sourcemap: 'external',
  });

  if (!result.success) {
    console.error('ESM build failed:');
    for (const log of result.logs) {
      console.error(log);
    }
    process.exit(1);
  }
  console.log(`ESM build succeeded (${result.outputs.length} outputs).`);
}

async function buildCjs(): Promise<void> {
  console.log('Building CJS bundle…');
  const result = await Bun.build({
    entrypoints,
    outdir: join(ROOT, 'dist/cjs'),
    format: 'cjs',
    target: 'browser',
    minify: true,
    sourcemap: 'external',
    plugins: [makeCjsShimPlugin()],
  });

  if (!result.success) {
    console.error('CJS build failed:');
    for (const log of result.logs) {
      console.error(log);
    }
    process.exit(1);
  }

  // Write dist/cjs/package.json so Node resolves .js files as CommonJS.
  await writeFile(
    join(ROOT, 'dist/cjs/package.json'),
    JSON.stringify({ type: 'commonjs' }, null, 2) + '\n',
    'utf-8',
  );

  console.log(`CJS build succeeded (${result.outputs.length} outputs).`);
}

async function main(): Promise<void> {
  switch (formatArg) {
    case 'esm': {
      await buildEsm();

      break;
    }
    case 'cjs': {
      await buildCjs();

      break;
    }
    case undefined: {
      // Build both when no --format flag is given
      await buildEsm();
      await buildCjs();

      break;
    }
    default: {
      assertBuildFormat(formatArg);
    }
  }
}

main().catch((error: unknown) => {
  console.error('build failed:', error);
  process.exit(1);
});
