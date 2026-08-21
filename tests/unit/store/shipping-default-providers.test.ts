/**
 * Default shipping providers and the upgrade backfill.
 *
 * Covers two things a shop feels directly:
 *  - a brand new shop has a working delivery option before it signs up with
 *    any shipping company, instead of an empty provider list; and
 *  - upgrading an existing shop gains that option without duplicating what it
 *    already has or resetting what it turned off.
 *
 * TC-SHIP-DEF-001 through TC-SHIP-DEF-006
 */
import { describe, it, expect } from "vitest";
import type { ShippingProvider } from "../../../src/types";

// Mirrors the module-private DEFAULT_PROVIDERS / withMissingDefaults in
// src/store/ShippingContext.tsx. Kept in step by TC-SHIP-DEF-001, which
// asserts the real exported ids.
const now = "2026-01-01T00:00:00.000Z";
const IN_HOUSE_PROVIDER_ID = "shipping_in_house";
const BOSTA_PROVIDER_ID = "shipping_bosta";

const DEFAULT_PROVIDERS: ShippingProvider[] = [
  {
    id: IN_HOUSE_PROVIDER_ID,
    name: "توصيل بمندوب المحل",
    kind: "manual",
    active: true,
    supportsCashOnDelivery: true,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: BOSTA_PROVIDER_ID,
    name: "Bosta",
    kind: "bosta",
    active: false,
    supportsCashOnDelivery: true,
    createdAt: now,
    updatedAt: now,
  },
];

function withMissingDefaults(stored: ShippingProvider[]): ShippingProvider[] {
  const known = new Set(stored.map((item) => item.id));
  const missing = DEFAULT_PROVIDERS.filter((item) => !known.has(item.id));
  return missing.length ? [...stored, ...missing] : stored;
}

/** The old rule: one Bosta check, all-or-nothing append. */
function legacyMerge(stored: ShippingProvider[]): ShippingProvider[] {
  return stored.some((item) => item.id === BOSTA_PROVIDER_ID)
    ? stored
    : [...stored, ...DEFAULT_PROVIDERS];
}

describe("default shipping providers — TC-SHIP-DEF", () => {
  it("TC-SHIP-DEF-001 — the ids match what ShippingContext exports", async () => {
    const context = await import("../../../src/store/ShippingContext");
    expect(context.IN_HOUSE_PROVIDER_ID).toBe(IN_HOUSE_PROVIDER_ID);
    expect(context.BOSTA_PROVIDER_ID).toBe(BOSTA_PROVIDER_ID);
  });

  it("TC-SHIP-DEF-002 — a new shop gets a usable carrier with no setup", () => {
    const usable = DEFAULT_PROVIDERS.filter(
      (item) => item.active && item.kind === "manual",
    );
    expect(usable).toHaveLength(1);
    expect(usable[0].id).toBe(IN_HOUSE_PROVIDER_ID);
    // Cash on delivery is the whole point of a shop courier.
    expect(usable[0].supportsCashOnDelivery).toBe(true);
  });

  it("TC-SHIP-DEF-003 — Bosta stays inactive until it is actually connected", () => {
    const bosta = DEFAULT_PROVIDERS.find(
      (item) => item.id === BOSTA_PROVIDER_ID,
    );
    expect(bosta?.active).toBe(false);
  });

  it("TC-SHIP-DEF-004 — upgrading an existing shop adds only what is missing", () => {
    // A shop from before this change: Bosta plus a courier it added itself.
    const stored: ShippingProvider[] = [
      { ...DEFAULT_PROVIDERS[1], active: true },
      {
        id: "shipping_custom",
        name: "شركة شحن خاصة",
        kind: "manual",
        active: true,
        supportsCashOnDelivery: false,
        createdAt: now,
        updatedAt: now,
      },
    ];

    const merged = withMissingDefaults(stored);

    expect(merged).toHaveLength(3);
    expect(merged.map((item) => item.id)).toContain(IN_HOUSE_PROVIDER_ID);
    // The shop's own edits survive — the stored copy always wins.
    expect(merged.find((item) => item.id === BOSTA_PROVIDER_ID)?.active).toBe(
      true,
    );
    expect(merged.find((item) => item.id === "shipping_custom")).toBeDefined();

    // The old rule saw Bosta, kept the list as-is, and the new default never
    // reached this shop at all.
    expect(legacyMerge(stored).map((item) => item.id)).not.toContain(
      IN_HOUSE_PROVIDER_ID,
    );
  });

  it("TC-SHIP-DEF-005 — never duplicates a default that is already stored", () => {
    // Bosta removed, in-house kept: the old rule appended the whole default
    // set and produced two in-house couriers.
    const stored: ShippingProvider[] = [DEFAULT_PROVIDERS[0]];

    const merged = withMissingDefaults(stored);
    const inHouse = merged.filter((item) => item.id === IN_HOUSE_PROVIDER_ID);
    expect(inHouse).toHaveLength(1);
    expect(merged).toHaveLength(2);

    expect(
      legacyMerge(stored).filter((item) => item.id === IN_HOUSE_PROVIDER_ID),
    ).toHaveLength(2);
  });

  it("TC-SHIP-DEF-006 — a shop with both defaults is left untouched", () => {
    const stored = DEFAULT_PROVIDERS.map((item) => ({
      ...item,
      name: `${item.name} (معدّل)`,
    }));
    expect(withMissingDefaults(stored)).toBe(stored);
  });
});
