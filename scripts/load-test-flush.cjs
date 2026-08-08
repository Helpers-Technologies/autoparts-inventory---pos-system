"use strict";

/**
 * What one completed sale really costs, end to end.
 *
 * A sale mutates four collections — salesInvoices, products (stock), stock
 * Movements, shifts — and the debounced flush re-serializes every collection
 * whose reference changed, then writes them in one transaction. So the cost is
 * not "one invoice", it is "every invoice, every product and every stock
 * movement the shop has ever recorded".
 *
 * Serialization happens in the renderer, on the same thread that paints the
 * POS. The SQLite write happens in the main process, where it blocks the
 * synchronous storage reads the renderer makes.
 *
 *   ELECTRON_RUN_AS_NODE=1 npx electron scripts/load-test-flush.cjs <dataset.json>
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const Database = require("better-sqlite3-multiple-ciphers");

const datasetPath = process.argv[2];
if (!datasetPath) throw new Error("usage: load-test-flush.cjs <dataset.json>");

const STORE_PREFIX = "autoparts_inventory_v1::";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "partflow-flush-"));
const dbPath = path.join(dir, "flush.sqlite");
const key = crypto.createHash("sha256").update("load-test-key").digest("hex");
const ms = (s) => Number(process.hrtime.bigint() - s) / 1e6;
const median = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];

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
const writeBatch = db.transaction((rows) => {
  const now = new Date().toISOString();
  for (const [k, v] of Object.entries(rows)) upsert.run(k, v, now);
});

// Seed the whole shop once.
const seed = {};
for (const [k, v] of Object.entries(d)) seed[STORE_PREFIX + k] = JSON.stringify(v);
writeBatch(seed);

// Collections a completed sale touches.
const TOUCHED = ["salesInvoices", "products", "stockMovements", "shifts"];

const serializeSamples = [];
const writeSamples = [];
for (let i = 0; i < 5; i++) {
  const next = {
    salesInvoices: d.salesInvoices.concat([{ ...d.salesInvoices[0], id: `x-${i}` }]),
    products: d.products.slice(),
    stockMovements: d.stockMovements.concat([{ ...d.stockMovements[0], id: `mx-${i}` }]),
    shifts: d.shifts.slice(),
  };

  // Renderer thread: JSON.stringify of every changed collection.
  let s = process.hrtime.bigint();
  const batch = {};
  for (const name of TOUCHED) batch[STORE_PREFIX + name] = JSON.stringify(next[name]);
  serializeSamples.push(ms(s));

  // Main process: one encrypted transaction.
  s = process.hrtime.bigint();
  writeBatch(batch);
  writeSamples.push(ms(s));
}

// Per-collection breakdown, so the fix can target the expensive ones.
const perCollection = TOUCHED.map((name) => {
  const samples = [];
  for (let i = 0; i < 5; i++) {
    const s = process.hrtime.bigint();
    JSON.stringify(d[name]);
    samples.push(ms(s));
  }
  return { name, count: d[name].length, bytes: Buffer.byteLength(JSON.stringify(d[name])), took: median(samples) };
});

const ser = median(serializeSamples);
const wr = median(writeSamples);

console.log(`
ONE SALE, at ${d.salesInvoices.length.toLocaleString()} invoices / ${d.products.length.toLocaleString()} products / ${d.stockMovements.length.toLocaleString()} movements

  renderer thread  serialize changed collections     ${ser.toFixed(0).padStart(6)} ms   <- UI is frozen for this
  main process     encrypted write (1 transaction)   ${wr.toFixed(0).padStart(6)} ms   <- storage reads block for this
  ${"".padEnd(52, "-")}
  total work per sale                                ${(ser + wr).toFixed(0).padStart(6)} ms

WHAT IS BEING REWRITTEN EACH TIME
`);
for (const c of perCollection) {
  console.log(`  ${c.name.padEnd(18)} ${String(c.count).padStart(8)} rows  ` +
    `${(c.bytes / 1048576).toFixed(1).padStart(6)} MB  ${c.took.toFixed(0).padStart(5)} ms to serialize`);
}

// The debounce coalesces bursts: how many sales can be rung up per flush?
console.log(`
The 2s debounce coalesces a burst, so the cost is paid per *flush*, not per
sale — but a cashier working steadily triggers a flush every 2s regardless,
and the serialize step runs on the thread that draws the POS.
`);

db.close();
fs.rmSync(dir, { recursive: true, force: true });
