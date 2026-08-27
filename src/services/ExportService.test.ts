import { App, TFile } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import { ExportService } from "./ExportService";

describe("ExportService", () => {
  it("exports inline food as one #food line with its price", async () => {
    const app = new App();
    const dailyFile = new TFile("Diary/2026.08.27.md");
    app.workspace.getActiveFile = vi.fn().mockReturnValue(dailyFile);
    app.vault.cachedRead = vi.fn().mockResolvedValue(
      `## Nutrition
#food Baked cottage cheese with banana 217g 0.79€ 392.84kcal 53.06prot 10.10fat 2.98satfat 18.24carbs 2.74sugar 3.34fiber 192.18sodium 393kcal`,
    );

    const report = await new ExportService(app).buildReport("", {
      nutrientsFolder: "_nutrients",
      nutritionHeading: "## Nutrition",
      outputUnitFormat: "source",
      decimalPlaces: 2,
    });

    expect(report).not.toHaveProperty("code");
    expect((report as { clipboardText: string }).clipboardText).toBe(
      "#food Baked cottage cheese with banana 217g 0.79€ 392.84kcal 53.06prot 10.10fat 2.98satfat 18.24carbs 2.74sugar 3.34fiber 192.18sodium",
    );
  });
});
