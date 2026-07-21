/**
 * Unit tests for electron/backup-crypto.cjs
 * Verifies AES-256-GCM encrypt/decrypt roundtrip, error handling, and
 * the isEncryptedBackup detector.
 *
 * TC-BCR-001 through TC-BCR-020
 */
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";

const require = createRequire(import.meta.url);
const {
  encryptBackupContent,
  decryptBackupContent,
  encryptBackupWithPassphrase,
  decryptBackupWithPassphrase,
  getBackupEnvelopeVersion,
  isEncryptedBackup,
  ENVELOPE_VERSION,
  PASSPHRASE_ENVELOPE_VERSION,
  ALGO,
} = require("../../../electron/backup-crypto.cjs");

const TEST_KEY = randomBytes(32);
const SAMPLE_PLAINTEXT = JSON.stringify({ version: "1.0", state: { products: [], customers: [] } });

// ── TC-BCR-001: Roundtrip ─────────────────────────────────────────────────────

describe("encrypt → decrypt roundtrip — TC-BCR-001", () => {
  it("decrypting the encrypted result returns the original plaintext", () => {
    const encrypted = encryptBackupContent(SAMPLE_PLAINTEXT, TEST_KEY);
    const decrypted = decryptBackupContent(encrypted, TEST_KEY);
    expect(decrypted).toBe(SAMPLE_PLAINTEXT);
  });

  it("works with Unicode / Arabic text", () => {
    const arabic = JSON.stringify({ state: { customers: [{ name: "أحمد محمد العوضي" }] } });
    const enc = encryptBackupContent(arabic, TEST_KEY);
    expect(decryptBackupContent(enc, TEST_KEY)).toBe(arabic);
  });

  it("works with large payloads (100 KB)", () => {
    const big = JSON.stringify({ data: "x".repeat(100_000) });
    const enc = encryptBackupContent(big, TEST_KEY);
    expect(decryptBackupContent(enc, TEST_KEY)).toBe(big);
  });

  it("each call produces a different ciphertext (random IV)", () => {
    const a = encryptBackupContent(SAMPLE_PLAINTEXT, TEST_KEY);
    const b = encryptBackupContent(SAMPLE_PLAINTEXT, TEST_KEY);
    expect(a).not.toBe(b);
  });
});

// ── TC-BCR-002: Envelope structure ───────────────────────────────────────────

describe("envelope structure — TC-BCR-002", () => {
  it("produces a valid JSON string", () => {
    const enc = encryptBackupContent(SAMPLE_PLAINTEXT, TEST_KEY);
    expect(() => JSON.parse(enc)).not.toThrow();
  });

  it(`envelope has v === ${ENVELOPE_VERSION}`, () => {
    const env = JSON.parse(encryptBackupContent(SAMPLE_PLAINTEXT, TEST_KEY));
    expect(env.v).toBe(ENVELOPE_VERSION);
  });

  it(`envelope has enc === "${ALGO}"`, () => {
    const env = JSON.parse(encryptBackupContent(SAMPLE_PLAINTEXT, TEST_KEY));
    expect(env.enc).toBe(ALGO);
  });

  it("envelope has iv, tag, data fields", () => {
    const env = JSON.parse(encryptBackupContent(SAMPLE_PLAINTEXT, TEST_KEY));
    expect(typeof env.iv).toBe("string");
    expect(typeof env.tag).toBe("string");
    expect(typeof env.data).toBe("string");
  });
});

// ── TC-BCR-003: Key validation ────────────────────────────────────────────────

describe("key validation — TC-BCR-003", () => {
  it("throws if key is not a Buffer", () => {
    expect(() => encryptBackupContent("test", "not-a-buffer" as unknown as Buffer)).toThrow();
  });

  it("throws if key is the wrong length", () => {
    expect(() => encryptBackupContent("test", randomBytes(16))).toThrow();
    expect(() => encryptBackupContent("test", randomBytes(31))).toThrow();
  });

  it("decryptBackupContent throws if key is wrong type", () => {
    const enc = encryptBackupContent(SAMPLE_PLAINTEXT, TEST_KEY);
    expect(() => decryptBackupContent(enc, "bad" as unknown as Buffer)).toThrow();
  });
});

// ── TC-BCR-004: Tamper detection ──────────────────────────────────────────────

describe("tamper detection — TC-BCR-004", () => {
  it("throws when ciphertext is tampered (wrong key)", () => {
    const enc = encryptBackupContent(SAMPLE_PLAINTEXT, TEST_KEY);
    const anotherKey = randomBytes(32);
    expect(() => decryptBackupContent(enc, anotherKey)).toThrow();
  });

  it("throws when data field is corrupted", () => {
    const env = JSON.parse(encryptBackupContent(SAMPLE_PLAINTEXT, TEST_KEY));
    env.data = Buffer.from("corrupted").toString("base64");
    expect(() => decryptBackupContent(JSON.stringify(env), TEST_KEY)).toThrow();
  });

  it("throws when auth tag is corrupted", () => {
    const env = JSON.parse(encryptBackupContent(SAMPLE_PLAINTEXT, TEST_KEY));
    env.tag = Buffer.from("badtag123456").toString("base64");
    expect(() => decryptBackupContent(JSON.stringify(env), TEST_KEY)).toThrow();
  });
});

// ── TC-BCR-005: decryptBackupContent error cases ──────────────────────────────

describe("decryptBackupContent error cases — TC-BCR-005", () => {
  it("throws on non-JSON input", () => {
    expect(() => decryptBackupContent("not json {{{", TEST_KEY)).toThrow();
  });

  it("throws on unsupported version", () => {
    const env = JSON.parse(encryptBackupContent(SAMPLE_PLAINTEXT, TEST_KEY));
    env.v = 99;
    expect(() => decryptBackupContent(JSON.stringify(env), TEST_KEY)).toThrow(/unsupported_version/);
  });

  it("throws on unsupported algorithm", () => {
    const env = JSON.parse(encryptBackupContent(SAMPLE_PLAINTEXT, TEST_KEY));
    env.enc = "aes-128-cbc";
    expect(() => decryptBackupContent(JSON.stringify(env), TEST_KEY)).toThrow(/unsupported_algorithm/);
  });

  it("throws when envelope is missing required fields", () => {
    const env = JSON.parse(encryptBackupContent(SAMPLE_PLAINTEXT, TEST_KEY));
    delete env.iv;
    expect(() => decryptBackupContent(JSON.stringify(env), TEST_KEY)).toThrow(/invalid_envelope/);
  });
});

// ── TC-BCR-006: isEncryptedBackup detector ────────────────────────────────────

describe("isEncryptedBackup detector — TC-BCR-006", () => {
  it("returns true for a valid encrypted envelope", () => {
    const enc = encryptBackupContent(SAMPLE_PLAINTEXT, TEST_KEY);
    expect(isEncryptedBackup(enc)).toBe(true);
  });

  it("returns false for plain JSON backup", () => {
    const plain = JSON.stringify({ version: "1.0", state: { products: [] } });
    expect(isEncryptedBackup(plain)).toBe(false);
  });

  it("returns false for an empty string", () => {
    expect(isEncryptedBackup("")).toBe(false);
  });

  it("returns false for malformed JSON", () => {
    expect(isEncryptedBackup("{bad json")).toBe(false);
  });

  it("returns false when v field differs", () => {
    const env = JSON.parse(encryptBackupContent(SAMPLE_PLAINTEXT, TEST_KEY));
    env.v = 2;
    expect(isEncryptedBackup(JSON.stringify(env))).toBe(false);
  });
});

// ── TC-BCR-007: passphrase (v2) envelope ──────────────────────────────────────

const PASSPHRASE = "S3cret-off-site-Backup!";

describe("passphrase envelope roundtrip — TC-BCR-007", () => {
  it("decrypts back to the original plaintext with the right passphrase", () => {
    const enc = encryptBackupWithPassphrase(SAMPLE_PLAINTEXT, PASSPHRASE);
    expect(decryptBackupWithPassphrase(enc, PASSPHRASE)).toBe(SAMPLE_PLAINTEXT);
  });

  it("works with Arabic / large payloads", () => {
    const big = JSON.stringify({ state: { customers: [{ name: "أحمد" }], blob: "x".repeat(50_000) } });
    const enc = encryptBackupWithPassphrase(big, PASSPHRASE);
    expect(decryptBackupWithPassphrase(enc, PASSPHRASE)).toBe(big);
  });

  it(`produces a v${PASSPHRASE_ENVELOPE_VERSION} scrypt envelope with a random salt`, () => {
    const env = JSON.parse(encryptBackupWithPassphrase(SAMPLE_PLAINTEXT, PASSPHRASE));
    expect(env.v).toBe(PASSPHRASE_ENVELOPE_VERSION);
    expect(env.enc).toBe(ALGO);
    expect(env.kdf).toBe("scrypt");
    expect(typeof env.salt).toBe("string");
    const a = encryptBackupWithPassphrase(SAMPLE_PLAINTEXT, PASSPHRASE);
    const b = encryptBackupWithPassphrase(SAMPLE_PLAINTEXT, PASSPHRASE);
    expect(a).not.toBe(b); // random salt + IV
  });

  it("throws on a wrong passphrase (auth-tag mismatch)", () => {
    const enc = encryptBackupWithPassphrase(SAMPLE_PLAINTEXT, PASSPHRASE);
    expect(() => decryptBackupWithPassphrase(enc, "wrong-passphrase")).toThrow();
  });

  it("throws when encrypting with an empty passphrase", () => {
    expect(() => encryptBackupWithPassphrase(SAMPLE_PLAINTEXT, "")).toThrow(/passphrase_required/);
  });

  it("throws passphrase_required when decrypting a v2 envelope with no passphrase", () => {
    const enc = encryptBackupWithPassphrase(SAMPLE_PLAINTEXT, PASSPHRASE);
    expect(() => decryptBackupWithPassphrase(enc, "")).toThrow(/passphrase_required/);
  });

  it("a v2 envelope cannot be opened with the app-key v1 decryptor", () => {
    const enc = encryptBackupWithPassphrase(SAMPLE_PLAINTEXT, PASSPHRASE);
    expect(() => decryptBackupContent(enc, TEST_KEY)).toThrow();
  });
});

// ── TC-BCR-008: getBackupEnvelopeVersion detector ─────────────────────────────

describe("getBackupEnvelopeVersion — TC-BCR-008", () => {
  it("returns 1 for an app-key envelope", () => {
    expect(getBackupEnvelopeVersion(encryptBackupContent(SAMPLE_PLAINTEXT, TEST_KEY))).toBe(1);
  });

  it("returns 2 for a passphrase envelope", () => {
    expect(getBackupEnvelopeVersion(encryptBackupWithPassphrase(SAMPLE_PLAINTEXT, PASSPHRASE))).toBe(2);
  });

  it("returns null for plaintext / non-JSON / unknown", () => {
    expect(getBackupEnvelopeVersion(JSON.stringify({ version: "1.0", state: {} }))).toBeNull();
    expect(getBackupEnvelopeVersion("not json")).toBeNull();
    expect(getBackupEnvelopeVersion("")).toBeNull();
  });
});
