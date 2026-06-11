const requiredPackageFiles = [
  'package.json',
  'README.md',
  'LICENSE',
  'CHANGELOG.md',
  'dist/index.js',
  'dist/index.d.ts',
  'dist/cjs/index.js',
  'dist/workers.js',
  'dist/workers.d.ts',
];

const output = await Bun.$`npm pack --dry-run --json --ignore-scripts`.text();
const [packageResult] = JSON.parse(output) as Array<{
  files: Array<{ path: string }>;
}>;

if (!packageResult) {
  throw new Error('npm pack did not return package metadata');
}

const packageFiles = new Set(packageResult.files.map((file) => file.path));
const missingFiles = requiredPackageFiles.filter((file) => !packageFiles.has(file));

if (missingFiles.length > 0) {
  throw new Error(`Package is missing required files: ${missingFiles.join(', ')}`);
}

console.log(
  `Package surface verified: ${packageResult.files.length} files include required entry points.`,
);

export {};
