// @vitest-environment jsdom
/**
 * CustomerGaragePage component tests.
 *
 * The page was rewritten to drop its own inline add-vehicle form in favor of
 * the shared <CustomerVehicleFormDialog>, and gained a "تعديل بيانات السيارة"
 * (edit) button on the selected vehicle card that opens that same dialog with
 * editingVehicle set.
 *
 * Covers:
 *  - Selecting a registered vehicle shows its detail card with an edit button.
 *  - Clicking the edit button opens CustomerVehicleFormDialog in edit mode
 *    (title "تعديل بيانات السيارة") without throwing.
 *
 * TC-COMP-GARAGE-001, TC-COMP-GARAGE-002
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { screen, within, cleanup } from "@testing-library/react";
import { CustomerGaragePage } from "../../src/pages/CustomerGaragePage";
import { renderWithProviders } from "../helpers/render";
import type { Customer, CustomerVehicle, VehicleMake } from "../../src/types";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const CUSTOMER: Customer = {
  id: "cus1",
  code: "CUS-0001",
  name: "أحمد علي",
  phone: "01000000000",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const MAKE: VehicleMake = {
  id: "make1",
  name: "Toyota",
  nameAr: "تويوتا",
  slug: "toyota",
  active: true,
  source: "seed",
};

const VEHICLE: CustomerVehicle = {
  id: "veh1",
  customerId: "cus1",
  vin: "1HGCM82633A004352",
  plateNumber: "أ ب ج 1234",
  makeId: "make1",
  year: 2020,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const archiveCustomerVehicle = vi.fn();
const addCustomerVehicle = vi.fn();
const updateCustomerVehicle = vi.fn();

// ── Module-level mocks ───────────────────────────────────────────────────────
// Every store hook CustomerGaragePage imports, plus every store hook its child
// <CustomerVehicleFormDialog> imports (useAutoPartsPro/useCatalog/
// useVehicleCatalog/useToast) must be mocked so the render doesn't crash with
// "useX must be used within...". useToast is left unmocked — renderWithProviders
// already wraps the tree in the real ToastProvider.

vi.mock("../../src/store/AutoPartsProContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/store/AutoPartsProContext")>();
  return {
    ...actual, // keep real isValidVin / vehicleDisplayName / normalizeVin / inferMakeNameFromVin
    useAutoPartsPro: () => ({
      customerVehicles: [VEHICLE],
      warrantyClaims: [],
      branches: [],
      branchStocks: [],
      stockTransfers: [],
      priceTiers: [],
      addCustomerVehicle,
      updateCustomerVehicle,
      archiveCustomerVehicle,
      addWarrantyClaim: vi.fn(),
      updateWarrantyClaim: vi.fn(),
      addBranch: vi.fn(),
      updateBranch: vi.fn(),
      transferStock: vi.fn(),
      branchQuantity: vi.fn(() => 0),
      consumeBranchStock: vi.fn(),
      receivePurchaseStock: vi.fn(),
      addPriceTier: vi.fn(),
      updatePriceTier: vi.fn(),
      deletePriceTier: vi.fn(),
      reloadProData: vi.fn(),
    }),
  };
});

vi.mock("../../src/store/CatalogContext", () => ({
  useCatalog: () => ({
    customers: [CUSTOMER],
  }),
}));

vi.mock("../../src/store/InvoicingContext", () => ({
  useInvoicing: () => ({
    salesInvoices: [],
  }),
}));

vi.mock("../../src/store/SettingsContext", () => ({
  useSettings: () => ({
    settings: {
      companyName: "Helpers",
      companyNameAr: "هيلبرز",
      invoiceFooter: "",
      currency: "ج.م",
      arabicLabels: true,
      logoText: "H",
      logoImage: "",
    },
    updateSettings: vi.fn(),
  }),
}));

vi.mock("../../src/store/VehicleCatalogContext", () => ({
  useVehicleCatalog: () => ({
    vehicleMakes: [MAKE],
    specializedVehicleMakes: [MAKE],
    vehicleCatalogPreferences: { visibleMakeIds: [] },
    vehicleModels: [],
    vehicleGenerations: [],
    vehicleEngines: [],
    productFitments: [],
    productAlternatives: [],
  }),
}));

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("CustomerGaragePage — TC-COMP-GARAGE", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("TC-COMP-GARAGE-001 — selecting a registered vehicle shows the edit button on its detail card", async () => {
    const user = userEvent.setup();
    renderWithProviders(<CustomerGaragePage />);

    // Select the one seeded vehicle from the list.
    await user.click(screen.getByText("أحمد علي"));

    expect(
      screen.getByRole("button", { name: /تعديل بيانات السيارة/ })
    ).toBeInTheDocument();
  });

  it("TC-COMP-GARAGE-002 — clicking the edit button opens CustomerVehicleFormDialog in edit mode without throwing", async () => {
    const user = userEvent.setup();
    renderWithProviders(<CustomerGaragePage />);

    await user.click(screen.getByText("أحمد علي"));
    const editButton = screen.getByRole("button", { name: /تعديل بيانات السيارة/ });

    await expect(user.click(editButton)).resolves.not.toThrow();

    // The shared dialog now renders in edit mode with the vehicle's data pre-filled.
    // Dialog's role="dialog" node has no aria-labelledby, so match on its title text.
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("تعديل بيانات السيارة")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /أحمد علي/ }).selected).toBe(true);
  });
});
