import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  base32Decode,
  base32Encode,
  buildOtpAuthUri,
  digestRecoveryCode,
  generateRecoveryCodes,
  generateTotp,
  generateTotpSecret,
  normalizeRecoveryCode,
  recoveryCodeDigest,
  verifyRecoveryCodeDigest,
  verifyTotp,
} = require("../../../electron/mfa.cjs");

const RFC_SHA1_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("Base32", () => {
  it("encodes and decodes RFC 4648 values without padding", () => {
    expect(base32Encode(Buffer.from("foobar", "ascii"))).toBe("MZXW6YTBOI");
    expect(base32Decode("MZXW6YTBOI").toString("ascii")).toBe("foobar");
    expect(base32Decode("MZXW6YTBOI======").toString("ascii")).toBe("foobar");
  });

  it("accepts lowercase and human-friendly separators", () => {
    expect(base32Decode("mzxw-6ytb oi").toString("ascii")).toBe("foobar");
  });

  it("roundtrips arbitrary bytes", () => {
    const value = randomBytes(64);
    expect(base32Decode(base32Encode(value))).toEqual(value);
  });

  it("rejects invalid lengths, padding, characters, and discarded bits", () => {
    expect(() => base32Decode("M")).toThrow(/invalid_base32_length/);
    expect(() => base32Decode("MY===")).toThrow(/invalid_base32_padding/);
    expect(() => base32Decode("MY!=====")).toThrow(/invalid_base32/);
    expect(() => base32Decode("MZ")).toThrow(/non_canonical_base32/);
  });
});

describe("TOTP RFC 6238", () => {
  const vectors = [
    [59, "94287082"],
    [1_111_111_109, "07081804"],
    [1_111_111_111, "14050471"],
    [1_234_567_890, "89005924"],
    [2_000_000_000, "69279037"],
    [20_000_000_000, "65353130"],
  ] as const;

  it.each(vectors)("matches the SHA-1 vector at %i seconds", (seconds, expected) => {
    expect(generateTotp(RFC_SHA1_SECRET, {
      timestamp: seconds * 1_000,
      digits: 8,
    })).toBe(expected);
  });

  it("defaults to six digits and a 30-second period", () => {
    expect(generateTotp(RFC_SHA1_SECRET, { timestamp: 59_000 })).toBe("287082");
  });

  it("accepts the current, previous, and next counters in the default window", () => {
    const timestamp = 1_111_111_111_000;
    const currentCounter = Math.floor(timestamp / 1_000 / 30);
    const previousToken = generateTotp(RFC_SHA1_SECRET, { timestamp: timestamp - 30_000 });
    const currentToken = generateTotp(RFC_SHA1_SECRET, { timestamp });
    const nextToken = generateTotp(RFC_SHA1_SECRET, { timestamp: timestamp + 30_000 });

    expect(verifyTotp(previousToken, RFC_SHA1_SECRET, { timestamp })).toEqual({
      valid: true,
      counter: currentCounter - 1,
      delta: -1,
    });
    expect(verifyTotp(currentToken, RFC_SHA1_SECRET, { timestamp })).toEqual({
      valid: true,
      counter: currentCounter,
      delta: 0,
    });
    expect(verifyTotp(nextToken, RFC_SHA1_SECRET, { timestamp })).toEqual({
      valid: true,
      counter: currentCounter + 1,
      delta: 1,
    });
  });

  it("rejects tokens outside the window and malformed tokens", () => {
    const timestamp = 1_111_111_111_000;
    const tooOld = generateTotp(RFC_SHA1_SECRET, { timestamp: timestamp - 60_000 });

    expect(verifyTotp(tooOld, RFC_SHA1_SECRET, { timestamp })).toBeNull();
    expect(verifyTotp("12345", RFC_SHA1_SECRET, { timestamp })).toBeNull();
    expect(verifyTotp("１２３４５６", RFC_SHA1_SECRET, { timestamp })).toBeNull();
  });

  it("returns the counter needed by the caller to prevent replay", () => {
    const timestamp = 1_700_000_000_000;
    const token = generateTotp(RFC_SHA1_SECRET, { timestamp });
    const first = verifyTotp(token, RFC_SHA1_SECRET, { timestamp });
    const lastAcceptedCounter = first?.counter ?? -1;
    const replay = verifyTotp(token, RFC_SHA1_SECRET, { timestamp });

    expect(first).not.toBeNull();
    expect(replay?.counter).toBe(lastAcceptedCounter);
    expect((replay?.counter ?? -1) > lastAcceptedCounter).toBe(false);
  });
});

describe("TOTP enrollment material", () => {
  it("generates a 160-bit Base32 secret by default", () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(secret)).toHaveLength(20);
  });

  it("builds an Authenticator-compatible otpauth URI", () => {
    const uri = buildOtpAuthUri({
      secret: RFC_SHA1_SECRET,
      issuer: "AutoParts System",
      accountName: "owner@example.com",
    });
    const parsed = new URL(uri);

    expect(parsed.protocol).toBe("otpauth:");
    expect(parsed.hostname).toBe("totp");
    expect(decodeURIComponent(parsed.pathname)).toBe("/AutoParts System:owner@example.com");
    expect(parsed.searchParams.get("secret")).toBe(RFC_SHA1_SECRET);
    expect(parsed.searchParams.get("issuer")).toBe("AutoParts System");
    expect(parsed.searchParams.get("algorithm")).toBe("SHA1");
    expect(parsed.searchParams.get("digits")).toBe("6");
    expect(parsed.searchParams.get("period")).toBe("30");
  });
});

describe("recovery codes", () => {
  it("generates ten unique, unambiguous 80-bit codes by default", () => {
    const codes = generateRecoveryCodes();

    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) {
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){3}$/);
    }
  });

  it("normalizes lowercase codes with spaces or hyphens", () => {
    expect(normalizeRecoveryCode("abcd-efgh-jklm-npqr")).toBe("ABCDEFGHJKLMNPQR");
    expect(normalizeRecoveryCode("abcd efgh jklm npqr")).toBe("ABCDEFGHJKLMNPQR");
  });

  it("rejects ambiguous, short, and non-ASCII values", () => {
    expect(() => normalizeRecoveryCode("ABCI-EFGH-JKLM-NPQR")).toThrow(/invalid_recovery_code/);
    expect(() => normalizeRecoveryCode("ABCD-EFGH")).toThrow(/invalid_recovery_code/);
    expect(() => normalizeRecoveryCode("ＡＢＣＤ-EFGH-JKLM-NPQR")).toThrow(/invalid_recovery_code/);
  });

  it("stores a deterministic HMAC-SHA256 digest instead of plaintext", () => {
    const pepper = Buffer.alloc(32, 7);
    const digest = digestRecoveryCode("ABCD-EFGH-JKLM-NPQR", pepper);

    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(digest).not.toContain("ABCD");
    expect(digestRecoveryCode("abcd efgh jklm npqr", pepper)).toBe(digest);
    expect(recoveryCodeDigest("abcd efgh jklm npqr", pepper)).toBe(digest);
  });

  it("verifies with the same pepper and fails safely for bad input", () => {
    const code = "ABCD-EFGH-JKLM-NPQR";
    const pepper = Buffer.alloc(32, 9);
    const digest = digestRecoveryCode(code, pepper);

    expect(verifyRecoveryCodeDigest(code, digest, pepper)).toBe(true);
    expect(verifyRecoveryCodeDigest("RSTU-VWXY-Z234-5678", digest, pepper)).toBe(false);
    expect(verifyRecoveryCodeDigest(code, digest, Buffer.alloc(32, 8))).toBe(false);
    expect(verifyRecoveryCodeDigest("not-a-code", digest, pepper)).toBe(false);
    expect(verifyRecoveryCodeDigest(code, "not-a-digest", pepper)).toBe(false);
  });
});
