import { Plugin } from "obsidian";
import {
  DEFAULT_DECIMAL_PLACES,
  DEFAULT_NUTRIENTS_FOLDER,
  DEFAULT_NUTRITION_HEADING,
  DEFAULT_OUTPUT_UNIT_FORMAT,
  PLUGIN_NAME,
} from "./constants";
import { ExportService } from "./services/ExportService";
import type { NutritionDayExportSettings } from "./types";
import { SettingsTab } from "./ui/SettingsTab";
import { NutritionExportModal } from "./ui/NutritionExportModal";

const DEFAULT_SETTINGS: NutritionDayExportSettings = {
  nutrientsFolder: DEFAULT_NUTRIENTS_FOLDER,
  nutritionHeading: DEFAULT_NUTRITION_HEADING,
  outputUnitFormat: DEFAULT_OUTPUT_UNIT_FORMAT,
  decimalPlaces: DEFAULT_DECIMAL_PLACES,
};

export default class NutritionDayExportPlugin extends Plugin {
  public settings: NutritionDayExportSettings = DEFAULT_SETTINGS;
  private exportService!: ExportService;

  public override async onload(): Promise<void> {
    await this.loadSettings();
    this.exportService = new ExportService(this.app);

    this.addRibbonIcon("clipboard-copy", PLUGIN_NAME, () => {
      this.openExportModal();
    });

    this.addCommand({
      id: "open-nutrition-day-export",
      name: "Open Modal",
      callback: () => {
        this.openExportModal();
      },
    });

    this.addSettingTab(new SettingsTab(this.app, this));
  }

  public async loadSettings(): Promise<void> {
    const storedSettings = await this.loadData();
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...storedSettings,
    };
  }

  public async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private openExportModal(): void {
    new NutritionExportModal(
      this.app,
      this.exportService,
      () => this.settings,
    ).open();
  }
}
