// @vitest-environment jsdom
/**
 * AddressFields component tests.
 *
 * Regression cover for the carrier coupling: the governorate/city pickers
 * used to be fed by Bosta's coverage API, so with Bosta off (or simply not
 * connected yet) the governorate dropdown rendered DISABLED with the
 * placeholder "فعّل ربط Bosta أولًا" and no address could be recorded at all
 * — on a counter sale that never ships anywhere. The fields now come from the
 * shop's own Egypt reference data, and a connected carrier only enriches
 * them.
 *
 * TC-COMP-ADDR-001 through TC-COMP-ADDR-007
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { screen, cleanup } from "@testing-library/react";
import { AddressFields, type AddressDraft } from "../../src/features/shipping/AddressFields";
import { renderWithProviders } from "../helpers/render";

// ── Module-level mocks ───────────────────────────────────────────────────────

const mockGetBostaCities = vi.fn();
const mockGetBostaDistricts = vi.fn();
let mockBostaConfig = { enabled: false, configured: false };
let mockFeatureEnabled = true;

vi.mock("../../src/store/ShippingContext", () => ({
  BOSTA_PROVIDER_ID: "bosta",
  useShipping: () => ({
    bostaConfig: mockBostaConfig,
    getBostaCities: mockGetBostaCities,
    getBostaDistricts: mockGetBostaDistricts,
  }),
}));

vi.mock("../../src/lib/useFeatures", () => ({
  useFeatures: () => ({ isEnabled: () => mockFeatureEnabled }),
}));

const EMPTY: AddressDraft = {
  label: "المنزل",
  governorate: "",
  city: "",
  addressLine: "",
};

function renderFields(value: Partial<AddressDraft> = {}) {
  const onChange = vi.fn();
  renderWithProviders(
    <AddressFields value={{ ...EMPTY, ...value }} onChange={onChange} />,
  );
  return onChange;
}

describe("AddressFields — TC-COMP-ADDR", () => {
  beforeEach(() => {
    mockBostaConfig = { enabled: false, configured: false };
    mockFeatureEnabled = true;
    mockGetBostaCities.mockReset().mockResolvedValue({ ok: true, cities: [] });
    mockGetBostaDistricts
      .mockReset()
      .mockResolvedValue({ ok: true, districts: [] });
  });

  afterEach(() => {
    cleanup();
  });

  it("TC-COMP-ADDR-001 — the governorate picker works with no carrier connected", async () => {
    const user = userEvent.setup();
    renderFields();

    // Used to render disabled with "فعّل ربط Bosta أولًا".
    expect(screen.queryByText(/فعّل ربط Bosta/)).not.toBeInTheDocument();

    const governorate = screen.getByTitle("اختر المحافظة");
    expect(governorate).not.toBeDisabled();

    await user.click(governorate);
    expect(screen.getByText("القاهرة")).toBeInTheDocument();
    expect(screen.getByText("الجيزة")).toBeInTheDocument();
  });

  it("TC-COMP-ADDR-002 — never calls the carrier API while it is disconnected", () => {
    renderFields();
    expect(mockGetBostaCities).not.toHaveBeenCalled();
  });

  it("TC-COMP-ADDR-003 — picking a governorate offers that governorate's cities", async () => {
    const user = userEvent.setup();
    renderFields({ governorate: "الجيزة" });

    await user.click(screen.getByTitle("اختر المدينة / المركز"));
    expect(screen.getByText("6 أكتوبر")).toBeInTheDocument();
    expect(screen.getByText("الهرم")).toBeInTheDocument();
    // A different governorate's city must not leak into the list.
    expect(screen.queryByText("المنصورة")).not.toBeInTheDocument();
  });

  it("TC-COMP-ADDR-004 — changing governorate clears the stale city and district", async () => {
    const user = userEvent.setup();
    const onChange = renderFields({
      governorate: "الجيزة",
      city: "6 أكتوبر",
      district: "الحي السابع",
    });

    await user.click(screen.getByTitle("الجيزة"));
    await user.click(screen.getByText("القاهرة"));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        governorate: "القاهرة",
        city: "",
        district: "",
      }),
    );
  });

  it("TC-COMP-ADDR-005 — fields are optional by default and mandatory only when asked", () => {
    // A walk-in customer record must not demand a delivery address.
    const { container } = renderWithProviders(
      <AddressFields value={EMPTY} onChange={vi.fn()} />,
    );
    expect(container.querySelectorAll(".text-red-500").length).toBe(0);

    cleanup();

    const delivery = renderWithProviders(
      <AddressFields value={EMPTY} onChange={vi.fn()} required />,
    );
    // المحافظة + المدينة + العنوان بالتفصيل
    expect(delivery.container.querySelectorAll(".text-red-500").length).toBe(3);
  });

  it("TC-COMP-ADDR-006 — a governorate outside the built-in list still shows as chosen", () => {
    // Imported or legacy data must not silently read as "nothing selected".
    renderFields({ governorate: "محافظة غير معروفة" });
    expect(screen.getByTitle("محافظة غير معروفة")).toBeInTheDocument();
  });

  it("TC-COMP-ADDR-007 — a connected carrier enriches rather than gates", async () => {
    mockBostaConfig = { enabled: true, configured: true };
    mockGetBostaCities.mockResolvedValue({
      ok: true,
      cities: [{ id: "city_giza", name: "Giza", nameAr: "الجيزة" }],
    });
    mockGetBostaDistricts.mockResolvedValue({
      ok: true,
      districts: [
        {
          id: "d1",
          name: "Haram",
          nameAr: "الهرم",
          zoneId: "z1",
          zoneName: "Giza",
          zoneNameAr: "الجيزة",
        },
      ],
    });

    const onChange = renderFields({ governorate: "الجيزة" });

    // The carrier's ids get attached to the address in the background...
    await vi.waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          bosta: expect.objectContaining({ cityId: "city_giza" }),
        }),
      ),
    );
    // ...while the governorate still comes from the shop's own list.
    expect(screen.getByTitle("الجيزة")).toBeInTheDocument();
  });
});
