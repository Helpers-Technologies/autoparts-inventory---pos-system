// @vitest-environment jsdom
/**
 * STATEMENT PRINT PROBES — verify the customer/supplier account-statement
 * pages compute balances that match the store's balance selectors.
 * Originally `it.fails` defect probes for Reports V2/09-Full-System-Test-
 * Report-2026-06-11.md; BUG-02 and BUG-05 are fixed, so these now run as
 * permanent regression tests.
 */
import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { Routes, Route } from "react-router-dom";
import { renderWithProviders } from "../helpers/render";
import { formatCurrency } from "../../src/lib/format";
import type { CashEntry, PurchaseInvoice, SalesInvoice, SalesReturn } from "../../src/types";

const SETTINGS = {
  settings: {
    companyName: "Helpers", companyNameAr: "هيلبرز", invoiceFooter: "",
    currency: "ج.م", arabicLabels: true, logoText: "H", logoImage: "",
  },
  updateSettings: vi.fn(),
};

const OWNER = {
  id: "u1", name: "Owner", username: "owner", passwordHash: "x",
  role: "owner" as const, permissions: undefined, createdAt: "t",
};

vi.mock("../../src/store/SettingsContext", () => ({
  useSettings: () => SETTINGS,
}));
vi.mock("../../src/store/AuthContext", () => ({
  useAuth: () => ({ auth: { isAuthenticated: true }, currentUser: OWNER }),
}));

// ── mutable fixtures the mocked invoicing/catalog hooks serve ────────────────
const fix: {
  purchaseInvoices: PurchaseInvoice[];
  purchaseReturns: never[];
  salesInvoices: SalesInvoice[];
  salesReturns: SalesReturn[];
  cashEntries: CashEntry[];
} = {
  purchaseInvoices: [],
  purchaseReturns: [],
  salesInvoices: [],
  salesReturns: [],
  cashEntries: [],
};

vi.mock("../../src/store/InvoicingContext", () => ({
  useInvoicing: () => fix,
}));
vi.mock("../../src/store/CatalogContext", () => ({
  useCatalog: () => ({
    suppliers: [{ id: "SUP1", code: "SUP-001", name: "مورد الاختبار", createdAt: "t" }],
    customers: [{ id: "CUS1", code: "CUS-0001", name: "عميل الاختبار", createdAt: "t" }],
  }),
}));

import { SupplierStatementPrintPage } from "../../src/pages/SupplierStatementPrintPage";
import { CustomerStatementPrintPage } from "../../src/pages/CustomerStatementPrintPage";

describe("PROBE-K — supplier statement balance", () => {
  it("P15 [BUG-02 fixed]: a fully-paid purchase invoice yields a ZERO final supplier balance", () => {
    fix.purchaseInvoices = [{
      id: "pinv1", invoiceNumber: "PUR-1", date: "2026-05-01",
      supplierId: "SUP1", supplierName: "مورد الاختبار",
      lines: [], total: 1000, amountPaid: 1000, remaining: 0, status: "paid", createdAt: "t",
    }];
    fix.cashEntries = [{
      id: "c1", type: "purchase-payment", amount: -1000,
      description: "سداد فاتورة مشتريات PUR-1", referenceId: "pinv1", date: "2026-05-01",
    }];
    fix.salesInvoices = []; fix.salesReturns = [];

    renderWithProviders(
      <Routes><Route path="/suppliers/:id/statement" element={<SupplierStatementPrintPage />} /></Routes>,
      { initialEntries: ["/suppliers/SUP1/statement"] },
    );
    // paid in full → الرصيد النهائي must be zero (redesigned layout shows "متوازن (صفر)")
    expect(screen.getAllByText(/متوازن/).length).toBeGreaterThan(0);
  });
});

describe("PROBE-L — customer statement matches store balance on capped cash refund", () => {
  it("P16 [BUG-05 fixed]: invoice 310 paid 100, return 150 cash-refunded (capped at 100) → balance 160", () => {
    fix.salesInvoices = [{
      id: "sinv1", invoiceNumber: "INV-1", date: "2026-05-01",
      customerId: "CUS1", customerName: "عميل الاختبار",
      lines: [], total: 310, amountReceived: 0, remaining: 160,
      paymentType: "account", priceType: "wholesale", status: "partial", createdAt: "t",
    }];
    fix.salesReturns = [{
      id: "sr1", returnNumber: "SR-0001", date: "2026-05-02",
      originalInvoiceId: "sinv1", originalInvoiceNumber: "INV-1",
      customerId: "CUS1", customerName: "عميل الاختبار",
      lines: [], total: 150, refundCash: true, createdAt: "t",
    }];
    fix.cashEntries = [
      { id: "c2", type: "sales-receipt", amount: 100, description: "تحصيل INV-1", referenceId: "sinv1", date: "2026-05-01" },
      // the store caps the actual refund at the amount paid (100, not 150)
      { id: "c3", type: "adjustment", amount: -100, description: "رد نقدية لمرتجع SR-0001", referenceId: "sr1", date: "2026-05-02" },
    ];
    fix.purchaseInvoices = [];

    renderWithProviders(
      <Routes><Route path="/customers/:id/statement" element={<CustomerStatementPrintPage />} /></Routes>,
      { initialEntries: ["/customers/CUS1/statement"] },
    );
    // store says the customer still owes 310 − 100 − (150 − 100 credited) = 160
    const expected = formatCurrency(160, "ج.م");
    expect(screen.getAllByText(expected).length).toBeGreaterThan(0);
  });

  it("P18 [BUG-05 fixed]: credit from a cancelled invoice + settleAllDues shows as دائن 50", () => {
    fix.salesInvoices = [
      {
        // invoice A: paid 200, then cancelled with credit; 150 of the credit
        // was later settled into invoice B → 50 credit remains
        id: "sinvA", invoiceNumber: "INV-A", date: "2026-03-01",
        customerId: "CUS1", customerName: "عميل الاختبار",
        lines: [], total: 200, amountReceived: 0, remaining: 0, overpayment: 50,
        paymentType: "cash", priceType: "wholesale", status: "paid",
        cancelled: true, createdAt: "t",
      },
      {
        // invoice B: fully settled from the credit — NO cash entry exists
        id: "sinvB", invoiceNumber: "INV-B", date: "2026-04-01",
        customerId: "CUS1", customerName: "عميل الاختبار",
        lines: [], total: 150, amountReceived: 150, remaining: 0,
        paymentType: "account", priceType: "wholesale", status: "paid", createdAt: "t",
      },
    ];
    fix.salesReturns = [];
    fix.cashEntries = [
      // A's original receipt — excluded with the cancelled invoice
      { id: "c4", type: "sales-receipt", amount: 200, description: "تحصيل INV-A", referenceId: "sinvA", date: "2026-03-01" },
    ];
    fix.purchaseInvoices = [];

    renderWithProviders(
      <Routes><Route path="/customers/:id/statement" element={<CustomerStatementPrintPage />} /></Routes>,
      { initialEntries: ["/customers/CUS1/statement"] },
    );
    // B owes nothing (settled by credit) and 50 credit remains → final balance is
    // a credit of 50 (redesigned layout shows the amount + "رصيد دائن للعميل")
    expect(screen.getByText("رصيد دائن للعميل")).toBeInTheDocument();
    expect(screen.getAllByText(formatCurrency(50, "ج.م")).length).toBeGreaterThan(0);
  });
});
