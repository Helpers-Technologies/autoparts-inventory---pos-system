/**
 * TC-IPC-STG-* — Pure security predicates for the storage IPC surface.
 *
 * These tests run in plain Node.js (no Electron, no SQLite) because
 * storage-security.cjs has zero Electron deps.
 */
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const security: Record<string, any> = require("../../../electron/storage-security.cjs");
const {
  STORE_PREFIX,
  REDACTED_PASSWORD_HASH,
  PROTECTED_KEYS,
  isRendererStorageKey,
  safeUserForRenderer,
  safeUsersForRenderer,
  redactUsersForExport,
  redactBackupUsersForExport,
  redactStorageRowForExport,
  storageValueForRenderer,
} = security;

// ── Constants ─────────────────────────────────────────────────────────────────

describe("constants", () => {
  it("STORE_PREFIX is the expected namespace prefix", () => {
    expect(STORE_PREFIX).toBe("autoparts_inventory_v1::");
  });

  it("REDACTED_PASSWORD_HASH is the sentinel string", () => {
    expect(REDACTED_PASSWORD_HASH).toBe("[REDACTED]");
  });

  it("PROTECTED_KEYS blocks __license_token", () => {
    expect(PROTECTED_KEYS.has("__license_token")).toBe(true);
  });

  it("PROTECTED_KEYS blocks __license_last_seen_at", () => {
    expect(PROTECTED_KEYS.has("__license_last_seen_at")).toBe(true);
  });

  it("PROTECTED_KEYS blocks the auth state key", () => {
    expect(PROTECTED_KEYS.has(`${STORE_PREFIX}auth`)).toBe(true);
  });
});

// ── isRendererStorageKey ──────────────────────────────────────────────────────

describe("isRendererStorageKey", () => {
  it("accepts a prefixed, non-protected key", () => {
    expect(isRendererStorageKey(`${STORE_PREFIX}products`)).toBe(true);
    expect(isRendererStorageKey(`${STORE_PREFIX}customers`)).toBe(true);
    expect(isRendererStorageKey(`${STORE_PREFIX}users`)).toBe(true);
  });

  it("rejects __license_token (protected key without prefix)", () => {
    expect(isRendererStorageKey("__license_token")).toBe(false);
  });

  it("rejects the auth state key even though it carries the prefix", () => {
    expect(isRendererStorageKey(`${STORE_PREFIX}auth`)).toBe(false);
  });

  it("rejects an arbitrary unprefixed key", () => {
    expect(isRendererStorageKey("random_key")).toBe(false);
    expect(isRendererStorageKey("")).toBe(false);
  });

  it("rejects null and undefined by coercing to empty string", () => {
    expect(isRendererStorageKey(null as unknown as string)).toBe(false);
    expect(isRendererStorageKey(undefined as unknown as string)).toBe(false);
  });
});

// ── safeUserForRenderer ───────────────────────────────────────────────────────

describe("safeUserForRenderer", () => {
  it("replaces passwordHash with the redaction sentinel", () => {
    const user = { id: "u1", username: "owner", role: "owner", passwordHash: "$argon2id$v=19$..." };
    const safe = safeUserForRenderer(user);
    expect(safe.passwordHash).toBe(REDACTED_PASSWORD_HASH);
    expect(safe.id).toBe("u1");
  });

  it("preserves all other fields unchanged", () => {
    const user = { id: "u2", username: "emp", role: "employee", passwordHash: "hash", name: "Ali" };
    const safe = safeUserForRenderer(user);
    expect(safe.name).toBe("Ali");
    expect(safe.role).toBe("employee");
  });

  it("returns non-object values as-is", () => {
    expect(safeUserForRenderer(null as unknown as object)).toBeNull();
    expect(safeUserForRenderer("string" as unknown as object)).toBe("string");
  });
});

describe("safeUsersForRenderer", () => {
  it("maps redaction over an array of users", () => {
    const users = [
      { id: "u1", passwordHash: "h1" },
      { id: "u2", passwordHash: "h2" },
    ];
    const safe = safeUsersForRenderer(users);
    expect(safe.every((u) => u.passwordHash === REDACTED_PASSWORD_HASH)).toBe(true);
    expect(safe).toHaveLength(2);
  });

  it("returns an empty array for non-array input", () => {
    expect(safeUsersForRenderer(null as unknown as [])).toEqual([]);
    expect(safeUsersForRenderer("oops" as unknown as [])).toEqual([]);
  });
});

// ── redactUsersForExport ──────────────────────────────────────────────────────

describe("redactUsersForExport", () => {
  it("strips passwordHash from every user in a JSON-encoded array", () => {
    const json = JSON.stringify([
      { id: "u1", username: "owner", passwordHash: "$argon2id$..." },
      { id: "u2", username: "emp", passwordHash: "$argon2id$..." },
    ]);
    const result = JSON.parse(redactUsersForExport(json));
    expect(result[0].passwordHash).toBe(REDACTED_PASSWORD_HASH);
    expect(result[1].passwordHash).toBe(REDACTED_PASSWORD_HASH);
  });

  it("returns the raw value unchanged when JSON is not an array", () => {
    const raw = JSON.stringify({ not: "an array" });
    expect(redactUsersForExport(raw)).toBe(raw);
  });

  it("returns the raw value unchanged when JSON is corrupt", () => {
    expect(redactUsersForExport("{bad json")).toBe("{bad json");
  });
});

// ── redactBackupUsersForExport ────────────────────────────────────────────────

describe("redactBackupUsersForExport", () => {
  it("redacts users inside a backup blob's state.users array", () => {
    const blob = {
      version: 1,
      state: {
        products: [],
        users: [{ id: "u1", passwordHash: "$argon2id$..." }],
      },
    };
    const result = JSON.parse(redactBackupUsersForExport(JSON.stringify(blob)));
    expect(result.state.users[0].passwordHash).toBe(REDACTED_PASSWORD_HASH);
    expect(result.state.products).toEqual([]);
    expect(result.version).toBe(1);
  });

  it("returns raw value when state.users is missing", () => {
    const blob = JSON.stringify({ version: 1, state: { products: [] } });
    expect(redactBackupUsersForExport(blob)).toBe(blob);
  });

  it("returns raw value on corrupt JSON", () => {
    expect(redactBackupUsersForExport("{{bad}}")).toBe("{{bad}}");
  });
});

// ── redactStorageRowForExport ─────────────────────────────────────────────────

describe("redactStorageRowForExport", () => {
  it("applies user-level redaction when key is the users key", () => {
    const row = {
      key: `${STORE_PREFIX}users`,
      value: JSON.stringify([{ id: "u1", passwordHash: "secret" }]),
      updated_at: "2026-01-01T00:00:00.000Z",
    };
    const out = redactStorageRowForExport(row);
    expect(JSON.parse(out.value)[0].passwordHash).toBe(REDACTED_PASSWORD_HASH);
    expect(out.key).toBe(row.key);
    expect(out.updated_at).toBe(row.updated_at);
  });

  it("applies backup-level redaction for any other prefixed key", () => {
    const blob = JSON.stringify({
      version: 1,
      state: { users: [{ id: "u1", passwordHash: "secret" }] },
    });
    const row = { key: `${STORE_PREFIX}backup_2026`, value: blob, updated_at: "2026-01-01" };
    const out = redactStorageRowForExport(row);
    expect(JSON.parse(out.value).state.users[0].passwordHash).toBe(REDACTED_PASSWORD_HASH);
  });

  it("leaves a row with no users unchanged (no parse error)", () => {
    const row = {
      key: `${STORE_PREFIX}settings`,
      value: JSON.stringify({ currency: "EGP" }),
      updated_at: "2026-01-01",
    };
    const out = redactStorageRowForExport(row);
    expect(out.value).toBe(row.value);
  });
});

// ── storageValueForRenderer ───────────────────────────────────────────────────

describe("storageValueForRenderer", () => {
  it("redacts users on read via the users key", () => {
    const raw = JSON.stringify([{ id: "u1", passwordHash: "argon2id$..." }]);
    const result = storageValueForRenderer(`${STORE_PREFIX}users`, raw);
    expect(JSON.parse(result)[0].passwordHash).toBe(REDACTED_PASSWORD_HASH);
  });

  it("returns raw value as-is for any other key", () => {
    const raw = JSON.stringify({ currency: "EGP" });
    expect(storageValueForRenderer(`${STORE_PREFIX}settings`, raw)).toBe(raw);
  });
});
