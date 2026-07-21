/**
 * Cash balance invariants — fixes V2-B01/02/03/04/07
 *
 * Verifies the arithmetic formulas behind the cash-related fixes
 * without mounting AppProvider. Each suite corresponds to one FIX:
 *
 * FIX-V2-02 — delete invoice uses filter-only (no reversal entry)
 * FIX-V2-03 — updateSalesInvoice emits a cash delta entry
 * FIX-V2-04 — recordPurchasePayment tracks overpayment
 * FIX-V2-07 — cancelSalesInvoice: cash vs credit modes
 *
 * TC-INT-CASH-001 through TC-INT-CASH-020
 */
import { describe, it, expect } from "vitest";
import { computeStatus } from "../../../src/store/_pure";
import type { CashEntry, SalesInvoice, PurchaseInvoice } from "../../../src/types";

// ── Helpers ────────────────────────────────────────────────────────────────────

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

function netBalance(entries: CashEntry[]): number {
  return entries.reduce((s, e) => s + e.amount, 0);
}

function makeSalesInvoice(overrides: Partial<SalesInvoice> = {}): SalesInvoice {
  const total = overrides.total ?? 1000;
  const amountReceived = overrides.amountReceived ?? 0;
  return {
    id: "inv-1",
    invoiceNumber: "INV-0001",
    date: "2026-06-01",
    customerId: "c1",
    customerName: "عميل تجريبي",
    lines: [],
    total,
    amountReceived,
    remaining: Math.max(0, total - amountReceived),
    status: computeStatus(total, amountReceived),
    paymentType: "account",
    priceType: "retail",
    createdAt: "2026-06-01T00:00:00Z",
    ...overrides,
  };
}

function makePurchaseInvoice(overrides: Partial<PurchaseInvoice> = {}): PurchaseInvoice {
  const total = overrides.total ?? 1000;
  const amountPaid = overrides.amountPaid ?? 0;
  return {
    id: "pur-1",
    invoiceNumber: "PUR-0001",
    date: "2026-06-01",
    supplierId: "s1",
    supplierName: "مورد تجريبي",
    lines: [],
    total,
    amountPaid,
    remaining: Math.max(0, total - amountPaid),
    status: computeStatus(total, amountPaid),
    createdAt: "2026-06-01T00:00:00Z",
    ...overrides,
  };
}

function makeReceiptEntry(invoiceId: string, amount: number): CashEntry {
  return {
    id: uid("ce"),
    type: "sales-receipt",
    amount,
    referenceId: invoiceId,
    date: "2026-06-01",
  };
}

function makePaymentEntry(invoiceId: string, amount: number): CashEntry {
  return {
    id: uid("ce"),
    type: "purchase-payment",
    amount: -amount,
    referenceId: invoiceId,
    date: "2026-06-01",
  };
}

// ── FIX-V2-02 — Delete uses filter-only (no extra reversal entry) ──────────────

describe("FIX-V2-02 — Delete invoice cash: filter-only, no reversal", () => {
  it("TC-INT-CASH-001 — cashbox is zero after deleting fully-paid sales invoice", () => {
    const inv = makeSalesInvoice({ amountReceived: 1000 });
    const entries: CashEntry[] = [makeReceiptEntry(inv.id, 1000)];
    expect(netBalance(entries)).toBe(1000);

    // simulate deleteSalesInvoice: filter only
    const afterDelete = entries.filter((e) => e.referenceId !== inv.id);
    expect(afterDelete).toHaveLength(0);
    expect(netBalance(afterDelete)).toBe(0);
  });

  it("TC-INT-CASH-002 — cashbox is zero after deleting partially-paid invoice (500 of 1000)", () => {
    const inv = makeSalesInvoice({ amountReceived: 500 });
    const entries: CashEntry[] = [makeReceiptEntry(inv.id, 500)];
    expect(netBalance(entries)).toBe(500);

    const afterDelete = entries.filter((e) => e.referenceId !== inv.id);
    expect(netBalance(afterDelete)).toBe(0);
  });

  it("TC-INT-CASH-003 — cashbox is zero after deleting invoice with recordSalesReceipt payment", () => {
    const inv = makeSalesInvoice({ amountReceived: 300 });
    // initial receipt 200 + subsequent payment 100
    const entries: CashEntry[] = [
      makeReceiptEntry(inv.id, 200),
      makeReceiptEntry(inv.id, 100),
    ];
    expect(netBalance(entries)).toBe(300);

    const afterDelete = entries.filter((e) => e.referenceId !== inv.id);
    expect(netBalance(afterDelete)).toBe(0);
  });

  it("TC-INT-CASH-004 — OLD reversal approach produces double-movement (documents the bug)", () => {
    const inv = makeSalesInvoice({ amountReceived: 1000 });
    const entries: CashEntry[] = [makeReceiptEntry(inv.id, 1000)];

    // Simulate the BROKEN old behavior: add reversal THEN filter
    const withReversal: CashEntry[] = [
      { id: uid("rev"), type: "adjustment", amount: -1000, referenceId: undefined, date: "2026-06-01" },
      ...entries,
    ];
    const afterBrokenDelete = withReversal.filter((e) => e.referenceId !== inv.id);
    // The reversal had no referenceId so it stayed → balance is now -1000, not 0
    expect(netBalance(afterBrokenDelete)).toBe(-1000);
  });

  it("TC-INT-CASH-005 — delete purchase invoice: filter-only restores balance to zero", () => {
    const inv = makePurchaseInvoice({ amountPaid: 800 });
    const entries: CashEntry[] = [makePaymentEntry(inv.id, 800)];
    expect(netBalance(entries)).toBe(-800);

    const afterDelete = entries.filter((e) => e.referenceId !== inv.id);
    expect(netBalance(afterDelete)).toBe(0);
  });
});

// ── FIX-V2-03 — updateSalesInvoice emits cash delta ───────────────────────────

describe("FIX-V2-03 — updateSalesInvoice cash delta", () => {
  function computeCashDelta(
    inv: SalesInvoice,
    newAmountReceived: number,
    newTotal: number
  ): number {
    const cappedReceived = Math.min(newAmountReceived, newTotal);
    const newOverpayment = Math.max(0, newAmountReceived - newTotal);
    const prevCash = inv.amountReceived + (inv.overpayment ?? 0);
    const nextCash = cappedReceived + newOverpayment;
    return nextCash - prevCash;
  }

  it("TC-INT-CASH-006 — zero → 400: delta is +400 (sales-receipt entry)", () => {
    const inv = makeSalesInvoice({ total: 1000, amountReceived: 0 });
    const delta = computeCashDelta(inv, 400, 1000);
    expect(delta).toBe(400);
  });

  it("TC-INT-CASH-007 — 400 → 100: delta is −300 (adjustment entry)", () => {
    const inv = makeSalesInvoice({ total: 1000, amountReceived: 400 });
    const delta = computeCashDelta(inv, 100, 1000);
    expect(delta).toBe(-300);
  });

  it("TC-INT-CASH-008 — no change to amountReceived: delta is 0 (no entry)", () => {
    const inv = makeSalesInvoice({ total: 1000, amountReceived: 400 });
    const delta = computeCashDelta(inv, 400, 1000);
    expect(delta).toBe(0);
  });

  it("TC-INT-CASH-009 — overpayment invoice: prevCash includes overpayment", () => {
    // Invoice paid 1200 on total 1000 → amountReceived=1000, overpayment=200
    const inv = makeSalesInvoice({ total: 1000, amountReceived: 1000, overpayment: 200 });
    // Edit: amountReceived changes to 800 (delta = 800 - 1200 = -400)
    const delta = computeCashDelta(inv, 800, 1000);
    expect(delta).toBe(-400);
  });

  it("TC-INT-CASH-010 — net balance after create+edit remains correct", () => {
    const inv = makeSalesInvoice({ total: 1000, amountReceived: 0 });
    const entries: CashEntry[] = [];

    // Step 1: create invoice with amountReceived=0 → no entry
    // Step 2: recordSalesReceipt 600
    entries.push(makeReceiptEntry(inv.id, 600));
    expect(netBalance(entries)).toBe(600);

    // Step 3: edit amountReceived 600→800 → delta +200
    const editedInv = { ...inv, amountReceived: 600 };
    const delta = computeCashDelta(editedInv, 800, 1000);
    expect(delta).toBe(200);
    entries.push({ id: uid("edit"), type: "sales-receipt", amount: delta, referenceId: inv.id, date: "2026-06-02" });
    expect(netBalance(entries)).toBe(800);
  });
});

// ── FIX-V2-04 — recordPurchasePayment overpayment ─────────────────────────────

describe("FIX-V2-04 — recordPurchasePayment overpayment tracking", () => {
  function applyPayment(inv: PurchaseInvoice, amount: number) {
    const cappedAmount = Math.min(amount, inv.remaining);
    const excess = amount - cappedAmount;
    const paid = inv.amountPaid + cappedAmount;
    return {
      ...inv,
      amountPaid: paid,
      remaining: Math.max(0, inv.total - paid),
      status: computeStatus(inv.total, paid),
      overpayment: excess > 0 ? (inv.overpayment ?? 0) + excess : inv.overpayment,
    };
  }

  it("TC-INT-CASH-011 — exact payment: remaining=0, no overpayment", () => {
    const inv = makePurchaseInvoice({ total: 1000, amountPaid: 0, remaining: 1000 });
    const updated = applyPayment(inv, 1000);
    expect(updated.amountPaid).toBe(1000);
    expect(updated.remaining).toBe(0);
    expect(updated.overpayment).toBeUndefined();
    expect(updated.status).toBe("paid");
  });

  it("TC-INT-CASH-012 — overpayment 200 on 1000: overpayment=300 (existing 200 remaining was 200 → excess=300)", () => {
    const inv = makePurchaseInvoice({ total: 1000, amountPaid: 800, remaining: 200 });
    const updated = applyPayment(inv, 500); // pay 500 but only 200 remaining
    expect(updated.amountPaid).toBe(1000);
    expect(updated.remaining).toBe(0);
    expect(updated.overpayment).toBe(300); // 500 - 200 = 300
    expect(updated.status).toBe("paid");
  });

  it("TC-INT-CASH-013 — cashbox still deducts full amount even with overpayment", () => {
    const inv = makePurchaseInvoice({ total: 1000, amountPaid: 800, remaining: 200 });
    const entries: CashEntry[] = [makePaymentEntry(inv.id, 800)];
    expect(netBalance(entries)).toBe(-800);

    // Payment of 500 (200 applied + 300 excess)
    entries.push(makePaymentEntry(inv.id, 500));
    expect(netBalance(entries)).toBe(-1300); // full 500 deducted from cashbox
  });

  it("TC-INT-CASH-014 — multiple payments accumulate overpayment correctly", () => {
    let inv = makePurchaseInvoice({ total: 500, amountPaid: 0, remaining: 500 });
    inv = applyPayment(inv, 300); // pays 300 of 500
    expect(inv.overpayment).toBeUndefined();
    inv = applyPayment(inv, 400); // pays remaining 200, excess 200
    expect(inv.overpayment).toBe(200);
    expect(inv.remaining).toBe(0);
    expect(inv.status).toBe("paid");
  });
});

// ── FIX-V2-07 — cancelSalesInvoice: cash vs credit modes ──────────────────────

describe("FIX-V2-07 — cancelSalesInvoice refund policy", () => {
  function simulateCancelCash(
    inv: SalesInvoice,
    entries: CashEntry[]
  ): { entries: CashEntry[]; invoice: SalesInvoice } {
    const totalCollected = inv.amountReceived + (inv.overpayment ?? 0);
    const newEntries = totalCollected > 0
      ? [
          ...entries,
          {
            id: uid("cancel"),
            type: "adjustment" as const,
            amount: -totalCollected,
            referenceId: inv.id,
            date: "2026-06-02",
          },
        ]
      : [...entries];
    return {
      entries: newEntries,
      // matches the store: a cash refund returns ALL collected money, so the
      // cancelled invoice must keep no received amount or credit.
      invoice: { ...inv, cancelled: true, amountReceived: 0, overpayment: undefined },
    };
  }

  function simulateCancelCredit(
    inv: SalesInvoice,
    entries: CashEntry[]
  ): { entries: CashEntry[]; invoice: SalesInvoice } {
    const totalCollected = inv.amountReceived + (inv.overpayment ?? 0);
    return {
      entries: [...entries], // no cash movement
      invoice: {
        ...inv,
        cancelled: true,
        amountReceived: 0,
        overpayment: totalCollected > 0 ? totalCollected : undefined,
      },
    };
  }

  function customerCredit(invoices: SalesInvoice[], customerId: string): number {
    return invoices
      .filter((s) => s.customerId === customerId)
      .reduce((a, s) => a + (s.overpayment ?? 0), 0);
  }

  it("TC-INT-CASH-015 — cash mode: cashbox decreases by totalCollected", () => {
    const inv = makeSalesInvoice({ total: 1000, amountReceived: 1000 });
    const entries: CashEntry[] = [makeReceiptEntry(inv.id, 1000)];
    expect(netBalance(entries)).toBe(1000);

    const { entries: after } = simulateCancelCash(inv, entries);
    expect(netBalance(after)).toBe(0); // +1000 receipt −1000 reversal
  });

  it("TC-INT-CASH-016 — cash mode with overpayment: reversal covers full totalCollected", () => {
    const inv = makeSalesInvoice({ total: 1000, amountReceived: 1000, overpayment: 200 });
    const entries: CashEntry[] = [
      makeReceiptEntry(inv.id, 1000),
      makeReceiptEntry(inv.id, 200),
    ];
    expect(netBalance(entries)).toBe(1200);

    const { entries: after } = simulateCancelCash(inv, entries);
    expect(netBalance(after)).toBe(0); // 1200 − 1200 = 0
  });

  it("TC-INT-CASH-017 — credit mode: cashbox unchanged, overpayment set on cancelled invoice", () => {
    const inv = makeSalesInvoice({ total: 1000, amountReceived: 1000 });
    const entries: CashEntry[] = [makeReceiptEntry(inv.id, 1000)];
    expect(netBalance(entries)).toBe(1000);

    const { entries: after, invoice: cancelled } = simulateCancelCredit(inv, entries);
    expect(netBalance(after)).toBe(1000); // no cash movement
    expect(cancelled.cancelled).toBe(true);
    expect(cancelled.amountReceived).toBe(0);
    expect(cancelled.overpayment).toBe(1000);
  });

  it("TC-INT-CASH-018 — credit mode: customerCredit includes cancelled invoice overpayment", () => {
    const inv = makeSalesInvoice({ total: 1000, amountReceived: 1000 });
    const entries: CashEntry[] = [makeReceiptEntry(inv.id, 1000)];
    const { invoice: cancelled } = simulateCancelCredit(inv, entries);

    const invoices = [cancelled];
    expect(customerCredit(invoices, "c1")).toBe(1000);
  });

  it("TC-INT-CASH-019 — no collection: cancel without refund mode, no cash movement", () => {
    const inv = makeSalesInvoice({ total: 1000, amountReceived: 0 });
    const entries: CashEntry[] = [];
    const { entries: after } = simulateCancelCash(inv, entries);
    expect(netBalance(after)).toBe(0);
    expect(after).toHaveLength(0);
  });

  it("TC-INT-CASH-020 — settleAllDues: cancelled invoice with overpayment settles open target", () => {
    // Simulate settleAllDues logic with cancelled source
    const cancelledSrc: SalesInvoice = {
      ...makeSalesInvoice({ id: "inv-cancelled", total: 1000, amountReceived: 0 }),
      cancelled: true,
      overpayment: 800,
    };
    const openTarget: SalesInvoice = {
      ...makeSalesInvoice({ id: "inv-open", invoiceNumber: "INV-0002", total: 600, amountReceived: 0 }),
      remaining: 600,
    };

    // sources: all invoices with overpayment (including cancelled)
    const allInvoices = [cancelledSrc, openTarget];
    const sources = allInvoices.filter((inv) => (inv.overpayment ?? 0) > 0);
    const targets = allInvoices.filter((inv) => !inv.cancelled && inv.remaining > 0);

    expect(sources).toHaveLength(1);
    expect(targets).toHaveLength(1);

    // Apply settlement
    let creditPool = sources.reduce((sum, s) => sum + (s.overpayment ?? 0), 0);
    let totalSettled = 0;
    const apply = Math.min(creditPool, targets[0].remaining);
    totalSettled += apply;
    creditPool -= apply;

    expect(totalSettled).toBe(600);
    expect(creditPool).toBe(200); // 800 - 600 remaining
  });

  it("TC-INT-CASH-021 — cash mode with overpayment leaves NO phantom credit", () => {
    // Paid 1200 on total 1000 (received=1000, overpayment=200), then cancelled
    // with a cash refund → all 1200 returned. The invoice must keep no credit,
    // otherwise customerCredit / the statement shows a phantom 200.
    const inv = makeSalesInvoice({ total: 1000, amountReceived: 1000, overpayment: 200 });
    const entries: CashEntry[] = [makeReceiptEntry(inv.id, 1000), makeReceiptEntry(inv.id, 200)];
    const { entries: after, invoice: cancelled } = simulateCancelCash(inv, entries);

    expect(netBalance(after)).toBe(0); // 1200 collected − 1200 refunded
    expect(cancelled.amountReceived).toBe(0);
    expect(cancelled.overpayment).toBeUndefined();
    expect(customerCredit([cancelled], "c1")).toBe(0); // no phantom credit
  });
});
