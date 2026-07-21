// @vitest-environment jsdom
/**
 * SYSTEM PROBE TESTS — full-stack store probes through the real AppProvider.
 *
 * Originally written for Reports V2/09-Full-System-Test-Report-2026-06-11.md
 * as `it.fails` defect probes. All BUG-xx defects they documented are now
 * FIXED, so they run as permanent regression tests.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { webcrypto } from "node:crypto";
import { AppProvider, useApp } from "../../../src/store/AppContext";
import type { InvoiceLine, Product } from "../../../src/types";
import { lsClearAll } from "../../../src/lib/storage";
import { hashPassword } from "../../../src/lib/auth";

// jsdom lacks SubtleCrypto — hashPassword needs it for the fallback login used
// by the audit-restore probes (logAudit only records when a user is signed in)
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto });
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <AppProvider>{children}</AppProvider>
);

function mountStore() {
  return renderHook(() => useApp(), { wrapper });
}

function makeLine(productId: string, quantity: number, price: number, extra: Partial<InvoiceLine> = {}): InvoiceLine {
  return {
    id: `L-${Math.random().toString(36).slice(2)}`,
    productId,
    productName: `P:${productId}`,
    unit: "كرتونة",
    quantity,
    price,
    subtotal: quantity * price,
    ...extra,
  };
}

const baseProduct = (over: Partial<Omit<Product, "id" | "createdAt">> = {}) => ({
  code: "",
  name: "منتج اختبار",
  category: "اختبار",
  unit: "كرتونة",
  purchasePrice: 50,
  wholesalePrice: 65,
  retailPrice: 75,
  quantity: 100,
  looseQuantity: 0,
  minStock: 5,
  hasExpiry: false,
  archived: false,
  ...over,
});

beforeEach(() => {
  localStorage.clear();
  lsClearAll();
});

afterEach(() => cleanup());

// ── P01/P02/P03: bulk add (CSV import path) ──────────────────────────────────

describe("PROBE-A — bulk catalog inserts (ImportPage path)", () => {
  it("P01 [BUG-01 fixed]: two addProduct calls inside ONE event handler get DISTINCT codes", () => {
    const { result } = mountStore();
    let c1 = "", c2 = "";
    act(() => {
      c1 = result.current.addProduct(baseProduct({ name: "A" })).code;
      c2 = result.current.addProduct(baseProduct({ name: "B" })).code;
    });
    expect(c1).not.toBe(c2); // duplicate codes = broken product identity
  });

  it("P02 [BUG-01 fixed]: an explicitly provided product code (CSV file code) is respected", () => {
    const { result } = mountStore();
    let code = "";
    act(() => {
      code = result.current.addProduct(baseProduct({ name: "X", code: "P001" })).code;
    });
    expect(code).toBe("P001"); // ImportPage dedup relies on this
  });

  it("P03 [BUG-01 fixed]: two addCustomer calls inside ONE event handler get DISTINCT codes", () => {
    const { result } = mountStore();
    let c1: string | undefined, c2: string | undefined;
    act(() => {
      c1 = result.current.addCustomer({ name: "عميل 1", archived: false }).code;
      c2 = result.current.addCustomer({ name: "عميل 2", archived: false }).code;
    });
    expect(c1).not.toBe(c2);
  });
});

// ── P04: delete a sales invoice that already has a return ────────────────────

describe("PROBE-B — delete sales invoice after a partial return", () => {
  function runScenario() {
    const { result } = mountStore();
    let prodId = "", invId = "";
    act(() => { prodId = result.current.addProduct(baseProduct({ quantity: 100 })).id; });
    const openingCash = result.current.currentCashBalance();
    act(() => {
      invId = result.current.addSalesInvoice({
        invoiceNumber: "INV-PB-1",
        date: "2026-06-01",
        customerId: "CUST-PB",
        customerName: "عميل",
        lines: [makeLine(prodId, 10, 50)],
        total: 500,
        amountReceived: 500,
        paymentType: "cash",
        priceType: "wholesale",
      }).id;
    });
    act(() => {
      result.current.addSalesReturn({
        date: "2026-06-02",
        originalInvoiceId: invId,
        originalInvoiceNumber: "INV-PB-1",
        customerId: "CUST-PB",
        customerName: "عميل",
        lines: [{ id: "RL1", sourceLineId: undefined, productId: prodId, productName: "x", unit: "كرتونة", quantity: 3, price: 50, subtotal: 150 }],
        total: 150,
        refundCash: true,
      });
    });
    return { result, prodId, invId, openingCash };
  }

  it("P04a [BUG-03 fixed]: deleting an invoice that has returns is blocked", () => {
    const { result, prodId, invId } = runScenario();
    let ok = true;
    act(() => { ok = result.current.deleteSalesInvoice(invId); });
    expect(ok).toBe(false);
    expect(result.current.salesInvoices.some((i) => i.id === invId)).toBe(true);
    // stock stays at the post-return level — no phantom restoration
    expect(result.current.products.find((p) => p.id === prodId)?.quantity).toBe(93);
  });

  it("P04b [BUG-03 fixed]: the blocked delete leaves the cashbox untouched", () => {
    const { result, invId, openingCash } = runScenario();
    act(() => { result.current.deleteSalesInvoice(invId); });
    // received 500, refunded 150 — both must survive the blocked delete
    expect(result.current.currentCashBalance()).toBe(openingCash + 350);
  });
});

// ── P05: manual cash entry payment method ────────────────────────────────────

describe("PROBE-C — cashbox manual entry", () => {
  it("P05 [BUG-06 fixed]: addCashEntry persists the paymentMethod chosen in CashboxPage", () => {
    const { result } = mountStore();
    act(() => {
      result.current.addCashEntry({
        id: "cash_probe_1",
        type: "manual-add",
        amount: 250,
        description: "إيداع بنكي",
        date: "2026-06-11",
        paymentMethod: "bank",
      });
    });
    const entry = result.current.cashEntries.find((c) => c.id === "cash_probe_1");
    expect(entry?.paymentMethod).toBe("bank");
  });
});

// ── P06: product referenced by a draft quotation ─────────────────────────────

describe("PROBE-D — referential integrity for quotations", () => {
  it("P06 [BUG-07 fixed]: deleting a product referenced by a draft quotation is blocked", () => {
    const { result } = mountStore();
    let prodId = "";
    act(() => { prodId = result.current.addProduct(baseProduct()).id; });
    act(() => {
      result.current.addQuotation({
        quotationNumber: "Q-PD-1",
        date: "2026-06-10",
        customerId: "CUST-PD",
        customerName: "عميل عرض",
        lines: [makeLine(prodId, 5, 65)],
        total: 325,
      });
    });
    let deleted = false;
    act(() => { deleted = result.current.deleteProduct(prodId); });
    // deleting must be blocked (like invoices) or the quotation will convert
    // into an invoice that silently skips the stock deduction
    expect(deleted).toBe(false);
  });
});

// ── P07: employee monthly stats date boundaries ───────────────────────────────

describe("PROBE-E — employeeSalesStats month boundaries (TZ-sensitive)", () => {
  it("P07 [BUG-04 fixed]: a receipt collected on Dec 31 is counted inside December of the same year", () => {
    const { result } = mountStore();
    let userId = "";
    act(() => {
      userId = result.current.addUser({
        name: "مندوب", username: "rep1", passwordHash: "h", role: "employee",
        permissions: undefined as never, salesCommissionPct: 10, monthlySalary: 3000,
      }).id;
    });
    act(() => {
      result.current.addSalesInvoice({
        invoiceNumber: "INV-PE-1",
        date: "2026-12-31",
        customerId: "CUST-PE",
        customerName: "عميل",
        lines: [makeLine("ghost-product", 1, 1000)],
        total: 1000,
        amountReceived: 1000,
        paymentType: "cash",
        priceType: "wholesale",
        createdByUserId: userId,
      });
    });
    const stats = result.current.employeeSalesStats(userId, "2026-12");
    expect(stats.totalCollected).toBe(1000);
  });
});

// ── P07b: paying the balance after a return must settle to zero ───────────────

describe("PROBE-RET — pay after return reaches zero (not the returned amount)", () => {
  it("sales: 1000 invoice, paid 600, return 250, then pay 150 → remaining 0, paid", () => {
    const { result } = mountStore();
    let pid = "";
    act(() => { pid = result.current.addProduct(baseProduct({ name: "ريت-بيع", quantity: 1000 })).id; });
    let invId = "";
    act(() => {
      invId = result.current.addSalesInvoice({
        invoiceNumber: "INV-RET-S", date: "2026-06-01",
        customerId: "C-RET", customerName: "عميل",
        lines: [makeLine(pid, 100, 10)], total: 1000, amountReceived: 600,
        paymentType: "account", priceType: "wholesale",
      }).id;
    });
    act(() => {
      result.current.addSalesReturn({
        originalInvoiceId: invId, originalInvoiceNumber: "INV-RET-S",
        customerId: "C-RET", customerName: "عميل", date: "2026-06-02",
        lines: [makeLine(pid, 25, 10)], total: 250, refundCash: false,
      });
    });
    expect(result.current.salesInvoices.find((s) => s.id === invId)!.remaining).toBe(150);
    act(() => { result.current.recordSalesReceipt(invId, 150); });
    const inv = result.current.salesInvoices.find((s) => s.id === invId)!;
    expect(inv.remaining).toBe(0);
    expect(inv.status).toBe("paid");
  });

  it("purchase: 1000 invoice, paid 600, return 250, then pay 150 → remaining 0, paid", () => {
    const { result } = mountStore();
    let pid = "";
    act(() => { pid = result.current.addProduct(baseProduct({ name: "ريت-شرا", quantity: 1000 })).id; });
    let invId = "";
    act(() => {
      invId = result.current.addPurchaseInvoice({
        invoiceNumber: "PO-RET", date: "2026-06-01",
        supplierId: "S-RET", supplierName: "مورد",
        lines: [makeLine(pid, 100, 10)], total: 1000, amountPaid: 600,
      }).id;
    });
    act(() => {
      result.current.addPurchaseReturn({
        originalInvoiceId: invId, originalInvoiceNumber: "PO-RET",
        supplierId: "S-RET", supplierName: "مورد", date: "2026-06-02",
        lines: [makeLine(pid, 25, 10)], total: 250,
      });
    });
    expect(result.current.purchaseInvoices.find((p) => p.id === invId)!.remaining).toBe(150);
    act(() => { result.current.recordPurchasePayment(invId, 150); });
    const inv = result.current.purchaseInvoices.find((p) => p.id === invId)!;
    expect(inv.remaining).toBe(0);
    expect(inv.status).toBe("paid");
  });
});

// ── P08/P09/P10: dues, credits & settlement (control group) ──────────────────

describe("PROBE-F — customer dues / credit lifecycle", () => {
  it("P08: settleAllDues moves overpayment credit to the oldest unpaid invoice", () => {
    const { result } = mountStore();
    let inv1 = "";
    act(() => {
      inv1 = result.current.addSalesInvoice({
        invoiceNumber: "INV-PF-1", date: "2026-01-01",
        customerId: "CUST-PF", customerName: "عميل",
        lines: [makeLine("g1", 1, 100)], total: 100, amountReceived: 0,
        paymentType: "account", priceType: "wholesale",
      }).id;
    });
    act(() => {
      result.current.addSalesInvoice({
        invoiceNumber: "INV-PF-2", date: "2026-02-01",
        customerId: "CUST-PF", customerName: "عميل",
        lines: [makeLine("g2", 1, 100)], total: 100,
        amountReceived: 100, overpayment: 30,
        paymentType: "cash", priceType: "wholesale",
      });
    });
    let settled = 0;
    act(() => { settled = result.current.settleAllDues("CUST-PF"); });
    expect(settled).toBe(30);
    const i1 = result.current.salesInvoices.find((i) => i.id === inv1)!;
    expect(i1.amountReceived).toBe(30);
    expect(i1.remaining).toBe(70);
    expect(result.current.customerCredit("CUST-PF")).toBe(0);
  });

  it("P09: overpaying a receipt produces credit, full cash in, consistent balance", () => {
    const { result } = mountStore();
    let invId = "";
    const opening = mountCash(result);
    act(() => {
      invId = result.current.addSalesInvoice({
        invoiceNumber: "INV-PF-3", date: "2026-06-01",
        customerId: "CUST-PF9", customerName: "عميل",
        lines: [makeLine("g3", 1, 100)], total: 100, amountReceived: 0,
        paymentType: "account", priceType: "wholesale",
      }).id;
    });
    act(() => { result.current.recordSalesReceipt(invId, 130); });
    const inv = result.current.salesInvoices.find((i) => i.id === invId)!;
    expect(inv.amountReceived).toBe(100);
    expect(inv.status).toBe("paid");
    expect(inv.overpayment).toBe(30);
    expect(result.current.customerCredit("CUST-PF9")).toBe(30);
    expect(result.current.customerBalance("CUST-PF9")).toBe(-30);
    expect(result.current.currentCashBalance()).toBe(opening + 130);
  });

  it("P10: cancel-with-credit then settle uses the credit on a later invoice", () => {
    const { result } = mountStore();
    let invA = "", invB = "";
    act(() => {
      invA = result.current.addSalesInvoice({
        invoiceNumber: "INV-PF-A", date: "2026-03-01",
        customerId: "CUST-PF10", customerName: "عميل",
        lines: [makeLine("g4", 2, 100)], total: 200, amountReceived: 200,
        paymentType: "cash", priceType: "wholesale",
      }).id;
    });
    act(() => { result.current.cancelSalesInvoice(invA, "credit"); });
    expect(result.current.customerCredit("CUST-PF10")).toBe(200);
    act(() => {
      invB = result.current.addSalesInvoice({
        invoiceNumber: "INV-PF-B", date: "2026-04-01",
        customerId: "CUST-PF10", customerName: "عميل",
        lines: [makeLine("g5", 1, 150)], total: 150, amountReceived: 0,
        paymentType: "account", priceType: "wholesale",
      }).id;
    });
    let settled = 0;
    act(() => { settled = result.current.settleAllDues("CUST-PF10"); });
    expect(settled).toBe(150);
    const b = result.current.salesInvoices.find((i) => i.id === invB)!;
    expect(b.status).toBe("paid");
    expect(result.current.customerCredit("CUST-PF10")).toBe(50);
  });
});

function mountCash(result: { current: ReturnType<typeof useApp> }) {
  return result.current.currentCashBalance();
}

// ── P11: stocktake with loose pieces ─────────────────────────────────────────

describe("PROBE-G — stocktake apply", () => {
  it("P11: counted cartons+loose are applied once, status flips, re-apply is a no-op", () => {
    const { result } = mountStore();
    let prodId = "", stkId = "";
    act(() => {
      prodId = result.current.addProduct(baseProduct({ piecesPerUnit: 12, quantity: 10, looseQuantity: 5 })).id;
    });
    act(() => {
      stkId = result.current.addStocktake({
        date: "2026-06-11",
        items: [{ productId: prodId, productName: "x", systemQty: 10, countedQty: 8, piecesPerUnit: 12, systemLoose: 5, countedLoose: 3 }],
      }).id;
    });
    act(() => { result.current.applyStocktake(stkId); });
    let prod = result.current.products.find((p) => p.id === prodId)!;
    expect(prod.quantity).toBe(8);
    expect(prod.looseQuantity).toBe(3);
    expect(result.current.stocktakes.find((s) => s.id === stkId)?.status).toBe("applied");
    act(() => { result.current.applyStocktake(stkId); });
    prod = result.current.products.find((p) => p.id === prodId)!;
    expect(prod.quantity).toBe(8);
    expect(prod.looseQuantity).toBe(3);
  });
});

// ── P12: supplier credit settlement ──────────────────────────────────────────

describe("PROBE-H — supplier dues lifecycle", () => {
  it("P12: overpayment on purchase becomes credit and settles a later invoice", () => {
    const { result } = mountStore();
    let inv1 = "", inv2 = "";
    act(() => {
      inv1 = result.current.addPurchaseInvoice({
        invoiceNumber: "PUR-PH-1", date: "2026-05-01",
        supplierId: "SUP-PH", supplierName: "مورد",
        lines: [makeLine("g6", 10, 100)], total: 1000, amountPaid: 300,
      }).id;
    });
    act(() => { result.current.recordPurchasePayment(inv1, 900); });
    const i1 = result.current.purchaseInvoices.find((i) => i.id === inv1)!;
    expect(i1.amountPaid).toBe(1000);
    expect(i1.overpayment).toBe(200);
    expect(result.current.supplierCredit("SUP-PH")).toBe(200);
    act(() => {
      inv2 = result.current.addPurchaseInvoice({
        invoiceNumber: "PUR-PH-2", date: "2026-06-01",
        supplierId: "SUP-PH", supplierName: "مورد",
        lines: [makeLine("g7", 5, 100)], total: 500, amountPaid: 0,
      }).id;
    });
    let settled = 0;
    act(() => { settled = result.current.settleSupplierDues("SUP-PH"); });
    expect(settled).toBe(200);
    const i2 = result.current.purchaseInvoices.find((i) => i.id === inv2)!;
    expect(i2.amountPaid).toBe(200);
    expect(i2.remaining).toBe(300);
    expect(result.current.supplierCredit("SUP-PH")).toBe(0);
  });
});

// ── P13: backup import validation ────────────────────────────────────────────

describe("PROBE-I — importBackup", () => {
  function fileOf(content: string): File {
    return { text: async () => content } as unknown as File;
  }

  it("P13a: a valid backup file replaces catalog state", async () => {
    const { result } = mountStore();
    const backup = {
      version: "1.0",
      timestamp: "2026-06-11T00:00:00Z",
      state: {
        products: [{ ...baseProduct({ name: "مستورد من نسخة" }), id: "prd_imported", code: "9001", createdAt: "2026-01-01T00:00:00Z" }],
        customers: [],
        suppliers: [],
      },
    };
    let ok = false;
    await act(async () => { ok = await result.current.importBackup(fileOf(JSON.stringify(backup))); });
    expect(ok).toBe(true);
    expect(result.current.products.map((p) => p.id)).toEqual(["prd_imported"]);
  });

  it("P13b: garbage file is rejected without state change", async () => {
    const { result } = mountStore();
    const before = result.current.products.length;
    let ok = true;
    await act(async () => { ok = await result.current.importBackup(fileOf("{not json")); });
    expect(ok).toBe(false);
    expect(result.current.products.length).toBe(before);
  });

  it("P13c: users with [REDACTED] password hashes are NOT imported", async () => {
    const { result } = mountStore();
    const beforeUsers = result.current.users.map((u) => u.id);
    const backup = {
      version: "1.0",
      timestamp: "t",
      state: {
        products: [], customers: [], suppliers: [],
        users: [{ id: "evil", name: "x", username: "x", passwordHash: "[REDACTED]", role: "owner", permissions: {}, createdAt: "t" }],
      },
    };
    await act(async () => { await result.current.importBackup(fileOf(JSON.stringify(backup))); });
    expect(result.current.users.map((u) => u.id)).toEqual(beforeUsers);
  });

  it("P13d [restore white-screen fix]: imported data is DURABLY persisted before importBackup resolves", async () => {
    // The white screen came from reloading before the write landed. importBackup
    // now awaits lsSetBatchAwait, so by the time it returns the data is already
    // in storage — a reload reads the restored data, not the empty seed.
    const { result } = mountStore();
    const backup = {
      version: "1.0",
      timestamp: "t",
      state: {
        products: [{ ...baseProduct({ name: "محفوظ فوراً" }), id: "prd_persist", code: "9100", createdAt: "2026-01-01T00:00:00Z" }],
        customers: [],
        suppliers: [],
      },
    };
    let ok = false;
    await act(async () => { ok = await result.current.importBackup(fileOf(JSON.stringify(backup))); });
    expect(ok).toBe(true);
    // Read storage directly (what a reload would re-hydrate from), NOT React state.
    const persisted = JSON.parse(localStorage.getItem("autoparts_inventory_v1::products") ?? "[]");
    expect(persisted.map((p: { id: string }) => p.id)).toContain("prd_persist");
  });
});

// ── P14: quotation conversion ────────────────────────────────────────────────

describe("PROBE-J — quotation → invoice conversion", () => {
  it("P14: conversion keeps net total, caps received, deducts stock once, blocks re-convert", () => {
    const { result } = mountStore();
    let prodId = "", quotId = "";
    act(() => { prodId = result.current.addProduct(baseProduct({ quantity: 50 })).id; });
    act(() => {
      quotId = result.current.addQuotation({
        quotationNumber: "Q-PJ-1", date: "2026-06-01",
        customerId: "CUST-PJ", customerName: "عميل",
        lines: [makeLine(prodId, 10, 100)],
        total: 900, // subtotal 1000 − discount 100, page stores NET
        discount: 100,
      }).id;
    });
    let invTotal = 0, invReceived = 0, invOver = 0;
    act(() => {
      const inv = result.current.convertQuotation(quotId, {
        invoiceNumber: "INV-PJ-1", date: "2026-06-02",
        paymentType: "cash", priceType: "wholesale", amountReceived: 1000,
      });
      invTotal = inv.total; invReceived = inv.amountReceived; invOver = inv.overpayment ?? 0;
    });
    expect(invTotal).toBe(900);     // not 800 (double discount)
    expect(invReceived).toBe(900);  // capped at total
    expect(invOver).toBe(100);      // excess becomes credit
    expect(result.current.products.find((p) => p.id === prodId)?.quantity).toBe(40);
    expect(result.current.quotations.find((q) => q.id === quotId)?.status).toBe("converted");
    expect(() => result.current.convertQuotation(quotId, {
      invoiceNumber: "INV-PJ-2", date: "2026-06-03",
      paymentType: "cash", priceType: "wholesale", amountReceived: 0,
    })).toThrow();
  });
});

// ── P17: quotation conversion stock guard ────────────────────────────────────

describe("PROBE-M — quotation conversion stock guard (BUG-08 fixed)", () => {
  it("P17: converting a quotation that exceeds stock throws and changes nothing", () => {
    const { result } = mountStore();
    let prodId = "", quotId = "";
    act(() => { prodId = result.current.addProduct(baseProduct({ quantity: 5 })).id; });
    act(() => {
      quotId = result.current.addQuotation({
        quotationNumber: "Q-PM-1", date: "2026-06-01",
        customerId: "CUST-PM", customerName: "عميل",
        lines: [makeLine(prodId, 10, 100)],
        total: 1000,
      }).id;
    });
    const invoicesBefore = result.current.salesInvoices.length;
    expect(() =>
      result.current.convertQuotation(quotId, {
        invoiceNumber: "INV-PM-1", date: "2026-06-02",
        paymentType: "cash", priceType: "wholesale", amountReceived: 0,
      })
    ).toThrow(/المخزون غير كاف/);
    expect(result.current.products.find((p) => p.id === prodId)?.quantity).toBe(5);
    expect(result.current.salesInvoices.length).toBe(invoicesBefore);
    expect(result.current.quotations.find((q) => q.id === quotId)?.status).toBe("draft");
  });
});

// ── P19/P20: restore deleted invoices from the audit log ─────────────────────

describe("PROBE-N — audit-log invoice restore", () => {
  async function mountWithOwner(username: string) {
    const { result } = mountStore();
    const hash = await hashPassword("secret123");
    act(() => {
      result.current.addUser({
        name: "مالك", username, passwordHash: hash, role: "owner",
        permissions: undefined as never,
      });
    });
    await act(async () => {
      const login = await result.current.login(username, "secret123");
      expect(login.ok).toBe(true);
    });
    return result;
  }

  it("P19: deleted sales invoice is fully restored (invoice + stock + cash), once only", async () => {
    const result = await mountWithOwner("owner-p19");
    let prodId = "", invId = "";
    act(() => { prodId = result.current.addProduct(baseProduct({ quantity: 100 })).id; });
    const openingCash = result.current.currentCashBalance();
    act(() => {
      invId = result.current.addSalesInvoice({
        invoiceNumber: "INV-PN-1", date: "2026-06-10",
        customerId: "CUST-PN", customerName: "عميل",
        lines: [makeLine(prodId, 10, 50)], total: 500, amountReceived: 500,
        paymentType: "cash", priceType: "wholesale",
      }).id;
    });
    act(() => { result.current.deleteSalesInvoice(invId); });
    expect(result.current.products.find((p) => p.id === prodId)?.quantity).toBe(100);
    expect(result.current.currentCashBalance()).toBe(openingCash);

    const entry = result.current.auditLogs.find((a) => a.action === "invoice_sale_deleted");
    expect(entry?.snapshot?.kind).toBe("sales-invoice");

    let ok = false;
    act(() => { ok = result.current.restoreDeletedInvoice(entry!.id); });
    expect(ok).toBe(true);
    expect(result.current.salesInvoices.some((i) => i.id === invId)).toBe(true);
    expect(result.current.products.find((p) => p.id === prodId)?.quantity).toBe(90);
    expect(result.current.currentCashBalance()).toBe(openingCash + 500);
    expect(result.current.stockMovements.some((m) => m.referenceId === invId)).toBe(true);
    expect(result.current.auditLogs.some((a) => a.action === "invoice_restored")).toBe(true);

    // snapshot consumed — restoring twice must be rejected without side effects
    let again = true;
    act(() => { again = result.current.restoreDeletedInvoice(entry!.id); });
    expect(again).toBe(false);
    expect(result.current.products.find((p) => p.id === prodId)?.quantity).toBe(90);
  });

  it("P20: deleted purchase invoice is fully restored (invoice + stock + cash)", async () => {
    const result = await mountWithOwner("owner-p20");
    let prodId = "", invId = "";
    act(() => { prodId = result.current.addProduct(baseProduct({ quantity: 20 })).id; });
    const openingCash = result.current.currentCashBalance();
    act(() => {
      invId = result.current.addPurchaseInvoice({
        invoiceNumber: "PUR-PN-1", date: "2026-06-10",
        supplierId: "SUP-PN", supplierName: "مورد",
        lines: [makeLine(prodId, 10, 100)], total: 1000, amountPaid: 300,
      }).id;
    });
    expect(result.current.products.find((p) => p.id === prodId)?.quantity).toBe(30);
    act(() => { result.current.deletePurchaseInvoice(invId); });
    expect(result.current.products.find((p) => p.id === prodId)?.quantity).toBe(20);
    expect(result.current.currentCashBalance()).toBe(openingCash);

    const entry = result.current.auditLogs.find((a) => a.action === "invoice_purchase_deleted");
    expect(entry?.snapshot?.kind).toBe("purchase-invoice");

    let ok = false;
    act(() => { ok = result.current.restoreDeletedInvoice(entry!.id); });
    expect(ok).toBe(true);
    expect(result.current.purchaseInvoices.some((i) => i.id === invId)).toBe(true);
    expect(result.current.products.find((p) => p.id === prodId)?.quantity).toBe(30);
    expect(result.current.currentCashBalance()).toBe(openingCash - 300);
  });
});
