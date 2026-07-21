import { describe, it, expect } from "vitest";
import { findProductByBarcode, normalizeBarcode } from "../../../src/lib/barcode";
import type { Product } from "../../../src/types";

function makeProduct(partial: Partial<Product> & { id: string }): Product {
  return {
    code: "C-" + partial.id,
    name: "product-" + partial.id,
    category: "cat",
    unit: "كرتونة",
    purchasePrice: 0,
    wholesalePrice: 0,
    retailPrice: 0,
    quantity: 0,
    minStock: 0,
    hasExpiry: false,
    createdAt: "2026-01-01",
    ...partial,
  };
}

describe("normalizeBarcode", () => {
  it("trims surrounding whitespace and carriage returns", () => {
    expect(normalizeBarcode("  6224000123456 ")).toBe("6224000123456");
    expect(normalizeBarcode("6224000123456\r")).toBe("6224000123456");
  });

  it("returns an empty string for whitespace-only input", () => {
    expect(normalizeBarcode("   ")).toBe("");
  });
});

describe("findProductByBarcode", () => {
  const products = [
    makeProduct({ id: "1", barcode: "6224000111111" }),
    makeProduct({ id: "2", barcode: "6224000222222" }),
    makeProduct({ id: "3" }), // no barcode
    makeProduct({ id: "4", barcode: "ABC123" }),
  ];

  it("finds a product by exact barcode", () => {
    expect(findProductByBarcode(products, "6224000222222")?.id).toBe("2");
  });

  it("matches after trimming the scanned code (scanner appends CR/whitespace)", () => {
    expect(findProductByBarcode(products, "  6224000111111\r")?.id).toBe("1");
  });

  it("matches when the stored barcode has stray whitespace", () => {
    const list = [makeProduct({ id: "x", barcode: " 999 " })];
    expect(findProductByBarcode(list, "999")?.id).toBe("x");
  });

  it("returns undefined for an empty or whitespace code", () => {
    expect(findProductByBarcode(products, "")).toBeUndefined();
    expect(findProductByBarcode(products, "   ")).toBeUndefined();
  });

  it("returns undefined when no product carries the code", () => {
    expect(findProductByBarcode(products, "0000000000000")).toBeUndefined();
  });

  it("ignores products that have no barcode", () => {
    // An empty scanned code must not match the barcode-less product (id 3).
    expect(findProductByBarcode(products, "")).toBeUndefined();
    expect(findProductByBarcode([makeProduct({ id: "3" })], "")).toBeUndefined();
  });

  it("is case-insensitive for alphanumeric codes", () => {
    expect(findProductByBarcode(products, "abc123")?.id).toBe("4");
    expect(findProductByBarcode(products, "ABC123")?.id).toBe("4");
  });

  it("returns the first product when duplicates share a barcode", () => {
    const dupes = [
      makeProduct({ id: "a", barcode: "555" }),
      makeProduct({ id: "b", barcode: "555" }),
    ];
    expect(findProductByBarcode(dupes, "555")?.id).toBe("a");
  });
});
