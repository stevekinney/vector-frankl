#!/usr/bin/env bun

import { join } from 'path';

const PORT = 8201;

// Simple static file server for Playwright tests
const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    let filePath = url.pathname;

    if (filePath === '/') {
      filePath = '/index.html';
    }

    try {
      // Serve test files from tests/end-to-end directory
      if (filePath.startsWith('/tests/')) {
        const file = Bun.file(join(process.cwd(), filePath));
        return new Response(file);
      }

      // Serve built files from dist directory
      if (filePath.startsWith('/dist/')) {
        const file = Bun.file(join(process.cwd(), filePath));
        return new Response(file);
      }

      // Default to serving from tests/end-to-end
      const file = Bun.file(join(process.cwd(), 'tests/end-to-end', filePath));
      const exists = await file.exists();

      if (!exists) {
        return new Response('Not Found', { status: 404 });
      }

      // Set appropriate headers for cross-origin isolation (needed for SharedArrayBuffer)
      const headers = new Headers();
      
      if (filePath.endsWith('.html')) {
        headers.set('Content-Type', 'text/html');
        headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
        headers.set('Cross-Origin-Opener-Policy', 'same-origin');
      } else if (filePath.endsWith('.js')) {
        headers.set('Content-Type', 'application/javascript');
        headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
      } else if (filePath.endsWith('.wasm')) {
        headers.set('Content-Type', 'application/wasm');
        headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
      }

      return new Response(file, { headers });
    } catch {
      return new Response('Internal Server Error', { status: 500 });
    }
  },
});

console.log(`Test server running at http://localhost:${PORT}`);

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down test server...');
  server.stop();
  process.exit(0);
});