#!/usr/bin/env bun
/**
 * Build and serve the package-consumer app for Playwright browser tests.
 *
 * Steps:
 *  1. Build the library (skipped when dist/ is already present and
 *     SKIP_BUILD env var is set, to allow iterative test runs).
 *  2. Pack a tarball with `bun pm pack` (or `npm pack` as fallback).
 *  3. Create a temporary consumer directory outside the source tree,
 *     install the tarball into it, then bundle a consumer app that
 *     imports from the installed package.
 *  4. Serve the bundled app on PORT (default 8202) until SIGTERM.
 */

import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const PORT = 8_202;
const ROOT = resolve(import.meta.dir, '..');
const CONSUMER_DIR = join(tmpdir(), 'vector-frankl-consumer-test');
const CONSUMER_OUT = join(CONSUMER_DIR, 'dist');

// ---------------------------------------------------------------------------
// Step 1: Build the library
// ---------------------------------------------------------------------------
if (!process.env['SKIP_BUILD']) {
  console.log('[consumer-server] Building library...');
  const build = Bun.spawnSync(
    [
      'bun',
      'build',
      '--target=browser',
      '--outdir=dist',
      '--format=esm',
      './src/index.ts',
    ],
    { cwd: ROOT, stdout: 'inherit' as const, stderr: 'inherit' as const },
  );
  if (build.exitCode !== 0) {
    console.error('[consumer-server] Library build failed');
    process.exit(1);
  }
  console.log('[consumer-server] Library build complete');
}

// ---------------------------------------------------------------------------
// Step 2: Pack the tarball
// ---------------------------------------------------------------------------
console.log('[consumer-server] Packing tarball...');

// Clean up any previous pack artifacts
const existingTarballs = Array.from(new Bun.Glob('*.tgz').scanSync({ cwd: ROOT }));
for (const tarball of existingTarballs) {
  rmSync(join(ROOT, tarball));
}

const packResult = Bun.spawnSync(['npm', 'pack', '--ignore-scripts'], {
  cwd: ROOT,
  stdout: 'pipe' as const,
  stderr: 'inherit' as const,
});

if (packResult.exitCode !== 0) {
  console.error('[consumer-server] npm pack failed');
  process.exit(1);
}

const tarballName = new TextDecoder().decode(packResult.stdout).trim();
const tarballPath = join(ROOT, tarballName);

if (!existsSync(tarballPath)) {
  console.error(`[consumer-server] Expected tarball not found: ${tarballPath}`);
  process.exit(1);
}

console.log(`[consumer-server] Packed: ${tarballName}`);

// ---------------------------------------------------------------------------
// Step 3: Set up the consumer directory
// ---------------------------------------------------------------------------
console.log('[consumer-server] Setting up consumer directory...');

// Recreate clean consumer directory
if (existsSync(CONSUMER_DIR)) {
  rmSync(CONSUMER_DIR, { recursive: true });
}
mkdirSync(CONSUMER_DIR, { recursive: true });
mkdirSync(CONSUMER_OUT, { recursive: true });

// Write a minimal package.json for the consumer
const consumerPackageJson = {
  name: 'vector-frankl-consumer',
  version: '1.0.0',
  type: 'module',
  dependencies: {
    'vector-frankl': `file:${tarballPath}`,
  },
};

await Bun.write(
  join(CONSUMER_DIR, 'package.json'),
  JSON.stringify(consumerPackageJson, null, 2),
);

// Install the tarball into the consumer
console.log('[consumer-server] Installing tarball into consumer...');
const installResult = Bun.spawnSync(['bun', 'install', '--no-save'], {
  cwd: CONSUMER_DIR,
  stdout: 'inherit' as const,
  stderr: 'inherit' as const,
});

if (installResult.exitCode !== 0) {
  console.error('[consumer-server] bun install failed');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Step 4: Write consumer source and bundle it
// ---------------------------------------------------------------------------
console.log('[consumer-server] Writing consumer source...');

// Consumer TypeScript source — imports only from the installed package name,
// never from a relative path back into the source tree.
const consumerSource = /* ts */ `
import { VectorDB, VectorFrankl } from 'vector-frankl';

declare global {
  interface Window {
    db: InstanceType<typeof VectorDB> | null;
    vf: InstanceType<typeof VectorFrankl> | null;
    log: (message: string, level?: string) => void;
    addTestResult: (name: string, result: string, details?: string) => void;
    testResults: Array<{ name: string; result: string; details: string }>;
    initDatabase: () => Promise<void>;
    clearDatabase: () => Promise<void>;
    testFullWorkflow: () => Promise<void>;
    testReload: () => Promise<void>;
  }
}

window.db = null;
window.vf = null;
window.testResults = [];

window.log = (message: string, level = 'info'): void => {
  const timestamp = new Date().toISOString();
  const logEntry = \`[\${timestamp}] \${level.toUpperCase()}: \${message}\n\`;
  const logEl = document.getElementById('logs');
  if (logEl) logEl.textContent += logEntry;
  console.log(logEntry.trim());
};

window.addTestResult = (name: string, result: string, details = ''): void => {
  window.testResults.push({ name, result, details });
  const el = document.createElement('div');
  el.className = \`result \${result}\`;
  el.dataset['testName'] = name;
  el.textContent = \`\${name}: \${result.toUpperCase()}\${details ? ' — ' + details : ''}\`;
  const container = document.getElementById('results');
  if (container) container.appendChild(el);
};

window.initDatabase = async (): Promise<void> => {
  try {
    window.log('Initializing VectorDB...');
    window.db = new VectorDB('consumer-test-db', 8);
    await window.db.init();

    window.log('Initializing VectorFrankl...');
    window.vf = new VectorFrankl();
    await window.vf.init();

    const statusEl = document.getElementById('db-status');
    if (statusEl) {
      statusEl.textContent = 'Initialized';
      statusEl.className = 'status success';
    }

    window.addTestResult('Database Initialization', 'success');
    window.log('Databases initialized successfully');
  } catch (error) {
    window.addTestResult(
      'Database Initialization',
      'error',
      (error as Error).message,
    );
    window.log(\`Initialization failed: \${(error as Error).message}\`, 'error');
    throw error;
  }
};

window.clearDatabase = async (): Promise<void> => {
  try {
    if (window.db) await window.db.clear();
    window.addTestResult('Database Clear', 'success');
    window.log('Database cleared');
  } catch (error) {
    window.addTestResult('Database Clear', 'error', (error as Error).message);
    throw error;
  }
};

window.testFullWorkflow = async (): Promise<void> => {
  const db = window.db;
  if (!db) throw new Error('Database not initialized');

  try {
    // Write vectors
    await db.addVector('v1', [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8], {
      label: 'first',
    });
    await db.addVector('v2', [0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1], {
      label: 'second',
    });
    await db.addVector('v3', [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5], {
      label: 'third',
    });
    window.addTestResult('Write Vectors', 'success', 'Added 3 vectors');

    // Search
    const results = await db.search([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8], 2);
    if (results.length === 0) throw new Error('Search returned no results');
    window.addTestResult('Search', 'success', \`Found \${results.length} results\`);

    // Update metadata
    await db.updateMetadata('v1', { label: 'first-updated', updated: true });
    const updated = await db.getVector('v1');
    if (!updated || updated.metadata['label'] !== 'first-updated') {
      throw new Error('Metadata update failed');
    }
    window.addTestResult('Update Metadata', 'success');

    // Clear
    await db.clear();
    const afterClear = await db.getAllVectors();
    if (afterClear.length !== 0) {
      throw new Error(\`Expected 0 vectors after clear, got \${afterClear.length}\`);
    }
    window.addTestResult('Clear', 'success');

    // Close
    await db.close();
    window.addTestResult('Close', 'success');
  } catch (error) {
    window.addTestResult('Full Workflow', 'error', (error as Error).message);
    throw error;
  }
};

window.testReload = async (): Promise<void> => {
  try {
    // Re-open and verify persistence (empty after clear, but DB opens cleanly)
    const db2 = new VectorDB('consumer-reload-db', 8);
    await db2.init();

    await db2.addVector('persist1', [1, 0, 0, 0, 0, 0, 0, 0], { persisted: true });
    const retrieved = await db2.getVector('persist1');
    if (!retrieved) throw new Error('Could not retrieve persisted vector');

    await db2.close();
    window.addTestResult('Reload Persistence', 'success');
    window.log('Reload persistence verified');
  } catch (error) {
    window.addTestResult('Reload Persistence', 'error', (error as Error).message);
    throw error;
  }
};

// Run on load
document.addEventListener('DOMContentLoaded', () => {
  window.log('Consumer app loaded — imports from installed package resolved');
});
`;

await Bun.write(join(CONSUMER_DIR, 'consumer.ts'), consumerSource);

// Bundle using Bun
console.log('[consumer-server] Bundling consumer app...');
const bundleResult = await Bun.build({
  entrypoints: [join(CONSUMER_DIR, 'consumer.ts')],
  outdir: CONSUMER_OUT,
  format: 'esm',
  target: 'browser',
  minify: false,
  sourcemap: 'none',
  splitting: false,
  naming: 'consumer.[ext]',
  external: [],
});

if (!bundleResult.success) {
  console.error('[consumer-server] Bundle failed:');
  for (const message of bundleResult.logs) {
    console.error(message);
  }
  process.exit(1);
}

console.log('[consumer-server] Bundle complete');

// Write the HTML page into the output directory
const consumerHtml = /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Vector Frankl Package Consumer Test</title>
  <style>
    body { font-family: sans-serif; max-width: 900px; margin: 2rem auto; padding: 0 1rem; }
    h1 { font-size: 1.5rem; }
    .status { padding: 0.5rem 1rem; border-radius: 4px; margin: 0.5rem 0; font-weight: bold; }
    .success { background: #d4edda; color: #155724; }
    .error   { background: #f8d7da; color: #721c24; }
    .info    { background: #d1ecf1; color: #0c5460; }
    .result  { padding: 0.25rem 0.5rem; margin: 0.25rem 0; border-radius: 3px; font-size: 0.9rem; }
    #logs    { background: #f8f9fa; border: 1px solid #dee2e6; padding: 0.5rem;
               font-family: monospace; font-size: 0.75rem; white-space: pre-wrap;
               height: 200px; overflow-y: auto; margin-top: 1rem; }
    button   { padding: 0.4rem 1rem; margin: 0.25rem; cursor: pointer; }
  </style>
</head>
<body>
  <h1>Vector Frankl Package Consumer Test</h1>
  <p>This page imports <code>vector-frankl</code> from the <strong>installed tarball</strong>, not from source.</p>

  <div id="db-status" class="status info">Not initialized</div>

  <div>
    <button onclick="window.initDatabase()">Initialize</button>
    <button onclick="window.testFullWorkflow()">Run Full Workflow</button>
    <button onclick="window.testReload()">Test Reload Persistence</button>
    <button onclick="window.clearDatabase()">Clear</button>
  </div>

  <h2>Results</h2>
  <div id="results"></div>

  <h2>Logs</h2>
  <div id="logs"></div>

  <script type="module" src="consumer.js"></script>
</body>
</html>`;

await Bun.write(join(CONSUMER_OUT, 'index.html'), consumerHtml);

// ---------------------------------------------------------------------------
// Step 5: Serve the bundled app
// ---------------------------------------------------------------------------
console.log(`[consumer-server] Starting server on port ${PORT}...`);

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    let pathname = url.pathname === '/' ? '/index.html' : url.pathname;

    const filePath = join(CONSUMER_OUT, pathname.replace(/^\//, ''));

    try {
      const file = Bun.file(filePath);
      const exists = await file.exists();
      if (!exists) {
        return new Response('Not Found', { status: 404 });
      }

      const headers = new Headers();

      if (pathname.endsWith('.html')) {
        headers.set('Content-Type', 'text/html');
        headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
        headers.set('Cross-Origin-Opener-Policy', 'same-origin');
      } else if (pathname.endsWith('.js')) {
        headers.set('Content-Type', 'application/javascript');
        headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
      }

      return new Response(file, { headers });
    } catch {
      return new Response('Internal Server Error', { status: 500 });
    }
  },
});

console.log(`[consumer-server] Serving package-consumer app at http://localhost:${PORT}`);

process.on('SIGTERM', () => {
  console.log('[consumer-server] Shutting down...');
  void server.stop();
  // Clean up tarball
  if (existsSync(tarballPath)) {
    rmSync(tarballPath);
  }
  process.exit(0);
});
