import { describe, it, expect } from "vitest";
import { parseNumericInput } from "../../../src/lib/numberInput";

describe("parseNumericInput", () => {
  describe("standard ASCII digits", () => {
    it("parses a plain integer", () => {
      expect(parseNumericInput("42")).toBe(42);
    });

    it("parses a decimal number", () => {
      expect(parseNumericInput("3.14")).toBe(3.14);
    });

    it("parses a negative number", () => {
      expect(parseNumericInput("-10")).toBe(-10);
    });

    it("parses zero", () => {
      expect(parseNumericInput("0")).toBe(0);
    });

    it("parses a large number with no separator", () => {
      expect(parseNumericInput("1000000")).toBe(1_000_000);
    });
  });

  describe("Arabic-Indic digits (٠١٢٣٤٥٦٧٨٩)", () => {
    it("converts Arabic-Indic digits to ASCII", () => {
      expect(parseNumericInput("٥")).toBe(5);
      expect(parseNumericInput("١٢٣")).toBe(123);
      expect(parseNumericInput("٠")).toBe(0);
    });

    it("converts a mixed Arabic-decimal expression", () => {
      // "١٠.٥" = "10.5"
      expect(parseNumericInput("١٠.٥")).toBe(10.5);
    });
  });

  describe("Persian digits (۰۱۲۳۴۵۶۷۸۹)", () => {
    it("converts Persian digits to ASCII", () => {
      expect(parseNumericInput("۷")).toBe(7);
      expect(parseNumericInput("۴۵۶")).toBe(456);
    });
  });

  describe("comma-as-decimal separator", () => {
    it("converts a comma to a dot", () => {
      expect(parseNumericInput("3,14")).toBe(3.14);
    });

    it("handles a value like '1,5'", () => {
      expect(parseNumericInput("1,5")).toBe(1.5);
    });
  });

  describe("whitespace handling", () => {
    it("strips leading and trailing whitespace", () => {
      expect(parseNumericInput("  99  ")).toBe(99);
    });

    it("strips internal spaces", () => {
      expect(parseNumericInput("1 000")).toBe(1000);
    });
  });

  describe("edge and error cases", () => {
    it("returns 0 for an empty string", () => {
      expect(parseNumericInput("")).toBe(0);
    });

    it("returns fallback for a lone dot", () => {
      expect(parseNumericInput(".", 99)).toBe(99);
    });

    it("returns fallback for a lone minus sign", () => {
      expect(parseNumericInput("-", 99)).toBe(99);
    });

    it("returns fallback for a lone plus sign", () => {
      expect(parseNumericInput("+", 99)).toBe(99);
    });

    it("returns fallback for non-numeric text", () => {
      expect(parseNumericInput("abc", 0)).toBe(0);
    });

    it("uses 0 as default fallback when none provided", () => {
      expect(parseNumericInput("xyz")).toBe(0);
    });

    it("uses a custom fallback value", () => {
      expect(parseNumericInput("NaN", -1)).toBe(-1);
    });
  });
});
