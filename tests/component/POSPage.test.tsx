// @vitest-environment jsdom
/**
 * POSPage component tests — branch lock/indicator only.
 *
 * Tonight's change: POSPage used to silently default selectedBranchId to the
 * main/first branch with no visible indicator and no way to change it. It now
 * (a) defaults to currentUser.branchId when the cashier is restricted to one
 * branch, showing it as a fixed (non-editable) badge, and (b) shows a real
 * Select to switch branches when the user is unrestricted (no branchId) and
 * more than one active branch exists.
 *
 * The full cart/checkout flow (credit-limit enforcement, adding products,
 * completing a sale) is not exercised here — it requires building up cart
 * state through many UI interactions across an already very large page and
 * is out of scope for this smoke test.
 *
 * TC-COMP-POS-001, TC-COMP-POS-002
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import { POSPage } from "../../src/pages/POSPage";
import { renderWithProviders } from "../helpers/render";
import { createPermissions } from "../../src/lib/permissions";
import type { AppUser, Branch, CashierShift } from "../../src/types";

// ── Module-level mocks ────────────────────────────────────────────────────────

const mockUseAuth = vi.fn();
const mockUseCatalog = vi.fn();
const mockUseInvoicing = vi.fn();
const mockUseReporting = vi.fn();
const mockUseAutoPartsPro = vi.fn();
const mockUseVehicleCatalog = vi.fn();
const mockUseFeatures = vi.fn();

vi.mock("../../src/store/AuthContext", () => ({ useAuth: () => mockUseAuth() }));
vi.mock("../../src/store/CatalogContext", () => ({ useCatalog: () => mockUseCatalog() }));
vi.mock("../../src/store/InvoicingContext", () => ({ useInvoicing: () => mockUseInvoicing() }));
vi.mock("../../src/store/ReportingContext", () => ({ useReporting: () => mockUseReporting() }));
vi.mock("../../src/store/VehicleCatalogContext", () => ({ useVehicleCatalog: () => mockUseVehicleCatalog() }));
vi.mock("../../src/lib/useFeatures", () => ({ useFeatures: () => mockUseFeatures() }));

// Real module — keep productVehicleFitmentStatus/vehicleDisplayName as-is,
// only stub the hook.
vi.mock("../../src/store/AutoPartsProContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/store/AutoPartsProContext")>();
  return { ...actual, useAutoPartsPro: () => mockUseAutoPartsPro() };
});

// Child dialogs are not what this test covers — stub them out so their own
// hook requirements don't have to be satisfied here.
vi.mock("../../src/features/customers/CustomerFormDialog", () => ({ CustomerFormDialog: () => null }));
vi.mock("../../src/features/vehicles/CustomerVehicleFormDialog", () => ({ CustomerVehicleFormDialog: () => null }));
vi.mock("../../src/components/shifts/OpenShiftDialog", () => ({ OpenShiftDialog: () => null }));
vi.mock("../../src/components/shifts/CloseShiftDialog", () => ({ CloseShiftDialog: () => null }));
vi.mock("../../src/components/shifts/ShiftReportModal", () => ({ ShiftReportModal: () => null }));
vi.mock("../../src/features/returns/POSReturnLookupDialog", () => ({ POSReturnLookupDialog: () => null }));
vi.mock("../../src/features/returns/SalesReturnDialog", () => ({ SalesReturnDialog: () => null }));

// ── Fixtures ──────────────────────────────────────────────────────────────────

function branch(id: string, name: string, isMain = false): Branch {
  return { id, code: id.toUpperCase(), name, isMain, active: true, createdAt: "2026-01-01T00:00:00.000Z" };
}

function cashier(branchId?: string): AppUser {
  return {
    id: "u-cashier",
    name: "الكاشير",
    username: "cashier",
    passwordHash: "[REDACTED]",
    role: "employee",
    permissions: createPermissions(true),
    branchId,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

const OPEN_SHIFT: CashierShift = {
  id: "shift-1",
  shiftNumber: 1,
  cashierId: "u-cashier",
  cashierName: "الكاشير",
  cashierUsername: "cashier",
  openedAt: "2026-01-01T08:00:00.000Z",
  status: "open",
  openingCash: 0,
  expectedCash: 0,
  totalSalesCount: 0,
  totalSalesAmount: 0,
  totalCashSales: 0,
  totalVisaSales: 0,
  totalCreditSales: 0,
  totalRefunds: 0,
  totalExpenses: 0,
  salesInvoiceIds: [],
};

function setupMocks(currentUser: AppUser, branches: Branch[]) {
  mockUseAuth.mockReturnValue({ currentUser });
  mockUseCatalog.mockReturnValue({ products: [], customers: [] });
  mockUseInvoicing.mockReturnValue({
    salesInvoices: [],
    addSalesInvoice: vi.fn(),
    applyCustomerCredit: vi.fn(),
    activeShift: OPEN_SHIFT,
  });
  mockUseReporting.mockReturnValue({ customerBalance: () => 0 });
  mockUseAutoPartsPro.mockReturnValue({
    branches,
    branchQuantity: () => 0,
    consumeBranchStock: vi.fn(),
    customerVehicles: [],
  });
  mockUseVehicleCatalog.mockReturnValue({
    productAlternatives: [],
    productFitments: [],
    vehicleMakes: [],
    vehicleModels: [],
  });
  mockUseFeatures.mockReturnValue({ isEnabled: () => true });
}

describe("POSPage — TC-COMP-POS", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
    (window as unknown as Record<string, unknown>).desktopAPI = undefined;
  });

  afterEach(() => {
    cleanup();
    delete (window as unknown as Record<string, unknown>).desktopAPI;
  });

  it("TC-COMP-POS-001 — a cashier restricted to a branch sees it as a fixed badge, not a switcher", () => {
    const branches = [branch("branch_main", "الفرع الرئيسي", true), branch("branch_2", "فرع المعادي")];
    setupMocks(cashier("branch_2"), branches);

    renderWithProviders(<POSPage />);

    expect(screen.getByText("الفرع:")).toBeInTheDocument();
    expect(screen.getByText("فرع المعادي")).toBeInTheDocument();
    // Locked to one branch — no dropdown to switch away from it.
    expect(screen.queryByRole("combobox", { name: "" })).not.toBeInTheDocument();
    const branchRow = screen.getByText("الفرع:").parentElement!;
    expect(branchRow.querySelector("select")).not.toBeInTheDocument();
  });

  it("TC-COMP-POS-002 — an unrestricted cashier with 2+ branches gets a real branch switcher", () => {
    const branches = [branch("branch_main", "الفرع الرئيسي", true), branch("branch_2", "فرع المعادي")];
    setupMocks(cashier(undefined), branches);

    renderWithProviders(<POSPage />);

    expect(screen.getByText("الفرع:")).toBeInTheDocument();
    const branchRow = screen.getByText("الفرع:").parentElement!;
    const select = branchRow.querySelector("select");
    expect(select).toBeInTheDocument();
    expect(select).toHaveValue("branch_main");
    expect(select!.querySelectorAll("option")).toHaveLength(2);
  });
});
