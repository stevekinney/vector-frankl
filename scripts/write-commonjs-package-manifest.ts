import { mkdir } from 'node:fs/promises';

await mkdir('dist/cjs', { recursive: true });
await Bun.write(
  'dist/cjs/package.json',
  `${JSON.stringify({ type: 'commonjs' }, null, 2)}\n`,
);
