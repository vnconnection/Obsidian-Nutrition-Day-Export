import { App, MetadataCache, TFile, Vault } from "obsidian";
import { describe, expect, it } from "vitest";
import { NutrientCatalogService } from "./NutrientCatalogService";

class MockVault extends Vault {
  private readonly files: TFile[];
  private readonly contents: Record<string, string>;

  public constructor(files: TFile[], contents: Record<string, string>) {
    super();
    this.files = files;
    this.contents = contents;
  }

  public override getMarkdownFiles(): TFile[] {
    return this.files;
  }

  public override async cachedRead(file: TFile): Promise<string> {
    return this.contents[file.path] ?? "";
  }
}

class MockMetadataCache extends MetadataCache {
  public override getFirstLinkpathDest(
    linkTarget: string,
    _sourcePath: string,
  ): TFile | null {
    if (linkTarget === "Direct Match") {
      return new TFile("_nutrients/Direct Match.md");
    }
    return null;
  }
}

describe("NutrientCatalogService", () => {
  it("resolves a nutrient note by normalized basename and defaults empty sodium to zero", async () => {
    const app = new App();
    const dailyFile = new TFile("Diary/2026.07.18.md");
    const targetFile = new TFile("_nutrients/Závin Makový (Kukkonia).md");
    app.vault = new MockVault([targetFile], {
      [targetFile.path]: `---
name: Makový závin
calories: 475
saturated_fats: 0
carbs: 61
sugar: 24
fiber: 0
sodium:
serving_size: 100
---`,
    });

    const service = new NutrientCatalogService(app);
    const result = await service.resolveLinkedNutrient(
      "Závin Makový (Kukkonia)",
      "Makový závin",
      dailyFile,
      44,
      "_nutrients",
    );

    expect(result.error).toBeNull();
    expect(result.nutrient).toMatchObject({
      name: "Makový závin",
      prot: 0,
      fat: 0,
      fiber: 0,
      sodium: 0,
    });
  });

  it("resolves a direct metadataCache match", async () => {
    const app = new App();
    const dailyFile = new TFile("Diary/2026.07.18.md");
    const targetFile = new TFile("_nutrients/Direct Match.md");
    app.metadataCache = new MockMetadataCache();
    app.vault = new MockVault([targetFile], {
      [targetFile.path]: `---
name: Direct Match
calories: 100
protein: 10
fats: 5
saturated_fats: 1
carbs: 20
sugar: 3
fiber: 2
sodium: 15
serving_size: 50
---`,
    });

    const service = new NutrientCatalogService(app);
    const result = await service.resolveLinkedNutrient(
      "Direct Match",
      "Direct Match",
      dailyFile,
      10,
      "_nutrients",
    );

    expect(result.error).toBeNull();
    expect(result.nutrient).toMatchObject({
      name: "Direct Match",
      servingSize: 50,
      kcal: 100,
      prot: 10,
    });
  });

  it("returns categorized errors when a nutrient note is missing", async () => {
    const app = new App();
    const dailyFile = new TFile("Diary/2026.07.18.md");
    app.vault = new MockVault([], {});

    const result = await new NutrientCatalogService(app).resolveLinkedNutrient(
      "Missing Product",
      "Missing Product",
      dailyFile,
      8,
      "_nutrients",
    );

    expect(result).toEqual({
      nutrient: null,
      error: {
        category: "nutrient",
        code: "missing_nutrient_note",
        productName: "Missing Product",
        reason: 'Nutrient note for "Missing Product" was not found.',
        sourcePath: "Diary/2026.07.18.md",
        lineNumber: 8,
        rawEntry: "Missing Product",
      },
    });
  });
});
