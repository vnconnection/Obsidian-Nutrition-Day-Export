import { TFile } from "obsidian";
import { describe, expect, it } from "vitest";
import { createStructuredError } from "../errors/errorFactories";
import { NutritionCalculatorService } from "./NutritionCalculatorService";

const nutrientNote = {
  file: new TFile("_nutrients/Protein Pudding.md"),
  name: "Protein Pudding",
  servingSize: 400,
  kcal: 42.705,
  prot: 0.82,
  fat: 2.4775,
  satfat: 0,
  carbs: 4.25,
  sugar: 3.16,
  fiber: 0.04,
  sodium: 9.9625,
};

describe("NutritionCalculatorService", () => {
  const calculatorService = new NutritionCalculatorService();

  it("calculates g amounts from 100-unit nutrient values", () => {
    const result = calculatorService.calculateFromNutrient(
      nutrientNote,
      60,
      "g",
      "Protein Pudding",
      "Diary/2026.07.18.md",
      12,
      "#food [[Protein Pudding]] 60g",
    );

    expect(result.error).toBeNull();
    expect(result.metrics?.kcal).toBeCloseTo(25.623, 10);
    expect(result.metrics?.prot).toBeCloseTo(0.492, 10);
    expect(result.metrics?.fat).toBeCloseTo(1.4865, 10);
    expect(result.metrics?.carbs).toBeCloseTo(2.55, 10);
  });

  it("calculates pc amounts through serving_size", () => {
    const result = calculatorService.calculateFromNutrient(
      nutrientNote,
      1,
      "pc",
      "Protein Pudding",
      "Diary/2026.07.18.md",
      12,
      "#food [[Protein Pudding]] 1pc",
    );

    expect(result).toEqual({
      metrics: {
        kcal: 170.82,
        prot: 3.28,
        fat: 9.91,
        satfat: 0,
        carbs: 17,
        sugar: 12.64,
        fiber: 0.16,
        sodium: 39.85,
      },
      error: null,
    });
  });

  it("returns a structured error when serving_size is invalid for pc amounts", () => {
    const result = calculatorService.calculateFromNutrient(
      {
        ...nutrientNote,
        servingSize: null,
      },
      1,
      "pc",
      "Protein Pudding",
      "Diary/2026.07.18.md",
      12,
      "#food [[Protein Pudding]] 1pc",
    );

    expect(result).toEqual({
      metrics: null,
      error: {
        category: "nutrient",
        code: "invalid_serving_size",
        productName: "Protein Pudding",
        reason:
          "Invalid serving_size for _nutrients/Protein Pudding.md. A positive serving_size is required for pc amounts.",
        sourcePath: "Diary/2026.07.18.md",
        lineNumber: 12,
        rawEntry: "#food [[Protein Pudding]] 1pc",
      },
    });
  });

  it("creates the inline pc conversion error with full source context", () => {
    expect(
      createStructuredError("inline_pc_requires_serving_size", {
        productName: "Product",
        sourcePath: "Diary/2026.09.04.md",
        lineNumber: 4,
        rawEntry: "#food Product 2pc",
      }),
    ).toMatchObject({
      category: "conversion",
      code: "inline_pc_requires_serving_size",
      productName: "Product",
      sourcePath: "Diary/2026.09.04.md",
      lineNumber: 4,
      rawEntry: "#food Product 2pc",
    });
  });
});
