import { describe, it, expect } from "vitest";
import { formatStockMovementReference } from "../../../src/lib/stockMovement";
import type { StockMovement, SalesInvoice, PurchaseInvoice, SalesReturn, PurchaseReturn } from "../../../src/types";

function makeMovement(overrides: Partial<StockMovement> = {}): StockMovement {
  return {
    id: "mv1",
    productId: "p1",
    productName: "Cola",
    type: "sale",
    quantity: 5,
    date: "2026-01-01",
    ...overrides,
  };
}

function makeSalesInvoice(id = "inv1", invoiceNumber = "SAL-0001"): SalesInvoice {
  return {
    id,
    invoiceNumber,
    date: "2026-01-01",
    customerId: "c1",
    customerName: "Customer",
    lines: [],
    total: 500,
    amountReceived: 500,
    remaining: 0,
    paymentType: "cash",
    priceType: "retail",
    status: "paid",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function makePurchaseInvoice(id = "pur1", invoiceNumber = "PUR-0001"): PurchaseInvoice {
  return {
    id,
    invoiceNumber,
    date: "2026-01-01",
    supplierId: "s1",
    supplierName: "Supplier",
    lines: [],
    total: 300,
    amountPaid: 300,
    remaining: 0,
    status: "paid",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function makeSalesReturn(id = "sr1", returnNumber = "SR-0001"): SalesReturn {
  return {
    id,
    returnNumber,
    date: "2026-01-01",
    originalInvoiceId: "inv1",
    originalInvoiceNumber: "SAL-0001",
    customerId: "c1",
    customerName: "Customer",
    lines: [],
    total: 100,
    refundCash: true,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function makePurchaseReturn(id = "pr1", returnNumber = "PR-0001"): PurchaseReturn {
  return {
    id,
    returnNumber,
    date: "2026-01-01",
    originalInvoiceId: "pur1",
    originalInvoiceNumber: "PUR-0001",
    supplierId: "s1",
    supplierName: "Supplier",
    lines: [],
    total: 50,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("formatStockMovementReference", () => {
  it("returns movement.reason when it is set (trumps everything)", () => {
    const mv = makeMovement({ reason: "تعديل يدوي", referenceId: "inv1" });
    const result = formatStockMovementReference(mv, {
      salesInvoices: [makeSalesInvoice("inv1")],
    });
    expect(result).toBe("تعديل يدوي");
  });

  it("returns '—' when reason is whitespace-only", () => {
    const mv = makeMovement({ reason: "   ", referenceId: undefined });
    expect(formatStockMovementReference(mv, {})).toBe("—");
  });

  it("returns '—' when there is no referenceId", () => {
    const mv = makeMovement({ reason: undefined, referenceId: undefined });
    expect(formatStockMovementReference(mv, {})).toBe("—");
  });

  describe("type = 'return'", () => {
    it("returns sales-return label when referenceId matches a SalesReturn", () => {
      const mv = makeMovement({ type: "return", referenceId: "sr1" });
      const result = formatStockMovementReference(mv, {
        salesReturns: [makeSalesReturn("sr1", "SR-0042")],
      });
      expect(result).toBe("مرتجع مبيعات SR-0042");
    });

    it("returns purchase-return label when referenceId matches a PurchaseReturn", () => {
      const mv = makeMovement({ type: "return", referenceId: "pr1" });
      const result = formatStockMovementReference(mv, {
        purchaseReturns: [makePurchaseReturn("pr1", "PR-0007")],
      });
      expect(result).toBe("مرتجع توريد PR-0007");
    });

    it("returns '—' when return id does not match any list", () => {
      const mv = makeMovement({ type: "return", referenceId: "unknown" });
      expect(formatStockMovementReference(mv, {})).toBe("—");
    });
  });

  describe("type = 'sale'", () => {
    it("returns sales-invoice label with number when invoice found", () => {
      const mv = makeMovement({ type: "sale", referenceId: "inv1" });
      const result = formatStockMovementReference(mv, {
        salesInvoices: [makeSalesInvoice("inv1", "SAL-0099")],
      });
      expect(result).toBe("فاتورة مبيعات SAL-0099");
    });

    it("returns generic label for 'sr_'-prefixed referenceId", () => {
      const mv = makeMovement({ type: "sale", referenceId: "sr_legacy123" });
      expect(formatStockMovementReference(mv, {})).toBe("مرتجع مبيعات");
    });

    it("returns generic label for 'sal_'-prefixed referenceId", () => {
      const mv = makeMovement({ type: "sale", referenceId: "sal_old456" });
      expect(formatStockMovementReference(mv, {})).toBe("فاتورة مبيعات");
    });

    it("works when referenceType = 'sale' (even if type is not 'sale')", () => {
      const mv = makeMovement({ type: "adjustment-in", referenceType: "sale", referenceId: "inv2" });
      const result = formatStockMovementReference(mv, {
        salesInvoices: [makeSalesInvoice("inv2", "SAL-0200")],
      });
      expect(result).toBe("فاتورة مبيعات SAL-0200");
    });
  });

  describe("type = 'purchase'", () => {
    it("returns purchase-invoice label with number when invoice found", () => {
      const mv = makeMovement({ type: "purchase", referenceId: "pur1" });
      const result = formatStockMovementReference(mv, {
        purchaseInvoices: [makePurchaseInvoice("pur1", "PUR-0012")],
      });
      expect(result).toBe("فاتورة مشتريات PUR-0012");
    });

    it("returns generic label for 'pr_'-prefixed referenceId", () => {
      const mv = makeMovement({ type: "purchase", referenceId: "pr_legacy" });
      expect(formatStockMovementReference(mv, {})).toBe("مرتجع توريد");
    });

    it("returns generic label for 'pur_'-prefixed referenceId", () => {
      const mv = makeMovement({ type: "purchase", referenceId: "pur_old" });
      expect(formatStockMovementReference(mv, {})).toBe("فاتورة مشتريات");
    });
  });

  it("returns '—' when referenceId does not match any known pattern", () => {
    const mv = makeMovement({ type: "adjustment-in", referenceId: "xyz999" });
    expect(formatStockMovementReference(mv, {})).toBe("—");
  });

  it("returns '—' for type=sale with unrecognized referenceId (no sr_/sal_ prefix, no matching invoice)", () => {
    const mv = makeMovement({ type: "sale", referenceId: "xyz_unknown" });
    expect(formatStockMovementReference(mv, {})).toBe("—");
  });

  it("returns '—' for type=purchase with unrecognized referenceId (no pr_/pur_ prefix, no matching invoice)", () => {
    const mv = makeMovement({ type: "purchase", referenceId: "xyz_unknown" });
    expect(formatStockMovementReference(mv, {})).toBe("—");
  });
});
