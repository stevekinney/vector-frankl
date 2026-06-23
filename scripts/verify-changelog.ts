/**
 * Verify that CHANGELOG.md is synchronized with the current package version.
 *
 * Fails loudly when:
 *   - A `## [<version>]` heading is absent from CHANGELOG.md
 *   - A reference link `[<version>]: https://...` is absent from CHANGELOG.md
 *
 * The `[Unreleased]` section is always permitted and never checked against the
 * package version. Only released versions (i.e., anything in `package.json`
 * `version` that is not `Unreleased`) must have both a heading and a link.
 */

type PackageManifest = { version: string };

const packageManifest = (await Bun.file('package.json').json()) as PackageManifest;
const version = packageManifest.version;

const changelog = await Bun.file('CHANGELOG.md').text();

const headingPattern = new RegExp(`^## \\[${escapeRegex(version)}\\]`, 'm');
const linkPattern = new RegExp(`^\\[${escapeRegex(version)}\\]:`, 'm');

const errors: string[] = [];

if (!headingPattern.test(changelog)) {
  errors.push(
    `CHANGELOG.md is missing a release heading for version ${version}.\n` +
      `  Expected a line matching: ## [${version}]`,
  );
}

if (!linkPattern.test(changelog)) {
  errors.push(
    `CHANGELOG.md is missing a reference link for version ${version}.\n` +
      `  Expected a line matching: [${version}]: https://...`,
  );
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`\nERROR: ${error}`);
  }
  console.error(
    `\nFix: add a ## [${version}] heading and a [${version}]: <url> link to CHANGELOG.md.`,
  );
  process.exit(1);
}

console.log(`CHANGELOG.md verified: heading and link present for version ${version}.`);

function escapeRegex(text: string): string {
  return text.replaceAll(/[$()*+.?[\\\]^{|}]/g, '\\$&');
}

export {};
