// @vitest-environment jsdom
/**
 * VehicleCatalogPage — bulk fitment nav-state handoff.
 *
 * Tonight's change: ProductsPage's "ربط توافق سيارة" bulk-action button
 * navigates here with `location.state.bulkFitmentProductIds` (a product id
 * array). A useEffect reads that on mount, pre-selects those ids into
 * bulkSelectedProductIds, and opens the bulk-fitment dialog — this test
 * exercises that handoff, not the rest of the (very large) page.
 *
 * TC-COMP-VCAT-001
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import { VehicleCatalogPage } from "../../src/pages/VehicleCatalogPage";
import { renderWithProviders } from "../helpers/render";

// ── Module-level mocks ────────────────────────────────────────────────────────

const mockUseVehicleCatalog = vi.fn();
const mockUseCatalog = vi.fn();

vi.mock("../../src/store/VehicleCatalogContext", () => ({ useVehicleCatalog: () => mockUseVehicleCatalog() }));
vi.mock("../../src/store/CatalogContext", () => ({ useCatalog: () => mockUseCatalog() }));

// Not under test here — stub it out so its own useVehicleCatalog/useToast
// usage doesn't need separate satisfying.
vi.mock("../../src/features/vehicles/VehicleSpecializationDialog", () => ({
  VehicleSpecializationDialog: () => null,
}));

function emptyCatalog() {
  return {
    specializedVehicleMakes: [],
    vehicleMakes: [],
    vehicleModels: [],
    vehicleGenerations: [],
    vehicleEngines: [],
    vehicleCatalogPreferences: { includeAllMakes: true, selectedCountryCodes: [], selectedMakeIds: [] },
    addVehicleMake: vi.fn(),
    updateVehicleMake: vi.fn(),
    deleteVehicleMake: vi.fn(),
    addVehicleModel: vi.fn(),
    updateVehicleModel: vi.fn(),
    deleteVehicleModel: vi.fn(),
    addVehicleGeneration: vi.fn(),
    updateVehicleGeneration: vi.fn(),
    deleteVehicleGeneration: vi.fn(),
    addVehicleEngine: vi.fn(),
    updateVehicleEngine: vi.fn(),
    deleteVehicleEngine: vi.fn(),
    addBulkProductFitments: vi.fn(),
    updateVehicleCatalogPreferences: vi.fn(),
  };
}

describe("VehicleCatalogPage — TC-COMP-VCAT", () => {
  afterEach(() => {
    cleanup();
  });

  it("TC-COMP-VCAT-001 — arriving with bulkFitmentProductIds in nav state opens the bulk fitment tool pre-selected", () => {
    mockUseVehicleCatalog.mockReturnValue(emptyCatalog());
    mockUseCatalog.mockReturnValue({
      products: [
        { id: "p1", code: "P1", name: "منتج واحد", category: "فلاتر", unit: "قطعة", quantity: 5, archived: false },
        { id: "p2", code: "P2", name: "منتج اتنين", category: "فلاتر", unit: "قطعة", quantity: 5, archived: false },
      ],
    });

    renderWithProviders(<VehicleCatalogPage />, {
      initialEntries: [{ pathname: "/vehicle-catalog", state: { bulkFitmentProductIds: ["p1", "p2"] } }],
    });

    // The bulk fitment dialog auto-opened from nav state.
    expect(screen.getByText("أداة التوافق الجماعي لقطع الغيار")).toBeInTheDocument();
  });

  it("TC-COMP-VCAT-002 — arriving with no nav state does not open the bulk fitment tool", () => {
    mockUseVehicleCatalog.mockReturnValue(emptyCatalog());
    mockUseCatalog.mockReturnValue({ products: [] });

    renderWithProviders(<VehicleCatalogPage />, { initialEntries: ["/vehicle-catalog"] });

    expect(screen.queryByText("أداة التوافق الجماعي لقطع الغيار")).not.toBeInTheDocument();
  });
});
