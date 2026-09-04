import { TFile } from "obsidian";
import { describe, expect, it } from "vitest";
import type {
  InlineFoodEntry,
  LinkedFoodEntry,
  NutrientNote,
  NutritionMetrics,
  SourceReference,
} from "../types";

const source: SourceReference = {
  file: new TFile("Diary/2026.09.04.md"),
  lineNumber: 12,
  rawLine: "#food Product",
  rawEntry: "#food Product",
};

const nutrientMetrics: NutritionMetrics = {
  kcal: 50,
  prot: 10,
  fat: 20,
  satfat: 5,
  carbs: 30,
  sugar: 15,
  fiber: 8,
  sodium: 4,
};

const nutrientNote: NutrientNote = {
  file: new TFile("_nutrients/Product.md"),
  name: "Product",
  servingSize: 55,
  ...nutrientMetrics,
};

const linkedGEntry: LinkedFoodEntry = {
  kind: "linked",
  displayName: "Linked G",
  linkTarget: "Product",
  amount: { value: 60, unit: "g", originalUnit: "g" },
  price: null,
  source: {
    ...source,
    rawLine: "#food [[Product]] 60g",
    rawEntry: "#food [[Product]] 60g",
  },
};

const linkedMlEntry: LinkedFoodEntry = {
  kind: "linked",
  displayName: "Linked Ml",
  linkTarget: "Product",
  amount: { value: 40, unit: "ml", originalUnit: "ml" },
  price: null,
  source: {
    ...source,
    rawLine: "#food [[Product]] 40ml",
    rawEntry: "#food [[Product]] 40ml",
  },
};

const linkedPcEntry: LinkedFoodEntry = {
  kind: "linked",
  displayName: "Linked Pc",
  linkTarget: "Product",
  amount: { value: 2, unit: "pc", originalUnit: "pc" },
  price: null,
  source: {
    ...source,
    rawLine: "#food [[Product]] 2pc",
    rawEntry: "#food [[Product]] 2pc",
  },
};

const inlineGEntry: InlineFoodEntry = {
  kind: "inline",
  displayName: "Inline G",
  amount: { value: 10, unit: "g", originalUnit: "g" },
  price: null,
  metrics: nutrientMetrics,
  source: {
    ...source,
    rawLine: "#food Inline G 10g 50kcal",
    rawEntry: "#food Inline G 10g 50kcal",
  },
};

const inlineZeroGEntry: InlineFoodEntry = {
  kind: "inline",
  displayName: "Inline Zero",
  amount: { value: 0, unit: "g", originalUnit: "g" },
  price: null,
  metrics: nutrientMetrics,
  source: {
    ...source,
    rawLine: "#food Inline Zero 0g 50kcal",
    rawEntry: "#food Inline Zero 0g 50kcal",
  },
};

const inlineMlEntry: InlineFoodEntry = {
  kind: "inline",
  displayName: "Inline Ml",
  amount: { value: 25, unit: "ml", originalUnit: "ml" },
  price: null,
  metrics: nutrientMetrics,
  source: {
    ...source,
    rawLine: "#food Inline Ml 25ml 50kcal",
    rawEntry: "#food Inline Ml 25ml 50kcal",
  },
};

const inlinePcEntry: InlineFoodEntry = {
  kind: "inline",
  displayName: "Inline Pc",
  amount: { value: 2, unit: "pc", originalUnit: "pc" },
  price: null,
  metrics: nutrientMetrics,
  source: {
    ...source,
    rawLine: "#food Inline Pc 2pc 50kcal",
    rawEntry: "#food Inline Pc 2pc 50kcal",
  },
};

describe("ExportModeStrategy", () => {
  it("preserves consumed linked calculations and inline values", async () => {
    const { ConsumedExportStrategy } = await import("./ExportModeStrategy");

    const consumed = new ConsumedExportStrategy();

    expect(consumed.resolveLinked(linkedGEntry, nutrientNote)).toEqual({
      values: {
        metrics: {
          kcal: 30,
          prot: 6,
          fat: 12,
          satfat: 3,
          carbs: 18,
          sugar: 9,
          fiber: 4.8,
          sodium: 2.4,
        },
        amount: linkedGEntry.amount,
      },
    });

    expect(consumed.resolveInline(inlineGEntry)).toEqual({
      values: {
        metrics: nutrientMetrics,
        amount: inlineGEntry.amount,
      },
    });
  });

  it("returns raw linked nutrient metrics for per-100g g amounts", async () => {
    const { Per100gExportStrategy } = await import("./ExportModeStrategy");

    const per100g = new Per100gExportStrategy();

    expect(per100g.resolveLinked(linkedGEntry, nutrientNote)).toEqual({
      values: { metrics: nutrientMetrics, amount: linkedGEntry.amount },
    });
  });

  it("preserves ml units for per-100g linked and inline entries", async () => {
    const { Per100gExportStrategy } = await import("./ExportModeStrategy");

    const per100g = new Per100gExportStrategy();

    expect(per100g.resolveLinked(linkedMlEntry, nutrientNote)).toEqual({
      values: { metrics: nutrientMetrics, amount: linkedMlEntry.amount },
    });

    expect(per100g.resolveInline(inlineMlEntry)).toEqual({
      values: {
        metrics: {
          kcal: 200,
          prot: 40,
          fat: 80,
          satfat: 20,
          carbs: 120,
          sugar: 60,
          fiber: 32,
          sodium: 16,
        },
        amount: inlineMlEntry.amount,
      },
    });
  });

  it("converts linked pc entries to gram display amounts for per-100g", async () => {
    const { Per100gExportStrategy } = await import("./ExportModeStrategy");

    const per100g = new Per100gExportStrategy();

    expect(per100g.resolveLinked(linkedPcEntry, nutrientNote)).toEqual({
      values: {
        metrics: nutrientMetrics,
        amount: { value: 110, unit: "g", originalUnit: "g" },
      },
    });
  });

  it("normalizes inline g entries to per-100g metrics", async () => {
    const { Per100gExportStrategy } = await import("./ExportModeStrategy");

    const per100g = new Per100gExportStrategy();

    expect(per100g.resolveInline(inlineGEntry)).toMatchObject({
      values: {
        metrics: {
          kcal: 500,
          prot: 100,
          fat: 200,
          satfat: 50,
          carbs: 300,
          sugar: 150,
          fiber: 80,
          sodium: 40,
        },
        amount: inlineGEntry.amount,
      },
    });
  });

  it("returns a conversion error for inline pc entries in per-100g mode", async () => {
    const { Per100gExportStrategy } = await import("./ExportModeStrategy");

    const per100g = new Per100gExportStrategy();

    expect(per100g.resolveInline(inlinePcEntry)).toMatchObject({
      error: {
        category: "conversion",
        code: "inline_pc_requires_serving_size",
      },
    });
  });

  it("returns a structured error for non-positive inline g amounts in per-100g mode", async () => {
    const { Per100gExportStrategy } = await import("./ExportModeStrategy");

    const per100g = new Per100gExportStrategy();

    expect(per100g.resolveInline(inlineZeroGEntry)).toEqual({
      error: {
        category: "parse",
        code: "missing_amount",
        productName: "Inline Zero",
        reason: "Inline per-100g conversion requires a positive g or ml amount.",
        sourcePath: "Diary/2026.09.04.md",
        lineNumber: 12,
        rawEntry: "#food Inline Zero 0g 50kcal",
      },
    });
  });

  it("returns an invalid serving size error for non-positive linked pc serving sizes", async () => {
    const { Per100gExportStrategy } = await import("./ExportModeStrategy");

    const per100g = new Per100gExportStrategy();

    expect(
      per100g.resolveLinked(linkedPcEntry, {
        ...nutrientNote,
        servingSize: 0,
      }),
    ).toMatchObject({
      error: {
        category: "nutrient",
        code: "invalid_serving_size",
      },
    });
  });
});
