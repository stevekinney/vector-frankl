# Release Checklist

This document covers the stable release process for Vector Frankl. Follow every step in order; each step links to the actual command that satisfies it.

## Pre-Release Checklist

### Clean Checkout Setup

Start from a pristine state to avoid packaging local artifacts.

```bash
git checkout main
git pull origin main
git status            # must show nothing uncommitted
git clean -fdx --dry-run   # preview what would be removed
git clean -fdx        # remove untracked files and build artifacts
```

### Install Dependencies

```bash
bun install --frozen-lockfile
```

### Production Verification

Run the full quality gate in the clean checkout.

```bash
bun run format:check
bun run lint
bun run typecheck
bun test
```

All checks must exit zero before continuing.

### Continuous Integration Status

Confirm that the `main` branch CI workflow is green before cutting a release tag. Check the CI status badge in the README or run:

```bash
gh run list --branch main --workflow verify.yml --limit 5
```

Every listed run must show `completed / success`. If any run is failing or in-progress, stop and investigate.

### Build for Production

```bash
bun run build
```

Confirm the `dist/` directory is present and populated:

```bash
ls dist/index.js dist/index.d.ts
```

### Packed Package Inspection

Verify the set of files that will be shipped to npm without actually publishing.

```bash
npm pack --dry-run --json | python3 -m json.tool
```

Cross-check the file list against `package.json` exports, `main`, and `types`. The `scripts/check-package.ts` script automates this check:

```bash
bun run package:check
```

Confirm:

- No source files (`.ts` test files, `tests/`, `scripts/`) are included.
- All documented entry points (`dist/index.js`, `dist/index.d.ts`, `dist/adapters/*`) are present.
- `README.md`, `LICENSE`, and `CHANGELOG.md` are included.
- Total package size is reasonable (check for accidentally bundled `node_modules`).

### Version Synchronization

The version in `package.json` must match the tag you are about to create.

```bash
bun -e "process.stdout.write(JSON.parse(require('fs').readFileSync('package.json','utf8')).version + '\n')"
```

Update `package.json` version, commit the change, and verify:

```bash
bun run scripts/check-package.ts   # still passes after version bump
git diff package.json              # only the version field changed
```

### Changelog Update

`CHANGELOG.md` must have an entry for the version being released. Move items from `## [Unreleased]` to a new dated section:

```markdown
## [1.x.y] - YYYY-MM-DD
```

Add a link reference at the bottom of the file:

```markdown
[1.x.y]: https://github.com/stevekinney/vector-frankl/releases/tag/v1.x.y
```

Commit the changelog and version bump together:

```bash
git add package.json CHANGELOG.md
git commit -m "chore: release v1.x.y"
git tag v1.x.y
git push origin main --tags
```

### Release Notes

Draft release notes on GitHub from the changelog entry. Include:

- A one-paragraph summary of what changed.
- Breaking changes section (if any) at the top.
- Migration instructions for any breaking changes.
- Link to the full changelog diff.

```bash
gh release create v1.x.y --generate-notes --draft
# Edit the draft on GitHub before publishing.
```

### npm Provenance

Publish with npm provenance attestation so consumers can verify the package was built from this repository's CI.

```bash
npm publish --provenance --access public
```

> [!NOTE] npm provenance requires publishing from a GitHub Actions workflow with `id-token: write` permissions. Do not publish locally unless provenance is explicitly not required for that release channel.

The recommended publication path is the CI `publish` job (once added to `verify.yml`). Local `npm publish` without provenance is acceptable only for pre-release (`alpha`, `beta`, `rc`) tags.

## Post-Release Verification

### post-release Install Smoke Tests

After the package is live on npm, verify it installs and runs correctly from a clean environment.

```bash
# In a temporary directory outside this repository:
mkdir /tmp/vector-frankl-smoke && cd /tmp/vector-frankl-smoke
bun init -y
bun add vector-frankl@latest
```

Then verify the published package works:

```bash
bun run - <<'EOF'
import { VectorDB } from 'vector-frankl';
if (typeof VectorDB !== 'function') {
  process.stderr.write('FAIL: VectorDB is not a constructor\n');
  process.exit(1);
}
process.stdout.write('post-release smoke test passed\n');
EOF
```

Verify the TypeScript types resolve correctly:

```bash
bun run - <<'EOF'
import type { VectorDB } from 'vector-frankl';
// If this file compiles, types are present. No runtime assertion needed.
const _typeCheck: typeof VectorDB extends new (...args: unknown[]) => unknown ? true : false = true;
void _typeCheck;
EOF
```

Clean up:

```bash
cd - && rm -rf /tmp/vector-frankl-smoke
```

### Verify GitHub Release

Confirm the GitHub release page is published (not draft), the tag resolves to the right commit, and the release assets look correct:

```bash
gh release view v1.x.y
```

### Announce

Post a release announcement if appropriate (blog post, changelog tweet, etc.) linking to the GitHub release page and the npm package page.

---

## Quick Reference

| Step | Command |
|------|---------|
| Clean checkout | `git clean -fdx && bun install --frozen-lockfile` |
| Quality gate | `bun run format:check && bun run lint && bun run typecheck && bun test` |
| CI status | `gh run list --branch main --workflow verify.yml --limit 5` |
| Build | `bun run build` |
| Package inspection | `bun run package:check` |
| Publish with provenance | `npm publish --provenance --access public` |
| post-release smoke | `cd /tmp && mkdir smoke && cd smoke && bun init -y && bun add vector-frankl@latest` |
