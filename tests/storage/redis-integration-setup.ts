/**
 * Preload file for Redis integration tests.
 *
 * When executed via `--preload`, this module runs before any test file. It
 * attempts to connect to a Redis service using the following resolution order:
 *
 *   1. `REDIS_URL` environment variable (caller-provided service).
 *   2. A Docker-based disposable `redis:7-alpine` container started on a random port.
 *   3. The default local address `redis://127.0.0.1:6379`.
 *
 * On success it writes `REDIS_INTEGRATION_URL` into `process.env` so that
 * `redis-adapter.test.ts` can detect integration mode and skip its in-process
 * mock. On failure it sets `REDIS_INTEGRATION_SKIP=true` and logs a clear
 * diagnostic—tests then skip gracefully rather than failing with a cryptic
 * connection error.
 *
 * Usage:
 *   bun test tests/storage/adapters/redis-adapter.test.ts \
 *     --preload tests/storage/redis-integration-setup.ts
 */

import { afterAll } from 'bun:test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Milliseconds to wait for a Redis `PING` before giving up. */
const CONNECT_TIMEOUT_MS = 5_000;

/**
 * Try to connect to `url` and issue a `PING`. Returns `true` when Redis
 * responds `PONG` within the timeout, `false` otherwise.
 */
async function probeRedis(url: string): Promise<boolean> {
  if (typeof Bun === 'undefined' || !Bun.RedisClient) {
    return false;
  }

  const RedisClient = Bun.RedisClient as unknown as new (url: string) => {
    ping(): Promise<string>;
    close(): void;
  };

  const client = new RedisClient(url);

  try {
    const result = await Promise.race([
      client.ping(),
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error('timeout')), CONNECT_TIMEOUT_MS),
      ),
    ]);
    return result === 'PONG';
  } catch {
    return false;
  } finally {
    client.close();
  }
}

/**
 * Attempt to start a disposable Redis container via Docker.
 * Returns the `redis://127.0.0.1:<port>` URL on success, or `null` when
 * Docker is unavailable or the container fails to start.
 */
async function startDockerRedis(): Promise<string | null> {
  try {
    // Pick a random high port to avoid collisions with resident services.
    const port = 16379 + Math.floor(Math.random() * 1000);
    const containerName = `vf-redis-test-${port}`;

    const proc = Bun.spawn(
      [
        'docker',
        'run',
        '--rm',
        '--detach',
        '--name',
        containerName,
        '-p',
        `${port}:6379`,
        'redis:7-alpine',
      ],
      { stdout: 'pipe', stderr: 'pipe' },
    );

    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      return null;
    }

    // Store container name for cleanup.
    dockerContainerName = containerName;

    // Poll until Redis is ready (up to 15 s).
    const url = `redis://127.0.0.1:${port}`;
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      if (await probeRedis(url)) {
        return url;
      }
      await Bun.sleep(300);
    }

    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Container lifecycle state
// ---------------------------------------------------------------------------

let dockerContainerName: string | null = null;

async function stopDockerRedis(): Promise<void> {
  if (dockerContainerName === null) return;
  try {
    const proc = Bun.spawn(['docker', 'stop', dockerContainerName], {
      stdout: 'ignore',
      stderr: 'ignore',
    });
    await proc.exited;
  } catch {
    // Best-effort cleanup; do not throw.
  } finally {
    dockerContainerName = null;
  }
}

// ---------------------------------------------------------------------------
// Service resolution
// ---------------------------------------------------------------------------

async function resolveRedisUrl(): Promise<string | null> {
  // 1. Caller-provided URL.
  const envUrl = process.env['REDIS_URL'];
  if (envUrl) {
    const reachable = await probeRedis(envUrl);
    if (reachable) return envUrl;
    console.warn(`[redis-integration-setup] REDIS_URL=${envUrl} is not reachable — skipping.`);
    return null;
  }

  // 2. Docker-based disposable container.
  const dockerUrl = await startDockerRedis();
  if (dockerUrl !== null) {
    return dockerUrl;
  }

  // 3. Default local address.
  const defaultUrl = 'redis://127.0.0.1:6379';
  const reachable = await probeRedis(defaultUrl);
  if (reachable) return defaultUrl;

  return null;
}

// ---------------------------------------------------------------------------
// Preload execution
// ---------------------------------------------------------------------------

const resolvedUrl = await resolveRedisUrl();

if (resolvedUrl !== null) {
  process.env['REDIS_INTEGRATION_URL'] = resolvedUrl;
  console.info(`[redis-integration-setup] Redis integration tests enabled at ${resolvedUrl}`);
} else {
  process.env['REDIS_INTEGRATION_SKIP'] = 'true';
  console.warn(
    '[redis-integration-setup] No Redis service available. ' +
      'Integration tests will be skipped. ' +
      'To enable them, set REDIS_URL or ensure Docker is running.',
  );
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

afterAll(async () => {
  await stopDockerRedis();
});
