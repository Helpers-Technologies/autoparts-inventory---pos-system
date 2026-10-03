"use strict";

const crypto = require("node:crypto");
const os = require("node:os");
const fs = require("node:fs");
const Database = require("better-sqlite3-multiple-ciphers");
const { machineIdSync } = require("node-machine-id");

const dbPath = process.argv[2];
if (!dbPath) throw new Error("usage: profile-startup-sql.cjs <database>");

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
let machine;
try { machine = machineIdSync(true); }
catch {
  machine = sha256([os.hostname(), os.platform(), os.arch(), os.cpus()?.[0]?.model || "cpu"]
    .filter(Boolean).join("|"));
}

const db = new Database(dbPath, { readonly: true, fileMustExist: true });
try {
  db.pragma(`key="x'${sha256(`autoparts-inventory-system-v1-local-license:db:${machine}`)}'"`);
  if (process.argv.includes("--integrity-only")) {
    process.stdout.write(`${JSON.stringify({
      database: dbPath,
      integrityCheck: db.pragma("integrity_check", { simple: true }),
      cipherIntegrityCheck: db.pragma("cipher_integrity_check"),
    })}\n`);
    process.exitCode = 0;
    return;
  }
  const query = (purpose, sql, params) => {
    const statement = db.prepare(sql);
    const plans = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params);
    const samples = [];
    let rows = 0;
    for (let index = 0; index < 5; index += 1) {
      const started = performance.now();
      const result = statement.all(...params);
      samples.push(Number((performance.now() - started).toFixed(3)));
      rows = result.length;
    }
    return { purpose, sql, rows, samplesMs: samples, plan: plans.map((row) => row.detail) };
  };

  const storageRows = db.prepare(
    "SELECT key, length(value) AS bytes FROM kv_store WHERE key LIKE ?",
  ).all("autoparts_inventory_v1::%");
  const collectionBytes = {};
  for (const row of storageRows) {
    const short = row.key.slice("autoparts_inventory_v1::".length);
    const name = short.split("#", 1)[0];
    collectionBytes[name] = (collectionBytes[name] || 0) + row.bytes;
  }

  const output = {
    database: dbPath,
    bytes: fs.statSync(dbPath).size,
    sqliteVersion: db.prepare("SELECT sqlite_version() AS version").get().version,
    cipherVersion: db.pragma("cipher_version", { simple: true }),
    integrityCheck: db.pragma("integrity_check", { simple: true }),
    journalMode: db.pragma("journal_mode", { simple: true }),
    synchronous: db.pragma("synchronous", { simple: true }),
    indexes: db.prepare("SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'index' ORDER BY name").all(),
    collectionBytes: Object.entries(collectionBytes)
      .map(([name, bytes]) => ({ name, bytes }))
      .sort((left, right) => right.bytes - left.bytes),
    queries: [
      query("startup storage batch", "SELECT key, value FROM kv_store WHERE key LIKE ?", ["autoparts_inventory_v1::%"]),
      query("single settings/user/auth key", "SELECT value FROM kv_store WHERE key = ?", ["autoparts_inventory_v1::users"]),
      query("lazy collection load", "SELECT key, value FROM kv_store WHERE key = ? OR key LIKE ?", ["autoparts_inventory_v1::stockMovements", "autoparts_inventory_v1::stockMovements#%"]),
    ],
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
} finally {
  db.close();
}
