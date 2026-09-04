# Nutrition Export Basis Design

## Status

Design approved in conversation on 2026-09-04. This document defines the
implementation contract; it does not authorize publishing or release work.

## Goal

Add a mutually exclusive export-basis choice to the Nutrition Day Export modal:

- `Per consumed` preserves the current behavior and output format.
- `Per 100g` exports nutrition values normalized to 100 grams while retaining
  the actually consumed amount at the end of each line.

The default is always `Per consumed` when a new modal is opened. The choice is
not persisted in plugin settings or `data.json`.

## User-visible behavior

The modal displays two mutually exclusive controls with these labels:

- `Per consumed`
- `Per 100g`

They are implemented with radio semantics, even if the visual treatment is
checkbox-like. Changing the selection refreshes the report. Existing date,
source, heading, error, clipboard, and read-only note behavior remains intact.

`Per consumed` keeps the existing order:

```text
#food Product 10g 0.79€ 216.00kcal 15.60prot ...
```

`Per 100g` uses this order:

```text
#food Product 216.00kcal 15.60prot ... 10g 0.79€
```

The configured decimal precision applies after any normalization. Prices are
preserved and appear after the consumed amount in `Per 100g`.

## Domain contract

Add an export mode type with two values:

```ts
type ExportMode = "consumed" | "per100g";
```

The mode is passed from `NutritionExportModal` to
`ExportService.buildReport(...)` and through export-line resolution. It is not
part of persisted settings.

The calculation boundary uses composition rather than a large inheritance
hierarchy:

```ts
interface ExportModeStrategy {
  resolveLinked(
    entry: LinkedFoodEntry,
    nutrient: NutrientNote,
  ): StrategyResult;

  resolveInline(entry: InlineFoodEntry): StrategyResult;
}
```

The two implementations are `ConsumedExportStrategy` and
`Per100gExportStrategy`. A strategy returns metrics and the amount to print, or
a structured error. The amount returned by a strategy is the export/display
amount; for `Per 100g` and `pc`, it is a derived gram amount.

`ExportService` remains the orchestrator. It parses entries, uses the existing
`NutrientCatalogService` to resolve linked nutrient files, selects the strategy,
collects errors, and assembles the report. Strategies do not read the vault or
resolve files. The common formatter only handles line layout, headings, price,
units, and decimal formatting.

## Calculation rules

Nutrient YAML values are always values per 100 grams. `serving_size` is the gram
weight represented by one `pc` and is used only when a product is logged in
pieces.

| Entry | `Per consumed` | `Per 100g` |
| --- | --- | --- |
| Linked, `g` | Existing calculation for the logged grams | Copy YAML metrics unchanged; print original grams at the end |
| Linked, `ml` | Existing calculation using the numeric amount as the 100-unit basis | Copy YAML metrics unchanged; print original `ml` at the end |
| Linked, `pc` | Existing `serving_size` calculation | Copy YAML metrics unchanged; print `serving_size × pc` as grams at the end |
| Inline, `g` | Existing inline metrics unchanged | Multiply every metric by `100 / amount`; print original grams at the end |
| Inline, `ml` | Existing inline metrics unchanged | Multiply every metric by `100 / amount`; print original `ml` at the end |
| Inline, `pc` | Existing behavior | Return a structured error |

For inline entries in `Per 100g`, the metrics in the source line are treated as
values for the logged amount. For example, `10g` and `50kcal` becomes `500kcal`
per 100g while `10g` remains the consumed amount in the output.

All source notes and nutrient notes remain read-only.

## Error model

Centralize error taxonomy under `src/errors/` rather than constructing ad hoc
messages throughout services:

```text
src/errors/
  errorTypes.ts
  errorFactories.ts
  errorMessages.ts
```

`StructuredError` gains an `ErrorCategory` discriminator:

```ts
type ErrorCategory = "source" | "parse" | "nutrient" | "conversion";
```

Existing codes are grouped as follows:

- `source`: `daily_note_not_found`, `nutrition_section_not_found`
- `parse`: `missing_amount`, `unknown_unit`, `incomplete_nutrition_line`
- `nutrient`: `missing_nutrient_note`, `ambiguous_nutrient_note`,
  `invalid_nutrient_field`, `invalid_serving_size`
- `conversion`: `inline_pc_requires_serving_size`

Factories own stable user-facing reasons. UI code only renders the structured
error. A failed lookup, invalid serving size, or unsupported inline `pc`
conversion excludes that item from the clipboard while preserving successful
items and displaying the error in the modal.

## Agent team and coordination

The coordinator captures the exact base commit and creates a feature branch.
Each independent implementation change uses its own branch and worktree.
Agents communicate through `SendMessage`; files, logs, and commit messages are
not used as a coordination bus.

### Domain-agent

Objective: implement the domain contract, error taxonomy, strategies, export
integration, and domain tests.

Write set:

```text
src/types.ts
src/errors/**
src/services/**
src/services/*.test.ts
```

Must not modify UI, settings, manifests, release files, or generated root
artifacts.

Handoff to the coordinator must include status, commit hash, changed files,
public API, checks passed, and known risks.

### UI-agent

Objective: add the two controls, default state, refresh behavior, visual
styling, UI tests, and user documentation.

The UI-agent starts from the Domain-agent commit in a separate worktree.

Write set:

```text
src/ui/NutritionExportModal.ts
src/ui/NutritionExportModal.test.ts
src/styles.css
README.md
```

Must not alter calculation strategies, error factories, manifests, release
files, or generated root artifacts.

Handoff uses the same structured report and is sent directly to the
coordinator.

### Reviewer-agent

Objective: independently inspect the combined commits and report actionable
findings. The reviewer is read-only and does not create a third implementation
worktree.

Review scope:

- calculation and output matrix;
- error coverage and structured data;
- default and switching behavior in the modal;
- source-note immutability;
- tests, typecheck, lint, build, and generated root artifacts.

The coordinator integrates only reviewed commits, resolves findings, runs the
complete repository gates, and performs the final readback. No push, tag, or
release is included.

## Test and acceptance matrix

Required tests cover:

1. Existing `Per consumed` output remains unchanged.
2. Linked `g` and `ml` use raw YAML metrics in `Per 100g`.
3. Linked `pc` uses `serving_size × pc` as the trailing gram amount.
4. Missing or invalid `serving_size` returns a structured error.
5. Inline `g` and `ml` normalize every metric and preserve the trailing amount.
6. Inline `pc` returns a structured conversion error.
7. Price is preserved after the amount in `Per 100g`.
8. Product order and Nutrition subsection headings remain unchanged.
9. Switching the mode refreshes the preview.
10. A newly opened modal defaults to `Per consumed`.
11. The source daily note is never modified.
12. `corepack pnpm typecheck`, `corepack pnpm test`,
    `corepack pnpm lint`, and `corepack pnpm build` pass.
13. Root `main.js` and `styles.css` are present and synchronized with source;
    `git diff --check` passes.

No dependency, manifest, version, tag, push, or release changes are required
for the feature design itself.
