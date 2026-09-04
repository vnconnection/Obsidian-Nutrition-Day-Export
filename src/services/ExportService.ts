import type { App } from "obsidian";
import {
  DEFAULT_NUTRITION_HEADING,
  DEFAULT_NUTRIENTS_FOLDER,
  NUTRITION_METRIC_KEYS,
  OUTPUT_UNIT_LABELS,
} from "../constants";
import { createStructuredError } from "../errors/errorFactories";
import type {
  ExportLine,
  ExportMode,
  ExportReport,
  FoodSourceOption,
  FoodSourceSelection,
  NutritionDayExportSettings,
  ParseResult,
  StructuredError,
} from "../types";
import { formatAmount, formatNumber } from "../utils/numberUtils";
import { DailyNoteService } from "./DailyNoteService";
import {
  ConsumedExportStrategy,
  type ExportModeStrategy,
  Per100gExportStrategy,
} from "./ExportModeStrategy";
import { FoodParserService } from "./FoodParserService";
import { NutrientCatalogService } from "./NutrientCatalogService";

export class ExportService {
  private readonly app: App;
  private readonly dailyNoteService: DailyNoteService;
  private readonly foodParserService: FoodParserService;
  private readonly nutrientCatalogService: NutrientCatalogService;
  private readonly exportModeStrategies: Record<ExportMode, ExportModeStrategy>;

  public constructor(app: App) {
    this.app = app;
    this.dailyNoteService = new DailyNoteService(app);
    this.foodParserService = new FoodParserService();
    this.nutrientCatalogService = new NutrientCatalogService(app);
    this.exportModeStrategies = {
      consumed: new ConsumedExportStrategy(),
      per100g: new Per100gExportStrategy(),
    };
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
    exportMode: ExportMode = "consumed",
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

      const exportLine = await this.resolveExportLine(
        entryResult,
        settings,
        exportMode,
      );
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
    exportMode: ExportMode,
  ): Promise<{ line: ExportLine | null; error: StructuredError | null }> {
    const strategy = this.exportModeStrategies[exportMode];

    if (entryResult.entry.kind === "inline") {
      const strategyResult = strategy.resolveInline(entryResult.entry);
      if (strategyResult.error) {
        return {
          line: null,
          error: strategyResult.error,
        };
      }

      return {
        line: this.createExportLine(
          entryResult.entry.displayName,
          strategyResult.values.amount,
          entryResult.entry.price,
          strategyResult.values.metrics,
          entryResult.entry.source,
          settings,
          exportMode,
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

    const strategyResult = strategy.resolveLinked(
      entryResult.entry,
      nutrientResolution.nutrient,
    );

    if (strategyResult.error) {
      return {
        line: null,
        error: strategyResult.error,
      };
    }

    return {
      line: this.createExportLine(
        entryResult.entry.displayName,
        strategyResult.values.amount,
        entryResult.entry.price,
        strategyResult.values.metrics,
        entryResult.entry.source,
        settings,
        exportMode,
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
    exportMode: ExportMode,
  ): ExportLine {
    const unitLabel =
      OUTPUT_UNIT_LABELS[settings.outputUnitFormat][amount.unit];
    const formattedAmount = `${formatAmount(amount.value, settings.decimalPlaces)}${unitLabel}`;
    const formattedPrice =
      price === null ? "" : ` ${formatNumber(price, 2)}€`;
    const metricSegments = NUTRITION_METRIC_KEYS.map((metricKey) => {
      return `${formatNumber(metrics[metricKey], settings.decimalPlaces)}${metricKey}`;
    });
    const text =
      exportMode === "per100g"
        ? `#food ${productName} ${metricSegments.join(" ")} ${formattedAmount}${formattedPrice}`
        : `#food ${productName} ${formattedAmount}${formattedPrice} ${metricSegments.join(" ")}`;

    return {
      productName,
      amount,
      metrics,
      price,
      source,
      ...(source.sectionHeading
        ? { sectionHeading: source.sectionHeading }
        : {}),
      text,
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
