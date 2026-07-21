import { describe, it, expect } from "vitest";
import {
  hasPermission,
  normalizePermissions,
  setPermission,
  setPermissionGroup,
  createPermissions,
  areAllPermissionsEnabled,
  normalizeUser,
} from "../../../src/lib/permissions";
import type { AppUser } from "../../../src/types";

function makeOwner(overrides: Partial<AppUser> = {}): AppUser {
  return {
    id: "u1",
    username: "owner",
    name: "Owner",
    passwordHash: "hash",
    role: "owner",
    permissions: createPermissions(true),
    createdAt: "2026-01-01",
    ...overrides,
  };
}

function makeEmployee(overrides: Partial<AppUser> = {}): AppUser {
  return {
    id: "u2",
    username: "emp",
    name: "Employee",
    passwordHash: "hash",
    role: "employee",
    permissions: createPermissions(false),
    createdAt: "2026-01-01",
    ...overrides,
  };
}

describe("hasPermission", () => {
  it("owner always has permission regardless of permission object", () => {
    const owner = makeOwner({ permissions: createPermissions(false) });
    expect(hasPermission(owner, "products", "add")).toBe(true);
    expect(hasPermission(owner, "reports", "view")).toBe(true);
    expect(hasPermission(owner, "salesInvoices", "delete")).toBe(true);
  });

  it("employee with no permissions is denied everything", () => {
    const emp = makeEmployee();
    expect(hasPermission(emp, "products", "view")).toBe(false);
    expect(hasPermission(emp, "salesInvoices", "add")).toBe(false);
    expect(hasPermission(emp, "cashbox", "spend")).toBe(false);
  });

  it("employee with specific permission is allowed that action only", () => {
    const emp = makeEmployee({
      permissions: {
        ...createPermissions(false),
        salesInvoices: { view: true, add: false, edit: false, receive: false, cancel: false, delete: false },
      },
    });
    expect(hasPermission(emp, "salesInvoices", "view")).toBe(true);
    expect(hasPermission(emp, "salesInvoices", "add")).toBe(false);
  });

  it("defaults action to 'view' when not provided", () => {
    const emp = makeEmployee({
      permissions: {
        ...createPermissions(false),
        products: { view: true, add: false, edit: false, delete: false },
      },
    });
    expect(hasPermission(emp, "products")).toBe(true);
    expect(hasPermission(emp, "inventory")).toBe(false);
  });

  it("returns false for null or undefined user", () => {
    expect(hasPermission(null, "products", "view")).toBe(false);
    expect(hasPermission(undefined, "products", "view")).toBe(false);
  });
});

describe("normalizePermissions", () => {
  it("null/undefined input returns all-false permissions", () => {
    const result = normalizePermissions(null);
    expect(result.products.view).toBe(false);
    expect(result.salesInvoices.add).toBe(false);
  });

  it("known boolean values are preserved", () => {
    const result = normalizePermissions({
      products: { view: true, add: true, edit: false, delete: false },
    });
    expect(result.products.view).toBe(true);
    expect(result.products.add).toBe(true);
    expect(result.products.edit).toBe(false);
  });

  it("granting any non-view action auto-enables view", () => {
    const result = normalizePermissions({
      products: { view: false, add: true, edit: false, delete: false },
    });
    expect(result.products.view).toBe(true);
  });

  it("auto-enables view when any non-view action is enabled", () => {
    // normalizePermissions contract: if add/edit/delete are on, view is forced on
    const result = normalizePermissions({
      products: { view: false, add: true, edit: false, delete: false },
    });
    expect(result.products.view).toBe(true); // forced on by add=true
    expect(result.products.add).toBe(true);
  });

  it("disabling view (and all sub-actions) via normalizePermissions produces all-false for that module", () => {
    const result = normalizePermissions({
      products: { view: false, add: false, edit: false, delete: false },
    });
    expect(result.products.view).toBe(false);
    expect(result.products.add).toBe(false);
    expect(result.products.edit).toBe(false);
    expect(result.products.delete).toBe(false);
  });

  it("unknown module or action keys are silently ignored", () => {
    const result = normalizePermissions({
      products: { view: true, unknownAction: true } as never,
    } as never);
    expect(result.products.view).toBe(true);
    expect((result as never as Record<string, unknown>).unknownModule).toBeUndefined();
  });
});

describe("setPermission", () => {
  it("enables a single action on a module", () => {
    const base = createPermissions(false);
    const result = setPermission(base, "products", "add", true);
    expect(result.products.add).toBe(true);
    expect(result.products.view).toBe(true); // auto-enabled
    expect(result.products.edit).toBe(false);
  });

  it("disabling view disables all sub-actions", () => {
    const base = createPermissions(true);
    const result = setPermission(base, "salesInvoices", "view", false);
    expect(result.salesInvoices.view).toBe(false);
    expect(result.salesInvoices.add).toBe(false);
    expect(result.salesInvoices.receive).toBe(false);
  });

  it("does not mutate the original permissions object", () => {
    const base = createPermissions(false);
    const copy = JSON.parse(JSON.stringify(base));
    setPermission(base, "products", "add", true);
    expect(base).toEqual(copy);
  });
});

describe("areAllPermissionsEnabled", () => {
  it("returns true for fully-enabled permissions", () => {
    expect(areAllPermissionsEnabled(createPermissions(true))).toBe(true);
  });

  it("returns false if any action is disabled", () => {
    const p = createPermissions(true);
    p.products.delete = false;
    expect(areAllPermissionsEnabled(p)).toBe(false);
  });

  it("checks a specific module when provided", () => {
    const p = createPermissions(false);
    p.reports.view = true;
    expect(areAllPermissionsEnabled(p, "reports")).toBe(true);
    expect(areAllPermissionsEnabled(p, "products")).toBe(false);
  });
});

// ── normalizeUser ─────────────────────────────────────────────────────────────

describe("normalizeUser", () => {
  it("trims name and falls back through cleanUsername for display", () => {
    const user = makeEmployee({ username: "emp", name: "  Ali  " });
    const result = normalizeUser(user);
    // username is not trimmed by normalizeUser — only name is
    expect(result.username).toBe("emp");
    expect(result.name).toBe("Ali");
  });

  it("falls back to username when name is empty", () => {
    const user = makeEmployee({ username: "emp", name: "" });
    const result = normalizeUser(user);
    expect(result.name).toBe("emp");
  });

  it("normalizes permissions on the returned user", () => {
    const user = makeEmployee({ permissions: undefined });
    const result = normalizeUser(user);
    expect(result.permissions).toBeDefined();
    expect(result.permissions.products.view).toBe(false);
  });

  it("handles falsy username by falling back to empty string before trimming (line 233 || branch)", () => {
    const user = makeEmployee({ username: null as unknown as string, name: "Valid Name" });
    const result = normalizeUser(user);
    expect(result.name).toBe("Valid Name");
  });

  it("returns empty string when both username and name are blank (line 238 cleanUsername fallback)", () => {
    // username = whitespace trims to ""; name = "" → cleanName = ""; "" || "" → ""
    const user = makeEmployee({ username: "   ", name: "" });
    const result = normalizeUser(user);
    expect(result.name).toBe("");
  });
});

// ── setPermissionGroup ────────────────────────────────────────────────────────

describe("setPermissionGroup", () => {
  it("enables all actions in a group when value is true", () => {
    const p = createPermissions(false);
    const result = setPermissionGroup(p, "products", true);
    expect(result.products.view).toBe(true);
    expect(result.products.add).toBe(true);
    expect(result.products.edit).toBe(true);
    expect(result.products.delete).toBe(true);
  });

  it("disables all actions in a group when value is false", () => {
    const p = createPermissions(true);
    const result = setPermissionGroup(p, "products", false);
    expect(result.products.view).toBe(false);
    expect(result.products.add).toBe(false);
    expect(result.products.edit).toBe(false);
    expect(result.products.delete).toBe(false);
  });

  it("returns normalized permissions unchanged for an unknown module key", () => {
    const p = createPermissions(false);
    const result = setPermissionGroup(p, "nonexistent" as never, true);
    expect(result).toEqual(normalizePermissions(p));
  });

  it("does not mutate other module groups", () => {
    const p = createPermissions(false);
    const result = setPermissionGroup(p, "cashbox", true);
    expect(result.products.view).toBe(false);
    expect(result.cashbox.view).toBe(true);
  });
});

// ── normalizePermissions — legacy migration branches ─────────────────────────

describe("normalizePermissions — legacy migration", () => {
  it("derives inventory.adjust from products.edit when inventory is absent", () => {
    const p = normalizePermissions({
      products: { view: true, add: true, edit: true, delete: true },
    });
    expect(p.inventory.view).toBe(true);
    expect(p.inventory.adjust).toBe(true);
  });

  it("derives inventory from products when products.edit is false", () => {
    const p = normalizePermissions({
      products: { view: true, add: true, edit: false, delete: false },
    });
    expect(p.inventory.view).toBe(true);
    expect(p.inventory.adjust).toBe(false);
  });

  it("derives alerts.view from products.view when alerts is absent", () => {
    const p = normalizePermissions({
      products: { view: true, add: false, edit: false, delete: false },
    });
    expect(p.alerts.view).toBe(true);
  });

  it("derives drivers from salesInvoices when drivers is absent", () => {
    const p = normalizePermissions({
      salesInvoices: { view: true, add: true, edit: true, receive: true, cancel: true, delete: true },
    });
    expect(p.drivers.view).toBe(true);
    expect(p.drivers.add).toBe(true);
  });

  it("derives returns from salesInvoices and purchaseInvoices when returns is absent", () => {
    const p = normalizePermissions({
      salesInvoices: { view: true, add: false, edit: false, receive: false, cancel: false, delete: false },
      purchaseInvoices: { view: false, add: true, edit: false, pay: false, delete: false },
    });
    expect(p.returns.view).toBe(true);
    expect(p.returns.add).toBe(true);
  });

  it("backfills purchaseInvoices.edit as false when missing boolean", () => {
    const p = normalizePermissions({
      purchaseInvoices: { view: true, add: true } as never,
    });
    expect(p.purchaseInvoices.edit).toBe(false);
  });

  it("backfills purchaseInvoices.pay from add when missing boolean", () => {
    const p = normalizePermissions({
      purchaseInvoices: { view: true, add: true } as never,
    });
    expect(p.purchaseInvoices.pay).toBe(true);
  });

  it("backfills purchaseInvoices.delete from add when missing boolean", () => {
    const p = normalizePermissions({
      purchaseInvoices: { view: true, add: false } as never,
    });
    expect(p.purchaseInvoices.delete).toBe(false);
  });

  it("backfills salesInvoices.edit as false when missing boolean", () => {
    const p = normalizePermissions({
      salesInvoices: { view: true, add: true } as never,
    });
    expect(p.salesInvoices.edit).toBe(false);
  });

  it("backfills salesInvoices.receive from add when missing boolean", () => {
    const p = normalizePermissions({
      salesInvoices: { view: true, add: true } as never,
    });
    expect(p.salesInvoices.receive).toBe(true);
  });

  it("backfills salesInvoices.cancel from add when missing boolean", () => {
    const p = normalizePermissions({
      salesInvoices: { view: true, add: false } as never,
    });
    expect(p.salesInvoices.cancel).toBe(false);
  });

  it("backfills salesInvoices.delete from add when missing boolean", () => {
    const p = normalizePermissions({
      salesInvoices: { view: true, add: true } as never,
    });
    expect(p.salesInvoices.delete).toBe(true);
  });

  it("backfills customers.delete from edit when missing boolean", () => {
    const p = normalizePermissions({
      customers: { view: true, add: true, edit: true } as never,
    });
    expect(p.customers.delete).toBe(true);
  });

  it("backfills suppliers.delete and commissions from edit when missing boolean", () => {
    const p = normalizePermissions({
      suppliers: { view: true, add: true, edit: true } as never,
    });
    expect(p.suppliers.delete).toBe(true);
    expect(p.suppliers.commissions).toBe(true);
  });

  it("backfills cashbox.add, spend, editOpeningBalance from view when missing booleans", () => {
    const p = normalizePermissions({
      cashbox: { view: true } as never,
    });
    expect(p.cashbox.add).toBe(true);
    expect(p.cashbox.spend).toBe(true);
    expect(p.cashbox.editOpeningBalance).toBe(true);
  });

  it("backfills cashbox sub-actions as false when view is false", () => {
    const p = normalizePermissions({
      cashbox: { view: false } as never,
    });
    expect(p.cashbox.add).toBe(false);
    expect(p.cashbox.spend).toBe(false);
    expect(p.cashbox.editOpeningBalance).toBe(false);
  });
});
