const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const crypto = require("node:crypto");
const childProcess = require("node:child_process");
const { pathToFileURL } = require("node:url");
const electronRuntime = require("electron");
const Database = require("better-sqlite3-multiple-ciphers");
const argon2 = require("argon2");
const { machineIdSync } = require("node-machine-id");
const { z } = require("zod");

let LICENSE_PUBLIC_KEY;
try {
  ({ LICENSE_PUBLIC_KEY } = require("./license-public-key.cjs"));
} catch (e) {
  if (e && (e.code === "MODULE_NOT_FOUND" || e.code === "ERR_MODULE_NOT_FOUND")) {
    console.error(
      "[electron] Missing `electron/license-public-key.cjs`.\n" +
        "Copy `electron/license-public-key.example.cjs` to `electron/license-public-key.cjs` " +
        "and replace the PEM with your deployment Ed25519 public key (team-only; do not commit)."
    );
  }
  throw e;
}

if (!electronRuntime.app) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const electronPath = typeof electronRuntime === "string" ? electronRuntime : process.execPath;
  const result = childProcess.spawnSync(
    electronPath,
    [path.join(__dirname, ".."), ...process.argv.slice(2)],
    { env, stdio: "inherit" }
  );
  process.exit(result.status ?? 0);
}

const { app, BrowserWindow, dialog, ipcMain, shell, session } = electronRuntime;
const internalPrintWebContents = new Set();

const APP_ID = "com.helperstechnologies.autoparts";
const APP_SALT = "autoparts-inventory-system-v1-local-license";
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const MAX_TOKEN_LENGTH = 8192;
const MAX_USERNAME_LENGTH = 80;
const MAX_PASSWORD_LENGTH = 256;

// ── E2E test mode — gated by HW_E2E=1 AND an unpackaged build. ──
// SECURITY: `app.isPackaged` is true for any electron-builder output, so the
// env var alone can never re-enable this in a shipped installer — it only works
// when running main.cjs directly (dev / Playwright), which is exactly how the
// E2E harness launches it. This closes the license-bypass via `HW_E2E=1`.
const HW_E2E = process.env.HW_E2E === "1" && !app.isPackaged;

// ── Storage security: pure predicates and redaction helpers ─────────────
const {
  STORE_PREFIX,
  REDACTED_PASSWORD_HASH,
  PROTECTED_KEYS,
  safeUserForRenderer,
  safeUsersForRenderer,
} = require("./storage-security.cjs");

// ── Rate-limiting: pure state machine ────────────────────────────────────
const {
  checkRateLimit,
  recordFailedAttempt,
  recordFailedSupportAttempt,
  clearAttempts,
} = require("./rate-limit.cjs");
const {
  generateTotpSecret,
  buildOtpAuthUri,
  verifyTotp,
  generateRecoveryCodes,
  normalizeRecoveryCode,
  recoveryCodeDigest,
} = require("./mfa.cjs");

// Derived keys used only inside main.cjs
const LICENSE_TOKEN_KEY = "__license_token";
const LICENSE_LAST_SEEN_KEY = "__license_last_seen_at";
const BRANCH_ACTIVATIONS_KEY = "__branch_license_activations";
const BRANCH_LEGACY_SLOTS_KEY = "__branch_license_legacy_slots";
const BRANCHES_STORAGE_KEY = `${STORE_PREFIX}branches`;
const AUTH_STATE_KEY = `${STORE_PREFIX}auth`;

// ── SECURITY: Login brute-force protection ──────────────────────────────
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_LOCKOUT_MS = 60 * 1000; // in-memory fast-path lockout
const loginAttempts = new Map(); // key: username → { count, lockedUntil }
// Persisted, escalating lockout — survives an app restart so a brute-forcer
// can't clear the in-memory counter by relaunching the app. Each consecutive
// lockout (without a successful login in between) steps up the duration.
const LOGIN_LOCKS_KEY = "__login_locks"; // { [key]: { lockedUntil, level } }
const LOGIN_LOCKOUT_STEPS_MS = [60 * 1000, 5 * 60 * 1000, 15 * 60 * 1000, 60 * 60 * 1000];
const LOGIN_LOCK_RETENTION_MS = 24 * 60 * 60 * 1000; // prune stale keys after 24h
const SUPPORT_MAX_ATTEMPTS = 5;
const SUPPORT_LOCKOUT_MS = 10 * 60 * 1000;
const supportAttempts = new Map(); // key: sender id → { count, lockedUntil }
const MFA_MAX_ATTEMPTS = 5;
const MFA_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const MFA_RECOVERY_LOCKOUT_MS = 10 * 60 * 1000;
const MFA_POLICY_MODES = new Set(["disabled", "optional", "required_owner", "required_all"]);
const mfaChallenges = new Map(); // challenge id → password-verified login/enrollment state
const recoveryAttempts = new Map(); // sender id → recovery-code throttle

let db = null;
let walCheckpointInterval = null; // handle for the periodic WAL flush timer
let isQuitting = false; // set once shutdown starts so late IPC never re-touches the DB
const printDocumentNames = new Map();
const rendererSessions = new Map(); // key: webContents id → { userId, role }

function isSmokeTestRun() {
  return process.argv.includes("--smoke-test") || process.env.HELPERS_SMOKE_TEST === "1";
}

function exitForSmokeTest() {
  isQuitting = true;
  try {
    closeDatabase();
  } catch {
    // Ignore shutdown cleanup errors in smoke mode.
  } finally {
    app.exit(0);
  }
}

const permissionTemplate = {
  products: { view: true, add: true, edit: true, delete: true },
  inventory: { view: true, adjust: true },
  purchaseInvoices: { view: true, add: true, edit: true, pay: true, delete: true },
  salesInvoices: { view: true, add: true, receive: true, cancel: true, delete: true },
  customers: { view: true, add: true, edit: true, delete: true },
  suppliers: { view: true, add: true, edit: true, delete: true, commissions: true },
  drivers: { view: true, add: true, edit: true, delete: true },
  returns: { view: true, add: true },
  alerts: { view: true },
  cashbox: { view: true, add: true, spend: true, editOpeningBalance: true },
  reports: { view: true },
};

if (process.platform === "win32") {
  app.setAppUserModelId(APP_ID);
}

function getAppIconPath() {
  const iconCandidates = app.isPackaged
    ? [
        path.join(process.resourcesPath, "build", "icon.ico"),
        path.join(process.resourcesPath, "app.asar", "build", "icon.ico"),
        path.join(process.resourcesPath, "app", "build", "icon.ico"),
      ]
    : [path.join(__dirname, "..", "build", "icon.ico")];

  return iconCandidates.find((candidate) => fs.existsSync(candidate)) || iconCandidates[0];
}

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
  // Absent on serials issued before packaging ⇒ all features allowed.
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

const branchCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  address: z.string().trim().max(240).optional(),
  phone: z.string().trim().max(40).optional(),
});

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function normalizeUsername(username) {
  return String(username || "").trim().slice(0, MAX_USERNAME_LENGTH);
}

function normalizePassword(password) {
  return String(password ?? "");
}

function isPasswordLengthAllowed(password, minLength = 0) {
  const cleanPassword = normalizePassword(password);
  return cleanPassword.length >= minLength && cleanPassword.length <= MAX_PASSWORD_LENGTH;
}

function parseDateMs(value) {
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function isArgonPasswordHash(value) {
  return typeof value === "string" && value.startsWith("$argon2");
}

// safeUserForRenderer and safeUsersForRenderer imported from ./storage-security.cjs

function getSession(event) {
  return rendererSessions.get(event.sender.id) || null;
}

function setSession(event, user) {
  if (!user?.id) return;
  rendererSessions.set(event.sender.id, {
    userId: user.id,
    role: user.role,
  });
}

function clearSession(event) {
  rendererSessions.delete(event.sender.id);
}

function hasOwnerSession(event) {
  return getSession(event)?.role === "owner";
}

// Resolve the full stored user record for the caller's session (permissions live
// on the user object, not on the lightweight session record).
function getSessionUser(event) {
  const info = getSession(event);
  if (!info) return null;
  return getUsers().find((user) => user.id === info.userId) || null;
}

// SECURITY: server-side authorization for a permission module. Mirrors the
// renderer's hasPermission() so print/PDF IPC can't be used to read documents
// the caller has no "view" permission for. Owners always pass.
function sessionCanViewModule(event, module) {
  const user = getSessionUser(event);
  if (!user) return false;
  if (user.role === "owner") return true;
  const perms = user.permissions;
  return Boolean(perms && perms[module] && perms[module].view);
}

// Maps a print route to the permission module that gates it. Quotations and
// sales are both gated by salesInvoices (matches the renderer guards).
function printModuleForRoute(route) {
  const cleanRoute = normalizePrintRoute(route); // throws on unsupported routes
  return cleanRoute.startsWith("/purchases/") ? "purchaseInvoices" : "salesInvoices";
}

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

function getMachineMaterial() {
  try {
    return machineIdSync(true);
  } catch {
    return sha256(
      [os.hostname(), os.platform(), os.arch(), os.cpus()?.[0]?.model || "cpu"]
        .filter(Boolean)
        .join("|")
    );
  }
}

function getMachineCode() {
  const digest = sha256(`${APP_SALT}:machine:${getMachineMaterial()}`).toUpperCase();
  const groups = digest.slice(0, 32).match(/.{1,4}/g) || [];
  return `APW-${groups.join("-")}`;
}

function getMachineHash() {
  return sha256(getMachineCode());
}

function getDbKey() {
  return sha256(`${APP_SALT}:db:${getMachineMaterial()}`);
}

// Backup encryption — delegates to the pure backup-crypto module so the
// encrypt/decrypt logic can be unit-tested independently of main.cjs.
const {
  encryptBackupContent,
  decryptBackupContent,
  encryptBackupWithPassphrase,
  decryptBackupWithPassphrase,
  getBackupEnvelopeVersion,
} = require("./backup-crypto.cjs");

function getBackupKey() {
  return Buffer.from(sha256(`${APP_SALT}:backup`), "hex");
}

function normalizeBackupPassphrase(passphrase) {
  return typeof passphrase === "string" ? passphrase.trim() : "";
}

// A non-empty passphrase produces a portable, passphrase-protected v2 envelope;
// otherwise we fall back to the app-key v1 envelope (silent folder backups).
function encryptBackup(plaintext, passphrase) {
  const pass = normalizeBackupPassphrase(passphrase);
  if (pass) return encryptBackupWithPassphrase(plaintext, pass);
  return encryptBackupContent(plaintext, getBackupKey());
}

// Chooses the decryptor by envelope version. v2 requires the passphrase; v1
// (and legacy) use the app key.
function decryptBackup(encryptedStr, passphrase) {
  if (getBackupEnvelopeVersion(encryptedStr) === 2) {
    const pass = normalizeBackupPassphrase(passphrase);
    if (!pass) throw new Error("passphrase_required");
    return decryptBackupWithPassphrase(encryptedStr, pass);
  }
  return decryptBackupContent(encryptedStr, getBackupKey());
}

function openDatabase() {
  if (db) return db;

  const dbPath = HW_E2E && process.env.HW_E2E_DB_PATH
    ? process.env.HW_E2E_DB_PATH
    : path.join(app.getPath("userData"), "autoparts-inventory.secure.sqlite");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const existed = fs.existsSync(dbPath);

  db = new Database(dbPath);
  // SECURITY: Use parameterized key setting to prevent SQL injection.
  // The key is hex-only (SHA-256 output) but we use x'' literal for safety.
  const dbKeyHex = getDbKey();
  if (existed) {
    db.pragma(`key="x'${dbKeyHex}'"`);
  } else {
    db.pragma(`rekey="x'${dbKeyHex}'"`);
  }
  db.pragma("journal_mode = WAL");
  db.prepare(
    "CREATE TABLE IF NOT EXISTS kv_store (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)"
  ).run();
  db.prepare(
    `CREATE TABLE IF NOT EXISTS user_mfa (
      user_id TEXT PRIMARY KEY,
      secret_encrypted TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      enrolled_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_used_counter INTEGER
    )`
  ).run();
  db.prepare(
    `CREATE TABLE IF NOT EXISTS mfa_recovery_codes (
      user_id TEXT NOT NULL,
      code_digest TEXT NOT NULL,
      created_at TEXT NOT NULL,
      consumed_at TEXT,
      PRIMARY KEY (user_id, code_digest)
    )`
  ).run();
  db.prepare(
    "CREATE INDEX IF NOT EXISTS idx_mfa_recovery_digest ON mfa_recovery_codes(code_digest, consumed_at)"
  ).run();
  db.prepare(
    `CREATE TABLE IF NOT EXISTS auth_security_policy (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      mode TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`
  ).run();
  db.prepare(
    `CREATE TABLE IF NOT EXISTS mfa_attempt_locks (
      user_id TEXT PRIMARY KEY,
      failed_attempts INTEGER NOT NULL DEFAULT 0,
      locked_until INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    )`
  ).run();
  db.prepare(
    `CREATE TABLE IF NOT EXISTS consumed_support_codes (
      support_id TEXT PRIMARY KEY,
      consumed_at TEXT NOT NULL
    )`
  ).run();
  db.prepare(
    "INSERT OR IGNORE INTO auth_security_policy (id, mode, updated_at) VALUES (1, 'optional', ?)"
  ).run(new Date().toISOString());
  db.prepare("DELETE FROM kv_store WHERE key = ?").run(AUTH_STATE_KEY);

  // Flush the WAL file periodically so it never grows unboundedly.
  // A large WAL file makes every read slower over time — this is a key cause
  // of the renderer freezing after hours of use.
  // Clear any prior timer first so repeated open/close cycles don't leak timers.
  if (walCheckpointInterval) clearInterval(walCheckpointInterval);
  walCheckpointInterval = setInterval(() => {
    try { db?.pragma("wal_checkpoint(PASSIVE)"); } catch { /* ignore */ }
  }, 10 * 60 * 1000); // every 10 minutes

  return db;
}

// Tear down the DB cleanly: stop the WAL timer, drop cached prepared statements
// (they hold a reference to the connection and become "not open" after close),
// then close and null the handle. Resetting the statement cache is what prevents
// a late synchronous IPC call (e.g. storage:get during shutdown) from touching a
// stale statement and throwing "The database connection is not open".
function closeDatabase() {
  if (walCheckpointInterval) {
    clearInterval(walCheckpointInterval);
    walCheckpointInterval = null;
  }
  _stmtGet = null;
  _stmtSet = null;
  _stmtRemove = null;
  _stmtClearPrefix = null;
  try {
    db?.close();
  } finally {
    db = null;
  }
}

// Cached prepared statements — created once after DB is first opened.
let _stmtGet = null;
let _stmtSet = null;
let _stmtRemove = null;
let _stmtClearPrefix = null;

function getStmtGet() {
  if (!_stmtGet) _stmtGet = openDatabase().prepare("SELECT value FROM kv_store WHERE key = ?");
  return _stmtGet;
}
function getStmtSet() {
  if (!_stmtSet) _stmtSet = openDatabase().prepare(
    "INSERT INTO kv_store (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
  );
  return _stmtSet;
}
function getStmtRemove() {
  if (!_stmtRemove) _stmtRemove = openDatabase().prepare("DELETE FROM kv_store WHERE key = ?");
  return _stmtRemove;
}
function getStmtClearPrefix() {
  if (!_stmtClearPrefix) _stmtClearPrefix = openDatabase().prepare("DELETE FROM kv_store WHERE key LIKE ?");
  return _stmtClearPrefix;
}

function storageGet(key) {
  const row = getStmtGet().get(key);
  return row?.value ?? null;
}

function storageSet(key, value) {
  getStmtSet().run(key, String(value), new Date().toISOString());
  return true;
}

function storageRemove(key) {
  getStmtRemove().run(key);
  return true;
}

function storageClearPrefix(prefix) {
  getStmtClearPrefix().run(`${prefix}%`);
  return true;
}

function readJsonKey(key, fallback) {
  const raw = storageGet(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJsonKey(key, value) {
  return storageSet(key, JSON.stringify(value));
}

function getUsers() {
  const users = readJsonKey(`${STORE_PREFIX}users`, []);
  if (!Array.isArray(users)) return [];
  return users.map((user) => ({
    ...user,
    name: String(user.name || user.username || "").trim(),
  }));
}

function setUsers(users) {
  writeJsonKey(`${STORE_PREFIX}users`, users);
}

function getMfaEncryptionKey() {
  return Buffer.from(sha256(`${APP_SALT}:mfa-secret:${getMachineMaterial()}`), "hex");
}

function getMfaRecoveryPepper() {
  return Buffer.from(sha256(`${APP_SALT}:mfa-recovery:${getMachineMaterial()}`), "hex");
}

function encryptMfaSecret(secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getMfaEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(secret), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

function decryptMfaSecret(envelope) {
  const [version, ivPart, tagPart, ciphertextPart] = String(envelope || "").split(".");
  if (version !== "v1" || !ivPart || !tagPart || !ciphertextPart) {
    throw new Error("invalid_mfa_secret");
  }
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    getMfaEncryptionKey(),
    Buffer.from(ivPart, "base64url")
  );
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextPart, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function getMfaPolicyMode() {
  const row = openDatabase().prepare("SELECT mode FROM auth_security_policy WHERE id = 1").get();
  return MFA_POLICY_MODES.has(row?.mode) ? row.mode : "optional";
}

function getMfaPolicy() {
  return { mode: getEffectiveMfaPolicyMode() };
}

// MFA is a paid add-on. This check lives in the main process so changing the
// renderer/UI cannot enable it without a signed license feature entitlement.
function isMfaFeatureLicensed() {
  if (HW_E2E) return true;
  const status = getLicenseStatus();
  const features = status?.license?.features;
  return status?.state === "active" && Array.isArray(features) &&
    (features.includes("twoFactorAuth") || features.includes("*"));
}

function getEffectiveMfaPolicyMode() {
  return isMfaFeatureLicensed() ? getMfaPolicyMode() : "disabled";
}

function getMfaRecord(userId) {
  return openDatabase()
    .prepare(
      "SELECT user_id, secret_encrypted, enabled, enrolled_at, updated_at, last_used_counter FROM user_mfa WHERE user_id = ?"
    )
    .get(String(userId || ""));
}

function isMfaRequiredForUser(user, mode = getEffectiveMfaPolicyMode()) {
  if (!user || mode === "disabled" || mode === "optional") return false;
  return mode === "required_all" || (mode === "required_owner" && user.role === "owner");
}

function countRecoveryCodes(userId) {
  const row = openDatabase()
    .prepare(
      "SELECT COUNT(*) AS count FROM mfa_recovery_codes WHERE user_id = ? AND consumed_at IS NULL"
    )
    .get(String(userId || ""));
  return Number(row?.count || 0);
}

function checkMfaVerificationLock(userId) {
  const row = openDatabase()
    .prepare("SELECT failed_attempts, locked_until FROM mfa_attempt_locks WHERE user_id = ?")
    .get(String(userId || ""));
  if (!row) return null;
  const now = Date.now();
  if (Number(row.locked_until) > now) {
    return {
      ok: false,
      error: "rate_limited",
      remainSeconds: Math.ceil((Number(row.locked_until) - now) / 1000),
      attemptsRemaining: 0,
    };
  }
  if (Number(row.locked_until) > 0) {
    openDatabase().prepare("DELETE FROM mfa_attempt_locks WHERE user_id = ?").run(userId);
  }
  return null;
}

function recordFailedMfaVerification(userId) {
  const limited = checkMfaVerificationLock(userId);
  if (limited) return limited;
  const now = Date.now();
  const row = openDatabase()
    .prepare("SELECT failed_attempts FROM mfa_attempt_locks WHERE user_id = ?")
    .get(userId);
  const failedAttempts = Number(row?.failed_attempts || 0) + 1;
  const lockedUntil = failedAttempts >= MFA_MAX_ATTEMPTS ? now + LOGIN_LOCKOUT_MS : 0;
  openDatabase()
    .prepare(
      `INSERT INTO mfa_attempt_locks (user_id, failed_attempts, locked_until, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         failed_attempts = excluded.failed_attempts,
         locked_until = excluded.locked_until,
         updated_at = excluded.updated_at`
    )
    .run(userId, lockedUntil ? 0 : failedAttempts, lockedUntil, new Date(now).toISOString());
  if (lockedUntil) {
    return {
      ok: false,
      error: "rate_limited",
      remainSeconds: Math.ceil(LOGIN_LOCKOUT_MS / 1000),
      attemptsRemaining: 0,
    };
  }
  return {
    ok: false,
    error: "invalid_code",
    attemptsRemaining: MFA_MAX_ATTEMPTS - failedAttempts,
  };
}

function clearMfaVerificationAttempts(userId) {
  openDatabase().prepare("DELETE FROM mfa_attempt_locks WHERE user_id = ?").run(userId);
}

function getMfaStatusForUser(user) {
  const mode = getEffectiveMfaPolicyMode();
  const record = user ? getMfaRecord(user.id) : null;
  return {
    enabled: Boolean(record?.enabled),
    required: isMfaRequiredForUser(user, mode),
    available: mode !== "disabled",
    recoveryCodesRemaining: record?.enabled ? countRecoveryCodes(user.id) : 0,
    policy: { mode },
  };
}

function getMfaIssuer() {
  const settings = readJsonKey(`${STORE_PREFIX}settings`, {});
  const candidate = String(settings?.companyNameAr || settings?.companyName || "AutoParts Inventory")
    .replace(/:/g, "-")
    .trim()
    .slice(0, 80);
  return candidate || "AutoParts Inventory";
}

function pruneMfaChallenges(now = Date.now()) {
  for (const [challengeId, challenge] of mfaChallenges.entries()) {
    if (!challenge || challenge.expiresAt <= now) mfaChallenges.delete(challengeId);
  }
}

function createMfaChallenge(event, user, type, extra = {}) {
  pruneMfaChallenges();
  for (const [existingId, existing] of mfaChallenges.entries()) {
    if (existing?.senderId === event.sender.id && existing?.type === type) {
      mfaChallenges.delete(existingId);
    }
  }
  const challengeId = crypto.randomBytes(32).toString("base64url");
  const challenge = {
    id: challengeId,
    senderId: event.sender.id,
    userId: user.id,
    type,
    attempts: 0,
    expiresAt: Date.now() + MFA_CHALLENGE_TTL_MS,
    ...extra,
  };
  mfaChallenges.set(challengeId, challenge);
  return challenge;
}

function getMfaChallenge(event, challengeId, allowedTypes) {
  const cleanId = String(challengeId || "").trim();
  const challenge = mfaChallenges.get(cleanId);
  if (!challenge) return { error: "challenge_expired" };
  if (challenge.expiresAt <= Date.now()) {
    mfaChallenges.delete(cleanId);
    return { error: "challenge_expired" };
  }
  if (challenge.senderId !== event.sender.id) return { error: "invalid_challenge" };
  if (allowedTypes && !allowedTypes.includes(challenge.type)) return { error: "invalid_challenge" };
  return { challenge };
}

function recordFailedMfaChallenge(challenge) {
  challenge.attempts += 1;
  if (challenge.attempts >= MFA_MAX_ATTEMPTS) {
    mfaChallenges.delete(challenge.id);
    return { ok: false, error: "rate_limited", remainSeconds: 60, attemptsRemaining: 0 };
  }
  return {
    ok: false,
    error: "invalid_code",
    attemptsRemaining: MFA_MAX_ATTEMPTS - challenge.attempts,
  };
}

function revokeUserChallenges(userId) {
  for (const [challengeId, challenge] of mfaChallenges.entries()) {
    if (challenge?.userId === userId) mfaChallenges.delete(challengeId);
  }
}

function revokeSenderChallenges(senderId) {
  for (const [challengeId, challenge] of mfaChallenges.entries()) {
    if (challenge?.senderId === senderId) mfaChallenges.delete(challengeId);
  }
}

function revokeUserSessions(userId) {
  for (const [senderId, sessionInfo] of rendererSessions.entries()) {
    if (sessionInfo?.userId === userId) rendererSessions.delete(senderId);
  }
}

function deleteMfaForUser(userId) {
  const cleanUserId = String(userId || "").trim();
  if (!cleanUserId) return;
  const tx = openDatabase().transaction(() => {
    openDatabase().prepare("DELETE FROM mfa_recovery_codes WHERE user_id = ?").run(cleanUserId);
    openDatabase().prepare("DELETE FROM user_mfa WHERE user_id = ?").run(cleanUserId);
    openDatabase().prepare("DELETE FROM mfa_attempt_locks WHERE user_id = ?").run(cleanUserId);
  });
  tx();
  revokeUserChallenges(cleanUserId);
}

function cleanupMfaForMissingUsers() {
  const validUserIds = new Set(getUsers().map((user) => user.id));
  const rows = openDatabase()
    .prepare(
      "SELECT user_id FROM user_mfa UNION SELECT user_id FROM mfa_recovery_codes UNION SELECT user_id FROM mfa_attempt_locks"
    )
    .all();
  for (const row of rows) {
    if (row?.user_id && !validUserIds.has(row.user_id)) deleteMfaForUser(row.user_id);
  }
}

function replaceRecoveryCodes(userId) {
  const codes = generateRecoveryCodes(10);
  const now = new Date().toISOString();
  const pepper = getMfaRecoveryPepper();
  const insert = openDatabase().prepare(
    "INSERT INTO mfa_recovery_codes (user_id, code_digest, created_at, consumed_at) VALUES (?, ?, ?, NULL)"
  );
  const tx = openDatabase().transaction(() => {
    openDatabase().prepare("DELETE FROM mfa_recovery_codes WHERE user_id = ?").run(userId);
    for (const code of codes) insert.run(userId, recoveryCodeDigest(code, pepper), now);
  });
  tx();
  return codes;
}

function storeMfaEnrollment(userId, secret, lastUsedCounter) {
  const now = new Date().toISOString();
  const codes = generateRecoveryCodes(10);
  const pepper = getMfaRecoveryPepper();
  const upsertMfa = openDatabase().prepare(
    `INSERT INTO user_mfa
      (user_id, secret_encrypted, enabled, enrolled_at, updated_at, last_used_counter)
     VALUES (?, ?, 1, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
      secret_encrypted = excluded.secret_encrypted,
      enabled = 1,
      enrolled_at = excluded.enrolled_at,
      updated_at = excluded.updated_at,
      last_used_counter = excluded.last_used_counter`
  );
  const insertCode = openDatabase().prepare(
    "INSERT INTO mfa_recovery_codes (user_id, code_digest, created_at, consumed_at) VALUES (?, ?, ?, NULL)"
  );
  const tx = openDatabase().transaction(() => {
    upsertMfa.run(userId, encryptMfaSecret(secret), now, now, lastUsedCounter);
    openDatabase().prepare("DELETE FROM mfa_recovery_codes WHERE user_id = ?").run(userId);
    for (const code of codes) insertCode.run(userId, recoveryCodeDigest(code, pepper), now);
  });
  tx();
  return codes;
}

function tryNormalizeRecoveryCode(code) {
  try {
    return normalizeRecoveryCode(code);
  } catch {
    return null;
  }
}

function consumeRecoveryCodeForUser(userId, code) {
  const normalized = tryNormalizeRecoveryCode(code);
  if (!normalized) return false;
  const digest = recoveryCodeDigest(normalized, getMfaRecoveryPepper());
  const result = openDatabase()
    .prepare(
      `UPDATE mfa_recovery_codes
       SET consumed_at = ?
       WHERE user_id = ? AND code_digest = ? AND consumed_at IS NULL`
    )
    .run(new Date().toISOString(), userId, digest);
  return result.changes === 1;
}

function findAndConsumeRecoveryCode(code) {
  const normalized = tryNormalizeRecoveryCode(code);
  if (!normalized) return null;
  const digest = recoveryCodeDigest(normalized, getMfaRecoveryPepper());
  const tx = openDatabase().transaction(() => {
    const row = openDatabase()
      .prepare(
        "SELECT user_id FROM mfa_recovery_codes WHERE code_digest = ? AND consumed_at IS NULL"
      )
      .get(digest);
    if (!row?.user_id || !getUsers().some((user) => user.id === row.user_id)) return null;
    const update = openDatabase()
      .prepare(
        "UPDATE mfa_recovery_codes SET consumed_at = ? WHERE code_digest = ? AND consumed_at IS NULL"
      )
      .run(new Date().toISOString(), digest);
    return update.changes === 1 ? row.user_id : null;
  });
  return tx();
}

function verifyMfaProofForUser(user, code) {
  const record = getMfaRecord(user?.id);
  if (!record?.enabled) return { ok: false, error: "not_enabled" };
  const limited = checkMfaVerificationLock(user.id);
  if (limited) return limited;
  const cleanCode = String(code || "").replace(/\s+/g, "").trim();

  if (/^\d{6}$/.test(cleanCode)) {
    try {
      const secret = decryptMfaSecret(record.secret_encrypted);
      const accepted = verifyTotp(cleanCode, secret, { window: 1 });
      if (!accepted) return recordFailedMfaVerification(user.id);
      const updated = openDatabase()
        .prepare(
          `UPDATE user_mfa
           SET last_used_counter = ?, updated_at = ?
           WHERE user_id = ?
             AND enabled = 1
             AND (last_used_counter IS NULL OR last_used_counter < ?)`
        )
        .run(accepted.counter, new Date().toISOString(), user.id, accepted.counter);
      if (updated.changes !== 1) {
        const failed = recordFailedMfaVerification(user.id);
        return failed.error === "rate_limited" ? failed : { ...failed, error: "code_reused" };
      }
      clearMfaVerificationAttempts(user.id);
      return { ok: true, method: "totp" };
    } catch {
      return recordFailedMfaVerification(user.id);
    }
  }

  if (consumeRecoveryCodeForUser(user.id, cleanCode)) {
    clearMfaVerificationAttempts(user.id);
    return { ok: true, method: "recovery_code" };
  }
  return recordFailedMfaVerification(user.id);
}

function createEnrollmentChallenge(event, user, type) {
  const secret = generateTotpSecret();
  const challenge = createMfaChallenge(event, user, type, { secret });
  return {
    challengeId: challenge.id,
    expiresAt: new Date(challenge.expiresAt).toISOString(),
    manualKey: secret,
    otpauthUri: buildOtpAuthUri({
      secret,
      accountName: String(user.username || user.name || user.id).replace(/:/g, "-"),
      issuer: getMfaIssuer(),
    }),
  };
}

function buildMfaLoginResult(event, user) {
  const mode = getEffectiveMfaPolicyMode();
  const record = getMfaRecord(user.id);
  if (mode !== "disabled" && (record?.enabled || isMfaRequiredForUser(user, mode))) {
    const limited = checkMfaVerificationLock(user.id);
    if (limited) return limited;
  }
  if (mode !== "disabled" && record?.enabled) {
    const challenge = createMfaChallenge(event, user, "login_factor");
    return {
      ok: false,
      error: "second_factor_required",
      requiresSecondFactor: true,
      challengeId: challenge.id,
      expiresAt: new Date(challenge.expiresAt).toISOString(),
      methods: ["totp", "recovery_code"],
    };
  }
  if (isMfaRequiredForUser(user, mode)) {
    return {
      ok: false,
      error: "mfa_enrollment_required",
      requiresMfaEnrollment: true,
      ...createEnrollmentChallenge(event, user, "login_enrollment"),
    };
  }
  return null;
}

function updateMfaPolicy(mode) {
  if (!isMfaFeatureLicensed()) return { ok: false, error: "feature_not_licensed" };
  const cleanMode = String(mode || "").trim();
  if (!MFA_POLICY_MODES.has(cleanMode)) return { ok: false, error: "invalid_policy" };
  const users = getUsers();
  const missingUsers = users.filter((user) => {
    if (cleanMode === "required_owner" && user.role !== "owner") return false;
    if (cleanMode !== "required_owner" && cleanMode !== "required_all") return false;
    return !getMfaRecord(user.id)?.enabled;
  });
  // Existing users must enrol before a mandatory policy is switched on. If a
  // new user is later added, login still has a safe password-verified enrolment path.
  if (missingUsers.length > 0) {
    return {
      ok: false,
      error: "users_not_enrolled",
      missingUsers: missingUsers.map((user) => ({ id: user.id, name: user.name, username: user.username })),
    };
  }
  openDatabase()
    .prepare("UPDATE auth_security_policy SET mode = ?, updated_at = ? WHERE id = 1")
    .run(cleanMode, new Date().toISOString());
  return { ok: true, policy: { mode: cleanMode } };
}

function getPublicKey() {
  return crypto.createPublicKey(LICENSE_PUBLIC_KEY);
}

function parseSignedPayload(token, prefix, schema) {
  const normalized = String(token || "").replace(/\s+/g, "").trim();
  if (normalized.length > MAX_TOKEN_LENGTH) {
    throw new Error("Token too large");
  }
  if (!normalized.startsWith(prefix)) {
    throw new Error("Invalid token prefix");
  }

  const decoded = JSON.parse(
    Buffer.from(normalized.slice(prefix.length), "base64url").toString("utf8")
  );
  const parsed = schema.parse(decoded);
  const { signature, ...unsignedPayload } = parsed;
  const verified = crypto.verify(
    null,
    Buffer.from(canonicalStringify(unsignedPayload)),
    getPublicKey(),
    Buffer.from(signature, "base64url")
  );

  if (!verified) {
    throw new Error("Invalid token signature");
  }

  return parsed;
}

function buildLicenseStatus(state, extra = {}) {
  return {
    state,
    machineCode: getMachineCode(),
    machineHash: getMachineHash(),
    ...extra,
  };
}

function evaluateLicense(serial, persistSeen) {
  if (!serial) {
    return buildLicenseStatus("inactive");
  }

  let license;
  try {
    license = parseSignedPayload(serial, "APLIC.", licenseSchema);
  } catch (error) {
    return buildLicenseStatus("inactive", {
      message: error instanceof Error ? error.message : "Invalid license",
    });
  }

  if (license.machineHash !== getMachineHash()) {
    return buildLicenseStatus("machine_mismatch", { license });
  }

  const now = new Date();
  const lastSeenRaw = storageGet(LICENSE_LAST_SEEN_KEY);
  if (lastSeenRaw) {
    const lastSeenMs = parseDateMs(lastSeenRaw);
    if (lastSeenMs !== null && now.getTime() + CLOCK_SKEW_MS < lastSeenMs) {
      return buildLicenseStatus("clock_tampered", { license });
    }
  }

  const serverStatus = storageGet("__license_server_status");
  if (serverStatus === "blocked") {
    return buildLicenseStatus("inactive", { message: "موقوف من الإدارة" });
  }

  const subscriptionExpiresMs = license.subscriptionExpiresAt
    ? parseDateMs(license.subscriptionExpiresAt)
    : null;
  if (
    license.subscriptionType === "limited" &&
    (!license.subscriptionExpiresAt || subscriptionExpiresMs === null || now.getTime() > subscriptionExpiresMs)
  ) {
    return buildLicenseStatus("expired", { license });
  }

  if (persistSeen) {
    storageSet(LICENSE_LAST_SEEN_KEY, now.toISOString());
  }

  return buildLicenseStatus("active", { license });
}

function getLicenseStatus() {
  if (HW_E2E) return buildLicenseStatus("active", { license: { subscriptionType: "lifetime", subscriptionStartDate: new Date().toISOString(), subscriptionExpiresAt: null, features: ["*"] } });
  return evaluateLicense(storageGet(LICENSE_TOKEN_KEY), true);
}

function getStoredBranchesForLicense() {
  const stored = readJsonKey(BRANCHES_STORAGE_KEY, []);
  if (Array.isArray(stored) && stored.length > 0) return stored;
  return [{
    id: "branch_main",
    code: "MAIN",
    name: "الفرع الرئيسي",
    isMain: true,
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
  }];
}

function getBranchActivations() {
  const stored = readJsonKey(BRANCH_ACTIVATIONS_KEY, []);
  if (!Array.isArray(stored)) return [];
  return stored.filter((item) => item && typeof item.activationId === "string");
}

// Existing branches from installations made before paid branch licensing are
// grandfathered once. The value lives outside renderer storage and backups, so
// importing or editing app data cannot manufacture extra paid slots.
function getLegacyBranchSlots() {
  const raw = storageGet(BRANCH_LEGACY_SLOTS_KEY);
  const stored = Number(raw);
  if (raw !== null && Number.isSafeInteger(stored) && stored >= 0) return stored;
  const legacySlots = Math.max(0, getStoredBranchesForLicense().length - 1);
  storageSet(BRANCH_LEGACY_SLOTS_KEY, String(legacySlots));
  return legacySlots;
}

function getBranchLicenseStatusInternal() {
  const branches = getStoredBranchesForLicense();
  const legacySlots = getLegacyBranchSlots();
  const activations = getBranchActivations();
  const activatedSlots = activations.length;
  const branchLimit = 1 + legacySlots + activatedSlots;
  const unusedActivations = activations.filter((item) => !item.consumedAt).length;
  return {
    machineCode: getMachineCode(),
    branchCount: branches.length,
    branchLimit,
    availableSlots: Math.max(0, Math.min(unusedActivations, branchLimit - branches.length)),
    activatedSlots,
    legacySlots,
  };
}

function activateBranchSlot(serial) {
  if (getLicenseStatus().state !== "active") {
    return { ok: false, error: "license_inactive", status: getBranchLicenseStatusInternal() };
  }

  let activation;
  try {
    activation = parseSignedPayload(serial, "APBRN.", branchActivationSchema);
  } catch {
    return { ok: false, error: "invalid_code", status: getBranchLicenseStatusInternal() };
  }

  if (activation.machineHash !== getMachineHash()) {
    return { ok: false, error: "machine_mismatch", status: getBranchLicenseStatusInternal() };
  }

  const activations = getBranchActivations();
  if (activations.some((item) => item.activationId === activation.activationId)) {
    return { ok: false, error: "code_already_used", status: getBranchLicenseStatusInternal() };
  }

  const currentStatus = getBranchLicenseStatusInternal();
  if (currentStatus.availableSlots > 0) {
    return { ok: false, error: "slot_already_available", status: currentStatus };
  }

  activations.push({
    activationId: activation.activationId,
    issuedAt: activation.issuedAt,
    activatedAt: new Date().toISOString(),
  });
  writeJsonKey(BRANCH_ACTIVATIONS_KEY, activations);
  return { ok: true, status: getBranchLicenseStatusInternal() };
}

function nextBranchCode(branches) {
  const used = new Set(branches.map((branch) => String(branch?.code || "").toUpperCase()));
  let number = 2;
  while (used.has(`BR-${String(number).padStart(2, "0")}`)) number += 1;
  return `BR-${String(number).padStart(2, "0")}`;
}

function createLicensedBranch(input) {
  if (getLicenseStatus().state !== "active") {
    return { ok: false, error: "license_inactive", status: getBranchLicenseStatusInternal() };
  }

  const parsed = branchCreateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "invalid_branch", status: getBranchLicenseStatusInternal() };
  }

  return openDatabase().transaction(() => {
    const status = getBranchLicenseStatusInternal();
    if (status.availableSlots < 1) {
      return { ok: false, error: "activation_required", status };
    }

    const branches = getStoredBranchesForLicense();
    const activations = getBranchActivations();
    const activationIndex = activations.findIndex((item) => !item.consumedAt);
    if (activationIndex < 0) {
      return { ok: false, error: "activation_required", status: getBranchLicenseStatusInternal() };
    }
    const now = new Date().toISOString();
    const branch = {
      id: `branch_${crypto.randomUUID()}`,
      code: nextBranchCode(branches),
      name: parsed.data.name,
      isMain: false,
      active: true,
      createdAt: now,
      ...(parsed.data.address ? { address: parsed.data.address } : {}),
      ...(parsed.data.phone ? { phone: parsed.data.phone } : {}),
    };
    writeJsonKey(BRANCHES_STORAGE_KEY, [...branches, branch]);
    activations[activationIndex] = {
      ...activations[activationIndex],
      consumedAt: now,
      branchId: branch.id,
    };
    writeJsonKey(BRANCH_ACTIVATIONS_KEY, activations);
    return { ok: true, branch, status: getBranchLicenseStatusInternal() };
  })();
}

function validateBranchStorageValue(value) {
  const branches = JSON.parse(String(value));
  if (!Array.isArray(branches) || branches.length < 1) throw new Error("invalid_branches_payload");
  if (branches.length > getBranchLicenseStatusInternal().branchLimit) {
    throw new Error("branch_activation_required");
  }
  const storedIds = new Set(getStoredBranchesForLicense().map((branch) => branch?.id));
  if (branches.some((branch) => !branch || typeof branch.id !== "string" || !storedIds.has(branch.id))) {
    throw new Error("branch_creation_must_use_license_api");
  }
  return JSON.stringify(branches);
}

// ── Heartbeat API Configuration ──────────────────────────────
// AutoParts has no shared backend by default. Set its own URL when deployed.
const FIREBASE_HEARTBEAT_URL = process.env.AUTOPARTS_LICENSE_HEARTBEAT_URL?.replace(/\/$/, "") || null;

async function checkLicenseOnline() {
  if (HW_E2E || !FIREBASE_HEARTBEAT_URL) return;
  const token = storageGet(LICENSE_TOKEN_KEY);
  if (!token) return;

  try {
    const license = parseSignedPayload(token, "APLIC.", licenseSchema);
    const machineHash = getMachineHash();
    const machineCode = getMachineCode();
    
    // Using Firebase Realtime Database REST API convention
    let url = `${FIREBASE_HEARTBEAT_URL}/${machineHash}.json`;
    let response = await fetch(url, { method: "GET", headers: { "Content-Type": "application/json" } });
    let data = response.ok ? await response.json() : null;

    // Fallback to checking by machineCode (for older records manually added via web)
    if (!data) {
      url = `${FIREBASE_HEARTBEAT_URL}/${machineCode}.json`;
      response = await fetch(url, { method: "GET", headers: { "Content-Type": "application/json" } });
      data = response.ok ? await response.json() : null;
    }
    
    if (data && data.status === "blocked") {
      storageSet("__license_server_status", "blocked");
      
      BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) {
          win.webContents.send("license:revoked");
        }
      });
    } else if (data && data.status === "active") {
      const wasBlocked = storageGet("__license_server_status") === "blocked";
      if (wasBlocked) {
        storageRemove("__license_server_status");
        BrowserWindow.getAllWindows().forEach((win) => {
          if (!win.isDestroyed()) {
            win.webContents.send("license:restored");
          }
        });
      }
    }
  } catch (err) {
    // Silent fail if offline or error
  }
}


async function hashPassword(password) {
  const cleanPassword = normalizePassword(password);
  if (!isPasswordLengthAllowed(cleanPassword)) {
    throw new Error("invalid_password_length");
  }
  return argon2.hash(cleanPassword, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });
}

async function verifyPassword(storedHash, password) {
  const cleanPassword = normalizePassword(password);
  if (!isPasswordLengthAllowed(cleanPassword)) return false;
  if (!storedHash) return false;
  if (String(storedHash).startsWith("$argon2")) {
    return argon2.verify(storedHash, cleanPassword);
  }
  // SECURITY: Legacy base64 fallback — auto-upgrade on next successful login.
  // Constant-time compare so the legacy path can't be probed via timing.
  const expected = Buffer.from(cleanPassword, "utf8").toString("base64");
  const storedBuf = Buffer.from(String(storedHash));
  const expectedBuf = Buffer.from(expected);
  return (
    storedBuf.length === expectedBuf.length &&
    crypto.timingSafeEqual(storedBuf, expectedBuf)
  );
}

async function createOwner(username, password) {
  const cleanUsername = normalizeUsername(username);
  if (!cleanUsername || !isPasswordLengthAllowed(password, 6)) {
    return { ok: false, error: "invalid_input" };
  }

  const users = getUsers();
  if (users.some((user) => user.role === "owner")) {
    return { ok: false, error: "owner_exists" };
  }
  if (users.some((user) => user.username === cleanUsername)) {
    return { ok: false, error: "username_exists" };
  }

  const user = {
    id: `usr_${crypto.randomUUID()}`,
    name: cleanUsername,
    username: cleanUsername,
    passwordHash: await hashPassword(password),
    role: "owner",
    permissions: permissionTemplate,
    createdAt: new Date().toISOString(),
  };

  setUsers([user, ...users]);
  return { ok: true, user };
}

function readLoginLocks() {
  const locks = readJsonKey(LOGIN_LOCKS_KEY, {});
  return locks && typeof locks === "object" ? locks : {};
}

// Prunes lock entries whose lock expired more than the retention window ago,
// so the persisted object can't grow without bound. Recent (still-escalating)
// entries are kept so the level survives across expiries and restarts.
function pruneLoginLocks(locks, now) {
  for (const [key, entry] of Object.entries(locks)) {
    if (!entry || (entry.lockedUntil || 0) + LOGIN_LOCK_RETENTION_MS < now) {
      delete locks[key];
    }
  }
  return locks;
}

// Returns a rate_limited result if `key` is under a persisted lock, else null.
function checkPersistedLock(key, now) {
  const entry = readLoginLocks()[key];
  if (entry && (entry.lockedUntil || 0) > now) {
    return {
      ok: false,
      error: "rate_limited",
      remainSeconds: Math.ceil((entry.lockedUntil - now) / 1000),
      attemptsRemaining: 0,
    };
  }
  return null;
}

// Persists an escalating lock for `key` (steps up each consecutive lockout).
function persistEscalatingLock(key, now) {
  const locks = pruneLoginLocks(readLoginLocks(), now);
  const prevLevel = locks[key]?.level || 0;
  const level = Math.min(prevLevel + 1, LOGIN_LOCKOUT_STEPS_MS.length);
  const lockoutMs = LOGIN_LOCKOUT_STEPS_MS[level - 1];
  locks[key] = { lockedUntil: now + lockoutMs, level };
  writeJsonKey(LOGIN_LOCKS_KEY, locks);
  return { lockoutMs, level };
}

function clearPersistedLock(key, now) {
  const locks = readLoginLocks();
  if (locks[key] === undefined) return;
  delete locks[key];
  writeJsonKey(LOGIN_LOCKS_KEY, pruneLoginLocks(locks, now));
}

async function login(username, password) {
  const cleanUsername = normalizeUsername(username);
  const attemptKey = cleanUsername.toLowerCase();

  // ── SECURITY: Rate-limiting ──────────────────────────────────────
  const now = Date.now();
  // Persisted lock first (survives app restarts), then the in-memory fast path.
  const persistedLimited = checkPersistedLock(attemptKey, now);
  if (persistedLimited) return persistedLimited;
  const rateLimited = checkRateLimit(loginAttempts, attemptKey, now);
  if (rateLimited) return rateLimited;
  // ────────────────────────────────────────────────────────────────

  const users = getUsers();
  const user = users.find((item) => item.username === cleanUsername);

  // SECURITY: constant-time-ish — always run verifyPassword to prevent
  // timing attacks that reveal whether a username exists.
  const dummyHash = "$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQ$dummyhashvalue";
  const ok = await verifyPassword(user?.passwordHash || dummyHash, password);

  if (!user || !ok) {
    const result = recordFailedAttempt(loginAttempts, attemptKey, Date.now(), LOGIN_MAX_ATTEMPTS, LOGIN_LOCKOUT_MS);
    // When the in-memory limiter trips a lockout, mirror it to a persisted,
    // escalating lock so a restart cannot reset the protection.
    if (result.error === "rate_limited") {
      persistEscalatingLock(attemptKey, Date.now());
      return checkPersistedLock(attemptKey, Date.now()) || result;
    }
    return result;
  }

  // ── Success — clear in-memory and persisted lock state ──
  clearAttempts(loginAttempts, attemptKey);
  clearPersistedLock(attemptKey, Date.now());

  // Auto-upgrade legacy password hashes to argon2id
  if (!String(user.passwordHash || "").startsWith("$argon2")) {
    user.passwordHash = await hashPassword(password);
    setUsers(users);
  }

  return { ok: true, user };
}

async function changePassword({ userId, currentPassword, newPassword }) {
  const cleanUserId = String(userId || "").trim();
  if (!cleanUserId || !isPasswordLengthAllowed(newPassword, 6)) {
    return { ok: false, error: "invalid_input" };
  }

  const users = getUsers();
  const user = users.find((item) => item.id === cleanUserId);
  if (!user) {
    return { ok: false, error: "user_missing" };
  }

  const ok = await verifyPassword(user.passwordHash, currentPassword);
  if (!ok) {
    return { ok: false, error: "invalid_current_password" };
  }

  user.passwordHash = await hashPassword(newPassword);
  setUsers(users);
  return { ok: true, user };
}

async function updateOwnProfile({ userId, name, currentPassword, newPassword }) {
  const cleanUserId = String(userId || "").trim();
  const cleanName = String(name || "").trim().slice(0, MAX_USERNAME_LENGTH);
  const wantsPasswordChange = Boolean(newPassword);
  if (!cleanUserId || !cleanName) {
    return { ok: false, error: "invalid_input" };
  }
  if (wantsPasswordChange && !isPasswordLengthAllowed(newPassword, 6)) {
    return { ok: false, error: "invalid_input" };
  }

  const users = getUsers();
  const user = users.find((item) => item.id === cleanUserId);
  if (!user) {
    return { ok: false, error: "user_missing" };
  }

  if (wantsPasswordChange) {
    const ok = await verifyPassword(user.passwordHash, currentPassword);
    if (!ok) {
      return { ok: false, error: "invalid_current_password" };
    }
    user.passwordHash = await hashPassword(newPassword);
  }

  user.name = cleanName;
  setUsers(users);
  return { ok: true, user };
}

async function beginOwnMfaEnrollment(event, password) {
  const user = getSessionUser(event);
  if (!user) return { ok: false, error: "not_authorized" };
  if (!isMfaFeatureLicensed()) return { ok: false, error: "feature_not_licensed" };
  if (getMfaPolicyMode() === "disabled") return { ok: false, error: "feature_disabled" };
  if (getMfaRecord(user.id)?.enabled) return { ok: false, error: "already_enabled" };
  if (!isPasswordLengthAllowed(password) || !(await verifyPassword(user.passwordHash, password))) {
    return { ok: false, error: "invalid_password" };
  }
  return { ok: true, ...createEnrollmentChallenge(event, user, "self_enrollment") };
}

function confirmMfaEnrollment(event, challengeId, code) {
  const resolved = getMfaChallenge(event, challengeId, ["self_enrollment", "login_enrollment"]);
  if (!resolved.challenge) return { ok: false, error: resolved.error };
  const challenge = resolved.challenge;
  if (!isMfaFeatureLicensed()) {
    mfaChallenges.delete(challenge.id);
    return { ok: false, error: "feature_not_licensed" };
  }
  const user = getUsers().find((item) => item.id === challenge.userId);
  if (!user) {
    mfaChallenges.delete(challenge.id);
    return { ok: false, error: "user_missing" };
  }
  if (challenge.type === "self_enrollment" && getSession(event)?.userId !== user.id) {
    mfaChallenges.delete(challenge.id);
    return { ok: false, error: "not_authorized" };
  }
  const limited = checkMfaVerificationLock(user.id);
  if (limited) return limited;

  let accepted = null;
  try {
    accepted = verifyTotp(String(code || "").trim(), challenge.secret, { window: 1 });
  } catch {
    accepted = null;
  }
  if (!accepted) {
    const failed = recordFailedMfaVerification(user.id);
    const challengeFailure = recordFailedMfaChallenge(challenge);
    return failed.error === "rate_limited" ? failed : challengeFailure;
  }

  const recoveryCodes = storeMfaEnrollment(user.id, challenge.secret, accepted.counter);
  clearMfaVerificationAttempts(user.id);
  mfaChallenges.delete(challenge.id);
  if (challenge.type === "login_enrollment") setSession(event, user);
  return {
    ok: true,
    recoveryCodes,
    recoveryCodesRemaining: recoveryCodes.length,
    user: challenge.type === "login_enrollment" ? safeUserForRenderer(user) : undefined,
    loginCompleted: challenge.type === "login_enrollment",
  };
}

async function disableOwnMfa(event, password, verificationCode) {
  const user = getSessionUser(event);
  if (!user) return { ok: false, error: "not_authorized" };
  if (!getMfaRecord(user.id)?.enabled) return { ok: false, error: "not_enabled" };
  if (isMfaRequiredForUser(user)) return { ok: false, error: "required_by_policy" };
  if (!isPasswordLengthAllowed(password) || !(await verifyPassword(user.passwordHash, password))) {
    return { ok: false, error: "invalid_password" };
  }
  const proof = verifyMfaProofForUser(user, verificationCode);
  if (!proof.ok) return proof;
  deleteMfaForUser(user.id);
  return { ok: true };
}

async function regenerateOwnRecoveryCodes(event, password, verificationCode) {
  const user = getSessionUser(event);
  if (!user) return { ok: false, error: "not_authorized" };
  if (!getMfaRecord(user.id)?.enabled) return { ok: false, error: "not_enabled" };
  if (!isPasswordLengthAllowed(password) || !(await verifyPassword(user.passwordHash, password))) {
    return { ok: false, error: "invalid_password" };
  }
  const proof = verifyMfaProofForUser(user, verificationCode);
  if (!proof.ok) return proof;
  const recoveryCodes = replaceRecoveryCodes(user.id);
  return { ok: true, recoveryCodes, recoveryCodesRemaining: recoveryCodes.length };
}

function verifyLoginSecondFactor(event, challengeId, code) {
  const resolved = getMfaChallenge(event, challengeId, ["login_factor"]);
  if (!resolved.challenge) return { ok: false, error: resolved.error };
  const challenge = resolved.challenge;
  if (!isMfaFeatureLicensed()) {
    mfaChallenges.delete(challenge.id);
    return { ok: false, error: "challenge_expired" };
  }
  const user = getUsers().find((item) => item.id === challenge.userId);
  if (!user || !getMfaRecord(user.id)?.enabled) {
    mfaChallenges.delete(challenge.id);
    return { ok: false, error: "challenge_expired" };
  }
  const proof = verifyMfaProofForUser(user, code);
  if (!proof.ok) {
    if (proof.error === "rate_limited") return proof;
    if (proof.error === "code_reused") {
      return { ...recordFailedMfaChallenge(challenge), error: "code_reused" };
    }
    return recordFailedMfaChallenge(challenge);
  }
  mfaChallenges.delete(challenge.id);
  setSession(event, user);
  return {
    ok: true,
    user: safeUserForRenderer(user),
    usedMethod: proof.method,
    recoveryCodesRemaining: countRecoveryCodes(user.id),
  };
}

function getAccountRecoveryRateLimit(event) {
  return checkRateLimit(recoveryAttempts, String(event.sender.id), Date.now());
}

function recordFailedAccountRecovery(event) {
  const key = String(event.sender.id);
  const limited = recordFailedSupportAttempt(
    recoveryAttempts,
    key,
    Date.now(),
    MFA_MAX_ATTEMPTS,
    MFA_RECOVERY_LOCKOUT_MS
  );
  return limited || { ok: false, error: "invalid_recovery_code" };
}

function beginAccountRecovery(event, recoveryCode) {
  const limited = getAccountRecoveryRateLimit(event);
  if (limited) return limited;
  const userId = findAndConsumeRecoveryCode(recoveryCode);
  const user = userId ? getUsers().find((item) => item.id === userId) : null;
  if (!user) return recordFailedAccountRecovery(event);
  clearAttempts(recoveryAttempts, String(event.sender.id));
  const challenge = createMfaChallenge(event, user, "account_recovery");
  return {
    ok: true,
    challengeId: challenge.id,
    expiresAt: new Date(challenge.expiresAt).toISOString(),
    username: user.username,
  };
}

async function completeAccountRecovery(event, challengeId, newPassword, resetMfa = true) {
  const resolved = getMfaChallenge(event, challengeId, ["account_recovery"]);
  if (!resolved.challenge) return { ok: false, error: resolved.error };
  if (!isPasswordLengthAllowed(newPassword, 6)) return { ok: false, error: "invalid_input" };
  const challenge = resolved.challenge;
  const users = getUsers();
  const user = users.find((item) => item.id === challenge.userId);
  if (!user) {
    mfaChallenges.delete(challenge.id);
    return { ok: false, error: "user_missing" };
  }

  const passwordHash = await hashPassword(newPassword);
  user.passwordHash = passwordHash;
  const tx = openDatabase().transaction(() => {
    setUsers(users);
    if (resetMfa) {
      openDatabase().prepare("DELETE FROM mfa_recovery_codes WHERE user_id = ?").run(user.id);
      openDatabase().prepare("DELETE FROM user_mfa WHERE user_id = ?").run(user.id);
      openDatabase().prepare("DELETE FROM mfa_attempt_locks WHERE user_id = ?").run(user.id);
    }
  });
  tx();

  clearAttempts(loginAttempts, String(user.username || "").toLowerCase());
  clearPersistedLock(String(user.username || "").toLowerCase(), Date.now());
  clearMfaVerificationAttempts(user.id);
  revokeUserSessions(user.id);
  revokeUserChallenges(user.id);
  return {
    ok: true,
    username: user.username,
    mfaReset: Boolean(resetMfa),
    requiresMfaEnrollment: Boolean(resetMfa && isMfaRequiredForUser(user)),
  };
}

async function resetUserMfaByOwner(event, targetUserId, ownerPassword, verificationCode) {
  const owner = getSessionUser(event);
  if (!owner || owner.role !== "owner") return { ok: false, error: "not_authorized" };
  const target = getUsers().find((user) => user.id === String(targetUserId || ""));
  if (!target) return { ok: false, error: "user_missing" };
  if (target.role === "owner") return { ok: false, error: "cannot_reset_owner" };
  if (!isPasswordLengthAllowed(ownerPassword) || !(await verifyPassword(owner.passwordHash, ownerPassword))) {
    return { ok: false, error: "invalid_password" };
  }
  if (getMfaRecord(owner.id)?.enabled) {
    const proof = verifyMfaProofForUser(owner, verificationCode);
    if (!proof.ok) return proof;
  }
  deleteMfaForUser(target.id);
  revokeUserSessions(target.id);
  return { ok: true };
}

function getSupportRateLimitResult(key) {
  return checkRateLimit(supportAttempts, key, Date.now());
}

function registerFailedSupportAttempt(key) {
  return recordFailedSupportAttempt(supportAttempts, key, Date.now(), SUPPORT_MAX_ATTEMPTS, SUPPORT_LOCKOUT_MS);
}

async function resetOwnerPassword({ supportCode, username, password }) {
  let support;
  try {
    support = parseSignedPayload(supportCode, "APSUP.", supportSchema);
  } catch {
    return { ok: false, error: "invalid_support_code" };
  }

  if (support.machineHash !== getMachineHash()) {
    return { ok: false, error: "machine_mismatch" };
  }
  const supportExpiresMs = parseDateMs(support.expiresAt);
  if (supportExpiresMs === null || new Date().getTime() > supportExpiresMs) {
    return { ok: false, error: "support_code_expired" };
  }
  const alreadyConsumed = openDatabase()
    .prepare("SELECT 1 FROM consumed_support_codes WHERE support_id = ?")
    .get(support.supportId);
  if (alreadyConsumed) return { ok: false, error: "support_code_already_used" };

  const users = getUsers();
  const owner = users.find((user) => user.role === "owner");
  if (!owner) return { ok: false, error: "owner_missing" };

  const cleanUsername = normalizeUsername(username || owner.username);
  if (!cleanUsername || !isPasswordLengthAllowed(password, 6)) {
    return { ok: false, error: "invalid_input" };
  }
  if (
    users.some(
      (user) => user.id !== owner.id && user.username.toLowerCase() === cleanUsername.toLowerCase()
    )
  ) {
    return { ok: false, error: "username_taken" };
  }

  const previousAttemptKey = String(owner.username || "").toLowerCase();
  const passwordHash = await hashPassword(password);
  owner.username = cleanUsername;
  owner.passwordHash = passwordHash;
  try {
    const tx = openDatabase().transaction(() => {
      openDatabase()
        .prepare("INSERT INTO consumed_support_codes (support_id, consumed_at) VALUES (?, ?)")
        .run(support.supportId, new Date().toISOString());
      setUsers(users);
      openDatabase().prepare("DELETE FROM mfa_recovery_codes WHERE user_id = ?").run(owner.id);
      openDatabase().prepare("DELETE FROM user_mfa WHERE user_id = ?").run(owner.id);
      openDatabase().prepare("DELETE FROM mfa_attempt_locks WHERE user_id = ?").run(owner.id);
    });
    tx();
  } catch {
    return { ok: false, error: "support_code_already_used" };
  }
  clearAttempts(loginAttempts, previousAttemptKey);
  clearAttempts(loginAttempts, cleanUsername.toLowerCase());
  clearPersistedLock(previousAttemptKey, Date.now());
  clearPersistedLock(cleanUsername.toLowerCase(), Date.now());
  revokeUserSessions(owner.id);
  revokeUserChallenges(owner.id);
  return { ok: true, user: owner };
}

function createWindow() {
  const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);
  const devRendererOrigin = (() => {
    if (!isDev) return null;
    try {
      return new URL(process.env.ELECTRON_RENDERER_URL).origin;
    } catch {
      return null;
    }
  })();
  const iconPath = getAppIconPath();
  const win = new BrowserWindow({
    width: 1366,
    height: 860,
    minWidth: 1100,
    minHeight: 720,
    title: "AutoParts Inventory & Sales System",
    icon: iconPath,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: isDev,
      // SECURITY: Prevent navigation to external content
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });
  const _wcId = win.webContents.id; // capture before destruction
  win.webContents.on("destroyed", () => {
    rendererSessions.delete(_wcId);
    revokeSenderChallenges(_wcId);
    recoveryAttempts.delete(String(_wcId));
  });

  // Backup-on-close: give the renderer a chance to write a backup to the
  // configured folder before the window goes away. A timeout guarantees the
  // app never hangs on quit even if the renderer is unresponsive.
  let closeBackupStarted = false;
  win.on("close", (e) => {
    if (closeBackupStarted) return; // second close → let it through
    e.preventDefault();
    closeBackupStarted = true;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      ipcMain.removeListener("app:close-backup-done", finish);
      if (!win.isDestroyed()) win.destroy();
    };
    ipcMain.once("app:close-backup-done", finish);
    try {
      if (win.webContents.isDestroyed()) { finish(); return; }
      win.webContents.send("app:run-close-backup");
    } catch {
      finish();
      return;
    }
    setTimeout(finish, 6000);
  });

  // SECURITY: Block all navigation away from the app
  win.webContents.on("will-navigate", (event, navigationUrl) => {
    let parsed;
    try {
      parsed = new URL(navigationUrl);
    } catch {
      event.preventDefault();
      return;
    }
    if (isDev && devRendererOrigin && parsed.origin === devRendererOrigin) return;
    if (!isDev && parsed.protocol === "file:") return;
    event.preventDefault();
  });

  const allowedExternalHosts = new Set(["wa.me", "helpers-tech.com", "www.helpers-tech.com"]);
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "https:" && allowedExternalHosts.has(parsed.hostname.toLowerCase())) {
        shell.openExternal(parsed.toString());
      }
    } catch {
      // Deny malformed popups.
    }
    return { action: "deny" };
  });

  if (!isDev) {
    // SECURITY: Comprehensive DevTools blocking
    win.webContents.on("before-input-event", (event, input) => {
      const key = input.key.toUpperCase();
      // Block F12, Ctrl+Shift+I/J/C, Ctrl+U (view source), Ctrl+Shift+D
      if (
        input.key === "F12" ||
        (input.control && input.shift && ["I", "J", "C", "D"].includes(key)) ||
        (input.control && key === "U")
      ) {
        event.preventDefault();
      }
    });

    // SECURITY: Force-close DevTools if somehow opened
    win.webContents.on("devtools-opened", () => {
      win.webContents.closeDevTools();
    });
  }

  // Electron on Linux (X11/Wayland) doesn't auto-apply the desktop's display
  // scale the way it does on macOS/Windows, so the same UI renders noticeably
  // smaller. Bump the zoom factor there to keep text readable.
  if (process.platform === "linux") {
    win.webContents.on("did-finish-load", () => {
      win.webContents.setZoomFactor(1.3);
    });
  }

  if (isDev) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

function normalizePrintRoute(route) {
  const cleanRoute = String(route || "").trim();
  if (!cleanRoute.startsWith("/")) {
    throw new Error("Invalid print route");
  }
  if (!/^\/(sales|purchases|quotations)\/[^/]+\/print$/.test(cleanRoute)) {
    throw new Error("Unsupported print route");
  }
  return cleanRoute;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return escapeHtml(value);
  return new Intl.DateTimeFormat("ar-EG", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function formatCurrency(value, currency) {
  const amount = Number(value || 0);
  return `${new Intl.NumberFormat("ar-EG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)} ${currency || ""}`.trim();
}

function sanitizeFileName(value) {
  return String(value || "invoice")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/-+/g, "-")
    .trim()
    .slice(0, 140) || "invoice";
}

function sanitizeImageSrc(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(raw)) {
    return raw;
  }
  if (/^\.\/[a-z0-9._/%-]+$/i.test(raw) && !raw.includes("..")) {
    return raw;
  }
  return "";
}

function ensurePdfExtension(filePath) {
  return filePath.toLowerCase().endsWith(".pdf") ? filePath : `${filePath}.pdf`;
}

function getInvoicePrintMeta(route) {
  const { kind, invoice } = getInvoiceForPrint(route);
  const title = kind === "sales" ? "فاتورة مبيعات" : kind === "quotation" ? "عرض سعر" : "فاتورة مشتريات";
  const docNumber = invoice.invoiceNumber || invoice.quotationNumber || invoice.id || "doc";
  const partyName =
    kind === "purchase"
      ? invoice.supplierName
      : invoice.customerName || invoice.partyName || "";
  const datePart = invoice.date ? ` - ${invoice.date}` : "";
  const partyPart = partyName ? ` - ${partyName}` : "";
  return {
    windowTitle: `${title} ${docNumber}${partyName ? ` - ${partyName}` : ""}`,
    fileBaseName: sanitizeFileName(`${docNumber}${partyPart}${datePart}`),
  };
}

function getPdfDefaultDirectory(settings) {
  const configured = String(settings?.invoicesSavePath || "").trim();
  if (configured && fs.existsSync(configured)) return configured;
  return app.getPath("downloads");
}

async function askForPdfPath(ownerWindow, defaultPath) {
  if (HW_E2E) return defaultPath;
  const options = {
    title: "حدد مكان حفظ الفاتورة PDF",
    buttonLabel: "حفظ PDF",
    defaultPath,
    filters: [{ name: "PDF Document", extensions: ["pdf"] }],
  };
  const result = ownerWindow
    ? await dialog.showSaveDialog(ownerWindow, options)
    : await dialog.showSaveDialog(options);

  if (result.canceled || !result.filePath) return null;
  return ensurePdfExtension(result.filePath);
}

function getInvoicePrintOptions() {
  return {
    silent: false,
    printBackground: true,
    landscape: false,
    pageSize: "A4",
    margins: { marginType: "default" },
  };
}

function getInvoicePdfOptions() {
  return {
    printBackground: true,
    landscape: false,
    pageSize: "A4",
    margins: { marginType: "default" },
    preferCSSPageSize: true,
  };
}

function getRendererRouteUrl(route) {
  const cleanRoute = normalizePrintRoute(route);
  if (process.env.ELECTRON_RENDERER_URL) {
    return `${process.env.ELECTRON_RENDERER_URL}#${cleanRoute}`;
  }
  const indexUrl = pathToFileURL(path.join(__dirname, "..", "dist", "index.html")).toString();
  return `${indexUrl}#${cleanRoute}`;
}

async function waitForInvoicePrintLayout(webContents) {
  const startedAt = Date.now();
  let lastState = "";
  while (Date.now() - startedAt < 12000) {
    const state = await webContents.executeJavaScript(`
      (() => {
        const invoice = document.querySelector(".invoice-page");
        if (invoice) return "ready";
        const bodyText = document.body ? document.body.innerText : "";
        if (bodyText.includes("الفاتورة غير موجودة")) return "invoice_not_found";
        if (bodyText.includes("ليس لديك صلاحية")) return "not_authorized";
        if (bodyText.includes("فعّل التطبيق")) return "activation_required";
        return bodyText.slice(0, 120);
      })()
    `);
    lastState = String(state || "");
    if (state === "ready") {
      await webContents.executeJavaScript(`
        (async () => {
          if (document.fonts && document.fonts.ready) await document.fonts.ready;
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          return true;
        })()
      `);
      return;
    }
    if (["invoice_not_found", "not_authorized", "activation_required"].includes(state)) {
      throw new Error(state);
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error(`print_layout_timeout:${lastState}`);
}

function getPrintSettings() {
  return readJsonKey(`${STORE_PREFIX}settings`, {
    companyName: "AutoParts Store",
    companyNameAr: "محل قطع غيار السيارات",
    invoiceFooter: "",
    currency: "ج.م",
    arabicLabels: true,
    logoText: "AP",
    logoImage: "",
    invoicesSavePath: "",
  });
}

function isPaidPrintFeatureEnabled(key, settings) {
  const status = getLicenseStatus();
  const licenseFeatures = status?.license?.features;
  if (!Array.isArray(licenseFeatures) || !licenseFeatures.includes(key)) return false;
  const override = settings?.features?.[key];
  return override === undefined ? true : Boolean(override);
}

function getInvoiceForPrint(route) {
  const cleanRoute = normalizePrintRoute(route);
  const match = cleanRoute.match(/^\/(sales|purchases|quotations)\/([^/]+)\/print$/);
  if (!match) {
    throw new Error("Unsupported print route");
  }

  const section = match[1];
  const id = decodeURIComponent(match[2]);
  if (section === "quotations" && !isPaidPrintFeatureEnabled("quotations", getPrintSettings())) {
    throw new Error("quotation_feature_not_enabled");
  }
  if (section === "sales") {
    const invoices = readJsonKey(`${STORE_PREFIX}salesInvoices`, []);
    const invoice = Array.isArray(invoices) ? invoices.find((item) => item.id === id) : null;
    if (!invoice) throw new Error("sales_invoice_not_found");
    return { kind: "sales", invoice };
  }
  if (section === "quotations") {
    const quotations = readJsonKey(`${STORE_PREFIX}quotations`, []);
    const invoice = Array.isArray(quotations) ? quotations.find((item) => item.id === id) : null;
    if (!invoice) throw new Error("quotation_not_found");
    return { kind: "quotation", invoice };
  }

  const invoices = readJsonKey(`${STORE_PREFIX}purchaseInvoices`, []);
  const invoice = Array.isArray(invoices) ? invoices.find((item) => item.id === id) : null;
  if (!invoice) throw new Error("purchase_invoice_not_found");
  return { kind: "purchase", invoice };
}

function buildQuotationPrintHtml(quot, settings) {
  const companyName = settings.arabicLabels ? settings.companyNameAr : settings.companyName;
  const logoImage = sanitizeImageSrc(settings.logoImage);
  const logo = logoImage
    ? `<img src="${escapeHtml(logoImage)}" alt="Logo" />`
    : escapeHtml(settings.logoText || "AP");
  const discount = Number(quot.discount) || 0;
  const subtotal = (quot.lines || []).reduce((a, l) => a + (l.subtotal || 0), 0);

  const rows = (quot.lines || []).map((l, idx) => `
    <tr>
      <td class="center">${idx + 1}</td>
      <td>${escapeHtml(l.productName)}</td>
      <td class="center">${escapeHtml(l.unit)}</td>
      <td class="center mono">${escapeHtml(String(l.quantity))}</td>
      <td class="center mono">${escapeHtml(formatCurrency(l.price, settings.currency))}</td>
      <td class="center mono bold">${escapeHtml(formatCurrency(l.subtotal, settings.currency))}</td>
    </tr>`).join("");

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob: file:; style-src 'unsafe-inline'; script-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none';" />
  <title>عرض سعر ${escapeHtml(quot.quotationNumber)}</title>
  <style>
    @page { size: A4 portrait; margin: 10mm; }
    * { box-sizing: border-box; }
    body { margin:0; background:white; color:#172033; font-family:Tahoma,Arial,sans-serif; font-size:12px; direction:rtl; }
    .print-toolbar { position:sticky; top:0; z-index:10; display:flex; align-items:center; justify-content:flex-start; gap:8px; padding:10px 14px; background:#241f62; color:white; box-shadow:0 2px 10px rgba(15,23,42,.18); }
    .print-toolbar button { border:0; border-radius:6px; padding:8px 14px; background:white; color:#241f62; font-family:inherit; font-weight:700; cursor:pointer; }
    .print-toolbar .secondary { background:rgba(255,255,255,.14); color:white; border:1px solid rgba(255,255,255,.32); }
    .print-status { min-width:150px; color:rgba(255,255,255,.82); font-size:11px; }
    .page { width:210mm; min-height:297mm; margin:0 auto; padding:12mm; }
    .header { display:flex; align-items:flex-start; justify-content:space-between; gap:24px; border-bottom:1px solid #d6dee8; padding-bottom:16px; margin-bottom:16px; }
    .brand { display:flex; align-items:center; gap:10px; }
    .logo { width:56px; height:56px; border-radius:12px; background:#241f62; color:white; display:grid; place-items:center; font-weight:700; font-size:18px; overflow:hidden; }
    .logo img { width:100%; height:100%; object-fit:cover; }
    .company { font-size:19px; font-weight:700; }
    .title { text-align:left; }
    .title h1 { margin:0 0 8px; font-size:25px; color:#241f62; }
    .muted { color:#667085; }
    .mono { font-family:Consolas,"Courier New",monospace; direction:ltr; }
    .bold { font-weight:700; }
    .cards { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:16px; }
    .card { border:1px solid #e2e8f0; background:#f8fafc; border-radius:8px; padding:10px; }
    .label { color:#667085; font-size:11px; margin-bottom:5px; }
    .value { font-weight:700; font-size:14px; }
    table { width:100%; border-collapse:collapse; margin-bottom:16px; }
    th { background:#eef2f7; color:#334155; font-weight:700; }
    th, td { border:1px solid #d6dee8; padding:7px; vertical-align:top; }
    .center { text-align:center; }
    .totals { display:flex; justify-content:flex-start; margin-bottom:16px; }
    .totals-box { width:280px; }
    .total-row { display:flex; align-items:center; justify-content:space-between; padding:5px 0; border-bottom:1px solid #edf2f7; }
    .total-row.final { border-top:1px solid #94a3b8; border-bottom:0; margin-top:4px; padding-top:8px; font-size:16px; font-weight:700; }
    .discount-row { color:#16a34a; }
    .notes { border-top:1px solid #e2e8f0; padding-top:9px; margin-bottom:18px; color:#475569; }
    .footer { border-top:1px solid #e2e8f0; padding-top:12px; text-align:center; color:#667085; white-space:pre-line; margin-bottom:26px; }
    .developer-info { margin-top:30px; padding-top:10px; border-top:1px solid #e2e8f0; text-align:center; color:#94a3b8; font-size:10px; }
    @media print { .print-toolbar { display:none; } .page { width:100%; min-height:auto; padding:0; } }
  </style>
</head>
<body>
  <div class="print-toolbar">
    <button type="button" id="print-now-button">طباعة</button>
    <button type="button" id="save-pdf-button">حفظ PDF</button>
    <button type="button" class="secondary" id="close-window-button">إغلاق</button>
    <span id="print-status" class="print-status"></span>
  </div>
  <div class="page">
    <div class="header">
      <div class="brand">
        <div class="logo">${logo}</div>
        <div>
          <div class="company">${escapeHtml(companyName)}</div>
          <div class="muted" style="margin-top:3px">${escapeHtml(settings.companyName || "")}</div>
        </div>
      </div>
      <div class="title">
        <h1>عرض سعر</h1>
        <div class="muted">رقم: <span class="mono bold">${escapeHtml(quot.quotationNumber)}</span></div>
        <div class="muted">التاريخ: ${formatDate(quot.date)}</div>
        ${quot.validUntil ? `<div class="muted">صالح حتى: ${formatDate(quot.validUntil)}</div>` : ""}
      </div>
    </div>

    <div class="cards">
      <div class="card">
        <div class="label">العميل</div>
        <div class="value">${escapeHtml(quot.customerName)}</div>
      </div>
      <div class="card">
        <div class="label">الحالة</div>
        <div class="value">${quot.status === "converted" ? "محولة لفاتورة" : "مفتوحة"}</div>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th class="center" style="width:42px">#</th>
          <th>الصنف</th>
          <th class="center" style="width:80px">الوحدة</th>
          <th class="center" style="width:80px">الكمية</th>
          <th class="center" style="width:130px">السعر</th>
          <th class="center" style="width:130px">الإجمالي</th>
        </tr>
      </thead>
      <tbody>
        ${rows || `<tr><td colspan="6" class="center muted">لا توجد بنود</td></tr>`}
      </tbody>
    </table>

    <div class="totals">
      <div class="totals-box">
        ${discount > 0 ? `
        <div class="total-row"><span>الإجمالي قبل الخصم</span><span class="mono">${escapeHtml(formatCurrency(subtotal, settings.currency))}</span></div>
        <div class="total-row discount-row"><span>خصم</span><span class="mono">- ${escapeHtml(formatCurrency(discount, settings.currency))}</span></div>
        <div class="total-row final"><span>الإجمالي</span><span class="mono">${escapeHtml(formatCurrency(quot.total, settings.currency))}</span></div>
        ` : `<div class="total-row final"><span>الإجمالي</span><span class="mono">${escapeHtml(formatCurrency(quot.total, settings.currency))}</span></div>`}
      </div>
    </div>

    ${quot.notes ? `<div class="notes"><strong>ملاحظات: </strong>${escapeHtml(quot.notes)}</div>` : ""}
    ${settings.invoiceFooter ? `<div class="footer">${escapeHtml(settings.invoiceFooter)}</div>` : ""}
    <div class="developer-info">هيلبيرز تكنولوجي</div>
  </div>
</body>
</html>`;
}

function buildInvoicePrintHtml(route) {
  const { kind, invoice } = getInvoiceForPrint(route);
  const settings = getPrintSettings();
  const expiryTrackingEnabled = isPaidPrintFeatureEnabled("expiryTracking", settings);
  if (kind === "quotation") return buildQuotationPrintHtml(invoice, settings);
  const isSales = kind === "sales";
  const title = isSales ? "فاتورة مبيعات" : "فاتورة مشتريات";
  const partyLabel = isSales ? "العميل" : "المورد";
  const partyName = isSales ? invoice.customerName : invoice.supplierName;
  const amountPaid = isSales ? invoice.amountReceived : invoice.amountPaid;
  const overpayment = isSales ? Number(invoice.overpayment) || 0 : 0;
  const totalCollected = amountPaid + overpayment;

  // Customer's overall outstanding balance across ALL their sales invoices.
  // Mirrors customerBalance() in the renderer: Σ(remaining − overpayment).
  // Positive → customer owes us (مدين); negative → customer has credit (دائن).
  let customerBalanceTotal = null;
  if (isSales && invoice.customerId) {
    const allSales = readJsonKey(`${STORE_PREFIX}salesInvoices`, []);
    if (Array.isArray(allSales)) {
      const raw = allSales
        .filter((s) => s.customerId === invoice.customerId && !s.cancelled)
        .reduce((a, s) => a + (Number(s.remaining) || 0) - (Number(s.overpayment) || 0), 0);
      customerBalanceTotal = Math.round(raw * 100) / 100;
    }
  }

  const returnsKey = isSales ? `${STORE_PREFIX}salesReturns` : `${STORE_PREFIX}purchaseReturns`;
  const allReturns = readJsonKey(returnsKey, []);
  const invoiceReturns = Array.isArray(allReturns)
    ? allReturns.filter((r) => r.originalInvoiceId === invoice.id)
    : [];
  const allReturnLines = invoiceReturns.flatMap((r) => r.lines || []);
  const returnsTotal = invoiceReturns.reduce((a, r) => a + (r.total || 0), 0);

  const paymentMethodLabels = { cash: "كاش", bank: "تحويل بنكي", vodafone: "فودافون كاش", instapay: "انستاباي", other: "أخرى", credit: "رصيد دائن" };
  const getPaymentLabel = (entry) => {
    if (entry.paymentMethod === "credit") return "رصيد";
    if (entry.paymentMethod === "other" && entry.notes === "رصيد دائن مستخدم") return "رصيد";
    return paymentMethodLabels[entry.paymentMethod] || entry.paymentMethod;
  };
  const paymentLog = Array.isArray(invoice.paymentLog) ? invoice.paymentLog : [];
  const discount = Number(invoice.discount) || 0;
  const paymentLabel = isSales
    ? invoice.paymentType === "cash"
      ? "نقدي"
      : "آجل (حساب)"
    : invoice.status === "paid"
      ? "مسدد"
      : invoice.status === "partial"
        ? "جزئي"
        : "آجل";
  const companyName = settings.arabicLabels ? settings.companyNameAr : settings.companyName;
  const logoImage = sanitizeImageSrc(settings.logoImage);
  const logo = logoImage
    ? `<img src="${escapeHtml(logoImage)}" alt="Logo" />`
    : escapeHtml(settings.logoText || "AP");

  const rows = (invoice.lines || [])
    .map(
      (line, idx) => `
        <tr>
          <td class="center">${idx + 1}</td>
          <td>
            ${escapeHtml(line.productName)}
            ${expiryTrackingEnabled && line.expiryDate ? `<div class="muted small">صلاحية: ${formatDate(line.expiryDate)}</div>` : ""}
          </td>
          <td class="center">${escapeHtml(line.unit)}</td>
          <td class="center mono">${escapeHtml(line.quantity)}</td>
          <td class="center mono">${escapeHtml(formatCurrency(line.price, settings.currency))}</td>
          <td class="center mono bold">${escapeHtml(formatCurrency(line.subtotal, settings.currency))}</td>
        </tr>`
    )
    .join("");

  const returnRows = allReturnLines
    .map(
      (line, idx) => `
        <tr style="background:${idx % 2 === 1 ? "#fff5f5" : "#ffffff"}">
          <td class="center">${idx + 1}</td>
          <td>${escapeHtml(line.productName)}</td>
          <td class="center">${escapeHtml(line.unit)}</td>
          <td class="center mono">${escapeHtml(String(line.quantity))}</td>
          <td class="center mono">${escapeHtml(formatCurrency(line.price, settings.currency))}</td>
          <td class="center mono bold">${escapeHtml(formatCurrency(line.subtotal, settings.currency))}</td>
        </tr>`
    )
    .join("");

  const accentColor = isSales ? "#1a3c6e" : "#1a4d3a";
  const accentLight = isSales ? "#dbeafe" : "#dcfce7";
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob: file:; style-src 'unsafe-inline'; script-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none';" />
  <title>${escapeHtml(title)} ${escapeHtml(invoice.invoiceNumber)}</title>
  <style>
    @page { size: A4 portrait; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #f1f5f9;
      color: #1e293b;
      font-family: Tahoma, Arial, sans-serif;
      font-size: 12px;
      direction: rtl;
    }

    /* ── Toolbar ── */
    .print-toolbar {
      position: sticky; top: 0; z-index: 10;
      display: flex; align-items: center; gap: 8px;
      padding: 10px 16px;
      background: ${accentColor};
      box-shadow: 0 2px 8px rgba(0,0,0,.25);
    }
    .print-toolbar button {
      border: 0; border-radius: 6px; padding: 7px 16px;
      font-family: inherit; font-size: 12px; font-weight: 700; cursor: pointer;
      background: white; color: ${accentColor};
    }
    .print-toolbar .secondary {
      background: rgba(255,255,255,.15); color: white;
      border: 1px solid rgba(255,255,255,.35);
    }
    .print-status { color: rgba(255,255,255,.75); font-size: 11px; min-width: 140px; }

    /* ── Page ── */
    .page {
      width: 210mm; min-height: 297mm;
      margin: 12px auto;
      background: white;
      border-radius: 10px;
      overflow: hidden;
      box-shadow: 0 4px 24px rgba(0,0,0,.12);
    }

    /* ── Header band ── */
    .header-band {
      background: ${accentColor};
      padding: 14px 18px 12px;
      display: flex; align-items: center; justify-content: space-between; gap: 16px;
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    .brand { display: flex; align-items: center; gap: 12px; }
    .logo {
      width: 54px; height: 54px; border-radius: 10px;
      background: rgba(255,255,255,.15);
      display: grid; place-items: center;
      font-weight: 700; font-size: 18px; color: white;
      overflow: hidden; border: 2px solid rgba(255,255,255,.3);
    }
    .logo img { width: 100%; height: 100%; object-fit: cover; }
    .company-name { font-size: 18px; font-weight: 700; color: white; }
    .company-sub  { font-size: 11px; color: rgba(255,255,255,.65); margin-top: 2px; }

    .inv-meta { text-align: left; }
    .inv-type {
      display: inline-block;
      background: rgba(255,255,255,.18);
      color: white; border: 1px solid rgba(255,255,255,.35);
      border-radius: 6px; padding: 3px 12px;
      font-size: 13px; font-weight: 700; margin-bottom: 6px;
    }
    .inv-number { font-size: 22px; font-weight: 700; color: white; font-family: Consolas,"Courier New",monospace; letter-spacing: 1px; }
    .inv-date   { font-size: 11px; color: rgba(255,255,255,.7); margin-top: 3px; }
    .header-date { font-size: 11px; color: rgba(255,255,255,.78); margin-top: 4px; }
    .invoice-number-pill {
      display: inline-block;
      background: rgba(255,255,255,.16);
      color: white;
      border: 1px solid rgba(255,255,255,.32);
      border-radius: 6px;
      padding: 3px 10px;
      font-family: Consolas,"Courier New",monospace;
      font-size: 15px;
      font-weight: 700;
    }

    /* ── Info strip ── */
    .info-strip {
      display: grid; grid-template-columns: 1.2fr .85fr .85fr .9fr;
      border-bottom: 2px solid ${accentLight};
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    .info-cell {
      padding: 5px 9px;
      border-left: 1px solid #e2e8f0;
      min-height: 44px;
    }
    .info-cell:last-child { border-left: 0; }
    .info-label { font-size: 8.5px; color: #94a3b8; text-transform: uppercase; letter-spacing: .2px; margin-bottom: 1px; }
    .info-value { font-size: 11.5px; font-weight: 700; color: #1e293b; line-height:1.2; }
    .info-sub   { font-size: 8.5px; color: #64748b; margin-top: 1px; }

    /* ── Body padding ── */
    .body { padding: 14px 18px 10px; }

    /* ── Section heading ── */
    .section-heading {
      display: flex; align-items: center; gap: 8px;
      font-size: 11px; font-weight: 700; color: ${accentColor};
      text-transform: uppercase; letter-spacing: .6px;
      margin-bottom: 8px; margin-top: 14px;
    }
    .section-heading::before {
      content: ""; display: block;
      width: 3px; height: 14px; border-radius: 2px;
      background: ${accentColor};
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    .section-heading::after {
      content: ""; flex: 1;
      height: 1px; background: #e2e8f0;
    }

    /* ── Tables ── */
    table { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
    thead tr {
      background: ${accentColor};
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    thead th {
      color: white; font-weight: 600; font-size: 11px;
      padding: 8px 10px; border: 0;
    }
    tbody tr:nth-child(even) { background: #f8fafc; }
    tbody td {
      padding: 7px 10px; color: #334155; font-size: 12px;
      border-bottom: 1px solid #f1f5f9;
    }
    .center { text-align: center; }
    .end    { text-align: left; }
    .mono   { font-family: Consolas,"Courier New",monospace; direction: ltr; white-space: nowrap; }
    .bold   { font-weight: 700; }
    .muted  { color: #94a3b8; }
    .small  { font-size: 10px; margin-top: 2px; }

    /* returns table */
    .ret-head { background: #fef2f2 !important; }
    .ret-head th { color: #b91c1c !important; }
    .return-deduction { color: #b91c1c; }
    .returns-total-line { text-align: left; margin-top: 6px; color: #b91c1c; font-weight: 700; font-size: 11px; }

    /* paylog table */
    .pay-head { background: #eff6ff !important; }
    .pay-head th { color: #1e40af !important; }
    .paid-highlight { color: #15803d; font-weight: 700; }

    /* ── Totals ── */
    .totals-wrap {
      display: flex; justify-content: flex-start; margin-top: 10px;
    }
    .totals-box {
      width: 440px;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      overflow: hidden;
    }
    .total-row {
      display: flex; justify-content: space-between; align-items: center;
      gap: 10px;
      padding: 6px 12px;
      border-bottom: 1px solid #f1f5f9;
      font-size: 12px;
    }
    .total-row span:last-child { white-space: nowrap; }
    .total-row:last-child { border-bottom: 0; }
    .discount-row { color: #16a34a; }
    .credit-row { background:#eff6ff; color:#1d4ed8; }
    .deduction-row { color:#b91c1c; }
    .bold-row { font-weight:700; }
    .total-row.final {
      background: ${accentColor};
      color: white; font-size: 15px; font-weight: 700;
      padding: 10px 12px;
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }

    /* ── Customer balance ── */
    .balance-bar {
      display: flex; justify-content: space-between; align-items: center;
      padding: 9px 14px; border-radius: 8px;
      font-weight: 700; font-size: 12px; margin-top: 12px;
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    .balance-bar.credit { background: #eff6ff; border: 1px solid #bfdbfe; color: #1e40af; }
    .balance-bar.debit  { background: #fef2f2; border: 1px solid #fecaca; color: #dc2626; }
    .balance-bar.settled{ background: #f0fdf4; border: 1px solid #bbf7d0; color: #15803d; }

    /* ── Notes & Footer ── */
    .notes-box {
      margin-top: 12px; padding: 10px 12px;
      background: #fffbeb; border: 1px solid #fde68a; border-radius: 6px;
      color: #92400e; font-size: 11px;
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    .footer-bar {
      margin-top: 10px; padding: 7px 18px 5px;
      background: #f8fafc; border-top: 1px solid #e2e8f0;
      text-align: center; color: #64748b; font-size: 10px;
      white-space: pre-line;
    }
    .dev-line {
      padding: 5px 6px; text-align: center;
      color: #64748b; font-size: 9.5px;
      border-top: 1px solid #f1f5f9;
    }

    @media print {
      body { background: white; }
      .print-toolbar { display: none; }
      .page { margin: 0; border-radius: 0; box-shadow: none; width: 100%; min-height: auto; }
    }
  </style>
</head>
<body>
  <div class="print-toolbar">
    <button type="button" id="print-now-button">طباعة</button>
    <button type="button" id="save-pdf-button">حفظ PDF</button>
    <button type="button" class="secondary" id="close-window-button">إغلاق</button>
    <span id="print-status" class="print-status"></span>
  </div>

  <div class="page">
    <!-- ══ Header Band ══ -->
    <div class="header-band">
      <div class="brand">
        <div class="logo">${logo}</div>
        <div>
          <div class="company-name">${escapeHtml(companyName)}</div>
          <div class="company-sub">${escapeHtml(settings.companyName || "")}</div>
          <div class="header-date">التاريخ: ${formatDate(invoice.date)}</div>
        </div>
      </div>
      <div class="inv-meta">
        <div class="inv-type">${escapeHtml(title)}</div>
        <div><span class="invoice-number-pill">${escapeHtml(invoice.invoiceNumber)}</span></div>
      </div>
    </div>

    <!-- ══ Info Strip ══ -->
    <div class="info-strip">
      <div class="info-cell">
        <div class="info-label">${escapeHtml(partyLabel)}</div>
        <div class="info-value">${escapeHtml(partyName)}</div>
      </div>
      <div class="info-cell">
        <div class="info-label">طريقة الدفع</div>
        <div class="info-value">${escapeHtml(paymentLabel)}</div>
      </div>
      <div class="info-cell">
        <div class="info-label">نوع السعر</div>
        <div class="info-value">${escapeHtml(isSales && invoice.priceType ? (invoice.priceType === "retail" ? "تجزئة" : "جملة") : "—")}</div>
      </div>
      <div class="info-cell">
        <div class="info-label">السائق</div>
        <div class="info-value">${escapeHtml(invoice.driverName || "—")}</div>
      </div>
    </div>

    <!-- ══ Body ══ -->
    <div class="body">

      <!-- بنود الفاتورة -->
      <div class="section-heading">بنود الفاتورة</div>
      <table>
        <thead class="items-head">
          <tr>
            <th class="center" style="width:36px">#</th>
            <th>الصنف</th>
            <th class="center" style="width:72px">الوحدة</th>
            <th class="center" style="width:72px">الكمية</th>
            <th class="center" style="width:138px">السعر</th>
            <th class="center" style="width:150px">الإجمالي</th>
          </tr>
        </thead>
        <tbody>
          ${rows || `<tr><td colspan="6" class="center muted" style="padding:16px">لا توجد بنود</td></tr>`}
        </tbody>
      </table>

      <!-- مرتجعات -->
      ${allReturnLines.length > 0 ? `
      <div class="section-heading" style="color:#b91c1c">المرتجعات</div>
      <table>
        <thead class="ret-head">
          <tr>
            <th class="center" style="width:36px">#</th>
            <th>الصنف</th>
            <th class="center" style="width:72px">الوحدة</th>
            <th class="center" style="width:72px">الكمية</th>
            <th class="center" style="width:138px">السعر</th>
            <th class="center" style="width:150px">الإجمالي</th>
          </tr>
        </thead>
        <tbody>${returnRows}</tbody>
      </table>
      <div class="returns-total-line">إجمالي المرتجع: ${escapeHtml(formatCurrency(returnsTotal, settings.currency))}</div>
      ` : ""}

      <!-- الإجماليات -->
      <div class="totals-wrap">
        <div class="totals-box">
          ${discount > 0 ? `
          <div class="total-row"><span>إجمالي البنود</span><span class="mono">${escapeHtml(formatCurrency(invoice.total + discount, settings.currency))}</span></div>
          <div class="total-row discount-row"><span>خصم</span><span class="mono">- ${escapeHtml(formatCurrency(discount, settings.currency))}</span></div>
          <div class="total-row bold-row"><span>مستحق (بعد الخصم)</span><span class="mono bold">${escapeHtml(formatCurrency(invoice.total, settings.currency))}</span></div>
          ` : `<div class="total-row bold-row"><span>إجمالي البنود</span><span class="mono bold">${escapeHtml(formatCurrency(invoice.total, settings.currency))}</span></div>`}
          ${returnsTotal > 0 ? `
          <div class="total-row return-deduction"><span>خصم المرتجع</span><span class="mono">- ${escapeHtml(formatCurrency(returnsTotal, settings.currency))}</span></div>
          <div class="total-row bold-row"><span>صافي بعد المرتجع</span><span class="mono bold">${escapeHtml(formatCurrency(Math.max(0, invoice.total - returnsTotal), settings.currency))}</span></div>
          ` : ""}
          ${paymentLog.length > 0
            ? paymentLog.map((e, i) => `<div class="total-row"><span>دفعة ${i + 1} — ${formatDate(e.date)} — ${escapeHtml(getPaymentLabel(e))}</span><span class="mono paid-highlight">${escapeHtml(formatCurrency(e.amount, settings.currency))}</span></div>`).join("")
            : `<div class="total-row"><span>${isSales ? "تم استلام" : "تم سداد"}</span><span class="mono paid-highlight">${escapeHtml(formatCurrency(amountPaid, settings.currency))}</span></div>`
          }
          ${isSales && overpayment > 0 ? `<div class="total-row credit-row"><span>رصيد للعميل من هذه الفاتورة</span><span class="mono">له ${escapeHtml(formatCurrency(overpayment, settings.currency))}</span></div>` : ""}
          ${paymentLog.length > 0 || overpayment > 0 ? `<div class="total-row bold-row"><span>${isSales ? "إجمالي المسدّد" : "إجمالي ما تم سداده"}</span><span class="mono paid-highlight">${escapeHtml(formatCurrency(totalCollected, settings.currency))}</span></div>` : ""}
          ${isSales && customerBalanceTotal !== null && partyName ? `<div class="total-row ${
            customerBalanceTotal < 0 ? "credit-row" : customerBalanceTotal > 0 ? "deduction-row" : ""
          }"><span>${
            customerBalanceTotal < 0
              ? `رصيد حساب للعميل (${escapeHtml(partyName)})`
              : customerBalanceTotal > 0
                ? `رصيد حساب على العميل (${escapeHtml(partyName)})`
                : `رصيد حساب العميل (${escapeHtml(partyName)})`
          }</span><span class="mono">${
            customerBalanceTotal < 0
              ? `له ${escapeHtml(formatCurrency(-customerBalanceTotal, settings.currency))}`
              : customerBalanceTotal > 0
                ? `عليه ${escapeHtml(formatCurrency(customerBalanceTotal, settings.currency))}`
                : "الحساب مسوّى"
          }</span></div>` : ""}
          <div class="total-row final"><span>${isSales ? "المتبقي على العميل" : "المتبقي للمورد"}</span><span class="mono">${escapeHtml(formatCurrency(invoice.remaining, settings.currency))}</span></div>
        </div>
      </div>

      <!-- ملاحظات -->
      ${invoice.notes ? `<div class="notes-box"><strong>ملاحظات: </strong>${escapeHtml(invoice.notes)}</div>` : ""}
    </div>

    <div class="footer-bar">${escapeHtml(settings.invoiceFooter || "شكراً لتعاملكم معنا — يرجى مراجعة الفاتورة قبل الاستلام.")}</div>
    <div class="dev-line">تم التطوير بواسطة شركة هيلبيرز تيكنولوجي | 01118445625 - 01080001249</div>
  </div>
</body>
</html>`;
}

function printRoute(route) {
  return new Promise((resolve) => {
    let printWindow = null;
    let resolved = false;
    const finish = (result) => {
      if (!resolved) {
        resolved = true;
        resolve(result);
      }
    };
    try {
      const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);
      const meta = getInvoicePrintMeta(route);
      const html = buildInvoicePrintHtml(route);
      printWindow = new BrowserWindow({
        width: 900,
        height: 1100,
        show: true,
        autoHideMenuBar: true,
        title: meta.windowTitle,
        icon: getAppIconPath(),
        webPreferences: {
          preload: path.join(__dirname, "print-preload.cjs"),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          devTools: isDev,
          webSecurity: true,
          allowRunningInsecureContent: false,
        },
      });
      const webContentsId = printWindow.webContents.id;
      printDocumentNames.set(webContentsId, meta.fileBaseName);
      printWindow.webContents.on("will-navigate", (event) => {
        event.preventDefault();
      });
      printWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      printWindow.on("closed", () => {
        printDocumentNames.delete(webContentsId);
        printWindow = null;
        finish({ ok: false, error: "print_window_closed" });
      });

      printWindow.webContents.once("did-finish-load", () => {
        if (!printWindow || printWindow.isDestroyed()) {
          finish({ ok: false, error: "print_window_closed" });
          return;
        }
        printWindow.show();
        printWindow.focus();
        finish({ ok: true });
      });

      printWindow.webContents.once("did-fail-load", (_event, _code, description) => {
        if (printWindow && !printWindow.isDestroyed()) {
          printWindow.close();
        }
        finish({ ok: false, error: description || "did_fail_load" });
      });

      printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    } catch (error) {
      if (printWindow && !printWindow.isDestroyed()) {
        printWindow.close();
      }
      finish({ ok: false, error: error instanceof Error ? error.message : "print_failed" });
    }
  });
}

function registerIpc() {
  // ── SECURITY: Validate storage keys exposed to the renderer ─────────
  const {
    isRendererStorageKey,
    redactStorageRowForExport,
    storageValueForRenderer,
  } = require("./storage-security.cjs");

  function ownerExistsInStore() {
    return getUsers().some((user) => user.role === "owner");
  }

  function canReadRendererStorage(event) {
    return !ownerExistsInStore() || Boolean(getSession(event)) || internalPrintWebContents.has(event.sender.id);
  }

  function canMutateRendererStorage(event, key) {
    if (!ownerExistsInStore()) return false;
    if (!getSession(event)) return false;
    if (String(key) === `${STORE_PREFIX}users`) return hasOwnerSession(event);
    return true;
  }

  // isRendererStorageKey, redactStorageRowForExport, storageValueForRenderer
  // imported above from ./storage-security.cjs

  function mergeRendererUsersValue(value) {
    const incoming = JSON.parse(String(value));
    if (!Array.isArray(incoming)) throw new Error("invalid_users_payload");
    const existing = getUsers();
    const existingById = new Map(existing.map((user) => [user.id, user]));
    const existingByUsername = new Map(existing.map((user) => [String(user.username).toLowerCase(), user]));
    const normalized = incoming.map((user) => {
        const cleanUsername = normalizeUsername(user?.username);
        if (!cleanUsername) {
          throw new Error("invalid_username");
        }
        const existingUser =
          existingById.get(user?.id) || existingByUsername.get(cleanUsername.toLowerCase());
        const incomingHash = user?.passwordHash;
        const passwordHash =
          incomingHash === REDACTED_PASSWORD_HASH
            ? existingUser?.passwordHash
            : incomingHash;
        if (!isArgonPasswordHash(passwordHash)) {
          throw new Error("invalid_password_hash");
        }
        const userId = existingUser?.id || String(user?.id || "").trim();
        if (!userId || userId.length > 120) throw new Error("invalid_user_id");
        return {
          ...user,
          id: userId,
          name: String(user?.name || cleanUsername).trim(),
          username: cleanUsername,
          passwordHash,
          // Account identity and privilege are main-process invariants. Existing
          // users cannot be re-keyed (which would detach MFA) or promoted by a
          // forged renderer storage write. Only first-run setup creates an owner.
          role: existingUser?.role || "employee",
          createdAt: existingUser?.createdAt || user?.createdAt || new Date().toISOString(),
        };
      });

    const ids = new Set();
    const usernames = new Set();
    for (const user of normalized) {
      const usernameKey = user.username.toLowerCase();
      if (ids.has(user.id) || usernames.has(usernameKey)) throw new Error("duplicate_user_identity");
      ids.add(user.id);
      usernames.add(usernameKey);
    }
    for (const owner of existing.filter((user) => user.role === "owner")) {
      if (!ids.has(owner.id)) throw new Error("owner_cannot_be_removed");
    }
    return JSON.stringify(normalized);
  }

  function normalizeRendererStorageValue(key, value) {
    if (String(key) === `${STORE_PREFIX}users`) return mergeRendererUsersValue(value);
    if (String(key) === BRANCHES_STORAGE_KEY) return validateBranchStorageValue(value);
    return String(value);
  }

  ipcMain.on("storage:get", (event, key) => {
    // During shutdown the DB is closed; a late synchronous read (fired while the
    // renderer unloads) must not reopen or touch it — answer null instead of
    // throwing an uncaught exception in the main process.
    if (isQuitting || !db) {
      event.returnValue = null;
      return;
    }
    if (!isRendererStorageKey(key) || !canReadRendererStorage(event)) {
      event.returnValue = null;
      return;
    }
    const raw = storageGet(String(key));
    event.returnValue = raw === null ? null : storageValueForRenderer(key, raw);
  });
  ipcMain.handle("storage:set", (event, key, value) => {
    if (!isRendererStorageKey(key) || !canMutateRendererStorage(event, key)) {
      return false;
    }
    try {
      const saved = storageSet(String(key), normalizeRendererStorageValue(key, value));
      if (String(key) === `${STORE_PREFIX}users`) cleanupMfaForMissingUsers();
      return saved;
    } catch {
      return false;
    }
  });
  ipcMain.handle("storage:remove", (event, key) => {
    if (!isRendererStorageKey(key) || !canMutateRendererStorage(event, key)) {
      return false;
    }
    return storageRemove(String(key));
  });
  ipcMain.handle("storage:clear-prefix", (event, prefix) => {
    if (String(prefix) !== STORE_PREFIX || !hasOwnerSession(event)) {
      return false;
    }
    const cleared = storageClearPrefix(String(prefix));
    cleanupMfaForMissingUsers();
    return cleared;
  });

  // ── Batch operations — eliminates per-key sync IPC bottleneck ────────
  ipcMain.handle("storage:get-batch", (event) => {
    if (!canReadRendererStorage(event)) return {};
    const rows = openDatabase()
      .prepare("SELECT key, value FROM kv_store WHERE key LIKE ?")
      .all(`${STORE_PREFIX}%`);
    const result = {};
    for (const row of rows) {
      if (!isRendererStorageKey(row.key)) continue;
      result[row.key] = storageValueForRenderer(row.key, row.value);
    }
    return result;
  });

  ipcMain.handle("storage:set-batch", (event, entries) => {
    if (!entries || typeof entries !== "object") return false;
    try {
      let usersWereUpdated = false;
      const tx = openDatabase().transaction(() => {
        for (const [key, value] of Object.entries(entries)) {
          if (!isRendererStorageKey(key) || !canMutateRendererStorage(event, key)) continue;
          try {
            getStmtSet().run(
              String(key),
              normalizeRendererStorageValue(key, value),
              new Date().toISOString()
            );
            if (String(key) === `${STORE_PREFIX}users`) usersWereUpdated = true;
          } catch { /* skip invalid individual keys */ }
        }
      });
      tx();
      if (usersWereUpdated) cleanupMfaForMissingUsers();
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle("storage:export", (event) => {
    if (!hasOwnerSession(event)) {
      return { version: 1, timestamp: new Date().toISOString(), rows: [] };
    }
    // SECURITY: Export only renderer-owned app data and redact credential hashes.
    const rows = openDatabase()
      .prepare("SELECT key, value, updated_at FROM kv_store WHERE key LIKE ? ORDER BY key")
      .all(`${STORE_PREFIX}%`)
      .filter((row) => isRendererStorageKey(row.key))
      .map(redactStorageRowForExport);
    return { version: 1, timestamp: new Date().toISOString(), rows };
  });
  ipcMain.handle("storage:import", (event, payload) => {
    if (!hasOwnerSession(event) || !payload || !Array.isArray(payload.rows)) return { ok: false };
    const insert = openDatabase().prepare(
      "INSERT INTO kv_store (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
    );
    const tx = openDatabase().transaction((rows) => {
      for (const row of rows) {
        if (typeof row.key === "string" && typeof row.value === "string") {
          if (!isRendererStorageKey(row.key)) continue;
          insert.run(
            row.key,
            normalizeRendererStorageValue(row.key, row.value),
            row.updated_at || new Date().toISOString()
          );
        }
      }
    });
    tx(payload.rows);
    return { ok: true };
  });

  ipcMain.handle("license:get-machine-code", () => getMachineCode());
  ipcMain.handle("license:get-status", () => getLicenseStatus());
  ipcMain.handle("license:activate", (_event, serial) => {
    const status = evaluateLicense(serial, false);
    if (status.state !== "active") {
      return { ok: false, status };
    }
    storageSet(LICENSE_TOKEN_KEY, String(serial).trim());
    storageSet(LICENSE_LAST_SEEN_KEY, new Date().toISOString());
    return { ok: true, status: getLicenseStatus() };
  });

  ipcMain.handle("branch-license:get-status", (event) => {
    if (!getSession(event)) throw new Error("not_authorized");
    return getBranchLicenseStatusInternal();
  });
  ipcMain.handle("branch-license:activate", (event, serial) => {
    if (!hasOwnerSession(event)) {
      return { ok: false, error: "not_authorized", status: getBranchLicenseStatusInternal() };
    }
    return activateBranchSlot(serial);
  });
  ipcMain.handle("branch-license:create-branch", (event, input) => {
    if (!hasOwnerSession(event)) {
      return { ok: false, error: "not_authorized", status: getBranchLicenseStatusInternal() };
    }
    return createLicensedBranch(input);
  });

  ipcMain.handle("setup:has-owner", () => getUsers().some((user) => user.role === "owner"));
  ipcMain.handle("setup:create-owner", async (event, payload) => {
    const result = await createOwner(payload?.username, payload?.password);
    if (result.ok && result.user) {
      setSession(event, result.user);
      return { ...result, user: safeUserForRenderer(result.user) };
    }
    return result;
  });
  ipcMain.handle("auth:hash-password", (event, password) => {
    if (ownerExistsInStore() && !hasOwnerSession(event)) {
      throw new Error("not_authorized");
    }
    return hashPassword(password);
  });
  ipcMain.handle("auth:login", async (event, payload) => {
    const result = await login(payload?.username, payload?.password);
    if (result.ok && result.user) {
      // The idle lock is renderer-only and intentionally keeps the established
      // main-process session. Re-authenticating the same user therefore needs
      // the password only; a fresh app login still receives the MFA challenge.
      const existingSession = getSession(event);
      if (existingSession?.userId === result.user.id) {
        setSession(event, result.user);
        return { ...result, user: safeUserForRenderer(result.user) };
      }
      if (existingSession) clearSession(event);
      const mfaResult = buildMfaLoginResult(event, result.user);
      if (mfaResult) return mfaResult;
      setSession(event, result.user);
      return { ...result, user: safeUserForRenderer(result.user) };
    }
    return result;
  });
  ipcMain.handle("auth:get-session", (event) => {
    const user = getSessionUser(event);
    return user
      ? { ok: true, user: safeUserForRenderer(user) }
      : { ok: false, error: "not_authenticated" };
  });
  ipcMain.handle("auth:verify-second-factor", (event, payload) =>
    verifyLoginSecondFactor(event, payload?.challengeId, payload?.code)
  );
  ipcMain.handle("auth:begin-account-recovery", (event, payload) =>
    beginAccountRecovery(event, payload?.recoveryCode)
  );
  ipcMain.handle("auth:complete-account-recovery", (event, payload) =>
    completeAccountRecovery(
      event,
      payload?.challengeId,
      payload?.newPassword,
      payload?.resetMfa !== false
    )
  );
  ipcMain.handle("auth:logout", (event) => {
    clearSession(event);
    revokeSenderChallenges(event.sender.id);
    recoveryAttempts.delete(String(event.sender.id));
    return { ok: true };
  });
  ipcMain.handle("auth:change-password", async (event, payload) => {
    const sessionInfo = getSession(event);
    const targetUserId = String(payload?.userId || "").trim();
    if (!sessionInfo || (sessionInfo.userId !== targetUserId && sessionInfo.role !== "owner")) {
      return { ok: false, error: "not_authorized" };
    }
    const result = await changePassword(payload);
    if (result.ok && result.user) {
      return { ...result, user: safeUserForRenderer(result.user) };
    }
    return result;
  });
  ipcMain.handle("auth:update-profile", async (event, payload) => {
    const sessionInfo = getSession(event);
    const targetUserId = String(payload?.userId || "").trim();
    if (!sessionInfo || (sessionInfo.userId !== targetUserId && sessionInfo.role !== "owner")) {
      return { ok: false, error: "not_authorized" };
    }
    const result = await updateOwnProfile(payload);
    if (result.ok && result.user) {
      return { ...result, user: safeUserForRenderer(result.user) };
    }
    return result;
  });
  ipcMain.handle("mfa:get-own-status", (event) => {
    const user = getSessionUser(event);
    return user
      ? { ok: true, ...getMfaStatusForUser(user) }
      : { ok: false, error: "not_authorized" };
  });
  ipcMain.handle("mfa:begin-enrollment", (event, payload) =>
    beginOwnMfaEnrollment(event, payload?.password)
  );
  ipcMain.handle("mfa:confirm-enrollment", (event, payload) =>
    confirmMfaEnrollment(event, payload?.challengeId, payload?.code)
  );
  ipcMain.handle("mfa:disable-own", (event, payload) =>
    disableOwnMfa(event, payload?.password, payload?.verificationCode)
  );
  ipcMain.handle("mfa:regenerate-recovery-codes", (event, payload) =>
    regenerateOwnRecoveryCodes(event, payload?.password, payload?.verificationCode)
  );
  ipcMain.handle("mfa:get-policy", (event) =>
    hasOwnerSession(event)
      ? { ok: true, policy: getMfaPolicy() }
      : { ok: false, error: "not_authorized" }
  );
  ipcMain.handle("mfa:update-policy", (event, payload) =>
    hasOwnerSession(event)
      ? updateMfaPolicy(payload?.mode)
      : { ok: false, error: "not_authorized" }
  );
  ipcMain.handle("mfa:list-user-statuses", (event) => {
    if (!hasOwnerSession(event)) return { ok: false, error: "not_authorized" };
    return {
      ok: true,
      users: getUsers().map((user) => ({
        userId: user.id,
        name: user.name,
        username: user.username,
        role: user.role,
        ...getMfaStatusForUser(user),
      })),
    };
  });
  ipcMain.handle("mfa:reset-user", (event, payload) =>
    resetUserMfaByOwner(
      event,
      payload?.userId,
      payload?.ownerPassword,
      payload?.verificationCode
    )
  );
  ipcMain.handle("support:reset-owner-password", async (event, payload) => {
    const key = String(event.sender.id);
    const rateLimited = getSupportRateLimitResult(key);
    if (rateLimited) return rateLimited;

    const result = await resetOwnerPassword(payload);
    if (result.ok && result.user) {
      supportAttempts.delete(key);
      return { ...result, user: safeUserForRenderer(result.user) };
    }
    if (result.error === "invalid_support_code" || result.error === "machine_mismatch") {
      const nextRateLimit = registerFailedSupportAttempt(key);
      if (nextRateLimit) return nextRateLimit;
    }
    return result;
  });
  ipcMain.handle("print:route", (event, route) => {
    if (!getSession(event)) return { ok: false, error: "not_authenticated" };
    let module;
    try {
      module = printModuleForRoute(route);
    } catch {
      return { ok: false, error: "invalid_route" };
    }
    if (!sessionCanViewModule(event, module)) return { ok: false, error: "not_authorized" };
    return printRoute(route);
  });
  ipcMain.handle("print:current-window", async (event) => {
    try {
      const printOpts = getInvoicePrintOptions();
      return new Promise((resolve) => {
        event.sender.print(printOpts, (success, failureReason) => {
          if (success) {
            resolve({ ok: true });
          } else {
            resolve({ ok: false, error: failureReason || "print_failed" });
          }
        });
      });
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "print_failed" };
    }
  });
  ipcMain.handle("print:save-current-pdf", async (event) => {
    const ownerWindow = BrowserWindow.fromWebContents(event.sender);
    const baseName =
      printDocumentNames.get(event.sender.id) ||
      sanitizeFileName(ownerWindow?.getTitle() || event.sender.getTitle() || "invoice");
    const settings = getPrintSettings();
    const baseDir = getPdfDefaultDirectory(settings);
    const defaultPath = path.join(baseDir, `${baseName}.pdf`);
    const pdfPath = await askForPdfPath(ownerWindow, defaultPath);
    if (!pdfPath) {
      return { ok: false, error: "cancelled" };
    }

    const pdf = await event.sender.printToPDF(getInvoicePdfOptions());
    fs.writeFileSync(pdfPath, pdf);
    shell.showItemInFolder(pdfPath);
    return { ok: true, path: pdfPath };
  });
  ipcMain.handle("print:save-pdf-route", async (event, route) => {
    // SECURITY: same session + module authorization as print:route — this
    // handler spawns an internal renderer that can read storage without a
    // session, so the check MUST live here at the trust boundary.
    if (!getSession(event)) return { ok: false, error: "not_authenticated" };
    let printModule;
    try {
      printModule = printModuleForRoute(route);
    } catch {
      return { ok: false, error: "invalid_route" };
    }
    if (!sessionCanViewModule(event, printModule)) return { ok: false, error: "not_authorized" };
    let pdfWin = null;
    try {
      const ownerWindow = BrowserWindow.fromWebContents(event.sender);
      const meta = getInvoicePrintMeta(route);
      const settings = getPrintSettings();
      const baseDir = getPdfDefaultDirectory(settings);
      const defaultPath = path.join(baseDir, `${meta.fileBaseName}.pdf`);
      const pdfPath = await askForPdfPath(ownerWindow, defaultPath);
      if (!pdfPath) return { ok: false, error: "cancelled" };
      const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);

      pdfWin = new BrowserWindow({
        show: false,
        width: 900,
        height: 1200,
        title: meta.windowTitle,
        autoHideMenuBar: true,
        webPreferences: {
          preload: path.join(__dirname, "preload.cjs"),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          devTools: isDev,
          webSecurity: true,
          allowRunningInsecureContent: false,
          // SECURITY: marks this as a main-authorized internal print renderer so
          // the print pages skip the interactive auth guard (it has no React
          // session). The main-side session+permission check above is what
          // actually gates access; this only unblocks the trusted render.
          additionalArguments: ["--hw-internal-print"],
        },
      });
      const webContentsId = pdfWin.webContents.id;
      internalPrintWebContents.add(webContentsId);
      pdfWin.on("closed", () => {
        internalPrintWebContents.delete(webContentsId);
      });
      pdfWin.webContents.on("will-navigate", (navEvent, navigationUrl) => {
        const expectedUrl = getRendererRouteUrl(route);
        if (navigationUrl !== expectedUrl) navEvent.preventDefault();
      });
      pdfWin.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

      await new Promise((resolve, reject) => {
        pdfWin.webContents.once("did-finish-load", resolve);
        pdfWin.webContents.once("did-fail-load", (_e, _c, desc) => reject(new Error(desc)));
        pdfWin.loadURL(getRendererRouteUrl(route));
      });
      await waitForInvoicePrintLayout(pdfWin.webContents);

      const pdf = await pdfWin.webContents.printToPDF(getInvoicePdfOptions());
      if (!pdfWin.isDestroyed()) pdfWin.close();
      pdfWin = null;

      fs.writeFileSync(pdfPath, pdf);
      shell.showItemInFolder(pdfPath);
      return { ok: true, path: pdfPath };
    } catch (err) {
      if (pdfWin && !pdfWin.isDestroyed()) {
        internalPrintWebContents.delete(pdfWin.webContents.id);
        pdfWin.close();
      }
      return { ok: false, error: err instanceof Error ? err.message : "pdf_failed" };
    }
  });
  ipcMain.handle("print:close-current-window", (event) => {
    const ownerWindow = BrowserWindow.fromWebContents(event.sender);
    if (ownerWindow && !ownerWindow.isDestroyed()) {
      ownerWindow.close();
      return { ok: true };
    }
    return { ok: false, error: "window_not_found" };
  });

  ipcMain.handle("dialog:select-directory", async (event) => {
    // E2E mode cannot drive a native dialog; return a real writable dir instead.
    if (HW_E2E) return os.tmpdir();
    const ownerWindow = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(ownerWindow, {
      properties: ["openDirectory"],
      title: "اختر مجلد حفظ الفواتير",
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle("backup:select-directory", async (event) => {
    if (HW_E2E) return os.tmpdir();
    const ownerWindow = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(ownerWindow, {
      properties: ["openDirectory", "createDirectory"],
      title: "اختر مجلد النسخ الاحتياطي (محلي أو شبكة)",
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle("backup:write-file", (event, payload) => {
    // SECURITY: only an authenticated owner session may write a data backup.
    if (!hasOwnerSession(event)) return { ok: false, error: "not_authorized" };
    if (
      !payload ||
      typeof payload.dir !== "string" ||
      typeof payload.fileName !== "string" ||
      typeof payload.content !== "string"
    ) {
      return { ok: false, error: "invalid_input" };
    }
    try {
      const dir = payload.dir;
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
        return { ok: false, error: "path_not_found" };
      }
      const base = sanitizeFileName(payload.fileName.replace(/\.(json|hwbak)$/i, "")) || "helpers-backup";
      const target = path.join(dir, `${base}.hwbak`);
      fs.writeFileSync(target, encryptBackup(payload.content, payload.passphrase), "utf8");
      return { ok: true, path: target };
    } catch {
      return { ok: false, error: "write_failed" };
    }
  });

  ipcMain.handle("backup:encrypt-content", (event, content, passphrase) => {
    if (!hasOwnerSession(event)) return { ok: false, error: "not_authorized" };
    if (typeof content !== "string") return { ok: false, error: "invalid_input" };
    try {
      return { ok: true, encrypted: encryptBackup(content, passphrase) };
    } catch {
      return { ok: false, error: "encrypt_failed" };
    }
  });

  ipcMain.handle("backup:decrypt-content", (event, content, passphrase) => {
    if (!hasOwnerSession(event)) return { ok: false, error: "not_authorized" };
    if (typeof content !== "string") return { ok: false, error: "invalid_input" };
    try {
      return { ok: true, plaintext: decryptBackup(content, passphrase) };
    } catch (err) {
      // A v2 backup with no passphrase supplied — the UI can prompt for one.
      if (err instanceof Error && err.message.includes("passphrase_required")) {
        return { ok: false, error: "passphrase_required" };
      }
      // Otherwise: wrong passphrase, tampered data, or a malformed envelope.
      return { ok: false, error: "decrypt_failed" };
    }
  });
}

app.whenReady().then(() => {
  // ── SECURITY: Set Content Security Policy ──────────────────────────
  const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const cspDirectives = isDev
      ? "default-src 'self' 'unsafe-inline' 'unsafe-eval'; img-src 'self' data: blob:; font-src 'self'; style-src 'self' 'unsafe-inline';"
      : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self';";
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [cspDirectives],
      },
    });
  });

  // ── SECURITY: Block dangerous permission requests ─────────────────
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    const allowed = ["clipboard-read", "clipboard-sanitized-write"];
    callback(allowed.includes(permission));
  });

  registerIpc();
  openDatabase();

  // Start heartbeat API polling
  void checkLicenseOnline();
  setInterval(() => {
    void checkLicenseOnline();
  }, 30 * 1000);

  if (isSmokeTestRun()) {
    // SECURITY: Removed console.log of license status
    exitForSmokeTest();
    return;
  }
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  isQuitting = true;
  try { db?.pragma("wal_checkpoint(TRUNCATE)"); } catch { /* ignore */ }
  try { closeDatabase(); } catch { /* ignore */ }
});
