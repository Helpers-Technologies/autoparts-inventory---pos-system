"use strict";

/**
 * How long does ONE sale take to save, as the shop's history grows?
 *
 * The app persists each collection as a single JSON blob in kv_store, so
 * appending an invoice rewrites every invoice. That is invisible at 500
 * invoices and decides whether the POS is usable at 30,000. This measures the
 * curve and splits the cost between serialization and the encrypted write, so
 * the fix can be aimed at whichever actually dominates.
 *
 *   ELECTRON_RUN_AS_NODE=1 npx electron scripts/load-test-save-scaling.cjs <dataset.json>
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const Database = require("better-sqlite3-multiple-ciphers");

const datasetPath = process.argv[2];
if (!datasetPath) throw new Error("usage: load-test-save-scaling.cjs <dataset.json>");

const STORE_PREFIX = "autoparts_inventory_v1::";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "partflow-scale-"));
const key = crypto.createHash("sha256").update("load-test-key").digest("hex");
const ms = (start) => Number(process.hrtime.bigint() - start) / 1e6;

const dataset = JSON.parse(fs.readFileSync(datasetPath, "utf8"));
const all = dataset.salesInvoices;

console.log("Cost of saving ONE new sales invoice, by history size\n");
console.log("  invoices    JSON MB   serialize   sqlite write   TOTAL per save");
console.log("  " + "-".repeat(66));

const rows = [];
for (const count of [500, 2000, 5000, 10000, 20000, all.length]) {
  const slice = all.slice(0, count);
  const dbPath = path.join(dir, `s-${count}.sqlite`);
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
  const write = db.transaction((k, v) => upsert.run(k, v, new Date().toISOString()));

  // Seed once so the measured save is an update, not an insert.
  write(STORE_PREFIX + "salesInvoices", JSON.stringify(slice));

  // Median of five appends — one sample is noise on a machine doing other work.
  const serializeTimes = [];
  const writeTimes = [];
  for (let i = 0; i < 5; i++) {
    const next = slice.concat([{ ...slice[0], id: `new-${i}` }]);
    let s = process.hrtime.bigint();
    const json = JSON.stringify(next);
    serializeTimes.push(ms(s));
    s = process.hrtime.bigint();
    write(STORE_PREFIX + "salesInvoices", json);
    writeTimes.push(ms(s));
  }
  const median = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const ser = median(serializeTimes);
  const wr = median(writeTimes);
  const bytes = Buffer.byteLength(JSON.stringify(slice));

  rows.push({ count, bytes, ser, wr, total: ser + wr });
  console.log(
    `  ${String(count).padStart(8)}   ${(bytes / 1048576).toFixed(1).padStart(7)}   ` +
    `${ser.toFixed(0).padStart(7)} ms   ${wr.toFixed(0).padStart(9)} ms   ` +
    `${(ser + wr).toFixed(0).padStart(9)} ms`
  );
  db.close();
}

const worst = rows[rows.length - 1];
console.log(`
At ${worst.count.toLocaleString()} invoices every single sale costs ${worst.total.toFixed(0)} ms of work
before the cashier can start the next one — ${(worst.total / rows[0].total).toFixed(0)}x the cost at 500 invoices.
Serialization is ${(worst.ser / worst.total * 100).toFixed(0)}% of it, the encrypted write ${(worst.wr / worst.total * 100).toFixed(0)}%.
`);

fs.rmSync(dir, { recursive: true, force: true });
