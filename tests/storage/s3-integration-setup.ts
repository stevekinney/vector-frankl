/**
 * Preload file for S3-compatible integration tests.
 *
 * When executed via `--preload`, this module runs before any test file. It
 * attempts to connect to an S3-compatible service using the following
 * resolution order:
 *
 *   1. Caller-provided environment variables (`S3_ENDPOINT`, `S3_ACCESS_KEY_ID`,
 *      `S3_SECRET_ACCESS_KEY`, `S3_REGION`, `S3_BUCKET`).
 *   2. A Docker-based disposable MinIO container started on random ports.
 *   3. A default local MinIO address `http://127.0.0.1:9000`.
 *
 * On success it writes the resolved credentials into `process.env` under
 * `S3_INTEGRATION_*` variables so that `s3-adapter.test.ts` can detect
 * integration mode and skip its in-process mock. On failure it sets
 * `S3_INTEGRATION_SKIP=true` and logs a clear diagnostic—tests then skip
 * gracefully rather than failing with a cryptic network error.
 *
 * Usage:
 *   bun test tests/storage/adapters/s3-adapter.test.ts \
 *     --preload tests/storage/s3-integration-setup.ts
 */

import { afterAll } from 'bun:test';

// ---------------------------------------------------------------------------
// MinIO defaults
// ---------------------------------------------------------------------------

const MINIO_ACCESS_KEY = 'minioadmin';
const MINIO_SECRET_KEY = 'minioadmin';
const INTEGRATION_BUCKET = 'vf-integration-test';
const CONNECT_TIMEOUT_MS = 5_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface S3Config {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  bucket: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Probe the S3-compatible endpoint by issuing a GET request to the bucket
 * list endpoint. Returns `true` when the server responds (even with an auth
 * error—that still means the service is up), `false` on connection failure.
 */
async function probeS3(endpoint: string, _config: Omit<S3Config, 'endpoint'>): Promise<boolean> {
  try {
    const url = `${endpoint}/`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS);

    try {
      const response = await fetch(url, { signal: controller.signal });
      // Any HTTP response (200, 403, 404 …) means the server is up.
      return response.status > 0;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return false;
  }
}

/**
 * Create the integration test bucket via the MinIO / S3-compatible API.
 * Uses a signed PUT request if supported, falls back to a plain PUT.
 */
async function ensureBucket(config: S3Config): Promise<void> {
  const url = `${config.endpoint}/${config.bucket}`;
  try {
    const response = await fetch(url, { method: 'PUT' });
    // 200 = created, 409 = already exists — both are fine.
    if (response.status !== 200 && response.status !== 409) {
      // Non-fatal: the bucket may already exist or may be auto-created.
    }
  } catch {
    // Best-effort; the adapter tests will fail explicitly if the bucket is missing.
  }
}

/**
 * Start a disposable MinIO container via Docker.
 * Returns a resolved `S3Config` on success, or `null` when Docker is
 * unavailable or the container fails to start.
 */
async function startDockerMinio(): Promise<S3Config | null> {
  try {
    const apiPort = 19000 + Math.floor(Math.random() * 1000);
    const consolePort = apiPort + 10000;
    const containerName = `vf-minio-test-${apiPort}`;

    const proc = Bun.spawn(
      [
        'docker',
        'run',
        '--rm',
        '--detach',
        '--name',
        containerName,
        '-p',
        `${apiPort}:9000`,
        '-p',
        `${consolePort}:9001`,
        '-e',
        `MINIO_ROOT_USER=${MINIO_ACCESS_KEY}`,
        '-e',
        `MINIO_ROOT_PASSWORD=${MINIO_SECRET_KEY}`,
        'minio/minio:latest',
        'server',
        '/data',
        '--console-address',
        ':9001',
      ],
      { stdout: 'pipe', stderr: 'pipe' },
    );

    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      return null;
    }

    dockerContainerName = containerName;

    const config: S3Config = {
      endpoint: `http://127.0.0.1:${apiPort}`,
      accessKeyId: MINIO_ACCESS_KEY,
      secretAccessKey: MINIO_SECRET_KEY,
      region: 'us-east-1',
      bucket: INTEGRATION_BUCKET,
    };

    // Poll until MinIO is ready (up to 20 s).
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      if (await probeS3(config.endpoint, config)) {
        await ensureBucket(config);
        return config;
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

async function stopDockerMinio(): Promise<void> {
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

async function resolveS3Config(): Promise<S3Config | null> {
  // 1. Caller-provided environment variables.
  const envEndpoint = process.env['S3_ENDPOINT'];
  if (envEndpoint) {
    const config: S3Config = {
      endpoint: envEndpoint,
      accessKeyId: process.env['S3_ACCESS_KEY_ID'] ?? 'minioadmin',
      secretAccessKey: process.env['S3_SECRET_ACCESS_KEY'] ?? 'minioadmin',
      region: process.env['S3_REGION'] ?? 'us-east-1',
      bucket: process.env['S3_BUCKET'] ?? INTEGRATION_BUCKET,
    };
    const reachable = await probeS3(config.endpoint, config);
    if (reachable) {
      await ensureBucket(config);
      return config;
    }
    console.warn(`[s3-integration-setup] S3_ENDPOINT=${envEndpoint} is not reachable — skipping.`);
    return null;
  }

  // 2. Docker-based disposable MinIO.
  const dockerConfig = await startDockerMinio();
  if (dockerConfig !== null) {
    return dockerConfig;
  }

  // 3. Default local MinIO.
  const defaultConfig: S3Config = {
    endpoint: 'http://127.0.0.1:9000',
    accessKeyId: MINIO_ACCESS_KEY,
    secretAccessKey: MINIO_SECRET_KEY,
    region: 'us-east-1',
    bucket: INTEGRATION_BUCKET,
  };
  const reachable = await probeS3(defaultConfig.endpoint, defaultConfig);
  if (reachable) {
    await ensureBucket(defaultConfig);
    return defaultConfig;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Preload execution
// ---------------------------------------------------------------------------

const resolvedConfig = await resolveS3Config();

if (resolvedConfig !== null) {
  process.env['S3_INTEGRATION_ENDPOINT'] = resolvedConfig.endpoint;
  process.env['S3_INTEGRATION_ACCESS_KEY_ID'] = resolvedConfig.accessKeyId;
  process.env['S3_INTEGRATION_SECRET_ACCESS_KEY'] = resolvedConfig.secretAccessKey;
  process.env['S3_INTEGRATION_REGION'] = resolvedConfig.region;
  process.env['S3_INTEGRATION_BUCKET'] = resolvedConfig.bucket;
  console.info(
    `[s3-integration-setup] S3 integration tests enabled at ${resolvedConfig.endpoint} ` +
      `(bucket: ${resolvedConfig.bucket})`,
  );
} else {
  process.env['S3_INTEGRATION_SKIP'] = 'true';
  console.warn(
    '[s3-integration-setup] No S3-compatible service available. ' +
      'Integration tests will be skipped. ' +
      'To enable them, set S3_ENDPOINT or ensure Docker is running.',
  );
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

afterAll(async () => {
  await stopDockerMinio();
});
