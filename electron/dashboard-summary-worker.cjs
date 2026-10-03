"use strict";

const { parentPort, workerData } = require("node:worker_threads");
const Database = require("better-sqlite3-multiple-ciphers");

const STORE_PREFIX = "autoparts_inventory_v1::";
const TOMBSTONE = '"__partflow_chunked__"';

function openStore() {
  const database = new Database(workerData.dbPath, { readonly: true, fileMustExist: true });
  database.pragma(`key="x'${workerData.dbKeyHex}'"`);
  return database;
}

function readCollection(database, name) {
  const base = `${STORE_PREFIX}${name}`;
  const row = database.prepare("SELECT value FROM kv_store WHERE key = ?").get(base);
  if (!row) return [];
  if (row.value !== TOMBSTONE) {
    try { return JSON.parse(row.value); } catch { return []; }
  }
  const metaRow = database.prepare("SELECT value FROM kv_store WHERE key = ?").get(`${base}#meta`);
  if (!metaRow) return [];
  let chunks = 0;
  try { chunks = Number(JSON.parse(metaRow.value).chunks); } catch { return []; }
  if (!Number.isInteger(chunks) || chunks < 0) return [];
  const rows = database.prepare(
    "SELECT key, value FROM kv_store WHERE key LIKE ? AND key NOT LIKE '%#meta' AND key NOT LIKE '%#order' ORDER BY key",
  ).all(`${base}#%`);
  if (rows.length < chunks) return [];
  const result = [];
  try {
    for (const rowValue of rows.slice(0, chunks)) result.push(...JSON.parse(rowValue.value));
    return result;
  } catch { return []; }
}

function summarize(database, permissions) {
  const sales = permissions.sales || permissions.customers ? readCollection(database, "salesInvoices") : [];
  const purchases = permissions.purchases || permissions.suppliers ? readCollection(database, "purchaseInvoices") : [];
  const returns = permissions.sales ? readCollection(database, "salesReturns") : [];
  const cash = permissions.cash ? readCollection(database, "cashEntries") : [];
  const products = readCollection(database, "products");
  const settingsRow = database.prepare("SELECT value FROM kv_store WHERE key = ?").get(`${STORE_PREFIX}settings`);
  let settings = {};
  try { settings = JSON.parse(settingsRow?.value || "{}"); } catch { settings = {}; }
  const now = new Date();
  const dateKey = (date) => String(date || "").slice(0, 10);
  const localDate = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const today = localDate(now);
  const monthStart = `${today.slice(0, 7)}-01`;
  const cutoffDate = new Date(now); cutoffDate.setDate(cutoffDate.getDate() - 90);
  const cutoff = localDate(cutoffDate);
  const validSales = sales.filter((invoice) => !invoice.cancelled);
  const invoiceById = new Map(sales.map((invoice) => [invoice.id, invoice]));
  const validReturns = returns.filter((item) => !invoiceById.get(item.originalInvoiceId)?.cancelled);
  const todayGross = validSales.filter((row) => dateKey(row.date) === today).reduce((sum, row) => sum + Number(row.total || 0), 0);
  const todayReturns = validReturns.filter((row) => dateKey(row.date) === today).reduce((sum, row) => sum + Number(row.total || 0), 0);
  const monthlyInvoices = validSales.filter((row) => dateKey(row.date) >= monthStart);
  const monthlyReturns = validReturns.filter((row) => dateKey(row.date) >= monthStart);
  const productById = new Map(products.map((product) => [product.id, product]));
  let grossProfitMonth = 0;
  for (const invoice of monthlyInvoices) {
    grossProfitMonth -= Number(invoice.discount || 0);
    for (const line of invoice.lines || []) {
      const product = productById.get(line.productId);
      grossProfitMonth += Number(line.subtotal || 0) - Number(line.costPrice ?? product?.avgCost ?? product?.purchasePrice ?? 0) * Number(line.quantity || 0);
    }
  }
  for (const item of monthlyReturns) {
    const original = invoiceById.get(item.originalInvoiceId);
    for (const line of item.lines || []) {
      const source = original?.lines?.find((entry) => entry.id === line.sourceLineId) || original?.lines?.find((entry) => entry.productId === line.productId);
      const product = productById.get(line.productId);
      grossProfitMonth -= Number(line.subtotal || 0) - Number(source?.costPrice ?? product?.avgCost ?? product?.purchasePrice ?? 0) * Number(line.quantity || 0);
    }
  }
  const soldRecently = new Set();
  const top = new Map();
  for (const invoice of validSales) {
    if (dateKey(invoice.date) < cutoff) continue;
    for (const line of invoice.lines || []) {
      soldRecently.add(line.productId);
      const row = top.get(line.productId) || { name: line.productName, revenue: 0, qty: 0 };
      row.revenue += Number(line.subtotal || 0); row.qty += Number(line.quantity || 0); top.set(line.productId, row);
    }
  }
  for (const item of validReturns) {
    if (dateKey(item.date) < cutoff) continue;
    for (const line of item.lines || []) {
      const row = top.get(line.productId) || { name: line.productName, revenue: 0, qty: 0 };
      row.revenue -= Number(line.subtotal || 0); row.qty -= Number(line.quantity || 0); top.set(line.productId, row);
    }
  }
  const activeProducts = products.filter((product) => !product.archived);
  const deadStockValue = activeProducts.filter((product) => Number(product.quantity || 0) > 0 && !soldRecently.has(product.id)).reduce((sum, product) => sum + Number(product.quantity || 0) * Number(product.avgCost ?? product.purchasePrice ?? 0), 0);
  const receivables = sales.reduce((sum, invoice) => sum + (!invoice.cancelled && !invoice.collectOnDelivery ? Number(invoice.remaining || 0) - Number(invoice.overpayment || 0) : 0), 0);
  const payables = purchases.reduce((sum, invoice) => sum + Number(invoice.remaining || 0) - Number(invoice.overpayment || 0), 0);
  const account = validSales.filter((invoice) => Number(invoice.remaining || 0) > 0);
  const overdue = account.filter((invoice) => invoice.paymentDueDate && dateKey(invoice.paymentDueDate) < today).sort((a, b) => String(a.paymentDueDate).localeCompare(String(b.paymentDueDate)));
  const chartData = [];
  for (let offset = 13; offset >= 0; offset -= 1) {
    const day = new Date(now); day.setDate(day.getDate() - offset); const iso = localDate(day);
    chartData.push({
      date: iso.slice(5),
      sales: permissions.sales ? validSales.filter((row) => dateKey(row.date) === iso).reduce((sum, row) => sum + Number(row.total || 0), 0) - validReturns.filter((row) => dateKey(row.date) === iso).reduce((sum, row) => sum + Number(row.total || 0), 0) : 0,
      purchases: permissions.purchases ? purchases.filter((row) => dateKey(row.date) === iso).reduce((sum, row) => sum + Number(row.total || 0), 0) : 0,
    });
  }
  const recentActivity = [
    ...validSales.slice(0, 6).map((row) => ({ id: row.id, title: `بيع قطع · ${row.invoiceNumber}`, sub: [row.customerName, row.vehicleLabel, row.branchName].filter(Boolean).join(" · "), amount: row.total, date: row.date, tone: "green", to: `/sales/${row.id}` })),
    ...purchases.slice(0, 4).map((row) => ({ id: row.id, title: `توريد قطع · ${row.invoiceNumber}`, sub: `${row.supplierName} · ${(row.lines || []).length} بند`, amount: row.total, date: row.date, tone: "blue", to: `/purchases/${row.id}` })),
  ].sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 8);
  return {
    stats: { todaySales: permissions.sales ? todayGross - todayReturns : 0, monthlySales: permissions.sales ? monthlyInvoices.reduce((sum, row) => sum + Number(row.total || 0), 0) - monthlyReturns.reduce((sum, row) => sum + Number(row.total || 0), 0) : 0, grossProfitMonth: permissions.sales ? grossProfitMonth : 0, deadStockValue, receivables: permissions.customers ? receivables : 0, payables: permissions.suppliers ? payables : 0, cashBalance: permissions.cash ? Number(settings.openingBalance || 0) + cash.reduce((sum, row) => sum + Number(row.amount || 0), 0) : 0 },
    accounts: { total: account.reduce((sum, row) => sum + Number(row.remaining || 0), 0), count: account.length, overdueCount: overdue.length, overdueTotal: overdue.reduce((sum, row) => sum + Number(row.remaining || 0), 0), overdue: overdue.slice(0, 8) },
    chartData,
    topProductsByStock: activeProducts.filter((product) => Number(product.quantity || 0) > 0 && !soldRecently.has(product.id)).sort((a, b) => Number(b.quantity || 0) * Number(b.avgCost ?? b.purchasePrice ?? 0) - Number(a.quantity || 0) * Number(a.avgCost ?? a.purchasePrice ?? 0)).slice(0, 5).map((product) => ({ name: product.name, qty: Number(product.quantity || 0) * Number(product.avgCost ?? product.purchasePrice ?? 0) })),
    topSellingProducts: [...top.values()].filter((row) => row.revenue > 0).sort((a, b) => b.revenue - a.revenue).slice(0, 5).map((row) => ({ name: row.name, revenue: row.revenue })),
    recentActivity,
  };
}

let database;
try {
  database = openStore();
  const result = summarize(database, workerData.permissions);
  parentPort.postMessage({ ok: true, result });
} catch (error) {
  parentPort.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
} finally {
  database?.close();
}
