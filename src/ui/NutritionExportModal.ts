import { Modal, Notice, setIcon } from "obsidian";
import type { App } from "obsidian";
import type {
  ExportMode,
  ExportReport,
  FoodSourceOption,
  FoodSourceSelection,
  NutritionDayExportSettings,
  StructuredError,
} from "../types";
import { PLUGIN_NAME } from "../constants";
import type { ExportService } from "../services/ExportService";
import {
  fromDateInputValue,
  getTodayDailyNoteName,
  toDateInputValue,
} from "../utils/dateUtils";

export class NutritionExportModal extends Modal {
  private readonly exportService: ExportService;
  private readonly getSettings: () => NutritionDayExportSettings;
  private dateText: string;
  private sourceSelection: FoodSourceSelection = { kind: "nutrition" };
  private exportMode: ExportMode = "consumed";
  private report: ExportReport | null = null;
  private topError: StructuredError | null = null;
  private dateInputEl!: HTMLInputElement;
  private sourceSelectEl!: HTMLSelectElement;
  private statsEl!: HTMLDivElement;
  private statusEl!: HTMLDivElement;
  private previewEl!: HTMLTextAreaElement;
  private errorsEl!: HTMLDivElement;
  private copyButtonEl!: HTMLButtonElement;

  public constructor(
    app: App,
    exportService: ExportService,
    getSettings: () => NutritionDayExportSettings,
  ) {
    super(app);
    this.exportService = exportService;
    this.getSettings = getSettings;
    this.dateText = exportService.getInitialDate();
  }

  public override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("nutrition-day-export-modal");

    const titleRowEl = contentEl.createDiv({
      cls: "nutrition-day-export-title-row",
    });
    const titleIconEl = titleRowEl.createDiv({
      cls: "nutrition-day-export-title-icon",
    });
    setIcon(titleIconEl, "clipboard-copy");
    titleRowEl.createEl("h2", { text: PLUGIN_NAME });

    const controlsEl = contentEl.createDiv({
      cls: "nutrition-day-export-controls",
    });
    const dateFieldEl = controlsEl.createDiv({
      cls: "nutrition-day-export-field",
    });
    dateFieldEl.createEl("label", { text: "Date override" });
    this.dateInputEl = dateFieldEl.createEl("input", {
      attr: {
        type: "date",
        "aria-label": "Date override",
      },
    });
    this.dateInputEl.value = toDateInputValue(this.dateText);
    this.dateInputEl.addEventListener("input", (inputEvent) => {
      this.dateText = fromDateInputValue(
        (inputEvent.target as HTMLInputElement).value,
      );
    });
    this.dateInputEl.addEventListener("keydown", (keyboardEvent) => {
      if (keyboardEvent.key === "Enter") {
        void this.refresh();
      }
    });

    const sourceFieldEl = controlsEl.createDiv({
      cls: "nutrition-day-export-field",
    });
    sourceFieldEl.createEl("label", { text: "Food source" });
    this.sourceSelectEl = sourceFieldEl.createEl("select", {
      attr: { "aria-label": "Food source" },
    });
    this.sourceSelectEl.addEventListener("change", () => {
      const selectedOption = this.sourceOptions.find(
        (option) => option.id === this.sourceSelectEl.value,
      );
      if (selectedOption) {
        this.sourceSelection = selectedOption.selection;
        void this.refresh();
      }
    });

    const exportModeFieldEl = controlsEl.createDiv({
      cls: "nutrition-day-export-field",
    });
    const exportModeFieldsetEl = exportModeFieldEl.createEl("fieldset", {
      cls: "nutrition-day-export-radio-group",
      attr: {
        "aria-label": "Export basis",
      },
    });
    exportModeFieldsetEl.createEl("legend", { text: "Export basis" });
    this.createExportModeOption(
      exportModeFieldsetEl,
      "nutrition-day-export-mode-consumed",
      "Per consumed",
      "consumed",
    );
    this.createExportModeOption(
      exportModeFieldsetEl,
      "nutrition-day-export-mode-per100g",
      "Per 100g",
      "per100g",
    );

    const todayButtonEl = dateFieldEl.createEl("button", {
      text: "Today",
      attr: { type: "button" },
    });
    todayButtonEl.addEventListener("click", () => {
      this.dateText = getTodayDailyNoteName();
      this.dateInputEl.value = toDateInputValue(this.dateText);
      void this.refresh();
    });

    const buttonRowEl = controlsEl.createDiv({
      cls: "nutrition-day-export-button-row",
    });
    this.copyButtonEl = buttonRowEl.createEl("button", {
      cls: "mod-cta",
      text: "Copy",
    });
    this.copyButtonEl.addEventListener("click", () => {
      void this.copyPreview();
    });

    const refreshButtonEl = buttonRowEl.createEl("button", {
      text: "Refresh",
    });
    refreshButtonEl.addEventListener("click", () => {
      void this.refresh();
    });

    this.statsEl = contentEl.createDiv({ cls: "nutrition-day-export-stats" });
    this.statusEl = contentEl.createDiv({ cls: "nutrition-day-export-status" });
    this.previewEl = contentEl.createEl("textarea", {
      cls: "nutrition-day-export-preview",
      attr: { readonly: "true" },
    });
    this.previewEl.rows = 12;
    this.errorsEl = contentEl.createDiv({ cls: "nutrition-day-export-errors" });

    void this.refresh();
  }

  public override onClose(): void {
    this.contentEl.empty();
  }

  private async refresh(): Promise<void> {
    this.topError = null;
    this.report = null;
    this.render();

    const settings = this.getSettings();
    const sourceOptionsResult = await this.exportService.getFoodSourceOptions(
      this.dateText,
      settings,
    );
    if ("options" in sourceOptionsResult) {
      this.setSourceOptions(sourceOptionsResult.options);
    } else {
      this.topError = sourceOptionsResult;
      this.render();
      return;
    }

    const result = await this.exportService.buildReport(
      this.dateText,
      settings,
      this.sourceSelection,
      this.exportMode,
    );
    if ("note" in result) {
      this.report = result;
    } else {
      this.topError = result;
    }

    this.render();
  }

  private sourceOptions: FoodSourceOption[] = [];

  private setSourceOptions(options: FoodSourceOption[]): void {
    this.sourceOptions = options;
    const currentOption = options.find(
      (option) =>
        this.getSelectionId(option.selection) ===
        this.getSelectionId(this.sourceSelection),
    );
    if (currentOption) {
      this.sourceSelection = currentOption.selection;
    } else {
      this.sourceSelection = { kind: "nutrition" };
    }

    while (this.sourceSelectEl.firstChild) {
      this.sourceSelectEl.removeChild(this.sourceSelectEl.firstChild);
    }
    for (const option of options) {
      const optionEl = document.createElement("option");
      optionEl.value = option.id;
      optionEl.textContent = option.label;
      optionEl.selected =
        this.getSelectionId(option.selection) ===
        this.getSelectionId(this.sourceSelection);
      this.sourceSelectEl.appendChild(optionEl);
    }
  }

  private getSelectionId(selection: FoodSourceSelection): string {
    if (selection.kind === "document") {
      return "document";
    }
    if (selection.kind === "nutrition") {
      return "nutrition";
    }
    return `heading-${selection.lineNumber}`;
  }

  private createExportModeOption(
    containerEl: HTMLElement,
    inputId: string,
    labelText: string,
    exportMode: ExportMode,
  ): void {
    const optionRowEl = containerEl.createDiv({
      cls: "nutrition-day-export-radio-option",
    });
    const inputEl = optionRowEl.createEl("input", {
      attr: {
        id: inputId,
        type: "radio",
        name: "nutrition-day-export-mode",
      },
    });
    inputEl.checked = this.exportMode === exportMode;
    inputEl.addEventListener("change", () => {
      if (!inputEl.checked) {
        return;
      }

      this.exportMode = exportMode;
      void this.refresh();
    });
    optionRowEl.createEl("label", {
      text: labelText,
      attr: {
        for: inputId,
      },
    });
  }

  private render(): void {
    if (this.topError) {
      this.statsEl.setText(
        "Products found: 0 | Successfully exported: 0 | Errors: 1",
      );
      this.statusEl.setText(this.topError.reason);
      this.previewEl.value = "";
      this.copyButtonEl.disabled = true;
      this.renderErrors([this.topError]);
      return;
    }

    if (!this.report) {
      this.statsEl.setText("Loading...");
      this.statusEl.setText("");
      this.previewEl.value = "";
      this.copyButtonEl.disabled = true;
      this.renderErrors([]);
      return;
    }

    this.statsEl.setText(
      `Products found: ${this.report.entriesFound} | Successfully exported: ${this.report.successCount} | Errors: ${this.report.errorCount}`,
    );
    this.statusEl.setText(
      this.report.selectedDate
        ? `Selected date: ${this.report.selectedDate}`
        : `Active note: ${this.report.note.basename}`,
    );
    this.previewEl.value =
      this.report.previewText || this.report.infoMessage || "";
    this.copyButtonEl.disabled = this.report.successCount === 0;
    this.renderErrors(this.report.errors);
  }

  private renderErrors(errors: StructuredError[]): void {
    this.errorsEl.empty();
    if (errors.length === 0) {
      return;
    }

    this.errorsEl.createEl("h3", { text: "Errors" });
    for (const error of errors) {
      const errorCardEl = this.errorsEl.createDiv({
        cls: "nutrition-day-export-error-card",
      });
      errorCardEl.createDiv({
        cls: "nutrition-day-export-error-title",
        text: error.productName,
      });
      errorCardEl.createDiv({ text: error.reason });
      errorCardEl.createDiv({
        text: `Source: ${error.sourcePath}, line ${error.lineNumber}`,
      });
    }
  }

  private async copyPreview(): Promise<void> {
    if (!this.report || !this.report.clipboardText) {
      return;
    }

    const clipboard = window.navigator.clipboard;
    if (clipboard?.writeText) {
      await clipboard.writeText(this.report.clipboardText);
    } else {
      const textareaEl = document.createElement("textarea");
      textareaEl.value = this.report.clipboardText;
      document.body.appendChild(textareaEl);
      textareaEl.select();
      document.execCommand("copy");
      document.body.removeChild(textareaEl);
    }

    new Notice("Nutrition export copied.");
  }
}
