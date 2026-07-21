import { describe, expect, it } from "vitest";
import { seedProducts } from "../../../src/data/seed";
import {
  calculateTierPrice,
  inferMakeNameFromVin,
  isValidVin,
  normalizeVin,
  productVehicleFitmentStatus,
  reconcileBranchStocks,
} from "../../../src/store/AutoPartsProContext";
import type { Branch, CustomerVehicle, PriceTier, ProductFitment } from "../../../src/types";

const branches: Branch[] = [
  { id: "main", code: "MAIN", name: "الرئيسي", isMain: true, active: true, createdAt: "2026-01-01" },
  { id: "nasr", code: "BR-02", name: "مدينة نصر", isMain: false, active: true, createdAt: "2026-01-01" },
];

describe("Auto Parts Pro rules", () => {
  it("normalizes and validates VINs and recognizes supported WMIs", () => {
    expect(normalizeVin(" kmh-du46d19u123456 ")).toBe("KMHDU46D19U123456");
    expect(isValidVin("KMHDU46D19U123456")).toBe(true);
    expect(isValidVin("KMH-IU46D19U123456")).toBe(false);
    expect(inferMakeNameFromVin("KMHDU46D19U123456")).toBe("Hyundai");
    expect(inferMakeNameFromVin("LVVDB11B0CD123456")).toBe("Chery");
  });

  it("applies a price tier without ever crossing its minimum margin", () => {
    const product = { ...seedProducts[0]!, purchasePrice: 100, wholesalePrice: 140, retailPrice: 200 };
    const retailTier: PriceTier = {
      id: "retail-special",
      name: "ورشة",
      basis: "retail",
      adjustmentPct: -10,
      minMarginPct: 20,
      active: true,
      createdAt: "2026-01-01",
    };
    const belowFloorTier: PriceTier = { ...retailTier, basis: "cost", adjustmentPct: -50 };

    expect(calculateTierPrice(product, retailTier)).toBe(180);
    expect(calculateTierPrice(product, belowFloorTier)).toBe(120);
  });

  it("returns compatible, incompatible and unknown fitment states", () => {
    const vehicle: CustomerVehicle = {
      id: "vehicle-1",
      customerId: "customer-1",
      makeId: "hyundai",
      modelId: "tucson",
      generationId: "tl",
      engineId: "g4na",
      year: 2018,
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    };
    const fitments: ProductFitment[] = [{
      id: "fit-1",
      productId: "brake-pad",
      makeId: "hyundai",
      modelId: "tucson",
      generationId: "tl",
      yearFrom: 2016,
      yearTo: 2020,
      createdAt: "2026-01-01",
    }];

    expect(productVehicleFitmentStatus("brake-pad", vehicle, fitments)).toBe("compatible");
    expect(productVehicleFitmentStatus("brake-pad", { ...vehicle, modelId: "elantra" }, fitments)).toBe("incompatible");
    expect(productVehicleFitmentStatus("unmapped-product", vehicle, fitments)).toBe("unknown");
  });

  it("keeps branch allocations equal to global stock after increases and reductions", () => {
    const product = { ...seedProducts[0]!, id: "p1", quantity: 7 };
    const reduced = reconcileBranchStocks([
      { branchId: "main", productId: "p1", quantity: 2, updatedAt: "2026-01-01" },
      { branchId: "nasr", productId: "p1", quantity: 8, updatedAt: "2026-01-01" },
    ], [product], branches);

    expect(reduced.reduce((sum, row) => sum + row.quantity, 0)).toBe(7);
    expect(reduced.find((row) => row.branchId === "main")?.quantity).toBe(0);
    expect(reduced.find((row) => row.branchId === "nasr")?.quantity).toBe(7);

    const increased = reconcileBranchStocks(reduced, [{ ...product, quantity: 12 }], branches);
    expect(increased.reduce((sum, row) => sum + row.quantity, 0)).toBe(12);
    expect(increased.find((row) => row.branchId === "main")?.quantity).toBe(5);
  });
});
