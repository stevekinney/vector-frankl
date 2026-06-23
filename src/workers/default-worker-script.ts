/** Resolve the bundled worker script URL relative to this ESM module. */
export function getDefaultWorkerScript(): string {
  return new URL('./vector-worker.js', import.meta.url).href;
}
