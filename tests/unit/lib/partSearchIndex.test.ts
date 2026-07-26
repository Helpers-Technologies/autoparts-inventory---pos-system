import { describe, it, expect } from "vitest";
import { buildProductSearchIndex } from "../../../src/lib/partSearchIndex";
import type { Product } from "../../../src/types";

const mockProducts: Product[] = [
  {
    id: "p-1",
    code: "OIL-100",
    name: "فلتر زيت تويوتا كورولا",
    partNumber: "90915-YZZE1",
    oemNumbers: ["90915YZZE1", "15400-PLM-A01"],
    barcode: "6221234567890",
    retailPrice: 150,
    wholesalePrice: 120,
    minStock: 5,
    unit: "قطعة",
  },
  {
    id: "p-2",
    code: "BRK-200",
    name: "تيل فرامل أمامى هيونداي إلنترا",
    partNumber: "58101-1RA00",
    partBrand: "Brembo",
    barcode: "6229876543210",
    retailPrice: 450,
    wholesalePrice: 380,
    minStock: 2,
    unit: "طقم",
  },
  {
    id: "p-3",
    code: "ARCHIVED-001",
    name: "قطعة ملغاة",
    archived: true,
    retailPrice: 100,
    wholesalePrice: 80,
    minStock: 0,
    unit: "قطعة",
  },
];

describe("ProductSearchIndex", () => {
  it("returns all non-archived products when query is empty", () => {
    const index = buildProductSearchIndex(mockProducts);
    const results = index.search("", mockProducts);
    expect(results).toHaveLength(2);
    expect(results.map((p) => p.id)).toEqual(["p-1", "p-2"]);
  });

  it("finds products by internal code", () => {
    const index = buildProductSearchIndex(mockProducts);
    const results = index.search("OIL-100", mockProducts);
    expect(results).toHaveLength(1);
    expect(results[0].id).toEqual("p-1");
  });

  it("finds products by part number or normalized OEM number", () => {
    const index = buildProductSearchIndex(mockProducts);
    const results = index.search("90915YZZE1", mockProducts);
    expect(results).toHaveLength(1);
    expect(results[0].id).toEqual("p-1");
  });

  it("finds products by Arabic name keywords", () => {
    const index = buildProductSearchIndex(mockProducts);
    const results = index.search("فرامل", mockProducts);
    expect(results).toHaveLength(1);
    expect(results[0].id).toEqual("p-2");
  });

  it("finds products by brand name", () => {
    const index = buildProductSearchIndex(mockProducts);
    const results = index.search("Brembo", mockProducts);
    expect(results).toHaveLength(1);
    expect(results[0].id).toEqual("p-2");
  });
});
