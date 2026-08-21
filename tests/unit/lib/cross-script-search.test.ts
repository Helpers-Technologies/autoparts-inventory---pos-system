/**
 * Arabic model search against a Latin-only catalogue.
 *
 * The generated vehicle catalogue holds 3,058 models and none of them carries
 * an Arabic name, so a shop typing "لانسر" used to get no results at all. The
 * matcher folds both scripts to a consonant skeleton instead; these are the
 * models an Egyptian counter actually asks for.
 *
 * TC-XSCRIPT-001 through TC-XSCRIPT-006
 */
import { describe, it, expect } from "vitest";
import { isCrossScriptMatch, isFuzzyMatch, scriptSkeleton } from "../../../src/lib/fuzzySearch";

describe("cross-script model search — TC-XSCRIPT", () => {
  it("TC-XSCRIPT-001: the Arabic and Latin spellings reduce to the same skeleton", () => {
    expect(scriptSkeleton("Lancer")).toBe(scriptSkeleton("لانسر"));
    expect(scriptSkeleton("Corolla")).toBe(scriptSkeleton("كورولا"));
    expect(scriptSkeleton("Volvo")).toBe(scriptSkeleton("فولفو"));
    expect(scriptSkeleton("Elantra")).toBe(scriptSkeleton("ايلانترا"));
  });

  it("TC-XSCRIPT-002: common Egyptian model names match their catalogue entry", () => {
    const pairs: [string, string][] = [
      ["لانسر", "Lancer"],
      ["كورولا", "Corolla"],
      ["اكسنت", "Accent"],
      ["ايلانترا", "Elantra"],
      ["سيراتو", "Cerato"],
      ["توسان", "Tucson"],
      ["سيفيك", "Civic"],
      ["فيرنا", "Verna"],
      ["اوبتيما", "Optima"],
      ["سبورتاج", "Sportage"],
      ["تيجو", "Tiggo"],
      ["لوجان", "Logan"],
      ["شاهين", "Shahin"],
      ["ماتيز", "Matiz"],
    ];
    for (const [arabic, latin] of pairs) {
      expect(isCrossScriptMatch(arabic, latin), `${arabic} → ${latin}`).toBe(true);
    }
  });

  it("TC-XSCRIPT-003: it does not match an unrelated model of the same make", () => {
    expect(isCrossScriptMatch("لانسر", "Pajero")).toBe(false);
    expect(isCrossScriptMatch("كورولا", "Yaris")).toBe(false);
    expect(isCrossScriptMatch("اكسنت", "Santa Fe")).toBe(false);
    expect(isCrossScriptMatch("تيجو", "Arrizo")).toBe(false);
  });

  it("TC-XSCRIPT-004: same-script pairs are left to the existing strategies", () => {
    // Returning true here would let the loose skeleton rule leak into ordinary
    // Arabic-to-Arabic and Latin-to-Latin product searches.
    expect(isCrossScriptMatch("Lancer", "Lancer")).toBe(false);
    expect(isCrossScriptMatch("فلتر", "فلتر زيت")).toBe(false);
  });

  it("TC-XSCRIPT-005: the dropdown filter finds the model by its Arabic name", () => {
    const models = ["3000GT", "Attrage", "Cordia", "Diamante", "Eclipse", "Lancer", "Pajero"];
    const hits = models.filter((name) => isFuzzyMatch("لانسر", [name]));
    expect(hits).toEqual(["Lancer"]);
  });

  it("TC-XSCRIPT-006: an ordinary Arabic part search is unaffected", () => {
    // Regression guard: the new strategy must not widen same-script results.
    const parts = ["فلتر زيت محرك", "طقم تيل فرامل أمامي", "مساعد أمامي"];
    expect(parts.filter((p) => isFuzzyMatch("فلتر", [p]))).toEqual(["فلتر زيت محرك"]);
    expect(parts.filter((p) => isFuzzyMatch("فرامل", [p]))).toEqual(["طقم تيل فرامل أمامي"]);
  });
});
