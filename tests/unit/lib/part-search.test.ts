import { describe, expect, it } from "vitest";
import type { Product } from "../../../src/types";
import {
  findProductByScan,
  findProductScanCandidates,
  normalizePartLookup,
  productMatchesSearch,
} from "../../../src/lib/partSearch";

const baseProduct: Product = {
  id: "p1",
  code: "1001",
  name: "فلتر زيت تويوتا كورولا",
  partNumber: "W 68/3",
  oemNumbers: ["90915-YZZJ1", "90915-10003"],
  partBrand: "MANN-FILTER",
  barcode: "6221234567890",
  category: "فلاتر",
  unit: "قطعة",
  purchasePrice: 100,
  wholesalePrice: 130,
  retailPrice: 150,
  quantity: 5,
  minStock: 1,
  hasExpiry: false,
  createdAt: "2026-01-01",
};

describe("auto-parts lookup", () => {
  it("normalizes separators commonly printed in part numbers", () => {
    expect(normalizePartLookup(" W-68 / 3 ")).toBe("w683");
  });

  it("prioritizes an exact barcode match", () => {
    const result = findProductByScan([baseProduct], " 6221234567890\r");
    expect(result?.product.id).toBe("p1");
    expect(result?.matchedBy).toBe("barcode");
  });

  it("finds a product by part number despite formatting differences", () => {
    const result = findProductByScan([baseProduct], "w-68/3");
    expect(result?.matchedBy).toBe("part-number");
  });

  it("finds a product by any OEM number", () => {
    const result = findProductByScan([baseProduct], "90915 yzzj1");
    expect(result?.matchedBy).toBe("oem");
  });

  it("returns every alternative sharing the same OEM number", () => {
    const alternative: Product = {
      ...baseProduct,
      id: "p2",
      code: "1002",
      partNumber: "OC-534",
      barcode: "6221234567891",
      partBrand: "MAHLE",
    };

    const matches = findProductScanCandidates(
      [baseProduct, alternative],
      "90915-YZZJ1",
    );

    expect(matches).toHaveLength(2);
    expect(matches.map((match) => match.product.id)).toEqual(["p1", "p2"]);
    expect(matches.every((match) => match.matchedBy === "oem")).toBe(true);
  });

  it("keeps barcode priority when another identifier has the same value", () => {
    const collidingPartNumber: Product = {
      ...baseProduct,
      id: "p2",
      code: "1002",
      partNumber: baseProduct.barcode,
      barcode: "6221234567891",
    };

    const matches = findProductScanCandidates(
      [baseProduct, collidingPartNumber],
      baseProduct.barcode!,
    );

    expect(matches).toHaveLength(1);
    expect(matches[0]?.product.id).toBe("p1");
    expect(matches[0]?.matchedBy).toBe("barcode");
  });

  it("searches brand, rack locator and all automotive identifiers", () => {
    const withRack = { ...baseProduct, rackLocation: "A-03-02" };
    expect(productMatchesSearch(withRack, "mann")).toBe(true);
    expect(productMatchesSearch(withRack, "A0302")).toBe(true);
    expect(productMatchesSearch(withRack, "10003")).toBe(true);
    expect(productMatchesSearch(withRack, "not-found")).toBe(false);
  });

  it("ignores archived products during a scan", () => {
    expect(findProductByScan([{ ...baseProduct, archived: true }], baseProduct.barcode!)).toBeUndefined();
  });
});
