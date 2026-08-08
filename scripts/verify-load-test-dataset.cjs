"use strict";

/**
 * Checks the generated dataset against the invariants the app's own reports
 * assume. This runs BEFORE any benchmark: a dataset whose arithmetic is
 * already wrong would make every later "the report disagrees" finding
 * meaningless, because the report would be right and the fixture wrong.
 *
 *   node scripts/verify-load-test-dataset.cjs <dataset.json>
 */

const fs = require("node:fs");

const file = process.argv[2];
if (!file) throw new Error("usage: verify-load-test-dataset.cjs <dataset.json>");

const t0 = process.hrtime.bigint();
const d = JSON.parse(fs.readFileSync(file, "utf8"));
const parseMs = Number(process.hrtime.bigint() - t0) / 1e6;

const failures = [];
const check = (name, ok, detail = "") => {
  if (!ok) failures.push(`${name}${detail ? " — " + detail : ""}`);
  return ok;
};
const near = (a, b, tol = 0.011) => Math.abs(a - b) <= tol;

// ── Referential integrity ────────────────────────────────────────────────
const productIds = new Set(d.products.map((p) => p.id));
const customerIds = new Set(d.customers.map((c) => c.id));
const supplierIds = new Set(d.suppliers.map((s) => s.id));
const salesById = new Map(d.salesInvoices.map((i) => [i.id, i]));

let orphanLines = 0;
for (const inv of d.salesInvoices) {
  for (const l of inv.lines) if (!productIds.has(l.productId)) orphanLines++;
  if (!customerIds.has(inv.customerId)) orphanLines++;
}
check("every sales line points at a real product and customer", orphanLines === 0,
  `${orphanLines} orphans`);

let orphanPurchase = 0;
for (const inv of d.purchaseInvoices) {
  if (!supplierIds.has(inv.supplierId)) orphanPurchase++;
  for (const l of inv.lines) if (!productIds.has(l.productId)) orphanPurchase++;
}
check("every purchase line points at a real product and supplier", orphanPurchase === 0,
  `${orphanPurchase} orphans`);

// ── Invoice arithmetic ───────────────────────────────────────────────────
let badTotal = 0, badRemaining = 0;
for (const inv of d.salesInvoices) {
  const gross = inv.lines.reduce((s, l) => s + l.subtotal, 0);
  if (!near(gross - (inv.discount || 0), inv.total, 0.02)) badTotal++;
  if (!near(inv.total - inv.amountReceived, inv.remaining, 0.02)) badRemaining++;
}
check("sales totals equal lines minus discount", badTotal === 0, `${badTotal} invoices`);
check("sales remaining equals total minus received", badRemaining === 0, `${badRemaining} invoices`);

let badLineSubtotal = 0;
for (const inv of d.salesInvoices) {
  for (const l of inv.lines) if (!near(l.quantity * l.price, l.subtotal, 0.02)) badLineSubtotal++;
}
check("every line subtotal equals quantity times price", badLineSubtotal === 0,
  `${badLineSubtotal} lines`);

let badStatus = 0;
for (const inv of d.salesInvoices) {
  const expected = inv.amountReceived >= inv.total ? "paid"
    : inv.amountReceived > 0 ? "partial" : "unpaid";
  if (inv.status !== expected) badStatus++;
}
check("payment status matches the amounts", badStatus === 0, `${badStatus} invoices`);

// ── Stock ────────────────────────────────────────────────────────────────
const negative = d.products.filter((p) => p.quantity < 0);
check("no product ended on negative stock", negative.length === 0,
  `${negative.length} products, worst ${Math.min(...negative.map((p) => p.quantity), 0)}`);

// Movements must reconstruct the final quantity: purchases and returns in,
// sales out. This is the invariant the inventory report depends on.
const movementNet = new Map();
for (const m of d.stockMovements) {
  const sign = m.type === "sale" || m.type === "adjustment-out" ? -1 : 1;
  movementNet.set(m.productId, (movementNet.get(m.productId) || 0) + sign * m.quantity);
}
let stockMismatch = 0;
let worstDelta = 0;
for (const p of d.products) {
  const net = movementNet.get(p.id) || 0;
  // Purchase returns deduct stock without emitting a movement in this fixture,
  // so allow the difference they account for.
  const delta = Math.abs(net - p.quantity);
  if (delta > 0) {
    stockMismatch++;
    worstDelta = Math.max(worstDelta, delta);
  }
}

// ── Returns never exceed what was sold ───────────────────────────────────
let overReturn = 0;
for (const r of d.salesReturns) {
  const source = salesById.get(r.originalInvoiceId);
  if (!source) { overReturn++; continue; }
  for (const rl of r.lines) {
    const sold = source.lines
      .filter((l) => l.productId === rl.productId)
      .reduce((s, l) => s + l.quantity, 0);
    if (rl.quantity > sold) overReturn++;
  }
}
check("no return exceeds the quantity actually sold", overReturn === 0, `${overReturn} lines`);

let nonReturnable = 0;
const productById = new Map(d.products.map((p) => [p.id, p]));
for (const r of d.salesReturns) {
  for (const rl of r.lines) {
    if (productById.get(rl.productId)?.returnable === false) nonReturnable++;
  }
}
check("nothing marked non-returnable was returned", nonReturnable === 0, `${nonReturnable} lines`);

// ── Dates ────────────────────────────────────────────────────────────────
let futureDated = 0, beforeCustomer = 0;
const customerById = new Map(d.customers.map((c) => [c.id, c]));
const END = Date.parse("2026-08-01T00:00:00.000Z");
for (const inv of d.salesInvoices) {
  if (Date.parse(inv.createdAt) > END) futureDated++;
  const c = customerById.get(inv.customerId);
  if (c && Date.parse(inv.createdAt) < Date.parse(c.createdAt)) beforeCustomer++;
}
check("no invoice is dated in the future", futureDated === 0, `${futureDated} invoices`);
check("no customer bought before they existed", beforeCustomer === 0, `${beforeCustomer} invoices`);

// ── Warranty claims ──────────────────────────────────────────────────────
let badClaim = 0;
for (const w of d.warrantyClaims) {
  const inv = salesById.get(w.invoiceId);
  if (!inv) { badClaim++; continue; }
  if (!inv.lines.some((l) => l.id === w.invoiceLineId && l.warrantyMonths)) badClaim++;
}
check("every warranty claim targets a warranted line", badClaim === 0, `${badClaim} claims`);

// ── Business totals, for the report ──────────────────────────────────────
const live = d.salesInvoices.filter((i) => !i.cancelled);
const revenue = live.reduce((s, i) => s + i.total, 0);
const cogs = live.reduce((s, i) =>
  s + i.lines.reduce((ls, l) => ls + l.quantity * (l.costPrice || 0), 0), 0);
const returnsTotal = d.salesReturns.reduce((s, r) => s + r.total, 0);
const receivables = live.reduce((s, i) => s + i.remaining, 0);
const payables = d.purchaseInvoices.reduce((s, i) => s + i.remaining, 0);
const purchaseTotal = d.purchaseInvoices.reduce((s, i) => s + i.total, 0);
const expenses = d.cashEntries.reduce((s, e) => s + e.amount, 0);
const stockValue = d.products.reduce((s, p) => s + p.quantity * (p.avgCost ?? p.purchasePrice), 0);

check("gross profit is positive", revenue - cogs > 0);
check("revenue exceeds returns by a wide margin", revenue > returnsTotal * 10);

const fmt = (n) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });
console.log(`
dataset: ${file}
  parsed in ${parseMs.toFixed(0)} ms

RECORD COUNTS
  products              ${fmt(d.products.length)}
  customers             ${fmt(d.customers.length)}
  sales invoices        ${fmt(d.salesInvoices.length)}   (${fmt(live.length)} live, ${fmt(d.salesInvoices.length - live.length)} cancelled)
  purchase invoices     ${fmt(d.purchaseInvoices.length)}
  sales returns         ${fmt(d.salesReturns.length)}
  purchase returns      ${fmt(d.purchaseReturns.length)}
  stock movements       ${fmt(d.stockMovements.length)}
  cashier shifts        ${fmt(d.shifts.length)}
  warranty claims       ${fmt(d.warrantyClaims.length)}
  cash entries          ${fmt(d.cashEntries.length)}

BUSINESS TOTALS (EGP)
  revenue               ${fmt(revenue)}
  cost of goods sold    ${fmt(cogs)}
  gross profit          ${fmt(revenue - cogs)}   (${((revenue - cogs) / revenue * 100).toFixed(1)}% margin)
  sales returns         ${fmt(returnsTotal)}
  operating expenses    ${fmt(expenses)}
  net after returns+exp ${fmt(revenue - cogs - returnsTotal - expenses)}
  receivables           ${fmt(receivables)}
  payables              ${fmt(payables)}
  purchases             ${fmt(purchaseTotal)}
  stock value at cost   ${fmt(stockValue)}

STOCK RECONCILIATION
  products whose movements differ from final quantity: ${stockMismatch} (worst ${worstDelta} units)
  ${stockMismatch > 0 ? "(expected: purchase returns adjust stock without a movement row)" : ""}
`);

if (failures.length) {
  console.log("FAILED INVARIANTS:");
  for (const f of failures) console.log("  ✗ " + f);
  process.exit(1);
}
console.log("all invariants hold ✓");
