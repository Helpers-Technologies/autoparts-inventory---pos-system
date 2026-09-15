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
if (operation === 'branches') {
  db.transaction(() => {
    const product = { ...get('products')[0], id: 'audit-product', code: 'AUDIT001', name: 'قطعة اختبار التدقيق', quantity: 10, archived: false };
    for (const name of ['products', 'customers', 'salesInvoices', 'purchaseInvoices', 'salesReturns', 'purchaseReturns', 'cashEntries', 'stockMovements', 'branchStocks', 'stockTransfers', 'branches', 'auditLogs', 'quotations', 'stocktakes', 'shifts', 'customerVehicles', 'warrantyClaims']) {
      db.prepare('DELETE FROM kv_store WHERE key LIKE ?').run(prefix + name + '#%');
      put(name, []);
    }
    put('products', [product]);
    put('branches', [{ id: 'branch-main', code: 'MAIN', name: 'Main', isMain: true, createdAt: '2026-01-01T00:00:00Z' }, { id: 'branch-other', code: 'OTHER', name: 'Other', isMain: false, createdAt: '2026-01-01T00:00:00Z' }]);
    put('branchStocks', [{ branchId: 'branch-main', productId: product.id, quantity: 3 }, { branchId: 'branch-other', productId: product.id, quantity: 7 }]);
    put('autoPartsStarterCatalogVersion', 3);
  })();
} else if (operation === 'inspect') {
  const result = { at: new Date().toISOString(), file: target, integrity: db.pragma('integrity_check'), collections: {} };
  for (const name of ['products', 'customers', 'branches', 'branchStocks', 'salesInvoices', 'cashEntries', 'stockMovements', 'shifts', 'salesReturns', 'purchaseReturns', 'stockTransfers']) {
    const value = get(name);
    const rows = Array.isArray(value) ? value : [];
    const normalized = rows.map(row => {
      if (name === 'branchStocks') { const copy = { ...row }; delete copy.updatedAt; return canonical(copy); }
      return canonical(row);
    }).map(JSON.stringify).sort();
    result.collections[name] = { count: rows.length, sha256: sha(JSON.stringify(normalized)), quantity: rows.reduce((sum, row) => sum + (Number(row.quantity) || 0), 0), total: rows.reduce((sum, row) => sum + (Number(row.total) || 0), 0), idsSha256: sha(JSON.stringify(rows.map(row => row.id).sort())), ...(name === 'branchStocks' && rows.length < 20 ? { rows } : {}) };
  }
  fs.writeFileSync(out, JSON.stringify(result, null, 2));
} else throw new Error('UNKNOWN_PROBE_OPERATION');
db.close();
