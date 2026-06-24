const mainEntrypoints = [
  './src/index.ts',
  './src/gpu.ts',
  './src/workers.ts',
  './src/debug.ts',
  './src/benchmarks.ts',
  './src/compression.ts',
];

const adapterEntrypoints = [
  './src/storage/adapters/chrome-storage-adapter.ts',
  './src/storage/adapters/file-system-adapter.ts',
  './src/storage/adapters/indexed-database-adapter.ts',
  './src/storage/adapters/level-adapter.ts',
  './src/storage/adapters/lmdb-adapter.ts',
  './src/storage/adapters/memory-adapter.ts',
  './src/storage/adapters/opfs-adapter.ts',
  './src/storage/adapters/redis-adapter.ts',
  './src/storage/adapters/s3-adapter.ts',
  './src/storage/adapters/sqlite-adapter.ts',
];

const commonjsImportMetaEnvironmentPlugin: Bun.BunPlugin = {
  name: 'commonjs-import-meta-environment',
  setup(build) {
    // Redirect the ESM import-meta shim to the CJS-safe counterpart so that
    // `import.meta` never appears in the CommonJS output.
    build.onResolve({ filter: /import-meta-environment\.(?:js|ts)$/ }, () => ({
      path: new URL(
        '../src/configuration/import-meta-environment.cjs.ts',
        import.meta.url,
      ).pathname,
    }));
  },
};

const buildMode = Bun.argv[2];

if (buildMode !== 'main' && buildMode !== 'adapters') {
  throw new Error(
    `Expected CommonJS build mode to be "main" or "adapters", got "${buildMode}"`,
  );
}

const buildConfiguration: Bun.BuildConfig =
  buildMode === 'adapters'
    ? {
        entrypoints: adapterEntrypoints,
        format: 'cjs',
        outdir: 'dist/cjs/storage/adapters',
        plugins: [commonjsImportMetaEnvironmentPlugin],
        root: 'src/storage/adapters',
        sourcemap: 'external',
        target: 'node',
      }
    : {
        entrypoints: mainEntrypoints,
        format: 'cjs',
        minify: true,
        outdir: 'dist/cjs',
        plugins: [commonjsImportMetaEnvironmentPlugin],
        sourcemap: 'external',
        target: 'browser',
      };

const result = await Bun.build(buildConfiguration);

if (!result.success) {
  for (const log of result.logs) {
    console.error(log);
  }

  throw new Error(`CommonJS ${buildMode ?? 'main'} build failed`);
}

export {};
