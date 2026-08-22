/**
 * License verification, isolated from Electron so it can actually be tested.
 *
 * This logic used to live inline in main.cjs, where nothing could reach it: the
 * only automated coverage of licensing was an E2E harness that sets HW_E2E=1,
 * and under that flag main.cjs short-circuits getLicenseStatus() to a synthetic
 * lifetime license with features ["*"]. So the code that decides whether a shop
 * has paid — signature check, machine binding, expiry, clock tampering — ran in
 * production and nowhere else. A change that broke it would have shipped.
 *
 * Everything here is pure: no `app`, no database, no storage. The caller injects
 * the machine check, the two storage accessors, and the clock, which is what
 * makes the tampering and expiry rules testable at all.
 *
 * Mirrors the extraction already done for backup-crypto.cjs.
 */
const crypto = require("node:crypto");
const { z } = require("zod");

/** Backward clock-jump tolerance before flagging clock_tampered. Generous on
 *  purpose: NTP resyncs and DST both move the clock, and a rollback measured in
 *  hours buys a trial-abuser nothing — the signed expiry is checked separately. */
const CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;
/** A "last seen" further in the future than this is a corrupt reading, not
 *  tampering. Re-baseline rather than locking a paying customer out forever. */
const CLOCK_TAMPER_SELF_HEAL_MS = 365 * 24 * 60 * 60 * 1000;
const MAX_TOKEN_LENGTH = 8192;

const LICENSE_TOKEN_KEY = "__license_token";
const LICENSE_LAST_SEEN_KEY = "__license_last_seen_at";
const LICENSE_SERVER_STATUS_KEY = "__license_server_status";

/**
 * What each kind of signed token must contain.
 *
 * These live beside the verifier, not in main.cjs, for two reasons. They are
 * part of what "valid" means — `schema.parse` runs before the signature check
 * and decides which fields are even considered — and the prefix is not covered
 * by the signature, so the required fields below (`purpose`, `supportId`,
 * `slots`) are the real thing stopping one kind of token being replayed as
 * another. Tests must exercise these exact objects, not a copy of them.
 */
const licenseSchema = z.object({
  licenseId: z.string().min(1),
  machineHash: z.string().length(64),
  subscriptionType: z.enum(["limited", "lifetime"]),
  subscriptionStartDate: z.string().min(1),
  subscriptionExpiresAt: z.string().nullable(),
  warrantyStartDate: z.string().nullable(),
  warrantyExpiresAt: z.string().nullable(),
  // Optional feature packaging. When present they are part of the signed payload
  // (must be included in the generator's canonical string before signing).
  // Absent on serials issued before packaging ⇒ free modules only.
  plan: z.string().optional(),
  features: z.array(z.string()).optional(),
  issuedAt: z.string().min(1),
  signature: z.string().min(32),
});

const supportSchema = z.object({
  supportId: z.string().min(1),
  purpose: z.literal("owner_password_reset"),
  machineHash: z.string().length(64),
  issuedAt: z.string().min(1),
  expiresAt: z.string().min(1),
  signature: z.string().min(32),
});

const branchActivationSchema = z.object({
  activationId: z.string().min(1),
  purpose: z.literal("add_branch"),
  machineHash: z.string().length(64),
  slots: z.literal(1),
  issuedAt: z.string().min(1),
  signature: z.string().min(32),
});

/**
 * Deterministic JSON: keys sorted, so the signer and the verifier build the
 * exact same bytes regardless of property order in transit.
 */
function canonicalStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Decodes and verifies one `PREFIX.<base64url-json>` token, or throws.
 *
 * The prefix is NOT part of the signed bytes, so it cannot by itself keep an
 * `APLIC.` serial from being replayed as an `APSUP.` support code — the schema
 * does that, by requiring fields (`purpose`, `supportId`, `slots`) that only
 * belong to one token kind and that are themselves signed.
 */
function parseSignedPayload(token, prefix, schema, publicKey) {
  const normalized = String(token || "")
    .replace(/\s+/g, "")
    .trim();
  if (normalized.length > MAX_TOKEN_LENGTH) {
    throw new Error("Token too large");
  }
  if (!normalized.startsWith(prefix)) {
    throw new Error("Invalid token prefix");
  }

  const decoded = JSON.parse(
    Buffer.from(normalized.slice(prefix.length), "base64url").toString("utf8"),
  );
  const parsed = schema.parse(decoded);
  const { signature, ...unsignedPayload } = parsed;
  const verified = crypto.verify(
    null,
    Buffer.from(canonicalStringify(unsignedPayload)),
    publicKey,
    Buffer.from(signature, "base64url"),
  );

  if (!verified) {
    throw new Error("Invalid token signature");
  }

  return parsed;
}

function parseDateMs(value) {
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Decides what a serial entitles this machine to, right now.
 *
 * @param serial   the raw `APLIC.` token, or a falsy value when none is stored
 * @param deps.publicKey            KeyObject the serial must verify against
 * @param deps.schema               zod schema for the license payload
 * @param deps.isMachineHashAccepted (hash) => boolean — machine binding
 * @param deps.storageGet           (key) => string | null
 * @param deps.storageSet           (key, value) => void
 * @param deps.buildStatus          (state, extra) => status object
 * @param deps.now                  Date to evaluate against (defaults to today)
 * @param deps.persistSeen          record this moment as the last-seen time
 */
function evaluateLicense(serial, deps) {
  const {
    publicKey,
    schema,
    isMachineHashAccepted,
    storageGet,
    storageSet,
    buildStatus,
    now = new Date(),
    persistSeen = false,
  } = deps;

  if (!serial) {
    return buildStatus("inactive");
  }

  let license;
  try {
    license = parseSignedPayload(serial, "APLIC.", schema, publicKey);
  } catch (error) {
    return buildStatus("inactive", {
      message: error instanceof Error ? error.message : "Invalid license",
    });
  }

  if (!isMachineHashAccepted(license.machineHash)) {
    return buildStatus("machine_mismatch", { license });
  }

  const lastSeenRaw = storageGet(LICENSE_LAST_SEEN_KEY);
  if (lastSeenRaw) {
    const lastSeenMs = parseDateMs(lastSeenRaw);
    if (lastSeenMs !== null && now.getTime() + CLOCK_SKEW_MS < lastSeenMs) {
      if (lastSeenMs - now.getTime() > CLOCK_TAMPER_SELF_HEAL_MS) {
        // Implausibly large gap — almost certainly a corrupted/stale reading,
        // not genuine tampering. Re-baseline instead of a permanent lock.
        storageSet(LICENSE_LAST_SEEN_KEY, now.toISOString());
      } else {
        return buildStatus("clock_tampered", { license });
      }
    }
  }

  if (storageGet(LICENSE_SERVER_STATUS_KEY) === "blocked") {
    return buildStatus("inactive", { message: "موقوف من الإدارة" });
  }

  const subscriptionExpiresMs = license.subscriptionExpiresAt
    ? parseDateMs(license.subscriptionExpiresAt)
    : null;
  if (
    license.subscriptionType === "limited" &&
    (!license.subscriptionExpiresAt ||
      subscriptionExpiresMs === null ||
      now.getTime() > subscriptionExpiresMs)
  ) {
    return buildStatus("expired", { license });
  }

  if (persistSeen) {
    storageSet(LICENSE_LAST_SEEN_KEY, now.toISOString());
  }

  return buildStatus("active", { license });
}

/**
 * Whether a resolved license status entitles the machine to one paid feature.
 *
 * A serial with no `features` array predates feature packaging. Those serials
 * get free modules only — never a paid add-on — which is the same rule the
 * renderer applies in src/lib/features.ts (`isAllowedByLicense`). Only the keys
 * gated in the main process reach here, and all of them are paid, so "absent
 * list ⇒ denied" is the correct and matching answer.
 */
function licenseAllowsFeature(status, featureKey) {
  const features = status?.license?.features;
  return (
    status?.state === "active" &&
    Array.isArray(features) &&
    (features.includes(featureKey) || features.includes("*"))
  );
}

module.exports = {
  licenseSchema,
  supportSchema,
  branchActivationSchema,
  CLOCK_SKEW_MS,
  CLOCK_TAMPER_SELF_HEAL_MS,
  MAX_TOKEN_LENGTH,
  LICENSE_TOKEN_KEY,
  LICENSE_LAST_SEEN_KEY,
  LICENSE_SERVER_STATUS_KEY,
  canonicalStringify,
  parseSignedPayload,
  parseDateMs,
  evaluateLicense,
  licenseAllowsFeature,
};
