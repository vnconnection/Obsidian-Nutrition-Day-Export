import type { ErrorCategory, StructuredErrorCode } from "../types";

export const ERROR_CATEGORY_BY_CODE: Record<StructuredErrorCode, ErrorCategory> =
  {
    daily_note_not_found: "source",
    nutrition_section_not_found: "source",
    missing_amount: "parse",
    unknown_unit: "parse",
    incomplete_nutrition_line: "parse",
    missing_nutrient_note: "nutrient",
    ambiguous_nutrient_note: "nutrient",
    invalid_nutrient_field: "nutrient",
    invalid_serving_size: "nutrient",
    inline_pc_requires_serving_size: "conversion",
  };

export function getErrorCategory(code: StructuredErrorCode): ErrorCategory {
  return ERROR_CATEGORY_BY_CODE[code];
}
