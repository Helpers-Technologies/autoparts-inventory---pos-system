"use strict";

/**
 * Storage-layer load test: writes the generated three-year dataset into a real
 * encrypted SQLCipher database — the same engine, cipher and kv_store schema
 * the shipped app uses — and measures what a shop of that size actually costs
 * on every startup and every save.
 *
 * Run under Electron's ABI, because the native module is built for it:
 *   ELECTRON_RUN_AS_NODE=1 npx electron scripts/load-test-storage.cjs <dataset.json>
 *
 * Writes to a scratch path. It never opens the real database.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const Database = require("better-sqlite3-multiple-ciphers");

const datasetPath = process.argv[2];
if (!datasetPath) throw new Error("usage: load-test-storage.cjs <dataset.json>");

const STORE_PREFIX = "autoparts_inventory_v1::";
const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "partflow-load-")), "load.sqlite");
const key = crypto.createHash("sha256").update("load-test-key").digest("hex");

const ms = (start) => Number(process.hrtime.bigint() - start) / 1e6;
const results = [];
function time(label, fn) {
  const start = process.hrtime.bigint();
  const value = fn();
  const took = ms(start);
  results.push({ label, took });
  return { value, took };
}

console.log(`database: ${dbPath}\n`);

// ── Load fixture ─────────────────────────────────────────────────────────
const { value: dataset } = time("parse dataset JSON", () =>
  JSON.parse(fs.readFileSync(datasetPath, "utf8")));

// ── Open + schema (this is app startup) ──────────────────────────────────
const { value: db } = time("open encrypted database", () => {
  const handle = new Database(dbPath);
  handle.pragma(`rekey="x'${key}'"`);
  handle.pragma("journal_mode = WAL");
  handle.prepare(
    "CREATE TABLE IF NOT EXISTS kv_store (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)"
  ).run();
  return handle;
});

// ── Serialize + write, exactly as lsSetBatch does ────────────────────────
const entries = {};
time("serialize every collection to JSON", () => {
  for (const [key, value] of Object.entries(dataset)) {
    entries[STORE_PREFIX + key] = JSON.stringify(value);
  }
});

const totalBytes = Object.values(entries).reduce((s, v) => s + Buffer.byteLength(v), 0);

const upsert = db.prepare(
  "INSERT INTO kv_store (key, value, updated_at) VALUES (?, ?, ?) " +
  "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
);
const writeAll = db.transaction((rows) => {
  const now = new Date().toISOString();
  for (const [k, v] of Object.entries(rows)) upsert.run(k, v, now);
});

time("write all collections (one transaction)", () => writeAll(entries));

// A realistic incremental save: one new invoice appended to the sales array.
time("save after a single new sale (rewrites salesInvoices)", () => {
  const copy = dataset.salesInvoices.slice();
  copy.push({ ...copy[0], id: "sinv-new", invoiceNumber: "INV-999999" });
  writeAll({ [STORE_PREFIX + "salesInvoices"]: JSON.stringify(copy) });
});

// ── Read back: this is what every cold start pays ────────────────────────
const selectAll = db.prepare("SELECT key, value FROM kv_store");
const { value: rows } = time("read every row back (getBatch)", () => selectAll.all());
time("parse every collection back into objects", () => {
  for (const row of rows) JSON.parse(row.value);
});

// Single-collection reads, the common case when one screen opens.
const selectOne = db.prepare("SELECT value FROM kv_store WHERE key = ?");
for (const name of ["products", "customers", "salesInvoices", "stockMovements"]) {
  time(`read + parse "${name}" alone`, () =>
    JSON.parse(selectOne.get(STORE_PREFIX + name).value));
}

const fileBytes = fs.statSync(dbPath).size;
const walPath = `${dbPath}-wal`;
const walBytes = fs.existsSync(walPath) ? fs.statSync(walPath).size : 0;

db.close();

// ── Report ───────────────────────────────────────────────────────────────
const mb = (n) => (n / 1024 / 1024).toFixed(1) + " MB";
console.log("TIMINGS");
for (const r of results) {
  console.log(`  ${r.label.padEnd(48)} ${r.took.toFixed(0).padStart(7)} ms`);
}
console.log(`
SIZES
  JSON payload written                             ${mb(totalBytes)}
  encrypted database on disk                       ${mb(fileBytes)}
  write-ahead log                                  ${mb(walBytes)}
  rows in kv_store                                 ${rows.length}
`);

fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
