/**
 * Shop-editable product pick lists.
 *
 * Quality grade, part condition and warranty term were hard-coded, so a shop
 * could neither add a grade it actually stocks nor rename one to the words its
 * counter uses. The rules that make that safe are: products store the VALUE
 * (renaming never rewrites a product), built-ins survive settings written by
 * older builds, and a deleted built-in stays deleted.
 *
 * TC-POPT-001 through TC-POPT-009
 */
import { describe, it, expect } from "vitest";
import {
  BUILT_IN_QUALITY_GRADES,
  nextProductOptionValue,
  productOptionLabel,
  resolveProductOptions,
  type ProductOptionSettings,
} from "../../../src/lib/productOptions";

describe("product option lists — TC-POPT", () => {
  it("TC-POPT-001: an untouched install gets the built-ins", () => {
    expect(resolveProductOptions("qualityGrades", undefined)).toEqual(BUILT_IN_QUALITY_GRADES);
    expect(resolveProductOptions("conditions", {}).map((o) => o.value)).toEqual([
      "new",
      "used",
      "remanufactured",
    ]);
  });

  it("TC-POPT-002: a renamed built-in keeps its value and is still marked built-in", () => {
    const saved: ProductOptionSettings = {
      qualityGrades: [
        { value: "genuine", label: "توكيل" },
        { value: "oem", label: "OEM أصلي مصنع" },
        { value: "aftermarket-premium", label: "بديل ممتاز" },
        { value: "aftermarket-economy", label: "بديل اقتصادي" },
      ],
    };
    const resolved = resolveProductOptions("qualityGrades", saved);
    const genuine = resolved.find((o) => o.value === "genuine");
    expect(genuine).toEqual({ value: "genuine", label: "توكيل", builtIn: true });
  });

  it("TC-POPT-003: a built-in introduced by a newer build is appended, not lost", () => {
    // Settings written before "aftermarket-economy" existed.
    const saved: ProductOptionSettings = {
      qualityGrades: [
        { value: "genuine", label: "أصلي توكيل" },
        { value: "oem", label: "OEM أصلي مصنع" },
      ],
    };
    const values = resolveProductOptions("qualityGrades", saved).map((o) => o.value);
    expect(values).toContain("aftermarket-premium");
    expect(values).toContain("aftermarket-economy");
  });

  it("TC-POPT-004: a built-in the shop deleted stays deleted", () => {
    const saved: ProductOptionSettings = {
      qualityGrades: [
        { value: "genuine", label: "أصلي توكيل" },
        { value: "oem", label: "OEM أصلي مصنع" },
        { value: "aftermarket-premium", label: "بديل ممتاز" },
      ],
      deletedBuiltIns: ["aftermarket-economy"],
    };
    const values = resolveProductOptions("qualityGrades", saved).map((o) => o.value);
    expect(values).not.toContain("aftermarket-economy");
  });

  it("TC-POPT-005: shop-added entries are kept and not marked built-in", () => {
    const saved: ProductOptionSettings = {
      conditions: [
        { value: "new", label: "جديدة" },
        { value: "مستعمل-وارد-الخليج", label: "مستعمل وارد الخليج" },
      ],
      deletedBuiltIns: ["used", "remanufactured"],
    };
    const resolved = resolveProductOptions("conditions", saved);
    expect(resolved).toEqual([
      { value: "new", label: "جديدة", builtIn: true },
      { value: "مستعمل-وارد-الخليج", label: "مستعمل وارد الخليج", builtIn: false },
    ]);
  });

  it("TC-POPT-006: a corrupt entry is skipped rather than rendering a blank row", () => {
    const saved = {
      conditions: [
        { value: "new", label: "جديدة" },
        { value: "", label: "بلا قيمة" },
        null,
        { value: "used" },
      ],
      deletedBuiltIns: ["remanufactured"],
    } as unknown as ProductOptionSettings;
    const resolved = resolveProductOptions("conditions", saved);
    expect(resolved.map((o) => o.value)).toEqual(["new", "used"]);
    // A missing label falls back to the built-in wording, never to empty.
    expect(resolved.find((o) => o.value === "used")?.label).toBe("استيراد / مستعملة");
  });

  it("TC-POPT-007: warranty values are the month count, because dates are computed from them", () => {
    const options = resolveProductOptions("warranties", undefined);
    expect(nextProductOptionValue("warranties", "4 شهور", options, 4)).toBe("4");
    // Already present.
    expect(nextProductOptionValue("warranties", "سنة", options, 12)).toBeNull();
    // Not a usable term.
    expect(nextProductOptionValue("warranties", "ضمان", options, undefined)).toBeNull();
    expect(nextProductOptionValue("warranties", "ضمان", options, -3)).toBeNull();
  });

  it("TC-POPT-008: a new grade gets a slug, and a colliding slug gets a suffix", () => {
    const options = resolveProductOptions("qualityGrades", undefined);
    const first = nextProductOptionValue("qualityGrades", "أصلي مستعمل", options);
    expect(first).toBe("أصلي-مستعمل");
    const withFirst = [...options, { value: first as string, label: "أصلي مستعمل" }];
    expect(nextProductOptionValue("qualityGrades", "أصلي مستعمل", withFirst)).toBe("أصلي-مستعمل-2");
  });

  it("TC-POPT-009: an unknown stored value renders as itself, never blank", () => {
    const options = resolveProductOptions("qualityGrades", undefined);
    expect(productOptionLabel(options, "genuine")).toBe("أصلي توكيل");
    expect(productOptionLabel(options, "deleted-grade")).toBe("deleted-grade");
    expect(productOptionLabel(options, undefined, "—")).toBe("—");
  });
});
