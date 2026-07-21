/**
 * Purchase invoice lifecycle integration tests.
 *
 * Exercises `settlePurchaseInvoiceReturn` in multi-step scenarios.
 * Unlike sales returns, purchase returns mutate the invoice lines and
 * recompute the total — these tests verify that invariant holds.
 *
 * TC-INT-FLOW-PUR-001 through TC-INT-FLOW-PUR-007
 */
import { describe, it, expect } from "vitest";
import { computeStatus, applyReturnToInvoiceLines, settlePurchaseInvoiceReturn } from "../../../src/store/_pure";
import type { PurchaseInvoice, InvoiceLine } from "../../../src/types";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeLine(id: string, productId: string, quantity: number, price: number): InvoiceLine {
  return { id, productId, productName: `Product ${productId}`, unit: "piece", quantity, price, subtotal: quantity * price };
}

function makeInvoice(overrides: Partial<PurchaseInvoice> = {}): PurchaseInvoice {
  const lines = overrides.lines ?? [makeLine("L1", "P1", 10, 30), makeLine("L2", "P2", 5, 60)];
  const total = overrides.total ?? lines.reduce((s, l) => s + l.subtotal, 0);
  const amountPaid = overrides.amountPaid ?? 0;
  return {
    id: "PUR-001",
    invoiceNumber: "PUR-001",
    date: "2026-05-28",
    supplierId: "S1",
    supplierName: "Test Supplier",
    lines,
    total,
    amountPaid,
    remaining: total - amountPaid,
    status: computeStatus(total, amountPaid),
    createdAt: "2026-05-28T10:00:00Z",
    ...overrides,
  };
}

function makeReturnLine(id: string, sourceLineId: string, productId: string, quantity: number, price: number) {
  return { id, sourceLineId, productId, productName: `Product ${productId}`, unit: "piece", quantity, price, subtotal: quantity * price };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Purchase Invoice Lifecycle — TC-INT-FLOW-PUR", () => {
  it("TC-INT-FLOW-PUR-001 — fully paid invoice has status 'paid' and remaining 0", () => {
    const inv = makeInvoice({ amountPaid: 600 }); // 10×30 + 5×60 = 600
    expect(inv.total).toBe(600);
    expect(inv.remaining).toBe(0);
    expect(inv.status).toBe("paid");
  });

  it("TC-INT-FLOW-PUR-002 — partial payment produces 'partial' status", () => {
    const inv = makeInvoice({ amountPaid: 200 });
    expect(inv.status).toBe("partial");
    expect(inv.remaining).toBe(400);
  });

  it("TC-INT-FLOW-PUR-003 — full line return recalculates total and zeroes out the returned line", () => {
    const inv = makeInvoice({ amountPaid: 600 });
    const ret = {
      lines: [makeReturnLine("R1", "L1", "P1", 10, 30)], // return all of L1
      total: 300,
    };
    const settled = settlePurchaseInvoiceReturn(inv, ret);

    // L1 fully returned — only L2 should remain
    expect(settled.lines).toHaveLength(1);
    expect(settled.lines[0].id).toBe("L2");
    expect(settled.lines[0].quantity).toBe(5);

    // Total drops to 5×60 = 300
    expect(settled.total).toBe(300);

    // amountPaid was 600, but effective total is now 300
    // amountPaid = min(300, 600) = 300, overpayment = 300
    expect(settled.amountPaid).toBe(300);
    expect(settled.overpayment).toBe(300);
    expect(settled.remaining).toBe(0);
    expect(settled.status).toBe("paid");
  });

  it("TC-INT-FLOW-PUR-004 — partial return reduces quantity and adjusts totals proportionally", () => {
    const inv = makeInvoice({ amountPaid: 300 }); // half paid
    const ret = {
      lines: [makeReturnLine("R1", "L1", "P1", 5, 30)], // return half of L1 (5 of 10)
      total: 150,
    };
    const settled = settlePurchaseInvoiceReturn(inv, ret);

    // L1 partial: 10 - 5 = 5 remain
    const l1 = settled.lines.find((l) => l.id === "L1")!;
    expect(l1.quantity).toBe(5);
    expect(l1.subtotal).toBe(150);

    // New total: 5×30 + 5×60 = 150 + 300 = 450
    expect(settled.total).toBe(450);

    // amountPaid was 300, new total 450 → amountPaid = min(450, 300) = 300
    expect(settled.amountPaid).toBe(300);
    expect(settled.remaining).toBe(150);
    expect(settled.status).toBe("partial");
  });

  it("TC-INT-FLOW-PUR-005 — return on unpaid invoice preserves overpayment = 0", () => {
    const inv = makeInvoice({ amountPaid: 0 }); // nothing paid
    const ret = {
      lines: [makeReturnLine("R1", "L2", "P2", 5, 60)], // return all of L2
      total: 300,
    };
    const settled = settlePurchaseInvoiceReturn(inv, ret);

    // Only L1 remains, total = 10×30 = 300
    expect(settled.total).toBe(300);
    expect(settled.amountPaid).toBe(0);
    expect(settled.remaining).toBe(300);
    expect(settled.status).toBe("unpaid");
    expect(settled.overpayment).toBeUndefined();
  });

  it("TC-INT-FLOW-PUR-006 — returning all lines drives total to 0 and status to 'paid'", () => {
    const inv = makeInvoice({ amountPaid: 600 });
    const ret = {
      lines: [
        makeReturnLine("R1", "L1", "P1", 10, 30),
        makeReturnLine("R2", "L2", "P2", 5, 60),
      ],
      total: 600,
    };
    const settled = settlePurchaseInvoiceReturn(inv, ret);

    expect(settled.lines).toHaveLength(0);
    expect(settled.total).toBe(0);
    expect(settled.amountPaid).toBe(0); // min(0, 600) = 0
    expect(settled.overpayment).toBe(600); // all paid becomes credit
    expect(settled.status).toBe("paid"); // computeStatus(0, 0) = "paid"
    expect(settled.remaining).toBe(0);
  });

  it("TC-INT-FLOW-PUR-007 — sequential returns compose: each call uses current settled state", () => {
    // Unlike sales, purchase returns DO update the total, enabling true sequential composition.
    const inv = makeInvoice({ amountPaid: 600 });

    // Return #1: return 5 of L1
    const settled1 = settlePurchaseInvoiceReturn(inv, {
      lines: [makeReturnLine("R1", "L1", "P1", 5, 30)],
      total: 150,
    });
    expect(settled1.total).toBe(450); // 5×30 + 5×60
    expect(settled1.amountPaid).toBe(450);
    expect(settled1.overpayment).toBe(150);
    expect(settled1.remaining).toBe(0);

    // Return #2: return all of L2 (from settled1 state)
    const settled2 = settlePurchaseInvoiceReturn(settled1, {
      lines: [makeReturnLine("R2", "L2", "P2", 5, 60)],
      total: 300,
    });
    expect(settled2.lines).toHaveLength(1);
    expect(settled2.lines[0].id).toBe("L1");
    expect(settled2.lines[0].quantity).toBe(5);
    expect(settled2.total).toBe(150); // only 5×30 remains
    // paidAndCredit = 450 (amountPaid) + 150 (overpayment) = 600
    // amountPaid = min(150, 600) = 150, overpayment = 450
    expect(settled2.amountPaid).toBe(150);
    expect(settled2.overpayment).toBe(450);
    expect(settled2.remaining).toBe(0);
    expect(settled2.status).toBe("paid");
  });
});

describe("Purchase return — applyReturnToInvoiceLines integration", () => {
  it("return exceeding line quantity clamps without going negative", () => {
    const lines = [makeLine("L1", "P1", 3, 50)];
    const returnLines = [makeReturnLine("R1", "L1", "P1", 999, 50)];
    const { lines: remaining, appliedTotal } = applyReturnToInvoiceLines(lines, returnLines);
    expect(remaining).toHaveLength(0); // fully consumed
    expect(appliedTotal).toBe(150); // only 3 × 50 actually applied
  });

  it("product-id matching without sourceLineId distributes across multiple lines of same product", () => {
    const lines = [makeLine("L1", "P1", 4, 20), makeLine("L2", "P1", 6, 20)];
    const returnLines = [
      { id: "R1", productId: "P1", productName: "P1", unit: "piece", quantity: 7, price: 20, subtotal: 140 },
    ];
    const { lines: remaining, appliedTotal } = applyReturnToInvoiceLines(lines, returnLines);
    // L1: 4 returned, fully consumed. L2: 7-4=3 returned, 3 remain.
    expect(remaining).toHaveLength(1);
    expect(remaining[0].quantity).toBe(3);
    expect(appliedTotal).toBe(140);
  });
});
