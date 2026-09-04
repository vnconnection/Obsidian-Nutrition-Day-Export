import type { App, TFile } from "obsidian";
import { createStructuredError } from "../errors/errorFactories";
import type { StructuredError } from "../types";
import { isDailyNoteName, toDailyNoteFileName } from "../utils/dateUtils";

export interface DailyNoteLookupResult {
  file: TFile | null;
  selectedDate: string | null;
  error: StructuredError | null;
}

export class DailyNoteService {
  private readonly app: App;

  public constructor(app: App) {
    this.app = app;
  }

  public getInitialDate(): string {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile || !isDailyNoteName(activeFile.basename)) {
      return "";
    }

    return isDailyNoteName(activeFile.basename) ? activeFile.basename : "";
  }

  public resolveDailyNote(dateText: string): DailyNoteLookupResult {
    const trimmedDateText = dateText.trim();
    if (trimmedDateText) {
      const requestedFileName = toDailyNoteFileName(trimmedDateText);
      const matchingFile = this.app.vault
        .getMarkdownFiles()
        .find((markdownFile) => markdownFile.name === requestedFileName);

      if (!matchingFile) {
        return {
          file: null,
          selectedDate: trimmedDateText,
          error: createStructuredError(
            "daily_note_not_found",
            {
              productName: trimmedDateText,
              sourcePath: requestedFileName,
              lineNumber: 0,
              rawEntry: trimmedDateText,
            },
            {
              requestedFileName,
            },
          ),
        };
      }

      return {
        file: matchingFile,
        selectedDate: trimmedDateText,
        error: null,
      };
    }

    const activeFile = this.app.workspace.getActiveFile();
    const activeFilePath = activeFile?.path ?? "";
    if (!activeFile || !isDailyNoteName(activeFile.basename)) {
      return {
        file: null,
        selectedDate: null,
        error: createStructuredError("daily_note_not_found", {
          productName: "Active note",
          sourcePath: activeFilePath,
          lineNumber: 0,
          rawEntry: "",
        }),
      };
    }

    return {
      file: activeFile,
      selectedDate: isDailyNoteName(activeFile.basename)
        ? activeFile.basename
        : null,
      error: null,
    };
  }
}
