import { describe, expect, it } from "vitest";
import { formatFoodLine } from "./formatUtils";

describe("formatFoodLine", () => {
  it("formats metric output with the fixed nutrition order", () => {
    const line = formatFoodLine(
      {
        kind: "inline",
        name: "Cottage cheese",
        amount: 10,
        unit: "g",
        sourcePath: "day.md",
        lineNumber: 1,
      },
      {
        kcal: 6.6,
        prot: 1.2,
        fat: 0.05,
        satfat: 0.02,
        carbs: 0.4,
        sugar: 0.4,
        fiber: 0,
        sodium: 0.01,
      },
      {
        nutrientsFolder: "_nutrients",
        nutritionHeading: "## Nutrition",
        outputUnitFormat: "metric",
        decimalPlaces: 2,
      },
    );
    expect(line).toBe(
      "#food Cottage cheese 10г 6.60kcal 1.20prot 0.05fat 0.02satfat 0.40carbs 0.40sugar 0.00fiber 0.01sodium",
    );
  });
});
