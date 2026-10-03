// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import { createRequire } from "node:module";
import { AppProvider, useApp } from "../../../src/store/AppContext";
import { lsClearAll } from "../../../src/lib/storage";
const require = createRequire(import.meta.url);
const { validateValue } = require("../../../electron/storage-mutation-policy.cjs") as { validateValue: (info: {name: string}, value: string) => unknown };
const wrapper = ({ children }: { children: ReactNode }) => <AppProvider>{children}</AppProvider>;
beforeEach(() => { localStorage.clear(); lsClearAll(); });
afterEach(cleanup);
const invalid = [NaN, Infinity, -Infinity, null, ""];
describe("FIN-02 invalid money has no financial or inventory effects", () => {
  it.each(invalid)("rejects receipt, payment, cash, return and purchase input %s before changing state", (value) => {
    const { result } = renderHook(useApp, { wrapper });
    const snapshot = () => JSON.stringify({ products: result.current.products, invoices: result.current.salesInvoices, purchases: result.current.purchaseInvoices, cash: result.current.cashEntries, ledger: result.current.stockMovements, returns: result.current.salesReturns, purchaseReturns: result.current.purchaseReturns });
    const before = snapshot();
    const amount = value as number;
    const actions = [
      () => result.current.recordSalesReceipt("missing", amount),
      () => result.current.recordPurchasePayment("missing", amount),
      () => result.current.applyCustomerCredit("missing", "missing", amount),
      () => result.current.addCashEntry({ type: "manual-add", amount, description: "FIN02", date: "2026-10-03" }),
      () => result.current.addSalesReturn({ originalInvoiceId: "missing", originalInvoiceNumber: "missing", refundCash: false, customerId: "missing", customerName: "missing", lines: [], total: amount, date: "2026-10-03" }),
      () => result.current.addPurchaseReturn({ originalInvoiceId: "missing", originalInvoiceNumber: "missing", supplierId: "missing", supplierName: "missing", lines: [], total: amount, date: "2026-10-03" }),
      () => result.current.addPurchaseInvoice({ invoiceNumber: "FIN02", supplierId: "missing", supplierName: "missing", lines: [], total: 0, amountPaid: amount, date: "2026-10-03" }),
    ];
    for (const action of actions) { expect(() => act(action)).toThrow(/invalid_money/); expect(snapshot()).toBe(before); }
  });
  it("rejects missing mandatory payment amounts", () => {
    const { result } = renderHook(useApp, { wrapper });
    expect(() => result.current.recordSalesReceipt("missing", undefined as unknown as number)).toThrow(/invalid_money/);
    expect(() => result.current.recordPurchasePayment("missing", undefined as unknown as number)).toThrow(/invalid_money/);
  });
  it.each([0, -100, 0.000001, 1e100])("preserves signed finite cash amount %s", amount => {
    const { result } = renderHook(useApp, { wrapper });
    act(() => { result.current.addCashEntry({ type: "adjustment", amount, description: "FIN02", date: "2026-10-03" }); });
    expect(result.current.cashEntries[0].amount).toBe(amount);
  });
  it.each(["salesInvoices", "purchaseInvoices", "salesReturns", "purchaseReturns", "shippingRates", "deliveryOrders", "offlineTransactions", "drivers", "products"])("main storage rejects serialized null monetary fields for %s", name => {
    // JSON serialization of all three non-finite numbers produces null.
    for (const amount of [NaN, Infinity, -Infinity]) expect(() => validateValue({name}, JSON.stringify([{ id: "bad", amount }]))).toThrow(/invalid_money/);
  });
});
