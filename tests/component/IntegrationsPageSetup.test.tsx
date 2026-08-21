// @vitest-environment jsdom
/**
 * IntegrationsPage — Bosta setup reachability.
 *
 * Regression cover for the activation deadlock: the "إدارة الربط" button that
 * opens the setup panel was disabled while the integration was off, and the
 * panel holding the API key field only rendered when it was on — but the main
 * process refuses to switch Bosta on until an API key is stored. The two
 * requirements blocked each other, so a fresh install could never connect
 * Bosta at all: the toggle just answered "أدخل مفتاح API الخاص بحساب Bosta
 * أولًا" with no way to enter one.
 *
 * TC-COMP-INTEG-001 through TC-COMP-INTEG-004
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { screen, cleanup } from "@testing-library/react";
import { IntegrationsPage } from "../../src/pages/IntegrationsPage";
import { renderWithProviders } from "../helpers/render";

const mockSaveBostaConfig = vi.fn();
let mockBostaConfig: Record<string, unknown> = {
  enabled: false,
  configured: false,
  autoTrackingEnabled: true,
  autoTrackingIntervalMinutes: 5,
  defaultPackageType: "SMALL",
  allowOpenPackage: false,
};

vi.mock("../../src/store/ShippingContext", () => ({
  BOSTA_PROVIDER_ID: "bosta",
  useShipping: () => ({
    bostaConfig: mockBostaConfig,
    saveBostaConfig: mockSaveBostaConfig,
    testBostaConnection: vi.fn(),
    testBostaWebhook: vi.fn(),
    generateBostaWebhookSecrets: vi.fn(),
    trackBostaShipment: vi.fn(),
    deliveryOrders: [],
    providers: [],
    updateDeliveryOrder: vi.fn(),
    getBostaCities: vi.fn().mockResolvedValue({ ok: true, cities: [] }),
    getBostaDistricts: vi.fn().mockResolvedValue({ ok: true, districts: [] }),
  }),
}));

vi.mock("../../src/lib/useFeatures", () => ({
  useFeatures: () => ({ isEnabled: () => true }),
}));

describe("IntegrationsPage — TC-COMP-INTEG", () => {
  beforeEach(() => {
    mockBostaConfig = {
      enabled: false,
      configured: false,
      autoTrackingEnabled: true,
      autoTrackingIntervalMinutes: 5,
      defaultPackageType: "SMALL",
      allowOpenPackage: false,
    };
    mockSaveBostaConfig.mockReset().mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    cleanup();
  });

  it("TC-COMP-INTEG-001 — the setup button is usable while the integration is off", () => {
    renderWithProviders(<IntegrationsPage />);
    expect(screen.getByRole("button", { name: /إدارة الربط/ })).toBeEnabled();
  });

  it("TC-COMP-INTEG-002 — opening setup while off reveals the API key field", async () => {
    const user = userEvent.setup();
    renderWithProviders(<IntegrationsPage />);

    await user.click(screen.getByRole("button", { name: /إدارة الربط/ }));

    expect(screen.getByPlaceholderText("الصق المفتاح هنا")).toBeInTheDocument();
    expect(screen.getByText(/الربط متوقف حاليًا/)).toBeInTheDocument();
  });

  it("TC-COMP-INTEG-003 — flipping the switch with no key opens setup instead of failing", async () => {
    const user = userEvent.setup();
    renderWithProviders(<IntegrationsPage />);

    await user.click(
      screen.getByRole("switch", { name: "تشغيل تكامل بوسطه" }),
    );

    // No pointless round trip that could only come back api_key_missing...
    expect(mockSaveBostaConfig).not.toHaveBeenCalled();
    // ...the owner is put in front of the field they need instead.
    expect(screen.getByPlaceholderText("الصق المفتاح هنا")).toBeInTheDocument();
  });

  it("TC-COMP-INTEG-004 — a key typed into the panel enables in one step", async () => {
    const user = userEvent.setup();
    renderWithProviders(<IntegrationsPage />);

    await user.click(screen.getByRole("button", { name: /إدارة الربط/ }));
    await user.type(
      screen.getByPlaceholderText("الصق المفتاح هنا"),
      "bosta_live_key_1234567890",
    );
    await user.click(
      screen.getByRole("switch", { name: "تشغيل تكامل بوسطه" }),
    );

    expect(mockSaveBostaConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "bosta_live_key_1234567890",
        enabled: true,
      }),
    );
  });
});
