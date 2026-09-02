# Release contract

## Required release state

The plugin id is `nutrition-day-export`. A release uses one exact bare semver
value (`X.Y.Z`) in the tag, `package.json`, `manifest.json`, and the matching
`versions.json` entry. Tags with a `v` prefix or suffix are rejected.

The release root must contain non-empty `main.js` and `manifest.json`. A
non-empty root `styles.css` is included when the build produces it. The
repository also requires authored notes at `docs/releases/<X.Y.Z>.md`:

```markdown
# Release X.Y.Z

Date: YYYY-MM-DD

## Summary

Short, user-visible summary.

Impact: patch

Rationale: Why this impact classification is correct for existing users.

## User-visible changes

- Concrete user-visible change.
```

Only `Summary`, `User-visible changes`, `Added`, `Changed`, `Fixed`, `Breaking
changes`, `Migration`, and `Documentation` headings are valid, with exactly one
`Summary` and one `User-visible changes` heading. The fields must use the exact
forms `Impact: major|minor|patch`, `Rationale: <prose>`, and contain meaningful
content; `none` and `unknown` are rejected for a publishable release. The notes
must contain a concrete user-visible change. For `major` impact, include both
`Breaking changes` and `Migration` sections with meaningful content. The GitHub
Release body is taken from this notes file, not generated automatically.

## Local preparation

Start from a clean worktree and select the canonical impact explicitly:

```bash
corepack pnpm run release:prepare -- --impact patch
corepack pnpm run release:prepare -- --impact minor
corepack pnpm run release:prepare -- --impact major
```

The classifier returns the canonical impacts `major`, `minor`, `patch`, `none`,
or `unknown`. Conventional headers map `feat` to `minor`, `fix` and `perf` to
`patch`, and documentation/test/maintenance types to `none`. A `!` header or a
`BREAKING-CHANGE` footer maps to `major`. A mixed result containing `unknown`
is `unknown` and blocks version selection.

`major` maps to `(X+1).0.0`, `minor` maps to `X.(Y+1).0`, and `patch` maps to
`X.Y.(Z+1)`, including when `X` is `0`. Preparation
runs the pnpm typecheck, tests, lint, and production build, then updates
package and plugin metadata. It never stages, commits, tags, pushes a branch
or tag, creates or edits a GitHub Release, or uploads assets. `unknown` and
`none` are intentionally rejected rather than guessed.

To inspect an advisory without changing files:

```bash
corepack pnpm run release:classify -- $'feat: change export format\n\nBREAKING-CHANGE: migrate callers'
```

The safe aliases `release:patch`, `release:minor`, and `release:major` invoke
the same explicit local preparation with `patch`, `minor`, and `major` impact.

Author the matching notes before validation:

```bash
corepack pnpm run release:validate -- <X.Y.Z>
corepack pnpm run release:package -- <X.Y.Z> artifacts/nutrition-day-export-<X.Y.Z>.zip
```

`release:validate` is read-only and checks notes, metadata, and non-empty root
assets. `release:package` only creates a local ZIP; it contains exactly
`main.js`, `manifest.json`, and `styles.css` when present, directly at the
archive root. Neither command publishes anything. The workflow additionally
checks the remote tag target, release status, exact asset set, non-zero sizes,
and SHA-256 digests for every published asset.

## GitHub Actions

`.github/workflows/release.yml` runs only for bare semver tags. Its glob admits
both `0.x.y` and non-zero major versions; the shell semver check enforces the
exact `X.Y.Z` form. It installs dependencies with `pnpm install --frozen-lockfile`, runs typecheck, tests, lint,
the production build, and release tests, then validates metadata/assets and
packages the root-layout ZIP. The workflow creates or updates the GitHub
Release with the authored notes and uploads `main.js`, `manifest.json`, the
optional `styles.css`, and the ZIP. A final API read verifies the tag, exact
authored body, exact asset set (including absence of stale extras), non-empty
assets, and SHA-256 digests.

Do not push or create a tag as part of local preparation. Publish only after
reviewing the prepared metadata, authored notes, generated `main.js`, and the
workflow result.
