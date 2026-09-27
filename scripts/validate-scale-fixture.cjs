"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { loadFixtureBundle } = require("./fixture-bundle.cjs");

const file = process.argv[2];
const summaryIndex = process.argv.indexOf("--summary-out");
const summaryOut = summaryIndex >= 0 ? process.argv[summaryIndex + 1] : "";
if (!file) throw new Error("usage: validate-scale-fixture.cjs <dataset.json> [--summary-out FILE]");

const started = process.hrtime.bigint();
const dataset = loadFixtureBundle(file);
const metadata = dataset._fixtureMetadata || {};
const expected = metadata.config || {};
const checks = [];
const check = (name, ok, actual, requirement) => checks.push({ name, ok: Boolean(ok), actual, requirement });
const rows = (name) => Array.isArray(dataset[name]) ? dataset[name] : [];
const count = (name) => rows(name).length;

check("generator version recorded", typeof metadata.generatorVersion === "string", metadata.generatorVersion, "non-empty version");
check("fixed seed recorded", Number.isSafeInteger(metadata.seed), metadata.seed, "integer seed");
check("sales target reached", count("salesInvoices") >= expected.salesInvoices * 0.99,
  count("salesInvoices"), `>= ${Math.floor(expected.salesInvoices * 0.99)}`);
check("named fixture minimum reached", count("salesInvoices") >= expected.minimumSalesInvoices,
  count("salesInvoices"), `>= ${expected.minimumSalesInvoices}`);
check("purchase target approximately reached",
  count("purchaseInvoices") >= expected.purchaseInvoiceEvents * 0.95,
  count("purchaseInvoices"), `>= ${Math.floor(expected.purchaseInvoiceEvents * 0.95)}`);
check("customers target reached", count("customers") === expected.customers, count("customers"), expected.customers);
check("products target reached", count("products") === expected.products, count("products"), expected.products);
check("suppliers target reached", count("suppliers") === expected.suppliers, count("suppliers"), expected.suppliers);
check("three to five branches", count("branches") >= 3 && count("branches") <= 5, count("branches"), "3..5");
check("returns represented", count("salesReturns") > 0 && count("purchaseReturns") > 0,
  { sales: count("salesReturns"), purchases: count("purchaseReturns") }, "> 0 each");
check("cash entries represented", count("cashEntries") > count("salesInvoices"), count("cashEntries"), "> sales invoices");
check("stock movements represented", count("stockMovements") > count("salesInvoices") * 4,
  count("stockMovements"), "> 4 per sales invoice");
check("branch stock and transfers represented", count("branchStocks") > 0 && count("stockTransfers") > 0,
  { branchStocks: count("branchStocks"), transfers: count("stockTransfers") }, "> 0 each");
check("users and permissions represented", rows("users").some((u) => u.role === "owner") &&
  rows("users").some((u) => u.role === "employee") && rows("users").every((u) => u.permissions),
  rows("users").map((u) => u.role), "owner + employee; permissions on all");
check("customer and supplier dues represented",
  rows("salesInvoices").some((i) => i.remaining > 0) && rows("purchaseInvoices").some((i) => i.remaining > 0),
  {
    customerDueInvoices: rows("salesInvoices").filter((i) => i.remaining > 0).length,
    supplierDueInvoices: rows("purchaseInvoices").filter((i) => i.remaining > 0).length,
  }, "> 0 each");
check("nonnegative product stock", rows("products").every((p) => Number(p.quantity) >= 0),
  rows("products").filter((p) => Number(p.quantity) < 0).length, "0 negative products");

const lineBuckets = { "1": 0, "2-3": 0, "4-6": 0, "7-15": 0, other: 0 };
for (const invoice of rows("salesInvoices")) {
  const n = Array.isArray(invoice.lines) ? invoice.lines.length : 0;
  if (n === 1) lineBuckets["1"]++;
  else if (n >= 2 && n <= 3) lineBuckets["2-3"]++;
  else if (n >= 4 && n <= 6) lineBuckets["4-6"]++;
  else if (n >= 7 && n <= 15) lineBuckets["7-15"]++;
  else lineBuckets.other++;
}
const totalSales = Math.max(1, count("salesInvoices"));
const distribution = Object.fromEntries(Object.entries(lineBuckets)
  .map(([bucket, value]) => [bucket, value / totalSales]));
for (const [bucket, target] of Object.entries({ "1": 0.20, "2-3": 0.40, "4-6": 0.30, "7-15": 0.10 })) {
  check(`sales line distribution ${bucket}`, Math.abs(distribution[bucket] - target) <= 0.02,
    Number((distribution[bucket] * 100).toFixed(2)), `${target * 100}% +/- 2pp`);
}
check("no out-of-range sales line counts", lineBuckets.other === 0, lineBuckets.other, 0);

let earliest = Infinity;
let latest = -Infinity;
for (const invoice of rows("salesInvoices")) {
  const time = Date.parse(invoice.createdAt || invoice.date);
  if (!Number.isFinite(time)) continue;
  if (time < earliest) earliest = time;
  if (time > latest) latest = time;
}
const spanYears = Number.isFinite(earliest) && Number.isFinite(latest)
  ? (latest - earliest) / (365 * 86400000) : 0;
check("multi-year distribution", spanYears >= Math.max(2, Number(expected.years || 0) - 0.25),
  Number(spanYears.toFixed(2)), `>= ${Math.max(2, Number(expected.years || 0) - 0.25)} years`);

if (expected.salesInvoices >= 200000) {
  check("200K cash-entry floor", count("cashEntries") >= 250000, count("cashEntries"), ">= 250000");
  check("200K stock-movement floor", count("stockMovements") >= 1000000, count("stockMovements"), ">= 1000000");
}

const failures = checks.filter((item) => !item.ok);
const summary = {
  file: path.resolve(file),
  valid: failures.length === 0,
  validationMs: Number(process.hrtime.bigint() - started) / 1e6,
  peakRssBytes: process.resourceUsage().maxRSS * 1024,
  metadata,
  counts: Object.fromEntries(Object.keys(dataset).filter((key) => Array.isArray(dataset[key]))
    .map((key) => [key, dataset[key].length])),
  lineBuckets,
  lineDistribution: distribution,
  spanYears,
  checks,
};
if (summaryOut) {
  fs.mkdirSync(path.dirname(path.resolve(summaryOut)), { recursive: true });
  fs.writeFileSync(summaryOut, `${JSON.stringify(summary, null, 2)}\n`);
}
for (const item of checks) console.log(`${item.ok ? "PASS" : "FAIL"} ${item.name}: ${JSON.stringify(item.actual)}`);
console.log(`${failures.length ? "FAILED" : "PASSED"}: ${checks.length - failures.length}/${checks.length} scale checks`);
if (failures.length) process.exitCode = 1;
