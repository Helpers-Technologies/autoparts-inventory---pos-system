import { describe, it, expect } from "vitest";
import {
  settleSalesInvoiceReturn,
  settlePurchaseInvoiceReturn,
  applyReturnToInvoiceLines,
} from "../../../src/store/_pure";
import type { SalesInvoice, PurchaseInvoice, InvoiceLine, ReturnLine } from "../../../src/types";

function makeSalesInvoice(overrides: Partial<SalesInvoice> = {}): SalesInvoice {
  return {
    id: "inv1",
    invoiceNumber: "SAL-0001",
    date: "2026-01-01",
    customerId: "c1",
    customerName: "Ahmad",
    lines: [],
    total: 1000,
    amountReceived: 0,
    remaining: 1000,
    paymentType: "cash",
    priceType: "retail",
    status: "unpaid",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makePurchaseInvoice(overrides: Partial<PurchaseInvoice> = {}): PurchaseInvoice {
  return {
    id: "pur1",
    invoiceNumber: "PUR-0001",
    date: "2026-01-01",
    supplierId: "s1",
    supplierName: "Supplier Co",
    lines: [],
    total: 1000,
    amountPaid: 0,
    remaining: 1000,
    status: "unpaid",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeLine(overrides: Partial<InvoiceLine> = {}): InvoiceLine {
  return {
    id: "l1",
    productId: "p1",
    productName: "Cola",
    unit: "carton",
    quantity: 10,
    price: 100,
    subtotal: 1000,
    ...overrides,
  };
}

function makeReturnLine(overrides: Partial<ReturnLine> = {}): ReturnLine {
  return {
    id: "rl1",
    productId: "p1",
    productName: "Cola",
    unit: "carton",
    quantity: 3,
    price: 100,
    subtotal: 300,
    ...overrides,
  };
}

describe("settleSalesInvoiceReturn", () => {
  describe("with refundCash = true", () => {
    it("refunds cash and rebalances — customer still owes the unreceived portion", () => {
      // total=1000, paid=600, return=400
      // effective total = 1000-400 = 600; refund = 400; net paid = 600-400 = 200; remaining = 600-200 = 400
      const invoice = makeSalesInvoice({ total: 1000, amountReceived: 600, remaining: 400 });
      const ret = { lines: [], total: 400, refundCash: true };
      const { invoice: next, cashRefund } = settleSalesInvoiceReturn(invoice, ret);
      expect(cashRefund).toBe(400);
      expect(next.amountReceived).toBe(200);
      expect(next.remaining).toBe(400);
      expect(next.status).toBe("partial");
    });

    it("caps cash refund at amount paid — remaining reflects new effective total", () => {
      // total=1000, paid=600, return=800
      // returnTotal capped at invoice.total = 800; cashRefund = min(800,600) = 600
      // effectiveTotal = 1000-800 = 200; net paid = 0; remaining = 200
      const invoice = makeSalesInvoice({ total: 1000, amountReceived: 600, remaining: 400 });
      const ret = { lines: [], total: 800, refundCash: true };
      const { cashRefund, invoice: next } = settleSalesInvoiceReturn(invoice, ret);
      expect(cashRefund).toBe(600);
      expect(next.amountReceived).toBe(0);
      expect(next.remaining).toBe(200);
      expect(next.status).toBe("unpaid");
    });

    it("also refunds from overpayment credit", () => {
      const invoice = makeSalesInvoice({ total: 1000, amountReceived: 1000, remaining: 0, overpayment: 200 });
      const ret = { lines: [], total: 500, refundCash: true };
      const { cashRefund } = settleSalesInvoiceReturn(invoice, ret);
      // paidAndCredit = 1000 + 200 = 1200; returnTotal=500; cashRefund = min(500, 1200) = 500
      expect(cashRefund).toBe(500);
    });
  });

  describe("with refundCash = false", () => {
    it("no cash refund — remaining drops but no money back", () => {
      const invoice = makeSalesInvoice({ total: 1000, amountReceived: 600, remaining: 400 });
      const ret = { lines: [], total: 400, refundCash: false };
      const { cashRefund, invoice: next } = settleSalesInvoiceReturn(invoice, ret);
      expect(cashRefund).toBe(0);
      // effective total now 600; received 600 → paid
      expect(next.status).toBe("paid");
      expect(next.remaining).toBe(0);
    });
  });

  describe("status transitions", () => {
    it("partial return on unpaid invoice stays unpaid if still owes money", () => {
      const invoice = makeSalesInvoice({ total: 1000, amountReceived: 0, remaining: 1000 });
      const ret = { lines: [], total: 300, refundCash: false };
      const { invoice: next } = settleSalesInvoiceReturn(invoice, ret);
      // effective total = 700; paid = 0 → unpaid
      expect(next.status).toBe("unpaid");
      expect(next.remaining).toBe(700);
    });

    it("full return with no prior payment marks invoice as paid (total→0)", () => {
      const invoice = makeSalesInvoice({ total: 1000, amountReceived: 0, remaining: 1000 });
      const ret = { lines: [], total: 1000, refundCash: false };
      const { invoice: next } = settleSalesInvoiceReturn(invoice, ret);
      expect(next.status).toBe("paid");
      expect(next.remaining).toBe(0);
    });

    it("clears paymentDueDate when remaining becomes zero", () => {
      const invoice = makeSalesInvoice({
        total: 1000, amountReceived: 600, remaining: 400,
        paymentDueDate: "2026-06-01",
      });
      const ret = { lines: [], total: 400, refundCash: false };
      const { invoice: next } = settleSalesInvoiceReturn(invoice, ret);
      expect(next.remaining).toBe(0);
      expect(next.paymentDueDate).toBeUndefined();
    });
  });

  it("return capped at invoice total — over-return is clipped", () => {
    const invoice = makeSalesInvoice({ total: 1000, amountReceived: 1000, remaining: 0 });
    const ret = { lines: [], total: 9999, refundCash: true };
    const { cashRefund, invoice: next } = settleSalesInvoiceReturn(invoice, ret);
    expect(cashRefund).toBe(1000); // capped at invoice total
    expect(next.status).toBe("paid");
  });
});

describe("settlePurchaseInvoiceReturn", () => {
  it("removes returned lines and recomputes totals", () => {
    const lines = [
      makeLine({ id: "l1", productId: "p1", quantity: 10, price: 50, subtotal: 500 }),
      makeLine({ id: "l2", productId: "p2", quantity: 5, price: 100, subtotal: 500 }),
    ];
    const invoice = makePurchaseInvoice({ lines, total: 1000, amountPaid: 600, remaining: 400 });
    const returnLines: ReturnLine[] = [
      makeReturnLine({ sourceLineId: "l1", productId: "p1", quantity: 5, price: 50, subtotal: 250 }),
    ];
    const result = settlePurchaseInvoiceReturn(invoice, { lines: returnLines, total: 250 });
    expect(result.total).toBe(750); // 1000 - 250
    // amountPaid capped at new total: min(750, 600) = 600; remaining = 150
    expect(result.amountPaid).toBe(600);
    expect(result.remaining).toBe(150);
    expect(result.status).toBe("partial");
  });

  it("caps amountPaid at new total when prior payment exceeds it", () => {
    const lines = [makeLine({ id: "l1", productId: "p1", quantity: 10, price: 100, subtotal: 1000 })];
    const invoice = makePurchaseInvoice({ lines, total: 1000, amountPaid: 1000, remaining: 0 });
    const returnLines: ReturnLine[] = [
      makeReturnLine({ sourceLineId: "l1", productId: "p1", quantity: 10, price: 100, subtotal: 1000 }),
    ];
    const result = settlePurchaseInvoiceReturn(invoice, { lines: returnLines, total: 1000 });
    expect(result.total).toBe(0);
    expect(result.amountPaid).toBe(0);
    expect(result.status).toBe("paid"); // total=0 → paid
    expect(result.overpayment).toBe(1000); // full payment becomes credit
  });
});

describe("applyReturnToInvoiceLines", () => {
  it("matches return by sourceLineId first, then by productId", () => {
    const lines: InvoiceLine[] = [
      makeLine({ id: "l1", productId: "p1", quantity: 10, price: 50, subtotal: 500 }),
      makeLine({ id: "l2", productId: "p1", quantity: 5, price: 50, subtotal: 250 }),
    ];
    // return uses sourceLineId=l1 → only l1 is affected
    const returns: ReturnLine[] = [
      makeReturnLine({ sourceLineId: "l1", productId: "p1", quantity: 3, price: 50, subtotal: 150 }),
    ];
    const { lines: next, appliedTotal } = applyReturnToInvoiceLines(lines, returns);
    expect(next.find((l) => l.id === "l1")!.quantity).toBe(7);
    expect(next.find((l) => l.id === "l2")!.quantity).toBe(5); // untouched
    expect(appliedTotal).toBe(150);
  });

  it("removes a line entirely when all its quantity is returned", () => {
    const lines: InvoiceLine[] = [makeLine({ id: "l1", quantity: 5, price: 100, subtotal: 500 })];
    const returns: ReturnLine[] = [
      makeReturnLine({ sourceLineId: "l1", quantity: 5, price: 100, subtotal: 500 }),
    ];
    const { lines: next } = applyReturnToInvoiceLines(lines, returns);
    expect(next).toHaveLength(0);
  });

  it("does not apply more than available quantity on a line", () => {
    const lines: InvoiceLine[] = [makeLine({ id: "l1", quantity: 3, price: 100, subtotal: 300 })];
    const returns: ReturnLine[] = [
      makeReturnLine({ sourceLineId: "l1", quantity: 99, price: 100, subtotal: 9900 }),
    ];
    const { lines: next, appliedTotal } = applyReturnToInvoiceLines(lines, returns);
    expect(next).toHaveLength(0);
    expect(appliedTotal).toBe(300); // capped at actual qty
  });

  it("empty returns leave lines unchanged", () => {
    const lines: InvoiceLine[] = [makeLine({ quantity: 10, subtotal: 1000 })];
    const { lines: next, total } = applyReturnToInvoiceLines(lines, []);
    expect(next).toHaveLength(1);
    expect(total).toBe(1000);
  });
});
