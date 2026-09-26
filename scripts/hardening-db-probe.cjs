// Runs using Electron's Node ABI against synthetic, isolated databases only.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const Database = require('better-sqlite3-multiple-ciphers');
const work = path.resolve(__dirname, '../reports/production-hardening-2026-09');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const prefix = 'autoparts_inventory_v1::';
const [operation, file, out] = process.argv.slice(2);
const target = path.resolve(file);
if (!target.startsWith(work + path.sep)) throw new Error('ISOLATED_HARDENING_DB_REQUIRED');
let machine;
try { machine = require('node-machine-id').machineIdSync(true); }
catch { machine = sha([os.hostname(), os.platform(), os.arch(), os.cpus()?.[0]?.model || 'cpu'].filter(Boolean).join('|')); }
const db = new Database(target, { fileMustExist: true });
db.pragma(`key="x'${sha('autoparts-inventory-system-v1-local-license:db:' + machine)}'"`);
function get(name) {
  const raw = db.prepare('SELECT value FROM kv_store WHERE key=?').get(prefix + name)?.value;
  if (raw === '"__partflow_chunked__"') {
    const meta = get(name + '#meta');
    return Array.from({ length: meta.chunks }, (_, i) => get(name + '#' + String(i).padStart(4, '0'))).flat();
  }
  return raw ? JSON.parse(raw) : null;
}
function put(name, value) {
  db.prepare('INSERT INTO kv_store(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at')
    .run(prefix + name, JSON.stringify(value), new Date().toISOString());
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
if (operation === 'branches' || operation === 'branch-workflows' || operation === 'mobile') {
  db.transaction(() => {
    const product = { ...get('products')[0], id: 'audit-product', code: 'AUDIT001', name: 'قطعة اختبار التدقيق', quantity: 10, archived: false };
    const customer = { ...get('customers')[0], id: 'walkin', name: 'عميل نقدي للاختبار', archived: false };
    if (operation !== 'branches') { delete product.piecesPerUnit; product.looseQuantity = 0; }
    db.prepare('DELETE FROM kv_store WHERE key LIKE ?').run(prefix + 'mobileStockOpReceipts%');
    for (const name of ['products', 'customers', 'salesInvoices', 'purchaseInvoices', 'salesReturns', 'purchaseReturns', 'cashEntries', 'stockMovements', 'branchStocks', 'stockTransfers', 'branches', 'auditLogs', 'quotations', 'stocktakes', 'shifts', 'customerVehicles', 'warrantyClaims']) {
      db.prepare('DELETE FROM kv_store WHERE key LIKE ?').run(prefix + name + '#%');
      put(name, []);
    }
    put('products', [product]);
    put('branches', [{ id: 'branch-main', code: 'MAIN', name: 'Main', isMain: true, createdAt: '2026-01-01T00:00:00Z' }, { id: 'branch-other', code: 'OTHER', name: 'Other', isMain: false, createdAt: '2026-01-01T00:00:00Z' }]);
    if (operation !== 'branches') {
      put('branches', get('branches').map(branch => ({ ...branch, active: true })));
      put('customers', [customer]);
    }
    put('branchStocks', [{ branchId: 'branch-main', productId: product.id, quantity: 3 }, { branchId: 'branch-other', productId: product.id, quantity: 7 }]);
    put('autoPartsStarterCatalogVersion', 3);
    if (operation === 'mobile') {
      const settings = get('settings');
      put('settings', { ...settings, features: { ...settings.features, mobileCompanion: true } });
    }
  })();
} else if (operation === 'permissions' || operation === 'permissions-sales') {
  const users = get('users');
  const owner = users.find(user => user.role === 'owner');
  if (!owner?.passwordHash) throw new Error('FIXTURE_OWNER_REQUIRED');
  const actions = {
    pos: ['view','createSale','openShift','closeShift','viewShifts','supervisorOverride','applyDiscount','holdCart'],
    products: ['view','add','edit','delete','printBarcode'], inventory: ['view','adjust','stocktakes','transfers'],
    purchaseInvoices: ['view','add','edit','pay','delete','purchasingAssistant'],
    salesInvoices: ['view','add','edit','receive','cancel','delete'],
    customers: ['view','add','edit','delete'], suppliers: ['view','add','edit','delete','commissions'],
    drivers: ['view','add','edit','delete'], returns: ['view','add','approve'], alerts: ['view'],
    cashbox: ['view','add','spend','editOpeningBalance'], reports: ['view','analytics','export'],
  };
  const salesEmployee = operation === 'permissions-sales';
  const permissions = Object.fromEntries(Object.entries(actions).map(([module, names]) => [module, Object.fromEntries(names.map(name => [name, false]))]));
  if (salesEmployee) {
    permissions.pos.view = true; permissions.pos.createSale = true; permissions.pos.openShift = true; permissions.pos.closeShift = true;
    permissions.products.view = true; permissions.inventory.view = true;
    permissions.salesInvoices.view = true; permissions.salesInvoices.add = true;
    permissions.customers.view = true; permissions.cashbox.view = true;
    put('autoPartsStarterCatalogVersion', 3);
  }
  put('users', [...users.filter(user => user.id !== 'denied-user' && user.id !== 'sales-user'), {
    id: salesEmployee ? 'sales-user' : 'denied-user', username: salesEmployee ? 'salesemployee' : 'denied', name: salesEmployee ? 'Sales employee fixture' : 'Denied employee fixture', role: 'employee',
    passwordHash: owner.passwordHash, createdAt: '2026-01-01T00:00:00Z',
    permissions,
  }]);
} else if (operation === 'inspect') {
  const result = { at: new Date().toISOString(), file: target, integrity: db.pragma('integrity_check'), permissionProbe: get('auditPermissionProbe'), collections: {} };
  for (const name of ['products', 'customers', 'branches', 'branchStocks', 'salesInvoices', 'cashEntries', 'stockMovements', 'shifts', 'salesReturns', 'purchaseReturns', 'stockTransfers', 'stocktakes']) {
    const value = get(name);
    const rows = Array.isArray(value) ? value : [];
    const normalized = rows.map(row => {
      if (name === 'branchStocks') { const copy = { ...row }; delete copy.updatedAt; return canonical(copy); }
      return canonical(row);
    }).map(JSON.stringify).sort();
    result.collections[name] = { count: rows.length, sha256: sha(JSON.stringify(normalized)), quantity: rows.reduce((sum, row) => sum + (Number(row.quantity) || 0), 0), total: rows.reduce((sum, row) => sum + (Number(row.total) || 0), 0), idsSha256: sha(JSON.stringify(rows.map(row => row.id).sort())), ...(name === 'branchStocks' && rows.length < 20 ? { rows } : {}) };
  }
  const receipts = db.prepare('SELECT value FROM kv_store WHERE key LIKE ? ORDER BY key').all(prefix + 'mobileStockOpReceipts#%').map(row => JSON.parse(row.value));
  result.collections.mobileStockOpReceipts = { count: receipts.length, sha256: sha(JSON.stringify(receipts.map(canonical).map(JSON.stringify).sort())), rows: receipts };
  const mobileAudit = (get('auditLogs') || []).filter(row => row.action === 'stock_adjusted');
  result.collections.mobileStockAudit = { count: mobileAudit.length, sha256: sha(JSON.stringify(mobileAudit.map(canonical).map(JSON.stringify).sort())) };
  fs.writeFileSync(out, JSON.stringify(result, null, 2));
} else throw new Error('UNKNOWN_PROBE_OPERATION');
db.close();
