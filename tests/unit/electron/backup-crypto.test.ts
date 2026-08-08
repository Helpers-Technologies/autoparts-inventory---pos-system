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
import crypto from "node:crypto";

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
  COMPRESSED_ENVELOPE_VERSION,
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

  it(`produces a v${COMPRESSED_ENVELOPE_VERSION} scrypt envelope with a random salt`, () => {
    const env = JSON.parse(encryptBackupWithPassphrase(SAMPLE_PLAINTEXT, PASSPHRASE));
    // v3 since compression landed; v2 stays readable, which the compatibility
    // test below covers explicitly.
    expect(env.v).toBe(COMPRESSED_ENVELOPE_VERSION);
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

// ── Compression (v3) ──────────────────────────────────────────────────────
//
// v3 gzips before encrypting so a real shop's archive fits the portal's 48 MB
// ceiling. The tests that matter are the ones about NOT breaking v2: an archive
// written before this change may be the only copy a shop has.

describe("v3 compressed envelope", () => {
  /** Byte-for-byte the v2 format, built here so the compatibility test does not
   *  depend on the current encryptor still being able to produce one. */
  function makeV2Envelope(plaintext: string, passphrase: string) {
    const salt = crypto.randomBytes(16);
    const params = { N: 16384, r: 8, p: 1, keylen: 32 };
    const key = crypto.scryptSync(Buffer.from(passphrase, "utf8"), salt, params.keylen, {
      N: params.N, r: params.r, p: params.p, maxmem: 64 * 1024 * 1024,
    });
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return JSON.stringify({
      v: 2, enc: "aes-256-gcm", kdf: "scrypt", kdfParams: params,
      salt: salt.toString("base64"), iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64"),
    });
  }

  it("still restores an archive written before compression existed", () => {
    const legacy = makeV2Envelope(SAMPLE_PLAINTEXT, PASSPHRASE);
    expect(JSON.parse(legacy).v).toBe(2);
    expect(decryptBackupWithPassphrase(legacy, PASSPHRASE)).toBe(SAMPLE_PLAINTEXT);
  });

  it("reports v2 archives as passphrase-protected so the UI still prompts", () => {
    expect(getBackupEnvelopeVersion(makeV2Envelope(SAMPLE_PLAINTEXT, PASSPHRASE))).toBe(2);
  });

  it("marks itself as gzip and round-trips", () => {
    const env = JSON.parse(encryptBackupWithPassphrase(SAMPLE_PLAINTEXT, PASSPHRASE));
    expect(env.v).toBe(3);
    expect(env.zip).toBe("gzip");
    expect(decryptBackupWithPassphrase(JSON.stringify(env), PASSPHRASE)).toBe(SAMPLE_PLAINTEXT);
  });

  it("actually shrinks shop-shaped data, which is the entire point", () => {
    // Repetitive records with Arabic names — what a real archive looks like.
    const shop = JSON.stringify({
      products: Array.from({ length: 2000 }, (_, i) => ({
        id: `prod-${i}`, code: `P-${i}`, name: `فلتر زيت بوش تويوتا ${i}`,
        category: "فلاتر", unit: "قطعة", purchasePrice: 120.5, retailPrice: 165,
        quantity: 12, minStock: 4, archived: false,
      })),
    });
    const envelope = encryptBackupWithPassphrase(shop, PASSPHRASE);
    // Base64 inflates by 4/3, so an uncompressed envelope is always LARGER than
    // its plaintext. Beating the plaintext at all proves compression is on.
    expect(envelope.length).toBeLessThan(shop.length / 2);
    expect(decryptBackupWithPassphrase(envelope, PASSPHRASE)).toBe(shop);
  });

  it("rejects a tampered payload as a bad tag, never as a bad gzip stream", () => {
    const env = JSON.parse(encryptBackupWithPassphrase(SAMPLE_PLAINTEXT, PASSPHRASE));
    const bytes = Buffer.from(env.data, "base64");
    bytes[Math.floor(bytes.length / 2)] ^= 0xff;
    env.data = bytes.toString("base64");
    // GCM authenticates before anything is handed to zlib, so this must fail
    // on the auth tag — decompressing attacker-controlled bytes is how a zip
    // bomb would get a foothold.
    expect(() => decryptBackupWithPassphrase(JSON.stringify(env), PASSPHRASE))
      .toThrow(/unable to authenticate|auth/i);
  });

  it("refuses an unknown compression algorithm rather than guessing", () => {
    const env = JSON.parse(encryptBackupWithPassphrase(SAMPLE_PLAINTEXT, PASSPHRASE));
    env.zip = "brotli";
    expect(() => decryptBackupWithPassphrase(JSON.stringify(env), PASSPHRASE))
      .toThrow(/unsupported_compression/);
  });
});

// ── TC-BCR-008: getBackupEnvelopeVersion detector ─────────────────────────────

describe("getBackupEnvelopeVersion — TC-BCR-008", () => {
  it("returns 1 for an app-key envelope", () => {
    expect(getBackupEnvelopeVersion(encryptBackupContent(SAMPLE_PLAINTEXT, TEST_KEY))).toBe(1);
  });

  it("returns 3 for a freshly written passphrase envelope", () => {
    expect(getBackupEnvelopeVersion(encryptBackupWithPassphrase(SAMPLE_PLAINTEXT, PASSPHRASE))).toBe(3);
  });

  it("returns null for plaintext / non-JSON / unknown", () => {
    expect(getBackupEnvelopeVersion(JSON.stringify({ version: "1.0", state: {} }))).toBeNull();
    expect(getBackupEnvelopeVersion("not json")).toBeNull();
    expect(getBackupEnvelopeVersion("")).toBeNull();
  });
});
