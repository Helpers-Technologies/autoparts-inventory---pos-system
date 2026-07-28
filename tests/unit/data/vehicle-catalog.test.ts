import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import catalog from "../../../src/data/vehicle-catalog.generated.json";
import {
  inferVehicleCountryCode,
  isMakeIncludedInSpecialization,
  normalizeVehicleCountryCode,
} from "../../../src/data/vehicleCountries";
import type { VehicleCatalogPreferences, VehicleMake } from "../../../src/types";

describe("generated vehicle catalog", () => {
  it("ships the complete make/logo catalog", () => {
    expect(catalog.makes).toHaveLength(352);
    expect(new Set(catalog.makes.map((make) => make.id)).size).toBe(catalog.makes.length);
    expect(new Set(catalog.makes.map((make) => make.slug)).size).toBe(catalog.makes.length);
  });

  it("has a local offline logo file for every make", () => {
    for (const make of catalog.makes) {
      const relative = make.logoPath.replace(/^\//, "");
      expect(existsSync(join(process.cwd(), "public", relative))).toBe(true);
    }
  });

  it("contains only models that point to a known make", () => {
    const makeIds = new Set(catalog.makes.map((make) => make.id));
    expect(catalog.models.length).toBeGreaterThan(2_900);
    expect(catalog.models.every((model) => makeIds.has(model.makeId))).toBe(true);
    expect(new Set(catalog.models.map((model) => model.id)).size).toBe(catalog.models.length);
  });

  it("includes regional models missing from the US-focused source", () => {
    const namesFor = (makeName: string) => {
      const make = catalog.makes.find((item) => item.name === makeName);
      return new Set(catalog.models.filter((model) => model.makeId === make?.id).map((model) => model.name));
    };
    expect(namesFor("Chery")).toContain("Tiggo 8 Pro Max");
    expect(namesFor("MG")).toContain("MG ZS");
    expect(namesFor("Škoda")).toContain("Octavia");
    expect(namesFor("Renault")).toContain("Logan");
  });

  it("classifies practically the complete make catalog by market country", () => {
    const classified = catalog.makes.filter((make) => inferVehicleCountryCode(make));
    expect(classified.length).toBeGreaterThanOrEqual(351);
  });

  it("classifies the main Egyptian spare-parts markets correctly", () => {
    const countryFor = (name: string) => {
      const make = catalog.makes.find((item) => item.name === name);
      expect(make).toBeDefined();
      return inferVehicleCountryCode(make!);
    };
    expect(countryFor("Chery")).toBe("CN");
    expect(countryFor("MG")).toBe("CN");
    expect(countryFor("Hyundai")).toBe("KR");
    expect(countryFor("Kia")).toBe("KR");
    expect(countryFor("Chevrolet")).toBe("US");
    expect(countryFor("BMW")).toBe("DE");
    expect(countryFor("Toyota")).toBe("JP");
  });

  it("normalizes Arabic and English country values for user-added makes", () => {
    expect(normalizeVehicleCountryCode("صيني")).toBe("CN");
    expect(normalizeVehicleCountryCode("Korean")).toBe("KR");
    expect(normalizeVehicleCountryCode("DE")).toBe("DE");
  });

  it("combines selected countries with individual make exceptions", () => {
    const make = (id: string, countryCode: string): VehicleMake => ({
      id,
      name: id,
      slug: id,
      countryCode,
      active: true,
    });
    const preferences: VehicleCatalogPreferences = {
      includeAllMakes: false,
      selectedCountryCodes: ["KR"],
      selectedMakeIds: ["chevrolet"],
    };

    expect(isMakeIncludedInSpecialization(make("kia", "KR"), preferences)).toBe(true);
    expect(isMakeIncludedInSpecialization(make("chevrolet", "US"), preferences)).toBe(true);
    expect(isMakeIncludedInSpecialization(make("bmw", "DE"), preferences)).toBe(false);
  });
});
