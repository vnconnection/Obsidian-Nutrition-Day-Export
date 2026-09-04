import type { App } from "obsidian";
import {
  DEFAULT_NUTRITION_HEADING,
  DEFAULT_NUTRIENTS_FOLDER,
  OUTPUT_UNIT_LABELS,
} from "../constants";
import { createStructuredError } from "../errors/errorFactories";
import type {
  ExportLine,
  ExportReport,
  FoodSourceOption,
  FoodSourceSelection,
  NutritionDayExportSettings,
  ParseResult,
  StructuredError,
} from "../types";
import { formatAmount, formatNumber } from "../utils/numberUtils";
import { DailyNoteService } from "./DailyNoteService";
import { FoodParserService } from "./FoodParserService";
import { NutrientCatalogService } from "./NutrientCatalogService";
import { NutritionCalculatorService } from "./NutritionCalculatorService";

export class ExportService {
  private readonly app: App;
  private readonly dailyNoteService: DailyNoteService;
  private readonly foodParserService: FoodParserService;
  private readonly nutrientCatalogService: NutrientCatalogService;
  private readonly nutritionCalculatorService: NutritionCalculatorService;

  public constructor(app: App) {
    this.app = app;
    this.dailyNoteService = new DailyNoteService(app);
    this.foodParserService = new FoodParserService();
    this.nutrientCatalogService = new NutrientCatalogService(app);
    this.nutritionCalculatorService = new NutritionCalculatorService();
  }

  public getInitialDate(): string {
    return this.dailyNoteService.getInitialDate();
  }

  public async getFoodSourceOptions(
    dateText: string,
    settings: NutritionDayExportSettings,
  ): Promise<
    | { options: FoodSourceOption[]; selectedDate: string | null }
    | StructuredError
  > {
    const dailyNoteLookup = this.dailyNoteService.resolveDailyNote(dateText);
    if (dailyNoteLookup.error || !dailyNoteLookup.file) {
      return dailyNoteLookup.error as StructuredError;
    }

    const markdown = await this.app.vault.cachedRead(dailyNoteLookup.file);
    return {
      options: this.foodParserService.getFoodSourceOptions(
        markdown,
        settings.nutritionHeading || DEFAULT_NUTRITION_HEADING,
      ),
      selectedDate: dailyNoteLookup.selectedDate,
    };
  }

  public async buildReport(
    dateText: string,
    settings: NutritionDayExportSettings,
    sourceSelection: FoodSourceSelection = { kind: "nutrition" },
  ): Promise<ExportReport | StructuredError> {
    const dailyNoteLookup = this.dailyNoteService.resolveDailyNote(dateText);
    if (dailyNoteLookup.error || !dailyNoteLookup.file) {
      return dailyNoteLookup.error as StructuredError;
    }

    const markdown = await this.app.vault.cachedRead(dailyNoteLookup.file);
    const nutritionHeading =
      settings.nutritionHeading || DEFAULT_NUTRITION_HEADING;
    const parseResult = this.foodParserService.parseFoodEntries(
      dailyNoteLookup.file,
      markdown,
      sourceSelection,
      nutritionHeading,
    );

    if (!parseResult.sectionFound) {
      const sourceHeading =
        sourceSelection.kind === "nutrition"
          ? nutritionHeading
          : sourceSelection.kind === "heading"
            ? sourceSelection.headingText
            : "the selected source";
      return createStructuredError(
        "nutrition_section_not_found",
        {
          productName: sourceHeading,
          sourcePath: dailyNoteLookup.file.path,
          lineNumber: 0,
          rawEntry: sourceHeading,
        },
        {
          sourceHeading,
        },
      );
    }

    const exportedLines: ExportLine[] = [];
    const errors: StructuredError[] = [];

    for (const entryResult of parseResult.results) {
      if (!entryResult.ok) {
        errors.push(entryResult.error);
        continue;
      }

      const exportLine = await this.resolveExportLine(entryResult, settings);
      if (exportLine.error) {
        errors.push(exportLine.error);
        continue;
      }

      exportedLines.push(exportLine.line as ExportLine);
    }

    const previewText = this.formatPreview(exportedLines);
    const infoMessage =
      sourceSelection.kind === "nutrition"
        ? "No #food entries were found in the configured Nutrition section."
        : "No #food entries were found in the selected source.";
    return {
      note: dailyNoteLookup.file,
      selectedDate: dailyNoteLookup.selectedDate,
      entriesFound: parseResult.results.length,
      successCount: exportedLines.length,
      errorCount: errors.length,
      exportedLines,
      errors,
      clipboardText: previewText,
      previewText,
      infoMessage: parseResult.results.length === 0 ? infoMessage : null,
    };
  }

  private async resolveExportLine(
    entryResult: Extract<ParseResult, { ok: true }>,
    settings: NutritionDayExportSettings,
  ): Promise<{ line: ExportLine | null; error: StructuredError | null }> {
    if (entryResult.entry.kind === "inline") {
      return {
        line: this.createExportLine(
          entryResult.entry.displayName,
          entryResult.entry.amount,
          entryResult.entry.price,
          entryResult.entry.metrics,
          entryResult.entry.source,
          settings,
        ),
        error: null,
      };
    }

    const nutrientResolution =
      await this.nutrientCatalogService.resolveLinkedNutrient(
        entryResult.entry.linkTarget,
        entryResult.entry.displayName,
        entryResult.entry.source.file,
        entryResult.entry.source.lineNumber,
        settings.nutrientsFolder || DEFAULT_NUTRIENTS_FOLDER,
      );

    if (nutrientResolution.error || !nutrientResolution.nutrient) {
      return {
        line: null,
        error: nutrientResolution.error as StructuredError,
      };
    }

    const calculation = this.nutritionCalculatorService.calculateFromNutrient(
      nutrientResolution.nutrient,
      entryResult.entry.amount.value,
      entryResult.entry.amount.unit,
      entryResult.entry.displayName,
      entryResult.entry.source.file.path,
      entryResult.entry.source.lineNumber,
      entryResult.entry.source.rawEntry,
    );

    if (calculation.error || !calculation.metrics) {
      return {
        line: null,
        error: calculation.error as StructuredError,
      };
    }

    return {
      line: this.createExportLine(
        entryResult.entry.displayName,
        entryResult.entry.amount,
        entryResult.entry.price,
        calculation.metrics,
        entryResult.entry.source,
        settings,
      ),
      error: null,
    };
  }

  private createExportLine(
    productName: string,
    amount: ExportLine["amount"],
    price: ExportLine["price"],
    metrics: ExportLine["metrics"],
    source: ExportLine["source"],
    settings: NutritionDayExportSettings,
  ): ExportLine {
    const unitLabel =
      OUTPUT_UNIT_LABELS[settings.outputUnitFormat][amount.unit];
    const formattedAmount = `${formatAmount(amount.value, settings.decimalPlaces)}${unitLabel}`;
    const formattedPrice =
      price === null ? "" : ` ${formatNumber(price, 2)}€`;
    const metricSegments = [
      `${formatNumber(metrics.kcal, settings.decimalPlaces)}kcal`,
      `${formatNumber(metrics.prot, settings.decimalPlaces)}prot`,
      `${formatNumber(metrics.fat, settings.decimalPlaces)}fat`,
      `${formatNumber(metrics.satfat, settings.decimalPlaces)}satfat`,
      `${formatNumber(metrics.carbs, settings.decimalPlaces)}carbs`,
      `${formatNumber(metrics.sugar, settings.decimalPlaces)}sugar`,
      `${formatNumber(metrics.fiber, settings.decimalPlaces)}fiber`,
      `${formatNumber(metrics.sodium, settings.decimalPlaces)}sodium`,
    ];

    return {
      productName,
      amount,
      metrics,
      price,
      source,
      ...(source.sectionHeading
        ? { sectionHeading: source.sectionHeading }
        : {}),
      text: `#food ${productName} ${formattedAmount}${formattedPrice} ${metricSegments.join(" ")}`,
    };
  }

  private formatPreview(exportedLines: ExportLine[]): string {
    const reportSegments: string[] = [];
    let previousHeading: string | undefined;

    for (const exportedLine of exportedLines) {
      const currentHeading = exportedLine.sectionHeading;
      if (currentHeading && currentHeading !== previousHeading) {
        reportSegments.push(`**${currentHeading}**`);
      }
      reportSegments.push(exportedLine.text);
      previousHeading = currentHeading;
    }

    return reportSegments.join("\n\n");
  }
}
