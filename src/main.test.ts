import { App } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import NutritionDayExportPlugin from "./main";

describe("NutritionDayExportPlugin", () => {
  it("loads settings and registers command and settings tab on load", async () => {
    const plugin = new NutritionDayExportPlugin();
    plugin.app = new App();
    plugin.loadData = vi.fn().mockResolvedValue({
      nutrientsFolder: "_custom_nutrients",
    });
    plugin.addRibbonIcon = vi.fn();
    plugin.addCommand = vi.fn();
    plugin.addSettingTab = vi.fn();

    await plugin.onload();

    expect(plugin.settings.nutrientsFolder).toBe("_custom_nutrients");
    expect(plugin.addRibbonIcon).toHaveBeenCalledOnce();
    expect(plugin.addCommand).toHaveBeenCalledOnce();
    expect(plugin.addCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "open-nutrition-day-export",
        name: "Open Modal",
      }),
    );
    expect(plugin.addSettingTab).toHaveBeenCalledOnce();
  });
});
