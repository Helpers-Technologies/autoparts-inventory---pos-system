import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { applyPieceDeduction, applyPieceAddition } from "../../../src/store/_pure";
import type { Product } from "../../../src/types";

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: "p1",
    code: "P-001",
    name: "Cola",
    category: "Drinks",
    unit: "carton",
    purchasePrice: 10,
    wholesalePrice: 15,
    retailPrice: 20,
    quantity: 10,
    looseQuantity: 0,
    piecesPerUnit: 24,
    minStock: 2,
    hasExpiry: false,
    createdAt: "2026-01-01",
    ...overrides,
  };
}

describe("applyPieceDeduction", () => {
  describe("when loose stock covers the requested pieces", () => {
    it("consumes only loose stock — carton count unchanged", () => {
      const p = makeProduct({ quantity: 10, looseQuantity: 12, piecesPerUnit: 24 });
      const result = applyPieceDeduction(p, 5);
      expect(result.quantity).toBe(10);
      expect(result.looseQuantity).toBe(7);
    });

    it("exact match: loose exactly equals pieces requested", () => {
      const p = makeProduct({ quantity: 5, looseQuantity: 24, piecesPerUnit: 24 });
      const result = applyPieceDeduction(p, 24);
      expect(result.quantity).toBe(5);
      expect(result.looseQuantity).toBe(0);
    });
  });

  describe("when loose stock is insufficient — cartons must be opened", () => {
    it("opens one carton when loose is zero and pieces < ppu", () => {
      const p = makeProduct({ quantity: 5, looseQuantity: 0, piecesPerUnit: 24 });
      const result = applyPieceDeduction(p, 10);
      expect(result.quantity).toBe(4);
      expect(result.looseQuantity).toBe(14); // 24 opened - 10 taken
    });

    it("opens the minimum number of cartons needed (ceiling division)", () => {
      const p = makeProduct({ quantity: 10, looseQuantity: 2, piecesPerUnit: 24 });
      // needs 25 pieces, has 2 loose → needs 23 more → ceil(23/24) = 1 carton
      const result = applyPieceDeduction(p, 25);
      expect(result.quantity).toBe(9);
      expect(result.looseQuantity).toBe(1); // 24 - 23 = 1 remaining
    });

    it("opens two cartons when needed exceeds one ppu", () => {
      const p = makeProduct({ quantity: 5, looseQuantity: 0, piecesPerUnit: 12 });
      // 25 pieces, loose=0 → ceil(25/12) = 3 cartons
      const result = applyPieceDeduction(p, 25);
      expect(result.quantity).toBe(2);
      expect(result.looseQuantity).toBe(11); // 3*12 - 25 = 11
    });

    it("does not allow negative carton quantity (floors at zero)", () => {
      const p = makeProduct({ quantity: 1, looseQuantity: 0, piecesPerUnit: 24 });
      // requesting 50 pieces needs ceil(50/24)=3 cartons but only 1 carton in stock
      const result = applyPieceDeduction(p, 50);
      expect(result.quantity).toBe(0);
    });
  });

  it("roundtrip: deduct then add returns original state (property)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 48 }),  // piecesPerUnit
        fc.integer({ min: 0, max: 20 }),  // initial cartons
        fc.integer({ min: 0, max: 47 }),  // initial loose (< ppu)
        fc.integer({ min: 1, max: 24 }),  // pieces to deduct
        (ppu, qty, loose, pieces) => {
          if (pieces > loose) {
            const needed = pieces - loose;
            const cartonsNeeded = Math.ceil(needed / ppu);
            if (cartonsNeeded > qty) return true; // would floor at 0, skip this case
          }
          const p = makeProduct({ piecesPerUnit: ppu, quantity: qty, looseQuantity: loose });
          const after = applyPieceDeduction(p, pieces);
          const restored = applyPieceAddition(
            { ...p, ...after },
            pieces,
          );
          // total piece count must be conserved
          const beforeTotal = qty * ppu + loose;
          const afterTotal = (restored.quantity ?? 0) * ppu + (restored.looseQuantity ?? 0);
          return beforeTotal === afterTotal;
        },
      ),
    );
  });
});

describe("applyPieceAddition", () => {
  it("accumulates loose pieces below one full carton", () => {
    const p = makeProduct({ quantity: 5, looseQuantity: 10, piecesPerUnit: 24 });
    const result = applyPieceAddition(p, 8);
    expect(result.quantity).toBe(5);
    expect(result.looseQuantity).toBe(18);
  });

  it("rolls over a full carton when loose + pieces >= ppu", () => {
    const p = makeProduct({ quantity: 5, looseQuantity: 20, piecesPerUnit: 24 });
    const result = applyPieceAddition(p, 10);
    // newLoose = 30, fullCartons = 1, leftover = 6
    expect(result.quantity).toBe(6);
    expect(result.looseQuantity).toBe(6);
  });

  it("rolls over multiple cartons at once", () => {
    const p = makeProduct({ quantity: 3, looseQuantity: 0, piecesPerUnit: 10 });
    const result = applyPieceAddition(p, 35);
    expect(result.quantity).toBe(6);
    expect(result.looseQuantity).toBe(5);
  });

  it("exact multiples produce zero loose remainder", () => {
    const p = makeProduct({ quantity: 2, looseQuantity: 0, piecesPerUnit: 12 });
    const result = applyPieceAddition(p, 24);
    expect(result.quantity).toBe(4);
    expect(result.looseQuantity).toBe(0);
  });

  it("works with looseQuantity undefined (treats as 0)", () => {
    const p = makeProduct({ quantity: 5, looseQuantity: undefined, piecesPerUnit: 24 });
    const result = applyPieceAddition(p, 24);
    expect(result.quantity).toBe(6);
    expect(result.looseQuantity).toBe(0);
  });
});

describe("applyPieceDeduction — undefined looseQuantity fallback", () => {
  it("treats undefined looseQuantity as 0 and opens cartons from the start", () => {
    const p = makeProduct({ quantity: 5, looseQuantity: undefined, piecesPerUnit: 24 });
    const result = applyPieceDeduction(p, 10); // needs 10 pieces, no loose → open 1 carton (24 pieces), use 10, leave 14
    expect(result.quantity).toBe(4); // 5 - 1 carton opened
    expect(result.looseQuantity).toBe(14); // 24 - 10
  });
});
