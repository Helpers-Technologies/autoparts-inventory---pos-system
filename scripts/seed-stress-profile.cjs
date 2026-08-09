"use strict";

/**
 * Builds a ready-to-open PartFlow profile loaded with a large generated shop,
 * so the system can be driven by hand under realistic weight.
 *
 * It writes to its OWN userData directory and never touches the real one. The
 * app is launched against it with Electron's --user-data-dir, so the live shop
 * database is not opened, not read and not at risk.
 *
 *   ELECTRON_RUN_AS_NODE=1 npx electron scripts/seed-stress-profile.cjs \
 *       <dataset.json> <profile-dir> [--license <APLIC token>] [--password <pw>]
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const os = require("node:os");
const Database = require("better-sqlite3-multiple-ciphers");
const argon2 = require("argon2");
const { machineIdSync } = require("node-machine-id");
const { STORE_PREFIX, CHUNKED_TOMBSTONE } = require("../electron/storage-security.cjs");

const [datasetPath, profileDir] = process.argv.slice(2);
if (!datasetPath || !profileDir) {
  throw new Error("usage: seed-stress-profile.cjs <dataset.json> <profile-dir> [--license T] [--password P]");
}
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
};
const licenseToken = arg("--license");
const password = arg("--password") || "stress123";

// Same derivation as electron/main.cjs. The key is bound to this machine, so
// the seeded profile opens on this computer and is unreadable anywhere else —
// which is the point of the encryption, not an obstacle to it.
const APP_SALT = "autoparts-inventory-system-v1-local-license";
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
function machineMaterial() {
  try {
    return machineIdSync(true);
  } catch {
    return sha256([os.hostname(), os.platform(), os.arch(), os.cpus()?.[0]?.model || "cpu"]
      .filter(Boolean).join("|"));
  }
}
const dbKey = sha256(`${APP_SALT}:db:${machineMaterial()}`);

const CHUNK_SIZE = 500;
const CHUNKED = new Set([
  "salesInvoices", "purchaseInvoices", "stockMovements", "auditLogs", "customers",
  "products", "salesReturns", "purchaseReturns", "quotations", "shifts", "cashEntries",
]);

(async () => {
  console.log(`reading ${datasetPath} ...`);
  const d = JSON.parse(fs.readFileSync(datasetPath, "utf8"));

  fs.mkdirSync(profileDir, { recursive: true });
  const dbPath = path.join(profileDir, "autoparts-inventory.secure.sqlite");
  // A stale database from an earlier seed would merge confusingly with this one.
  for (const suffix of ["", "-wal", "-shm"]) {
    if (fs.existsSync(dbPath + suffix)) fs.rmSync(dbPath + suffix);
  }

  const db = new Database(dbPath);
  db.pragma(`rekey="x'${dbKey}'"`);
  db.pragma("journal_mode = WAL");
  db.prepare(
    "CREATE TABLE IF NOT EXISTS kv_store (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)"
  ).run();
  const upsert = db.prepare(
    "INSERT INTO kv_store (key, value, updated_at) VALUES (?, ?, ?) " +
    "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
  );
  const writeAll = db.transaction((batch) => {
    const now = new Date().toISOString();
    for (const [k, v] of Object.entries(batch)) upsert.run(k, v, now);
  });

  // ── Owner account ──────────────────────────────────────────────────────
  // Hashed with the app's own argon2 at the app's own parameters, so the
  // normal login path verifies it exactly as it would a real account.
  console.log("hashing the owner password ...");
  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 4,
  });
  const allow = {
    view: true, create: true, edit: true, delete: true, export: true,
  };
  const owner = {
    id: "user-stress-owner",
    name: "مالك متجر الاختبار",
    username: "admin",
    passwordHash,
    role: "owner",
    permissions: {
      dashboard: { ...allow }, products: { ...allow }, inventory: { ...allow },
      customers: { ...allow }, suppliers: { ...allow }, sales: { ...allow },
      purchases: { ...allow }, returns: { ...allow }, quotations: { ...allow },
      cashbox: { ...allow }, dues: { ...allow }, reports: { ...allow },
      settings: { ...allow }, users: { ...allow },
      pos: { ...allow, supervisorOverride: true },
    },
    createdAt: new Date().toISOString(),
  };

  // ── Shop data, in the chunked format the app now writes ────────────────
  const batch = {};
  let chunkRows = 0;
  for (const [name, value] of Object.entries(d)) {
    if (name === "users") continue; // replaced by the owner below
    if (CHUNKED.has(name) && Array.isArray(value)) {
      const chunks = Math.ceil(value.length / CHUNK_SIZE);
      for (let i = 0; i < chunks; i++) {
        batch[`${STORE_PREFIX}${name}#${String(i).padStart(4, "0")}`] =
          JSON.stringify(value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE));
        chunkRows++;
      }
      batch[`${STORE_PREFIX}${name}#meta`] =
        JSON.stringify({ chunks, size: CHUNK_SIZE, total: value.length });
      batch[`${STORE_PREFIX}${name}`] = CHUNKED_TOMBSTONE;
    } else {
      batch[`${STORE_PREFIX}${name}`] = JSON.stringify(value);
    }
  }
  batch[`${STORE_PREFIX}users`] = JSON.stringify([owner]);
  if (licenseToken) batch["__license_token"] = licenseToken;

  console.log(`writing ${Object.keys(batch).length} rows (${chunkRows} chunks) ...`);
  const started = process.hrtime.bigint();
  writeAll(batch);
  const took = Number(process.hrtime.bigint() - started) / 1e6;

  db.close();

  const bytes = fs.statSync(dbPath).size;
  console.log(`
seeded ${dbPath}
  ${(bytes / 1048576).toFixed(1)} MB encrypted, written in ${(took / 1000).toFixed(1)}s

  products           ${(d.products || []).length.toLocaleString()}
  customers          ${(d.customers || []).length.toLocaleString()}
  sales invoices     ${(d.salesInvoices || []).length.toLocaleString()}
  purchase invoices  ${(d.purchaseInvoices || []).length.toLocaleString()}
  stock movements    ${(d.stockMovements || []).length.toLocaleString()}
  cashier shifts     ${(d.shifts || []).length.toLocaleString()}

  sign in with:  admin / ${password}
  licence:       ${licenseToken ? "seeded" : "NOT seeded — the app will ask for one"}
`);
})();
