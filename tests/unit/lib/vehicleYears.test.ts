/**
 * Model years are bounded by what the catalogue says the car was built in.
 *
 * The picker used to offer 1970 → next year for every vehicle, which let a
 * 2007–2017 Lancer be saved as a 1994 model. Fitment matching is by year, so
 * that car then matched nothing for the rest of its life in the system.
 *
 * TC-VYEAR-001 through TC-VYEAR-007
 */
import { describe, it, expect } from "vitest";
import { isYearWithinRange, vehicleYearRange } from "../../../src/lib/vehicleYears";
import type { VehicleGeneration } from "../../../src/types";

const NOW = new Date("2026-08-20T00:00:00.000Z");
const CEILING = 2027; // NOW.getFullYear() + 1

function generation(partial: Partial<VehicleGeneration> & { id: string; modelId: string }): VehicleGeneration {
  return {
    name: partial.id,
    active: true,
    createdAt: "2020-01-01T00:00:00.000Z",
    ...partial,
  } as VehicleGeneration;
}

const LANCER_CY = generation({
  id: "gen_lancer_cy",
  modelId: "model_lancer",
  name: "الجيل التاسع (CY)",
  yearFrom: 2007,
  yearTo: 2017,
});
const LANCER_CS = generation({
  id: "gen_lancer_cs",
  modelId: "model_lancer",
  name: "الجيل الثامن (CS)",
  yearFrom: 2000,
  yearTo: 2007,
});
const TIGGO_CURRENT = generation({
  id: "gen_tiggo_8",
  modelId: "model_tiggo",
  name: "Tiggo 8",
  yearFrom: 2018,
  // still in production — no yearTo
});

const CATALOGUE = [LANCER_CY, LANCER_CS, TIGGO_CURRENT];

describe("vehicle model years — TC-VYEAR", () => {
  it("TC-VYEAR-001: a chosen generation bounds the picker to its production window", () => {
    const range = vehicleYearRange(CATALOGUE, { generationId: "gen_lancer_cy" }, NOW);
    expect(range.from).toBe(2007);
    expect(range.to).toBe(2017);
  });

  it("TC-VYEAR-002: a model spans all of its generations", () => {
    const range = vehicleYearRange(CATALOGUE, { modelId: "model_lancer" }, NOW);
    expect(range.from).toBe(2000);
    expect(range.to).toBe(2017);
  });

  it("TC-VYEAR-003: a generation still in production runs to next year, not forever", () => {
    const range = vehicleYearRange(CATALOGUE, { generationId: "gen_tiggo_8" }, NOW);
    expect(range.from).toBe(2018);
    expect(range.to).toBe(CEILING);
    expect(range.hint).toContain("حتى الآن");
  });

  it("TC-VYEAR-004: with nothing chosen the full range stands", () => {
    const range = vehicleYearRange(CATALOGUE, {}, NOW);
    expect(range.from).toBe(1970);
    expect(range.to).toBe(CEILING);
  });

  it("TC-VYEAR-005: a generation whose window ends in the future is still capped at next year", () => {
    const future = generation({
      id: "gen_future",
      modelId: "model_x",
      yearFrom: 2024,
      yearTo: 2099,
    });
    const range = vehicleYearRange([future], { generationId: "gen_future" }, NOW);
    expect(range.to).toBe(CEILING);
  });

  it("TC-VYEAR-006: inactive generations do not widen a model's window", () => {
    const retired = generation({
      id: "gen_old",
      modelId: "model_lancer",
      yearFrom: 1973,
      yearTo: 1979,
      active: false,
    });
    const range = vehicleYearRange([...CATALOGUE, retired], { modelId: "model_lancer" }, NOW);
    expect(range.from).toBe(2000);
  });

  it("TC-VYEAR-007: a year outside the window is rejected, an empty year is not", () => {
    const range = vehicleYearRange(CATALOGUE, { generationId: "gen_lancer_cy" }, NOW);
    expect(isYearWithinRange(1994, range)).toBe(false);
    expect(isYearWithinRange(2012, range)).toBe(true);
    expect(isYearWithinRange(2018, range)).toBe(false);
    expect(isYearWithinRange("", range)).toBe(true);
    expect(isYearWithinRange(undefined, range)).toBe(true);
  });
});
