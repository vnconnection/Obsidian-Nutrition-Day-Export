# Release

## Contract

The plugin id is `nutrition-day-export`. `package.json`, `manifest.json`, and
the current `versions.json` entry must agree on the exact bare `X.Y.Z` version.
`main.js` and `manifest.json` are required release assets; `styles.css` is
included when present. Every release also needs authored notes at
`docs/releases/<X.Y.Z>.md`.

## Local preparation

Start from a clean worktree. Select the impact explicitly:

```bash
corepack pnpm run release:prepare -- --impact fix
corepack pnpm run release:prepare -- --impact feat
corepack pnpm run release:prepare -- --impact breaking
```

`breaking` increments major, `feat` increments minor, and `fix`, `perf`,
`docs`, `test`, `chore`, `ci`, `build`, `refactor`, and `style` increment patch.
Preparation runs typecheck, tests, lint, and the production build, then updates
package and plugin metadata. It never creates commits or tags and does not
publish anything. `unknown` is intentionally rejected.

Author the matching notes before validation:

```bash
corepack pnpm run release:validate -- <X.Y.Z>
corepack pnpm run release:package -- <X.Y.Z> artifacts/nutrition-day-export-<X.Y.Z>.zip
```

The ZIP contains exactly the release assets at its root.

## GitHub Actions

The release workflow runs only for bare semver tags. It installs dependencies
with `--frozen-lockfile`, runs repository checks, validates metadata/assets and
authored notes, packages the root-layout ZIP, and creates or updates the GitHub
Release using the notes file. It then reads the published Release back and
checks the tag, authored body, and non-empty asset names.

Do not push or create a tag as part of local preparation. Publish only after
reviewing the prepared metadata, authored notes, generated `main.js`, and the
workflow result.
