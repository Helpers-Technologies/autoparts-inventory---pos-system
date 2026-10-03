"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Database = require("better-sqlite3-multiple-ciphers");
const { machineIdSync } = require("node-machine-id");

const root = path.resolve(__dirname, "..");
const canonicalAllowed = path.join(root, "scale-fixtures", "phase-10", "scale-200k", "profile", "autoparts-inventory.secure.sqlite");
const isolatedAllowedRoots = ["phase-14", "phase-14a", "phase-14b"].map((phase) =>
  path.join(root, "reports", "production-hardening-2026-09", phase),
);
if (process.env.PARTFLOW_PHASE14_WORK_ROOT) {
  isolatedAllowedRoots.push(path.resolve(process.env.PARTFLOW_PHASE14_WORK_ROOT));
}
const beforePath = path.resolve(process.argv[2] || "");
const afterPath = path.resolve(process.argv[3] || "");
const outPath = path.resolve(process.argv[4] || "");
const expectedCreatedCount = Number(process.argv[5] || 45);
if (beforePath !== canonicalAllowed || !isolatedAllowedRoots.some((allowed) => afterPath.startsWith(`${allowed}${path.sep}`)) || !outPath || !Number.isInteger(expectedCreatedCount) || expectedCreatedCount < 1) {
  throw new Error("PHASE14_RECONCILIATION_PATHS_REQUIRED");
}

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
let machine;
try { machine = machineIdSync(true); }
catch { machine = sha256([os.hostname(), os.platform(), os.arch(), os.cpus()?.[0]?.model || "cpu"].filter(Boolean).join("|")); }
const key = sha256(`autoparts-inventory-system-v1-local-license:db:${machine}`);
const prefix = "autoparts_inventory_v1::";

function open(file) {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  db.pragma(`key="x'${key}'"`);
  return db;
}
function collection(db, name) {
  const read = (suffix) => db.prepare("SELECT value FROM kv_store WHERE key=?").get(`${prefix}${suffix}`)?.value ?? null;
  const raw = read(name);
  if (raw === '"__partflow_chunked__"') {
    const meta = JSON.parse(read(`${name}#meta`) || "{}");
    return Array.from({ length: Number(meta.chunks) || 0 }, (_, index) =>
      JSON.parse(read(`${name}#${String(index).padStart(4, "0")}`) || "[]"),
    ).flat();
  }
  const parsed = raw ? JSON.parse(raw) : [];
  return Array.isArray(parsed) ? parsed : [];
}
const round = (value) => Number(Number(value).toFixed(6));
const byId = (rows) => new Map(rows.map((row) => [row.id, row]));
const keyed = (rows, key) => new Map(rows.map((row) => [key(row), row]));
const deltaRows = (before, after) => {
  const ids = new Set(before.map((row) => row.id));
  return after.filter((row) => !ids.has(row.id));
};

const before = open(beforePath);
const after = open(afterPath);
const result = { capturedAt: new Date().toISOString(), beforePath, afterPath };
try {
  const beforeSales = collection(before, "salesInvoices");
  const afterSales = collection(after, "salesInvoices");
  const createdSales = deltaRows(beforeSales, afterSales);
  const createdIds = new Set(createdSales.map((row) => row.id));
  const invoiceNumbers = createdSales.map((row) => String(row.invoiceNumber || ""));
  const numberCounts = new Map();
  for (const number of invoiceNumbers) numberCounts.set(number, (numberCounts.get(number) || 0) + 1);
  const numericSuffixes = invoiceNumbers.map((number) => Number(number.match(/(\d+)$/)?.[1])).filter(Number.isFinite).sort((a, b) => a - b);
  const gaps = [];
  for (let index = 1; index < numericSuffixes.length; index += 1) {
    if (numericSuffixes[index] !== numericSuffixes[index - 1] + 1) gaps.push([numericSuffixes[index - 1], numericSuffixes[index]]);
  }
  result.invoices = {
    beforeCount: beforeSales.length,
    afterCount: afterSales.length,
    createdCount: createdSales.length,
    createdIdsSha256: sha256(JSON.stringify([...createdIds].sort())),
    invoiceNumbers,
    uniqueInvoiceNumbers: numberCounts.size,
    duplicateInvoiceNumbers: [...numberCounts].filter(([, count]) => count > 1).map(([number]) => number),
    numericSuffixes,
    unexpectedGaps: gaps,
    totals: {
      total: round(createdSales.reduce((sum, row) => sum + (Number(row.total) || 0), 0)),
      amountReceived: round(createdSales.reduce((sum, row) => sum + (Number(row.amountReceived) || 0), 0)),
      remaining: round(createdSales.reduce((sum, row) => sum + (Number(row.remaining) || 0), 0)),
    },
  };

  const beforeCash = collection(before, "cashEntries");
  const afterCash = collection(after, "cashEntries");
  const createdCash = deltaRows(beforeCash, afterCash);
  const linkedCash = createdCash.filter((row) => createdIds.has(row.referenceId));
  result.cash = {
    beforeCount: beforeCash.length,
    afterCount: afterCash.length,
    createdCount: createdCash.length,
    linkedToCreatedSales: linkedCash.length,
    createdAmount: round(createdCash.reduce((sum, row) => sum + (Number(row.amount) || 0), 0)),
    linkedAmount: round(linkedCash.reduce((sum, row) => sum + (Number(row.amount) || 0), 0)),
    expectedFromSales: result.invoices.totals.amountReceived,
  };

  const beforeMovements = collection(before, "stockMovements");
  const afterMovements = collection(after, "stockMovements");
  const createdMovements = deltaRows(beforeMovements, afterMovements);
  const linkedMovements = createdMovements.filter((row) => createdIds.has(row.referenceId));
  result.ledger = {
    beforeCount: beforeMovements.length,
    afterCount: afterMovements.length,
    createdCount: createdMovements.length,
    linkedToCreatedSales: linkedMovements.length,
    quantity: round(createdMovements.reduce((sum, row) => sum + (Number(row.quantity) || 0), 0)),
    types: Object.fromEntries([...new Set(createdMovements.map((row) => row.type))].map((type) => [type, createdMovements.filter((row) => row.type === type).length])),
  };

  const compareQuantity = (name, key) => {
    const beforeRows = keyed(collection(before, name), key);
    const afterRows = keyed(collection(after, name), key);
    const changes = [];
    for (const [id, afterRow] of afterRows) {
      const beforeRow = beforeRows.get(id);
      const delta = round((Number(afterRow.quantity) || 0) - (Number(beforeRow?.quantity) || 0));
      if (delta !== 0) changes.push({ id, before: Number(beforeRow?.quantity) || 0, after: Number(afterRow.quantity) || 0, delta });
    }
    return { changedRows: changes.length, netDelta: round(changes.reduce((sum, row) => sum + row.delta, 0)), changes };
  };
  result.productStock = compareQuantity("products", (row) => row.id);
  result.branchStock = compareQuantity("branchStocks", (row) => `${row.branchId}::${row.productId}`);

  const beforeCustomers = byId(collection(before, "customers"));
  const afterCustomers = byId(collection(after, "customers"));
  const customerChanges = [];
  for (const [id, row] of afterCustomers) {
    const old = beforeCustomers.get(id);
    const delta = round((Number(row.balance) || 0) - (Number(old?.balance) || 0));
    if (delta !== 0) customerChanges.push({ id, before: Number(old?.balance) || 0, after: Number(row.balance) || 0, delta });
  }
  result.customerBalances = { changedRows: customerChanges.length, netDelta: round(customerChanges.reduce((sum, row) => sum + row.delta, 0)), changes: customerChanges };
  result.reconciliation = {
    invoiceCountMatches: createdSales.length === expectedCreatedCount,
    uniqueNumbers: numberCounts.size === createdSales.length,
    noUnexpectedGaps: gaps.length === 0,
    cashCountMatches: linkedCash.length === createdSales.length,
    cashAmountMatches: Math.abs(result.cash.linkedAmount - result.cash.expectedFromSales) < 0.01,
    ledgerCountMatches: linkedMovements.length === createdSales.reduce((sum, row) => sum + (row.lines?.length || 0), 0),
    globalAndBranchStockMatch: Math.abs(result.productStock.netDelta - result.branchStock.netDelta) < 0.000001,
    customerBalanceExpected: result.invoices.totals.remaining === result.customerBalances.netDelta,
  };
  result.status = Object.values(result.reconciliation).every(Boolean) ? "PASS" : "FAIL";
} finally {
  before.close();
  after.close();
}
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ status: result.status, reconciliation: result.reconciliation, invoices: result.invoices, cash: result.cash, ledger: result.ledger, productStock: result.productStock, branchStock: result.branchStock, customerBalances: result.customerBalances }, null, 2));
