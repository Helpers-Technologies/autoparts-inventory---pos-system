import { describe, expect, it } from "vitest";
import {
  ADDITIONAL_STARTER_PRODUCTS,
  buildStarterProductFitments,
  mergeAutoPartsStarterCatalog,
} from "../../../src/data/autoPartsStarterCatalog";
import { seedProducts } from "../../../src/data/seed";
import { seedVehicleMakes, seedVehicleModels } from "../../../src/data/vehicleCatalogSeed";
import type { Product } from "../../../src/types";

describe("Chinese and Korean starter product catalog", () => {
  it("ships corrected legacy rows plus structured Chinese and Korean additions", () => {
    expect(seedProducts).toHaveLength(95);
    expect(ADDITIONAL_STARTER_PRODUCTS.filter((product) => product.originCountry === "KR")).toHaveLength(18);
    expect(ADDITIONAL_STARTER_PRODUCTS.filter((product) => product.originCountry === "CN")).toHaveLength(18);
    expect(new Set(seedProducts.map((product) => product.code)).size).toBe(seedProducts.length);
    expect(new Set(seedProducts.map((product) => product.partNumber)).size).toBe(seedProducts.length);
  });

  it("does not invent stock or prices for newly added catalog rows", () => {
    for (const product of ADDITIONAL_STARTER_PRODUCTS) {
      expect(product.quantity).toBe(0);
      expect(product.purchasePrice).toBe(0);
      expect(product.wholesalePrice).toBe(0);
      expect(product.retailPrice).toBe(0);
      expect(product.rackLocation).toBeTruthy();
      expect(product.partBrand).toBeTruthy();
    }
  });

  it("upgrades untouched demo rows while preserving identity, stock and financial values", () => {
    const catalogRow = seedProducts.find((product) => product.code === "BRK-001")!;
    const legacy: Product = {
      ...catalogRow,
      id: "live-product-id",
      name: "طقم فرامل أمامي (فنص) - شيري A15",
      partNumber: "BRK-001",
      oemNumbers: [],
      partBrand: undefined,
      manufacturer: undefined,
      quantity: 27,
      purchasePrice: 123,
      wholesalePrice: 170,
      retailPrice: 225,
    };

    const merged = mergeAutoPartsStarterCatalog([legacy], seedProducts);
    const upgraded = merged.find((product) => product.code === "BRK-001")!;
    expect(upgraded.id).toBe("live-product-id");
    expect(upgraded.quantity).toBe(27);
    expect(upgraded.purchasePrice).toBe(123);
    expect(upgraded.retailPrice).toBe(225);
    expect(upgraded.name).toBe("طقم تيل فرامل أمامي — Chery A15");
    expect(upgraded.partNumber).toBe("AP-BRK-001");
    expect(upgraded.partBrand).toBe("Aftermarket CN");
  });

  it("refreshes managed starter details without touching their stock or prices", () => {
    const catalogRow = seedProducts.find((product) => product.code === "KOR-004")!;
    const installed: Product = {
      ...catalogRow,
      id: "installed-starter-id",
      name: "فلتر هواء — Hyundai Tucson / Kia Sportage",
      notes: undefined,
      quantity: 7,
      purchasePrice: 210,
      wholesalePrice: 250,
      retailPrice: 290,
    };

    const merged = mergeAutoPartsStarterCatalog([installed], seedProducts);
    const upgraded = merged.find((product) => product.code === "KOR-004")!;
    expect(upgraded.id).toBe("installed-starter-id");
    expect(upgraded.quantity).toBe(7);
    expect(upgraded.purchasePrice).toBe(210);
    expect(upgraded.retailPrice).toBe(290);
    expect(upgraded.name).toBe("فلتر هواء محرك — Hyundai Tucson (2009–2015)");
    expect(upgraded.notes).toContain("VIN");
  });

  it("creates vehicle fitments for both markets without replacing existing user fitments", () => {
    const fitments = buildStarterProductFitments(
      seedProducts,
      seedVehicleMakes,
      seedVehicleModels,
      [],
    );
    const oilFilter = seedProducts.find((product) => product.code === "KOR-001")!;
    const tiggoFilter = seedProducts.find((product) => product.code === "CHN-001")!;
    const koreanMakes = new Set(
      fitments
        .filter((fitment) => fitment.productId === oilFilter.id)
        .map((fitment) => seedVehicleMakes.find((make) => make.id === fitment.makeId)?.name),
    );
    expect(koreanMakes).toEqual(new Set(["Hyundai", "Kia"]));
    expect(fitments.some((fitment) => fitment.productId === tiggoFilter.id && fitment.modelId)).toBe(true);

    const tucsonFilter = seedProducts.find((product) => product.code === "KOR-004")!;
    const tucsonLinks = fitments.filter((fitment) => fitment.productId === tucsonFilter.id);
    expect(tucsonLinks).toHaveLength(1);
    expect(tucsonLinks[0]).toMatchObject({ yearFrom: 2009, yearTo: 2015 });
    expect(seedVehicleMakes.find((make) => make.id === tucsonLinks[0]!.makeId)?.name).toBe("Hyundai");

    const custom = { ...fitments[0]!, id: "custom-fitment" };
    const orphan = { ...fitments[0]!, id: "orphan-fitment", productId: "missing-product" };
    const rebuilt = buildStarterProductFitments(
      seedProducts,
      seedVehicleMakes,
      seedVehicleModels,
      [custom, orphan],
    );
    expect(rebuilt.filter((fitment) => fitment.productId === custom.productId)).toEqual([custom]);
    expect(rebuilt.some((fitment) => fitment.id === orphan.id)).toBe(false);
  });
});
