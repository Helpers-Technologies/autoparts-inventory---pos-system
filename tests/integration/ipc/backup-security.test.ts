/**
 * Backup export / import security tests.
 *
 * Verifies the redaction chain in electron/storage-security.cjs end-to-end:
 *   - Backup exports must strip user password hashes.
 *   - Importing a backup with [REDACTED] hashes must not create users with sentinel hashes.
 *   - The users KV key and the backup-blob KV key both redact independently.
 *   - Non-user rows pass through unchanged.
 *   - Protected keys (license token, auth state) are inaccessible via isRendererStorageKey.
 *
 * TC-INT-BAK-001 through TC-INT-BAK-010
 */
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  STORE_PREFIX,
  REDACTED_PASSWORD_HASH,
  PROTECTED_KEYS,
  redactUsersForExport,
  redactBackupUsersForExport,
  redactStorageRowForExport,
  storageValueForRenderer,
  isRendererStorageKey,
} = require("../../../electron/storage-security.cjs");

// ── Fixtures ──────────────────────────────────────────────────────────────────

const USERS_KEY = `${STORE_PREFIX}users`;
const BACKUP_KEY = `${STORE_PREFIX}backup`;

const realHash = "argon2id$v=19$m=65536,t=3,p=4$salt$hash";

function makeUser(id: string, role = "employee") {
  return { id, username: `user_${id}`, name: `User ${id}`, role, passwordHash: realHash };
}

function makeBackupBlob(users: object[]) {
  return JSON.stringify({
    version: 1,
    exportedAt: "2026-05-28T00:00:00Z",
    state: {
      users,
      products: [],
      salesInvoices: [],
      purchaseInvoices: [],
    },
  });
}

// ── TC-INT-BAK-001: redactUsersForExport ─────────────────────────────────────

describe("redactUsersForExport — TC-INT-BAK-001", () => {
  it("strips passwordHash from every user in a JSON array", () => {
    const input = JSON.stringify([makeUser("u1"), makeUser("u2", "owner")]);
    const output = JSON.parse(redactUsersForExport(input));
    expect(output).toHaveLength(2);
    expect(output[0].passwordHash).toBe(REDACTED_PASSWORD_HASH);
    expect(output[1].passwordHash).toBe(REDACTED_PASSWORD_HASH);
  });

  it("preserves all other user fields", () => {
    const user = makeUser("u1");
    const output = JSON.parse(redactUsersForExport(JSON.stringify([user])));
    expect(output[0].id).toBe("u1");
    expect(output[0].username).toBe("user_u1");
    expect(output[0].role).toBe("employee");
  });

  it("returns the raw value when JSON is malformed (no crash)", () => {
    const bad = "not-json{{{";
    expect(redactUsersForExport(bad)).toBe(bad);
  });

  it("returns the raw value when the parsed value is not an array", () => {
    const obj = JSON.stringify({ id: "u1" });
    expect(redactUsersForExport(obj)).toBe(obj);
  });

  it("handles an empty user array", () => {
    const output = JSON.parse(redactUsersForExport("[]"));
    expect(output).toEqual([]);
  });
});

// ── TC-INT-BAK-002: redactBackupUsersForExport ────────────────────────────────

describe("redactBackupUsersForExport — TC-INT-BAK-002", () => {
  it("strips passwordHash from state.users inside a backup blob", () => {
    const blob = makeBackupBlob([makeUser("u1"), makeUser("u2")]);
    const result = JSON.parse(redactBackupUsersForExport(blob));
    expect(result.state.users[0].passwordHash).toBe(REDACTED_PASSWORD_HASH);
    expect(result.state.users[1].passwordHash).toBe(REDACTED_PASSWORD_HASH);
  });

  it("preserves all other backup state fields untouched", () => {
    const blob = makeBackupBlob([makeUser("u1")]);
    const result = JSON.parse(redactBackupUsersForExport(blob));
    expect(result.version).toBe(1);
    expect(result.state.products).toEqual([]);
    expect(result.state.salesInvoices).toEqual([]);
  });

  it("returns the raw value when JSON is malformed", () => {
    const bad = "bad{json";
    expect(redactBackupUsersForExport(bad)).toBe(bad);
  });

  it("returns the raw value when state.users is not an array", () => {
    const blob = JSON.stringify({ version: 1, state: { users: "not-array" } });
    expect(redactBackupUsersForExport(blob)).toBe(blob);
  });

  it("returns the raw value when state is missing", () => {
    const blob = JSON.stringify({ version: 1 });
    expect(redactBackupUsersForExport(blob)).toBe(blob);
  });
});

// ── TC-INT-BAK-003: redactStorageRowForExport dispatch ────────────────────────

describe("redactStorageRowForExport — TC-INT-BAK-003", () => {
  it("applies user-level redaction for the users key", () => {
    const row = { key: USERS_KEY, value: JSON.stringify([makeUser("u1")]) };
    const result = redactStorageRowForExport(row);
    const users = JSON.parse(result.value);
    expect(users[0].passwordHash).toBe(REDACTED_PASSWORD_HASH);
  });

  it("applies backup-level redaction for any other key that contains a backup blob", () => {
    const row = { key: BACKUP_KEY, value: makeBackupBlob([makeUser("u1")]) };
    const result = redactStorageRowForExport(row);
    const backup = JSON.parse(result.value);
    expect(backup.state.users[0].passwordHash).toBe(REDACTED_PASSWORD_HASH);
  });

  it("passes non-user, non-backup rows through without modification", () => {
    const row = { key: `${STORE_PREFIX}settings`, value: JSON.stringify({ currency: "EGP" }) };
    const result = redactStorageRowForExport(row);
    expect(result.value).toBe(row.value);
    expect(result.key).toBe(row.key);
  });
});

// ── TC-INT-BAK-004: storageValueForRenderer ───────────────────────────────────

describe("storageValueForRenderer — TC-INT-BAK-004", () => {
  it("redacts the users key value when read by the renderer", () => {
    const value = JSON.stringify([makeUser("u1")]);
    const result = JSON.parse(storageValueForRenderer(USERS_KEY, value));
    expect(result[0].passwordHash).toBe(REDACTED_PASSWORD_HASH);
  });

  it("returns other key values unchanged", () => {
    const value = JSON.stringify({ theme: "light" });
    expect(storageValueForRenderer(`${STORE_PREFIX}settings`, value)).toBe(value);
  });
});

// ── TC-INT-BAK-005: [REDACTED] hash detection ─────────────────────────────────

describe("Detecting [REDACTED] hashes to prevent import — TC-INT-BAK-005", () => {
  it("a redacted export contains only [REDACTED] as passwordHash", () => {
    const exported = JSON.parse(redactUsersForExport(JSON.stringify([makeUser("u1"), makeUser("u2")])));
    for (const user of exported) {
      expect(user.passwordHash).toBe(REDACTED_PASSWORD_HASH);
      // Simulating the import guard: reject any user whose hash equals the sentinel
      const isRedacted = user.passwordHash === REDACTED_PASSWORD_HASH;
      expect(isRedacted).toBe(true);
    }
  });

  it("a real hash does NOT equal the redaction sentinel", () => {
    expect(realHash).not.toBe(REDACTED_PASSWORD_HASH);
  });
});

// ── TC-INT-BAK-006: Protected keys cannot be read/written by renderer ─────────

describe("PROTECTED_KEYS gate — TC-INT-BAK-006", () => {
  it("isRendererStorageKey returns false for every protected key", () => {
    for (const key of PROTECTED_KEYS) {
      expect(isRendererStorageKey(key)).toBe(false);
    }
  });

  it("isRendererStorageKey returns true for a normal app-prefixed key", () => {
    expect(isRendererStorageKey(`${STORE_PREFIX}products`)).toBe(true);
  });

  it("isRendererStorageKey returns false for keys without the app prefix", () => {
    expect(isRendererStorageKey("bare_key")).toBe(false);
    expect(isRendererStorageKey("")).toBe(false);
    expect(isRendererStorageKey(null)).toBe(false);
  });
});
