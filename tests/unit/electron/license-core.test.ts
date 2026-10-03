/**
 * License verification — the code that decides whether a shop has paid.
 *
 * Before this file existed, none of it was covered. The E2E harness sets
 * HW_E2E=1, and under that flag main.cjs returns a synthetic lifetime license
 * with features ["*"] without ever calling the verifier, so the signature
 * check, machine binding, expiry and clock rules ran only on customer
 * machines. A change that disabled any of them would have shipped silently.
 *
 * These tests mint real tokens with a real ed25519 keypair — the same
 * algorithm and canonical-JSON scheme the license studio uses — and then
 * attack them: forged signatures, another vendor's key, payloads edited after
 * signing, tokens minted for a different machine, replayed across token kinds,
 * and clocks rolled backwards.
 *
 * The schemas and the verifier both come from the module under test, so
 * there is no hand-copied shape here that could drift out of step with what
 * the product actually enforces.
 *
 * TC-LIC-001 through TC-LIC-031
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createRequire } from "node:module";
import crypto from "node:crypto";

const require = createRequire(import.meta.url);
const {
  licenseSchema,
  supportSchema,
  branchActivationSchema,
  canonicalStringify,
  parseSignedPayload,
  evaluateLicense,
  licenseAllowsFeature,
  LICENSE_LAST_SEEN_KEY,
  LICENSE_SERVER_STATUS_KEY,
  MAX_TOKEN_LENGTH,
  CLOCK_SKEW_MS,
  CLOCK_TAMPER_SELF_HEAL_MS,
} = require("../../../electron/license-core.cjs");

// ── Two keypairs: the vendor's, and an attacker who has their own ────────
const vendor = crypto.generateKeyPairSync("ed25519");
const attacker = crypto.generateKeyPairSync("ed25519");
const legacyVendor = crypto.generateKeyPairSync("ed25519");

const THIS_MACHINE = "a".repeat(64);
const OTHER_MACHINE = "b".repeat(64);

/** Signs a payload the way the license studio does, and wraps it in a token. */
function mint(
  payload: Record<string, unknown>,
  prefix = "APLIC.",
  key: crypto.KeyObject = vendor.privateKey,
) {
  const signature = crypto
    .sign(null, Buffer.from(canonicalStringify(payload)), key)
    .toString("base64url");
  return encode({ ...payload, signature }, prefix);
}

/** Wraps an already-complete payload (signature included) in a token. */
function encode(signedPayload: Record<string, unknown>, prefix = "APLIC.") {
  return (
    prefix +
    Buffer.from(JSON.stringify(signedPayload), "utf8").toString("base64url")
  );
}

/** Reads a token back into its payload object, so a test can edit it. */
function decode(token: string, prefix = "APLIC.") {
  return JSON.parse(
    Buffer.from(token.slice(prefix.length), "base64url").toString("utf8"),
  );
}

const NOW = new Date("2026-08-21T12:00:00.000Z");

function licensePayload(over: Record<string, unknown> = {}) {
  return {
    licenseId: "LIC-0001",
    machineHash: THIS_MACHINE,
    subscriptionType: "lifetime",
    subscriptionStartDate: "2026-01-01T00:00:00.000Z",
    subscriptionExpiresAt: null,
    warrantyStartDate: "2026-01-01T00:00:00.000Z",
    warrantyExpiresAt: "2027-01-01T00:00:00.000Z",
    issuedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

// ── A fake of exactly the surface evaluateLicense is allowed to touch ────
let storage: Map<string, string>;
const deps = (over: Record<string, unknown> = {}) => ({
  publicKey: vendor.publicKey,
  schema: licenseSchema,
  isMachineHashAccepted: (hash: string) => hash === THIS_MACHINE,
  storageGet: (key: string) => storage.get(key) ?? null,
  storageSet: (key: string, value: string) => void storage.set(key, value),
  buildStatus: (state: string, extra: Record<string, unknown> = {}) => ({
    state,
    machineCode: "MC-TEST",
    machineHash: THIS_MACHINE,
    ...extra,
  }),
  now: NOW,
  persistSeen: false,
  ...over,
});

beforeEach(() => {
  storage = new Map();
});

describe("a genuine serial — TC-LIC", () => {
  it("TC-LIC-001: a lifetime serial signed by the vendor for this machine is active", () => {
    const status = evaluateLicense(mint(licensePayload()), deps());
    expect(status.state).toBe("active");
    expect(status.license.licenseId).toBe("LIC-0001");
  });

  it("TC-LIC-002: a limited serial inside its term is active", () => {
    const token = mint(
      licensePayload({
        subscriptionType: "limited",
        subscriptionExpiresAt: "2026-12-31T00:00:00.000Z",
      }),
    );
    expect(evaluateLicense(token, deps()).state).toBe("active");
  });

  it("TC-LIC-003: whitespace and line breaks inside a pasted serial are tolerated", () => {
    // Customers paste serials out of WhatsApp and email, which wrap them.
    const token = mint(licensePayload());
    const wrapped =
      token.slice(0, 20) + "\n  " + token.slice(20, 60) + " \t" + token.slice(60);
    expect(evaluateLicense(wrapped, deps()).state).toBe("active");
  });

  it("TC-LIC-004: no serial at all is inactive, not active-by-default", () => {
    for (const empty of [null, undefined, "", 0, false]) {
      expect(evaluateLicense(empty, deps()).state).toBe("inactive");
    }
  });

  it("TC-LIC-032: a serial signed by a trusted legacy key remains active after key rotation", () => {
    const token = mint(
      licensePayload({ licenseId: "LIC-LEGACY" }),
      "APLIC.",
      legacyVendor.privateKey,
    );
    const status = evaluateLicense(
      token,
      deps({ publicKey: [vendor.publicKey, legacyVendor.publicKey] }),
    );
    expect(status.state).toBe("active");
    expect(status.license.licenseId).toBe("LIC-LEGACY");
  });
});

describe("forged and tampered serials — TC-LIC", () => {
  it("TC-LIC-005: a random signature is rejected", () => {
    const token = encode({
      ...licensePayload(),
      signature: crypto.randomBytes(64).toString("base64url"),
    });
    const status = evaluateLicense(token, deps());
    expect(status.state).toBe("inactive");
    expect(status.message).toBe("Invalid token signature");
  });

  it("TC-LIC-006: a serial signed with someone else's ed25519 key is rejected", () => {
    // The whole scheme rests on this: an attacker can run the same generator,
    // they just cannot produce a signature that verifies against OUR key.
    const token = mint(licensePayload(), "APLIC.", attacker.privateKey);
    expect(evaluateLicense(token, deps()).state).toBe("inactive");
  });

  it("TC-LIC-007: extending the expiry date after signing is rejected", () => {
    const token = mint(
      licensePayload({
        subscriptionType: "limited",
        subscriptionExpiresAt: "2026-09-01T00:00:00.000Z",
      }),
    );
    const payload = decode(token);
    payload.subscriptionExpiresAt = "2099-01-01T00:00:00.000Z";
    expect(evaluateLicense(encode(payload), deps()).state).toBe("inactive");
  });

  it("TC-LIC-008: upgrading `limited` to `lifetime` after signing is rejected", () => {
    const token = mint(
      licensePayload({
        subscriptionType: "limited",
        subscriptionExpiresAt: "2026-01-02T00:00:00.000Z",
      }),
    );
    const payload = decode(token);
    payload.subscriptionType = "lifetime";
    expect(evaluateLicense(encode(payload), deps()).state).toBe("inactive");
  });

  it("TC-LIC-009: adding paid features after signing is rejected", () => {
    // The most direct attack on revenue: take a Basic serial, paste "*" in.
    const token = mint(
      licensePayload({ plan: "basic", features: ["pos", "salesInvoices"] }),
    );
    const payload = decode(token);
    payload.features = ["*"];
    const status = evaluateLicense(encode(payload), deps());
    expect(status.state).toBe("inactive");
    expect(licenseAllowsFeature(status, "cloudBackup")).toBe(false);
  });

  it("TC-LIC-010: re-pointing a valid serial at a different machine is rejected", () => {
    const token = mint(licensePayload());
    const payload = decode(token);
    payload.machineHash = OTHER_MACHINE;
    expect(evaluateLicense(encode(payload), deps()).state).toBe("inactive");
  });

  it("TC-LIC-011: flipping one bit of the signature is rejected", () => {
    const token = mint(licensePayload());
    const payload = decode(token);
    const sig = Buffer.from(payload.signature, "base64url");
    sig[0] ^= 0x01;
    payload.signature = sig.toString("base64url");
    expect(evaluateLicense(encode(payload), deps()).state).toBe("inactive");
  });

  it("TC-LIC-012: an empty signature is rejected by the schema, never reaching verify", () => {
    const token = encode({ ...licensePayload(), signature: "" });
    expect(evaluateLicense(token, deps()).state).toBe("inactive");
  });

  it("TC-LIC-013: unsigned garbage in place of a serial is rejected", () => {
    for (const junk of [
      "APLIC.not-base64-!!!",
      "APLIC." + Buffer.from("not json").toString("base64url"),
      "APLIC." + Buffer.from("[]").toString("base64url"),
      "APLIC." + Buffer.from("null").toString("base64url"),
      "APLIC.",
      "hello",
    ]) {
      expect(evaluateLicense(junk, deps()).state, junk.slice(0, 30)).toBe(
        "inactive",
      );
    }
  });

  it("TC-LIC-014: a token above the size cap is refused before any parsing", () => {
    const huge = "APLIC." + "A".repeat(MAX_TOKEN_LENGTH);
    const status = evaluateLicense(huge, deps());
    expect(status.state).toBe("inactive");
    expect(status.message).toBe("Token too large");
  });

  it("TC-LIC-015: reordering the payload's keys does not break a genuine serial", () => {
    // The counterpart to the tampering cases: canonical JSON must make the
    // signature independent of property order, or valid serials would break
    // on any client that re-serialises them.
    const token = mint(licensePayload({ features: ["pos"] }));
    const payload = decode(token);
    const reversed = Object.fromEntries(Object.entries(payload).reverse());
    expect(evaluateLicense(encode(reversed), deps()).state).toBe("active");
  });
});

describe("machine binding — TC-LIC", () => {
  it("TC-LIC-016: a serial minted for another machine reports machine_mismatch, not active", () => {
    // Signed correctly — the vendor really did issue it — but for someone
    // else's shop. This is the copy-the-serial-to-a-second-PC case.
    const token = mint(licensePayload({ machineHash: OTHER_MACHINE }));
    const status = evaluateLicense(token, deps());
    expect(status.state).toBe("machine_mismatch");
    expect(licenseAllowsFeature(status, "twoFactorAuth")).toBe(false);
  });

  it("TC-LIC-017: a machine that accepts no hash at all cannot be licensed", () => {
    const token = mint(licensePayload());
    const status = evaluateLicense(
      token,
      deps({ isMachineHashAccepted: () => false }),
    );
    expect(status.state).toBe("machine_mismatch");
  });
});

describe("expiry — TC-LIC", () => {
  it("TC-LIC-018: a limited serial past its expiry is expired", () => {
    const token = mint(
      licensePayload({
        subscriptionType: "limited",
        subscriptionExpiresAt: "2026-08-20T12:00:00.000Z", // yesterday
      }),
    );
    const status = evaluateLicense(token, deps());
    expect(status.state).toBe("expired");
    expect(licenseAllowsFeature(status, "cloudBackup")).toBe(false);
  });

  it("TC-LIC-019: a limited serial with NO expiry date is expired, not perpetual", () => {
    // Omitting the field must not be a way to buy a subscription and keep it
    // forever. `limited` without a date is treated as already run out.
    const token = mint(
      licensePayload({ subscriptionType: "limited", subscriptionExpiresAt: null }),
    );
    expect(evaluateLicense(token, deps()).state).toBe("expired");
  });

  it("TC-LIC-020: a limited serial with an unparseable expiry is expired", () => {
    const token = mint(
      licensePayload({
        subscriptionType: "limited",
        subscriptionExpiresAt: "not-a-date",
      }),
    );
    expect(evaluateLicense(token, deps()).state).toBe("expired");
  });

  it("TC-LIC-021: a lifetime serial never expires, whatever the date says", () => {
    const token = mint(
      licensePayload({
        subscriptionType: "lifetime",
        subscriptionExpiresAt: "2020-01-01T00:00:00.000Z",
      }),
    );
    expect(evaluateLicense(token, deps()).state).toBe("active");
  });

  it("TC-LIC-022: expiry is evaluated to the second, not the day", () => {
    const base = licensePayload({
      subscriptionType: "limited",
      subscriptionExpiresAt: NOW.toISOString(),
    });
    expect(evaluateLicense(mint(base), deps({ now: NOW })).state).toBe("active");
    expect(
      evaluateLicense(mint(base), deps({ now: new Date(NOW.getTime() + 1) }))
        .state,
    ).toBe("expired");
  });
});

describe("clock tampering — TC-LIC", () => {
  it("TC-LIC-023: rolling the clock back past the tolerance is caught", () => {
    // Winding the PC clock back is how you'd try to outrun a subscription.
    const lastSeen = new Date(NOW.getTime() + CLOCK_SKEW_MS + 60_000);
    storage.set(LICENSE_LAST_SEEN_KEY, lastSeen.toISOString());
    const status = evaluateLicense(mint(licensePayload()), deps());
    expect(status.state).toBe("clock_tampered");
  });

  it("TC-LIC-024: an ordinary NTP correction inside the tolerance is not punished", () => {
    storage.set(
      LICENSE_LAST_SEEN_KEY,
      new Date(NOW.getTime() + CLOCK_SKEW_MS - 60_000).toISOString(),
    );
    expect(evaluateLicense(mint(licensePayload()), deps()).state).toBe("active");
  });

  it("TC-LIC-025: an absurd future timestamp self-heals instead of locking the shop out", () => {
    // A corrupt reading must not permanently brick a paying customer.
    const corrupt = new Date(
      NOW.getTime() + CLOCK_TAMPER_SELF_HEAL_MS + 86_400_000,
    );
    storage.set(LICENSE_LAST_SEEN_KEY, corrupt.toISOString());
    const status = evaluateLicense(mint(licensePayload()), deps());
    expect(status.state).toBe("active");
    expect(storage.get(LICENSE_LAST_SEEN_KEY)).toBe(NOW.toISOString());
  });

  it("TC-LIC-026: persistSeen records the moment; without it nothing is written", () => {
    evaluateLicense(mint(licensePayload()), deps({ persistSeen: false }));
    expect(storage.has(LICENSE_LAST_SEEN_KEY)).toBe(false);
    evaluateLicense(mint(licensePayload()), deps({ persistSeen: true }));
    expect(storage.get(LICENSE_LAST_SEEN_KEY)).toBe(NOW.toISOString());
  });

  it("TC-LIC-027: an unreadable last-seen value is ignored rather than throwing", () => {
    storage.set(LICENSE_LAST_SEEN_KEY, "not-a-timestamp");
    expect(evaluateLicense(mint(licensePayload()), deps()).state).toBe("active");
  });
});

describe("remote block — TC-LIC", () => {
  it("TC-LIC-028: a serial the vendor blocked server-side stops working locally", () => {
    storage.set(LICENSE_SERVER_STATUS_KEY, "blocked");
    const status = evaluateLicense(mint(licensePayload()), deps());
    expect(status.state).toBe("inactive");
    expect(status.message).toBe("موقوف من الإدارة");
  });
});

describe("token-kind confusion — TC-LIC", () => {
  it("TC-LIC-029: a license serial cannot be replayed as an owner-password-reset code", () => {
    // The prefix is not covered by the signature, so only the schema stands
    // between a paying customer's own serial and a support code that resets
    // the owner password. It has to be enough.
    const licenseToken = mint(licensePayload());
    const replayed = "APSUP." + licenseToken.slice("APLIC.".length);
    expect(() =>
      parseSignedPayload(replayed, "APSUP.", supportSchema, vendor.publicKey),
    ).toThrow();
  });

  it("TC-LIC-031: the prefix gates a token on its own, not only via the schema", () => {
    // Every prefix in use is six characters, so deleting the startsWith()
    // check changes nothing the other tests can see: the slice lands in the
    // same place and the schema catches the mismatch instead. That makes the
    // prefix look decorative. It is not — it is what stops a genuine license
    // serial from satisfying a call site that asked for a different token
    // kind, and the only way to observe it is to hold the schema constant and
    // vary only the prefix. (Verified by mutation: removing the check makes
    // this case, and only this case, fail.)
    const licenseToken = mint(licensePayload());
    expect(
      parseSignedPayload(licenseToken, "APLIC.", licenseSchema, vendor.publicKey)
        .licenseId,
    ).toBe("LIC-0001");
    expect(() =>
      parseSignedPayload(licenseToken, "APSUP.", licenseSchema, vendor.publicKey),
    ).toThrow("Invalid token prefix");
    expect(() =>
      parseSignedPayload(licenseToken, "APBRN.", licenseSchema, vendor.publicKey),
    ).toThrow("Invalid token prefix");
  });

  it("TC-LIC-030: a support code cannot be replayed as a paid branch activation", () => {
    // Both carry machineHash + issuedAt + purpose and are signed by the same
    // key; `purpose` is what separates them, and it is inside the signature.
    const support = mint(
      {
        supportId: "SUP-1",
        purpose: "owner_password_reset",
        machineHash: THIS_MACHINE,
        issuedAt: "2026-08-01T00:00:00.000Z",
        expiresAt: "2026-09-01T00:00:00.000Z",
      },
      "APSUP.",
    );
    // It is genuinely valid as what it is …
    expect(
      parseSignedPayload(support, "APSUP.", supportSchema, vendor.publicKey)
        .supportId,
    ).toBe("SUP-1");
    // … and worthless as anything else.
    const replayed = "APBRN." + support.slice("APSUP.".length);
    expect(() =>
      parseSignedPayload(
        replayed,
        "APBRN.",
        branchActivationSchema,
        vendor.publicKey,
      ),
    ).toThrow();
    expect(() =>
      parseSignedPayload(
        "APLIC." + support.slice("APSUP.".length),
        "APLIC.",
        licenseSchema,
        vendor.publicKey,
      ),
    ).toThrow();
  });
});
