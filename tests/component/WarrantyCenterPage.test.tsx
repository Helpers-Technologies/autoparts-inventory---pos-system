// @vitest-environment jsdom
/**
 * WarrantyCenterPage component tests.
 *
 * Covers the "استبدال" (replace) regression: marking a warranty claim as
 * "replaced" — via the dedicated button — must call catalog.adjustStock()
 * exactly once (deducting the replaced unit from stock) AND stamp the claim
 * with { status: "replaced", stockDeducted: true, replacementCost }. Both
 * effects are driven by the page's local changeClaimStatus() helper.
 *
 * TC-COMP-WARRANTY-001
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { screen, cleanup } from "@testing-library/react";
import { WarrantyCenterPage } from "../../src/pages/WarrantyCenterPage";
import { renderWithProviders } from "../helpers/render";
import type { Product, Supplier, WarrantyClaim } from "../../src/types";

// ── Module-level mocks ────────────────────────────────────────────────────────

const mockAdjustStock = vi.fn();
const mockUpdateWarrantyClaim = vi.fn();
const mockAddWarrantyClaim = vi.fn();
const mockAddCashEntry = vi.fn();

const PRODUCT: Product = {
  id: "prod1",
  code: "P-001",
  name: "طرمبة بنزين",
  category: "كهرباء",
  unit: "قطعة",
  purchasePrice: 100,
  avgCost: 120,
  wholesalePrice: 150,
  retailPrice: 180,
  quantity: 10,
  minStock: 1,
  hasExpiry: false,
  createdAt: "2026-01-01T00:00:00.000Z",
};

const SUPPLIERS: Supplier[] = [];

const OPEN_CLAIM: WarrantyClaim = {
  id: "claim1",
  invoiceId: "inv1",
  invoiceNumber: "INV-1",
  invoiceLineId: "line1",
  customerId: "cus1",
  customerName: "عميل الاختبار",
  productId: "prod1",
  productName: "طرمبة بنزين",
  complaint: "عطل في الطرمبة",
  status: "open",
  openedAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
};
let mockWarrantyClaims: WarrantyClaim[] = [OPEN_CLAIM];

vi.mock("../../src/store/InvoicingContext", () => ({
  useInvoicing: () => ({ salesInvoices: [], addCashEntry: mockAddCashEntry }),
}));

vi.mock("../../src/store/CatalogContext", () => ({
  useCatalog: () => ({
    products: [PRODUCT],
    suppliers: SUPPLIERS,
    adjustStock: mockAdjustStock,
  }),
}));

vi.mock("../../src/store/SettingsContext", () => ({
  useSettings: () => ({
    settings: { currency: "ج.م" },
    updateSettings: vi.fn(),
  }),
}));

vi.mock("../../src/store/AutoPartsProContext", () => ({
  useAutoPartsPro: () => ({
    warrantyClaims: mockWarrantyClaims,
    addWarrantyClaim: mockAddWarrantyClaim,
    updateWarrantyClaim: mockUpdateWarrantyClaim,
  }),
}));

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("WarrantyCenterPage — TC-COMP-WARRANTY", () => {
  beforeEach(() => {
    mockWarrantyClaims = [OPEN_CLAIM];
    mockAdjustStock.mockClear();
    mockUpdateWarrantyClaim.mockClear();
    mockAddWarrantyClaim.mockClear();
    mockAddCashEntry.mockReset();
    mockAddCashEntry.mockReturnValue({ id: "cash_comp_1" });
  });

  afterEach(() => {
    cleanup();
  });

  it("TC-COMP-WARRANTY-001 — clicking استبدال on an open claim deducts stock once and stamps replacementCost", async () => {
    const user = userEvent.setup();
    renderWithProviders(<WarrantyCenterPage />);

    // Switch to the claims tab to see the open claim and its action buttons.
    await user.click(screen.getByRole("button", { name: /طلبات الضمان/ }));

    const replaceButton = screen.getByRole("button", { name: /استبدال/ });
    await user.click(replaceButton);

    expect(mockAdjustStock).toHaveBeenCalledTimes(1);
    expect(mockAdjustStock).toHaveBeenCalledWith("prod1", -1, expect.any(String));

    expect(mockUpdateWarrantyClaim).toHaveBeenCalledTimes(1);
    expect(mockUpdateWarrantyClaim).toHaveBeenCalledWith("claim1", {
      status: "replaced",
      stockDeducted: true,
      replacementCost: expect.any(Number),
    });
  });

  it("pays a cash compensation once without deducting replacement stock", async () => {
    const user = userEvent.setup();
    renderWithProviders(<WarrantyCenterPage />);

    await user.click(screen.getByRole("button", { name: /طلبات الضمان/ }));
    await user.click(screen.getByRole("button", { name: /تعويض نقدي/ }));
    await user.type(screen.getByRole("spinbutton", { name: "مبلغ التعويض" }), "75");
    await user.click(screen.getByRole("button", { name: /تأكيد التعويض/ }));

    expect(mockAdjustStock).not.toHaveBeenCalled();
    expect(mockAddCashEntry).toHaveBeenCalledTimes(1);
    expect(mockAddCashEntry).toHaveBeenCalledWith(expect.objectContaining({
      type: "adjustment",
      amount: -75,
      referenceId: "claim1",
      paymentMethod: "cash",
    }));
    expect(mockUpdateWarrantyClaim).toHaveBeenCalledWith("claim1", expect.objectContaining({
      status: "compensated",
      compensationAmount: 75,
      compensationCashEntryId: "cash_comp_1",
    }));
  });

  it("keeps a compensated claim finalized and disables further decisions", async () => {
    mockWarrantyClaims = [{
      ...OPEN_CLAIM,
      status: "compensated",
      compensationAmount: 75,
      compensationCashEntryId: "cash_comp_existing",
    }];
    const user = userEvent.setup();
    renderWithProviders(<WarrantyCenterPage />);

    await user.click(screen.getByRole("button", { name: /طلبات الضمان/ }));

    expect(screen.getByText("تم التعويض نقديًا", { selector: "span" })).toBeInTheDocument();
    const claimStatusSelect = screen.getAllByRole("combobox").find((element) => (element as HTMLSelectElement).value === "compensated");
    expect(claimStatusSelect).toBeDisabled();
    expect(screen.getByRole("button", { name: /استبدال/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /تعويض نقدي/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /رفض/ })).toBeDisabled();
  });

  it("shows the latest 10 claims first and loads more on demand", async () => {
    mockWarrantyClaims = Array.from({ length: 12 }, (_, index) => ({
      ...OPEN_CLAIM,
      id: `claim${index + 1}`,
      invoiceLineId: `line${index + 1}`,
      openedAt: `2026-07-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
    }));
    const user = userEvent.setup();
    renderWithProviders(<WarrantyCenterPage />);

    await user.click(screen.getByRole("button", { name: /طلبات الضمان/ }));

    expect(screen.getAllByRole("button", { name: /استبدال/ })).toHaveLength(10);
    await user.click(screen.getByRole("button", { name: /عرض المزيد \(2 متبقي\)/ }));
    expect(screen.getAllByRole("button", { name: /استبدال/ })).toHaveLength(12);
  });
});
