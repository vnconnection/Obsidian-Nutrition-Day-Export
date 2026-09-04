import { App, TFile } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import type {
  ExportReport,
  FoodSourceOption,
  NutritionDayExportSettings,
} from "../types";
import type { ExportService } from "../services/ExportService";
import { NutritionExportModal } from "./NutritionExportModal";

const settings: NutritionDayExportSettings = {
  nutrientsFolder: "_nutrients",
  nutritionHeading: "## Nutrition",
  outputUnitFormat: "source",
  decimalPlaces: 2,
};

describe("NutritionExportModal", () => {
  it("defaults each new modal to consumed and passes per100g after switching", async () => {
    const exportService = createExportServiceMock();

    const firstModal = new NutritionExportModal(new App(), exportService, () => {
      return settings;
    });
    firstModal.onOpen();
    await flushAsyncWork();

    const consumedRadio = getRadioByLabelText(
      firstModal.contentEl,
      "Per consumed",
    );
    const per100gRadio = getRadioByLabelText(firstModal.contentEl, "Per 100g");

    expect(consumedRadio.checked).toBe(true);
    expect(per100gRadio.checked).toBe(false);
    expect(exportService.buildReport).toHaveBeenLastCalledWith(
      "2026.09.04",
      settings,
      { kind: "nutrition" },
      "consumed",
    );

    per100gRadio.checked = true;
    per100gRadio.dispatchEvent(new Event("change"));
    await flushAsyncWork();

    expect(exportService.buildReport).toHaveBeenLastCalledWith(
      "2026.09.04",
      settings,
      { kind: "nutrition" },
      "per100g",
    );

    const secondModal = new NutritionExportModal(
      new App(),
      exportService,
      () => {
        return settings;
      },
    );
    secondModal.onOpen();
    await flushAsyncWork();

    expect(
      getRadioByLabelText(secondModal.contentEl, "Per consumed").checked,
    ).toBe(true);
    expect(
      getRadioByLabelText(secondModal.contentEl, "Per 100g").checked,
    ).toBe(false);
    expect(exportService.buildReport).toHaveBeenLastCalledWith(
      "2026.09.04",
      settings,
      { kind: "nutrition" },
      "consumed",
    );
  });
});

function createExportServiceMock(): ExportService {
  const report = createReport();
  const sourceOptions: FoodSourceOption[] = [
    {
      id: "nutrition",
      label: "Nutrition section",
      selection: { kind: "nutrition" },
    },
  ];

  const exportServiceMock: Pick<
    ExportService,
    "getInitialDate" | "getFoodSourceOptions" | "buildReport"
  > = {
    getInitialDate: vi.fn().mockReturnValue("2026.09.04"),
    getFoodSourceOptions: vi.fn().mockResolvedValue({
      options: sourceOptions,
      selectedDate: null,
    }),
    buildReport: vi.fn().mockResolvedValue(report),
  };

  return exportServiceMock as ExportService;
}

function createReport(): ExportReport {
  return {
    note: new TFile("Diary/2026.09.04.md"),
    selectedDate: null,
    entriesFound: 1,
    successCount: 1,
    errorCount: 0,
    exportedLines: [],
    errors: [],
    clipboardText: "#food Product 10g 20.00kcal",
    previewText: "#food Product 10g 20.00kcal",
    infoMessage: null,
  };
}

function getRadioByLabelText(
  containerEl: HTMLElement,
  labelText: string,
): HTMLInputElement {
  const labelEls = Array.from(containerEl.querySelectorAll("label"));
  const labelEl = labelEls.find((candidate) => {
    return candidate.textContent?.trim() === labelText;
  });
  const inputId = labelEl?.getAttribute("for");
  if (!inputId) {
    throw new Error(`Missing label for ${labelText}`);
  }

  const inputEl = containerEl.querySelector<HTMLInputElement>(`#${inputId}`);
  if (!inputEl) {
    throw new Error(`Missing input for ${labelText}`);
  }

  return inputEl;
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
