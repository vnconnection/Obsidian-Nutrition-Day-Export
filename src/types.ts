import type { TFile } from "obsidian";

export type NutritionMetricKey =
  "kcal" | "prot" | "fat" | "satfat" | "carbs" | "sugar" | "fiber" | "sodium";

export type UnitKey = "g" | "ml" | "pc";
export type OutputUnitFormat = "metric" | "source";
export type ExportMode = "consumed" | "per100g";
export type ErrorCategory =
  | "source"
  | "parse"
  | "nutrient"
  | "conversion";

export type FoodSourceSelection =
  | { kind: "document" }
  | { kind: "nutrition" }
  | { kind: "heading"; headingText: string; lineNumber: number };

export interface FoodSourceOption {
  id: string;
  label: string;
  selection: FoodSourceSelection;
}

export interface NutritionMetrics {
  kcal: number;
  prot: number;
  fat: number;
  satfat: number;
  carbs: number;
  sugar: number;
  fiber: number;
  sodium: number;
}

export type NutritionValues = NutritionMetrics;

export interface NutritionDayExportSettings {
  nutrientsFolder: string;
  nutritionHeading: string;
  outputUnitFormat: OutputUnitFormat;
  decimalPlaces: number;
}

export interface SourceReference {
  file: TFile;
  lineNumber: number;
  rawLine: string;
  rawEntry: string;
  sectionHeading?: string;
}

export interface AmountValue {
  value: number;
  unit: UnitKey;
  originalUnit: string;
}

export interface LinkedFoodEntry {
  kind: "linked";
  displayName: string;
  linkTarget: string;
  amount: AmountValue;
  price: number | null;
  source: SourceReference;
}

export interface InlineFoodEntry {
  kind: "inline";
  displayName: string;
  amount: AmountValue;
  price: number | null;
  metrics: NutritionMetrics;
  source: SourceReference;
}

export type ParsedFoodEntry = LinkedFoodEntry | InlineFoodEntry;

export interface FoodEntry {
  kind: "linked" | "inline";
  name: string;
  amount: number;
  unit: UnitKey;
  price?: number | null;
  sourcePath: string;
  lineNumber: number;
}

export type StructuredErrorCode =
  | "daily_note_not_found"
  | "nutrition_section_not_found"
  | "missing_amount"
  | "unknown_unit"
  | "incomplete_nutrition_line"
  | "missing_nutrient_note"
  | "ambiguous_nutrient_note"
  | "invalid_nutrient_field"
  | "invalid_serving_size"
  | "inline_pc_requires_serving_size";

export interface StructuredError {
  category: ErrorCategory;
  code: StructuredErrorCode;
  productName: string;
  reason: string;
  sourcePath: string;
  lineNumber: number;
  rawEntry: string;
}

export interface ParseSuccess {
  ok: true;
  entry: ParsedFoodEntry;
}

export interface ParseFailure {
  ok: false;
  error: StructuredError;
}

export type ParseResult = ParseSuccess | ParseFailure;

export interface NutrientNote extends NutritionMetrics {
  file: TFile;
  name: string;
  servingSize: number | null;
}

export interface ExportLine {
  productName: string;
  amount: AmountValue;
  price: number | null;
  metrics: NutritionMetrics;
  source: SourceReference;
  sectionHeading?: string;
  text: string;
}

export interface ExportReport {
  note: TFile;
  selectedDate: string | null;
  entriesFound: number;
  successCount: number;
  errorCount: number;
  exportedLines: ExportLine[];
  errors: StructuredError[];
  clipboardText: string;
  previewText: string;
  infoMessage: string | null;
}
