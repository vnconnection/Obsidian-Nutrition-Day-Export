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

## Fixed

- Concrete user-visible change.
```

Only `Summary`, `Added`, `Changed`, `Fixed`, `Breaking changes`, and
`Documentation` headings are valid. Generic summaries and notes without a
concrete user-visible change fail validation. The GitHub Release body is taken
from this notes file, not generated automatically.

## Local preparation

Start from a clean worktree and select the impact explicitly:

```bash
corepack pnpm run release:prepare -- --impact fix
corepack pnpm run release:prepare -- --impact feat
corepack pnpm run release:prepare -- --impact breaking
```

`breaking` increments major, `feat` increments minor, and `fix`, `perf`,
`docs`, `test`, `chore`, `ci`, `build`, `refactor`, and `style` increment patch.
Preparation runs typecheck, tests, lint, and the production build, then updates
package and plugin metadata. It never creates a commit or tag, pushes a branch
or tag, creates or edits a GitHub Release, or uploads assets. `unknown` is
intentionally rejected rather than guessed.

Author the matching notes before validation:

```bash
corepack pnpm run release:validate -- <X.Y.Z>
corepack pnpm run release:package -- <X.Y.Z> artifacts/nutrition-day-export-<X.Y.Z>.zip
```

`release:validate` is read-only and checks notes, metadata, and non-empty root
assets. `release:package` only creates a local ZIP; it contains exactly
`main.js`, `manifest.json`, and `styles.css` when present, directly at the
archive root. Neither command publishes anything.

## GitHub Actions

`.github/workflows/release.yml` runs only for bare semver tags. It installs
dependencies with `pnpm install --frozen-lockfile`, runs typecheck, tests, lint,
the production build, and release tests, then validates metadata/assets and
packages the root-layout ZIP. The workflow creates or updates the GitHub
Release with the authored notes and uploads `main.js`, `manifest.json`, the
optional `styles.css`, and the ZIP. A final API read verifies the tag, exact
authored body, and non-empty required assets.

Do not push or create a tag as part of local preparation. Publish only after
reviewing the prepared metadata, authored notes, generated `main.js`, and the
workflow result.
