import { describe, it, expect } from "vitest";
import { isExpiringSoon, isExpired } from "../../../src/lib/utils";

/**
 * V4 bug-fix — Settings.expiryAlertDays makes the expiry-alert window
 * configurable (was a hard-coded 14 days). These predicates drive AlertsPage.
 * Dates are computed relative to "today" so the tests stay deterministic.
 */
function dateInDays(offset: number): string {
  // Build the string from LOCAL date parts — toISOString() would shift to UTC
  // and roll the day back in +ve timezones (e.g. Egypt UTC+2/+3).
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function prod(overrides: { hasExpiry?: boolean; expiryDate?: string }) {
  return { hasExpiry: true, ...overrides };
}

describe("isExpiringSoon", () => {
  it("flags a product expiring within the threshold", () => {
    expect(isExpiringSoon(prod({ expiryDate: dateInDays(5) }), 14)).toBe(true);
  });

  it("flags a product expiring exactly ON the threshold day (inclusive)", () => {
    expect(isExpiringSoon(prod({ expiryDate: dateInDays(14) }), 14)).toBe(true);
  });

  it("does NOT flag a product expiring one day past the threshold", () => {
    expect(isExpiringSoon(prod({ expiryDate: dateInDays(15) }), 14)).toBe(false);
  });

  it("respects a CUSTOM threshold — 30-day window catches a 20-day product", () => {
    const p = prod({ expiryDate: dateInDays(20) });
    expect(isExpiringSoon(p, 14)).toBe(false); // default window misses it
    expect(isExpiringSoon(p, 30)).toBe(true); // wider window catches it
  });

  it("a tighter 7-day window excludes a product 10 days out", () => {
    expect(isExpiringSoon(prod({ expiryDate: dateInDays(10) }), 7)).toBe(false);
  });

  it("does NOT flag an already-expired product (that's the 'expired' bucket)", () => {
    expect(isExpiringSoon(prod({ expiryDate: dateInDays(-3) }), 14)).toBe(false);
  });

  it("a product expiring TODAY is 'soon' (0 days, inclusive)", () => {
    expect(isExpiringSoon(prod({ expiryDate: dateInDays(0) }), 14)).toBe(true);
  });

  it("ignores products without expiry tracking or without a date", () => {
    expect(isExpiringSoon({ hasExpiry: false, expiryDate: dateInDays(2) }, 14)).toBe(false);
    expect(isExpiringSoon({ hasExpiry: true }, 14)).toBe(false);
  });
});

describe("isExpired", () => {
  it("flags a product whose date is in the past", () => {
    expect(isExpired(prod({ expiryDate: dateInDays(-1) }))).toBe(true);
  });

  it("does NOT flag a product expiring today or later", () => {
    expect(isExpired(prod({ expiryDate: dateInDays(0) }))).toBe(false);
    expect(isExpired(prod({ expiryDate: dateInDays(5) }))).toBe(false);
  });

  it("ignores products without expiry tracking", () => {
    expect(isExpired({ hasExpiry: false, expiryDate: dateInDays(-5) })).toBe(false);
  });

  it("a product is never both 'expiring soon' and 'expired'", () => {
    for (const offset of [-10, -1, 0, 1, 14, 15, 100]) {
      const p = prod({ expiryDate: dateInDays(offset) });
      expect(isExpiringSoon(p, 14) && isExpired(p)).toBe(false);
    }
  });
});
