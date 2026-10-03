"use strict";

const fs = require("node:fs");
const os = require("node:os");
const crypto = require("node:crypto");
const Database = require("better-sqlite3-multiple-ciphers");
const { machineIdSync } = require("node-machine-id");

const dbPath = process.argv[2];
if (!dbPath || !fs.existsSync(dbPath)) throw new Error("usage: phase12b-storage-audit.cjs <database>");
const material = (() => {
  try { return machineIdSync(true); }
  catch { return crypto.createHash("sha256").update([os.hostname(), os.platform(), os.arch(), os.cpus()?.[0]?.model || "cpu"].join("|")).digest("hex"); }
})();
const key = crypto.createHash("sha256").update(`autoparts-inventory-system-v1-local-license:db:${material}`).digest("hex");
const db = new Database(dbPath, { readonly: true });
db.pragma(`key="x'${key}'"`);
const rows = db.prepare(`
  SELECT name, SUM(pgsize) bytes, COUNT(*) pages
  FROM dbstat
  GROUP BY name
  ORDER BY bytes DESC
`).all();
const counts = db.prepare(`
  SELECT entity, COUNT(*) count FROM pf_query_records GROUP BY entity ORDER BY count DESC
`).all();
process.stdout.write(`${JSON.stringify({ dbPath, bytes: fs.statSync(dbPath).size, rows, counts }, null, 2)}\n`);
db.close();
