"use strict";

const {
  createHmac,
  randomBytes,
  timingSafeEqual,
} = require("node:crypto");

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const BASE32_INDEX = new Map(
  Array.from(BASE32_ALPHABET, (character, index) => [character, index]),
);

const DEFAULT_TOTP_DIGITS = 6;
const DEFAULT_TOTP_PERIOD_SECONDS = 30;
const DEFAULT_TOTP_WINDOW = 1;
const DEFAULT_TOTP_SECRET_BYTES = 20;

// Thirty-two unambiguous symbols means each generated character carries five
// unbiased random bits. Sixteen characters therefore provide 80 bits.
const RECOVERY_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const RECOVERY_CODE_CHARACTERS = 16;
const RECOVERY_CODE_GROUP_SIZE = 4;
const DEFAULT_RECOVERY_CODE_COUNT = 10;
const RECOVERY_DIGEST_DOMAIN = "autoparts:mfa-recovery:v1\0";

function base32Encode(value) {
  if (!Buffer.isBuffer(value) && !(value instanceof Uint8Array)) {
    throw new TypeError("base32_input_must_be_bytes");
  }

  const input = Buffer.from(value);
  let accumulator = 0;
  let bits = 0;
  let encoded = "";

  for (const byte of input) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      bits -= 5;
      encoded += BASE32_ALPHABET[(accumulator >>> bits) & 0x1f];
    }
  }

  if (bits > 0) {
    encoded += BASE32_ALPHABET[(accumulator << (5 - bits)) & 0x1f];
  }

  return encoded;
}

function base32Decode(value) {
  if (typeof value !== "string") {
    throw new TypeError("base32_input_must_be_string");
  }

  // Spaces and hyphens are accepted solely to support human-entered secrets.
  // All other non-ASCII or non-alphabet characters are rejected.
  const formatted = value.trim().replace(/[ \t\r\n-]/g, "").toUpperCase();
  if (formatted.length === 0) return Buffer.alloc(0);

  const firstPaddingIndex = formatted.indexOf("=");
  const unpadded = firstPaddingIndex === -1
    ? formatted
    : formatted.slice(0, firstPaddingIndex);
  const padding = firstPaddingIndex === -1
    ? ""
    : formatted.slice(firstPaddingIndex);

  if (!/^[A-Z2-7]+$/.test(unpadded) || (padding && !/^=+$/.test(padding))) {
    throw new Error("invalid_base32");
  }

  const remainder = unpadded.length % 8;
  const expectedPaddingByRemainder = new Map([
    [0, 0],
    [2, 6],
    [4, 4],
    [5, 3],
    [7, 1],
  ]);

  if (!expectedPaddingByRemainder.has(remainder)) {
    throw new Error("invalid_base32_length");
  }

  if (
    padding.length > 0
    && (
      formatted.length % 8 !== 0
      || padding.length !== expectedPaddingByRemainder.get(remainder)
    )
  ) {
    throw new Error("invalid_base32_padding");
  }

  const decoded = [];
  let accumulator = 0;
  let bits = 0;

  for (const character of unpadded) {
    const index = BASE32_INDEX.get(character);
    if (index === undefined) throw new Error("invalid_base32");

    accumulator = (accumulator << 5) | index;
    bits += 5;

    if (bits >= 8) {
      bits -= 8;
      decoded.push((accumulator >>> bits) & 0xff);
      accumulator &= (1 << bits) - 1;
    }
  }

  // Non-zero discarded bits represent a non-canonical encoding. Rejecting it
  // prevents multiple textual values from representing the same secret.
  if (accumulator !== 0) {
    throw new Error("non_canonical_base32");
  }

  return Buffer.from(decoded);
}

function generateTotpSecret(byteLength = DEFAULT_TOTP_SECRET_BYTES) {
  if (!Number.isInteger(byteLength) || byteLength < 16 || byteLength > 128) {
    throw new RangeError("invalid_totp_secret_length");
  }

  return base32Encode(randomBytes(byteLength));
}

function normalizeDigits(value) {
  if (!Number.isInteger(value) || value < 6 || value > 10) {
    throw new RangeError("invalid_totp_digits");
  }
  return value;
}

function normalizePeriod(value) {
  if (!Number.isInteger(value) || value < 1 || value > 3_600) {
    throw new RangeError("invalid_totp_period");
  }
  return value;
}

function normalizeTimestamp(value) {
  const timestamp = value instanceof Date ? value.getTime() : value;
  if (!Number.isFinite(timestamp) || timestamp < 0) {
    throw new RangeError("invalid_totp_timestamp");
  }
  return timestamp;
}

function normalizeCounter(value) {
  if (typeof value === "bigint") {
    if (value < 0n || value > 0xffffffffffffffffn) {
      throw new RangeError("invalid_hotp_counter");
    }
    return value;
  }

  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError("invalid_hotp_counter");
  }

  return BigInt(value);
}

function secretBytes(secret) {
  if (
    typeof secret !== "string"
    && !Buffer.isBuffer(secret)
    && !(secret instanceof Uint8Array)
  ) {
    throw new TypeError("totp_secret_must_be_base32_or_bytes");
  }

  const bytes = typeof secret === "string" ? base32Decode(secret) : Buffer.from(secret);

  if (bytes.length === 0) throw new Error("totp_secret_required");
  return bytes;
}

function generateHotp(secret, counter, options = {}) {
  const digits = normalizeDigits(options.digits ?? DEFAULT_TOTP_DIGITS);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(normalizeCounter(counter));

  const digest = createHmac("sha1", secretBytes(secret))
    .update(counterBuffer)
    .digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binaryCode = digest.readUInt32BE(offset) & 0x7fffffff;

  return String(binaryCode % (10 ** digits)).padStart(digits, "0");
}

function counterForTimestamp(timestamp, period) {
  return Math.floor(normalizeTimestamp(timestamp) / 1_000 / period);
}

function generateTotp(secret, options = {}) {
  const digits = normalizeDigits(options.digits ?? DEFAULT_TOTP_DIGITS);
  const period = normalizePeriod(options.period ?? DEFAULT_TOTP_PERIOD_SECONDS);
  const timestamp = options.timestamp ?? Date.now();
  const counter = counterForTimestamp(timestamp, period);

  return generateHotp(secret, counter, { digits });
}

function constantTimeTokenMatch(actual, expected) {
  const actualBuffer = Buffer.from(actual, "ascii");
  const expectedBuffer = Buffer.from(expected, "ascii");
  return actualBuffer.length === expectedBuffer.length
    && timingSafeEqual(actualBuffer, expectedBuffer);
}

/**
 * Returns the accepted time-step counter and its offset, or null.
 * The caller must persist the highest accepted counter and reject a result
 * whose counter is not greater, which prevents TOTP replay across requests.
 */
function verifyTotp(token, secret, options = {}) {
  const digits = normalizeDigits(options.digits ?? DEFAULT_TOTP_DIGITS);
  const period = normalizePeriod(options.period ?? DEFAULT_TOTP_PERIOD_SECONDS);
  const window = options.window ?? DEFAULT_TOTP_WINDOW;

  if (!Number.isInteger(window) || window < 0 || window > 10) {
    throw new RangeError("invalid_totp_window");
  }
  if (typeof token !== "string" || !(new RegExp(`^[0-9]{${digits}}$`)).test(token)) {
    return null;
  }

  const centerCounter = counterForTimestamp(options.timestamp ?? Date.now(), period);
  const deltas = [0];
  for (let distance = 1; distance <= window; distance += 1) {
    deltas.push(-distance, distance);
  }

  let accepted = null;
  for (const delta of deltas) {
    const candidateCounter = centerCounter + delta;
    if (candidateCounter < 0) continue;

    const expected = generateHotp(secret, candidateCounter, { digits });
    const matches = constantTimeTokenMatch(token, expected);
    if (matches && accepted === null) {
      accepted = { valid: true, counter: candidateCounter, delta };
    }
  }

  return accepted;
}

function requiredLabelPart(value, errorCode) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(errorCode);
  }
  const normalized = value.trim();
  if (normalized.includes(":")) throw new Error(`${errorCode}_contains_colon`);
  return normalized;
}

function buildOtpAuthUri({
  secret,
  accountName,
  issuer,
  digits = DEFAULT_TOTP_DIGITS,
  period = DEFAULT_TOTP_PERIOD_SECONDS,
} = {}) {
  const normalizedSecret = base32Encode(base32Decode(secret));
  if (!normalizedSecret) throw new Error("totp_secret_required");

  const normalizedAccountName = requiredLabelPart(accountName, "account_name_required");
  const normalizedIssuer = requiredLabelPart(issuer, "issuer_required");
  const normalizedDigits = normalizeDigits(digits);
  const normalizedPeriod = normalizePeriod(period);
  const label = `${encodeURIComponent(normalizedIssuer)}:${encodeURIComponent(normalizedAccountName)}`;
  const query = [
    ["secret", normalizedSecret],
    ["issuer", normalizedIssuer],
    ["algorithm", "SHA1"],
    ["digits", String(normalizedDigits)],
    ["period", String(normalizedPeriod)],
  ]
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&");

  return `otpauth://totp/${label}?${query}`;
}

function generateRecoveryCodes(count = DEFAULT_RECOVERY_CODE_COUNT) {
  if (!Number.isInteger(count) || count < 1 || count > 100) {
    throw new RangeError("invalid_recovery_code_count");
  }

  const codes = new Set();
  while (codes.size < count) {
    const entropy = randomBytes(RECOVERY_CODE_CHARACTERS);
    let compactCode = "";
    for (const byte of entropy) {
      compactCode += RECOVERY_CODE_ALPHABET[byte & 0x1f];
    }

    const groups = [];
    for (let offset = 0; offset < compactCode.length; offset += RECOVERY_CODE_GROUP_SIZE) {
      groups.push(compactCode.slice(offset, offset + RECOVERY_CODE_GROUP_SIZE));
    }
    codes.add(groups.join("-"));
  }

  return Array.from(codes);
}

function normalizeRecoveryCode(value) {
  if (typeof value !== "string") {
    throw new TypeError("recovery_code_must_be_string");
  }

  const normalized = value
    .trim()
    .toUpperCase()
    .replace(/[ \t\r\n-]/g, "");

  if (
    normalized.length !== RECOVERY_CODE_CHARACTERS
    || !Array.from(normalized).every((character) => RECOVERY_CODE_ALPHABET.includes(character))
  ) {
    throw new Error("invalid_recovery_code");
  }

  return normalized;
}

function pepperBytes(pepper) {
  let value;
  if (typeof pepper === "string") value = Buffer.from(pepper, "utf8");
  else if (Buffer.isBuffer(pepper) || pepper instanceof Uint8Array) value = Buffer.from(pepper);
  else throw new TypeError("recovery_code_pepper_must_be_bytes_or_string");

  if (value.length === 0) throw new Error("recovery_code_pepper_required");
  return value;
}

function digestRecoveryCode(code, pepper) {
  const normalized = normalizeRecoveryCode(code);
  return createHmac("sha256", pepperBytes(pepper))
    .update(RECOVERY_DIGEST_DOMAIN, "utf8")
    .update(normalized, "ascii")
    .digest("hex");
}

// Primary public name; digestRecoveryCode remains exported as a compatibility
// alias because both names describe the same one-way storage operation.
const recoveryCodeDigest = digestRecoveryCode;

function verifyRecoveryCodeDigest(code, expectedDigest, pepper) {
  // Invalid pepper is a programming/configuration error and should not be
  // hidden as an ordinary bad user code.
  const normalizedPepper = pepperBytes(pepper);
  if (typeof expectedDigest !== "string" || !/^[a-f0-9]{64}$/i.test(expectedDigest)) {
    return false;
  }

  let actualDigest;
  try {
    actualDigest = digestRecoveryCode(code, normalizedPepper);
  } catch (error) {
    if (
      error instanceof TypeError
      || (error instanceof Error && error.message === "invalid_recovery_code")
    ) {
      return false;
    }
    throw error;
  }

  return timingSafeEqual(
    Buffer.from(actualDigest, "hex"),
    Buffer.from(expectedDigest, "hex"),
  );
}

module.exports = {
  BASE32_ALPHABET,
  DEFAULT_RECOVERY_CODE_COUNT,
  DEFAULT_TOTP_DIGITS,
  DEFAULT_TOTP_PERIOD_SECONDS,
  DEFAULT_TOTP_SECRET_BYTES,
  DEFAULT_TOTP_WINDOW,
  RECOVERY_CODE_ALPHABET,
  RECOVERY_CODE_CHARACTERS,
  base32Decode,
  base32Encode,
  buildOtpAuthUri,
  digestRecoveryCode,
  generateHotp,
  generateRecoveryCodes,
  generateTotp,
  generateTotpSecret,
  normalizeRecoveryCode,
  recoveryCodeDigest,
  verifyRecoveryCodeDigest,
  verifyTotp,
};
