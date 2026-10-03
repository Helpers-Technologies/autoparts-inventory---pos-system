"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Database = require("better-sqlite3-multiple-ciphers");
const { machineIdSync } = require("node-machine-id");
const queryProjection = require("../electron/query-projection.cjs");

const root = path.resolve(__dirname, "..");
const allowed = path.join(root, "reports", "production-hardening-2026-09", "phase-14b");
const dbPath = path.resolve(process.argv[2] || "");
if (!dbPath.startsWith(`${allowed}${path.sep}`)) throw new Error("PHASE14B_DATABASE_REQUIRED");
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
let machine;
try { machine = machineIdSync(true); }
catch { machine = sha256([os.hostname(), os.platform(), os.arch(), os.cpus()?.[0]?.model || "cpu"].join("|")); }
const db = new Database(dbPath, { readonly: true, fileMustExist: true });
db.pragma(`key="x'${sha256(`autoparts-inventory-system-v1-local-license:db:${machine}`)}'"`);
const rows = db.prepare("SELECT entity,version,canonical_count,canonical_updated_at,completed_at FROM pf_query_projection_meta ORDER BY entity").all();
const completion = db.prepare("SELECT * FROM pf_projection_completion").all();
const canonical = db.prepare("SELECT substr(key,length('autoparts_inventory_v1::')+1) key,updated_at FROM kv_store WHERE key LIKE 'autoparts_inventory_v1::%#meta' ORDER BY key").all();
const snapshot = queryProjection.projectionSourceSnapshot(db);
const markerByEntity = new Map(rows.map((row) => [row.entity, row]));
const sourceStatus = snapshot.map((source) => {
  const marker = markerByEntity.get(source.entity);
  return { ...source, markerCount: marker?.canonical_count ?? null, markerUpdatedAt: marker?.canonical_updated_at ?? null,
    current: Boolean(marker && marker.version === queryProjection.VERSION && marker.canonical_count === source.count && marker.canonical_updated_at === source.updatedAt) };
});
process.stdout.write(`${JSON.stringify({ rows, completion, canonical, sourceStatus }, null, 2)}\n`);
db.close();
setImmediate(() => process.exit(0));
