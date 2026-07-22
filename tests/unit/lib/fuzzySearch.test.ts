import { describe, expect, it } from "vitest";
import { isFuzzyMatch, normalizeArabicAndEnglish, levenshteinDistance } from "../../../src/lib/fuzzySearch";

describe("fuzzySearch utility", () => {
  it("normalizes Arabic characters accurately", () => {
    expect(normalizeArabicAndEnglish("أُودي")).toBe("اوـدي".replace(/ـ/g, ""));
    expect(normalizeArabicAndEnglish("ميتسوبيشي")).toBe("ميتسوبيشي");
    expect(normalizeArabicAndEnglish("هيونداى")).toBe("هيونداي");
  });

  it("calculates Levenshtein edit distance", () => {
    expect(levenshteinDistance("متسوبيشي", "ميتسوبيشي")).toBe(1);
    expect(levenshteinDistance("تيوتا", "تويوتا")).toBe(1);
  });

  it("matches Mitsubishi with Arabic variants and typos", () => {
    expect(isFuzzyMatch("متسوبيشي", ["Mitsubishi", "ميتسوبيشي"])).toBe(true);
    expect(isFuzzyMatch("مستوبيشي", ["Mitsubishi", "ميتسوبيشي"])).toBe(true);
    expect(isFuzzyMatch("mitsubishi", ["Mitsubishi", "ميتسوبيشي"])).toBe(true);
  });

  it("matches Mercedes, Toyota, BMW, Hyundai, etc.", () => {
    expect(isFuzzyMatch("مرسيدس", ["Mercedes-Benz", "مرسيدس"])).toBe(true);
    expect(isFuzzyMatch("تيوتا", ["Toyota", "تويوتا"])).toBe(true);
    expect(isFuzzyMatch("بي ام", ["BMW", "بي ام دبليو"])).toBe(true);
    expect(isFuzzyMatch("هيونداى", ["Hyundai", "هيونداي"])).toBe(true);
    expect(isFuzzyMatch("شفروليه", ["Chevrolet", "شيفروليه"])).toBe(true);
  });
});
