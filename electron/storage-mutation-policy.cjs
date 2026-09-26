"use strict";
const PREFIX = "autoparts_inventory_v1::";
const CHUNKED = new Set(["salesInvoices", "purchaseInvoices", "stockMovements", "auditLogs", "customers", "products", "salesReturns", "purchaseReturns", "quotations", "shifts", "cashEntries"]);
const ARRAYS = new Set([...CHUNKED, "users", "suppliers", "drivers", "stocktakes", "offlineEmployees", "offlineTransactions", "vehicleMakes", "vehicleModels", "vehicleGenerations", "vehicleEngines", "productFitments", "productAlternatives", "customerVehicles", "warrantyClaims", "branches", "branchStocks", "stockTransfers", "priceTiers", "marketingCampaigns", "marketingContactLog", "shippingProviders", "shippingRates", "deliveryOrders"]);
const OWNER_KEYS = new Set(["users", "settings", "branches", "priceTiers", "offlineEmployees", "offlineTransactions", "shippingProviders", "shippingRates", "marketingCampaigns", "marketingContactLog", "inventory_auto_backup_internal", "inventory_auto_backups_history", "autoPartsStarterCatalogVersion", "vehicleCatalogSchemaVersion"]);
const PREFS = new Set(["sidebarCollapsed", "sidebarOpenGroup", "dashboardCards", "dashboardSections", "whatsNew_lastSeenVersion"]);
const COUNTERS = { nextProductCode: "products", nextSupplierCode: "suppliers", nextCustomerCode: "customers" };
const RULES = {
  products: [["products", "add"], ["products", "edit"], ["products", "delete"], ["inventory", "adjust"], ["purchaseInvoices", "add"], ["purchaseInvoices", "edit"], ["salesInvoices", "add"], ["salesInvoices", "edit"], ["salesInvoices", "cancel"], ["returns", "add"]],
  stockMovements: [["inventory", "adjust"], ["purchaseInvoices", "add"], ["purchaseInvoices", "edit"], ["salesInvoices", "add"], ["salesInvoices", "edit"], ["salesInvoices", "cancel"], ["returns", "add"]],
  branchStocks: [["inventory", "adjust"], ["inventory", "transfers"], ["products", "add"], ["purchaseInvoices", "add"], ["purchaseInvoices", "edit"], ["salesInvoices", "add"], ["salesInvoices", "edit"], ["salesInvoices", "cancel"], ["returns", "add"]],
  stockTransfers: [["inventory", "transfers"]], stocktakes: [["inventory", "stocktakes"], ["inventory", "adjust"]],
  cashEntries: [["cashbox", "add"], ["cashbox", "spend"], ["salesInvoices", "add"], ["salesInvoices", "receive"], ["salesInvoices", "cancel"], ["purchaseInvoices", "add"], ["purchaseInvoices", "pay"], ["returns", "add"], ["returns", "approve"]],
  quotations: [["salesInvoices", "add"], ["salesInvoices", "edit"], ["salesInvoices", "delete"]],
  salesInvoices: [["salesInvoices", "add"], ["salesInvoices", "edit"], ["salesInvoices", "receive"], ["salesInvoices", "cancel"], ["salesInvoices", "delete"]],
  purchaseInvoices: [["purchaseInvoices", "add"], ["purchaseInvoices", "edit"], ["purchaseInvoices", "pay"], ["purchaseInvoices", "delete"]],
  salesReturns: [["returns", "add"], ["returns", "approve"]], purchaseReturns: [["returns", "add"], ["returns", "approve"]], warrantyClaims: [["returns", "add"], ["returns", "approve"]],
  shifts: [["pos", "openShift"], ["pos", "closeShift"], ["pos", "supervisorOverride"]],
  customers: [["customers", "add"], ["customers", "edit"], ["customers", "delete"]], customerVehicles: [["customers", "add"], ["customers", "edit"], ["customers", "delete"]],
  suppliers: [["suppliers", "add"], ["suppliers", "edit"], ["suppliers", "delete"], ["suppliers", "commissions"]], drivers: [["drivers", "add"], ["drivers", "edit"], ["drivers", "delete"]],
  deliveryOrders: [["drivers", "edit"], ["salesInvoices", "add"], ["salesInvoices", "edit"], ["salesInvoices", "receive"], ["salesInvoices", "cancel"]],
};
for (const name of ["vehicleMakes", "vehicleModels", "vehicleGenerations", "vehicleEngines", "productFitments", "productAlternatives", "vehicleCatalogPreferences"]) RULES[name] = [["products", "edit"]];
const has = (user, module, action) => user?.role === "owner" || user?.permissions?.[module]?.[action] === true;
const plain = value => value !== null && typeof value === "object" && !Array.isArray(value);
const equal = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (plain(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
function describeKey(key) {
  if (typeof key !== "string" || !key.startsWith(PREFIX)) return null;
  const [name, suffix, extra] = key.slice(PREFIX.length).split("#");
  if (extra !== undefined || (!ARRAYS.has(name) && !OWNER_KEYS.has(name) && !PREFS.has(name) && !Object.hasOwn(COUNTERS, name) && !RULES[name])) return null;
  if (suffix !== undefined && (!CHUNKED.has(name) || !/^(meta|order|\d{4})$/.test(suffix))) return null;
  return { name, suffix };
}
function mayWriteKey(user, key) {
  const info = describeKey(key);
  if (!user || !info) return false;
  if (user.role === "owner" || PREFS.has(info.name) || info.name === "auditLogs") return true;
  if (OWNER_KEYS.has(info.name)) return false;
  const rules = RULES[info.name] ?? (COUNTERS[info.name] ? [[COUNTERS[info.name], "add"]] : []);
  return rules.some(([module, action]) => has(user, module, action));
}
function validateRow(name, row) {
  if (!plain(row)) throw new Error(`invalid_row:${name}`);
  if (name === "branchStocks") {
    if (typeof row.branchId !== "string" || !row.branchId || typeof row.productId !== "string" || !row.productId || !Number.isFinite(row.quantity) || row.quantity < 0) throw new Error("invalid_branch_stock");
    return;
  }
  if (typeof row.id !== "string" || !row.id || row.id.length > 200) throw new Error(`invalid_id:${name}`);
  if (name === "products" && (!Number.isFinite(row.quantity) || row.quantity < 0 || (row.looseQuantity !== undefined && (!Number.isFinite(row.looseQuantity) || row.looseQuantity < 0)))) throw new Error("invalid_product_quantity");
  if (name === "stockMovements" && (!Number.isFinite(row.quantity) || typeof row.productId !== "string" || !Number.isFinite(Date.parse(row.date)))) throw new Error("invalid_movement");
  if (name === "cashEntries" && (!Number.isFinite(row.amount) || typeof row.type !== "string" || !Number.isFinite(Date.parse(row.date)))) throw new Error("invalid_cash_entry");
  if (name === "auditLogs" && (typeof row.action !== "string" || !row.action || typeof row.userId !== "string" || !row.userId || !Number.isFinite(Date.parse(row.timestamp)))) throw new Error("invalid_audit_entry");
  if (name === "stockTransfers" && (typeof row.fromBranchId !== "string" || typeof row.toBranchId !== "string" || row.fromBranchId === row.toBranchId || typeof row.productId !== "string" || !Number.isFinite(row.quantity) || row.quantity <= 0 || !Number.isFinite(Date.parse(row.date)))) throw new Error("invalid_stock_transfer");
  if (name === "stocktakes" && (!Array.isArray(row.items) || !["draft", "applied"].includes(row.status) || !Number.isFinite(Date.parse(row.date)))) throw new Error("invalid_stocktake");
  if ((name === "salesReturns" || name === "purchaseReturns") && (!Array.isArray(row.lines) || !Number.isFinite(row.total) || row.total < 0 || !Number.isFinite(Date.parse(row.date)))) throw new Error("invalid_return");
  if (name === "shifts" && (typeof row.cashierId !== "string" || !["open", "closed"].includes(row.status) || !Number.isFinite(Date.parse(row.openedAt)) || !Number.isFinite(row.openingCash) || row.openingCash < 0)) throw new Error("invalid_shift");
  if (name === "salesInvoices" || name === "purchaseInvoices" || name === "quotations") {
    if (!Number.isFinite(row.total) || row.total < 0 || !Array.isArray(row.lines) || !Number.isFinite(Date.parse(row.date))) throw new Error("invalid_invoice");
    for (const line of row.lines) if (!plain(line) || typeof line.productId !== "string" || !line.productId || !Number.isFinite(line.quantity) || line.quantity < 0 || !Number.isFinite(line.price) || line.price < 0) throw new Error("invalid_invoice_line");
    for (const field of ["amountReceived", "amountPaid", "remaining", "overpayment"]) if (row[field] !== undefined && (!Number.isFinite(row[field]) || row[field] < 0)) throw new Error("invalid_invoice_balance");
  }
}
function validateValue(info, json) {
  if (typeof json !== "string" || json.length > 32 * 1024 * 1024) throw new Error("invalid_storage_value");
  const value = JSON.parse(json), { name, suffix } = info;
  if (suffix === "meta") {
    if (!plain(value) || value.size !== 500 || !Number.isSafeInteger(value.total) || value.total < 0 || value.chunks !== Math.ceil(value.total / 500)) throw new Error("invalid_manifest");
  } else if (suffix === "order") {
    if (!["oldest-first-v2-date-id", "oldest-first"].includes(value)) throw new Error("invalid_collection_order");
  } else if (ARRAYS.has(name)) {
    if (suffix === undefined && CHUNKED.has(name) && value === "__partflow_chunked__") return value;
    if (!Array.isArray(value)) throw new Error(`invalid_collection:${name}`);
    for (const row of value) validateRow(name, row);
  } else if (name === "sidebarCollapsed") {
    if (typeof value !== "boolean") throw new Error("invalid_preference");
  } else if (name === "sidebarOpenGroup" || name === "whatsNew_lastSeenVersion") {
    if (value !== null && (typeof value !== "string" || value.length > 200)) throw new Error("invalid_preference");
  } else if (Object.hasOwn(COUNTERS, name) || name.endsWith("Version")) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error("invalid_counter");
  } else if (name === "dashboardCards" || name === "inventory_auto_backups_history") {
    if (!Array.isArray(value)) throw new Error("invalid_list");
  } else if (name === "settings") {
    if (!plain(value) || typeof value.companyName !== "string" || typeof value.currency !== "string" || !Number.isFinite(value.openingBalance) || value.openingBalance < 0) throw new Error("invalid_settings");
  } else if (!plain(value)) throw new Error("invalid_object");
  return value;
}
function readCollection(name, read) {
  const key = PREFIX + name, raw = read(key);
  if (raw === null || raw === undefined) return [];
  if (raw !== '"__partflow_chunked__"') {
    const result = JSON.parse(raw);
    if (!Array.isArray(result)) throw new Error("invalid_existing_collection");
    return result;
  }
  const meta = JSON.parse(read(key + "#meta"));
  if (!meta || !Number.isSafeInteger(meta.chunks) || meta.chunks < 0 || !Number.isSafeInteger(meta.total) || meta.total < 0) throw new Error("invalid_existing_manifest");
  const rows = [];
  for (let i = 0; i < meta.chunks; i++) {
    const part = JSON.parse(read(key + "#" + String(i).padStart(4, "0")));
    if (!Array.isArray(part)) throw new Error("invalid_existing_chunk");
    rows.push(...part);
  }
  if (rows.length !== meta.total) throw new Error("incomplete_existing_collection");
  return rows;
}
function changes(before, after, key = row => row.id) {
  const old = new Map(before.map(row => [key(row), row])), next = new Map(after.map(row => [key(row), row]));
  if (next.size !== after.length) throw new Error("duplicate_record_identity");
  return {
    added: after.filter(row => !old.has(key(row))), removed: before.filter(row => !next.has(key(row))),
    edited: after.filter(row => old.has(key(row)) && !equal(row, old.get(key(row)))).map(row => ({ before: old.get(key(row)), after: row })),
  };
}

const AUDIT_RULES = [
  [/^user_(login|logout)$/, "self", "self"],
  [/^user_/, "owner", "owner"], [/^settings_/, "owner", "owner"],
  [/^backup_/, "owner", "owner"], [/^branch_/, "owner", "owner"],
  [/^product_created$/, "products", "add"], [/^product_(updated|archived|restored)$/, "products", "edit"],
  [/^product_deleted$/, "products", "delete"], [/^stock_adjusted$/, "inventory", "adjust"],
  [/^supplier_created$/, "suppliers", "add"], [/^supplier_(updated|archived|restored)$/, "suppliers", "edit"], [/^supplier_deleted$/, "suppliers", "delete"],
  [/^customer_created$/, "customers", "add"], [/^customer_(updated|archived|restored)$/, "customers", "edit"], [/^customer_deleted$/, "customers", "delete"],
  [/^driver_created$/, "drivers", "add"], [/^driver_updated$/, "drivers", "edit"], [/^driver_deleted$/, "drivers", "delete"],
  [/^invoice_purchase_created$/, "purchaseInvoices", "add"], [/^invoice_purchase_updated$/, "purchaseInvoices", "edit"], [/^invoice_purchase_deleted$/, "purchaseInvoices", "delete"],
  [/^invoice_sale_created$/, "salesInvoices", "add"], [/^invoice_sale_updated$/, "salesInvoices", "edit"], [/^invoice_sale_cancelled$/, "salesInvoices", "cancel"], [/^invoice_sale_deleted$/, "salesInvoices", "delete"],
  [/^quotation_created$/, "salesInvoices", "add"], [/^quotation_updated$/, "salesInvoices", "edit"], [/^quotation_deleted$/, "salesInvoices", "delete"],
  [/^return_/, "returns", "add"], [/^shift_opened$/, "pos", "openShift"], [/^shift_closed$/, "pos", "closeShift"],
  [/^cash_manual_add$/, "cashbox", "add"], [/^cash_manual_remove$/, "cashbox", "spend"],
  [/^stock_transfer_created$/, "inventory", "transfers"], [/^warranty_/, "returns", "add"],
  [/^shipping_/, "drivers", "edit"], [/^delivery_/, "drivers", "edit"],
];
function auditAllowed(user, row) {
  if (row.userId !== user.id) return false;
  const rule = AUDIT_RULES.find(([pattern]) => pattern.test(String(row.action || "")));
  if (!rule) return false;
  if (rule[1] === "self") return true;
  if (rule[1] === "owner") return user.role === "owner";
  if (row.action === "invoice_sale_updated") return has(user, "salesInvoices", "edit") || has(user, "salesInvoices", "receive");
  if (row.action === "invoice_purchase_updated") return has(user, "purchaseInvoices", "edit") || has(user, "purchaseInvoices", "pay");
  return has(user, rule[1], rule[2]);
}

function requireAny(user, permissions, error = "permission_denied") {
  if (!permissions.some(([module, action]) => has(user, module, action))) throw new Error(error);
}

function assertAppendOnly(diff, label, allowTrim = false) {
  if (diff.edited.length) throw new Error(`${label}_history_immutable`);
  if (diff.removed.length && (!allowTrim || diff.removed.length > diff.added.length)) throw new Error(`${label}_history_immutable`);
}
function isOnlyLegacyProductNormalization(before, after, fields) {
  const wholesalePrice = before.wholesalePrice ?? before.sellingPrice ?? 0;
  const { sellingPrice: _legacy, wholesalePrice: _wholesale, retailPrice: _retail, ...rest } = before;
  const expected = {
    ...rest,
    partNumber: String(rest.partNumber || "").trim() || String(rest.barcode || "").trim() || rest.code,
    oemNumbers: Array.isArray(rest.oemNumbers) ? rest.oemNumbers.map(value => String(value).trim()).filter(Boolean) : [],
    condition: rest.condition ?? "new",
    wholesalePrice,
    retailPrice: before.retailPrice ?? Math.round(wholesalePrice * 1.12 * 100) / 100,
  };
  return [...fields].filter(field => !["quantity", "looseQuantity"].includes(field)).every(field => equal(after[field], expected[field]));
}

/** Validate logical changes, rather than granting an edit permission to all chunk rows. */
function authorizeStorageBatch(entries, { user, read, normalize = (_key, value) => value }) {
  if (!user || !plain(entries)) throw new Error("not_authorized");
  const inputRows = Object.entries(entries);
  if (inputRows.length === 0 || inputRows.length > 5000) throw new Error("invalid_storage_batch");
  const allowed = {}, names = new Set();
  let totalBytes = 0;
  for (const [key, raw] of inputRows) {
    const info = describeKey(key);
    if (!info) throw new Error("unknown_storage_key");
    if (!mayWriteKey(user, key)) continue; // Routine employee snapshots contain owner-owned collections.
    const value = normalize(key, raw);
    totalBytes += typeof value === "string" ? value.length : 0;
    if (totalBytes > 256 * 1024 * 1024) throw new Error("storage_batch_too_large");
    validateValue(info, value);
    allowed[key] = value;
    if (ARRAYS.has(info.name)) names.add(info.name);
  }
  const projected = key => Object.hasOwn(allowed, key) ? allowed[key] : read(key);
  const datasets = new Map();
  for (const name of names) {
    const before = readCollection(name, read), after = readCollection(name, projected);
    for (const row of after) validateRow(name, row);
    datasets.set(name, { before, after, diff: changes(before, after, name === "branchStocks" ? row => JSON.stringify([row.branchId, row.productId]) : undefined) });
  }
  if (Object.keys(allowed).length === 0) throw new Error("no_authorized_storage_changes");
  if (user.role === "owner") return allowed;
  const changed = name => {
    const diff = datasets.get(name)?.diff;
    return Boolean(diff && (diff.added.length || diff.edited.length || diff.removed.length));
  };
  for (const [name, { diff }] of datasets) {
    const requirePermission = (module, action) => { if (!has(user, module, action)) throw new Error(`permission_denied:${module}:${action}`); };
    if (["products", "customers", "suppliers", "drivers", "customerVehicles"].includes(name)) {
      const module = name === "customerVehicles" ? "customers" : name;
      if (diff.added.length) requirePermission(module, "add");
      if (diff.removed.length) requirePermission(module, "delete");
      for (const edit of diff.edited) {
        if (name !== "products") { requirePermission(module, "edit"); continue; }
        const fields = new Set([...Object.keys(edit.before), ...Object.keys(edit.after)].filter(field => !equal(edit.before[field], edit.after[field])));
        if (["quantity", "looseQuantity"].some(field => fields.has(field))) {
          const coupled =
            (changed("purchaseInvoices") && (has(user, "purchaseInvoices", "add") || has(user, "purchaseInvoices", "edit"))) ||
            (changed("salesInvoices") && (has(user, "salesInvoices", "add") || has(user, "salesInvoices", "edit") || has(user, "salesInvoices", "cancel"))) ||
            ((changed("salesReturns") || changed("purchaseReturns") || changed("warrantyClaims")) && has(user, "returns", "add"));
          const stocktake = changed("stocktakes") && has(user, "inventory", "stocktakes");
          if (!has(user, "inventory", "adjust") && !coupled && !stocktake) throw new Error("permission_denied:inventory:adjust");
        }
        if ([...fields].some(field => !["quantity", "looseQuantity"].includes(field)) && !isOnlyLegacyProductNormalization(edit.before, edit.after, fields)) requirePermission("products", "edit");
      }
    } else if (name === "salesInvoices" || name === "purchaseInvoices" || name === "quotations") {
      const module = name === "quotations" ? "salesInvoices" : name;
      if (diff.added.length) requirePermission(module, "add");
      if (diff.removed.length) requirePermission(module, "delete");
      for (const { before, after } of diff.edited) {
        const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(field => !equal(before[field], after[field]));
        if (name === "salesInvoices" && fields.every(field => ["amountReceived", "remaining", "overpayment", "status", "paymentLog", "updatedAt"].includes(field))) requirePermission(module, "receive");
        else if (name === "purchaseInvoices" && fields.every(field => ["amountPaid", "remaining", "status", "paymentLog", "updatedAt"].includes(field))) requirePermission(module, "pay");
        else if (name === "salesInvoices" && fields.includes("cancelled") && fields.every(field => ["cancelled", "cancelledAt", "cancelReason", "amountReceived", "remaining", "overpayment", "status", "paymentLog", "updatedAt"].includes(field))) requirePermission(module, "cancel");
        else requirePermission(module, "edit");
      }
    } else if (name === "stockMovements") {
      if (diff.edited.length) throw new Error("stock_movement_history_immutable");
      for (const row of diff.removed) {
        if (row.referenceType === "purchase") requirePermission("purchaseInvoices", "delete");
        else if (row.referenceType === "sale") requirePermission("salesInvoices", "delete");
        else throw new Error("stock_movement_history_immutable");
      }
      for (const row of diff.added) {
        if (row.referenceType === "purchase") requireAny(user, [["purchaseInvoices", "add"], ["purchaseInvoices", "edit"], ["returns", "add"]]);
        else if (row.referenceType === "sale") requireAny(user, [["salesInvoices", "add"], ["salesInvoices", "edit"], ["salesInvoices", "cancel"], ["returns", "add"]]);
        else requirePermission("inventory", "adjust");
      }
    } else if (name === "cashEntries") {
      if (diff.edited.length) throw new Error("cash_entry_history_immutable");
      for (const row of diff.added) {
        if (row.type === "manual-add" || (row.type === "adjustment" && row.amount >= 0 && !row.referenceId)) requirePermission("cashbox", "add");
        else if (row.type === "manual-remove" || (row.type === "adjustment" && row.amount < 0 && !row.referenceId)) requirePermission("cashbox", "spend");
        else if (row.type === "sales-receipt") requireAny(user, [["salesInvoices", "add"], ["salesInvoices", "receive"], ["returns", "add"]]);
        else if (row.type === "purchase-payment") requireAny(user, [["purchaseInvoices", "add"], ["purchaseInvoices", "pay"], ["returns", "add"]]);
        else requireAny(user, [["returns", "add"], ["salesInvoices", "cancel"]]);
      }
      if (diff.removed.length) requireAny(user, [["salesInvoices", "delete"], ["purchaseInvoices", "delete"]]);
    } else if (name === "stockTransfers") {
      if (diff.edited.length || diff.removed.length) throw new Error("stock_transfer_immutable");
      if (diff.added.length) requirePermission("inventory", "transfers");
    } else if (name === "branchStocks") {
      if (diff.removed.length) throw new Error("branch_stock_delete_not_allowed");
      if (diff.added.length || diff.edited.length) requireAny(user, [["inventory", "adjust"], ["inventory", "transfers"], ["purchaseInvoices", "add"], ["purchaseInvoices", "edit"], ["salesInvoices", "add"], ["salesInvoices", "edit"], ["salesInvoices", "cancel"], ["returns", "add"]]);
    } else if (name === "stocktakes") {
      if (diff.added.length || diff.edited.length || diff.removed.length) requirePermission("inventory", "stocktakes");
    } else if (name === "salesReturns" || name === "purchaseReturns") {
      if (diff.edited.length || diff.removed.length) throw new Error("return_history_immutable");
      if (diff.added.length) requirePermission("returns", "add");
    } else if (name === "warrantyClaims") {
      if (diff.removed.length) throw new Error("warranty_history_immutable");
      if (diff.added.length) requirePermission("returns", "add");
      if (diff.edited.length) requirePermission("returns", "approve");
    } else if (name === "deliveryOrders") {
      if (diff.removed.length) throw new Error("delivery_history_immutable");
      if (diff.added.length) requireAny(user, [["salesInvoices", "add"], ["drivers", "edit"]]);
      if (diff.edited.length) requireAny(user, [["salesInvoices", "receive"], ["salesInvoices", "cancel"], ["drivers", "edit"]]);
    } else if (name === "shifts") {
      if (diff.removed.length) throw new Error("shift_delete_not_allowed");
      for (const row of diff.added) { requirePermission("pos", "openShift"); if (row.cashierId !== user.id && !has(user, "pos", "supervisorOverride")) throw new Error("shift_scope_denied"); }
      for (const { before, after } of diff.edited) {
        if (before.cashierId !== user.id && !has(user, "pos", "supervisorOverride")) throw new Error("shift_scope_denied");
        if (after.cashierId !== before.cashierId || after.id !== before.id) throw new Error("shift_identity_immutable");
        const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(field => !equal(before[field], after[field]));
        const summaryFields = ["expectedCash", "totalSalesCount", "totalSalesAmount", "totalCashAdditions", "totalCashSales", "totalVisaSales", "totalCreditSales", "paymentMethodTotals", "totalRefunds", "totalExpenses", "salesInvoiceIds"];
        if (before.status === "open" && after.status === "open" && fields.every(field => summaryFields.includes(field))) requirePermission("pos", "createSale");
        else {
          if (before.status !== "open" || after.status !== "closed" || !fields.every(field => ["status", "closedAt", "closingCashActual", "difference", "note", ...summaryFields].includes(field))) throw new Error("invalid_shift_edit");
          requirePermission("pos", "closeShift");
        }
      }
    } else if (name === "auditLogs") {
      assertAppendOnly(diff, "audit", true);
      for (const row of diff.added) if (!auditAllowed(user, row)) throw new Error("audit_action_denied");
    } else if (["vehicleMakes", "vehicleModels", "vehicleGenerations", "vehicleEngines", "productFitments", "productAlternatives"].includes(name)) {
      if (diff.added.length || diff.edited.length || diff.removed.length) requirePermission("products", "edit");
    } else if (!["users", "branches", "priceTiers", "offlineEmployees", "offlineTransactions", "shippingProviders", "shippingRates", "marketingCampaigns", "marketingContactLog"].includes(name)) {
      throw new Error(`unclassified_storage_collection:${name}`);
    }
  }
  return allowed;
}
module.exports = { PREFIX, CHUNKED, ARRAYS, OWNER_KEYS, PREFS, describeKey, mayWriteKey, validateValue, readCollection, changes, equal, authorizeStorageBatch };
