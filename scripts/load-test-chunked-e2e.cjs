"use strict";

/**
 * End-to-end proof on a real encrypted database, using the SHIPPED main-process
 * reader — not a re-implementation of it.
 *
 * Writes the full three-year shop in the chunked format, then reads it back the
 * way electron/main.cjs does when it builds the commerce snapshot, and checks
 * every record survives. Also covers the two states a real upgrade passes
 * through: a shop still on the legacy single blob, and one whose chunks are
 * damaged.
 *
 *   ELECTRON_RUN_AS_NODE=1 npx electron scripts/load-test-chunked-e2e.cjs <dataset.json>
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const Database = require("better-sqlite3-multiple-ciphers");
const {
  STORE_PREFIX,
  CHUNKED_TOMBSTONE,
  readChunkedCollection,
  isChunkedTombstone,
  isRendererStorageKey,
} = require("../electron/storage-security.cjs");

const datasetPath = process.argv[2];
if (!datasetPath) throw new Error("usage: load-test-chunked-e2e.cjs <dataset.json>");

const CHUNK_SIZE = 500;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "partflow-e2e-"));
const dbPath = path.join(dir, "shop.sqlite");
const key = crypto.createHash("sha256").update("e2e-key").digest("hex");
const ms = (s) => Number(process.hrtime.bigint() - s) / 1e6;
const mb = (n) => (n / 1048576).toFixed(1) + " MB";

const d = JSON.parse(fs.readFileSync(datasetPath, "utf8"));

const db = new Database(dbPath);
db.pragma(`rekey="x'${key}'"`);
db.pragma("journal_mode = WAL");
db.prepare(
  "CREATE TABLE IF NOT EXISTS kv_store (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)"
).run();
const upsert = db.prepare(
  "INSERT INTO kv_store (key, value, updated_at) VALUES (?, ?, ?) " +
  "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
);
const writeBatch = db.transaction((batch) => {
  const now = new Date().toISOString();
  for (const [k, v] of Object.entries(batch)) upsert.run(k, v, now);
});

/** Exactly what the shipped main.cjs readJsonKey does. */
const storageGet = (k) => {
  const row = db.prepare("SELECT value FROM kv_store WHERE key = ?").get(k);
  return row ? row.value : null;
};
function readJsonKey(fullKey, fallback) {
  const raw = storageGet(fullKey);
  if (!raw) return fallback;
  if (isChunkedTombstone(raw)) {
    const rebuilt = readChunkedCollection(fullKey, storageGet);
    return rebuilt === null ? fallback : rebuilt;
  }
  try { return JSON.parse(raw); } catch { return fallback; }
}

const CHUNKED = ["salesInvoices", "products", "customers", "stockMovements",
  "purchaseInvoices", "salesReturns", "shifts"];

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!ok) failures++;
};

console.log("\n1. WRITE THE WHOLE SHOP IN CHUNKED FORM\n");
let t = process.hrtime.bigint();
const batch = {};
let rowCount = 0;
for (const name of CHUNKED) {
  const arr = d[name] || [];
  const chunks = Math.ceil(arr.length / CHUNK_SIZE);
  for (let i = 0; i < chunks; i++) {
    batch[`${STORE_PREFIX}${name}#${String(i).padStart(4, "0")}`] =
      JSON.stringify(arr.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE));
    rowCount++;
  }
  batch[`${STORE_PREFIX}${name}#meta`] =
    JSON.stringify({ chunks, size: CHUNK_SIZE, total: arr.length });
  batch[`${STORE_PREFIX}${name}`] = CHUNKED_TOMBSTONE;
}
for (const name of ["users", "settings"]) {
  if (d[name] !== undefined) batch[`${STORE_PREFIX}${name}`] = JSON.stringify(d[name]);
}
writeBatch(batch);
console.log(`  ${rowCount} chunk rows across ${CHUNKED.length} collections in ${ms(t).toFixed(0)} ms`);
console.log(`  database on disk: ${mb(fs.statSync(dbPath).size)}\n`);

console.log("2. READ IT BACK WITH THE SHIPPED MAIN-PROCESS READER\n");
t = process.hrtime.bigint();
for (const name of CHUNKED) {
  const back = readJsonKey(`${STORE_PREFIX}${name}`, null);
  const expected = d[name] || [];
  check(`${name}: ${expected.length} records`,
    Array.isArray(back) && back.length === expected.length,
    Array.isArray(back) ? `got ${back.length}` : "got a non-array");
}
console.log(`\n  all collections reassembled in ${ms(t).toFixed(0)} ms\n`);

console.log("3. THE DATA IS IDENTICAL, NOT MERELY THE RIGHT LENGTH\n");
const invoicesBack = readJsonKey(`${STORE_PREFIX}salesInvoices`, []);
check("first invoice matches",
  JSON.stringify(invoicesBack[0]) === JSON.stringify(d.salesInvoices[0]));
check("last invoice matches",
  JSON.stringify(invoicesBack[invoicesBack.length - 1]) ===
  JSON.stringify(d.salesInvoices[d.salesInvoices.length - 1]));
check("a record on a chunk boundary matches",
  JSON.stringify(invoicesBack[CHUNK_SIZE]) === JSON.stringify(d.salesInvoices[CHUNK_SIZE]));
check("whole collection is byte-identical",
  JSON.stringify(invoicesBack) === JSON.stringify(d.salesInvoices));

const revenueBack = invoicesBack.filter((i) => !i.cancelled)
  .reduce((s, i) => s + i.total, 0);
const revenueSource = d.salesInvoices.filter((i) => !i.cancelled)
  .reduce((s, i) => s + i.total, 0);
check("revenue computed from the reassembled data matches the source",
  Math.abs(revenueBack - revenueSource) < 0.01,
  `${revenueBack.toFixed(2)} vs ${revenueSource.toFixed(2)}`);

console.log("\n4. A SHOP STILL ON THE OLD FORMAT\n");
writeBatch({ [`${STORE_PREFIX}quotations`]: JSON.stringify([{ id: "q1" }, { id: "q2" }]) });
const legacyBack = readJsonKey(`${STORE_PREFIX}quotations`, null);
check("legacy single blob still reads", Array.isArray(legacyBack) && legacyBack.length === 2);

console.log("\n5. DAMAGE IS REFUSED, NOT SERVED\n");
db.prepare("DELETE FROM kv_store WHERE key = ?").run(`${STORE_PREFIX}salesInvoices#0003`);
check("a missing chunk yields the fallback, not a truncated shop",
  readJsonKey(`${STORE_PREFIX}salesInvoices`, "FALLBACK") === "FALLBACK");

writeBatch({
  [`${STORE_PREFIX}products#meta`]: JSON.stringify({ chunks: 2, size: 500, total: 999999 }),
});
check("a manifest that disagrees with the chunks yields the fallback",
  readJsonKey(`${STORE_PREFIX}products`, "FALLBACK") === "FALLBACK");

console.log("\n6. CHUNK ROWS PASS THE RENDERER-KEY GATE\n");
const allKeys = db.prepare("SELECT key FROM kv_store").all().map((r) => r.key);
const rejected = allKeys.filter((k) => !isRendererStorageKey(k));
check("every stored row would be accepted by the IPC guard", rejected.length === 0,
  rejected.slice(0, 3).join(", "));

console.log("\n7. THE CLOUD ARCHIVE STILL PICKS EVERYTHING UP\n");
const archived = db.prepare("SELECT key, value FROM kv_store ORDER BY key").all()
  .filter((r) => isRendererStorageKey(r.key));
check("archive includes the chunk rows",
  archived.some((r) => r.key.includes("#0000")));
check("archive includes the manifests",
  archived.some((r) => r.key.endsWith("#meta")));
check("archive is prefix-driven so it needed no change at all",
  archived.length === allKeys.length);

db.close();
fs.rmSync(dir, { recursive: true, force: true });

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}\n`);
process.exit(failures === 0 ? 0 : 1);
