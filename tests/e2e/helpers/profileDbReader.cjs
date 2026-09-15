"use strict";

const crypto = require("node:crypto");
const os = require("node:os");
const Database = require("better-sqlite3-multiple-ciphers");
const { machineIdSync } = require("node-machine-id");

const [dbPath, name] = process.argv.slice(2);
if (!dbPath || !name) throw new Error("usage: profileDbReader.cjs <db> <collection>");
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
let machine;
try { machine = machineIdSync(true); }
catch {
  machine = sha256(
    [os.hostname(), os.platform(), os.arch(), os.cpus()?.[0]?.model || "cpu"]
      .filter(Boolean)
      .join("|"),
  );
}
const prefix = "autoparts_inventory_v1::";
const tombstone = '"__partflow_chunked__"';
const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
};
const db = new Database(dbPath, { readonly: true, fileMustExist: true });
try {
  db.pragma(`key="x'${sha256(`autoparts-inventory-system-v1-local-license:db:${machine}`)}'"`);
  const read = db.prepare("SELECT value FROM kv_store WHERE key = ?");
  const row = (key) => read.get(key)?.value ?? null;
  const plain = row(prefix + name);
  let records = null;
  if (plain !== null && plain !== tombstone) {
    const parsed = JSON.parse(plain);
    if (Array.isArray(parsed)) records = parsed;
  } else {
    const rawMeta = row(`${prefix}${name}#meta`);
    if (rawMeta) {
      const meta = JSON.parse(rawMeta);
      const chunks = Number(meta.chunks);
      if (!Number.isInteger(chunks) || chunks < 0) throw new Error("invalid collection manifest");
      records = [];
      for (let index = 0; index < chunks; index += 1) {
        const raw = row(`${prefix}${name}#${String(index).padStart(4, "0")}`);
        if (raw === null) throw new Error(`missing ${name} chunk ${index}`);
        const part = JSON.parse(raw);
        if (!Array.isArray(part)) throw new Error(`invalid ${name} chunk ${index}`);
        records.push(...part);
      }
      if (Number.isInteger(meta.total) && records.length !== meta.total) {
        throw new Error(`manifest total mismatch for ${name}`);
      }
    }
  }
  const value = records ?? [];
  const normalized = value.map(canonical).map(JSON.stringify).sort();
  const ids = value.map((item) => item && typeof item === "object" ? String(item.id ?? "") : "").sort();
  process.stdout.write(JSON.stringify({
    count: value.length,
    sha256: sha256(JSON.stringify(normalized)),
    idsSha256: sha256(JSON.stringify(ids)),
  }));
} finally {
  db.close();
}
