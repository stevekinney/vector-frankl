import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const adapterSubpaths = [
  'chrome-storage',
  'file-system',
  'indexed-database',
  'level',
  'lmdb',
  'memory',
  'opfs',
  'redis',
  's3',
  'sqlite',
];

async function run(command: string[], cwd: string): Promise<string> {
  const process = Bun.spawn(command, {
    cwd,
    stderr: 'pipe',
    stdout: 'pipe',
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(
      `Command failed (${command.join(' ')}):\n${stdout.trim()}\n${stderr.trim()}`,
    );
  }

  return stdout;
}

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'vector-frankl-commonjs-'));
const packOutput = await run(
  [
    'npm',
    'pack',
    '--silent',
    '--ignore-scripts',
    '--pack-destination',
    temporaryDirectory,
  ],
  process.cwd(),
);
const tarballName = packOutput.trim();

await run(['bun', 'init', '-y'], temporaryDirectory);
await run(['bun', 'add', join(temporaryDirectory, tarballName)], temporaryDirectory);

await run(
  [
    'node',
    '-e',
    'const packageModule = require("vector-frankl"); if (!packageModule.VectorDB) throw new Error("root CJS export missing VectorDB");',
  ],
  temporaryDirectory,
);

await run(
  [
    'node',
    '-e',
    'const { MemoryStorageAdapter } = require("vector-frankl/adapters/memory"); const adapter = new MemoryStorageAdapter(); if (!adapter) throw new Error("memory adapter missing");',
  ],
  temporaryDirectory,
);

await run(
  [
    'bun',
    '-e',
    `const adapterNames = ${JSON.stringify(adapterSubpaths)}; for (const name of adapterNames) { const module = require(\`vector-frankl/adapters/\${name}\`); if (Object.keys(module).length === 0) throw new Error(\`\${name} exported no bindings\`); }`,
  ],
  temporaryDirectory,
);

await run(
  [
    'bun',
    '-e',
    `const adapterNames = ${JSON.stringify(adapterSubpaths)}; for (const name of adapterNames) { const module = await import(\`vector-frankl/adapters/\${name}\`); if (Object.keys(module).length === 0) throw new Error(\`\${name} exported no bindings\`); }`,
  ],
  temporaryDirectory,
);

console.log('CommonJS consumer package surface verified.');
