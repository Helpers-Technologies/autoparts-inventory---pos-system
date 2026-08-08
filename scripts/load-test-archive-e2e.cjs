"use strict";

/**
 * End-to-end proof that a three-year shop can actually use the paid cloud
 * backup: encrypt the real generated state, upload it to the live portal,
 * download it back, and decrypt it to a byte-identical copy.
 *
 * This is the test that would have caught the 48 MB ceiling before a customer
 * did — the unit tests all passed while the feature was unusable, because none
 * of them carried a real shop's worth of data.
 *
 *   ELECTRON_RUN_AS_NODE=1 npx electron scripts/load-test-archive-e2e.cjs <dataset.json> <APLIC-token>
 */

const fs = require("node:fs");
const crypto = require("node:crypto");
const {
  encryptBackupWithPassphraseAsync,
  decryptBackupWithPassphrase,
} = require("../electron/backup-crypto.cjs");

const [datasetPath, token] = process.argv.slice(2);
if (!datasetPath || !token) {
  throw new Error("usage: load-test-archive-e2e.cjs <dataset.json> <APLIC-token>");
}
const BASE = process.env.PORTAL_BASE || "https://license.helpers-tech.com";
const PASSPHRASE = "load test owner passphrase 2026";
const ms = (s) => Number(process.hrtime.bigint() - s) / 1e6;
const mb = (n) => (n / 1048576).toFixed(1) + " MB";

async function call(path, init, attempts = 3) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetch(`${BASE}${path}`, { ...init, signal: AbortSignal.timeout(180_000) });
    } catch (e) { last = e; await new Promise((r) => setTimeout(r, 2000 * (i + 1))); }
  }
  throw last;
}

(async () => {
  const d = JSON.parse(fs.readFileSync(datasetPath, "utf8"));
  const state = {};
  for (const [k, v] of Object.entries(d)) state[`autoparts_inventory_v1::${k}`] = v;
  const plaintext = JSON.stringify({ archiveVersion: 1, state });
  const sourceHash = crypto.createHash("sha256").update(plaintext).digest("hex");

  console.log(`\nfull shop state           ${mb(Buffer.byteLength(plaintext))}`);

  let t = process.hrtime.bigint();
  const envelope = await encryptBackupWithPassphraseAsync(plaintext, PASSPHRASE);
  console.log(`encrypted (gzip+AES-GCM)  ${mb(Buffer.byteLength(envelope))}  in ${ms(t).toFixed(0)} ms`);

  t = process.hrtime.bigint();
  const up = await call("/api/v1/sync/state", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      envelope, sourceHash, keyCount: Object.keys(state).length,
      appVersion: "9.0.0", machineLabel: "load-test",
    }),
  });
  const upBody = await up.text();
  console.log(`upload                    ${up.status} in ${(ms(t) / 1000).toFixed(1)}s`);
  if (up.status !== 200) {
    console.log(`  ${upBody.slice(0, 300)}`);
    process.exit(1);
  }

  t = process.hrtime.bigint();
  const statusRes = await call("/api/v1/sync/state/status", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const status = JSON.parse(await statusRes.text());
  console.log(`status                    ${statusRes.status} in ${ms(t).toFixed(0)} ms  ` +
    `(${mb(status.envelopeBytes || 0)} stored, ${status.keyCount} keys)`);

  t = process.hrtime.bigint();
  const down = await call("/api/v1/sync/state", { headers: { Authorization: `Bearer ${token}` } });
  const payload = JSON.parse(await down.text());
  console.log(`download                  ${down.status} in ${(ms(t) / 1000).toFixed(1)}s`);

  t = process.hrtime.bigint();
  const restored = decryptBackupWithPassphrase(payload.envelope, PASSPHRASE);
  console.log(`decrypt                   ${ms(t).toFixed(0)} ms`);

  const identical = restored === plaintext;
  const hashBack = crypto.createHash("sha256").update(restored).digest("hex");
  console.log(`
VERDICT
  round-trip byte-identical   ${identical}
  source hash preserved       ${payload.sourceHash === sourceHash}
  content hash matches        ${hashBack === sourceHash}
  portal cannot read it       ${!payload.envelope.includes("فلتر")}
  wrong passphrase refused    ${(() => {
    try { decryptBackupWithPassphrase(payload.envelope, "wrong"); return false; } catch { return true; }
  })()}
`);
  process.exit(identical ? 0 : 1);
})();
