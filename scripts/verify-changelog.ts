#!/usr/bin/env bun

/**
 * Verify CHANGELOG.md is present, valid, and consistent with package.json version.
 *
 * Checks:
 * 1. CHANGELOG.md exists and is non-empty
 * 2. CHANGELOG.md follows Keep a Changelog format (has ## [Unreleased] or a version heading)
 * 3. The current package.json version has an entry in the changelog
 * 4. The changelog has at least one documented version entry
 *
 * Fails loudly when:
 * - CHANGELOG.md is missing
 * - CHANGELOG.md has no version entries
 * - The current package version has no changelog entry (for non-beta/non-prerelease versions)
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

let failures = 0;
let passed = 0;

function fail(message: string): void {
  console.error(`  FAIL: ${message}`);
  failures++;
}

function pass(message: string): void {
  process.stdout.write(`  pass: ${message}\n`);
  passed++;
}

type PackageManifest = {
  version?: string;
};

const packageManifest = (await Bun.file(
  join(root, 'package.json'),
).json()) as PackageManifest;
const packageVersion = packageManifest.version;

// 1. Check CHANGELOG.md exists
process.stdout.write('\nChecking CHANGELOG.md...\n');
const changelogPath = join(root, 'CHANGELOG.md');
if (!existsSync(changelogPath)) {
  fail('CHANGELOG.md not found — a changelog is required before release');
  process.exit(1);
}
pass('CHANGELOG.md exists');

const changelogContent = await Bun.file(changelogPath).text();
if (changelogContent.trim().length === 0) {
  fail('CHANGELOG.md is empty');
  process.exit(1);
}
pass('CHANGELOG.md is non-empty');

// 2. Check for proper Keep a Changelog format
process.stdout.write('\nValidating CHANGELOG.md format...\n');

// Must have a top-level heading
if (
  !changelogContent.includes('# Changelog') &&
  !changelogContent.includes('# CHANGELOG')
) {
  fail('CHANGELOG.md is missing a "# Changelog" top-level heading');
} else {
  pass('CHANGELOG.md has top-level "# Changelog" heading');
}

// Must have at least one version section heading like ## [x.y.z] or ## [Unreleased]
const versionHeadingPattern = /^## \[/m;
if (!versionHeadingPattern.test(changelogContent)) {
  fail(
    'CHANGELOG.md has no version headings (expected "## [version]" or "## [Unreleased]" sections)',
  );
} else {
  pass('CHANGELOG.md has version section headings');
}

// Extract all version entries
const versionEntryPattern = /^## \[([^\]]+)\]/gm;
const versionEntries: string[] = [];
for (const match of changelogContent.matchAll(versionEntryPattern)) {
  versionEntries.push(match[1] ?? '');
}

if (versionEntries.length === 0) {
  fail('CHANGELOG.md has no parseable version entries');
} else {
  pass(
    `CHANGELOG.md has ${versionEntries.length} version entry/entries: ${versionEntries.join(', ')}`,
  );
}

// 3. Check that the current package version has a changelog entry
process.stdout.write('\nChecking current version has changelog entry...\n');
if (!packageVersion) {
  process.stdout.write('  skip: package.json has no "version" field\n');
} else {
  // For pre-release/beta versions, allow "Unreleased" to count
  const isPreRelease = packageVersion.includes('-');

  const hasVersionEntry = versionEntries.includes(packageVersion);
  const hasUnreleased = versionEntries.includes('Unreleased');

  if (hasVersionEntry) {
    pass(`CHANGELOG.md has entry for version ${packageVersion}`);
  } else if (isPreRelease && hasUnreleased) {
    pass(
      `Version ${packageVersion} is a pre-release — "Unreleased" section accepted as changelog entry`,
    );
  } else if (isPreRelease) {
    process.stdout.write(
      `  info: Version ${packageVersion} is a pre-release with no changelog entry — add one before stable release\n`,
    );
  } else {
    fail(
      `CHANGELOG.md has no entry for version ${packageVersion} — add a "## [${packageVersion}]" section`,
    );
  }
}

// 4. Check changelog has at least one non-Unreleased entry (for non-initial releases)
process.stdout.write('\nChecking changelog has documented release history...\n');
const releasedVersions = versionEntries.filter((v) => v !== 'Unreleased');
if (releasedVersions.length === 0) {
  process.stdout.write(
    '  info: CHANGELOG.md only has an [Unreleased] section — add a release entry before stable release\n',
  );
} else {
  pass(`CHANGELOG.md has ${releasedVersions.length} released version(s)`);
}

// 5. Check for common changelog anti-patterns
process.stdout.write('\nChecking for changelog quality issues...\n');
const lines = changelogContent.split('\n');
let hasTodoMarkers = false;

for (const [index, line] of lines.entries()) {
  if (/\bTODO\b|\bFIXME\b|\bXXX\b/.test(line)) {
    fail(`CHANGELOG.md:${index + 1} contains a TODO/FIXME marker: ${line.trim()}`);
    hasTodoMarkers = true;
  }
}

if (!hasTodoMarkers) {
  pass('CHANGELOG.md has no TODO/FIXME markers');
}

process.stdout.write('\n');
if (failures > 0) {
  console.error(
    `Changelog verification failed with ${failures} error(s) (${passed} passed).`,
  );
  console.error(
    'Update CHANGELOG.md to follow Keep a Changelog format before releasing.',
  );
  process.exit(1);
}

process.stdout.write(`Changelog verification passed: ${passed} check(s).\n`);

export {};
