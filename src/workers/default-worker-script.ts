/**
 * Resolve the bundled worker script URL relative to this ESM module.
 *
 * This helper is bundled into the package entrypoints (`dist/index.js`,
 * `dist/workers.js`) at the `dist/` root, while `build:worker` emits the actual
 * worker to `dist/workers/vector-worker.js`. The URL must therefore be resolved
 * against the `workers/` subdirectory — resolving `./vector-worker.js` would
 * point at the non-existent `dist/vector-worker.js` and default WorkerPool usage
 * would fail to start workers unless every caller passed `workerScript` manually.
 */
export function getDefaultWorkerScript(): string {
  return new URL('./workers/vector-worker.js', import.meta.url).href;
}
