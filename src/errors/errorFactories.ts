import type { StructuredError, StructuredErrorCode } from "../types";
import { getDefaultErrorMessage } from "./errorMessages";
import { getErrorCategory } from "./errorTypes";

interface StructuredErrorContext {
  productName: string;
  sourcePath: string;
  lineNumber: number;
  rawEntry: string;
}

interface StructuredErrorOptions {
  reason?: string;
  requestedFileName?: string;
  sourceHeading?: string;
}

export function createStructuredError(
  code: StructuredErrorCode,
  context: StructuredErrorContext,
  options: StructuredErrorOptions = {},
): StructuredError {
  return {
    category: getErrorCategory(code),
    code,
    productName: context.productName,
    reason:
      options.reason ??
      getDefaultErrorMessage(code, {
        requestedFileName: options.requestedFileName,
        sourceHeading: options.sourceHeading,
      }),
    sourcePath: context.sourcePath,
    lineNumber: context.lineNumber,
    rawEntry: context.rawEntry,
  };
}
