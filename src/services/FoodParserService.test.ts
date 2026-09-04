import { TFile } from "obsidian";
import { describe, expect, it } from "vitest";
import { FoodParserService } from "./FoodParserService";

describe("FoodParserService", () => {
  const parserService = new FoodParserService();
  const dailyFile = new TFile("Diary/2026.07.18.md");

  it("parses linked and inline foods only inside the Nutrition section", () => {
    const markdown = `# Title

## Nutrition
#food [[Low-fat cottage cheese (Pilos)|Cottage cheese]] 100g
#food Baked casserole 150g 6.72sugar 2.01fiber 192.52sodium 309.10kcal 27.82prot 14.24fat 8.28satfat 15.63carbs

## Sport
#food [[Ignored]] 10g`;

    const result = parserService.parseNutritionSection(
      dailyFile,
      markdown,
      "## Nutrition",
    );

    expect(result.sectionFound).toBe(true);
    expect(result.results).toHaveLength(2);
    expect(result.results[0]).toMatchObject({
      ok: true,
      entry: {
        kind: "linked",
        displayName: "Cottage cheese",
      },
    });
    expect(result.results[1]).toMatchObject({
      ok: true,
      entry: {
        kind: "inline",
        displayName: "Baked casserole",
      },
    });
  });

  it("parses the Food Recalculator format with a price and trailing calorie duplicate", () => {
    const markdown = `## Nutrition
#food Casserole with boiled chicken fillet, rice, and carrots 217g 0.79€ 392.84kcal 53.06prot 10.10fat 2.98satfat 18.24carbs 2.74sugar 3.34fiber 192.18sodium 393kcal`;

    const result = parserService.parseNutritionSection(
      dailyFile,
      markdown,
      "## Nutrition",
    );

    expect(result.results[0]).toMatchObject({
      ok: true,
      entry: {
        kind: "inline",
        displayName: "Casserole with boiled chicken fillet, rice, and carrots",
        price: 0.79,
        amount: { value: 217, unit: "g" },
        metrics: {
          kcal: 392.84,
          prot: 53.06,
          sodium: 192.18,
        },
      },
    });
  });

  it("ignores food markers inside fenced code blocks", () => {
    const markdown = `## Nutrition
\`\`\`
#food [[Ignored]] 10g
\`\`\`
#food [[Used]] 20g`;

    const result = parserService.parseNutritionSection(
      dailyFile,
      markdown,
      "## Nutrition",
    );

    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({
      ok: true,
      entry: {
        kind: "linked",
        displayName: "Used",
      },
    });
  });

  it("keeps the nearest Nutrition subsection on each food entry", () => {
    const markdown = `## Nutrition
# Breakfast 8:30
#food [[Breakfast food]] 20g
## Lunch 14:30
#food [[Lunch food]] 30g
#food [[Second lunch food]] 40g`;

    const result = parserService.parseFoodEntries(
      dailyFile,
      markdown,
      { kind: "nutrition" },
      "## Nutrition",
    );

    expect(result.results).toMatchObject([
      { ok: true, entry: { source: { sectionHeading: "Breakfast 8:30" } } },
      { ok: true, entry: { source: { sectionHeading: "Lunch 14:30" } } },
      { ok: true, entry: { source: { sectionHeading: "Lunch 14:30" } } },
    ]);
  });

  it("supports the whole document and Nutrition subsections as sources", () => {
    const markdown = `# Title
#food [[Document food]] 10g

## Nutrition
### Breakfast
#food [[Breakfast food]] 20g
#### Details
#food [[Breakfast detail]] 30g
### Dinner
#food [[Dinner food]] 40g

## Sport
#food [[Sport food]] 50g`;

    const options = parserService.getFoodSourceOptions(
      markdown,
      "## Nutrition",
    );
    expect(options.map((option) => option.id)).toEqual([
      "document",
      "nutrition",
      "heading-5",
      "heading-7",
      "heading-9",
    ]);

    const wholeDocumentResult = parserService.parseFoodEntries(
      dailyFile,
      markdown,
      { kind: "document" },
      "## Nutrition",
    );
    expect(wholeDocumentResult.results).toHaveLength(5);

    const breakfastResult = parserService.parseFoodEntries(
      dailyFile,
      markdown,
      {
        kind: "heading",
        headingText: "### Breakfast",
        lineNumber: 5,
      },
      "## Nutrition",
    );
    expect(breakfastResult.results).toHaveLength(2);
    expect(breakfastResult.results[0]).toMatchObject({
      ok: true,
      entry: { displayName: "Breakfast food" },
    });
    expect(breakfastResult.results[1]).toMatchObject({
      ok: true,
      entry: { displayName: "Breakfast detail" },
    });
  });

  it("supports mixed heading levels used by the Diary vault", () => {
    const markdown = `## Nutrition
# Breakfast
#food [[Breakfast food]] 20g
## Lunch
#food [[Lunch food]] 30g
# Dinner
#food [[Dinner food]] 40g
# Notes
Notes with no food entries.`;

    const options = parserService.getFoodSourceOptions(
      markdown,
      "## Nutrition",
    );
    expect(options.map((option) => option.label)).toEqual([
      "Whole document",
      "Nutrition section (## Nutrition)",
      "Subsection: # Breakfast",
      "Subsection: ## Lunch",
      "Subsection: # Dinner",
    ]);

    const result = parserService.parseFoodEntries(
      dailyFile,
      markdown,
      { kind: "nutrition" },
      "## Nutrition",
    );
    expect(result.results).toHaveLength(3);
    expect(
      result.results.map((entry) =>
        entry.ok ? entry.entry.displayName : entry.error.productName,
      ),
    ).toEqual(["Breakfast food", "Lunch food", "Dinner food"]);
  });

  it("keeps multiple food entries from one line in order", () => {
    const markdown = `## Nutrition
7:45 #food [[First]] 10g and #food [[Second]] 1pc`;

    const result = parserService.parseNutritionSection(
      dailyFile,
      markdown,
      "## Nutrition",
    );

    expect(result.results).toHaveLength(2);
    expect(result.results[0]).toMatchObject({
      ok: true,
      entry: { displayName: "First" },
    });
    expect(result.results[1]).toMatchObject({
      ok: true,
      entry: { displayName: "Second" },
    });
  });

  it("returns a structured error for an inline entry with missing nutrition fields", () => {
    const markdown = `## Nutrition
#food Baked casserole 150g 309.10kcal 27.82prot`;

    const result = parserService.parseNutritionSection(
      dailyFile,
      markdown,
      "## Nutrition",
    );

    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toEqual({
      ok: false,
      error: {
        category: "parse",
        code: "incomplete_nutrition_line",
        productName: "Baked casserole",
        reason: "Inline food must contain all nutrition fields exactly once.",
        sourcePath: "Diary/2026.07.18.md",
        lineNumber: 2,
        rawEntry: "#food Baked casserole 150g 309.10kcal 27.82prot",
      },
    });
  });

  it("returns a structured error for an unknown unit token", () => {
    const markdown = `## Nutrition
#food [[Cottage cheese]] 100oz`;

    const result = parserService.parseNutritionSection(
      dailyFile,
      markdown,
      "## Nutrition",
    );

    expect(result.results[0]).toEqual({
      ok: false,
      error: {
        category: "parse",
        code: "unknown_unit",
        productName: "Cottage cheese",
        reason: 'Unknown unit "oz".',
        sourcePath: "Diary/2026.07.18.md",
        lineNumber: 2,
        rawEntry: "#food [[Cottage cheese]] 100oz",
      },
    });
  });
});
