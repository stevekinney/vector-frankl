import { $ } from 'bun';

const browserBundleDirectory = 'tmp/vector-frankl-browser-build';

await $`rm -rf dist`;
await $`rm -rf ${browserBundleDirectory}`;

await $`tsc -p tsconfig.build.json --emitDeclarationOnly false`;
await $`bun build --target=browser --outdir=${browserBundleDirectory} --format=esm --sourcemap=external dist/index.js`;
await $`cp ${browserBundleDirectory}/index.js ${browserBundleDirectory}/index.js.map dist/`;
await $`rm -rf ${browserBundleDirectory}`;

await $`tsc -p tsconfig.build.json --outDir dist/cjs --declaration false --declarationMap false --emitDeclarationOnly false --module CommonJS`;

await Bun.write(
  'dist/cjs/package.json',
  `${JSON.stringify({ type: 'commonjs' }, null, 2)}\n`,
);

console.log('Build complete');
