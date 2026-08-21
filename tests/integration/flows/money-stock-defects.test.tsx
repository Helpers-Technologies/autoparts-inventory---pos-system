// @vitest-environment jsdom
/**
 * Money and stock defects found by a strict review of the store, each pinned
 * here so it cannot come back.
 *
 * Every case below was reproduced against the real AppProvider before its fix
 * was written — the test failed first, then the fix made it pass. They are
 * grouped by the thing that breaks, because that is what a shop notices:
 * stock that no longer matches the shelf, or money that is in the drawer
 * according to the app and not according to the till.
 *
 * TC-MSD-001 through TC-MSD-006
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { webcrypto } from "node:crypto";
import { AppProvider, useApp } from "../../../src/store/AppContext";
import type { InvoiceLine, Product } from "../../../src/types";
import { lsClearAll } from "../../../src/lib/storage";

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto });
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <AppProvider>{children}</AppProvider>
);
const mountStore = () => renderHook(() => useApp(), { wrapper });

function line(productId: string, quantity: number, price: number, extra: Partial<InvoiceLine> = {}): InvoiceLine {
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

/** Sum of the ledger for one product — what the movements say the stock is. */
function ledgerQuantity(movements: { productId: string; type: string; quantity: number }[], productId: string) {
  return movements
    .filter((movement) => movement.productId === productId)
    .reduce((total, movement) => {
      const magnitude = Math.abs(movement.quantity);
      const outward =
        movement.type === "sale" || movement.type === "adjustment-out";
      return total + (outward ? -magnitude : magnitude);
    }, 0);
}

beforeEach(() => {
  localStorage.clear();
  lsClearAll();
});
afterEach(() => cleanup());

describe("money and stock defects — TC-MSD", () => {
  it("TC-MSD-001: cancelling an invoice that was partly returned does not restore the returned units twice", () => {
    // deleteSalesInvoice already refuses this case with a comment naming the
    // double-count. cancelSalesInvoice ran the same restore with no such
    // check, so the returned units came back a second time.
    const { result } = mountStore();
    let productId = "";
    act(() => { productId = result.current.addProduct(baseProduct({ quantity: 50 })).id; });

    let invoiceId = "";
    act(() => {
      const invoice = result.current.addSalesInvoice({
        invoiceNumber: "S-1", date: "2026-08-01", customerId: "walkin", customerName: "نقدي",
        lines: [line(productId, 10, 75)], total: 750, amountReceived: 750,
        paymentType: "cash", priceType: "retail",
      });
      invoiceId = invoice.id;
    });
    expect(result.current.products.find((p) => p.id === productId)!.quantity).toBe(40);

    act(() => {
      result.current.addSalesReturn({ date: "2026-08-02",
        originalInvoiceId: invoiceId, originalInvoiceNumber: "S-1",
        customerId: "walkin", customerName: "نقدي",
        lines: [line(productId, 4, 75)], total: 300, refundCash: false,
      });
    });
    expect(result.current.products.find((p) => p.id === productId)!.quantity).toBe(44);

    act(() => { result.current.cancelSalesInvoice(invoiceId, "credit"); });

    // Six units were actually sold and never came back; 44 + 6 = 50.
    // The defect restored the full ten, reaching 54.
    const product = result.current.products.find((p) => p.id === productId)!;
    expect(product.quantity).toBe(50);
    // And the ledger has to agree with the product, or the inventory report
    // and the product page tell the shop two different numbers.
    expect(ledgerQuantity(result.current.stockMovements, productId)).toBe(product.quantity - 50);
  });

  it("TC-MSD-002: a supplier credit from a purchase return is not booked as cash in the drawer", () => {
    // A return that turns an over-payment into supplier credit moves no money.
    // Booking it as a positive cash entry inflated the drawer AND was counted
    // a second time as supplier credit, and the shift's expected cash with it.
    const { result } = mountStore();
    let productId = "";
    let supplierId = "";
    act(() => {
      productId = result.current.addProduct(baseProduct({ quantity: 0 })).id;
      supplierId = result.current.addSupplier({ name: "مورد اختبار" }).id;
    });

    const openingBalance = result.current.settings.openingBalance;
    let purchaseId = "";
    act(() => {
      const invoice = result.current.addPurchaseInvoice({
        invoiceNumber: "P-1", date: "2026-08-01", supplierId, supplierName: "مورد اختبار",
        lines: [line(productId, 10, 100)], total: 1000, amountPaid: 1000,
      });
      purchaseId = invoice.id;
    });
    const afterPurchase = result.current.currentCashBalance();
    expect(afterPurchase).toBe(openingBalance - 1000);

    act(() => {
      result.current.addPurchaseReturn({ date: "2026-08-02",
        originalInvoiceId: purchaseId, originalInvoiceNumber: "P-1",
        supplierId, supplierName: "مورد اختبار",
        lines: [line(productId, 4, 100)], total: 400,
      });
    });

    // No cash moved: the supplier owes 400, they did not hand it over.
    expect(result.current.currentCashBalance()).toBe(afterPurchase);
    // The 400 is represented once, as supplier credit.
    expect(result.current.supplierCredit(supplierId)).toBe(400);
  });

  it("TC-MSD-003: editing a purchase invoice does not re-create stock that has since been sold", () => {
    // The reversal clamped at zero BEFORE adding the new quantity back, so
    // any units already sold were invented again on the next save.
    const { result } = mountStore();
    let productId = "";
    let supplierId = "";
    act(() => {
      productId = result.current.addProduct(baseProduct({ quantity: 0 })).id;
      supplierId = result.current.addSupplier({ name: "مورد اختبار" }).id;
    });

    let purchaseId = "";
    let purchaseLine: InvoiceLine | undefined;
    act(() => {
      purchaseLine = line(productId, 10, 100);
      purchaseId = result.current.addPurchaseInvoice({
        invoiceNumber: "P-2", date: "2026-08-01", supplierId, supplierName: "مورد اختبار",
        lines: [purchaseLine], total: 1000, amountPaid: 1000,
      }).id;
    });
    expect(result.current.products.find((p) => p.id === productId)!.quantity).toBe(10);

    act(() => {
      result.current.addSalesInvoice({
        invoiceNumber: "S-2", date: "2026-08-02", customerId: "walkin", customerName: "نقدي",
        lines: [line(productId, 7, 150)], total: 1050, amountReceived: 1050,
        paymentType: "cash", priceType: "retail",
      });
    });
    expect(result.current.products.find((p) => p.id === productId)!.quantity).toBe(3);

    // Correct a price only — quantities untouched.
    act(() => {
      result.current.updatePurchaseInvoice(purchaseId, {
        lines: [{ ...purchaseLine!, price: 110, subtotal: 1100 }],
        date: "2026-08-03",
      });
    });

    // Three on the shelf before the edit, three after.
    expect(result.current.products.find((p) => p.id === productId)!.quantity).toBe(3);
  });

  it("TC-MSD-004: changing a product's quantity from the product form leaves a movement behind", async () => {
    // updateProduct merged the patch straight into state, so on-hand stock
    // could change with nothing in the ledger to explain where it went.
    const { result } = mountStore();
    let productId = "";
    act(() => { productId = result.current.addProduct(baseProduct({ quantity: 40 })).id; });

    // The ledger is deliberately NOT held in memory at startup (it reaches
    // 300k rows on a mature shop), so appends land in storage and the cache
    // stays empty. Asserting on result.current.stockMovements would therefore
    // pass whatever happened; hydrate and read the real thing.
    const before = (await result.current.hydrateStockMovements()).length;
    act(() => { result.current.updateProduct(productId, { quantity: 25 }); });

    expect(result.current.products.find((p) => p.id === productId)!.quantity).toBe(25);
    const ledger = await result.current.hydrateStockMovements();
    expect(ledger.length).toBe(before + 1);
    const movement = ledger.find((entry) => entry.productId === productId)!;
    expect(movement).toBeDefined();
    expect(Math.abs(movement.quantity)).toBe(15);
    expect(movement.type).toBe("adjustment-out");
  });

  it("TC-MSD-005: an edit that does not touch quantity writes no movement", async () => {
    // The counterpart to TC-MSD-004: a price or name change is not a stock
    // event, and logging one would fill the ledger with noise.
    const { result } = mountStore();
    let productId = "";
    act(() => { productId = result.current.addProduct(baseProduct({ quantity: 40 })).id; });

    const before = (await result.current.hydrateStockMovements()).length;
    act(() => { result.current.updateProduct(productId, { retailPrice: 99, name: "اسم جديد" }); });

    expect(result.current.products.find((p) => p.id === productId)!.retailPrice).toBe(99);
    expect((await result.current.hydrateStockMovements()).length).toBe(before);
  });

  it("TC-MSD-006: settling customer credit against a partly-returned invoice does not raise the debt", () => {
    // settleAllDues recomputed remaining from the ORIGINAL total, re-adding an
    // amount the return had already taken off — the exact mistake the receipt
    // path documents and avoids.
    const { result } = mountStore();
    let productId = "";
    let customerId = "";
    act(() => {
      productId = result.current.addProduct(baseProduct({ quantity: 100 })).id;
      customerId = result.current.addCustomer({ name: "عميل اختبار" }).id;
    });

    // An account sale of 1000, nothing paid.
    let invoiceId = "";
    act(() => {
      invoiceId = result.current.addSalesInvoice({
        invoiceNumber: "S-3", date: "2026-08-01", customerId, customerName: "عميل اختبار",
        lines: [line(productId, 10, 100)], total: 1000, amountReceived: 0,
        paymentType: "account", priceType: "retail",
      }).id;
    });

    // A 400 return taken as credit, not cash: the debt drops to 600.
    act(() => {
      result.current.addSalesReturn({ date: "2026-08-02",
        originalInvoiceId: invoiceId, originalInvoiceNumber: "S-3",
        customerId, customerName: "عميل اختبار",
        lines: [line(productId, 4, 100)], total: 400, refundCash: false,
      });
    });
    const debtAfterReturn = result.current.customerBalance(customerId);
    expect(debtAfterReturn).toBe(600);

    act(() => { result.current.settleAllDues(customerId); });

    // Settling may only ever reduce what the customer owes.
    expect(result.current.customerBalance(customerId)).toBeLessThanOrEqual(debtAfterReturn);
  });
});
