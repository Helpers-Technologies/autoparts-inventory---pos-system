"use strict";

const crypto = require("node:crypto");
const os = require("node:os");
const Database = require("better-sqlite3-multiple-ciphers");
const { machineIdSync } = require("node-machine-id");

const dbPath = process.argv[2];
if (!dbPath) throw new Error("usage: phase13b-dependency-audit.cjs <database>");

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
  const prefix = "autoparts_inventory_v1::";
  const wanted = new Set([
    "products", "customers", "salesInvoices", "salesReturns", "cashEntries",
    "quotations", "stockMovements", "branchStocks",
  ]);
  const bytes = Object.fromEntries([...wanted].map((name) => [name, 0]));
  for (const row of db.prepare("SELECT key, length(CAST(value AS BLOB)) bytes FROM kv_store WHERE key LIKE ?").iterate(`${prefix}%`)) {
    const name = String(row.key).slice(prefix.length).split("#", 1)[0];
    if (wanted.has(name)) bytes[name] += Number(row.bytes) || 0;
  }
  const catalogCount = db.prepare("SELECT COUNT(*) count FROM pf_catalog_search WHERE entity=?");
  const recordCount = db.prepare("SELECT COUNT(*) count FROM pf_query_records WHERE entity=?");
  const readValue = db.prepare("SELECT value FROM kv_store WHERE key=?");
  const counts = Object.fromEntries([...wanted].map((name) => {
    const projected = Number(catalogCount.get(name)?.count || 0) + Number(recordCount.get(name)?.count || 0);
    const meta = readValue.get(`${prefix}${name}#meta`);
    if (meta) return [name, Number(JSON.parse(meta.value)?.total || projected)];
    const base = readValue.get(`${prefix}${name}`);
    if (base) {
      const parsed = JSON.parse(base.value);
      if (Array.isArray(parsed)) return [name, parsed.length];
    }
    return [name, projected];
  }));
  process.stdout.write(`${JSON.stringify({ database: dbPath, integrity: db.pragma("integrity_check", { simple: true }), counts, bytes }, null, 2)}\n`);
} finally {
  db.close();
}
