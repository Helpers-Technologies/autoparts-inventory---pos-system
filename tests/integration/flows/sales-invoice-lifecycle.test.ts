/**
 * Sales invoice lifecycle integration tests.
 *
 * Exercises the pure business-logic functions from src/store/_pure.ts in
 * realistic multi-step sequences that mirror how AppContext uses them.
 * No DB or Electron required — these tests verify the invariants that hold
 * across the entire lifecycle of a sales invoice from creation through returns.
 *
 * TC-INT-FLOW-SAL-001 through TC-INT-FLOW-SAL-007
 */
import { describe, it, expect } from "vitest";
import {
  computeStatus,
  applyPieceDeduction,
  applyPieceAddition,
  applyReturnToInvoiceLines,
  settleSalesInvoiceReturn,
} from "../../../src/store/_pure";
import type { SalesInvoice, InvoiceLine, Product } from "../../../src/types";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeLine(
  id: string,
  productId: string,
  quantity: number,
  price: number
): InvoiceLine {
  return {
    id,
    productId,
    productName: `Product ${productId}`,
    unit: "piece",
    quantity,
    price,
    subtotal: quantity * price,
  };
}

function makeInvoice(overrides: Partial<SalesInvoice> = {}): SalesInvoice {
  const lines = overrides.lines ?? [makeLine("L1", "P1", 3, 50), makeLine("L2", "P2", 2, 80)];
  const total = overrides.total ?? lines.reduce((s, l) => s + l.subtotal, 0);
  const amountReceived = overrides.amountReceived ?? 0;
  return {
    id: "INV-001",
    invoiceNumber: "INV-001",
    date: "2026-05-28",
    customerId: "C1",
    customerName: "Test Customer",
    lines,
    total,
    amountReceived,
    remaining: total - amountReceived,
    paymentType: "account",
    priceType: "retail",
    status: computeStatus(total, amountReceived),
    createdAt: "2026-05-28T10:00:00Z",
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Sales Invoice Lifecycle — TC-INT-FLOW-SAL", () => {
  it("TC-INT-FLOW-SAL-001 — unpaid invoice: status is 'unpaid', remaining equals total", () => {
    const inv = makeInvoice({ amountReceived: 0 });
    expect(inv.status).toBe("unpaid");
    expect(inv.remaining).toBe(310);
    expect(computeStatus(inv.total, inv.amountReceived)).toBe("unpaid");
  });

  it("TC-INT-FLOW-SAL-002 — partial payment: status is 'partial', remaining decreases", () => {
    const inv = makeInvoice({ amountReceived: 150 });
    expect(inv.status).toBe("partial");
    expect(inv.remaining).toBe(160);
    expect(computeStatus(inv.total, inv.amountReceived)).toBe("partial");
  });

  it("TC-INT-FLOW-SAL-003 — full payment: status is 'paid', remaining is 0", () => {
    const inv = makeInvoice({ amountReceived: 310 });
    expect(inv.status).toBe("paid");
    expect(inv.remaining).toBe(0);
  });

  it("TC-INT-FLOW-SAL-004 — full return with refundCash=true resets invoice to paid with no remaining", () => {
    const inv = makeInvoice({ amountReceived: 310 });
    const ret = {
      lines: [makeLine("R1", "P1", 3, 50), makeLine("R2", "P2", 2, 80)],
      total: 310,
      refundCash: true,
    };
    const { invoice: settled, cashRefund } = settleSalesInvoiceReturn(inv, ret);
    expect(cashRefund).toBe(310);
    expect(settled.remaining).toBe(0);
    expect(settled.amountReceived).toBe(0);
    expect(settled.status).toBe("paid"); // effectiveTotal = 0 → paid
  });

  it("TC-INT-FLOW-SAL-005 — partial return refund is capped at amount already paid", () => {
    // Invoice: total=310, paid=100 (partial). Return=150 with cash refund.
    // Cash refund cannot exceed paid (100), so refund = 100.
    // effectiveTotal = max(0, 310-150) = 160.
    // paidAndCreditAfterReturn = max(0, 100-100) = 0.
    // amountReceived = min(160, 0) = 0 → remaining = 160, status = "unpaid".
    const inv = makeInvoice({ amountReceived: 100 });
    const ret = {
      lines: [makeLine("R1", "P1", 3, 50)], // 3 × 50 = 150
      total: 150,
      refundCash: true,
    };
    const { invoice: settled, cashRefund } = settleSalesInvoiceReturn(inv, ret);
    expect(cashRefund).toBe(100); // capped at what was paid
    expect(settled.total).toBe(310); // original total is preserved — returns are separate records
    expect(settled.status).toBe("unpaid");
    expect(settled.remaining).toBe(160);
    expect(settled.amountReceived).toBe(0);
  });

  it("TC-INT-FLOW-SAL-006 — return without cash refund: balance stays, remaining recomputed", () => {
    const inv = makeInvoice({ amountReceived: 150 });
    const ret = {
      lines: [makeLine("R1", "P1", 3, 50)], // 150 worth of goods
      total: 150,
      refundCash: false,
    };
    const { invoice: settled, cashRefund } = settleSalesInvoiceReturn(inv, ret);
    expect(cashRefund).toBe(0);
    // effectiveTotal = max(0, 310-150) = 160
    // amountReceived = min(160, 150) = 150
    // remaining = 160 - 150 = 10
    expect(settled.remaining).toBe(10);
    expect(settled.amountReceived).toBe(150);
    expect(settled.status).toBe("partial");
  });

  it("TC-INT-FLOW-SAL-007 — each settleSalesInvoiceReturn call uses original total, not cumulative", () => {
    // Design invariant: `invoice.total` is never mutated. Each return call computes
    // effectiveTotal = max(0, invoice.total - thisReturn.total). AppContext handles
    // cumulative tracking externally (by summing all SalesReturn records).
    // This test documents that invariant so regressions are caught.
    const inv = makeInvoice({ amountReceived: 310 });

    const ret1 = { lines: [makeLine("R1", "P1", 3, 50)], total: 150, refundCash: true };
    const { invoice: after1, cashRefund: refund1 } = settleSalesInvoiceReturn(inv, ret1);
    expect(refund1).toBe(150);
    expect(after1.total).toBe(310); // total never changes
    expect(after1.amountReceived).toBe(160); // 310 - 150 refund
    expect(after1.remaining).toBe(0);
    expect(after1.status).toBe("paid"); // effectiveTotal=160, amountReceived=160

    // Second return: effectiveTotal = max(0, 310-160) = 150 (still uses the ORIGINAL total!)
    // paidAndCredit = after1.amountReceived = 160; cashRefund = min(160, 160) = 160;
    // paidAndCreditAfterReturn = 0; amountReceived = 0; remaining = 150.
    const ret2 = { lines: [makeLine("R2", "P2", 2, 80)], total: 160, refundCash: true };
    const { invoice: after2, cashRefund: refund2 } = settleSalesInvoiceReturn(after1, ret2);
    expect(refund2).toBe(160);
    expect(after2.total).toBe(310); // original total still unchanged
    expect(after2.remaining).toBe(150); // effectiveTotal=150, amountReceived=0
    expect(after2.status).toBe("unpaid");
  });
});

describe("Line-item return distribution — TC-INT-FLOW-SAL-LINES", () => {
  it("returns matched by sourceLineId reduce only the targeted line", () => {
    const lines = [makeLine("L1", "P1", 5, 20), makeLine("L2", "P2", 3, 30)];
    const returnLines = [
      { id: "R1", sourceLineId: "L1", productId: "P1", productName: "P1", unit: "piece", quantity: 2, price: 20, subtotal: 40 },
    ];
    const { lines: remaining, total, appliedTotal } = applyReturnToInvoiceLines(lines, returnLines);
    expect(remaining).toHaveLength(2);
    const l1 = remaining.find((l) => l.id === "L1")!;
    expect(l1.quantity).toBe(3);
    expect(l1.subtotal).toBe(60);
    const l2 = remaining.find((l) => l.id === "L2")!;
    expect(l2.quantity).toBe(3);
    expect(total).toBe(3 * 20 + 3 * 30);
    expect(appliedTotal).toBe(40);
  });

  it("returns matched by productId (no sourceLineId) consume across lines in order", () => {
    const lines = [makeLine("L1", "P1", 4, 10), makeLine("L2", "P1", 2, 10)];
    const returnLines = [
      { id: "R1", productId: "P1", productName: "P1", unit: "piece", quantity: 5, price: 10, subtotal: 50 },
    ];
    const { lines: remaining, appliedTotal } = applyReturnToInvoiceLines(lines, returnLines);
    // L1 fully returned (4), L2 partially (1 returned, 1 stays)
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe("L2");
    expect(remaining[0].quantity).toBe(1);
    expect(appliedTotal).toBe(50);
  });

  it("return quantity exceeding available is clamped — no negative quantities", () => {
    const lines = [makeLine("L1", "P1", 3, 10)];
    const returnLines = [
      { id: "R1", sourceLineId: "L1", productId: "P1", productName: "P1", unit: "piece", quantity: 99, price: 10, subtotal: 990 },
    ];
    const { lines: remaining, appliedTotal } = applyReturnToInvoiceLines(lines, returnLines);
    expect(remaining).toHaveLength(0); // all consumed
    expect(appliedTotal).toBe(30); // only 3 × 10 actually applied
  });
});

describe("Piece arithmetic — TC-INT-FLOW-PIECE", () => {
  const product: Product = {
    id: "P1",
    code: "P1",
    name: "Cola",
    category: "Beverages",
    unit: "carton",
    purchasePrice: 100,
    wholesalePrice: 120,
    retailPrice: 150,
    piecesPerUnit: 24,
    quantity: 5,
    looseQuantity: 6,
    minStock: 1,
    hasExpiry: false,
    createdAt: "2026-01-01T00:00:00Z",
  };

  it("deduction from loose stock does not open new cartons", () => {
    const result = applyPieceDeduction(product, 4);
    expect(result.quantity).toBe(5); // no carton opened
    expect(result.looseQuantity).toBe(2); // 6 - 4
  });

  it("deduction exceeding loose stock opens the minimum number of cartons", () => {
    const result = applyPieceDeduction(product, 10); // needs 10-6=4 more, opens 1 carton
    expect(result.quantity).toBe(4); // 5 - 1
    expect(result.looseQuantity).toBe(20); // 24 - 4
  });

  it("deduction of exactly piecesPerUnit leaves looseQuantity at 0", () => {
    const result = applyPieceDeduction({ ...product, looseQuantity: 0 }, 24);
    expect(result.quantity).toBe(4);
    expect(result.looseQuantity).toBe(0);
  });

  it("addition fills loose up and folds full cartons into quantity", () => {
    const result = applyPieceAddition(product, 20); // 6 + 20 = 26 → 1 carton + 2 loose
    expect(result.quantity).toBe(6); // 5 + 1
    expect(result.looseQuantity).toBe(2);
  });

  it("addition of exactly piecesPerUnit increments quantity by 1 with 0 loose", () => {
    const result = applyPieceAddition({ ...product, looseQuantity: 0 }, 24);
    expect(result.quantity).toBe(6);
    expect(result.looseQuantity).toBe(0);
  });

  it("round-trip: deduct then add back restores original state", () => {
    const piecesToMove = 18;
    const after = applyPieceDeduction(product, piecesToMove);
    const restored = applyPieceAddition(
      { ...product, quantity: after.quantity!, looseQuantity: after.looseQuantity! },
      piecesToMove
    );
    const totalBefore = product.quantity * product.piecesPerUnit! + product.looseQuantity!;
    const totalAfter = restored.quantity! * product.piecesPerUnit! + restored.looseQuantity!;
    expect(totalAfter).toBe(totalBefore);
  });
});
