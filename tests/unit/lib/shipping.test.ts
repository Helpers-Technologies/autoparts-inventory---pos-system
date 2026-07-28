import { describe, expect, it } from "vitest";
import {
  bostaPublicTrackingUrl,
  bostaStatus,
  resolveShippingRate,
  translateBostaError,
} from "../../../src/lib/shipping";
import type { ShippingRate } from "../../../src/types";

const base = {
  providerId: "provider-1",
  fee: 50,
  active: true,
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
} as const;

describe("shipping pricing", () => {
  it("builds the current Arabic Bosta tracking URL", () => {
    expect(bostaPublicTrackingUrl(" 81209289 ")).toBe(
      "https://bosta.co/ar-eg/tracking-shipments?shipment-number=81209289",
    );
  });

  it("selects district then city then governorate", () => {
    const rates: ShippingRate[] = [
      { ...base, id: "gov", governorate: "القاهرة" },
      { ...base, id: "city", governorate: "القاهره", city: "مدينة نصر", fee: 60 },
      { ...base, id: "district", governorate: "القاهرة", city: "مدينه نصر", district: "الحي السابع", fee: 70 },
    ];
    expect(resolveShippingRate(rates, "provider-1", { governorate: "القاهرة", city: "مدينة نصر", district: "الحي السابع" })?.id).toBe("district");
    expect(resolveShippingRate(rates, "provider-1", { governorate: "القاهرة", city: "مدينة نصر" })?.id).toBe("city");
  });

  it("maps delivered and exception Bosta states", () => {
    expect(bostaStatus(45).status).toBe("delivered");
    expect(bostaStatus(47).status).toBe("exception");
  });

  it("translates the inactive Bosta bundle response into actionable Arabic", () => {
    const message = translateBostaError(
      "Active bundle subscription required to create orders",
    );
    expect(message).toContain("باقة شحن نشطة");
    expect(message).toContain("فعّل أو اشترِ باقة");
    expect(message).not.toContain("Active bundle");
  });

  it("never exposes an unknown English API response to the cashier", () => {
    expect(translateBostaError("Unexpected carrier validation failure"))
      .toBe("رفضت Bosta تنفيذ العملية. راجع حالة الحساب وبيانات الشحنة، ثم أعد المحاولة.");
  });

  it("explains webhook infrastructure failures in Arabic", () => {
    expect(translateBostaError("webhook_dns_unavailable")).toContain("DNS");
    expect(translateBostaError("webhook_service_not_configured")).toContain(
      "config.php",
    );
    expect(translateBostaError("webhook_database_unavailable")).toContain(
      "قاعدة البيانات",
    );
  });
});
