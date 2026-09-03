import { describe, expect, it } from "vitest";
import { formatAmount } from "./numberUtils";

describe("formatAmount", () => {
  it("removes insignificant trailing zeroes", () => {
    expect(formatAmount(217, 2)).toBe("217");
    expect(formatAmount(217.5, 2)).toBe("217.5");
    expect(formatAmount(0, 2)).toBe("0");
  });
});
