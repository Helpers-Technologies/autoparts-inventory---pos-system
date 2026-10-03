"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { Worker } = require("node:worker_threads");
const Database = require("better-sqlite3-multiple-ciphers");
const { machineIdSync } = require("node-machine-id");
const projection = require("../electron/query-projection.cjs");

(async () => {
  const outIndex = process.argv.indexOf("--out");
  const out = outIndex >= 0 ? path.resolve(process.argv[outIndex + 1]) : null;
  const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
  const material = (() => { try { return machineIdSync(true); } catch { return hash([os.hostname(), os.platform(), os.arch()].join("|")); } })();
  const key = hash(`autoparts-inventory-system-v1-local-license:db:${material}`);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "partflow-phase12c-interrupt-"));
  const base = path.join(root, "base.sqlite");
  const db = new Database(base);
  db.pragma(`rekey="x'${key}'"`);
  db.pragma("journal_mode=WAL");
  db.exec("CREATE TABLE kv_store(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT NOT NULL)");
  const insert = db.prepare("INSERT INTO kv_store VALUES(?,?,?)");
  const prefix = "autoparts_inventory_v1::";
  const chunks = (entity) => {
    if (entity === "salesInvoices") return Array.from({ length: 40 }, (_, chunk) => Array.from({ length: 100 }, (_, index) => ({ id: `s-${chunk}-${index}`, invoiceNumber: `INV-${chunk}-${index}`, date: "2026-09-28", customerId: `c-${index % 100}`, customerName: `Customer ${index % 100}`, total: 10, amountReceived: 5, remaining: 5, lines: [] })));
    if (entity === "stockMovements") return Array.from({ length: 80 }, (_, chunk) => Array.from({ length: 100 }, (_, index) => ({ id: `m-${chunk}-${index}`, date: "2026-09-28", productId: `p-${index % 100}`, type: "sale", quantity: -1, referenceId: `s-${chunk % 40}-${index}` })));
    if (entity === "customers") return [Array.from({ length: 100 }, (_, index) => ({ id: `c-${index}`, name: `Customer ${index}`, code: `C-${index}` }))];
    if (entity === "products") return [Array.from({ length: 100 }, (_, index) => ({ id: `p-${index}`, name: `Product ${index}`, code: `P-${index}` }))];
    return [[]];
  };
  for (const entity of projection.PROJECTION_ENTITIES) {
    const entityChunks = chunks(entity);
    const total = entityChunks.reduce((sum, rows) => sum + rows.length, 0);
    const updatedAt = "2026-09-28T00:00:00.000Z";
    insert.run(`${prefix}${entity}`, '"__partflow_chunked__"', updatedAt);
    entityChunks.forEach((rows, index) => insert.run(`${prefix}${entity}#${String(index).padStart(4, "0")}`, JSON.stringify(rows), updatedAt));
    insert.run(`${prefix}${entity}#meta`, JSON.stringify({ chunks: entityChunks.length, total }), updatedAt);
  }
  db.pragma("wal_checkpoint(TRUNCATE)");
  const fingerprint = hash(JSON.stringify(db.prepare("SELECT key,updated_at,length(value) bytes FROM kv_store ORDER BY key").all()));
  db.close();

  const runWorker = (dbPath, testInterrupt) => new Promise((resolve, reject) => {
    const messages = [];
    const worker = new Worker(path.resolve("electron/projection-upgrade-worker.cjs"), { workerData: { dbPath, dbKeyHex: key, runId: crypto.randomUUID(), testInterrupt } });
    worker.on("message", (message) => messages.push(message));
    worker.on("error", reject);
    worker.on("exit", (code) => resolve({ code, messages }));
  });
  const cases = [
    { name: "early-build", test: { state: "BUILDING", minPercent: 2 } },
    { name: "middle-build", test: { state: "BUILDING", minPercent: 45 } },
    { name: "validation", test: { state: "VALIDATING", minPercent: 92 } },
    { name: "finalization", test: { state: "FINALIZING", minPercent: 98 } },
  ];
  const results = [];
  for (const item of cases) {
    const file = path.join(root, `${item.name}.sqlite`);
    fs.copyFileSync(base, file);
    const interrupted = await runWorker(file, item.test);
    const check = new Database(file);
    check.pragma(`key="x'${key}'"`);
    const interruptedStatus = projection.inspectUpgrade(check);
    const completionRows = check.prepare("SELECT COUNT(*) count FROM pf_projection_completion").get().count;
    const integrity = check.pragma("integrity_check", { simple: true });
    const afterFingerprint = hash(JSON.stringify(check.prepare("SELECT key,updated_at,length(value) bytes FROM kv_store ORDER BY key").all()));
    check.close();
    const retried = await runWorker(file, null);
    const final = new Database(file);
    final.pragma(`key="x'${key}'"`);
    const finalStatus = projection.inspectUpgrade(final);
    const finalIntegrity = final.pragma("integrity_check", { simple: true });
    final.close();
    results.push({
      name: item.name, interruptedExitCode: interrupted.code,
      lastProgress: interrupted.messages.filter((message) => message.type === "progress").at(-1)?.progress,
      interruptedState: interruptedStatus.state, completionRows, integrity,
      canonicalUnchanged: afterFingerprint === fingerprint,
      retryExitCode: retried.code, retryState: finalStatus.state,
      completionValid: finalStatus.completionValid, finalIntegrity,
    });
  }
  const summary = { ok: results.every((row) => row.interruptedExitCode === 93 && row.interruptedState === "INTERRUPTED" && row.completionRows === 0 && row.integrity === "ok" && row.canonicalUnchanged && row.retryExitCode === 0 && row.retryState === "NOT_REQUIRED" && row.completionValid && row.finalIntegrity === "ok"), results };
  if (out) { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, `${JSON.stringify(summary, null, 2)}\n`); }
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) process.exitCode = 1;
})().catch((error) => { console.error(error?.stack || error); process.exitCode = 1; });
