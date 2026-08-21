/**
 * The pick lists behind the product form: quality grade, part condition and
 * warranty term.
 *
 * These were hard-coded `<option>` elements. Every shop that stocks something
 * the list did not anticipate — a reconditioned gearbox, a 4-month supplier
 * warranty, an "أصلي مستعمل" grade — had no way to record it, and no way to
 * rename a grade to the words their own counter uses.
 *
 * Two properties keep that editable without breaking stored data:
 *
 *   1. A product stores the option's `value`, never its label. Renaming
 *      "بديل ممتاز" changes what is displayed on ten thousand products and
 *      rewrites none of them.
 *
 *   2. The built-ins are always present in the resolved list, even if the
 *      saved settings predate them. Anything the shop adds is merged on top.
 *      So a settings blob written by an older build still yields a complete,
 *      working list rather than an empty dropdown.
 *
 * A built-in can be renamed and — when nothing uses it — deleted. Deleting one
 * that products still reference is refused at the call site rather than here,
 * because only the caller knows the catalogue.
 */

export interface ProductOption {
  /** Stored on the product. Never changes once issued. */
  value: string;
  label: string;
  /** Shipped with the app. Renameable; deletable only when unused. */
  builtIn?: boolean;
}

export type ProductOptionList = "qualityGrades" | "conditions" | "warranties";

export interface ProductOptionSettings {
  qualityGrades?: ProductOption[];
  conditions?: ProductOption[];
  warranties?: ProductOption[];
  /**
   * Built-in values the shop deleted. Recorded explicitly so a built-in that
   * is simply MISSING from a list written by an older build can still be
   * added back, while one the shop actually removed stays removed.
   */
  deletedBuiltIns?: string[];
}

export const BUILT_IN_QUALITY_GRADES: ProductOption[] = [
  { value: "genuine", label: "أصلي توكيل", builtIn: true },
  { value: "oem", label: "OEM أصلي مصنع", builtIn: true },
  { value: "aftermarket-premium", label: "بديل ممتاز", builtIn: true },
  { value: "aftermarket-economy", label: "بديل اقتصادي", builtIn: true },
];

export const BUILT_IN_CONDITIONS: ProductOption[] = [
  { value: "new", label: "جديدة", builtIn: true },
  { value: "used", label: "استيراد / مستعملة", builtIn: true },
  { value: "remanufactured", label: "مجددة", builtIn: true },
];

export const BUILT_IN_WARRANTIES: ProductOption[] = [
  { value: "0", label: "بدون ضمان", builtIn: true },
  { value: "1", label: "شهر واحد", builtIn: true },
  { value: "3", label: "3 شهور", builtIn: true },
  { value: "6", label: "6 شهور", builtIn: true },
  { value: "12", label: "سنة واحدة (12 شهر)", builtIn: true },
  { value: "18", label: "سنة ونصف (18 شهر)", builtIn: true },
  { value: "24", label: "سنتين (24 شهر)", builtIn: true },
  { value: "36", label: "3 سنوات", builtIn: true },
  { value: "60", label: "5 سنوات", builtIn: true },
];

const BUILT_INS: Record<ProductOptionList, ProductOption[]> = {
  qualityGrades: BUILT_IN_QUALITY_GRADES,
  conditions: BUILT_IN_CONDITIONS,
  warranties: BUILT_IN_WARRANTIES,
};

export const PRODUCT_OPTION_TITLES: Record<ProductOptionList, string> = {
  qualityGrades: "درجات الجودة",
  conditions: "حالات القطعة",
  warranties: "مدد الضمان",
};

/**
 * The list as the app should show it: every built-in that has not been
 * deleted, carrying any rename the shop applied, followed by whatever the shop
 * added. Order within the saved list is preserved so the shop can see its own
 * entries where it put them.
 */
export function resolveProductOptions(
  list: ProductOptionList,
  saved: ProductOptionSettings | undefined,
): ProductOption[] {
  const builtIns = BUILT_INS[list];
  const stored = saved?.[list];

  // Nothing saved yet: the built-ins ARE the list.
  if (!Array.isArray(stored)) return builtIns.map((option) => ({ ...option }));

  const byValue = new Map<string, ProductOption>();
  for (const option of stored) {
    if (!option || typeof option.value !== "string" || !option.value) continue;
    const builtIn = builtIns.find((item) => item.value === option.value);
    byValue.set(option.value, {
      value: option.value,
      label: typeof option.label === "string" && option.label.trim()
        ? option.label
        : builtIn?.label ?? option.value,
      builtIn: Boolean(builtIn),
    });
  }

  // A built-in missing from the saved list is either one the shop deleted or
  // one this build introduced after the settings were written. deletedBuiltIns
  // is what tells those apart: named there means gone on purpose, otherwise
  // it is new and gets appended.
  const result = [...byValue.values()];
  const knownValues = new Set(stored.map((option) => option?.value));
  const deletions = new Set(saved?.deletedBuiltIns ?? []);
  for (const builtIn of builtIns) {
    if (knownValues.has(builtIn.value)) continue;
    if (deletions.has(builtIn.value)) continue;
    result.push({ ...builtIn });
  }
  return result;
}

/** Label for a stored value, falling back to the value so nothing renders blank. */
export function productOptionLabel(
  options: ProductOption[],
  value: string | number | undefined | null,
  fallback?: string,
): string {
  if (value === undefined || value === null || value === "") return fallback ?? "";
  const key = String(value);
  return options.find((option) => option.value === key)?.label ?? fallback ?? key;
}

/**
 * A stable, collision-free value for a newly added option.
 *
 * Warranty terms are keyed by their month count because the rest of the app
 * does arithmetic on them (expiry dates, warranty-centre filters), so a
 * non-numeric warranty value would be meaningless. The other two lists take a
 * slug derived from the label, with a numeric suffix if that slug is taken.
 */
export function nextProductOptionValue(
  list: ProductOptionList,
  label: string,
  existing: ProductOption[],
  months?: number,
): string | null {
  if (list === "warranties") {
    if (months === undefined || !Number.isFinite(months) || months < 0) return null;
    const value = String(Math.round(months));
    return existing.some((option) => option.value === value) ? null : value;
  }
  const base =
    label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9ء-ي]+/g, "-")
      .replace(/^-+|-+$/g, "") || "custom";
  if (!existing.some((option) => option.value === base)) return base;
  for (let suffix = 2; suffix < 100; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!existing.some((option) => option.value === candidate)) return candidate;
  }
  return null;
}
