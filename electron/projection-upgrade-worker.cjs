"use strict";

const { parentPort, workerData } = require("node:worker_threads");
const Database = require("better-sqlite3-multiple-ciphers");
const projection = require("./query-projection.cjs");

let database;

function send(type, payload = {}) {
  parentPort.postMessage({ type, ...payload, workerRssBytes: process.memoryUsage().rss });
}

try {
  database = new Database(workerData.dbPath);
  database.pragma(`key="x'${workerData.dbKeyHex}'"`);
  database.pragma("journal_mode = WAL");
  database.pragma("busy_timeout = 15000");
  const result = projection.runUpgrade(database, {
    runId: workerData.runId,
    onProgress: (progress) => {
      send("progress", { progress });
      const test = workerData.testInterrupt;
      if (test && progress.state === test.state && Number(progress.percent) >= Number(test.minPercent || 0)) process.exit(93);
    },
  });
  database.pragma("wal_checkpoint(PASSIVE)");
  send("complete", { result });
} catch (error) {
  send("failed", {
    error: String(error?.message || "projection_upgrade_failed").slice(0, 500),
    stack: String(error?.stack || "").slice(0, 4000),
  });
  process.exitCode = 1;
} finally {
  try { database?.close(); } catch { /* best effort */ }
}
