"use strict";

/**
 * Does the ledger still reconcile after the refactor?
 *
 * Reads a real seeded profile with the SHIPPED main-process reader and checks
 * the movements against the invoices that produced them. This is the check
 * that would catch the failure mode the whole refactor risks: a ledger that
 * looks fine, opens fine, and quietly no longer matches the shop's own sales.
 *
 *   ELECTRON_RUN_AS_NODE=1 npx electron scripts/verify-ledger-integrity.cjs <profile-dir>
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const os = require("node:os");
const Database = require("better-sqlite3-multiple-ciphers");
const { machineIdSync } = require("node-machine-id");
const { STORE_PREFIX, isChunkedTombstone, readChunkedCollection } =
  require("../electron/storage-security.cjs");

const profileDir = process.argv[2];
if (!profileDir) throw new Error("usage: verify-ledger-integrity.cjs <profile-dir>");

const APP_SALT = "autoparts-inventory-system-v1-local-license";
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
function machineMaterial() {
  try { return machineIdSync(true); } catch {
    return sha256([os.hostname(), os.platform(), os.arch(), os.cpus()?.[0]?.model || "cpu"]
      .filter(Boolean).join("|"));
  }
}
const dbKey = sha256(`${APP_SALT}:db:${machineMaterial()}`);

const db = new Database(path.join(profileDir, "autoparts-inventory.secure.sqlite"), { readonly: true });
db.pragma(`key="x'${dbKey}'"`);
const storageGet = (k) => {
  const row = db.prepare("SELECT value FROM kv_store WHERE key = ?").get(k);
  return row ? row.value : null;
};
function readJsonKey(name, fallback) {
  const full = `${STORE_PREFIX}${name}`;
  const raw = storageGet(full);
  if (!raw) return fallback;
  if (isChunkedTombstone(raw)) {
    const rebuilt = readChunkedCollection(full, storageGet);
    return rebuilt === null ? fallback : rebuilt;
  }
  try { return JSON.parse(raw); } catch { return fallback; }
}

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!ok) failures++;
};

const movements = readJsonKey("stockMovements", null);
const salesInvoices = readJsonKey("salesInvoices", []);
const purchaseInvoices = readJsonKey("purchaseInvoices", []);
const products = readJsonKey("products", []);

console.log(`\nledger: ${Array.isArray(movements) ? movements.length.toLocaleString() : "UNREADABLE"} movements\n`);

check("the ledger is readable at all", Array.isArray(movements) && movements.length > 0);
if (!Array.isArray(movements)) { db.close(); process.exit(1); }

// Every sale and purchase must have left a trace.
const refs = new Set(movements.map((m) => m.referenceId).filter(Boolean));
const salesWithout = salesInvoices.filter((i) => !i.cancelled && !refs.has(i.id));
const purchasesWithout = purchaseInvoices.filter((i) => !refs.has(i.id));
check("every live sales invoice has movements", salesWithout.length === 0,
  `${salesWithout.length} without`);
check("every purchase invoice has movements", purchasesWithout.length === 0,
  `${purchasesWithout.length} without`);

// No movement may reference something that does not exist. Return movements
// point at the RETURN, not at the invoice it came from, so returns count as
// valid targets too — checking only invoices reported thousands of false
// orphans on a shop with a normal rate of returns.
const salesReturns = readJsonKey("salesReturns", []);
const purchaseReturns = readJsonKey("purchaseReturns", []);
const validTargets = new Set([
  ...salesInvoices, ...purchaseInvoices, ...salesReturns, ...purchaseReturns,
].map((r) => r.id));
const orphans = movements.filter(
  (m) => m.referenceId && m.referenceType !== "manual" && !validTargets.has(m.referenceId));
check("no movement points at a missing invoice or return", orphans.length === 0,
  `${orphans.length} orphans`);

// Every movement must name a real product.
const productIds = new Set(products.map((p) => p.id));
const unknownProduct = movements.filter((m) => !productIds.has(m.productId));
check("every movement names a real product", unknownProduct.length === 0,
  `${unknownProduct.length} unknown`);

// Storage order is INSERTION order, which is what appends depend on — not
// sorted-by-date. A return recorded today against a sale from last year is
// appended at the end and is a date inversion by design. What must hold is
// that the ledger reads back in the order it was written, which the chunk
// tests cover directly; here we only assert the ledger is not REVERSED, which
// is what a botched migration would look like.
const firstDate = movements[0]?.date ?? "";
const lastDate = movements[movements.length - 1]?.date ?? "";
check("oldest-first overall (a failed migration would invert this)",
  String(firstDate) <= String(lastDate), `${firstDate} .. ${lastDate}`);

// No duplicate ids — an append that ran twice would show up here.
const ids = new Set(movements.map((m) => m.id));
check("no duplicated movement", ids.size === movements.length,
  `${movements.length - ids.size} duplicates`);

// Sale movements must match their invoice lines.
let mismatched = 0;
const salesById = new Map(salesInvoices.map((i) => [i.id, i]));
for (const inv of salesInvoices.slice(0, 3000)) {
  if (inv.cancelled) continue;
  const mine = movements.filter((m) => m.referenceId === inv.id && m.type === "sale");
  if (mine.length !== inv.lines.length) { mismatched++; continue; }
  const soldQty = inv.lines.reduce((s, l) => s + l.quantity, 0);
  const movedQty = mine.reduce((s, m) => s + Math.abs(m.quantity), 0);
  if (Math.abs(soldQty - movedQty) > 0.001) mismatched++;
}
check("sale movements match their invoice lines (first 3000)", mismatched === 0,
  `${mismatched} mismatched`);
void salesById;

db.close();
console.log(`\n${failures === 0 ? "LEDGER RECONCILES" : failures + " CHECK(S) FAILED"}\n`);
process.exit(failures === 0 ? 0 : 1);
