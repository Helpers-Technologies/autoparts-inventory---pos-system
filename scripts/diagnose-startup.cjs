"use strict";

/**
 * Where does startup time actually go on a very large shop?
 *
 * Reproduces, against the real seeded database, the exact sequence the app
 * performs between "sign in" and "the dashboard paints":
 *
 *   1. storage:get-batch — main process reads every row out of SQLCipher
 *   2. IPC — that whole payload crosses to the renderer
 *   3. lsGet per collection — the renderer parses each one back into arrays
 *   4. the first debounced flush — which re-serializes and re-writes
 *
 * Guessing which of these is slow is how you end up optimising the wrong one.
 *
 *   ELECTRON_RUN_AS_NODE=1 npx electron scripts/diagnose-startup.cjs <profile-dir>
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const os = require("node:os");
const Database = require("better-sqlite3-multiple-ciphers");
const { machineIdSync } = require("node-machine-id");
const { STORE_PREFIX, isRendererStorageKey, isChunkedTombstone,
        readChunkedCollection } = require("../electron/storage-security.cjs");

const profileDir = process.argv[2];
if (!profileDir) throw new Error("usage: diagnose-startup.cjs <profile-dir>");

const APP_SALT = "autoparts-inventory-system-v1-local-license";
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
function machineMaterial() {
  try { return machineIdSync(true); } catch {
    return sha256([os.hostname(), os.platform(), os.arch(), os.cpus()?.[0]?.model || "cpu"]
      .filter(Boolean).join("|"));
  }
}
const dbKey = sha256(`${APP_SALT}:db:${machineMaterial()}`);
const ms = (s) => Number(process.hrtime.bigint() - s) / 1e6;
const mb = (n) => (n / 1048576).toFixed(1) + " MB";

const dbPath = path.join(profileDir, "autoparts-inventory.secure.sqlite");
console.log(`\nprofile: ${dbPath}`);
console.log(`on disk: ${mb(fs.statSync(dbPath).size)}\n`);

let t = process.hrtime.bigint();
const db = new Database(dbPath, { readonly: true });
db.pragma(`key="x'${dbKey}'"`);
db.prepare("SELECT count(*) AS n FROM kv_store").get();
console.log(`1. open + unlock database                 ${ms(t).toFixed(0).padStart(7)} ms`);

// ── storage:get-batch, exactly as the main process runs it ──────────────
t = process.hrtime.bigint();
// Mirrors the exclusion the shipped storage:get-batch applies: the ledger's
// chunks never cross to the renderer at startup.
const LAZY_PREFIX = `${STORE_PREFIX}stockMovements#`;
const isLazyChunk = (k) =>
  k.startsWith(LAZY_PREFIX) && !k.endsWith("#meta") && !k.endsWith("#order");

const rows = db.prepare("SELECT key, value FROM kv_store WHERE key LIKE ? AND key NOT LIKE ?")
  .all(`${STORE_PREFIX}%`, `${LAZY_PREFIX}%`);
const readMs = ms(t);

t = process.hrtime.bigint();
const batch = {};
let bytes = 0;
for (const row of rows) {
  if (!isRendererStorageKey(row.key) || isLazyChunk(row.key)) continue;
  batch[row.key] = row.value;
  bytes += row.value.length;
}
const buildMs = ms(t);

console.log(`2. read every row from SQLCipher           ${readMs.toFixed(0).padStart(7)} ms   (${rows.length} rows, ${mb(bytes)})`);
console.log(`3. build the IPC payload object            ${buildMs.toFixed(0).padStart(7)} ms`);

// ── the IPC hop: Electron structure-clones this whole object ────────────
t = process.hrtime.bigint();
const serializedForIpc = JSON.stringify(batch);
console.log(`4. serialize for IPC (approximates the     ${ms(t).toFixed(0).padStart(7)} ms   (${mb(serializedForIpc.length)})`);
console.log(`   structured clone Electron performs)`);

t = process.hrtime.bigint();
JSON.parse(serializedForIpc);
console.log(`5. renderer receives + deserializes        ${ms(t).toFixed(0).padStart(7)} ms`);

// ── lsGet per collection ────────────────────────────────────────────────
const cache = new Map(Object.entries(batch));
const readRow = (k) => (cache.has(k) ? cache.get(k) : null);
// What the renderer actually loads at startup. stockMovements is deliberately
// absent: the ledger is read on demand by the two screens that show it, which
// is the single largest saving available here.
const COLLECTIONS = ["products", "customers", "salesInvoices", "purchaseInvoices",
  "salesReturns", "purchaseReturns", "shifts", "cashEntries",
  "auditLogs", "quotations"];
const LAZY = ["stockMovements"];

console.log(`\n6. renderer parses each collection back into arrays\n`);
let totalParse = 0;
const sizes = {};
for (const name of COLLECTIONS) {
  const full = `${STORE_PREFIX}${name}`;
  const raw = readRow(full);
  if (raw === null) continue;
  t = process.hrtime.bigint();
  let value;
  if (isChunkedTombstone(raw)) value = readChunkedCollection(full, readRow);
  else value = JSON.parse(raw);
  const took = ms(t);
  totalParse += took;
  sizes[name] = Array.isArray(value) ? value.length : 0;
  console.log(`   ${name.padEnd(20)} ${String(sizes[name]).padStart(8)} records  ${took.toFixed(0).padStart(6)} ms`);
}
console.log(`   ${"".padEnd(20)} ${"".padStart(8)}           ${"-".repeat(9)}`);
console.log(`   ${"total".padEnd(20)} ${"".padStart(8)}          ${totalParse.toFixed(0).padStart(6)} ms`);

// ── the first flush after login: nothing is known to be unchanged yet ───
console.log(`\n7. the FIRST debounced flush after login\n`);
const CHUNK = 500;
t = process.hrtime.bigint();
let rewriteBytes = 0;
let rewriteRows = 0;
for (const name of COLLECTIONS) {
  const full = `${STORE_PREFIX}${name}`;
  const raw = readRow(full);
  if (raw === null) continue;
  const value = isChunkedTombstone(raw) ? readChunkedCollection(full, readRow) : JSON.parse(raw);
  if (!Array.isArray(value)) continue;
  const chunks = Math.ceil(value.length / CHUNK);
  for (let i = 0; i < chunks; i++) {
    rewriteBytes += JSON.stringify(value.slice(i * CHUNK, (i + 1) * CHUNK)).length;
    rewriteRows++;
  }
}
console.log(`   re-serializes everything            ${ms(t).toFixed(0).padStart(7)} ms   (${rewriteRows} rows, ${mb(rewriteBytes)})`);
console.log(`   ...unless lsGet has already handed those arrays out, in which`);
console.log(`   case the identity check recognises them and nothing is written.\n`);

console.log(`8. WHAT IS NO LONGER LOADED AT STARTUP\n`);
const lazyRows = new Map(db.prepare("SELECT key, value FROM kv_store WHERE key LIKE ?")
  .all(`${STORE_PREFIX}stockMovements%`).map((r) => [r.key, r.value]));
const readLazy = (k) => (lazyRows.has(k) ? lazyRows.get(k) : null);
for (const name of LAZY) {
  const full = `${STORE_PREFIX}${name}`;
  const raw = readLazy(full);
  if (raw === null) continue;
  t = process.hrtime.bigint();
  const value = isChunkedTombstone(raw) ? readChunkedCollection(full, readLazy) : JSON.parse(raw);
  const took = ms(t);
  const bytes = JSON.stringify(value || []).length;
  console.log(`   ${name.padEnd(20)} ${String(Array.isArray(value) ? value.length : 0).padStart(8)} records  ` +
    `${took.toFixed(0).padStart(6)} ms  ${mb(bytes)}`);
  console.log(`   deferred until the inventory or product screen opens.\n`);
}

db.close();
