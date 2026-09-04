# Nutrition Export Basis Modes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `Per consumed` and `Per 100g` radio-button modes to Nutrition Day Export while preserving the current export behavior by default.

**Architecture:** Keep `ExportService` as the orchestration boundary and reuse the existing `NutrientCatalogService` for linked nutrient-file lookup. Add an `ExportModeStrategy` interface with `ConsumedExportStrategy` and `Per100gExportStrategy`; strategies return metrics and the amount to print, while a shared formatter controls line layout and price placement.

**Tech Stack:** TypeScript, Obsidian API, Vitest, ESLint, esbuild, pnpm 10, Node 22.

**Spec:** `docs/superpowers/specs/2026-09-04-nutrition-export-basis-design.md`

## Global Constraints

- `Per consumed` preserves the current behavior and output format.
- `Per 100g` exports nutrition values normalized to 100 grams while retaining the actually consumed amount at the end of each line.
- The default is always `Per consumed` when a new modal is opened.
- The choice is not persisted in plugin settings or `data.json`.
- Nutrient YAML values are always values per 100 grams.
- `serving_size` is the gram weight represented by one `pc`.
- All source notes and nutrient notes remain read-only.
- Existing date, source, heading, error, clipboard, and read-only note behavior remains intact.
- Do not add dependencies, modify manifests, change versions, push, tag, or publish a release.
- Keep the generated production artifact at plugin-root `main.js`; build `styles.css` when the source stylesheet changes.

---

### Task 1: Centralize export error taxonomy and extend domain types

**Agent:** Domain-agent

**Files:**
- Create: `src/errors/errorTypes.ts`
- Create: `src/errors/errorFactories.ts`
- Create: `src/errors/errorMessages.ts`
- Modify: `src/types.ts`
- Modify: `src/services/DailyNoteService.ts`
- Modify: `src/services/FoodParserService.ts`
- Modify: `src/services/NutrientCatalogService.ts`
- Modify: `src/services/NutritionCalculatorService.ts`
- Test: existing service test files that assert `StructuredError`

**Interfaces:**
- Produces `ExportMode = "consumed" | "per100g"`.
- Produces `ErrorCategory = "source" | "parse" | "nutrient" | "conversion"`.
- Produces `StructuredError` with `category`, `code`, `productName`, `reason`, `sourcePath`, `lineNumber`, and `rawEntry`.
- Produces a factory that accepts an error code and source context and returns a complete `StructuredError`.
- Existing service callers continue to receive `StructuredError` values rather than thrown exceptions.

- [ ] **Step 1: Write failing tests for centralized error metadata**

Add assertions that an existing parser error contains its category and that the new inline-piece conversion error can be constructed with full source context:

```ts
expect(result.results[0]).toMatchObject({
  ok: false,
  error: {
    category: "parse",
    code: "unknown_unit",
  },
});

expect(createStructuredError("inline_pc_requires_serving_size", {
  productName: "Product",
  sourcePath: "Diary/2026.09.04.md",
  lineNumber: 4,
  rawEntry: "#food Product 2pc",
})).toMatchObject({
  category: "conversion",
  code: "inline_pc_requires_serving_size",
});
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run:

```bash
corepack pnpm vitest --run src/services/FoodParserService.test.ts src/services/NutritionCalculatorService.test.ts
```

Expected: FAIL because existing errors have no `category` and the new factory and conversion code do not yet exist.

- [ ] **Step 3: Implement the shared error module and migrate producers**

Define the code-to-category mapping in `src/errors/errorTypes.ts`. Define stable English reasons in `errorMessages.ts` and a factory in `errorFactories.ts`. Replace direct error-object literals and local factories in the four services with the shared factory. Add `inline_pc_requires_serving_size` to the code union. Preserve every existing error code and reason text unless the new conversion error needs a new reason.

- [ ] **Step 4: Run the focused tests and verify they pass**

```bash
corepack pnpm vitest --run src/services/FoodParserService.test.ts src/services/NutrientCatalogService.test.ts src/services/NutritionCalculatorService.test.ts
```

Expected: PASS, with all pre-existing error assertions updated only to include the required category.

- [ ] **Step 5: Commit the error/type boundary**

```bash
git add src/types.ts src/errors src/services/DailyNoteService.ts src/services/FoodParserService.ts src/services/NutrientCatalogService.ts src/services/NutritionCalculatorService.ts src/services/*.test.ts
git commit -m "refactor: centralize nutrition export errors"
```

### Task 2: Implement consumed and per-100g export strategies

**Agent:** Domain-agent, after Task 1 in the same domain worktree

**Files:**
- Create: `src/services/ExportModeStrategy.ts`
- Create: `src/services/ExportModeStrategy.test.ts`
- Modify: `src/services/NutritionCalculatorService.ts` only if a pure helper is needed and remains backward-compatible

**Interfaces:**
- Consumes `ExportMode`, `LinkedFoodEntry`, `InlineFoodEntry`, `NutrientNote`, `NutritionMetrics`, `AmountValue`, and the centralized error factory.
- Produces:

```ts
export interface ResolvedExportValues {
  metrics: NutritionMetrics;
  amount: AmountValue;
}

export type StrategyResult =
  | { values: ResolvedExportValues; error?: never }
  | { values?: never; error: StructuredError };

export interface ExportModeStrategy {
  resolveLinked(entry: LinkedFoodEntry, nutrient: NutrientNote): StrategyResult;
  resolveInline(entry: InlineFoodEntry): StrategyResult;
}
```

Export `ConsumedExportStrategy` and `Per100gExportStrategy`, both implementing the interface. `ConsumedExportStrategy` delegates linked calculations to the existing `NutritionCalculatorService`; it returns inline metrics unchanged.

- [ ] **Step 1: Write failing strategy tests for the full calculation matrix**

Cover these exact cases:

```ts
expect(consumed.resolveLinked(linkedGEntry, nutrientNote)).toMatchObject({
  values: {
    metrics: { kcal: expect.any(Number) },
    amount: linkedGEntry.amount,
  },
});

expect(per100g.resolveLinked(linkedGEntry, nutrientNote)).toEqual({
  values: { metrics: nutrientMetrics, amount: linkedGEntry.amount },
});

expect(per100g.resolveLinked(linkedPcEntry, nutrientNote)).toEqual({
  values: {
    metrics: nutrientMetrics,
    amount: { value: 110, unit: "g", originalUnit: "g" },
  },
});

expect(per100g.resolveInline(inlineGEntry)).toMatchObject({
  values: {
    metrics: { kcal: 500 },
    amount: inlineGEntry.amount,
  },
});

expect(per100g.resolveInline(inlinePcEntry)).toMatchObject({
  error: {
    category: "conversion",
    code: "inline_pc_requires_serving_size",
  },
});
```

Also test `ml` preserves `unit: "ml"`, and invalid linked `serving_size` returns `invalid_serving_size`.

- [ ] **Step 2: Run the strategy tests and verify they fail**

```bash
corepack pnpm vitest --run src/services/ExportModeStrategy.test.ts
```

Expected: FAIL because the strategy implementations do not exist.

- [ ] **Step 3: Implement both strategies**

For `Per100gExportStrategy`:

- linked `g`/`ml`: return nutrient metrics unchanged and the original amount;
- linked `pc`: validate positive `servingSize`, return nutrient metrics unchanged, and return a gram amount equal to `amount.value * nutrient.servingSize`;
- inline `g`/`ml`: multiply each metric by `100 / entry.amount.value` and return the original amount;
- inline `pc`: return the centralized conversion error.

For `ConsumedExportStrategy`, preserve the current calculator call and current inline values exactly.

- [ ] **Step 4: Run strategy and legacy calculator tests**

```bash
corepack pnpm vitest --run src/services/ExportModeStrategy.test.ts src/services/NutritionCalculatorService.test.ts
```

Expected: PASS, including the existing `pc` serving-size behavior.

- [ ] **Step 5: Commit the strategy boundary**

```bash
git add src/services/ExportModeStrategy.ts src/services/ExportModeStrategy.test.ts src/services/NutritionCalculatorService.ts
git commit -m "feat: add nutrition export basis strategies"
```

### Task 3: Integrate strategies into report assembly and line formatting

**Agent:** Domain-agent, after Task 2

**Files:**
- Modify: `src/services/ExportService.ts`
- Test: `src/services/ExportService.test.ts`

**Interfaces:**
- `buildReport` gains an optional final parameter:

```ts
public async buildReport(
  dateText: string,
  settings: NutritionDayExportSettings,
  sourceSelection: FoodSourceSelection = { kind: "nutrition" },
  exportMode: ExportMode = "consumed",
): Promise<ExportReport | StructuredError>
```

- Existing three-argument callers remain valid and use `"consumed"`.
- `ExportService` selects the strategy through an internal mode map; it still calls `NutrientCatalogService.resolveLinkedNutrient` before linked strategy resolution.

- [ ] **Step 1: Add failing integration tests for output order and prices**

Add report tests for linked `g`, linked `pc`, inline `g`, and a priced product:

```ts
const report = await new ExportService(app).buildReport(
  "",
  settings,
  { kind: "nutrition" },
  "per100g",
);

expect((report as ExportReport).clipboardText).toBe(
  "#food Product 216.00kcal 15.60prot 4.25fat 0.63satfat 64.50carbs 0.41sugar 42.80fiber 314.40sodium 10g 0.79€",
);
```

Assert that the default three-argument call produces the pre-feature output unchanged, and that headings and source order remain unchanged.

- [ ] **Step 2: Run the integration tests and verify they fail**

```bash
corepack pnpm vitest --run src/services/ExportService.test.ts
```

Expected: FAIL because `ExportService` does not yet accept the mode or use the new strategies.

- [ ] **Step 3: Integrate strategy selection and two line layouts**

Instantiate both strategies once in `ExportService`. Pass `exportMode` through entry resolution. Keep nutrient lookup and error aggregation in the service. Update line formatting to produce:

```text
consumed: #food Name amount price metrics
per100g:  #food Name metrics amount price
```

Use configured output-unit labels and decimal precision in both layouts. Do not change heading insertion or clipboard selection logic.

- [ ] **Step 4: Run all domain tests**

```bash
corepack pnpm test
```

Expected: PASS for parser, catalog, calculator, strategy, and export tests.

- [ ] **Step 5: Commit the report integration**

```bash
git add src/services/ExportService.ts src/services/ExportService.test.ts
git commit -m "feat: support per-100g nutrition exports"
```

### Task 4: Add modal radio buttons, UI behavior, styling, and documentation

**Agent:** UI-agent, starting from the Domain-agent's final commit in a separate worktree

**Files:**
- Modify: `src/ui/NutritionExportModal.ts`
- Create: `src/ui/NutritionExportModal.test.ts`
- Modify: `src/styles.css`
- Modify: `README.md`

**Interfaces:**
- Consumes `ExportMode` and the four-argument `ExportService.buildReport` API.
- Produces two native radio buttons grouped under one `name`, labelled exactly `Per consumed` and `Per 100g`.
- Produces `private exportMode: ExportMode = "consumed"` with no persistence.

- [ ] **Step 1: Write failing UI tests**

Mock `ExportService` and verify after `onOpen()` that:

```ts
expect(screen.getByLabelText("Per consumed")).toHaveProperty("checked", true);
expect(screen.getByLabelText("Per 100g")).toHaveProperty("checked", false);
```

Dispatching `change` on `Per 100g` must call `buildReport` with `"per100g"`. A new modal instance must again select `Per consumed`.

- [ ] **Step 2: Run the UI tests and verify they fail**

```bash
corepack pnpm vitest --run src/ui/NutritionExportModal.test.ts
```

Expected: FAIL because the modal has no export-mode controls.

- [ ] **Step 3: Implement native radio controls**

Render a labelled radio group in the existing controls area. Use a stable accessible group label and distinct `id`/`for` pairs. On change, update `exportMode` and call `void this.refresh()`. Pass the mode as the fourth `buildReport` argument. Do not add a settings field or save the selection.

- [ ] **Step 4: Add focused styling and README behavior**

Style the radio group using existing Obsidian variables and the plugin's current class naming convention. Document both modes, the `pc` gram conversion, and that `Per consumed` is the default for each modal opening.

- [ ] **Step 5: Run UI and full tests**

```bash
corepack pnpm vitest --run src/ui/NutritionExportModal.test.ts src/main.test.ts
corepack pnpm test
```

Expected: PASS, including the existing command and settings tests.

- [ ] **Step 6: Commit the UI boundary**

```bash
git add src/ui/NutritionExportModal.ts src/ui/NutritionExportModal.test.ts src/styles.css README.md
git commit -m "feat: add export basis radio controls"
```

### Task 5: Review, integrate, and verify the production artifact

**Agent:** Reviewer-agent is read-only; coordinator owns integration

**Files:**
- Review: Domain-agent and UI-agent commits and their worktrees
- Modify only if a reviewed finding requires it: the owning agent's files
- Generate: root `main.js` and `styles.css` through the production build

**Interfaces:**
- Reviewer consumes both commit hashes, the approved spec, this plan, and the acceptance matrix.
- Reviewer produces a direct `SendMessage` report with `PASS` or actionable findings grouped by priority and file.

- [ ] **Step 1: Send the Domain-agent handoff to the coordinator**

The message must include the commit hash, changed files, exported strategy API, tests run, and any risks. The coordinator must not use files or commit messages as a communication bus.

- [ ] **Step 2: Send the UI-agent the exact Domain-agent commit**

The message must include the base commit, UI write set, forbidden files, and the required fourth argument to `buildReport`.

- [ ] **Step 3: Ask the Reviewer-agent to inspect both commits**

The reviewer checks the calculation matrix, error categories, output order, price placement, radio default/reset behavior, source immutability, and tests.

- [ ] **Step 4: Integrate only reviewed commits into the feature branch**

Use the coordinator's feature branch. Preserve both logical commits where possible; do not push or merge into `main` during this plan.

- [ ] **Step 5: Run the complete repository quality gates**

```bash
corepack pnpm typecheck
corepack pnpm test
corepack pnpm lint
corepack pnpm build
git diff --check
test -s main.js
test -s styles.css
```

Expected: every command succeeds, root artifacts are non-empty, and generated assets correspond to the final source.

- [ ] **Step 6: Perform final readback**

Check `git status --short --branch`, inspect the final diff for unrelated files, confirm no release files changed, and report the feature branch, commits, checks, and any remaining release step separately.
