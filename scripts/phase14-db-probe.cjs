"use strict";

// Independent, read-only Phase 14 inspector. It deliberately accepts only
// databases below the isolated Phase 14 work directory.
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Database = require("better-sqlite3-multiple-ciphers");
const { machineIdSync } = require("node-machine-id");

const root = path.resolve(__dirname, "..");
const allowedRoots = ["phase-14", "phase-14a", "phase-14b"].map((phase) =>
  path.join(root, "reports", "production-hardening-2026-09", phase),
);
if (process.env.PARTFLOW_PHASE14_WORK_ROOT) {
  allowedRoots.push(path.resolve(process.env.PARTFLOW_PHASE14_WORK_ROOT));
}
const dbPath = path.resolve(process.argv[2] || "");
const outputPath = path.resolve(process.argv[3] || "");
if (!allowedRoots.some((allowed) => dbPath.startsWith(`${allowed}${path.sep}`)) || !outputPath) {
  throw new Error("PHASE14_ISOLATED_DATABASE_AND_OUTPUT_REQUIRED");
}

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
let machine;
try { machine = machineIdSync(true); }
catch {
  machine = sha256([os.hostname(), os.platform(), os.arch(), os.cpus()?.[0]?.model || "cpu"]
    .filter(Boolean).join("|"));
}

const prefix = "autoparts_inventory_v1::";
const db = new Database(dbPath, { readonly: true, fileMustExist: true });
db.pragma(`key="x'${sha256(`autoparts-inventory-system-v1-local-license:db:${machine}`)}'"`);

function readKey(key) {
  return db.prepare("SELECT value FROM kv_store WHERE key=?").get(`${prefix}${key}`)?.value ?? null;
}

function getCollectionChunks(name) {
  const raw = readKey(name);
  if (raw === '"__partflow_chunked__"') {
    const meta = JSON.parse(readKey(`${name}#meta`) || "{}");
    return Array.from({ length: Number(meta.chunks) || 0 }, (_, index) =>
      JSON.parse(readKey(`${name}#${String(index).padStart(4, "0")}`) || "[]"),
    );
  }
  const parsed = raw ? JSON.parse(raw) : [];
  return [Array.isArray(parsed) ? parsed : []];
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function fileSha256(filePath) {
  const hash = crypto.createHash("sha256");
  const fd = fs.openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let read;
    while ((read = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, read));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

const names = [
  "products", "customers", "suppliers", "users", "branches", "branchStocks",
  "salesInvoices", "purchaseInvoices", "salesReturns", "purchaseReturns",
  "cashEntries", "stockMovements", "stockTransfers", "quotations", "stocktakes",
  "shifts", "customerVehicles", "warrantyClaims", "deliveryOrders",
];
const collections = {};
const productIds = new Set();
const branchIds = new Set();
const invoiceNumbers = new Set();
const invoiceIds = new Set();
const invariants = {
  duplicateSalesInvoiceNumbers: 0,
  duplicateSalesInvoiceIds: 0,
  negativeProductStock: 0,
  negativeBranchStock: 0,
  orphanBranchStockProducts: 0,
  orphanBranchStockBranches: 0,
  salesWithoutLines: 0,
  nonFiniteFinancialValues: 0,
};
for (const name of names) {
  let count = 0;
  let quantity = 0;
  let total = 0;
  let remaining = 0;
  let balance = 0;
  let amount = 0;
  const contentHash = crypto.createHash("sha256");
  const idsHash = crypto.createHash("sha256");
  for (const chunk of getCollectionChunks(name)) {
    for (const row of chunk) {
      count += 1;
      quantity += Number(row?.quantity) || 0;
      total += Number(row?.total) || 0;
      remaining += Number(row?.remaining) || 0;
      balance += Number(row?.balance) || 0;
      amount += Number(row?.amount) || 0;
      const normalized = name === "branchStocks"
        ? (() => { const copy = { ...row }; delete copy.updatedAt; return canonical(copy); })()
        : canonical(row);
      contentHash.update(JSON.stringify(normalized));
      contentHash.update("\n");
      if (row?.id) {
        idsHash.update(String(row.id));
        idsHash.update("\n");
      }
      if (name === "products") {
        productIds.add(row.id);
        if (Number(row.quantity) < 0) invariants.negativeProductStock += 1;
      }
      if (name === "branches") branchIds.add(row.id);
      if (name === "branchStocks") {
        if (Number(row.quantity) < 0) invariants.negativeBranchStock += 1;
        if (!productIds.has(row.productId)) invariants.orphanBranchStockProducts += 1;
        if (!branchIds.has(row.branchId)) invariants.orphanBranchStockBranches += 1;
      }
      if (name === "salesInvoices") {
        const number = String(row.invoiceNumber || "");
        if (number && invoiceNumbers.has(number)) invariants.duplicateSalesInvoiceNumbers += 1;
        if (number) invoiceNumbers.add(number);
        if (row.id && invoiceIds.has(row.id)) invariants.duplicateSalesInvoiceIds += 1;
        if (row.id) invoiceIds.add(row.id);
        if (!Array.isArray(row.lines) || row.lines.length === 0) invariants.salesWithoutLines += 1;
      }
      if (["salesInvoices", "purchaseInvoices", "cashEntries"].includes(name) &&
        ["total", "remaining", "amountReceived", "amount"].some((field) => row[field] !== undefined && !Number.isFinite(Number(row[field])))) {
        invariants.nonFiniteFinancialValues += 1;
      }
    }
  }
  collections[name] = {
    count,
    sha256: contentHash.digest("hex"),
    idsSha256: idsHash.digest("hex"),
    quantity: Number(quantity.toFixed(6)),
    total: Number(total.toFixed(6)),
    remaining: Number(remaining.toFixed(6)),
    balance: Number(balance.toFixed(6)),
    amount: Number(amount.toFixed(6)),
  };
}

const projectionRaw = readKey("queryProjectionVersion");
const result = {
  capturedAt: new Date().toISOString(),
  database: dbPath,
  bytes: fs.statSync(dbPath).size,
  sha256: fileSha256(dbPath),
  sqliteVersion: db.prepare("SELECT sqlite_version() AS value").get().value,
  cipherVersion: db.pragma("cipher_version", { simple: true }),
  journalMode: db.pragma("journal_mode", { simple: true }),
  synchronous: db.pragma("synchronous", { simple: true }),
  integrityCheck: db.pragma("integrity_check", { simple: true }),
  cipherIntegrityCheck: db.pragma("cipher_integrity_check"),
  projectionVersion: projectionRaw ? JSON.parse(projectionRaw) : null,
  collections,
  invariants,
  businessInvariantStatus: Object.values(invariants).every((value) => value === 0) ? "PASS" : "FAIL",
};
db.close();
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({
  outputPath,
  integrityCheck: result.integrityCheck,
  cipherIntegrityFailures: result.cipherIntegrityCheck.length,
  businessInvariantStatus: result.businessInvariantStatus,
  counts: Object.fromEntries(Object.entries(collections).map(([name, value]) => [name, value.count])),
})}\n`);
// This probe may be launched by the Electron executable when the local binary
// has ELECTRON_RUN_AS_NODE disabled. All work above is synchronous, so exit
// explicitly instead of leaving Electron's application event loop alive.
setImmediate(() => process.exit(0));
