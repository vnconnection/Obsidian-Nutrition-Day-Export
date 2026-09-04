import { NUTRITION_METRIC_KEYS, UNIT_ALIASES } from "../constants";
import { createStructuredError } from "../errors/errorFactories";
import type { TFile } from "obsidian";
import type {
  AmountValue,
  InlineFoodEntry,
  NutritionMetrics,
  ParseResult,
  SourceReference,
  StructuredError,
  FoodSourceOption,
  FoodSourceSelection,
} from "../types";
import { parseWikilink } from "../utils/markdownUtils";

const HEADING_PATTERN = /^(#{1,6})\s+(.*)$/;
const FOOD_MARKER_PATTERN = /#food\b/gi;
const AMOUNT_TOKEN_PATTERN = /^((?:\d+(?:[.,]\d+)?|\.\d+))(g|ml|pc|г|мл|шт)$/i;
const PRICE_TOKEN_PATTERN = /^((?:\d+(?:[.,]\d+)?|\.\d+))€$/i;
const NUTRIENT_TOKEN_PATTERN =
  /^((?:\d+(?:[.,]\d+)?|\.\d+))(kcal|prot|fat|satfat|carbs|sugar|fiber|sodium)$/i;

type AmountParseResult =
  { ok: true; amount: AmountValue } | { ok: false; error: StructuredError };

type MetricsParseResult =
  | { ok: true; metrics: NutritionMetrics }
  | { ok: false; error: StructuredError };

export class FoodParserService {
  public getFoodSourceOptions(
    markdown: string,
    nutritionHeading: string,
  ): FoodSourceOption[] {
    const options: FoodSourceOption[] = [
      {
        id: "document",
        label: "Whole document",
        selection: { kind: "document" },
      },
      {
        id: "nutrition",
        label: `Nutrition section (${nutritionHeading.trim()})`,
        selection: { kind: "nutrition" },
      },
    ];
    const nutritionSection = this.findHeadingRange(markdown, nutritionHeading);

    if (!nutritionSection) {
      return options;
    }

    const lines = markdown.split(/\r?\n/);
    let insideFence = false;
    for (
      let lineIndex = nutritionSection.startLine + 1;
      lineIndex < nutritionSection.endLine;
      lineIndex += 1
    ) {
      const sourceLine = lines[lineIndex] ?? "";
      const trimmedLine = sourceLine.trim();
      if (trimmedLine.startsWith("```") || trimmedLine.startsWith("~~~")) {
        insideFence = !insideFence;
        continue;
      }
      if (insideFence) {
        continue;
      }

      const headingMatch = trimmedLine.match(HEADING_PATTERN);
      if (!headingMatch?.[1] || !headingMatch[2]) {
        continue;
      }
      const headingText = `${headingMatch[1]} ${headingMatch[2].trim()}`;
      options.push({
        id: `heading-${lineIndex + 1}`,
        label: `Subsection: ${headingText}`,
        selection: {
          kind: "heading",
          headingText,
          lineNumber: lineIndex + 1,
        },
      });
    }

    return options;
  }

  public parseNutritionSection(
    dailyFile: TFile,
    markdown: string,
    headingText: string,
  ): { results: ParseResult[]; sectionFound: boolean } {
    return this.parseEntriesInRange(
      dailyFile,
      markdown,
      headingText,
      null,
      true,
    );
  }

  public parseFoodEntries(
    dailyFile: TFile,
    markdown: string,
    selection: FoodSourceSelection,
    nutritionHeading: string,
  ): { results: ParseResult[]; sectionFound: boolean } {
    const targetHeading =
      selection.kind === "document"
        ? null
        : selection.kind === "nutrition"
          ? nutritionHeading
          : selection.headingText;
    const targetLineNumber =
      selection.kind === "heading" ? selection.lineNumber : null;
    return this.parseEntriesInRange(
      dailyFile,
      markdown,
      targetHeading,
      targetLineNumber,
      selection.kind === "nutrition",
    );
  }

  private parseEntriesInRange(
    dailyFile: TFile,
    markdown: string,
    headingText: string | null,
    headingLineNumber: number | null = null,
    allowMixedHeadingLevels = false,
  ): { results: ParseResult[]; sectionFound: boolean } {
    const lines = markdown.split(/\r?\n/);
    const targetHeading = headingText ? this.parseHeading(headingText) : null;
    const targetRange =
      targetHeading && allowMixedHeadingLevels
        ? this.findHeadingRange(markdown, headingText as string)
        : null;

    let insideTargetSection = targetHeading === null;
    let sectionFound = targetHeading === null;
    let insideFence = false;
    let currentSectionHeading: string | null = null;
    const results: ParseResult[] = [];

    for (const [lineIndex, sourceLine] of lines.entries()) {
      if (targetRange && lineIndex >= targetRange.endLine) {
        break;
      }
      const trimmedLine = sourceLine.trim();

      if (trimmedLine.startsWith("```") || trimmedLine.startsWith("~~~")) {
        insideFence = !insideFence;
        continue;
      }

      const currentHeadingMatch = trimmedLine.match(HEADING_PATTERN);
      if (currentHeadingMatch && !insideFence) {
        const currentHeadingHashes = currentHeadingMatch[1];
        const currentHeadingLabel = currentHeadingMatch[2];
        if (!currentHeadingHashes || !currentHeadingLabel) {
          continue;
        }

        const currentHeadingLevel = currentHeadingHashes.length;
        const currentHeadingText = currentHeadingLabel.trim();

        if (!insideTargetSection && targetHeading) {
          if (
            currentHeadingLevel === targetHeading.level &&
            currentHeadingText === targetHeading.text &&
            (!headingLineNumber || lineIndex + 1 === headingLineNumber)
          ) {
            insideTargetSection = true;
            sectionFound = true;
            currentSectionHeading = allowMixedHeadingLevels
              ? null
              : currentHeadingText;
          }
          continue;
        }

        if (
          targetHeading &&
          !allowMixedHeadingLevels &&
          currentHeadingLevel <= targetHeading.level
        ) {
          break;
        }

        currentSectionHeading = currentHeadingText;
      }

      if (!insideTargetSection || insideFence) {
        continue;
      }

      const markerMatches = Array.from(
        sourceLine.matchAll(FOOD_MARKER_PATTERN),
      );
      if (markerMatches.length === 0) {
        continue;
      }

      for (const [markerIndex, markerMatch] of markerMatches.entries()) {
        const startIndex = markerMatch.index ?? 0;
        const nextMatch = markerMatches[markerIndex + 1];
        const endIndex = nextMatch?.index ?? sourceLine.length;
        const rawEntry = sourceLine.slice(startIndex, endIndex).trim();
        const source: SourceReference = {
          file: dailyFile,
          lineNumber: lineIndex + 1,
          rawLine: sourceLine,
          rawEntry,
          ...(currentSectionHeading
            ? { sectionHeading: currentSectionHeading }
            : {}),
        };
        results.push(this.parseRawEntry(source));
      }
    }

    return { results, sectionFound };
  }

  private findHeadingRange(
    markdown: string,
    headingText: string,
  ): { startLine: number; endLine: number; level: number } | null {
    const targetHeading = this.parseHeading(headingText);
    if (!targetHeading) {
      return null;
    }

    const lines = markdown.split(/\r?\n/);
    let insideFence = false;
    for (const [lineIndex, sourceLine] of lines.entries()) {
      const trimmedLine = sourceLine.trim();
      if (trimmedLine.startsWith("```") || trimmedLine.startsWith("~~~")) {
        insideFence = !insideFence;
        continue;
      }
      if (insideFence) {
        continue;
      }

      const headingMatch = trimmedLine.match(HEADING_PATTERN);
      if (!headingMatch?.[1] || !headingMatch[2]) {
        continue;
      }
      if (
        headingMatch[1].length === targetHeading.level &&
        headingMatch[2].trim() === targetHeading.text
      ) {
        const endLine = this.findSectionEndLine(
          lines,
          lineIndex,
          targetHeading.level,
        );
        return { startLine: lineIndex, endLine, level: targetHeading.level };
      }
    }

    return null;
  }

  private findSectionEndLine(
    lines: string[],
    startLine: number,
    targetLevel: number,
  ): number {
    let insideFence = false;
    let mixedHeadingLevel: number | null = null;

    for (
      let lineIndex = startLine + 1;
      lineIndex < lines.length;
      lineIndex += 1
    ) {
      const trimmedLine = lines[lineIndex]?.trim() ?? "";
      if (trimmedLine.startsWith("```") || trimmedLine.startsWith("~~~")) {
        insideFence = !insideFence;
        continue;
      }
      if (insideFence) {
        continue;
      }

      const headingMatch = trimmedLine.match(HEADING_PATTERN);
      if (!headingMatch?.[1] || !headingMatch[2]) {
        continue;
      }

      const headingLevel = headingMatch[1].length;
      if (headingLevel > targetLevel) {
        continue;
      }

      if (mixedHeadingLevel !== null && headingLevel > mixedHeadingLevel) {
        continue;
      }

      if (
        headingLevel < targetLevel &&
        this.headingContainsFood(lines, lineIndex, headingLevel)
      ) {
        mixedHeadingLevel = headingLevel;
        continue;
      }

      if (
        headingLevel === targetLevel &&
        mixedHeadingLevel !== null &&
        this.headingContainsFood(lines, lineIndex, headingLevel)
      ) {
        continue;
      }

      return lineIndex;
    }

    return lines.length;
  }

  private headingContainsFood(
    lines: string[],
    startLine: number,
    headingLevel: number,
  ): boolean {
    let insideFence = false;
    for (
      let lineIndex = startLine + 1;
      lineIndex < lines.length;
      lineIndex += 1
    ) {
      const sourceLine = lines[lineIndex] ?? "";
      const trimmedLine = sourceLine.trim();
      if (trimmedLine.startsWith("```") || trimmedLine.startsWith("~~~")) {
        insideFence = !insideFence;
        continue;
      }
      if (insideFence) {
        continue;
      }

      const headingMatch = trimmedLine.match(HEADING_PATTERN);
      if (headingMatch?.[1] && headingMatch[1].length <= headingLevel) {
        return false;
      }
      if (FOOD_MARKER_PATTERN.test(sourceLine)) {
        FOOD_MARKER_PATTERN.lastIndex = 0;
        return true;
      }
      FOOD_MARKER_PATTERN.lastIndex = 0;
    }

    return false;
  }

  private parseHeading(
    headingText: string,
  ): { level: number; text: string } | null {
    const normalizedHeading = headingText.trim();
    const headingMatch = normalizedHeading.match(HEADING_PATTERN);
    if (headingMatch?.[1] && headingMatch[2]) {
      return { level: headingMatch[1].length, text: headingMatch[2].trim() };
    }

    const plainText = normalizedHeading.replace(/^#+\s*/, "").trim();
    return plainText ? { level: 2, text: plainText } : null;
  }

  private parseRawEntry(source: SourceReference): ParseResult {
    const body = source.rawEntry.replace(/^#food\b/i, "").trim();
    if (!body) {
      return {
        ok: false,
        error: this.createError(
          "Food entry",
          "missing_amount",
          "Missing product body.",
          source,
        ),
      };
    }

    if (body.startsWith("[[")) {
      return this.parseLinkedEntry(body, source);
    }

    return this.parseInlineEntry(body, source);
  }

  private parseLinkedEntry(body: string, source: SourceReference): ParseResult {
    const wikilinkMatch = body.match(/^(\[\[[\s\S]+?\]\])\s*(.*)$/);
    if (!wikilinkMatch) {
      return {
        ok: false,
        error: this.createError(
          "Linked food",
          "missing_amount",
          "Could not parse the linked food entry.",
          source,
        ),
      };
    }

    const rawWikilink = wikilinkMatch[1];
    const trailingBody = wikilinkMatch[2] ?? "";
    if (!rawWikilink) {
      return {
        ok: false,
        error: this.createError(
          "Linked food",
          "missing_amount",
          "Could not parse the linked food entry.",
          source,
        ),
      };
    }

    const wikilink = parseWikilink(rawWikilink);
    if (!wikilink) {
      return {
        ok: false,
        error: this.createError(
          "Linked food",
          "missing_amount",
          "Could not parse the wikilink.",
          source,
        ),
      };
    }

    const amountToken = trailingBody.trim().split(/\s+/)[0] ?? "";
    const amount = this.parseAmountToken(
      amountToken,
      wikilink.displayName,
      source,
    );
    if (!amount.ok) {
      return amount;
    }

    return {
      ok: true,
      entry: {
        kind: "linked",
        displayName: wikilink.displayName,
        linkTarget: wikilink.linkTarget,
        amount: amount.amount,
        price: this.parsePriceToken(trailingBody.trim().split(/\s+/)[1]),
        source,
      },
    };
  }

  private parseInlineEntry(body: string, source: SourceReference): ParseResult {
    const tokens = body.split(/\s+/).filter(Boolean);
    const amountTokenIndex = tokens.findIndex((token) =>
      AMOUNT_TOKEN_PATTERN.test(token),
    );
    const productName =
      amountTokenIndex > 0 ? tokens.slice(0, amountTokenIndex).join(" ") : body;

    if (amountTokenIndex < 1) {
      const unknownUnitToken = tokens.find((token) =>
        /^((?:\d+(?:[.,]\d+)?|\.\d+))[^\s\d]+$/i.test(token),
      );
      if (unknownUnitToken) {
        return {
          ok: false,
          error: this.createError(
            productName || "Inline food",
            "unknown_unit",
            `Unknown unit in token "${unknownUnitToken}".`,
            source,
          ),
        };
      }

      return {
        ok: false,
        error: this.createError(
          productName || "Inline food",
          "missing_amount",
          "Missing amount token.",
          source,
        ),
      };
    }

    const amountToken = tokens[amountTokenIndex];
    if (!amountToken) {
      return {
        ok: false,
        error: this.createError(
          productName || "Inline food",
          "missing_amount",
          "Missing amount token.",
          source,
        ),
      };
    }

    const amountResult = this.parseAmountToken(
      amountToken,
      productName,
      source,
    );
    if (!amountResult.ok) {
      return amountResult;
    }

    const trailingTokens = tokens.slice(amountTokenIndex + 1);
    const price = this.parsePriceToken(trailingTokens[0]);
    const nutrientTokens = this.removeTrailingDuplicateCalories(
      price === null ? trailingTokens : trailingTokens.slice(1),
    );
    while (
      nutrientTokens.at(-1)?.toLowerCase() === "and" ||
      nutrientTokens.at(-1)?.toLowerCase() === "и"
    ) {
      nutrientTokens.pop();
    }
    const metricsResult = this.parseInlineMetrics(
      productName,
      nutrientTokens,
      source,
    );
    if (!metricsResult.ok) {
      return metricsResult;
    }

    const entry: InlineFoodEntry = {
      kind: "inline",
      displayName: productName,
      amount: amountResult.amount,
      price,
      metrics: metricsResult.metrics,
      source,
    };

    return {
      ok: true,
      entry,
    };
  }

  private parseAmountToken(
    rawToken: string,
    productName: string,
    source: SourceReference,
  ): AmountParseResult {
    const amountMatch = rawToken.match(AMOUNT_TOKEN_PATTERN);
    if (!amountMatch) {
      const unknownUnitMatch = rawToken.match(
        /^((?:\d+(?:[.,]\d+)?|\.\d+))([^\d\s]+)$/,
      );
      if (unknownUnitMatch?.[2]) {
        return {
          ok: false,
          error: this.createError(
            productName,
            "unknown_unit",
            `Unknown unit "${unknownUnitMatch[2]}".`,
            source,
          ),
        };
      }
      return {
        ok: false,
        error: this.createError(
          productName,
          "missing_amount",
          "Missing amount token.",
          source,
        ),
      };
    }

    const rawAmount = amountMatch[1];
    const rawUnit = amountMatch[2];
    if (!rawAmount || !rawUnit) {
      return {
        ok: false,
        error: this.createError(
          productName,
          "missing_amount",
          "Missing amount token.",
          source,
        ),
      };
    }

    const amountValue = Number.parseFloat(rawAmount.replace(",", "."));
    const normalizedUnit = UNIT_ALIASES[rawUnit.toLowerCase()];
    if (!normalizedUnit) {
      return {
        ok: false,
        error: this.createError(
          productName,
          "unknown_unit",
          `Unknown unit "${rawUnit}".`,
          source,
        ),
      };
    }

    return {
      ok: true,
      amount: {
        value: amountValue,
        unit: normalizedUnit,
        originalUnit: rawUnit,
      },
    };
  }

  private parsePriceToken(rawToken: string | undefined): number | null {
    if (!rawToken) {
      return null;
    }

    const priceMatch = rawToken.match(PRICE_TOKEN_PATTERN);
    if (!priceMatch?.[1]) {
      return null;
    }

    return Number.parseFloat(priceMatch[1].replace(",", "."));
  }

  private removeTrailingDuplicateCalories(nutrientTokens: string[]): string[] {
    if (nutrientTokens.length !== NUTRITION_METRIC_KEYS.length + 1) {
      return nutrientTokens;
    }

    const trailingToken = nutrientTokens.at(-1);
    const trailingMatch = trailingToken?.match(NUTRIENT_TOKEN_PATTERN);
    const hasEarlierCalories = nutrientTokens
      .slice(0, -1)
      .some((token) => token.match(NUTRIENT_TOKEN_PATTERN)?.[2]?.toLowerCase() === "kcal");

    if (trailingMatch?.[2]?.toLowerCase() === "kcal" && hasEarlierCalories) {
      return nutrientTokens.slice(0, -1);
    }

    return nutrientTokens;
  }

  private parseInlineMetrics(
    productName: string,
    nutrientTokens: string[],
    source: SourceReference,
  ): MetricsParseResult {
    if (nutrientTokens.length !== NUTRITION_METRIC_KEYS.length) {
      return {
        ok: false,
        error: this.createError(
          productName,
          "incomplete_nutrition_line",
          "Inline food must contain all nutrition fields exactly once.",
          source,
        ),
      };
    }

    const metricValues = {} as NutritionMetrics;
    const seenKeys = new Set<string>();

    for (const nutrientToken of nutrientTokens) {
      const nutrientMatch = nutrientToken.match(NUTRIENT_TOKEN_PATTERN);
      if (!nutrientMatch) {
        return {
          ok: false,
          error: this.createError(
            productName,
            "incomplete_nutrition_line",
            `Invalid nutrient token "${nutrientToken}".`,
            source,
          ),
        };
      }

      const rawMetricValue = nutrientMatch[1];
      const rawMetricKey = nutrientMatch[2];
      if (!rawMetricValue || !rawMetricKey) {
        return {
          ok: false,
          error: this.createError(
            productName,
            "incomplete_nutrition_line",
            `Invalid nutrient token "${nutrientToken}".`,
            source,
          ),
        };
      }

      const metricKey = rawMetricKey.toLowerCase();
      if (seenKeys.has(metricKey)) {
        return {
          ok: false,
          error: this.createError(
            productName,
            "incomplete_nutrition_line",
            `Duplicate nutrient field "${metricKey}".`,
            source,
          ),
        };
      }

      metricValues[metricKey as keyof NutritionMetrics] = Number.parseFloat(
        rawMetricValue.replace(",", "."),
      );
      seenKeys.add(metricKey);
    }

    for (const metricKey of NUTRITION_METRIC_KEYS) {
      if (!seenKeys.has(metricKey)) {
        return {
          ok: false,
          error: this.createError(
            productName,
            "incomplete_nutrition_line",
            `Missing nutrient field "${metricKey}".`,
            source,
          ),
        };
      }
    }

    return {
      ok: true,
      metrics: metricValues,
    };
  }

  private createError(
    productName: string,
    code: StructuredError["code"],
    reason: string,
    source: SourceReference,
  ): StructuredError {
    return createStructuredError(code, {
      productName,
      sourcePath: source.file.path,
      lineNumber: source.lineNumber,
      rawEntry: source.rawEntry,
    }, { reason });
  }
}
