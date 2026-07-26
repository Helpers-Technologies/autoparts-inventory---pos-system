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
    category: "فلاتر",
    purchasePrice: 90,
    retailPrice: 150,
    wholesalePrice: 120,
    quantity: 10,
    minStock: 5,
    unit: "قطعة",
    hasExpiry: false,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "p-2",
    code: "BRK-200",
    name: "تيل فرامل أمامى هيونداي إلنترا",
    partNumber: "58101-1RA00",
    partBrand: "Brembo",
    barcode: "6229876543210",
    category: "فرامل",
    purchasePrice: 300,
    retailPrice: 450,
    wholesalePrice: 380,
    quantity: 8,
    minStock: 2,
    unit: "طقم",
    hasExpiry: false,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "p-3",
    code: "ARCHIVED-001",
    name: "قطعة ملغاة",
    archived: true,
    category: "عام",
    purchasePrice: 50,
    retailPrice: 100,
    wholesalePrice: 80,
    quantity: 0,
    minStock: 0,
    unit: "قطعة",
    hasExpiry: false,
    createdAt: "2026-01-01T00:00:00.000Z",
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
