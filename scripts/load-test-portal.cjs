"use strict";

/**
 * Hits the live portal the way a real shop and its phones do, at three-year
 * scale: a full commerce snapshot upload, the mobile read endpoints under
 * concurrency, and the rate limiters. Read-only against production data except
 * for the snapshot, which belongs to the licence passed in and overwrites only
 * that shop's own mirror.
 *
 *   node scripts/load-test-portal.cjs <dataset.json> <APLIC-token>
 */

const fs = require("node:fs");
const crypto = require("node:crypto");

const [datasetPath, token] = process.argv.slice(2);
if (!datasetPath || !token) {
  throw new Error("usage: load-test-portal.cjs <dataset.json> <APLIC-token>");
}
const BASE = process.env.PORTAL_BASE || "https://license.helpers-tech.com";
const ms = (s) => Number(process.hrtime.bigint() - s) / 1e6;
const median = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
const pct = (a, p) => a.slice().sort((x, y) => x - y)[Math.floor(a.length * p)];

/** Retries on transport failure — connections to this host intermittently
 *  stall on setup (the same behaviour that made the desktop's one-shot health
 *  check report a healthy portal as down). A load test that dies on the first
 *  stalled connect measures the network, not the server. Retries are counted
 *  and reported rather than hidden. */
let transportRetries = 0;
async function call(path, { method = "GET", body, auth = token, attempts = 3 } = {}) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    const start = process.hrtime.bigint();
    try {
      const res = await fetch(`${BASE}${path}`, {
        method,
        headers: {
          Accept: "application/json",
          ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body } : {}),
        signal: AbortSignal.timeout(180_000),
      });
      const text = await res.text();
      return { status: res.status, took: ms(start), text, bytes: Buffer.byteLength(text) };
    } catch (error) {
      lastError = error;
      transportRetries++;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  return { status: 0, took: 0, text: String(lastError?.message || lastError), bytes: 0 };
}

(async () => {
  const d = JSON.parse(fs.readFileSync(datasetPath, "utf8"));

  console.log(`\nportal: ${BASE}\n`);

  // ── 1. Full snapshot upload ────────────────────────────────────────────
  const minor = (n) => Math.max(0, Math.round(Number(n || 0) * 100));
  const milli = (n) => Math.max(0, Math.round(Number(n || 0) * 1000));
  const customerStats = new Map();
  for (const inv of d.salesInvoices) {
    if (inv.cancelled) continue;
    const s = customerStats.get(String(inv.customerId)) ||
      { balanceMinor: 0, orderCount: 0, totalSpentMinor: 0 };
    s.orderCount++; s.totalSpentMinor += minor(inv.total); s.balanceMinor += minor(inv.remaining);
    customerStats.set(String(inv.customerId), s);
  }
  const payload = {
    snapshotVersion: 1,
    products: d.products.map((p) => ({
      id: String(p.id), code: p.code, name: p.name, partNumber: p.partNumber,
      brand: p.partBrand, category: p.category, quantityMilli: milli(p.quantity),
      minStockMilli: milli(p.minStock), retailPriceMinor: minor(p.retailPrice),
      costMinor: minor(p.avgCost ?? p.purchasePrice), archived: Boolean(p.archived),
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
        status: inv.status, paymentType: inv.paymentType, totalMinor: minor(inv.total),
        receivedMinor: minor(inv.amountReceived), remainingMinor: minor(inv.remaining),
        discountMinor: minor(inv.discount),
        costMinor: lines.reduce((s, l) => s + Math.round(l.costMinor * l.quantityMilli / 1000), 0),
        itemCount: lines.reduce((s, l) => s + Math.max(0, Math.round(l.quantityMilli / 1000)), 0),
        cancelled: Boolean(inv.cancelled), lines, createdAt: inv.createdAt,
      };
    }),
  };
  const body = JSON.stringify(payload);
  payload.datasetHash = crypto.createHash("sha256").update(body).digest("hex");
  const finalBody = JSON.stringify(payload);

  console.log("1. COMMERCE SNAPSHOT UPLOAD");
  console.log(`   payload ${(Buffer.byteLength(finalBody) / 1048576).toFixed(1)} MB ` +
    `(${d.products.length} products, ${d.customers.length} customers, ${d.salesInvoices.length} orders)`);
  const up = await call("/api/v1/sync/snapshot", { method: "POST", body: finalBody });
  console.log(`   -> ${up.status} in ${(up.took / 1000).toFixed(1)}s  ${up.status === 200 ? "" : up.text.slice(0, 200)}`);

  // ── 2. Mobile read endpoints, now backed by that data ──────────────────
  console.log("\n2. MOBILE READ ENDPOINTS (what the phone loads)");
  for (const path of [
    "/api/v1/me/commerce/dashboard?days=30",
    "/api/v1/me/commerce/alerts",
    "/api/v1/me/commerce/products?page=1&pageSize=30",
    "/api/v1/me/commerce/customers?page=1&pageSize=30",
    "/api/v1/me/commerce/orders?page=1&pageSize=30",
    "/api/v1/me/commerce/search?q=" + encodeURIComponent("فلتر"),
  ]) {
    const r = await call(path);
    console.log(`   ${String(r.status).padStart(3)}  ${(r.took).toFixed(0).padStart(6)} ms  ` +
      `${(r.bytes / 1024).toFixed(0).padStart(6)} KB  ${path.split("?")[0]}`);
  }

  // ── 3. Deep pagination — the page nobody tests ─────────────────────────
  console.log("\n3. DEEP PAGINATION (page 300 of orders)");
  const deep = await call("/api/v1/me/commerce/orders?page=300&pageSize=30");
  console.log(`   ${deep.status} in ${deep.took.toFixed(0)} ms`);

  // ── 4. Concurrency: several phones at once ─────────────────────────────
  console.log("\n4. CONCURRENCY — 12 simultaneous dashboard loads");
  const started = process.hrtime.bigint();
  const settled = await Promise.all(
    Array.from({ length: 12 }, () => call("/api/v1/me/commerce/dashboard?days=30")));
  const wall = ms(started);
  const oks = settled.filter((r) => r.status === 200).length;
  const times = settled.map((r) => r.took);
  console.log(`   ${oks}/12 succeeded, wall ${wall.toFixed(0)} ms, ` +
    `median ${median(times).toFixed(0)} ms, slowest ${Math.max(...times).toFixed(0)} ms`);
  const limited = settled.filter((r) => r.status === 429).length;
  if (limited) console.log(`   ${limited} were rate-limited (429) — the limiter is doing its job`);

  // ── 5. Sustained read load ─────────────────────────────────────────────
  console.log("\n5. SUSTAINED LOAD — 60 sequential alert polls");
  const samples = [];
  let rateLimited = 0;
  for (let i = 0; i < 60; i++) {
    const r = await call("/api/v1/me/commerce/alerts");
    if (r.status === 429) rateLimited++; else samples.push(r.took);
  }
  console.log(`   ${samples.length} served, ${rateLimited} rate-limited`);
  if (samples.length) {
    console.log(`   median ${median(samples).toFixed(0)} ms, p95 ${pct(samples, 0.95).toFixed(0)} ms, ` +
      `slowest ${Math.max(...samples).toFixed(0)} ms`);
  }

  console.log(`\nTRANSPORT
   connections that had to be retried: ${transportRetries}`);
  console.log("");
})();
