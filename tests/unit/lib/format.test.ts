import { describe, it, expect } from "vitest";
import { formatCurrency, formatNumber, formatDate, formatDateTime } from "../../../src/lib/format";

describe("formatCurrency", () => {
  it("formats a positive integer with two decimal places and default currency", () => {
    expect(formatCurrency(1000)).toBe("1,000.00 ج.م");
  });

  it("formats a decimal value correctly", () => {
    expect(formatCurrency(99.5)).toBe("99.50 ج.م");
  });

  it("accepts a custom currency symbol", () => {
    expect(formatCurrency(50, "USD")).toBe("50.00 USD");
  });

  it("formats zero as 0.00", () => {
    expect(formatCurrency(0)).toBe("0.00 ج.م");
  });

  it("formats negative amounts (refunds / overpayments)", () => {
    expect(formatCurrency(-250)).toBe("-250.00 ج.م");
  });

  it("treats NaN and Infinity as zero defensively", () => {
    expect(formatCurrency(Number.NaN)).toBe("0.00 ج.م");
    expect(formatCurrency(Number.POSITIVE_INFINITY)).toBe("0.00 ج.م");
  });

  it("uses thousands separator for large amounts", () => {
    expect(formatCurrency(1_234_567.89)).toBe("1,234,567.89 ج.م");
  });
});

describe("formatNumber", () => {
  it("adds thousands separators", () => {
    expect(formatNumber(10000)).toBe("10,000");
  });

  it("returns '0' for NaN", () => {
    expect(formatNumber(Number.NaN)).toBe("0");
  });

  it("handles zero", () => {
    expect(formatNumber(0)).toBe("0");
  });
});

describe("formatDate", () => {
  it("formats an ISO date string as DD/MM/YYYY", () => {
    expect(formatDate("2026-05-28")).toBe("28/05/2026");
  });

  it("returns empty string for empty input", () => {
    expect(formatDate("")).toBe("");
  });

  it("returns the raw string for unparseable input", () => {
    const bad = "not-a-date";
    expect(formatDate(bad)).toBe(bad);
  });

  it("pads single-digit day and month", () => {
    expect(formatDate("2026-01-05")).toBe("05/01/2026");
  });
});

describe("formatDateTime", () => {
  it("returns empty string for empty input", () => {
    expect(formatDateTime("")).toBe("");
  });

  it("returns raw string for unparseable input", () => {
    const bad = "invalid";
    expect(formatDateTime(bad)).toBe(bad);
  });

  it("includes date and HH:MM time portion", () => {
    const result = formatDateTime("2026-05-28T14:07:00.000Z");
    // Date portion must be present; time portion format is HH:MM
    expect(result).toMatch(/\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/);
  });
});
