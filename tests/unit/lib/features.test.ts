import { describe, it, expect } from "vitest";
import {
  FEATURES,
  FEATURE_CATEGORIES,
  FEATURE_CATEGORY_BY_KEY,
  FEATURE_MAP,
  isAllowedByLicense,
  defaultFeatureState,
  isFeatureEnabled,
  type FeatureKey,
} from "../../../src/lib/features";
import type { LicensePayload, Settings } from "../../../src/types";

function makeLicense(features?: string[]): LicensePayload {
  return {
    licenseId: "LIC-1",
    machineHash: "HASH",
    subscriptionType: "lifetime",
    subscriptionStartDate: "2026-01-01",
    subscriptionExpiresAt: null,
    warrantyStartDate: null,
    warrantyExpiresAt: null,
    issuedAt: "2026-01-01",
    signature: "sig",
    ...(features !== undefined ? { features } : {}),
  };
}

function settingsWith(features?: Record<string, boolean>): Settings {
  return { features } as unknown as Settings;
}

describe("FEATURE_MAP", () => {
  it("indexes every feature def by its key", () => {
    expect(Object.keys(FEATURE_MAP)).toHaveLength(FEATURES.length);
    for (const f of FEATURES) {
      expect(FEATURE_MAP[f.key]).toBe(f);
    }
  });

  it("keeps quotations and stocktakes off by default", () => {
    expect(FEATURE_MAP.quotations.defaultEnabled).toBe(false);
    expect(FEATURE_MAP.stocktakes.defaultEnabled).toBe(false);
  });

  it("keeps creditPayment ON by default (pre-existing capability, gateable per package)", () => {
    expect(FEATURE_MAP.creditPayment.defaultEnabled).toBe(true);
  });

  it("assigns every feature to one clear category", () => {
    expect(FEATURE_CATEGORIES.length).toBeGreaterThan(0);
    for (const feature of FEATURES) {
      expect(FEATURE_CATEGORY_BY_KEY[feature.key]).toBeTruthy();
    }
  });

  it("keeps creditSales OFF by default because deferred sales are a paid add-on", () => {
    expect(FEATURE_MAP.creditSales.defaultEnabled).toBe(false);
  });
});

describe("isAllowedByLicense", () => {
  it("allows everything when the license is missing (back-compat)", () => {
    expect(isAllowedByLicense("quotations", null)).toBe(true);
    expect(isAllowedByLicense("quotations", undefined)).toBe(true);
  });

  it("allows everything when the feature list is empty", () => {
    expect(isAllowedByLicense("stocktakes", makeLicense([]))).toBe(true);
  });

  it("allows only the whitelisted keys when a package is present", () => {
    const lic = makeLicense(["salesInvoices", "products"]);
    expect(isAllowedByLicense("salesInvoices", lic)).toBe(true);
    expect(isAllowedByLicense("products", lic)).toBe(true);
    expect(isAllowedByLicense("quotations", lic)).toBe(false);
  });
});

describe("defaultFeatureState", () => {
  it("falls back to the built-in default for unpackaged serials", () => {
    expect(defaultFeatureState("salesInvoices", null)).toBe(true);
    expect(defaultFeatureState("quotations", null)).toBe(false);
  });

  it("falls back to the built-in default for an empty package list", () => {
    expect(defaultFeatureState("quotations", makeLicense([]))).toBe(false);
  });

  it("is driven by the package list when one is present", () => {
    const lic = makeLicense(["quotations"]);
    // In the package ⇒ ON even though its built-in default is false.
    expect(defaultFeatureState("quotations", lic)).toBe(true);
    // Outside the package ⇒ OFF even though its built-in default is true.
    expect(defaultFeatureState("salesInvoices", lic)).toBe(false);
  });
});

describe("isFeatureEnabled", () => {
  it("returns false when the license disallows the module (hard cap)", () => {
    const lic = makeLicense(["salesInvoices"]);
    // Even an explicit owner ON cannot widen past the license cap.
    expect(isFeatureEnabled("quotations", settingsWith({ quotations: true }), lic)).toBe(false);
  });

  it("honours an explicit owner override when allowed by the license", () => {
    expect(isFeatureEnabled("reports", settingsWith({ reports: false }), null)).toBe(false);
    expect(isFeatureEnabled("quotations", settingsWith({ quotations: true }), null)).toBe(true);
  });

  it("falls back to the default state when no override is set", () => {
    expect(isFeatureEnabled("salesInvoices", settingsWith({}), null)).toBe(true);
    expect(isFeatureEnabled("quotations", settingsWith({}), null)).toBe(false);
    expect(isFeatureEnabled("quotations", null, null)).toBe(false);
  });

  it("treats an undefined override as 'not set' (uses default), not as off", () => {
    const settings = settingsWith({ reports: undefined as unknown as boolean });
    expect(isFeatureEnabled("reports", settings, null)).toBe(true);
  });

  it("combines license package and owner hide-toggle", () => {
    const lic = makeLicense(["salesInvoices", "quotations"]);
    // Allowed + in package ⇒ default ON, owner hides it.
    expect(isFeatureEnabled("quotations", settingsWith({ quotations: false }), lic)).toBe(false);
    // Allowed + in package + no override ⇒ ON.
    expect(isFeatureEnabled("quotations", settingsWith({}), lic)).toBe(true);
  });

  it("creditSales: OFF by default, ON only when included in the package", () => {
    expect(isFeatureEnabled("creditSales", null, null)).toBe(false);
    expect(isFeatureEnabled("creditSales", settingsWith({ creditSales: true }), null)).toBe(false);
    expect(isFeatureEnabled("creditSales", settingsWith({}), makeLicense(["creditSales"]))).toBe(true);
    expect(isFeatureEnabled("creditSales", settingsWith({ creditSales: false }), makeLicense(["creditSales"]))).toBe(false);
  });

  it("allows every feature for a signed full-package wildcard", () => {
    expect(isAllowedByLicense("twoFactorAuth", makeLicense(["*"]))).toBe(true);
    expect(isAllowedByLicense("salesInvoices", makeLicense(["*"]))).toBe(true);
  });

  it("keeps two-factor authentication paid unless the signed package includes it", () => {
    expect(isAllowedByLicense("twoFactorAuth", null)).toBe(false);
    expect(isAllowedByLicense("twoFactorAuth", makeLicense(["twoFactorAuth"]))).toBe(true);
  });

  it("keeps the marketing hub paid and prevents a local toggle from bypassing its license", () => {
    expect(FEATURE_MAP.marketingHub.defaultEnabled).toBe(false);
    expect(isAllowedByLicense("marketingHub", null)).toBe(false);
    expect(isFeatureEnabled("marketingHub", settingsWith({ marketingHub: true }), null)).toBe(false);
    expect(isFeatureEnabled("marketingHub", settingsWith({}), makeLicense(["marketingHub"]))).toBe(true);
    expect(isAllowedByLicense("marketingHub", makeLicense(["*"]))).toBe(true);
  });

  it("evaluates every feature key without throwing", () => {
    for (const f of FEATURES) {
      const key: FeatureKey = f.key;
      expect(typeof isFeatureEnabled(key, null, null)).toBe("boolean");
    }
  });
});
