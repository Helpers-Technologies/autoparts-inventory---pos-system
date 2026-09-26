// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { cleanup, screen, waitFor } from "@testing-library/react";
import { LicenseAndUpdatesPage } from "../../src/pages/LicenseAndUpdatesPage";
import { renderWithProviders } from "../helpers/render";

const mockActivateLicense = vi.fn();

vi.mock("../../src/store/AppContext", () => ({
  useApp: () => ({
    currentUser: null,
    activateLicense: mockActivateLicense,
    licenseStatus: {
      state: "active",
      message: "الترخيص نشط",
      machineCode: "MACHINE-123",
      license: {
        licenseId: "LIC-1",
        plan: "basic",
        subscriptionType: "lifetime",
        subscriptionStartDate: "2026-01-01T00:00:00.000Z",
        subscriptionExpiresAt: null,
        warrantyStartDate: null,
        warrantyExpiresAt: null,
        issuedAt: "2026-01-01T00:00:00.000Z",
        machineHash: "HASH",
        signature: "sig",
      },
    },
  }),
}));

vi.mock("../../src/components/updates/UpdateSettingsCard", () => ({
  UpdateSettingsCard: () => null,
}));

describe("LicenseAndUpdatesPage activation result contract", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  async function submitSerial(serial = "APLIC.TEST") {
    const user = userEvent.setup();
    renderWithProviders(<LicenseAndUpdatesPage />);
    await user.click(screen.getByRole("button", { name: /إدارة الاشتراك/ }));
    await user.type(screen.getByPlaceholderText("APLIC..."), serial);
    await user.click(screen.getByRole("button", { name: "تطبيق السيريال وتحديث الترخيص" }));
  }

  it("treats the shared { ok: true, status } response as success", async () => {
    mockActivateLicense.mockResolvedValue({
      ok: true,
      status: { state: "active", message: "تم التفعيل", machineCode: "MACHINE-123", license: null },
    });

    await submitSerial();

    await waitFor(() => expect(mockActivateLicense).toHaveBeenCalledWith("APLIC.TEST"));
    expect(await screen.findByText("تم تحديث الترخيص")).toBeInTheDocument();
    expect(screen.queryByText("فشل التفعيل")).not.toBeInTheDocument();
  });

  it("uses status.message from the shared { ok: false, status } response", async () => {
    mockActivateLicense.mockResolvedValue({
      ok: false,
      status: { state: "inactive", message: "السيريال غير صالح", machineCode: "MACHINE-123", license: null },
    });

    await submitSerial("APLIC.BAD");

    expect(await screen.findByText("فشل التفعيل")).toBeInTheDocument();
    expect(screen.getByText("السيريال غير صالح")).toBeInTheDocument();
  });
});
