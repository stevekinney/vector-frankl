/** CommonJS builds cannot resolve import.meta.url; consumers must pass workerScript explicitly. */
export function getDefaultWorkerScript(): string {
  throw new Error(
    'WorkerPool: a workerScript URL is required in CommonJS builds. ' +
      'Pass { workerScript } pointing at the bundled vector-worker.js.',
  );
}
