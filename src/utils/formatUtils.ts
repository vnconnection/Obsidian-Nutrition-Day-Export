import type {
  FoodEntry,
  NutritionDayExportSettings,
  NutritionValues,
} from "../types";
import { OUTPUT_UNIT_LABELS } from "../constants";
import { formatAmount, formatNumber } from "./numberUtils";

export function formatFoodLine(
  entry: FoodEntry,
  nutrition: NutritionValues,
  settings: NutritionDayExportSettings,
): string {
  const unit = OUTPUT_UNIT_LABELS[settings.outputUnitFormat][entry.unit];
  const decimals = settings.decimalPlaces;
  const priceSegment =
    entry.price === null || entry.price === undefined
      ? ""
      : ` ${formatNumber(entry.price, 2)}€`;
  const values = [
    `${formatNumber(nutrition.kcal, decimals)}kcal`,
    `${formatNumber(nutrition.prot, decimals)}prot`,
    `${formatNumber(nutrition.fat, decimals)}fat`,
    `${formatNumber(nutrition.satfat, decimals)}satfat`,
    `${formatNumber(nutrition.carbs, decimals)}carbs`,
    `${formatNumber(nutrition.sugar, decimals)}sugar`,
    `${formatNumber(nutrition.fiber, decimals)}fiber`,
    `${formatNumber(nutrition.sodium, decimals)}sodium`,
  ];
  return `#food ${entry.name} ${formatAmount(entry.amount, decimals)}${unit}${priceSegment} ${values.join(" ")}`;
}
