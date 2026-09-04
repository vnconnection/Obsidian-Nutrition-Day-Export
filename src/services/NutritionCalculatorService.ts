import { createStructuredError } from "../errors/errorFactories";
import type {
  NutrientNote,
  NutritionMetrics,
  StructuredError,
  UnitKey,
} from "../types";

export class NutritionCalculatorService {
  public calculateFromNutrient(
    nutrient: NutrientNote,
    amountValue: number,
    unit: UnitKey,
    productName: string,
    sourcePath: string,
    lineNumber: number,
    rawEntry: string,
  ): { metrics: NutritionMetrics | null; error: StructuredError | null } {
    const ratioResult = this.getRatio(nutrient, amountValue, unit);
    if (typeof ratioResult !== "number") {
      return {
        metrics: null,
        error: createStructuredError(
          "invalid_serving_size",
          {
            productName,
            sourcePath,
            lineNumber,
            rawEntry,
          },
          {
            reason: ratioResult,
          },
        ),
      };
    }

    return {
      metrics: {
        kcal: nutrient.kcal * ratioResult,
        prot: nutrient.prot * ratioResult,
        fat: nutrient.fat * ratioResult,
        satfat: nutrient.satfat * ratioResult,
        carbs: nutrient.carbs * ratioResult,
        sugar: nutrient.sugar * ratioResult,
        fiber: nutrient.fiber * ratioResult,
        sodium: nutrient.sodium * ratioResult,
      },
      error: null,
    };
  }

  private getRatio(
    nutrient: NutrientNote,
    amountValue: number,
    unit: UnitKey,
  ): number | string {
    if (unit === "g" || unit === "ml") {
      return amountValue / 100;
    }

    if (!nutrient.servingSize || nutrient.servingSize <= 0) {
      return `Invalid serving_size for ${nutrient.file.path}. A positive serving_size is required for pc amounts.`;
    }

    return (amountValue * nutrient.servingSize) / 100;
  }
}
