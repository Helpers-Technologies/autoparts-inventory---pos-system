"use strict";
/**
 * Pure storage-security predicates and redaction helpers for the KV IPC surface.
 * No Electron, DB, crypto, or Argon2 deps — safe to require from Vitest test harnesses.
 */

const STORE_PREFIX = "autoparts_inventory_v1::";
const REDACTED_PASSWORD_HASH = "[REDACTED]";

const LICENSE_TOKEN_KEY = "__license_token";
const LICENSE_LAST_SEEN_KEY = "__license_last_seen_at";
const AUTH_STATE_KEY = `${STORE_PREFIX}auth`;

const PROTECTED_KEYS = new Set([
  LICENSE_TOKEN_KEY,
  LICENSE_LAST_SEEN_KEY,
  AUTH_STATE_KEY,
]);

/**
 * Returns true only for keys the renderer is allowed to read/write:
 * must carry the app prefix AND must not be a protected internal key.
 */
function isRendererStorageKey(key) {
  const cleanKey = String(key || "");
  return cleanKey.startsWith(STORE_PREFIX) && !PROTECTED_KEYS.has(cleanKey);
}

// ── Chunked collections ───────────────────────────────────────────────────
//
// Large collections are stored as `<key>#0000`, `#0001`, ... plus a `#meta`
// manifest, so appending a record does not rewrite the shop's whole history.
// The base row is left holding CHUNKED_TOMBSTONE to mark it superseded.
//
// This lives here, next to isRendererStorageKey, because BOTH sides need it:
// the renderer writes the format (src/lib/storage.ts) and the main process
// reads it directly when building the commerce snapshot. When only the
// renderer knew, the snapshot silently read the tombstone, failed to parse it
// as an array, and uploaded an empty shop to the portal — the phone showed no
// products, no customers and no orders, with nothing logged anywhere.
const CHUNKED_TOMBSTONE = '"__partflow_chunked__"';

/** Reassembles a chunked collection, or null if `key` is not stored in chunks.
 *  `readRow` takes a full storage key and returns the raw string or null. */
function readChunkedCollection(key, readRow) {
  const rawMeta = readRow(`${key}#meta`);
  if (rawMeta === null || rawMeta === undefined) return null;
  let meta;
  try {
    meta = JSON.parse(rawMeta);
  } catch {
    return null;
  }
  const count = Number(meta && meta.chunks);
  if (!Number.isInteger(count) || count < 0) return null;

  const out = [];
  for (let i = 0; i < count; i++) {
    const raw = readRow(`${key}#${String(i).padStart(4, "0")}`);
    if (raw === null || raw === undefined) return null;
    let part;
    try {
      part = JSON.parse(raw);
    } catch {
      return null;
    }
    if (!Array.isArray(part)) return null;
    for (const item of part) out.push(item);
  }
  // A short chunk must not pass as a complete collection.
  if (Number.isInteger(meta.total) && meta.total !== out.length) return null;
  return out;
}

/** True when the base row says the real data lives in chunks. */
function isChunkedTombstone(value) {
  return value === CHUNKED_TOMBSTONE;
}

/** Every physical row that makes up `key`, for change detection. */
function chunkRowKeys(key, readRow) {
  const rawMeta = readRow(`${key}#meta`);
  if (rawMeta === null || rawMeta === undefined) return [];
  let count = 0;
  try {
    count = Number(JSON.parse(rawMeta).chunks) || 0;
  } catch {
    return [];
  }
  const keys = [`${key}#meta`];
  for (let i = 0; i < count; i++) keys.push(`${key}#${String(i).padStart(4, "0")}`);
  return keys;
}

/** Replaces the passwordHash on a single user object with the redaction sentinel. */
function safeUserForRenderer(user) {
  if (!user || typeof user !== "object") return user;
  return { ...user, passwordHash: REDACTED_PASSWORD_HASH };
}

/** Maps safeUserForRenderer over an array; returns [] for non-arrays. */
function safeUsersForRenderer(users) {
  return Array.isArray(users) ? users.map(safeUserForRenderer) : [];
}

/** Redacts password hashes from a JSON-encoded user array; returns raw value on parse error. */
function redactUsersForExport(value) {
  try {
    const users = JSON.parse(value);
    if (!Array.isArray(users)) return value;
    return JSON.stringify(safeUsersForRenderer(users));
  } catch {
    return value;
  }
}

/**
 * Redacts password hashes from the `state.users` array inside a backup JSON blob.
 * Returns raw value on parse error or if backup structure is unexpected.
 */
function redactBackupUsersForExport(value) {
  try {
    const backup = JSON.parse(value);
    if (!Array.isArray(backup?.state?.users)) return value;
    return JSON.stringify({
      ...backup,
      state: {
        ...backup.state,
        users: safeUsersForRenderer(backup.state.users),
      },
    });
  } catch {
    return value;
  }
}

/**
 * Redacts credential data from a kv_store row before export.
 * The users key gets user-level redaction; all other rows get backup-level redaction.
 */
function redactStorageRowForExport(row) {
  if (row.key === `${STORE_PREFIX}users`) {
    return { ...row, value: redactUsersForExport(row.value) };
  }
  return { ...row, value: redactBackupUsersForExport(row.value) };
}

/**
 * Returns the value for a key as the renderer should see it (read path).
 * Users key gets hash redaction; all other renderer keys are returned as-is.
 */
function storageValueForRenderer(key, value) {
  if (String(key) === `${STORE_PREFIX}users`) return redactUsersForExport(value);
  return value;
}

module.exports = {
  STORE_PREFIX,
  REDACTED_PASSWORD_HASH,
  PROTECTED_KEYS,
  CHUNKED_TOMBSTONE,
  isRendererStorageKey,
  readChunkedCollection,
  isChunkedTombstone,
  chunkRowKeys,
  safeUserForRenderer,
  safeUsersForRenderer,
  redactUsersForExport,
  redactBackupUsersForExport,
  redactStorageRowForExport,
  storageValueForRenderer,
};
