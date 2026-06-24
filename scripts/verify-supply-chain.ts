#!/usr/bin/env bun
/**
 * Supply-chain verification script.
 *
 * Checks known vulnerabilities, license policy, lockfile integrity, npm
 * provenance configuration, and packed-file contents before a stable release.
 *
 * Exits with a non-zero code if any check fails.
 */

import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Severity = 'critical' | 'high' | 'moderate' | 'low' | 'info';

type Advisory = {
  id: number;
  url: string;
  title: string;
  severity: Severity;
  vulnerable_versions: string;
  cwe?: string[];
  cvss?: { score: number; vectorString: string | null };
};

type AuditReport = Record<string, Advisory[]>;

type PackageManifest = {
  name?: string;
  version?: string;
  /** Modern singular field (npm >=2) */
  license?: string | { type: string } | Array<{ type: string }>;
  /** Legacy plural field used by some older packages (npm 1.x era) */
  licenses?: Array<{ type: string; url?: string }>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  publishConfig?: {
    access?: string;
    registry?: string;
    provenance?: boolean;
  };
  files?: string[];
  exports?: unknown;
  main?: unknown;
  types?: unknown;
};

type PackEntry = [string, string, Record<string, unknown>, string];

type LockfileWorkspace = {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalPeers?: string[];
};

type Lockfile = {
  lockfileVersion: number;
  workspaces: Record<string, LockfileWorkspace>;
  packages: Record<string, PackEntry | undefined>;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Severity levels that block a release for production (non-dev) dependencies.
 * dev-only vulnerabilities are reported but do not fail the check.
 */
const BLOCKING_SEVERITIES: ReadonlySet<Severity> = new Set(['critical', 'high']);

/**
 * SPDX license identifiers that are explicitly allowed.
 * Any package with a license not in this list (or unlicensed) fails the check.
 */
const ALLOWED_LICENSES: ReadonlySet<string> = new Set([
  'MIT',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Apache-2.0',
  '0BSD',
  'CC0-1.0',
  'BlueOak-1.0.0',
  'Unlicense',
  'Python-2.0',
  'CC-BY-4.0',
  'CC-BY-3.0',
]);

/**
 * Package names whose licenses are known to be policy-compliant despite
 * reporting a non-standard SPDX identifier. Entries here must be justified.
 */
const LICENSE_ALLOWLIST: ReadonlySet<string> = new Set([
  // bun built-in packages report no license; they are part of the Bun runtime
  'bun',
]);

/**
 * File patterns that must never appear in a packed npm release.
 */
const FORBIDDEN_PACK_PATTERNS: ReadonlyArray<RegExp> = [
  /\.env(\..+)?$/i, // .env, .env.local, .env.production, etc.
  /\.pem$/i, // PEM certificates / private keys
  /\.key$/i, // private key files
  /\.p12$/i, // PKCS#12 bundles
  /\.pfx$/i, // PFX certificates
  /secret/i, // any file containing "secret"
  /password/i, // any file containing "password"
  /credential/i, // credential files
  /\.ssh\//i, // ssh key material
  /tsconfig\.json$/i, // internal tooling config
  /\.husky\//i, // git hooks
  /scripts\//i, // build-time scripts
  /tests?\//i, // test files
  /coverage\//i, // coverage reports
  /\.github\//i, // CI configuration
];

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

let failures = 0;
let warnings = 0;

function pass(message: string): void {
  console.log(`  ✅ ${message}`);
}

function warn(message: string): void {
  console.warn(`  ⚠️  ${message}`);
  warnings++;
}

function fail(message: string): void {
  console.error(`  ❌ ${message}`);
  failures++;
}

function section(title: string): void {
  console.log(`\n── ${title}`);
}

/**
 * Parse bun.lock, which uses a JSON5-like format with trailing commas.
 * We strip trailing commas before parsing to make it valid JSON.
 */
async function readLockfile(): Promise<Lockfile> {
  const text = await Bun.file('bun.lock').text();
  // Strip trailing commas before } or ]
  const json = text.replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(json) as Lockfile;
}

// ---------------------------------------------------------------------------
// Check 1: Known-vulnerability scan
// ---------------------------------------------------------------------------

async function checkVulnerabilities(productionDeps: ReadonlySet<string>): Promise<void> {
  section('Vulnerability scan (bun audit)');

  let report: AuditReport;

  // .nothrow() prevents Bun.$ from throwing when the command exits non-zero;
  // bun audit exits 1 when vulnerabilities are found, which is expected.
  const result = await Bun.$`bun audit --json`.quiet().nothrow();

  const rawOutput = result.stdout.toString().trim();
  if (!rawOutput) {
    fail('bun audit produced no output — cannot verify vulnerabilities');
    return;
  }

  try {
    report = JSON.parse(rawOutput) as AuditReport;
  } catch {
    fail(`bun audit output was not valid JSON: ${rawOutput.slice(0, 200)}`);
    return;
  }

  const entries = Object.entries(report);

  if (entries.length === 0) {
    pass('No known vulnerabilities found');
    return;
  }

  let blockingCount = 0;

  for (const [packageName, advisories] of entries) {
    for (const advisory of advisories) {
      const isProductionDep = productionDeps.has(packageName);
      const isBlocking = BLOCKING_SEVERITIES.has(advisory.severity) && isProductionDep;

      const label = isProductionDep ? 'production' : 'dev-only';
      const message = `${advisory.severity.toUpperCase()} [${label}] ${packageName}: ${advisory.title} — ${advisory.url}`;

      if (isBlocking) {
        fail(message);
        blockingCount++;
      } else if (BLOCKING_SEVERITIES.has(advisory.severity)) {
        warn(message);
      } else {
        warn(message);
      }
    }
  }

  if (blockingCount === 0) {
    pass(
      `${entries.length} package(s) with advisories — none affect production dependencies at blocking severity`,
    );
  }
}

// ---------------------------------------------------------------------------
// Check 2: License policy
// ---------------------------------------------------------------------------

/**
 * Resolve the SPDX license string from a package.json manifest.
 * Handles the modern singular `license` field (string, object, or array) and
 * the legacy plural `licenses` array used by older packages (npm 1.x era).
 */
function resolveLicense(manifest: PackageManifest): string {
  const { license, licenses } = manifest;

  // Modern singular field
  if (typeof license === 'string') return license;
  if (license && typeof license === 'object' && !Array.isArray(license)) {
    return license.type;
  }
  if (Array.isArray(license) && license.length > 0) {
    return license.map((l) => l.type).join(' OR ');
  }

  // Legacy plural field (e.g. the `format` package)
  if (Array.isArray(licenses) && licenses.length > 0) {
    return licenses.map((l) => l.type).join(' OR ');
  }

  return 'UNKNOWN';
}

async function checkLicenses(): Promise<void> {
  section('License policy check');

  // Two separate globs because Bun.Glob does not support brace alternation for
  // directory-level patterns: one for unscoped packages, one for scoped (@scope/pkg).
  const unscopedGlob = new Bun.Glob('node_modules/*/package.json');
  const scopedGlob = new Bun.Glob('node_modules/@*/*/package.json');
  let checked = 0;
  let violations = 0;

  const scanOptions = { cwd: process.cwd() };
  const allPaths: string[] = [];

  for await (const p of unscopedGlob.scan(scanOptions)) allPaths.push(p);
  for await (const p of scopedGlob.scan(scanOptions)) allPaths.push(p);

  for (const relativePath of allPaths) {
    const packageJsonFile = Bun.file(join(process.cwd(), relativePath));

    let manifest: PackageManifest;
    try {
      manifest = (await packageJsonFile.json()) as PackageManifest;
    } catch {
      warn(`Could not parse ${relativePath}`);
      continue;
    }

    // Derive a package name from the path segment when manifest.name is absent.
    // Paths look like: node_modules/<name>/package.json or node_modules/@scope/<name>/package.json
    const pathSegments = relativePath.split('/');
    const packageId =
      manifest.name ??
      (pathSegments[1]?.startsWith('@')
        ? `${pathSegments[1]}/${pathSegments[2]}`
        : pathSegments[1]) ??
      relativePath;

    if (LICENSE_ALLOWLIST.has(packageId)) continue;

    checked++;
    const licenseStr = resolveLicense(manifest);

    // Check if any license in a compound SPDX expression is allowed (handles OR/AND).
    const licenseTokens = licenseStr
      .split(/\s+(?:OR|AND)\s+/i)
      .map((t) => t.trim().replace(/[()]/g, ''));

    const allowed = licenseTokens.some((token) => ALLOWED_LICENSES.has(token));

    if (!allowed) {
      fail(`License violation: ${packageId} is "${licenseStr}" (not in allowed list)`);
      violations++;
    }
  }

  if (violations === 0) {
    pass(`All ${checked} packages have allowed licenses`);
  }
}

// ---------------------------------------------------------------------------
// Check 3: Lockfile integrity
// ---------------------------------------------------------------------------

async function checkLockfileIntegrity(): Promise<void> {
  section('Lockfile integrity');

  let lockfile: Lockfile;

  try {
    lockfile = await readLockfile();
  } catch {
    fail('Could not parse bun.lock — lockfile may be corrupt or missing');
    return;
  }

  const packageManifest = (await Bun.file('package.json').json()) as PackageManifest;

  const allDeclaredDeps = [
    ...Object.keys(packageManifest.dependencies ?? {}),
    ...Object.keys(packageManifest.devDependencies ?? {}),
    ...Object.keys(packageManifest.peerDependencies ?? {}),
  ];

  const resolvedPackages = new Set(Object.keys(lockfile.packages));
  const missing: string[] = [];

  for (const dep of allDeclaredDeps) {
    if (!resolvedPackages.has(dep)) {
      missing.push(dep);
    }
  }

  if (missing.length > 0) {
    fail(
      `Lockfile drift detected — ${missing.length} declared package(s) not resolved in bun.lock: ${missing.join(', ')}`,
    );
    fail('Run `bun install` to refresh the lockfile');
    return;
  }

  // Verify every resolved package has an integrity hash
  let missingIntegrity = 0;
  for (const [name, entry] of Object.entries(lockfile.packages)) {
    if (!entry) continue;
    // entry format: [version, registry, deps, integrity]
    const integrity = entry[3];
    if (!integrity || integrity.trim() === '') {
      warn(`Package ${name} is missing an integrity hash in bun.lock`);
      missingIntegrity++;
    }
  }

  if (missingIntegrity === 0) {
    pass(
      `All ${allDeclaredDeps.length} declared packages are resolved with integrity hashes in bun.lock`,
    );
  } else {
    fail(`${missingIntegrity} package(s) are missing integrity hashes in bun.lock`);
  }
}

// ---------------------------------------------------------------------------
// Check 4: npm provenance requirements
// ---------------------------------------------------------------------------

async function checkProvenance(): Promise<void> {
  section('npm provenance configuration');

  const manifest = (await Bun.file('package.json').json()) as PackageManifest;
  const publishConfig = manifest.publishConfig ?? {};

  // provenance must be explicitly set to true
  if (publishConfig.provenance === true) {
    pass('publishConfig.provenance is set to true');
  } else {
    fail(
      'publishConfig.provenance is not set to true — npm provenance attestation will not be generated on publish. ' +
        'Add `"provenance": true` to the publishConfig field in package.json.',
    );
  }

  // access must be "public" for scoped packages or any public release
  if (publishConfig.access === 'public') {
    pass('publishConfig.access is "public"');
  } else if (publishConfig.access !== undefined) {
    warn(
      `publishConfig.access is "${publishConfig.access}" — expected "public" for provenance`,
    );
  } else {
    warn(
      'publishConfig.access is not set — defaulting to restricted for scoped packages',
    );
  }

  // registry must point to the official npm registry
  const registry = publishConfig.registry ?? 'https://registry.npmjs.org/';
  if (registry === 'https://registry.npmjs.org/') {
    pass(`publishConfig.registry points to the official npm registry`);
  } else {
    warn(
      `publishConfig.registry is "${registry}" — provenance requires the official npm registry`,
    );
  }
}

// ---------------------------------------------------------------------------
// Check 5: Packed-file review
// ---------------------------------------------------------------------------

async function checkPackedFiles(): Promise<void> {
  section('Packed-file review (npm pack --dry-run)');

  let packOutput: string;

  try {
    const result = await Bun.$`npm pack --dry-run --json --ignore-scripts`.quiet();
    packOutput = result.stdout.toString();
  } catch (error) {
    fail(`npm pack --dry-run failed: ${String(error)}`);
    return;
  }

  type PackResult = { files: Array<{ path: string; size: number }> };

  let packResults: PackResult[];
  try {
    packResults = JSON.parse(packOutput) as PackResult[];
  } catch {
    fail('Could not parse npm pack output');
    return;
  }

  const packResult = packResults[0];
  if (!packResult) {
    fail('npm pack returned no results');
    return;
  }

  const packedPaths = packResult.files.map((f) => f.path);
  const surprises: string[] = [];

  for (const filePath of packedPaths) {
    for (const pattern of FORBIDDEN_PACK_PATTERNS) {
      if (pattern.test(filePath)) {
        surprises.push(`${filePath} matches forbidden pattern /${pattern.source}/`);
        break;
      }
    }
  }

  if (surprises.length > 0) {
    for (const surprise of surprises) {
      fail(`Unexpected packed file: ${surprise}`);
    }
  } else {
    pass(`${packedPaths.length} packed files reviewed — no forbidden patterns found`);
  }

  // Warn if the pack is unexpectedly large (> 5 MB uncompressed is suspicious for a library)
  const totalBytes = packResult.files.reduce((sum, f) => sum + f.size, 0);
  const totalMb = totalBytes / (1024 * 1024);
  if (totalMb > 5) {
    warn(
      `Packed size is ${totalMb.toFixed(2)} MB — consider reviewing whether all dist files are necessary`,
    );
  }
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('Supply-chain verification');
  console.log('═'.repeat(60));

  // Collect production dependency names for vulnerability severity gating.
  const packageManifest = (await Bun.file('package.json').json()) as PackageManifest;
  const productionDeps = new Set(Object.keys(packageManifest.dependencies ?? {}));

  await checkVulnerabilities(productionDeps);
  await checkLicenses();
  await checkLockfileIntegrity();
  await checkProvenance();
  await checkPackedFiles();

  console.log('\n' + '═'.repeat(60));

  if (failures > 0) {
    console.error(
      `\n❌ Supply-chain verification FAILED: ${failures} failure(s), ${warnings} warning(s).\n`,
    );
    process.exit(1);
  }

  if (warnings > 0) {
    console.warn(`\n⚠️  Supply-chain verification passed with ${warnings} warning(s).\n`);
  } else {
    console.log('\n✅ All supply-chain checks passed.\n');
  }
}

await main();

export {};
