"use strict";
const { createHash, randomUUID } = require("node:crypto");
const PREFIX = "autoparts_inventory_v1::";
const RECEIPT_PREFIX = `${PREFIX}mobileStockOpReceipts#`;
const TOMBSTONE = '"__partflow_chunked__"';
const ORDER = '"oldest-first-v2-date-id"';
const SIZE = 500;
const receiptKey = id => RECEIPT_PREFIX + createHash("sha256").update(id).digest("hex");

function validateOperations(ops) {
  if (!Array.isArray(ops) || ops.length === 0 || ops.length > 100) throw new Error("invalid_operations");
  for (const op of ops) {
    if (!op || typeof op.clientOpId !== "string" || !op.clientOpId.trim() || op.clientOpId.length > 80 ||
        typeof op.productId !== "string" || !op.productId.trim() || op.productId.length > 100 ||
        !["add", "remove", "count"].includes(op.kind) ||
        !Number.isSafeInteger(op.quantityMilli) || op.quantityMilli < 0 || op.quantityMilli > 100_000_000) {
      throw new Error("invalid_operation");
    }
    for (const [name, limit] of [["note", 500], ["deviceLabel", 120], ["actorName", 120]]) {
      if (op[name] !== undefined && (typeof op[name] !== "string" || op[name].length > limit)) throw new Error("invalid_operation_source");
    }
  }
}

/** All reads, inventory writes and indexed receipts execute in one DB transaction. */
function commitMobileStockOperations({ ops, read, write, transaction, user, now = new Date(), createId = () => String(randomUUID()), failAfter = 0 }) {
  validateOperations(ops);
  const storageRows = {};
  let writes = 0;
  const put = (key, value) => {
    const json = JSON.stringify(value);
    write(key, json);
    if (!key.startsWith(RECEIPT_PREFIX)) storageRows[key] = json;
    writes++;
    if (failAfter > 0 && writes >= failAfter) throw new Error("injected_mobile_commit_failure");
  };
  const collection = name => {
    const key = PREFIX + name, raw = read(key);
    if (raw === null || raw === undefined) return [];
    if (raw !== TOMBSTONE) {
      const rows = JSON.parse(raw);
      if (!Array.isArray(rows)) throw new Error(`invalid_collection:${name}`);
      return rows;
    }
    const meta = JSON.parse(read(key + "#meta"));
    if (!meta || !Number.isInteger(meta.chunks) || meta.chunks < 0 || !Number.isInteger(meta.total) || meta.total < 0) throw new Error(`invalid_manifest:${name}`);
    const rows = [];
    for (let i = 0; i < meta.chunks; i++) {
      const chunk = JSON.parse(read(key + "#" + String(i).padStart(4, "0")));
      if (!Array.isArray(chunk)) throw new Error(`invalid_chunk:${name}`);
      rows.push(...chunk);
    }
    if (rows.length !== meta.total) throw new Error(`incomplete_collection:${name}`);
    return rows;
  };
  const replace = (name, rows) => {
    const key = PREFIX + name;
    const previous = JSON.parse(read(key + "#meta") || "null");
    const chunks = Math.ceil(rows.length / SIZE);
    for (let i = 0; i < chunks; i++) put(key + "#" + String(i).padStart(4, "0"), rows.slice(i * SIZE, (i + 1) * SIZE));
    for (let i = chunks; i < (previous?.chunks ?? 0); i++) put(key + "#" + String(i).padStart(4, "0"), []);
    put(key + "#meta", { chunks, size: SIZE, total: rows.length });
    put(key, "__partflow_chunked__");
  };
  const appendLedger = movements => {
    if (!movements.length) return;
    const key = PREFIX + "stockMovements";
    if (read(key) !== TOMBSTONE || read(key + "#order") !== ORDER) {
      const rows = [...collection("stockMovements"), ...movements].sort((a, b) => {
        const left = Date.parse(a.date), right = Date.parse(b.date);
        if (!Number.isFinite(left) || !Number.isFinite(right)) throw new Error("invalid_chronological_record");
        return left - right || String(a.id ?? "").localeCompare(String(b.id ?? ""), "en");
      });
      replace("stockMovements", rows);
      put(key + "#order", "oldest-first-v2-date-id");
      return;
    }
    const meta = JSON.parse(read(key + "#meta"));
    if (!meta || !Number.isInteger(meta.total) || meta.total < 0 || meta.size !== SIZE || meta.chunks !== Math.ceil(meta.total / SIZE)) throw new Error("invalid_ledger_manifest");
    let index = Math.max(0, meta.chunks - 1);
    let tail = meta.chunks ? JSON.parse(read(key + "#" + String(index).padStart(4, "0"))) : [];
    const expectedLength = meta.chunks ? meta.total - (meta.chunks - 1) * SIZE : 0;
    if (!Array.isArray(tail) || tail.length !== expectedLength) throw new Error("incomplete_ledger_tail");
    for (const movement of movements) {
      if (tail.length === SIZE) { put(key + "#" + String(index).padStart(4, "0"), tail); index++; tail = []; }
      tail.push(movement);
    }
    put(key + "#" + String(index).padStart(4, "0"), tail);
    put(key + "#meta", { chunks: index + 1, size: SIZE, total: meta.total + movements.length });
  };

  return transaction(() => {
    const results = [], newResults = [], movements = [], auditEntries = [];
    let products, branchStocks, branches;
    for (const op of ops) {
      const existing = read(receiptKey(op.clientOpId));
      if (existing) {
        const receipt = JSON.parse(existing);
        if (receipt.clientOpId !== op.clientOpId || !receipt.result) throw new Error("invalid_operation_receipt");
        results.push(receipt.result);
        continue;
      }
      products ??= collection("products");
      const product = products.find(row => row.id === op.productId);
      const quantity = Math.round(op.quantityMilli / 1000);
      let result;
      if (!product) {
        result = { clientOpId: op.clientOpId, status: "rejected", rejectReason: "الصنف مش موجود في المخزون على الكمبيوتر" };
      } else if (op.kind === "remove" && quantity > product.quantity) {
        result = { clientOpId: op.clientOpId, status: "rejected", rejectReason: `المتاح ${product.quantity} ${product.unit} بس — اعمل جرد بدل الخصم`, resultingQuantityMilli: product.quantity * 1000 };
      } else {
        if (!Number.isFinite(product.quantity) || product.quantity < 0) throw new Error("invalid_product_quantity");
        const delta = op.kind === "add" ? quantity : op.kind === "remove" ? -quantity : quantity - product.quantity;
        product.quantity += delta;
        result = { clientOpId: op.clientOpId, status: "applied", appliedDeltaMilli: delta * 1000, resultingQuantityMilli: product.quantity * 1000 };
        if (delta !== 0) {
          branchStocks ??= collection("branchStocks");
          branches ??= collection("branches");
          if (branchStocks.some(row => !Number.isFinite(row.quantity) || row.quantity < 0)) throw new Error("invalid_branch_quantity");
          const mainId = branches.find(branch => branch.isMain)?.id ?? branches[0]?.id ?? "branch_main";
          const rows = branchStocks.filter(row => row.productId === product.id);
          const allocated = rows.reduce((sum, row) => sum + row.quantity, 0);
          const diff = product.quantity - allocated;
          const main = rows.find(row => row.branchId === mainId);
          if (diff > 0) {
            if (main) { main.quantity += diff; main.updatedAt = now.toISOString(); }
            else branchStocks.push({ branchId: mainId, productId: product.id, quantity: diff, updatedAt: now.toISOString() });
          } else {
            let excess = -diff;
            for (const row of [...rows].sort((a, b) => Number(b.branchId === mainId) - Number(a.branchId === mainId))) {
              const removed = Math.min(row.quantity, excess);
              if (removed > 0) { row.quantity -= removed; row.updatedAt = now.toISOString(); excess -= removed; }
            }
          }
          const source = [op.deviceLabel?.trim(), op.actorName?.trim()].filter(Boolean).join(" — ") || "تطبيق الموبايل";
          const label = op.kind === "add" ? "إضافة مخزون بالسكان" : op.kind === "remove" ? "خصم مخزون بالسكان" : `جرد بالسكان (العدّ: ${quantity})`;
          const reason = `${label} — ${source}${op.note?.trim() ? ` · ${op.note.trim()}` : ""}`;
          const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
          movements.push({ id: "mov_" + createId(), productId: product.id, productName: product.name, type: delta >= 0 ? "adjustment-in" : "adjustment-out", quantity: delta, reason, referenceType: "manual", date });
          auditEntries.push({ id: "audit_" + createId(), action: "stock_adjusted", entityLabel: product.name, details: `${delta > 0 ? "+" : ""}${delta} ${product.unit} — ${reason}`, userId: user.id, userName: user.name, timestamp: now.toISOString() });
        }
      }
      put(receiptKey(op.clientOpId), { clientOpId: op.clientOpId, productId: op.productId, kind: op.kind, quantityMilli: op.quantityMilli, result, processedAt: now.toISOString() });
      results.push(result);
      newResults.push(result);
    }
    let auditLogs;
    if (movements.length) {
      replace("products", products);
      put(PREFIX + "branchStocks", branchStocks);
      appendLedger(movements);
      auditLogs = [...auditEntries.reverse(), ...collection("auditLogs")].slice(0, 1000);
      replace("auditLogs", auditLogs);
    }
    return { ok: true, results, newResults, storageRows, ...(movements.length ? { products, branchStocks, auditLogs, movements } : {}) };
  });
}

module.exports = { commitMobileStockOperations, validateOperations, receiptKey, RECEIPT_PREFIX };
