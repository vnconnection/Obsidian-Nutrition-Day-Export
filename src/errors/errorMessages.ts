import type { StructuredErrorCode } from "../types";

interface ErrorMessageContext {
  requestedFileName?: string;
  sourceHeading?: string;
}

export function getDefaultErrorMessage(
  code: StructuredErrorCode,
  context: ErrorMessageContext = {},
): string {
  switch (code) {
    case "daily_note_not_found":
      return context.requestedFileName
        ? `Daily note ${context.requestedFileName} was not found.`
        : "There is no active daily note and no date override was provided.";
    case "nutrition_section_not_found":
      return `Section "${context.sourceHeading ?? "the selected source"}" was not found.`;
    case "inline_pc_requires_serving_size":
      return "Inline pc amounts require a linked nutrient note with serving_size for per-100g conversion.";
    default:
      throw new Error(`No default error message exists for code "${code}".`);
  }
}
