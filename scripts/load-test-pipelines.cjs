"use strict";

/**
 * The three shipped pipelines that have to chew the whole shop at once:
 *
 *   1. the commerce snapshot uploaded to the portal (what the phone reads)
 *   2. the encrypted cloud archive (the paid backup)
 *   3. the dashboard / report aggregations the owner opens every morning
 *
 * All three are O(everything), so they are where a three-year shop hurts.
 *
 *   ELECTRON_RUN_AS_NODE=1 npx electron scripts/load-test-pipelines.cjs <dataset.json>
 */

const fs = require("node:fs");
const crypto = require("node:crypto");
const {
  encryptBackupWithPassphrase,
  decryptBackupWithPassphrase,
} = require("../electron/backup-crypto.cjs");

const datasetPath = process.argv[2];
if (!datasetPath) throw new Error("usage: load-test-pipelines.cjs <dataset.json>");

const ms = (s) => Number(process.hrtime.bigint() - s) / 1e6;
const mb = (n) => (n / 1048576).toFixed(1) + " MiB";
const failures = [];
function time(label, fn) {
  const s = process.hrtime.bigint();
  const v = fn();
  const took = ms(s);
  console.log(`  ${label.padEnd(52)} ${took.toFixed(0).padStart(7)} ms`);
  return { v, took };
}

const d = JSON.parse(fs.readFileSync(datasetPath, "utf8"));
const milli = (n) => Math.max(0, Math.round(Number(n || 0) * 1000));
const minor = (n) => Math.max(0, Math.round(Number(n || 0) * 100));

console.log(`\n1. COMMERCE SNAPSHOT — built and uploaded to the portal on a timer\n`);

const { v: snapshot } = time("build snapshot from full history", () => {
  const customerStats = new Map();
  for (const inv of d.salesInvoices) {
    if (inv.cancelled) continue;
    const key = String(inv.customerId || "");
    const stat = customerStats.get(key) || { balanceMinor: 0, orderCount: 0, totalSpentMinor: 0 };
    stat.orderCount += 1;
    stat.totalSpentMinor += minor(inv.total);
    stat.balanceMinor += minor(inv.remaining);
    customerStats.set(key, stat);
  }
  const payload = {
    snapshotVersion: 1,
    products: d.products.map((p) => ({
      id: String(p.id), code: p.code, name: p.name, partNumber: p.partNumber,
      brand: p.partBrand, category: p.category,
      quantityMilli: milli(p.quantity), minStockMilli: milli(p.minStock),
      retailPriceMinor: minor(p.retailPrice), costMinor: minor(p.avgCost ?? p.purchasePrice),
      archived: Boolean(p.archived),
    })),
    customers: d.customers.map((c) => ({
      id: String(c.id), code: c.code, name: c.name, phone: c.phone,
      archived: Boolean(c.archived), createdAt: c.createdAt,
      ...(customerStats.get(String(c.id)) || { balanceMinor: 0, orderCount: 0, totalSpentMinor: 0 }),
    })),
    orders: d.salesInvoices.map((inv) => {
      const lines = inv.lines.map((l) => ({
        productId: String(l.productId), productName: l.productName,
        quantityMilli: milli(l.quantity), priceMinor: minor(l.price), costMinor: minor(l.costPrice),
      }));
      return {
        id: String(inv.id), invoiceNumber: inv.invoiceNumber, date: inv.date,
        customerId: String(inv.customerId), customerName: inv.customerName,
        status: inv.status, paymentType: inv.paymentType,
        totalMinor: minor(inv.total), receivedMinor: minor(inv.amountReceived),
        remainingMinor: minor(inv.remaining), discountMinor: minor(inv.discount),
        costMinor: lines.reduce((s, l) => s + Math.round(l.costMinor * l.quantityMilli / 1000), 0),
        itemCount: lines.reduce((s, l) => s + Math.max(0, Math.round(l.quantityMilli / 1000)), 0),
        cancelled: Boolean(inv.cancelled), lines, createdAt: inv.createdAt,
      };
    }),
  };
  return payload;
});

const { v: snapshotJson } = time("serialize snapshot for upload", () => JSON.stringify(snapshot));
time("hash snapshot (dataset fingerprint)", () =>
  crypto.createHash("sha256").update(snapshotJson).digest("hex"));
console.log(`  ${"upload payload size".padEnd(52)} ${mb(Buffer.byteLength(snapshotJson)).padStart(10)}`);

console.log(`\n2. ENCRYPTED CLOUD ARCHIVE — the paid off-site backup\n`);

const archiveState = {};
for (const [k, v] of Object.entries(d)) archiveState[`autoparts_inventory_v1::${k}`] = v;
const { v: archiveJson } = time("serialize full shop state", () => JSON.stringify(archiveState));
const plaintextBytes = Buffer.byteLength(archiveJson, "utf8");
console.log(`  ${"plaintext size".padEnd(52)} ${mb(plaintextBytes).padStart(10)}`);

// The desktop used to compare this plaintext against 48 MiB before
// compression even started, which rejected shops whose actual upload fitted
// several times over. electron/main.cjs now measures the envelope, like the
// portal does, so the plaintext size is reported here for context only — it is
// no longer a pass/fail gate.
console.log(`  ${"(plaintext is no longer the gate — envelope is)".padEnd(52)} ${"".padStart(10)}`);

const { v: envelope } = time("encrypt (scrypt + AES-256-GCM)", () =>
  encryptBackupWithPassphrase(archiveJson, "load test passphrase"));
const envelopeBytes = Buffer.byteLength(envelope, "utf8");
console.log(`  ${"compressed encrypted envelope size".padEnd(52)} ${mb(envelopeBytes).padStart(10)}`);

const { v: restored } = time("decrypt and verify round-trip", () =>
  decryptBackupWithPassphrase(envelope, "load test passphrase"));
const roundTripOk = restored === archiveJson;
console.log(`  ${"round-trip identical".padEnd(52)} ${String(roundTripOk).padStart(10)}`);
if (!roundTripOk) failures.push("encrypted archive round-trip changed the plaintext");

// One number now, checked by both sides: CLOUD_ARCHIVE_MAX_BYTES in
// electron/main.cjs and MAX_ENVELOPE_BYTES in the portal's cloudState.js.
const MAX_ENVELOPE_BYTES = 48 * 1024 * 1024;
const envelopeFits = envelopeBytes <= MAX_ENVELOPE_BYTES;
console.log(`  ${"within 48 MiB envelope limit (desktop + portal)".padEnd(52)} ${String(envelopeFits).padStart(10)}`);
console.log(`  ${"compression ratio".padEnd(52)} ${(plaintextBytes / envelopeBytes).toFixed(1).padStart(9)}x`);
if (!envelopeFits) {
  failures.push(`archive_too_large: envelope ${mb(envelopeBytes)} exceeds 48 MiB`);
  console.log("  !! upload is rejected — desktop refuses and the portal would 413");
}

console.log(`\n3. DASHBOARD + REPORT AGGREGATIONS — opened every morning\n`);

const live = d.salesInvoices.filter((i) => !i.cancelled);
time("dashboard: revenue, profit, receivables, stock value", () => {
  let revenue = 0, cogs = 0, receivables = 0, stockValue = 0, lowStock = 0;
  for (const inv of live) {
    revenue += inv.total;
    receivables += inv.remaining;
    for (const l of inv.lines) cogs += l.quantity * (l.costPrice || 0);
  }
  for (const p of d.products) {
    stockValue += p.quantity * (p.avgCost ?? p.purchasePrice);
    if (p.quantity <= p.minStock) lowStock++;
  }
  return { revenue, cogs, receivables, stockValue, lowStock };
});

time("monthly profit series (36 months)", () => {
  const byMonth = new Map();
  for (const inv of live) {
    const key = inv.date.slice(0, 7);
    const row = byMonth.get(key) || { revenue: 0, cogs: 0 };
    row.revenue += inv.total;
    for (const l of inv.lines) row.cogs += l.quantity * (l.costPrice || 0);
    byMonth.set(key, row);
  }
  return byMonth;
});

time("top 50 products by revenue", () => {
  const byProduct = new Map();
  for (const inv of live) {
    for (const l of inv.lines) {
      byProduct.set(l.productId, (byProduct.get(l.productId) || 0) + l.subtotal);
    }
  }
  return [...byProduct.entries()].sort((a, b) => b[1] - a[1]).slice(0, 50);
});

time("customer statement: balances for all 15k customers", () => {
  const balances = new Map();
  for (const inv of live) {
    balances.set(inv.customerId, (balances.get(inv.customerId) || 0) + inv.remaining);
  }
  return balances;
});

time("dead stock: nothing sold in 90 days", () => {
  const cutoff = Date.parse("2026-05-03T00:00:00.000Z");
  const lastSold = new Map();
  for (const inv of live) {
    const t = Date.parse(inv.createdAt);
    for (const l of inv.lines) {
      if ((lastSold.get(l.productId) || 0) < t) lastSold.set(l.productId, t);
    }
  }
  return d.products.filter((p) => (lastSold.get(p.id) || 0) < cutoff).length;
});

time("global search across products + customers + invoices", () => {
  const needle = "فلتر";
  let hits = 0;
  for (const p of d.products) if (p.name.includes(needle) || (p.partNumber || "").includes(needle)) hits++;
  for (const c of d.customers) if (c.name.includes(needle) || (c.phone || "").includes(needle)) hits++;
  for (const i of d.salesInvoices) if (i.invoiceNumber.includes(needle) || i.customerName.includes(needle)) hits++;
  return hits;
});

if (failures.length) {
  console.log("\nPIPELINE FAILURES:");
  for (const failure of failures) console.log(`  ✗ ${failure}`);
  process.exitCode = 1;
} else {
  console.log("\nall pipeline validity checks hold ✓");
}
