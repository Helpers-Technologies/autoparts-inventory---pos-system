import { describe, it, expect } from "vitest";
import { applyPieceDeduction } from "../../../src/store/_pure";
import type { Product } from "../../../src/types";

/**
 * سيناريو السؤال: منتج عنده 10 كراتين + 20 قطعة سايبة، الكرتونة فيها 24 قطعة،
 * بسعر جملة 300 (للكرتونة) وسعر تجزئة 15 (للقطعة).
 *
 * الاختبار بيتأكد من 4 حاجات زي ما السيستم بيعملها بالظبط:
 *  1) شكل العرض في كارت المنتج          → ProductDetailsDrawer.tsx:45-48
 *  2) السعر اللي بيتطبق (جملة/تجزئة)     → SalesInvoiceNewPage.tsx:192-195
 *  3) المتاح للبيع                       → SalesInvoiceNewPage.tsx:182-184
 *  4) خصم المخزون بعد البيع              → AppContext.tsx:1439-1443 (يستخدم applyPieceDeduction)
 */
function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: "p1",
    code: "P-001",
    name: "Cola",
    category: "Drinks",
    unit: "كرتونة",
    retailUnit: "قطعة",
    purchasePrice: 200,
    wholesalePrice: 300,
    retailPrice: 15,
    quantity: 10,
    looseQuantity: 20,
    piecesPerUnit: 24,
    minStock: 2,
    hasExpiry: false,
    createdAt: "2026-01-01",
    ...overrides,
  };
}

// نسخة طبق الأصل من تعبير "الكمية الحالية" في ProductDetailsDrawer.tsx:45-48
function formatStock(p: Product): string {
  return p.piecesPerUnit
    ? `${p.quantity} ${p.unit}${p.looseQuantity ? ` + ${p.looseQuantity} ${p.retailUnit ?? "قطعة"}` : ""}`
    : `${p.quantity} ${p.unit}`;
}

// نسخة طبق الأصل من productPrice() في SalesInvoiceNewPage.tsx:192-195
function productPrice(p: Product, priceType: "wholesale" | "retail"): number {
  if (priceType === "retail" && p.piecesPerUnit) return p.retailPrice;
  return priceType === "retail" ? p.retailPrice : p.wholesalePrice;
}

// نسخة طبق الأصل من حساب "المتاح" في SalesInvoiceNewPage.tsx:182-184
function availableForSale(p: Product, isRetailLine: boolean): number {
  return isRetailLine ? p.quantity * p.piecesPerUnit! + (p.looseQuantity ?? 0) : p.quantity;
}

// محاكاة فرع خصم المخزون عند حفظ فاتورة بيع — AppContext.tsx:1439-1443
function applySaleToStock(p: Product, soldQty: number, isRetailUnit: boolean): Product {
  if (isRetailUnit && p.piecesPerUnit) {
    return { ...p, ...applyPieceDeduction(p, soldQty) };
  }
  return { ...p, quantity: Math.max(0, p.quantity - soldQty) };
}

describe("10 كراتين + 20 قطعة — جملة وتجزئة", () => {
  describe("1) العرض في السيستم", () => {
    it("يظهر '10 كرتونة + 20 قطعة' في كارت المنتج", () => {
      expect(formatStock(makeProduct())).toBe("10 كرتونة + 20 قطعة");
    });

    it("لو القطع السايبة = 0 يظهر '10 كرتونة' بس", () => {
      expect(formatStock(makeProduct({ looseQuantity: 0 }))).toBe("10 كرتونة");
    });

    it("منتج من غير نظام قطع يظهر بالوحدة بس", () => {
      const p = makeProduct({ piecesPerUnit: undefined, retailUnit: undefined, quantity: 7 });
      expect(formatStock(p)).toBe("7 كرتونة");
    });
  });

  describe("2) السعر اللي بيتطبق", () => {
    it("جملة → سعر الكرتونة (300)", () => {
      expect(productPrice(makeProduct(), "wholesale")).toBe(300);
    });

    it("تجزئة → سعر القطعة (15)", () => {
      expect(productPrice(makeProduct(), "retail")).toBe(15);
    });
  });

  describe("3) المتاح للبيع", () => {
    it("جملة → 10 كراتين", () => {
      expect(availableForSale(makeProduct(), false)).toBe(10);
    });

    it("تجزئة → 10×24 + 20 = 260 قطعة", () => {
      expect(availableForSale(makeProduct(), true)).toBe(260);
    });
  });

  describe("4) خصم المخزون بعد البيع", () => {
    it("بيع 3 كراتين جملة → 7 كرتونة + 20 قطعة (القطع متتغيرش)", () => {
      const after = applySaleToStock(makeProduct(), 3, false);
      expect(after.quantity).toBe(7);
      expect(after.looseQuantity).toBe(20);
      expect(formatStock(after)).toBe("7 كرتونة + 20 قطعة");
    });

    it("بيع 5 قطع تجزئة (السايب يكفي) → 10 كرتونة + 15 قطعة", () => {
      const after = applySaleToStock(makeProduct(), 5, true);
      expect(after.quantity).toBe(10);
      expect(after.looseQuantity).toBe(15);
    });

    it("بيع 20 قطعة تجزئة (= السايب بالظبط) → 10 كرتونة بس", () => {
      const after = applySaleToStock(makeProduct(), 20, true);
      expect(after.quantity).toBe(10);
      expect(after.looseQuantity).toBe(0);
      expect(formatStock(after)).toBe("10 كرتونة");
    });

    it("بيع 50 قطعة تجزئة (السايب مايكفيش → يفتح كراتين) → 8 كرتونة + 18 قطعة", () => {
      const after = applySaleToStock(makeProduct(), 50, true);
      expect(after.quantity).toBe(8);
      expect(after.looseQuantity).toBe(18);
      // إجمالي القطع اتحفظ: 260 − 50 = 210 = 8×24 + 18
      expect(after.quantity * after.piecesPerUnit! + (after.looseQuantity ?? 0)).toBe(210);
    });

    it("بيع كل المخزون تجزئة (260 قطعة) → 0 رصيد", () => {
      const after = applySaleToStock(makeProduct(), 260, true);
      expect(after.quantity).toBe(0);
      expect(after.looseQuantity).toBe(0);
    });
  });

  describe("5) قيمة سطر الفاتورة (الكمية × السعر)", () => {
    it("3 كراتين جملة → 3 × 300 = 900", () => {
      const p = makeProduct();
      expect(3 * productPrice(p, "wholesale")).toBe(900);
    });

    it("50 قطعة تجزئة → 50 × 15 = 750", () => {
      const p = makeProduct();
      expect(50 * productPrice(p, "retail")).toBe(750);
    });
  });
});
