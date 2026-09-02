# Nutrition Day Export

Nutrition Day Export is an Obsidian plugin that reads `#food` entries from the `## Nutrition` section of a daily note and copies normalized nutrition lines to the clipboard.

## Purpose

The plugin is built for a daily-note food logging workflow where nutrition data lives either in linked `_nutrients` notes or directly inside inline `#food` strings.

## Features

- Uses the active daily note by default
- Lets you export another day using a native date picker or the `Today` button
- Lets you export the whole document, the configured Nutrition section, or any subsection under Nutrition
- Ignores fenced code blocks
- Supports multiple `#food` entries on one line
- Supports linked foods and inline custom foods
- Resolves `g`, `ml`, `pc` and `г`, `мл`, `шт`
- Copies only successful product lines to the clipboard
- Shows structured per-product errors without changing the source note

## Install with BRAT

1. Install and enable [BRAT](https://github.com/TfTHacker/obsidian42-brat).
2. Run `BRAT: Add a beta plugin for testing`.
3. Enter `Kiep13/Obsidian-Nutrition-Day-Export`.

BRAT installs the matching GitHub Release assets `main.js` and `manifest.json`.
After installation, enable **Nutrition Day Export** in Obsidian community plugins.

## Configuration

Open **Settings -> Community plugins -> Nutrition Day Export**.

Available settings:

- `Nutrients folder` - vault-relative folder containing nutrient notes. Default: `_nutrients`
- `Nutrition heading` - heading used as the section boundary. Default: `## Nutrition`
- `Food source` (in the export modal) - whole document, Nutrition section, or a detected subsection under Nutrition
- `Output units` - `г/мл/шт` or `g/ml/pc`
- `Decimal places` - formatting precision for exported metrics. Default: `2`

## Development

Standard toolchain:

- `pnpm`
- `Node 22`
- `esbuild`
- `TypeScript`
- `ESLint`
- `Prettier`
- `Vitest`

Useful commands:

```bash
corepack pnpm install
corepack pnpm typecheck
corepack pnpm test
corepack pnpm lint
corepack pnpm build
```

`pnpm build` produces the distributable `main.js` at the plugin root. If the plugin gains a `src/styles.css` file, the build also copies it to the root as `styles.css`.

## Release

This repository publishes tagged GitHub Releases for BRAT. The release tag and
the versions in `package.json`, `manifest.json`, and `versions.json` use the
same semver value.

For a release, first author `docs/releases/<X.Y.Z>.md`, then prepare the version
from a clean worktree with an explicit impact:

```bash
corepack pnpm run release:prepare -- --impact fix
corepack pnpm run release:prepare -- --impact feat
corepack pnpm run release:prepare -- --impact breaking

# Safe aliases for the same explicit local preparation
corepack pnpm run release:patch
corepack pnpm run release:minor
corepack pnpm run release:major
```

Preparation runs the repository checks and updates `package.json`,
`manifest.json`, and `versions.json` locally. It does not commit, tag, push, or
publish or stage files. Use `corepack pnpm run release:classify -- <advisory>`
to classify a release advisory without changing files. See
[`docs/RELEASE.md`](docs/RELEASE.md) for the required notes sections,
validation, packaging, and the bare-tag GitHub Actions flow.

## Testing

Run:

```bash
corepack pnpm test
corepack pnpm test:watch
```

The unit tests cover:

- nutrition-section parsing boundaries
- fenced code block exclusion
- multiple `#food` entries on one line
- linked and inline food parsing
- `g`, `ml`, and `pc` calculations
- structured expected errors for invalid nutrient data
