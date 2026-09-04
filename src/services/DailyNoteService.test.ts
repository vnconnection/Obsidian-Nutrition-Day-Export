import { App, TFile } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import { DailyNoteService } from "./DailyNoteService";

describe("DailyNoteService", () => {
  it("returns the full structured source error when the requested daily note is missing", () => {
    const app = new App();
    app.workspace.getActiveFile = vi
      .fn()
      .mockReturnValue(new TFile("Diary/2026.09.04.md"));
    app.vault.getMarkdownFiles = vi.fn().mockReturnValue([]);

    const result = new DailyNoteService(app).resolveDailyNote("2026.09.03");

    expect(result).toEqual({
      file: null,
      selectedDate: "2026.09.03",
      error: {
        category: "source",
        code: "daily_note_not_found",
        productName: "2026.09.03",
        reason: "Daily note 2026.09.03.md was not found.",
        sourcePath: "2026.09.03.md",
        lineNumber: 0,
        rawEntry: "2026.09.03",
      },
    });
  });
});
