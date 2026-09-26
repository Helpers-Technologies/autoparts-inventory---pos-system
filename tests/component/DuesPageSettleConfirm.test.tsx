// @vitest-environment jsdom
/**
 * Settling a party's credit balance is confirmed before it happens.
 *
 * The two "تسوية" buttons on the party-balances tab used to call
 * settleAllDues() / settleSupplierDues() straight from onClick. Both move a
 * credit balance onto open invoices, neither can be undone from any screen,
 * and the buttons are small icons inside a dense table row — the easiest kind
 * of thing to hit by accident while scrolling a list of debtors.
 *
 * The audit in tests/unit/destructive-actions-guarded.test.ts is what found
 * them. This pins the fix at the place a shop actually touches it: the button
 * opens a dialog, dismissing it settles nothing, and confirming settles the
 * right party exactly once.
 *
 * What the settle itself does to the books is covered elsewhere — TC-MSD-006
 * and cash-balance-invariants. This file is about the gate in front of it.
 *
 * TC-DUES-SETTLE-001 through TC-DUES-SETTLE-007
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { screen, cleanup, within } from "@testing-library/react";
import { DuesPage } from "../../src/pages/DuesPage";
import { renderWithProviders } from "../helpers/render";
import type { Customer, SalesInvoice, Supplier } from "../../src/types";

const settleAllDues = vi.fn(() => 250);
const settleSupplierDues = vi.fn(() => 400);

const CUSTOMER: Customer = {
  id: "cus1",
  name: "ورشة النصر",
  phone: "01000000000",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const SUPPLIER: Supplier = {
  id: "sup1",
  name: "موردي القاهرة",
  phone: "01100000000",
  createdAt: "2026-01-01T00:00:00.000Z",
};

/** One unpaid account sale, so the customer shows an open invoice. */
const SALE: SalesInvoice = {
  id: "inv1",
  invoiceNumber: "S-1",
  date: "2026-08-01",
  customerId: "cus1",
  customerName: "ورشة النصر",
  lines: [],
  total: 1000,
  amountReceived: 0,
  remaining: 1000,
  status: "unpaid",
  paymentType: "account",
  priceType: "retail",
  paymentDueDate: "2026-08-15",
  createdAt: "2026-08-01T00:00:00.000Z",
};

const PURCHASE = {
  id: "pinv1",
  invoiceNumber: "P-1",
  date: "2026-08-01",
  supplierId: "sup1",
  supplierName: "موردي القاهرة",
  lines: [],
  total: 900,
  amountPaid: 0,
  remaining: 900,
  createdAt: "2026-08-01T00:00:00.000Z",
};

vi.mock("../../src/store/AuthContext", () => ({
  useAuth: () => ({
    currentUser: { id: "u1", name: "المالك", username: "owner", role: "owner" },
  }),
}));

vi.mock("../../src/store/CatalogContext", () => ({
  useCatalog: () => ({ customers: [CUSTOMER], suppliers: [SUPPLIER] }),
}));

vi.mock("../../src/store/InvoicingContext", () => ({
  useInvoicing: () => ({
    salesInvoices: [SALE],
    purchaseInvoices: [PURCHASE],
    settleAllDues,
    settleSupplierDues,
  }),
}));

vi.mock("../../src/store/SettingsContext", () => ({
  useSettings: () => ({ settings: { currency: "EGP", dueSoonDays: 7 } }),
}));

vi.mock("../../src/store/ReportingContext", () => ({
  useReporting: () => ({
    customerBalance: () => 1000,
    customerCredit: () => 250,
    supplierBalance: () => 900,
    supplierCredit: () => 400,
  }),
}));

vi.mock("../../src/store/AutoPartsProContext", () => ({
  useAutoPartsPro: () => ({ customerVehicles: [], branches: [] }),
  vehicleDisplayName: () => "",
}));

vi.mock("../../src/store/VehicleCatalogContext", () => ({
  useVehicleCatalog: () => ({ vehicleMakes: [], vehicleModels: [] }),
}));

vi.mock("../../src/lib/useFeatures", () => ({
  useFeatures: () => ({ isEnabled: () => true }),
}));

beforeEach(() => {
  settleAllDues.mockClear();
  settleSupplierDues.mockClear();
});
afterEach(() => cleanup());

/**
 * Opens the party-balances tab and returns that tab's settle buttons.
 *
 * Queried as buttons, not tabs: src/components/ui/Tabs.tsx renders plain
 * <button> elements with no role="tab"/aria-selected, so a role="tab" query
 * finds nothing. Worth fixing for screen readers, but not from here.
 */
async function openPartyTab(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    screen.getByRole("button", { name: "أرصدة العملاء والموردين" }),
  );
  return screen.getAllByRole("button", { name: /^تسوية$/ });
}

describe("settling a balance asks first — TC-DUES-SETTLE", () => {
  it("TC-DUES-SETTLE-001: the settle buttons are on the party-balances tab", () => {
    // Anchors the rest of the suite: if the tab or the buttons move, these
    // tests must fail loudly rather than pass by finding nothing to click.
    renderWithProviders(<DuesPage />);
    expect(
      screen.getByRole("button", { name: "أرصدة العملاء والموردين" }),
    ).toBeInTheDocument();
  });

  it("TC-DUES-SETTLE-002: clicking settle moves no money — it only opens a dialog", async () => {
    const user = userEvent.setup();
    renderWithProviders(<DuesPage />);
    const buttons = await openPartyTab(user);
    expect(buttons.length).toBeGreaterThan(0);

    await user.click(buttons[0]);

    expect(settleAllDues).not.toHaveBeenCalled();
    expect(settleSupplierDues).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("TC-DUES-SETTLE-003: the dialog names the party and the amount at risk", async () => {
    // A confirmation that does not say whose balance, or how much, is not a
    // confirmation — the cashier cannot tell whether they picked the wrong row.
    const user = userEvent.setup();
    renderWithProviders(<DuesPage />);
    const buttons = await openPartyTab(user);
    await user.click(buttons[0]);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("ورشة النصر");
    expect(dialog).toHaveTextContent("250");
  });

  it("TC-DUES-SETTLE-004: cancelling settles nothing", async () => {
    const user = userEvent.setup();
    renderWithProviders(<DuesPage />);
    const buttons = await openPartyTab(user);
    await user.click(buttons[0]);
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "إلغاء" }),
    );

    expect(settleAllDues).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("TC-DUES-SETTLE-005: Escape settles nothing", async () => {
    const user = userEvent.setup();
    renderWithProviders(<DuesPage />);
    const buttons = await openPartyTab(user);
    await user.click(buttons[0]);
    await user.keyboard("{Escape}");

    expect(settleAllDues).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("TC-DUES-SETTLE-006: confirming settles that one party, exactly once", async () => {
    const user = userEvent.setup();
    renderWithProviders(<DuesPage />);
    const buttons = await openPartyTab(user);
    await user.click(buttons[0]);
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "تأكيد التسوية",
      }),
    );

    expect(settleAllDues).toHaveBeenCalledTimes(1);
    expect(settleAllDues).toHaveBeenCalledWith("cus1");
    // The supplier in the next row is untouched — the dialog carries its own
    // target rather than settling whatever the page last hovered.
    expect(settleSupplierDues).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("TC-DUES-SETTLE-007: the supplier button settles the supplier, not the customer", async () => {
    const user = userEvent.setup();
    renderWithProviders(<DuesPage />);
    const buttons = await openPartyTab(user);
    // Both rows render a settle button; the second belongs to the supplier.
    expect(buttons.length).toBe(2);
    await user.click(buttons[1]);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("موردي القاهرة");
    await user.click(
      within(dialog).getByRole("button", { name: "تأكيد التسوية" }),
    );

    expect(settleSupplierDues).toHaveBeenCalledTimes(1);
    expect(settleSupplierDues).toHaveBeenCalledWith("sup1");
    expect(settleAllDues).not.toHaveBeenCalled();
  });
});
