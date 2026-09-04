# Task 1 Report: Centralize export error taxonomy and extend domain types

## Implementation

- Added shared error modules under `src/errors/`:
  - `errorTypes.ts` maps every `StructuredErrorCode` to the approved `ErrorCategory`.
  - `errorMessages.ts` provides factory-owned default reasons for source-level and new conversion errors.
  - `errorFactories.ts` builds complete `StructuredError` objects from code plus source context, with optional reason overrides where existing services already define stable dynamic text.
- Extended `src/types.ts` with:
  - `ExportMode = "consumed" | "per100g"`
  - `ErrorCategory = "source" | "parse" | "nutrient" | "conversion"`
  - `StructuredError.category`
  - `inline_pc_requires_serving_size` in `StructuredErrorCode`
- Migrated structured-error producers to the shared factory in:
  - `src/services/DailyNoteService.ts`
  - `src/services/FoodParserService.ts`
  - `src/services/NutrientCatalogService.ts`
  - `src/services/NutritionCalculatorService.ts`
  - `src/services/ExportService.ts`
- Preserved existing error codes and existing reason text. The only new default reason added is for `inline_pc_requires_serving_size`.

## TDD RED/GREEN Evidence

### RED

Added failing assertions for:

- parser errors now requiring `category: "parse"`
- missing nutrient-note errors requiring `category: "nutrient"`
- direct construction of `inline_pc_requires_serving_size` through the shared factory

Command:

```bash
corepack pnpm vitest --run src/services/FoodParserService.test.ts src/services/NutritionCalculatorService.test.ts
```

Observed failure:

- `FoodParserService.test.ts` failed because returned errors had no `category`
- `NutritionCalculatorService.test.ts` failed because `../errors/errorFactories` did not exist

### GREEN

Implemented the shared error modules and rewired current producers to them.

Command:

```bash
corepack pnpm vitest --run src/services/FoodParserService.test.ts src/services/NutrientCatalogService.test.ts src/services/NutritionCalculatorService.test.ts
```

Result:

- 3 test files passed
- 16 tests passed

## Files Changed

- `src/types.ts`
- `src/errors/errorTypes.ts`
- `src/errors/errorMessages.ts`
- `src/errors/errorFactories.ts`
- `src/services/DailyNoteService.ts`
- `src/services/ExportService.ts`
- `src/services/FoodParserService.ts`
- `src/services/FoodParserService.test.ts`
- `src/services/NutrientCatalogService.ts`
- `src/services/NutrientCatalogService.test.ts`
- `src/services/NutritionCalculatorService.ts`
- `src/services/NutritionCalculatorService.test.ts`

## Tests

Focused TDD checks:

- `corepack pnpm vitest --run src/services/FoodParserService.test.ts src/services/NutritionCalculatorService.test.ts` -> failed as expected in RED
- `corepack pnpm vitest --run src/services/FoodParserService.test.ts src/services/NutrientCatalogService.test.ts src/services/NutritionCalculatorService.test.ts` -> passed

Repository verification:

- `corepack pnpm typecheck` -> passed
- `corepack pnpm test` -> passed, 9 files / 24 tests
- `corepack pnpm lint` -> passed
- `corepack pnpm build` -> passed
- `corepack pnpm run release:verify-bundle` -> passed
- `git diff --check` -> passed

Note:

- `pnpm build` regenerated `main.js`; it was restored to `HEAD` afterward to respect the task boundary that forbids committing generated root artifacts in this slice.

## Self-Review

- The category mapping covers every current structured error code, including the approved future conversion code.
- Existing dynamic reason text stays unchanged because services pass the same strings into the shared factory.
- `ExportService` was migrated as well so the new required `StructuredError.category` field remains consistent for `nutrition_section_not_found`.
- No UI, settings, manifest, release metadata, or generated artifact changes were committed.

## Concerns

- The repository declares Node `22.x`, but all checks here ran under Node `v24.11.1`; the commands passed, though the engine warning remains.
