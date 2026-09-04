import type { App, TFile } from "obsidian";
import {
  DEFAULT_NUTRIENTS_FOLDER,
  REQUIRED_NUTRIENT_FIELDS,
} from "../constants";
import { createStructuredError } from "../errors/errorFactories";
import type { NutrientNote, StructuredError } from "../types";
import { normalizeLookupText, splitFrontmatter } from "../utils/markdownUtils";

interface NutrientIndexEntry {
  file: TFile;
  nutrient: NutrientNote | null;
  error: string | null;
}

export class NutrientCatalogService {
  private readonly app: App;

  public constructor(app: App) {
    this.app = app;
  }

  public async resolveLinkedNutrient(
    linkTarget: string,
    displayName: string,
    sourceFile: TFile,
    sourceLineNumber: number,
    nutrientsFolder: string,
  ): Promise<{ nutrient: NutrientNote | null; error: StructuredError | null }> {
    const nutrientIndex = await this.buildIndex(nutrientsFolder);
    const directMatch = this.app.metadataCache.getFirstLinkpathDest(
      linkTarget,
      sourceFile.path,
    );

    if (directMatch) {
      const directEntry = nutrientIndex.find(
        (indexEntry) => indexEntry.file.path === directMatch.path,
      );
      return this.toResolutionResult(
        directEntry,
        displayName,
        sourceFile.path,
        sourceLineNumber,
      );
    }

    const normalizedTarget = normalizeLookupText(linkTarget);
    const matchingEntries = nutrientIndex.filter(
      (indexEntry) =>
        normalizeLookupText(indexEntry.file.basename) === normalizedTarget,
    );

    if (matchingEntries.length === 0) {
      return {
        nutrient: null,
        error: createStructuredError(
          "missing_nutrient_note",
          {
            productName: displayName,
            sourcePath: sourceFile.path,
            lineNumber: sourceLineNumber,
            rawEntry: linkTarget,
          },
          {
            reason: `Nutrient note for "${linkTarget}" was not found.`,
          },
        ),
      };
    }

    if (matchingEntries.length > 1) {
      return {
        nutrient: null,
        error: createStructuredError(
          "ambiguous_nutrient_note",
          {
            productName: displayName,
            sourcePath: sourceFile.path,
            lineNumber: sourceLineNumber,
            rawEntry: linkTarget,
          },
          {
            reason: `Multiple nutrient notes match "${linkTarget}".`,
          },
        ),
      };
    }

    return this.toResolutionResult(
      matchingEntries[0],
      displayName,
      sourceFile.path,
      sourceLineNumber,
    );
  }

  private async buildIndex(
    nutrientsFolder: string,
  ): Promise<NutrientIndexEntry[]> {
    const normalizedFolder = normalizeFolderPath(nutrientsFolder);
    const nutrientFiles = this.app.vault
      .getMarkdownFiles()
      .filter((markdownFile) =>
        isInFolder(markdownFile.path, normalizedFolder),
      );

    return Promise.all(
      nutrientFiles.map(async (file) => {
        const fileCache = this.app.metadataCache.getFileCache(file);
        const frontmatterValues = fileCache?.frontmatter
          ? mapFrontmatterRecord(fileCache.frontmatter)
          : splitFrontmatter(await this.app.vault.cachedRead(file));

        if (!frontmatterValues) {
          return { file, nutrient: null, error: "Missing frontmatter." };
        }

        const nutrientParseResult = parseNutrientFrontmatter(
          file,
          frontmatterValues,
        );
        return {
          file,
          nutrient: nutrientParseResult.nutrient,
          error: nutrientParseResult.error,
        };
      }),
    );
  }

  private toResolutionResult(
    indexEntry: NutrientIndexEntry | undefined,
    displayName: string,
    sourcePath: string,
    lineNumber: number,
  ): { nutrient: NutrientNote | null; error: StructuredError | null } {
    if (!indexEntry) {
      return {
        nutrient: null,
        error: createStructuredError(
          "missing_nutrient_note",
          {
            productName: displayName,
            sourcePath,
            lineNumber,
            rawEntry: displayName,
          },
          {
            reason: `Nutrient note for "${displayName}" was not found.`,
          },
        ),
      };
    }

    if (indexEntry.error || !indexEntry.nutrient) {
      return {
        nutrient: null,
        error: createStructuredError(
          "invalid_nutrient_field",
          {
            productName: displayName,
            sourcePath,
            lineNumber,
            rawEntry: displayName,
          },
          {
            reason: indexEntry.error ?? "Invalid nutrient note.",
          },
        ),
      };
    }

    return {
      nutrient: indexEntry.nutrient,
      error: null,
    };
  }
}

function normalizeFolderPath(folderPath: string): string {
  const trimmedFolderPath = folderPath.trim().replace(/^\/+|\/+$/g, "");
  return trimmedFolderPath || DEFAULT_NUTRIENTS_FOLDER;
}

function isInFolder(filePath: string, folderPath: string): boolean {
  return filePath === folderPath || filePath.startsWith(`${folderPath}/`);
}

function mapFrontmatterRecord(
  frontmatter: Record<string, unknown>,
): Record<string, string> {
  const mappedEntries = Object.entries(frontmatter).map(([key, value]) => {
    if (typeof value === "string") {
      return [key, value];
    }
    if (typeof value === "number" || typeof value === "boolean") {
      return [key, String(value)];
    }
    if (value === null || value === undefined) {
      return [key, ""];
    }
    return [key, ""];
  });

  return Object.fromEntries(mappedEntries);
}

function parseNutrientFrontmatter(
  file: TFile,
  frontmatterValues: Record<string, string>,
): { nutrient: NutrientNote | null; error: string | null } {
  const name = frontmatterValues.name?.trim();
  if (!name) {
    return {
      nutrient: null,
      error: `Missing name in ${file.path}.`,
    };
  }

  const metricValues = {} as NutrientNote;
  for (const [frontmatterKey, metricKey] of Object.entries(
    REQUIRED_NUTRIENT_FIELDS,
  )) {
    const rawValue = frontmatterValues[frontmatterKey];
    if (!rawValue?.trim() && metricKey === "kcal") {
      return {
        nutrient: null,
        error: `Missing ${frontmatterKey} in ${file.path}.`,
      };
    }

    if (!rawValue?.trim()) {
      metricValues[metricKey] = 0;
      continue;
    }

    const parsedValue = parseStrictNumber(rawValue);
    if (parsedValue === null) {
      return {
        nutrient: null,
        error: `Invalid ${frontmatterKey} in ${file.path}.`,
      };
    }

    metricValues[metricKey] = parsedValue;
  }

  const servingSize = parseOptionalNumber(frontmatterValues.serving_size);
  if (
    frontmatterValues.serving_size !== undefined &&
    frontmatterValues.serving_size.trim() &&
    servingSize === null
  ) {
    return {
      nutrient: null,
      error: `Invalid serving_size in ${file.path}.`,
    };
  }

  return {
    nutrient: {
      file,
      name,
      servingSize,
      kcal: metricValues.kcal,
      prot: metricValues.prot,
      fat: metricValues.fat,
      satfat: metricValues.satfat,
      carbs: metricValues.carbs,
      sugar: metricValues.sugar,
      fiber: metricValues.fiber,
      sodium: metricValues.sodium,
    },
    error: null,
  };
}

function parseOptionalNumber(rawValue: string | undefined): number | null {
  if (!rawValue?.trim()) {
    return null;
  }

  return parseStrictNumber(rawValue);
}

function parseStrictNumber(rawValue: string): number | null {
  if (!/^[+-]?(?:\d+(?:[.,]\d+)?|\.\d+)$/.test(rawValue.trim())) {
    return null;
  }
  const parsedValue = Number(rawValue.replace(",", "."));
  return Number.isFinite(parsedValue) ? parsedValue : null;
}
