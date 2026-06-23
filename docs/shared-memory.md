# Shared Memory and Cross-Origin Isolation

Vector Frankl's `SharedMemoryManager` uses `SharedArrayBuffer` to share vector data between the main thread and Web Workers without copying. This eliminates serialization overhead for large batch searches—vectors are written once and read directly by each worker.

`SharedArrayBuffer` is gated behind cross-origin isolation. Without it, the constructor throws immediately, and shared-memory batch search is unavailable. This document explains the browser requirement, how to configure your server, and what happens when isolation is not available.

## Table of Contents

- [Why Cross-Origin Isolation Is Required](#why-cross-origin-isolation-is-required)
- [Required HTTP Headers](#required-http-headers)
- [Verifying Isolation at Runtime](#verifying-isolation-at-runtime)
- [Server Configuration Examples](#server-configuration-examples)
- [Fallback Behavior](#fallback-behavior)
- [Feature Status](#feature-status)

## Why Cross-Origin Isolation Is Required

`SharedArrayBuffer` was re-enabled in browsers in 2021 after being disabled in response to the Spectre CPU vulnerability. The fix is cross-origin isolation: by opting in to strict cross-origin resource policies, a page cannot load resources that could amplify a timing-based side-channel attack. Only pages that meet those requirements get access to high-resolution timers and `SharedArrayBuffer`.

A page is cross-origin isolated when its top-level document is served with two specific response headers and every resource it embeds respects those policies.

## Required HTTP Headers

Both headers are required on the document (or worker script) response:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

**`Cross-Origin-Opener-Policy: same-origin`** prevents cross-origin popups from getting a reference to your window. This breaks the Spectre attack vector that relies on shared browsing context groups.

**`Cross-Origin-Embedder-Policy: require-corp`** blocks loading of cross-origin resources unless those resources explicitly opt in by responding with `Cross-Origin-Resource-Policy: cross-origin` (or `same-site`). This prevents a page from embedding timing-sensitive third-party content.

> [!WARNING] Breaking changes for existing embeds
> Enabling `COEP: require-corp` may break loading of third-party iframes, images, scripts, or media that do not set `Cross-Origin-Resource-Policy`. Audit your dependencies before enabling these headers in production.

## Verifying Isolation at Runtime

The browser exposes a `self.crossOriginIsolated` boolean you can check before constructing `SharedMemoryManager`:

```typescript
import { SharedMemoryManager } from 'vector-frankl/workers';

if (self.crossOriginIsolated) {
  const memory = new SharedMemoryManager({ maxPoolSize: 50 * 1024 * 1024 });
  // Use shared-memory batch search
} else {
  // Fall back to standard WorkerPool or main-thread search
  console.warn(
    'SharedArrayBuffer unavailable: cross-origin isolation is not active. ' +
      'Add Cross-Origin-Opener-Policy and Cross-Origin-Embedder-Policy headers to enable shared-memory features.',
  );
}
```

Calling `new SharedMemoryManager()` without checking `self.crossOriginIsolated` first will throw at construction time when `SharedArrayBuffer` is undefined.

## Server Configuration Examples

### Express / Node HTTP

```typescript
import express from 'express';

const app = express();

app.use((_req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  next();
});
```

### Bun.serve

```typescript
import { serve } from 'bun';

serve({
  fetch(req) {
    const response = new Response(await Bun.file('index.html').text(), {
      headers: {
        'Content-Type': 'text/html',
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      },
    });
    return response;
  },
});
```

### Vite (development)

```typescript
// vite.config.ts
import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
```

### Nginx

```nginx
add_header Cross-Origin-Opener-Policy "same-origin" always;
add_header Cross-Origin-Embedder-Policy "require-corp" always;
```

### Apache

```apache
Header always set Cross-Origin-Opener-Policy "same-origin"
Header always set Cross-Origin-Embedder-Policy "require-corp"
```

### Netlify (`netlify.toml`)

```toml
[[headers]]
  for = "/*"
  [headers.values]
    Cross-Origin-Opener-Policy = "same-origin"
    Cross-Origin-Embedder-Policy = "require-corp"
```

### Vercel (`vercel.json`)

```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "Cross-Origin-Opener-Policy", "value": "same-origin" },
        { "key": "Cross-Origin-Embedder-Policy", "value": "require-corp" }
      ]
    }
  ]
}
```

## Fallback Behavior

When cross-origin isolation is absent, `SharedArrayBuffer` is `undefined` and `SharedMemoryManager` cannot be instantiated. The rest of Vector Frankl continues to work normally:

| Feature                 | Isolated (`crossOriginIsolated: true`) | Not Isolated           |
| ----------------------- | -------------------------------------- | ---------------------- |
| `SharedMemoryManager`   | Available                              | Throws on construction |
| `WorkerPool` (standard) | Available                              | Available              |
| Main-thread search      | Available                              | Available              |
| HNSW index search       | Available                              | Available              |
| WebGPU acceleration     | Available                              | Available              |
| SIMD acceleration       | Available                              | Available              |

The standard `WorkerPool` uses `postMessage` with structured cloning to pass vectors to workers. This incurs a copy per transfer, but it works without cross-origin isolation and is the right default for most applications.

Shared-memory batch search is an optimization, not a required path. Design your integration to check `self.crossOriginIsolated` and degrade gracefully:

```typescript
import { WorkerPool } from 'vector-frankl/workers';
import { SharedMemoryManager } from 'vector-frankl/workers';

async function batchSearch(vectors: Float32Array[], queries: Float32Array[], k: number) {
  if (self.crossOriginIsolated) {
    const memory = new SharedMemoryManager();
    return memory.sharedMemoryBatchSearch(vectors, queries, k, 'cosine');
  }

  // Graceful fallback: structured-clone transfer via WorkerPool
  const pool = new WorkerPool({ maxWorkers: navigator.hardwareConcurrency ?? 4 });
  return pool.parallelSearch(vectors, queries, k, 'cosine');
}
```

## Feature Status

`SharedMemoryManager` and `sharedMemoryBatchSearch` are **experimental**. The API is functional and the shared-memory mechanics are correct, but the feature has not been validated across all target browsers or at production scale. Use it with `self.crossOriginIsolated` guards and a `WorkerPool` fallback.

`WorkerPool` with structured-clone transfer is the production-supported path for parallel search.
