import { createStructuredError } from "../errors/errorFactories";
import type {
  AmountValue,
  InlineFoodEntry,
  LinkedFoodEntry,
  NutrientNote,
  NutritionMetrics,
  StructuredError,
} from "../types";
import { NutritionCalculatorService } from "./NutritionCalculatorService";

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

export class ConsumedExportStrategy implements ExportModeStrategy {
  private readonly nutritionCalculatorService = new NutritionCalculatorService();

  public resolveLinked(
    entry: LinkedFoodEntry,
    nutrient: NutrientNote,
  ): StrategyResult {
    const calculation = this.nutritionCalculatorService.calculateFromNutrient(
      nutrient,
      entry.amount.value,
      entry.amount.unit,
      entry.displayName,
      entry.source.file.path,
      entry.source.lineNumber,
      entry.source.rawEntry,
    );

    if (calculation.error || !calculation.metrics) {
      return { error: calculation.error as StructuredError };
    }

    return {
      values: {
        metrics: calculation.metrics,
        amount: entry.amount,
      },
    };
  }

  public resolveInline(entry: InlineFoodEntry): StrategyResult {
    return {
      values: {
        metrics: entry.metrics,
        amount: entry.amount,
      },
    };
  }
}

export class Per100gExportStrategy implements ExportModeStrategy {
  public resolveLinked(
    entry: LinkedFoodEntry,
    nutrient: NutrientNote,
  ): StrategyResult {
    if (entry.amount.unit === "pc") {
      if (!nutrient.servingSize || nutrient.servingSize <= 0) {
        return {
          error: createStructuredError(
            "invalid_serving_size",
            {
              productName: entry.displayName,
              sourcePath: entry.source.file.path,
              lineNumber: entry.source.lineNumber,
              rawEntry: entry.source.rawEntry,
            },
            {
              reason: `Invalid serving_size for ${nutrient.file.path}. A positive serving_size is required for pc amounts.`,
            },
          ),
        };
      }

      return {
        values: {
          metrics: copyMetrics(nutrient),
          amount: {
            value: entry.amount.value * nutrient.servingSize,
            unit: "g",
            originalUnit: "g",
          },
        },
      };
    }

    return {
      values: {
        metrics: copyMetrics(nutrient),
        amount: entry.amount,
      },
    };
  }

  public resolveInline(entry: InlineFoodEntry): StrategyResult {
    if (entry.amount.unit === "pc") {
      return {
        error: createStructuredError("inline_pc_requires_serving_size", {
          productName: entry.displayName,
          sourcePath: entry.source.file.path,
          lineNumber: entry.source.lineNumber,
          rawEntry: entry.source.rawEntry,
        }),
      };
    }

    const ratio = 100 / entry.amount.value;
    return {
      values: {
        metrics: scaleMetrics(entry.metrics, ratio),
        amount: entry.amount,
      },
    };
  }
}

function copyMetrics(metrics: NutritionMetrics): NutritionMetrics {
  return {
    kcal: metrics.kcal,
    prot: metrics.prot,
    fat: metrics.fat,
    satfat: metrics.satfat,
    carbs: metrics.carbs,
    sugar: metrics.sugar,
    fiber: metrics.fiber,
    sodium: metrics.sodium,
  };
}

function scaleMetrics(
  metrics: NutritionMetrics,
  ratio: number,
): NutritionMetrics {
  return {
    kcal: metrics.kcal * ratio,
    prot: metrics.prot * ratio,
    fat: metrics.fat * ratio,
    satfat: metrics.satfat * ratio,
    carbs: metrics.carbs * ratio,
    sugar: metrics.sugar * ratio,
    fiber: metrics.fiber * ratio,
    sodium: metrics.sodium * ratio,
  };
}
