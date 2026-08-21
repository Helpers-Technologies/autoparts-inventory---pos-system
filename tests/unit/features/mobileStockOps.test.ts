/**
 * Turning a phone's scan into a stock change.
 *
 * These are the rules that decide whether a shop's stock stays explainable
 * after a storeman walks the shelves with a scanner. Each one exists because
 * the obvious alternative corrupts stock quietly:
 *
 *  - an unknown scan is rejected, never applied to a near-match;
 *  - removing more than is on hand is refused rather than written down to
 *    zero, because the discrepancy is the useful information;
 *  - a count becomes a DELTA, so it leaves a movement explaining the change
 *    instead of overwriting a quantity with no trace.
 *
 * TC-MSTOCK-001 through TC-MSTOCK-008
 */
import { describe, it, expect } from "vitest";
import {
  MILLI,
  planStockOps,
  resultForChange,
  summarizeBatch,
  type MobileStockOp,
} from "../../../src/features/mobile/mobileStockOps";
import type { Product } from "../../../src/types";

function product(partial: Partial<Product> & { id: string; quantity: number }): Product {
  return {
    code: partial.id.toUpperCase(),
    name: `صنف ${partial.id}`,
    category: "فلاتر",
    unit: "قطعة",
    purchasePrice: 100,
    wholesalePrice: 130,
    retailPrice: 160,
    minStock: 5,
    hasExpiry: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  } as Product;
}

function op(partial: Partial<MobileStockOp> & { clientOpId: string; kind: MobileStockOp["kind"]; productId: string; quantity: number }): MobileStockOp {
  return {
    clientOpId: partial.clientOpId,
    kind: partial.kind,
    productId: partial.productId,
    quantityMilli: partial.quantity * MILLI,
    deviceLabel: partial.deviceLabel,
    actorName: partial.actorName,
    note: partial.note,
  };
}

const FILTER = product({ id: "prod-1", quantity: 10 });

describe("mobile stock operations — TC-MSTOCK", () => {
  it("TC-MSTOCK-001: an add raises stock by what was scanned", () => {
    const plan = planStockOps([op({ clientOpId: "a", kind: "add", productId: "prod-1", quantity: 6 })], [FILTER]);
    expect(plan.rejected).toEqual([]);
    expect(plan.changes[0].delta).toBe(6);
    expect(plan.changes[0].resultingQuantity).toBe(16);
  });

  it("TC-MSTOCK-002: a remove lowers it, when there is enough", () => {
    const plan = planStockOps([op({ clientOpId: "b", kind: "remove", productId: "prod-1", quantity: 4 })], [FILTER]);
    expect(plan.rejected).toEqual([]);
    expect(plan.changes[0].delta).toBe(-4);
    expect(plan.changes[0].resultingQuantity).toBe(6);
  });

  it("TC-MSTOCK-003: removing more than is on hand is refused, not clamped", () => {
    // Writing the stock to zero would destroy the very discrepancy that says
    // the system and the shelf disagree.
    const plan = planStockOps([op({ clientOpId: "c", kind: "remove", productId: "prod-1", quantity: 25 })], [FILTER]);
    expect(plan.changes).toEqual([]);
    expect(plan.rejected[0].status).toBe("rejected");
    expect(plan.rejected[0].rejectReason).toContain("10");
    expect(plan.rejected[0].rejectReason).toContain("جرد");
  });

  it("TC-MSTOCK-004: a count becomes the difference from what the system holds", () => {
    const up = planStockOps([op({ clientOpId: "d", kind: "count", productId: "prod-1", quantity: 14 })], [FILTER]);
    expect(up.changes[0].delta).toBe(4);
    expect(up.changes[0].resultingQuantity).toBe(14);

    const down = planStockOps([op({ clientOpId: "e", kind: "count", productId: "prod-1", quantity: 3 })], [FILTER]);
    expect(down.changes[0].delta).toBe(-7);
    expect(down.changes[0].resultingQuantity).toBe(3);

    // A shelf counted as empty is a real, and important, result.
    const empty = planStockOps([op({ clientOpId: "f", kind: "count", productId: "prod-1", quantity: 0 })], [FILTER]);
    expect(empty.changes[0].delta).toBe(-10);
    expect(empty.changes[0].resultingQuantity).toBe(0);
  });

  it("TC-MSTOCK-005: a count that agrees applies with no change", () => {
    const plan = planStockOps([op({ clientOpId: "g", kind: "count", productId: "prod-1", quantity: 10 })], [FILTER]);
    expect(plan.rejected).toEqual([]);
    expect(plan.changes[0].delta).toBe(0);
    expect(resultForChange(plan.changes[0])).toEqual({
      clientOpId: "g",
      status: "applied",
      appliedDeltaMilli: 0,
      resultingQuantityMilli: 10 * MILLI,
    });
  });

  it("TC-MSTOCK-006: an unknown part is rejected rather than guessed at", () => {
    const plan = planStockOps([op({ clientOpId: "h", kind: "add", productId: "ghost", quantity: 3 })], [FILTER]);
    expect(plan.changes).toEqual([]);
    expect(plan.rejected[0].rejectReason).toContain("مش موجود");
  });

  it("TC-MSTOCK-007: later operations on the same part see the earlier ones", () => {
    // A storeman scanning the same bin twice. Validating the second against
    // the ORIGINAL quantity would let a batch remove more than exists.
    const plan = planStockOps(
      [
        op({ clientOpId: "i1", kind: "remove", productId: "prod-1", quantity: 7 }),
        op({ clientOpId: "i2", kind: "remove", productId: "prod-1", quantity: 7 }),
      ],
      [FILTER],
    );
    expect(plan.changes).toHaveLength(1);
    expect(plan.changes[0].op.clientOpId).toBe("i1");
    expect(plan.rejected).toHaveLength(1);
    expect(plan.rejected[0].clientOpId).toBe("i2");
    // The refusal quotes what is actually left, not the opening quantity.
    expect(plan.rejected[0].resultingQuantityMilli).toBe(3 * MILLI);
  });

  it("TC-MSTOCK-008: the ledger entry names the phone and the person", () => {
    // Automatic is not the same as invisible: the owner has to be able to see
    // who changed stock and from where, and reverse it.
    const plan = planStockOps(
      [op({
        clientOpId: "j", kind: "add", productId: "prod-1", quantity: 2,
        deviceLabel: "هاتف المخزن", actorName: "أحمد", note: "توريد مورد",
      })],
      [FILTER],
    );
    expect(plan.changes[0].reason).toContain("هاتف المخزن");
    expect(plan.changes[0].reason).toContain("أحمد");
    expect(plan.changes[0].reason).toContain("توريد مورد");
    expect(summarizeBatch(plan)).toBe("1 عملية اتطبّقت");
  });
});
