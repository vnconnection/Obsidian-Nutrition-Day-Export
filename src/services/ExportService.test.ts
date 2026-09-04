import { App, TFile } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import type { NutritionDayExportSettings } from "../types";
import { ExportService } from "./ExportService";

const settings: NutritionDayExportSettings = {
  nutrientsFolder: "_nutrients",
  nutritionHeading: "## Nutrition",
  outputUnitFormat: "source",
  decimalPlaces: 2,
};

describe("ExportService", () => {
  it("keeps the three-argument consumed export output unchanged", async () => {
    const app = createApp({
      dailyMarkdown: `## Nutrition
#food Baked cottage cheese with banana 217g 0.79€ 392.84kcal 53.06prot 10.10fat 2.98satfat 18.24carbs 2.74sugar 3.34fiber 192.18sodium 393kcal`,
    });

    const report = await new ExportService(app).buildReport("", settings, {
      kind: "nutrition",
    });

    expect(report).not.toHaveProperty("code");
    expect((report as { clipboardText: string }).clipboardText).toBe(
      "#food Baked cottage cheese with banana 217g 0.79€ 392.84kcal 53.06prot 10.10fat 2.98satfat 18.24carbs 2.74sugar 3.34fiber 192.18sodium",
    );
  });

  it("preserves headings and source order in consumed mode", async () => {
    const app = createApp({
      dailyMarkdown: `## Nutrition
# Breakfast 8:30
#food [[Linked breakfast]] 10g
#food Inline breakfast 20g 40kcal 1prot 2fat 3satfat 4carbs 5sugar 6fiber 7sodium
## Lunch 14:30
#food [[Linked lunch]] 2pc`,
      nutrientFiles: [
        createNutrientFile("_nutrients/Linked breakfast.md", {
          name: "Linked breakfast",
          calories: 216,
          protein: 15.6,
          fats: 4.25,
          saturated_fats: 0.63,
          carbs: 64.5,
          sugar: 0.41,
          fiber: 42.8,
          sodium: 314.4,
          serving_size: 55,
        }),
        createNutrientFile("_nutrients/Linked lunch.md", {
          name: "Linked lunch",
          calories: 100,
          protein: 20,
          fats: 30,
          saturated_fats: 40,
          carbs: 50,
          sugar: 60,
          fiber: 70,
          sodium: 80,
          serving_size: 55,
        }),
      ],
    });

    const report = await new ExportService(app).buildReport("", settings, {
      kind: "nutrition",
    });

    expect(report).not.toHaveProperty("code");
    expect((report as { clipboardText: string }).clipboardText).toBe(
      [
        "**Breakfast 8:30**",
        "",
        "#food Linked breakfast 10g 21.60kcal 1.56prot 0.43fat 0.06satfat 6.45carbs 0.04sugar 4.28fiber 31.44sodium",
        "",
        "#food Inline breakfast 20g 40.00kcal 1.00prot 2.00fat 3.00satfat 4.00carbs 5.00sugar 6.00fiber 7.00sodium",
        "",
        "**Lunch 14:30**",
        "",
        "#food Linked lunch 2pc 110.00kcal 22.00prot 33.00fat 44.00satfat 55.00carbs 66.00sugar 77.00fiber 88.00sodium",
      ].join("\n"),
    );
  });

  it("formats linked, inline, and priced entries in per100g mode", async () => {
    const app = createApp({
      dailyMarkdown: `## Nutrition
# Breakfast 8:30
#food [[Product]] 10g
#food Inline ml 25ml 50kcal 10prot 20fat 5satfat 30carbs 15sugar 8fiber 4sodium
## Lunch 14:30
#food [[Piece product]] 2pc
#food Priced product 10g 0.79€ 21.6kcal 1.56prot 0.425fat 0.063satfat 6.45carbs 0.041sugar 4.28fiber 31.44sodium`,
      nutrientFiles: [
        createNutrientFile("_nutrients/Product.md", {
          name: "Product",
          calories: 216,
          protein: 15.6,
          fats: 4.25,
          saturated_fats: 0.63,
          carbs: 64.5,
          sugar: 0.41,
          fiber: 42.8,
          sodium: 314.4,
          serving_size: 55,
        }),
        createNutrientFile("_nutrients/Piece product.md", {
          name: "Piece product",
          calories: 100,
          protein: 20,
          fats: 30,
          saturated_fats: 40,
          carbs: 50,
          sugar: 60,
          fiber: 70,
          sodium: 80,
          serving_size: 55,
        }),
      ],
    });

    const report = await new ExportService(app).buildReport(
      "",
      settings,
      { kind: "nutrition" },
      "per100g",
    );

    expect(report).not.toHaveProperty("code");
    expect((report as { clipboardText: string }).clipboardText).toBe(
      [
        "**Breakfast 8:30**",
        "",
        "#food Product 216.00kcal 15.60prot 4.25fat 0.63satfat 64.50carbs 0.41sugar 42.80fiber 314.40sodium 10g",
        "",
        "#food Inline ml 200.00kcal 40.00prot 80.00fat 20.00satfat 120.00carbs 60.00sugar 32.00fiber 16.00sodium 25ml",
        "",
        "**Lunch 14:30**",
        "",
        "#food Piece product 100.00kcal 20.00prot 30.00fat 40.00satfat 50.00carbs 60.00sugar 70.00fiber 80.00sodium 110g",
        "",
        "#food Priced product 216.00kcal 15.60prot 4.25fat 0.63satfat 64.50carbs 0.41sugar 42.80fiber 314.40sodium 10g 0.79€",
      ].join("\n"),
    );
  });
});

function createApp({
  dailyMarkdown,
  nutrientFiles = [],
}: {
  dailyMarkdown: string;
  nutrientFiles?: Array<{
    file: TFile;
    frontmatter: Record<string, unknown>;
  }>;
}): App {
  const app = new App();
  const dailyFile = new TFile("Diary/2026.09.04.md");
  const nutrientFileMap = new Map(
    nutrientFiles.map((nutrientFile) => [nutrientFile.file.path, nutrientFile]),
  );

  app.workspace.getActiveFile = vi.fn().mockReturnValue(dailyFile);
  app.vault.getMarkdownFiles = vi
    .fn()
    .mockReturnValue([dailyFile, ...nutrientFiles.map(({ file }) => file)]);
  app.vault.cachedRead = vi.fn(async (file: TFile) => {
    if (file.path === dailyFile.path) {
      return dailyMarkdown;
    }

    const nutrientFile = nutrientFileMap.get(file.path);
    if (!nutrientFile) {
      throw new Error(`Unexpected read: ${file.path}`);
    }

    return frontmatterToMarkdown(nutrientFile.frontmatter);
  });
  app.metadataCache.getFileCache = vi.fn((file: TFile) => {
    const nutrientFile = nutrientFileMap.get(file.path);
    return nutrientFile ? { frontmatter: nutrientFile.frontmatter } : null;
  });
  app.metadataCache.getFirstLinkpathDest = vi.fn((linkpath: string) => {
    return (
      nutrientFiles.find(
        ({ file }) => file.basename.toLowerCase() === linkpath.toLowerCase(),
      )?.file ?? null
    );
  });

  return app;
}

function createNutrientFile(
  path: string,
  frontmatter: Record<string, unknown>,
): { file: TFile; frontmatter: Record<string, unknown> } {
  return {
    file: new TFile(path),
    frontmatter,
  };
}

function frontmatterToMarkdown(frontmatter: Record<string, unknown>): string {
  const lines = Object.entries(frontmatter).map(([key, value]) => {
    return `${key}: ${String(value)}`;
  });

  return `---\n${lines.join("\n")}\n---`;
}
