type PackageManifest = {
  exports?: unknown;
  main?: unknown;
  types?: unknown;
};

const packageManifest = (await Bun.file('package.json').json()) as PackageManifest;

const basePackageFiles = [
  'package.json',
  'README.md',
  'LICENSE',
  'CHANGELOG.md',
  'dist/cjs/package.json',
];

const collectPackageTargets = (value: unknown): string[] => {
  if (typeof value === 'string') {
    return value.startsWith('./') ? [value.slice(2)] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectPackageTargets(item));
  }

  if (value && typeof value === 'object') {
    return Object.values(value).flatMap((item) => collectPackageTargets(item));
  }

  return [];
};

const requiredPackageFiles = [
  ...new Set([
    ...basePackageFiles,
    ...collectPackageTargets(packageManifest.exports),
    ...collectPackageTargets(packageManifest.main),
    ...collectPackageTargets(packageManifest.types),
  ]),
].toSorted();

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
