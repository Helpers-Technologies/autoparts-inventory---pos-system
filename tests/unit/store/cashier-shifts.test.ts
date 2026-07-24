import { describe, expect, it } from "vitest";
import { computeShiftSummary } from "../../../src/store/_pure";
import type { CashEntry, CashierShift, SalesInvoice, SalesReturn } from "../../../src/types";

const shift: CashierShift = {
  id: "shift-1",
  shiftNumber: 1,
  cashierId: "cashier-1",
  cashierName: "الكاشير الأول",
  cashierUsername: "cashier",
  openedAt: "2026-07-23T08:00:00.000Z",
  status: "open",
  openingCash: 500,
  expectedCash: 500,
  totalSalesCount: 0,
  totalSalesAmount: 0,
  totalCashSales: 0,
  totalVisaSales: 0,
  totalCreditSales: 0,
  totalRefunds: 0,
  totalExpenses: 0,
  salesInvoiceIds: [],
};

function invoice(id: string, total: number, overrides: Partial<SalesInvoice> = {}): SalesInvoice {
  return {
    id,
    invoiceNumber: id,
    date: "2026-07-23",
    customerId: "customer-1",
    customerName: "عميل",
    lines: [],
    total,
    amountReceived: total,
    remaining: 0,
    paymentType: "cash",
    paymentMethod: "cash",
    priceType: "retail",
    status: "paid",
    createdByUserId: "cashier-1",
    shiftId: "shift-1",
    createdAt: "2026-07-23T09:00:00.000Z",
    ...overrides,
  };
}

function entry(id: string, amount: number, overrides: Partial<CashEntry> = {}): CashEntry {
  return {
    id,
    type: "sales-receipt",
    amount,
    description: id,
    date: "2026-07-23",
    paymentMethod: "cash",
    shiftId: "shift-1",
    createdByUserId: "cashier-1",
    createdAt: "2026-07-23T09:00:00.000Z",
    ...overrides,
  };
}

describe("computeShiftSummary", () => {
  it("isolates the current cashier shift and reconciles physical cash correctly", () => {
    const salesInvoices = [
      invoice("cash-sale", 100),
      invoice("account-sale", 100, { paymentType: "account", amountReceived: 30, remaining: 70 }),
      invoice("electronic-sale", 80, { paymentMethod: "instapay" }),
      invoice("other-shift-sale", 999, { shiftId: "shift-2", createdByUserId: "cashier-2" }),
    ];
    const salesReturns: SalesReturn[] = [{
      id: "return-1",
      returnNumber: "RET-1",
      date: "2026-07-23",
      originalInvoiceId: "cash-sale",
      originalInvoiceNumber: "cash-sale",
      customerId: "customer-1",
      customerName: "عميل",
      lines: [],
      total: 10,
      refundCash: true,
      createdAt: "2026-07-23T10:00:00.000Z",
    }];
    const cashEntries = [
      entry("cash-receipt", 100, { referenceId: "cash-sale" }),
      entry("account-collection", 30, { referenceId: "account-sale" }),
      entry("electronic-receipt", 80, { referenceId: "electronic-sale", paymentMethod: "instapay" }),
      entry("cash-add", 20, { type: "manual-add" }),
      entry("sales-refund", -10, { type: "adjustment", referenceId: "return-1", description: "مرتجع مبيعات" }),
      entry("expense", -15, { type: "purchase-payment", description: "مصروف نقدي" }),
      entry("other-shift", 999, { shiftId: "shift-2", createdByUserId: "cashier-2" }),
    ];

    const summary = computeShiftSummary({ shift, salesInvoices, cashEntries, salesReturns });

    expect(summary.totalSalesCount).toBe(3);
    expect(summary.totalSalesAmount).toBe(280);
    expect(summary.totalCashSales).toBe(130);
    expect(summary.totalCashAdditions).toBe(20);
    expect(summary.totalVisaSales).toBe(80);
    expect(summary.totalCreditSales).toBe(70);
    expect(summary.totalRefunds).toBe(10);
    expect(summary.totalExpenses).toBe(15);
    expect(summary.expectedCash).toBe(625);
    expect(summary.salesInvoiceIds).not.toContain("other-shift-sale");
  });
});
