"use strict";

const assert = require("node:assert/strict");
const Database = require("better-sqlite3-multiple-ciphers");
const projection = require("../electron/query-projection.cjs");

const prefix = "autoparts_inventory_v1::";
const entities = Object.keys(projection.ENTITY_CONFIG);

function seed(db, corruptSales = false) {
  db.exec("CREATE TABLE kv_store(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT NOT NULL)");
  const insert = db.prepare("INSERT INTO kv_store VALUES(?,?,?)");
  for (const entity of entities) {
    const rows = entity === "salesInvoices"
      ? [{ id: "s1", invoiceNumber: "INV-1", date: "2026-09-28", customerId: "c1", customerName: "Test", total: 10, amountReceived: 0, remaining: 10, lines: [] }]
      : entity === "customers" ? [{ id: "c1", name: "Test", code: "C-1" }] : [];
    insert.run(`${prefix}${entity}`, '"__partflow_chunked__"', "2026-09-28T00:00:00.000Z");
    insert.run(`${prefix}${entity}#0000`, corruptSales && entity === "salesInvoices" ? "{" : JSON.stringify(rows), "2026-09-28T00:00:00.000Z");
    insert.run(`${prefix}${entity}#meta`, JSON.stringify({ chunks: 1, total: rows.length }), "2026-09-28T00:00:00.000Z");
  }
}

{
  const db = new Database(":memory:");
  seed(db);
  assert.equal(projection.inspectUpgrade(db).state, "REQUIRED");
  const progress = [];
  projection.runUpgrade(db, { onProgress: (event) => progress.push(event) });
  assert.equal(projection.inspectUpgrade(db).state, "NOT_REQUIRED");
  assert.equal(db.prepare("SELECT state FROM pf_projection_upgrade_state WHERE singleton=1").get().state, "COMPLETE");
  assert.ok(progress.length > 4);
  assert.equal(progress.at(-1).percent, 100);
  assert.ok(progress.every((event, index) => index === 0 || event.percent >= progress[index - 1].percent));
  const completedAt = db.prepare("SELECT completed_at FROM pf_projection_completion WHERE singleton=1").get().completed_at;
  assert.equal(projection.adoptCurrentProjection(db).state, "NOT_REQUIRED");
  assert.equal(db.prepare("SELECT completed_at FROM pf_projection_completion WHERE singleton=1").get().completed_at, completedAt);

  db.prepare("UPDATE pf_projection_completion SET source_signature='invalid'").run();
  assert.equal(projection.inspectUpgrade(db).state, "REQUIRED");
  projection.adoptCurrentProjection(db);
  assert.equal(projection.inspectUpgrade(db).state, "NOT_REQUIRED");

  db.prepare("UPDATE pf_query_projection_meta SET version=? WHERE entity='salesInvoices'").run(projection.VERSION - 1);
  db.prepare("UPDATE pf_projection_completion SET version=?").run(projection.VERSION - 1);
  assert.equal(projection.inspectUpgrade(db).state, "REQUIRED");
  projection.runUpgrade(db);
  assert.equal(projection.inspectUpgrade(db).state, "NOT_REQUIRED");

  for (const state of ["PREPARING", "BUILDING", "VALIDATING", "FINALIZING"]) {
    db.prepare("DELETE FROM pf_projection_completion").run();
    projection.writeUpgradeState(db, { state, totalRecords: 1, processedRecords: 0 });
    assert.equal(projection.inspectUpgrade(db).state, "INTERRUPTED");
  }
  projection.runUpgrade(db);
  db.close();
}

{
  const db = new Database(":memory:");
  seed(db, true);
  assert.throws(() => projection.runUpgrade(db));
  assert.equal(projection.inspectUpgrade(db).state, "FAILED");
  assert.equal(db.prepare("SELECT COUNT(*) count FROM pf_projection_completion").get().count, 0);
  db.prepare("UPDATE kv_store SET value='[]' WHERE key=?").run(`${prefix}salesInvoices#0000`);
  db.prepare("UPDATE kv_store SET value=? WHERE key=?").run(JSON.stringify({ chunks: 1, total: 0 }), `${prefix}salesInvoices#meta`);
  projection.runUpgrade(db);
  assert.equal(projection.inspectUpgrade(db).state, "NOT_REQUIRED");
  assert.equal(db.pragma("integrity_check", { simple: true }), "ok");
  db.close();
}

{
  const db = new Database(":memory:");
  seed(db);
  db.exec(`CREATE TABLE pf_catalog_search (
    entity TEXT NOT NULL,
    id TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    code TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    archived INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(entity,id)
  ) WITHOUT ROWID`);
  projection.runUpgrade(db);
  const columns = new Set(db.prepare("PRAGMA table_info(pf_catalog_search)").all().map((row) => row.name));
  assert.ok(columns.has("chunk_index"));
  assert.ok(columns.has("ordinal"));
  assert.equal(projection.inspectUpgrade(db).state, "NOT_REQUIRED");
  assert.equal(projection.recordDetail(db, "customers", "c1").id, "c1");
  assert.equal(db.pragma("integrity_check", { simple: true }), "ok");
  db.close();
}

console.log(JSON.stringify({ ok: true, cases: ["success", "progress", "current-no-op", "old-version", "invalid-marker", "interrupted-states", "failure", "retry", "legacy-catalog-schema"] }));
