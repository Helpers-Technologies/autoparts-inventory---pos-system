"use strict";
/**
 * Pure AES-256-GCM backup encryption/decryption helpers.
 * Exported separately from main.cjs so they can be tested in isolation.
 *
 * The caller is responsible for providing the key (32-byte Buffer).
 */
const crypto = require("node:crypto");
const zlib = require("node:zlib");

const ENVELOPE_VERSION = 1;
// v2 = passphrase-protected envelope. The key is derived from a user-chosen
// passphrase via scrypt (per-file random salt) instead of the app-wide static
// key, so an exported/off-site backup can't be decrypted by anyone who merely
// has the app binary. Used only for manual exports; silent folder backups stay
// on v1 because they can't prompt for a passphrase.
const PASSPHRASE_ENVELOPE_VERSION = 2;
// v3 = v2, but the plaintext is gzipped before encryption.
//
// This is not a size optimisation, it is what makes the cloud archive usable
// at all. A three-year shop measured here serialises to 67 MB of JSON; base64
// of the ciphertext pushed the v2 envelope to 90 MB, well past the portal's
// 48 MB ceiling — so the customer who paid for off-site backup silently could
// not have one. Shop data is overwhelmingly repeated keys and Arabic product
// names, which gzip crushes.
//
// Compress-then-encrypt is the correct order (compressed ciphertext would not
// shrink) and the usual objection to it does not apply here: CRIME/BREACH-style
// attacks need an adversary who can inject chosen plaintext into a secret and
// watch the length change repeatedly. This payload is the shop's own data,
// uploaded whole, and the only observer is the portal, which already knows the
// size. Weighed against a feature that otherwise cannot ship, the trade is
// clear — but it is a trade, and it is recorded here deliberately.
const COMPRESSED_ENVELOPE_VERSION = 3;
const ALGO = "aes-256-gcm";
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, keylen: 32 };
const SCRYPT_MAXMEM = 64 * 1024 * 1024;

// Level 6 rather than the default 9: on the measured 67 MB shop it gives up
// about 3% of the compressed size for roughly half the CPU time, and this runs
// on a timer on the same machine the shop is selling from.
function gzip(text) {
  return zlib.gzipSync(Buffer.from(text, "utf8"), { level: 6 });
}
function gunzip(buffer) {
  return zlib.gunzipSync(buffer).toString("utf8");
}

function deriveScryptKey(passphrase, salt, params) {
  const p = params || SCRYPT_PARAMS;
  return crypto.scryptSync(Buffer.from(String(passphrase), "utf8"), salt, p.keylen || 32, {
    N: p.N,
    r: p.r,
    p: p.p,
    maxmem: SCRYPT_MAXMEM,
  });
}

/**
 * Encrypts {@param plaintext} with AES-256-GCM using {@param key}.
 * Returns a self-contained JSON string that includes the version, algorithm,
 * IV, auth tag, and ciphertext — all base64-encoded.
 *
 * @param {string} plaintext
 * @param {Buffer} key - 32-byte key
 * @returns {string}
 */
function encryptBackupContent(plaintext, key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error("key must be a 32-byte Buffer");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    v: ENVELOPE_VERSION,
    enc: ALGO,
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    data: encrypted.toString("base64"),
  });
}

/**
 * Decrypts an encrypted backup envelope produced by {@link encryptBackupContent}.
 * Throws on tampered data, unsupported version/algorithm, or malformed input.
 *
 * @param {string} encryptedStr - JSON envelope string
 * @param {Buffer} key - 32-byte key (must match the one used for encryption)
 * @returns {string} - original plaintext
 */
function decryptBackupContent(encryptedStr, key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error("key must be a 32-byte Buffer");
  let envelope;
  try {
    envelope = JSON.parse(encryptedStr);
  } catch {
    throw new Error("invalid_envelope: not valid JSON");
  }
  if (envelope.v !== ENVELOPE_VERSION) throw new Error(`unsupported_version: ${envelope.v}`);
  if (envelope.enc !== ALGO) throw new Error(`unsupported_algorithm: ${envelope.enc}`);
  if (!envelope.iv || !envelope.tag || !envelope.data) throw new Error("invalid_envelope: missing fields");
  const iv = Buffer.from(envelope.iv, "base64");
  const tag = Buffer.from(envelope.tag, "base64");
  const data = Buffer.from(envelope.data, "base64");
  const decipher = crypto.createDecipheriv(ALGO, key, iv, { authTagLength: 16 });
  decipher.setAuthTag(tag);
  return decipher.update(data) + decipher.final("utf8");
}

/**
 * Returns true when {@param str} looks like an encrypted backup envelope
 * (has the expected version/algorithm fields). Does NOT verify the signature.
 */
function isEncryptedBackup(str) {
  try {
    const parsed = JSON.parse(str);
    return parsed?.v === ENVELOPE_VERSION && parsed?.enc === ALGO;
  } catch {
    return false;
  }
}

/**
 * Returns the envelope version (1, 2 or 3) for a recognised encrypted backup,
 * or null for plain/unknown content. Used to decide whether a passphrase is
 * needed — v2 and v3 both need one, so anything that branches on this must
 * treat them alike rather than testing for 2 exactly.
 */
function getBackupEnvelopeVersion(str) {
  try {
    const parsed = JSON.parse(str);
    if (
      parsed &&
      parsed.enc === ALGO &&
      (parsed.v === ENVELOPE_VERSION ||
        parsed.v === PASSPHRASE_ENVELOPE_VERSION ||
        parsed.v === COMPRESSED_ENVELOPE_VERSION)
    ) {
      return parsed.v;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Encrypts {@param plaintext} with AES-256-GCM under a key derived from
 * {@param passphrase} via scrypt (random per-file salt). Produces a v2 envelope.
 *
 * @param {string} plaintext
 * @param {string} passphrase - non-empty user secret
 * @returns {string}
 */
function encryptBackupWithPassphrase(plaintext, passphrase) {
  if (typeof passphrase !== "string" || passphrase.length === 0) {
    throw new Error("passphrase_required");
  }
  const salt = crypto.randomBytes(16);
  const key = deriveScryptKey(passphrase, salt, SCRYPT_PARAMS);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const packed = gzip(plaintext);
  const encrypted = Buffer.concat([cipher.update(packed), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    v: COMPRESSED_ENVELOPE_VERSION,
    enc: ALGO,
    kdf: "scrypt",
    zip: "gzip",
    kdfParams: { N: SCRYPT_PARAMS.N, r: SCRYPT_PARAMS.r, p: SCRYPT_PARAMS.p, keylen: SCRYPT_PARAMS.keylen },
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    data: encrypted.toString("base64"),
  });
}

/**
 * Decrypts a v2 (passphrase) envelope produced by {@link encryptBackupWithPassphrase}.
 * Throws on a wrong passphrase (auth-tag mismatch), tampered data, or bad input.
 *
 * @param {string} encryptedStr
 * @param {string} passphrase
 * @returns {string}
 */
function decryptBackupWithPassphrase(encryptedStr, passphrase) {
  let envelope;
  try {
    envelope = JSON.parse(encryptedStr);
  } catch {
    throw new Error("invalid_envelope: not valid JSON");
  }
  // v2 and v3 are both accepted, and must stay that way: archives written
  // before compression existed are still the only copy some shop has.
  const compressed = envelope.v === COMPRESSED_ENVELOPE_VERSION;
  if (!compressed && envelope.v !== PASSPHRASE_ENVELOPE_VERSION) {
    throw new Error(`unsupported_version: ${envelope.v}`);
  }
  if (envelope.enc !== ALGO) throw new Error(`unsupported_algorithm: ${envelope.enc}`);
  if (envelope.kdf !== "scrypt") throw new Error(`unsupported_kdf: ${envelope.kdf}`);
  if (compressed && envelope.zip !== "gzip") throw new Error(`unsupported_compression: ${envelope.zip}`);
  if (!envelope.salt || !envelope.iv || !envelope.tag || !envelope.data) {
    throw new Error("invalid_envelope: missing fields");
  }
  if (typeof passphrase !== "string" || passphrase.length === 0) {
    throw new Error("passphrase_required");
  }
  const salt = Buffer.from(envelope.salt, "base64");
  const key = deriveScryptKey(passphrase, salt, envelope.kdfParams);
  const iv = Buffer.from(envelope.iv, "base64");
  const tag = Buffer.from(envelope.tag, "base64");
  const data = Buffer.from(envelope.data, "base64");
  const decipher = crypto.createDecipheriv(ALGO, key, iv, { authTagLength: 16 });
  decipher.setAuthTag(tag);
  // final() authenticates; decompression only happens on data GCM has already
  // vouched for, so a tampered archive fails as a bad tag, never as a zip bomb.
  const plain = Buffer.concat([decipher.update(data), decipher.final()]);
  return compressed ? gunzip(plain) : plain.toString("utf8");
}

/**
 * Async twin of {@link encryptBackupWithPassphrase}, byte-for-byte compatible.
 *
 * Exists for the periodic cloud archive, which runs unattended on Electron's
 * main thread: scryptSync with N=16384 and a 64 MB maxmem holds that thread for
 * ~100 ms, and every storage IPC from the renderer waits behind it. A manual
 * export can afford the sync version because the user is already waiting on a
 * dialog; a background job cannot.
 *
 * @param {string} plaintext
 * @param {string} passphrase - non-empty user secret
 * @returns {Promise<string>}
 */
function encryptBackupWithPassphraseAsync(plaintext, passphrase) {
  if (typeof passphrase !== "string" || passphrase.length === 0) {
    return Promise.reject(new Error("passphrase_required"));
  }
  const salt = crypto.randomBytes(16);
  return new Promise((resolve, reject) => {
    crypto.scrypt(
      Buffer.from(String(passphrase), "utf8"),
      salt,
      SCRYPT_PARAMS.keylen,
      { N: SCRYPT_PARAMS.N, r: SCRYPT_PARAMS.r, p: SCRYPT_PARAMS.p, maxmem: SCRYPT_MAXMEM },
      (error, key) => {
        if (error) return reject(error);
        try {
          const iv = crypto.randomBytes(12);
          const cipher = crypto.createCipheriv(ALGO, key, iv);
          const packed = gzip(plaintext);
          const encrypted = Buffer.concat([cipher.update(packed), cipher.final()]);
          resolve(JSON.stringify({
            v: COMPRESSED_ENVELOPE_VERSION,
            enc: ALGO,
            kdf: "scrypt",
            zip: "gzip",
            kdfParams: { N: SCRYPT_PARAMS.N, r: SCRYPT_PARAMS.r, p: SCRYPT_PARAMS.p, keylen: SCRYPT_PARAMS.keylen },
            salt: salt.toString("base64"),
            iv: iv.toString("base64"),
            tag: cipher.getAuthTag().toString("base64"),
            data: encrypted.toString("base64"),
          }));
        } catch (cipherError) {
          reject(cipherError);
        }
      },
    );
  });
}

module.exports = {
  encryptBackupContent,
  decryptBackupContent,
  encryptBackupWithPassphrase,
  encryptBackupWithPassphraseAsync,
  decryptBackupWithPassphrase,
  isEncryptedBackup,
  getBackupEnvelopeVersion,
  ENVELOPE_VERSION,
  PASSPHRASE_ENVELOPE_VERSION,
  COMPRESSED_ENVELOPE_VERSION,
  ALGO,
};
