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

Impact: patch

Rationale: Why this impact classification is correct for existing users.

## Summary

Short, user-visible summary.

## User-visible changes

- Concrete user-visible change.
```

Only `Summary` and `User-visible changes` headings are valid for every release,
with exactly one of each. `Breaking changes` and `Migration` are valid only for
`major` impact, and both must be present with meaningful content for a major
release. No alternative headings are accepted. The fields must use the exact
forms `Impact: major|minor|patch|none|unknown`, `Rationale: <prose>`, and
appear as inline lines before `## Summary` in the order `Date`, `Impact`,
`Rationale`. All three fields and the required sections must contain meaningful
content. Validation accepts `none` and `unknown` so a no-release decision or a
blocking classification can be recorded and checked; neither is a bumpable
impact or a basis for release preparation, packaging, or publication. The notes
must contain a concrete user-visible change. The GitHub Release body is taken
from this notes file, not generated automatically.

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
or tag, creates or edits a GitHub Release, or uploads assets. `none` and
`unknown` are intentionally rejected by preparation rather than guessed; use
`release:validate` to check their notes without selecting a version bump.

To inspect an advisory without changing files:

```bash
corepack pnpm run release:classify -- --input $'feat: change export format\n\nBREAKING-CHANGE: migrate callers'
```

The same classifier input can be passed explicitly with `--input` (or its
`--message`/`-m` aliases); these options take the advisory text as their next
argument and never read or modify repository files.

The safe aliases `release:patch`, `release:minor`, and `release:major` invoke
the same explicit local preparation with `patch`, `minor`, and `major` impact.

Author the matching notes before validation:

```bash
corepack pnpm run release:validate -- <X.Y.Z>
corepack pnpm run release:package -- <X.Y.Z> artifacts/nutrition-day-export-<X.Y.Z>.zip
```

`release:validate` is read-only and checks notes, metadata, and non-empty root
assets. `release:publish-check` performs the same validation and then rejects
`none` and `unknown` before a publishable boundary. `release:package` applies
that same rejection and only creates a local ZIP; it contains exactly
`main.js`, `manifest.json`, and `styles.css` when present, directly at the
archive root. Neither command publishes anything. The workflow additionally
checks the tracked generated `main.js` after build, rejects `none` and
`unknown`, checks the remote tag target, release status, exact asset set,
non-zero sizes, and SHA-256 digests for every published asset.

## GitHub Actions

`.github/workflows/release.yml` runs only for bare semver tags. Its glob admits
both `0.x.y` and non-zero major versions; the shell semver check enforces the
exact `X.Y.Z` form. It installs dependencies with `pnpm install --frozen-lockfile`, runs typecheck, tests, lint,
the production build, and release tests, then verifies tracked generated
`main.js` provenance, validates metadata/assets, rejects non-publishable
impacts, and packages the root-layout ZIP. The workflow creates or updates the
GitHub Release with the authored notes and uploads `main.js`, `manifest.json`, the
optional `styles.css`, and the ZIP. A final API read verifies the tag, exact
authored body, exact asset set (including absence of stale extras), non-empty
assets, and SHA-256 digests.

Do not push or create a tag as part of local preparation. Publish only after
reviewing the prepared metadata, authored notes, generated `main.js`, and the
workflow result.
