"use strict";

/**
 * Does chunking actually remove the O(history) cost per sale?
 *
 * Mirrors load-test-save-scaling.cjs exactly — same data, same encrypted
 * SQLCipher database, same one-transaction write — but persists the collection
 * as 500-record chunks and only rewrites the chunk that changed. Run both to
 * compare; the numbers only mean something side by side.
 *
 *   ELECTRON_RUN_AS_NODE=1 npx electron scripts/load-test-chunked-save.cjs <dataset.json>
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const Database = require("better-sqlite3-multiple-ciphers");

const datasetPath = process.argv[2];
if (!datasetPath) throw new Error("usage: load-test-chunked-save.cjs <dataset.json>");

const PREFIX = "autoparts_inventory_v1::";
const CHUNK_SIZE = 500;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "partflow-chunked-"));
const key = crypto.createHash("sha256").update("load-test-key").digest("hex");
const ms = (s) => Number(process.hrtime.bigint() - s) / 1e6;
const median = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];

const d = JSON.parse(fs.readFileSync(datasetPath, "utf8"));
const all = d.salesInvoices;

console.log("Cost of saving ONE new sales invoice — CHUNKED persistence\n");
console.log("  invoices    chunks   serialize   sqlite write   TOTAL per save");
console.log("  " + "-".repeat(64));

const rows = [];
for (const count of [500, 2000, 5000, 10000, 20000, all.length]) {
  const slice = all.slice(0, count);
  const dbPath = path.join(dir, `c-${count}.sqlite`);
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

  const chunkKey = (i) => `${PREFIX}salesInvoices#${String(i).padStart(4, "0")}`;
  // Seed: every chunk written once, and remembered as the renderer cache would.
  const cache = new Map();
  const seedChunks = Math.ceil(slice.length / CHUNK_SIZE);
  const seed = {};
  for (let i = 0; i < seedChunks; i++) {
    const json = JSON.stringify(slice.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE));
    seed[chunkKey(i)] = json;
    cache.set(chunkKey(i), json);
  }
  seed[`${PREFIX}salesInvoices#meta`] =
    JSON.stringify({ chunks: seedChunks, size: CHUNK_SIZE, total: slice.length });
  seed[`${PREFIX}salesInvoices`] = '"__partflow_chunked__"';
  writeBatch(seed);

  const serializeTimes = [];
  const writeTimes = [];
  let dirtyChunks = 0;
  let prev = slice;
  for (let i = 0; i < 5; i++) {
    const next = slice.concat([{ ...slice[0], id: `new-${i}` }]);
    const chunks = Math.ceil(next.length / CHUNK_SIZE);

    // Renderer thread: skip untouched chunks by ELEMENT IDENTITY, without
    // serializing them. Comparing serialized text would re-stringify the whole
    // history on every save just to learn that nothing changed — which is most
    // of the cost this change exists to remove.
    let s = process.hrtime.bigint();
    const batch = {};
    for (let c = 0; c < chunks; c++) {
      const start = c * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, next.length);
      let same = prev !== null && prev.length >= end;
      if (same) {
        for (let k = start; k < end; k++) {
          if (prev[k] !== next[k]) { same = false; break; }
        }
      }
      if (same) continue;
      batch[chunkKey(c)] = JSON.stringify(next.slice(start, end));
    }
    batch[`${PREFIX}salesInvoices#meta`] =
      JSON.stringify({ chunks, size: CHUNK_SIZE, total: next.length });
    serializeTimes.push(ms(s));
    dirtyChunks = Object.keys(batch).length;

    s = process.hrtime.bigint();
    writeBatch(batch);
    writeTimes.push(ms(s));
    prev = next;
  }

  const ser = median(serializeTimes);
  const wr = median(writeTimes);
  rows.push({ count, chunks: seedChunks, ser, wr, total: ser + wr, dirtyChunks });
  console.log(
    `  ${String(count).padStart(8)}   ${String(seedChunks).padStart(6)}   ` +
    `${ser.toFixed(0).padStart(7)} ms   ${wr.toFixed(0).padStart(9)} ms   ` +
    `${(ser + wr).toFixed(0).padStart(9)} ms`
  );
  db.close();
}

const worst = rows[rows.length - 1];
const first = rows[0];
console.log(`
At ${worst.count.toLocaleString()} invoices one sale now costs ${worst.total.toFixed(0)} ms
against ${first.total.toFixed(0)} ms at 500 — a factor of ${(worst.total / first.total).toFixed(1)},
where the single-blob format cost 74x more at the same size.

Rows touched per save: ${worst.dirtyChunks} (the appended chunk plus the manifest),
independently of how many years the shop has been open.
`);

fs.rmSync(dir, { recursive: true, force: true });
