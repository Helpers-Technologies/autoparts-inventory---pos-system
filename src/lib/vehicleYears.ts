import type { VehicleGeneration } from "../types";

export interface VehicleYearRange {
  from: number;
  to: number;
  /** Shown under the picker so the narrowing is explained, not just imposed. */
  hint: string;
}

/**
 * The model years a given car could actually have been built in.
 *
 * The year picker offered 1970 to next year for every vehicle, so a Lancer on
 * the 2007–2017 generation could be saved as a 1994 — and the fitment lookup,
 * which matches parts by year, would then never match that car again. The
 * catalogue already carries the production window; this turns it into the
 * bounds of the picker.
 *
 * A generation states its own window. A model's window is the span of all its
 * generations, left open at the top if any generation is still in production.
 * With neither chosen there is nothing to narrow to, so the full range stands.
 */
export function vehicleYearRange(
  generations: VehicleGeneration[],
  { generationId, modelId }: { generationId?: string; modelId?: string },
  now: Date = new Date(),
): VehicleYearRange {
  const ceiling = now.getFullYear() + 1;

  const generation = generationId
    ? generations.find((item) => item.id === generationId)
    : undefined;

  if (generation?.yearFrom) {
    const to = Math.min(generation.yearTo ?? ceiling, ceiling);
    return {
      from: generation.yearFrom,
      to: Math.max(generation.yearFrom, to),
      hint: `سنوات إنتاج ${generation.name}: ${generation.yearFrom} — ${generation.yearTo ?? "حتى الآن"}`,
    };
  }

  if (modelId) {
    const windows = generations.filter(
      (item) => item.modelId === modelId && item.active && item.yearFrom,
    );
    if (windows.length > 0) {
      const from = Math.min(...windows.map((item) => item.yearFrom as number));
      // A generation with no yearTo is still being built, so the model's
      // window has no upper bound beyond the current year.
      const openEnded = windows.some((item) => !item.yearTo);
      const to = openEnded
        ? ceiling
        : Math.min(Math.max(...windows.map((item) => item.yearTo as number)), ceiling);
      return {
        from,
        to: Math.max(from, to),
        hint: `سنوات إنتاج الموديل: ${from} — ${openEnded ? "حتى الآن" : to}`,
      };
    }
  }

  return {
    from: 1970,
    to: ceiling,
    hint: "اختر الموديل أو الجيل لتحديد السنوات المتاحة",
  };
}

/** True when `year` falls inside the range; an empty year is always allowed. */
export function isYearWithinRange(year: string | number | undefined, range: VehicleYearRange): boolean {
  if (year === undefined || year === "" || year === null) return true;
  const value = Number(year);
  if (!Number.isFinite(value)) return false;
  return value >= range.from && value <= range.to;
}
