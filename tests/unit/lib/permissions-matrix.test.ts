/**
 * Permission matrix property tests — §5.2 of the testing strategy.
 *
 * Covers every (module × action) pair in PERMISSION_GROUPS, plus fast-check
 * properties for the structural invariants of normalizePermissions and hasPermission.
 *
 * TC-PER-MATRIX-001 through TC-PER-MATRIX-004
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  PERMISSION_GROUPS,
  hasPermission,
  normalizePermissions,
  setPermission,
  createPermissions,
} from "../../../src/lib/permissions";
import type { AppUser, PermissionModule } from "../../../src/lib/permissions";
import type { UserPermissions } from "../../../src/types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeOwner(): AppUser {
  return {
    id: "u-owner",
    username: "owner",
    name: "Owner",
    passwordHash: "hash",
    role: "owner",
    permissions: createPermissions(false),
    createdAt: "2026-01-01",
  };
}

function makeEmployee(permissions: UserPermissions): AppUser {
  return {
    id: "u-emp",
    username: "emp",
    name: "Employee",
    passwordHash: "hash",
    role: "employee",
    permissions,
    createdAt: "2026-01-01",
  };
}

// Every (module, action) pair reachable through the permission system.
const ALL_PAIRS = PERMISSION_GROUPS.flatMap((group) =>
  group.actions.map((action) => ({ module: group.key, action: action.key }))
);

// ── TC-PER-MATRIX-001 — Exhaustive owner grant ────────────────────────────────

describe("TC-PER-MATRIX-001 — owner always has every permission", () => {
  const owner = makeOwner();

  for (const { module, action } of ALL_PAIRS) {
    it(`owner.${module}.${action}`, () => {
      expect(hasPermission(owner, module, action)).toBe(true);
    });
  }
});

// ── TC-PER-MATRIX-002 — Exhaustive employee grant/deny ───────────────────────

describe("TC-PER-MATRIX-002 — employee gets exactly what is granted", () => {
  for (const { module, action } of ALL_PAIRS) {
    it(`granted: employee.${module}.${action} → true`, () => {
      const perms = setPermission(createPermissions(false), module, action, true);
      expect(hasPermission(makeEmployee(perms), module, action)).toBe(true);
    });

    it(`denied: employee.${module}.${action} → false`, () => {
      const perms = setPermission(createPermissions(false), module, action, false);
      expect(hasPermission(makeEmployee(perms), module, action)).toBe(false);
    });
  }
});

// ── TC-PER-MATRIX-003 — Null / undefined user ────────────────────────────────

describe("TC-PER-MATRIX-003 — null/undefined user is always denied", () => {
  it("hasPermission(null) always returns false", () =>
    fc.assert(
      fc.property(
        fc.constantFrom(...ALL_PAIRS),
        ({ module, action }) =>
          hasPermission(null, module, action) === false
      )
    ));

  it("hasPermission(undefined) always returns false", () =>
    fc.assert(
      fc.property(
        fc.constantFrom(...ALL_PAIRS),
        ({ module, action }) =>
          hasPermission(undefined, module, action) === false
      )
    ));
});

// ── TC-PER-MATRIX-004 — normalizePermissions structural invariants ───────────

describe("TC-PER-MATRIX-004 — normalizePermissions invariants", () => {
  // Arbitrary: a record where each module key maps to a randomly enabled subset of actions.
  const randomPermsArb = fc.record(
    Object.fromEntries(
      PERMISSION_GROUPS.map((group) => [
        group.key,
        fc.record(
          Object.fromEntries(group.actions.map((a) => [a.key, fc.boolean()])),
          { requiredKeys: group.actions.map((a) => a.key) }
        ),
      ])
    )
  ) as fc.Arbitrary<UserPermissions>;

  it("if any non-view action is true, view is forced true", () =>
    fc.assert(
      fc.property(randomPermsArb, (rawPerms) => {
        const normalized = normalizePermissions(rawPerms);
        for (const group of PERMISSION_GROUPS) {
          const groupPerms = normalized[group.key] as Record<string, boolean>;
          const hasNonView = group.actions.some(
            (a) => a.key !== "view" && groupPerms[a.key]
          );
          if (hasNonView) {
            if (!groupPerms.view) return false;
          }
        }
        return true;
      })
    ));

  it("if view is false, all non-view actions in that group are false", () =>
    fc.assert(
      fc.property(randomPermsArb, (rawPerms) => {
        const normalized = normalizePermissions(rawPerms);
        for (const group of PERMISSION_GROUPS) {
          const groupPerms = normalized[group.key] as Record<string, boolean>;
          if (!groupPerms.view) {
            for (const action of group.actions) {
              if (action.key !== "view" && groupPerms[action.key]) return false;
            }
          }
        }
        return true;
      })
    ));

  it("output is always a complete UserPermissions with no missing keys", () =>
    fc.assert(
      fc.property(randomPermsArb, (rawPerms) => {
        const normalized = normalizePermissions(rawPerms);
        for (const group of PERMISSION_GROUPS) {
          const groupPerms = normalized[group.key] as Record<string, boolean> | undefined;
          if (!groupPerms) return false;
          for (const action of group.actions) {
            if (typeof groupPerms[action.key] !== "boolean") return false;
          }
        }
        return true;
      })
    ));

  it("owner always has every permission regardless of stored permissions", () =>
    fc.assert(
      fc.property(
        randomPermsArb,
        fc.constantFrom(...ALL_PAIRS),
        (rawPerms, { module, action }) => {
          const owner = makeOwner();
          owner.permissions = rawPerms;
          return hasPermission(owner, module as PermissionModule, action) === true;
        }
      )
    ));

  it("employee with all-false permissions is always denied", () =>
    fc.assert(
      fc.property(
        fc.constantFrom(...ALL_PAIRS),
        ({ module, action }) => {
          const emp = makeEmployee(createPermissions(false));
          return hasPermission(emp, module as PermissionModule, action) === false;
        }
      )
    ));
});
