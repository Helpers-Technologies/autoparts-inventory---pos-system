"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { Worker } = require("node:worker_threads");
const { performance } = require("node:perf_hooks");
const Database = require("better-sqlite3-multiple-ciphers");
const { machineIdSync } = require("node-machine-id");
const projection = require("../electron/query-projection.cjs");

(async () => {

const arg = (name) => { const index = process.argv.indexOf(name); return index < 0 ? null : process.argv[index + 1]; };
const source = path.resolve(arg("--db") || "");
const out = path.resolve(arg("--out") || "");
const label = arg("--label") || path.basename(path.dirname(path.dirname(source)));
if (!source || !out || !fs.existsSync(source)) throw new Error("usage: --db <fixture> --out <json>");
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const hashFile = (file) => new Promise((resolve, reject) => {
  const digest = crypto.createHash("sha256");
  fs.createReadStream(file).on("data", (chunk) => digest.update(chunk)).on("error", reject).on("end", () => resolve(digest.digest("hex")));
});
const material = (() => { try { return machineIdSync(true); } catch { return hash([os.hostname(), os.platform(), os.arch(), os.cpus()?.[0]?.model || "cpu"].join("|")); } })();
const key = hash(`autoparts-inventory-system-v1-local-license:db:${material}`);
const root = fs.mkdtempSync(path.join(os.tmpdir(), `partflow-phase12c-${label}-`));
const dbPath = path.join(root, "autoparts-inventory.secure.sqlite");
fs.copyFileSync(source, dbPath);
const sourceBytes = fs.statSync(source).size;
const canonicalHashBefore = await hashFile(source);
const started = performance.now();
let peakDiskBytes = sourceBytes;
let peakMainRssBytes = process.memoryUsage().rss;
let peakWorkerRssBytes = 0;
let maxEventLoopDelayMs = 0;
let lastTick = performance.now();
const progress = [];
const diskBytes = () => ["", "-wal", "-shm"].reduce((sum, suffix) => sum + (fs.existsSync(`${dbPath}${suffix}`) ? fs.statSync(`${dbPath}${suffix}`).size : 0), 0);
const sampler = setInterval(() => {
  const now = performance.now();
  maxEventLoopDelayMs = Math.max(maxEventLoopDelayMs, now - lastTick - 100);
  lastTick = now;
  peakMainRssBytes = Math.max(peakMainRssBytes, process.memoryUsage().rss);
  peakDiskBytes = Math.max(peakDiskBytes, diskBytes());
}, 100);

const worker = new Worker(path.resolve("electron/projection-upgrade-worker.cjs"), {
  workerData: { dbPath, dbKeyHex: key, runId: crypto.randomUUID() },
});
const workerResult = await new Promise((resolve, reject) => {
  let completed;
  worker.on("message", (message) => {
    peakWorkerRssBytes = Math.max(peakWorkerRssBytes, Number(message.workerRssBytes) || 0);
    if (message.type === "progress") progress.push({ atMs: performance.now() - started, ...message.progress });
    if (message.type === "complete") completed = message.result;
    if (message.type === "failed") reject(new Error(message.error));
  });
  worker.on("error", reject);
  worker.on("exit", (code) => code === 0 && completed ? resolve(completed) : reject(new Error(`worker_exit_${code}`)));
});
clearInterval(sampler);
const migrationMs = performance.now() - started;
peakDiskBytes = Math.max(peakDiskBytes, diskBytes());
const db = new Database(dbPath);
db.pragma(`key="x'${key}'"`);
const integrity = db.pragma("integrity_check", { simple: true });
let cipherIntegrity = "unsupported";
try { const rows = db.pragma("cipher_integrity_check"); cipherIntegrity = rows.length ? rows : "ok"; } catch (error) { cipherIntegrity = `unsupported:${error.message}`; }
const status = projection.inspectUpgrade(db);
const canonicalCounts = Object.fromEntries(projection.PROJECTION_ENTITIES.map((entity) => [entity, projection.canonicalState(db, entity).count]));
const noOpStarted = performance.now();
const noOpStatus = projection.adoptCurrentProjection(db);
const currentVersionNoOpMs = performance.now() - noOpStarted;
db.pragma("wal_checkpoint(TRUNCATE)");
db.close();
const finalBytes = fs.statSync(dbPath).size;
const intervals = progress.slice(1).map((row, index) => row.atMs - progress[index].atMs);
const canonicalDb = new Database(dbPath);
canonicalDb.pragma(`key="x'${key}'"`);
const canonicalFingerprint = hash(JSON.stringify(canonicalDb.prepare("SELECT key,updated_at,length(value) bytes FROM kv_store ORDER BY key").all()));
canonicalDb.close();
const result = {
  label, sourceDb: source, isolatedDb: dbPath, sourceBytes, canonicalHashBefore,
  workerResult, migrationMs: Number(migrationMs.toFixed(3)),
  progress: {
    updates: progress.length,
    first: progress[0], last: progress.at(-1),
    maxIntervalMs: Number((intervals.length ? Math.max(...intervals) : 0).toFixed(3)),
    meanIntervalMs: Number((intervals.length ? intervals.reduce((a, b) => a + b, 0) / intervals.length : 0).toFixed(3)),
    monotonic: progress.every((row, index) => index === 0 || row.percent >= progress[index - 1].percent),
    states: [...new Set(progress.map((row) => row.state))],
  },
  memory: {
    peakMainRssMiB: Number((peakMainRssBytes / 1048576).toFixed(1)),
    peakWorkerProcessRssMiB: Number((peakWorkerRssBytes / 1048576).toFixed(1)),
  },
  responsiveness: { maxEventLoopDelayMs: Number(maxEventLoopDelayMs.toFixed(3)), samples: Math.floor(migrationMs / 100) },
  storage: {
    peakBytes: peakDiskBytes, finalBytes,
    temporaryAmplification: Number((peakDiskBytes / sourceBytes).toFixed(3)),
    finalAmplification: Number((finalBytes / sourceBytes).toFixed(3)),
  },
  validation: { status: status.state, completionValid: status.completionValid, integrity, cipherIntegrity, canonicalCounts, canonicalFingerprint },
  currentVersionNoOp: { ms: Number(currentVersionNoOpMs.toFixed(3)), state: noOpStatus.state },
};
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ label, migrationSeconds: Number((migrationMs / 1000).toFixed(3)), progress: result.progress, memory: result.memory, responsiveness: result.responsiveness, storage: result.storage, validation: result.validation, currentVersionNoOp: result.currentVersionNoOp, isolatedDb: dbPath }, null, 2));
})().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
