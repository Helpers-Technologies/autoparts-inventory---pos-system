import fs from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { native, startApp, stop } from './hardening-critical-baseline.mjs';
const root = process.cwd(), phase = process.env.PARTFLOW_HARDENING_PHASE || 'phase-3';
const work = path.join(root, 'reports/production-hardening-2026-09', phase);
const source = JSON.parse(fs.readFileSync(path.join(root, 'reports/system-audit-2026-09-14/load-small.json'), 'utf8')).sourceDb;
fs.mkdirSync(work, { recursive: true });
const folder = fs.mkdtempSync(path.join(work, 'denied-employee-'));
const db = path.join(folder, 'autoparts-inventory.secure.sqlite');
fs.copyFileSync(source, db);
native('permissions', db);
const result = { db, startedAt: new Date().toISOString(), scope: 'Real authenticated denied employee main-process session; crafted preload calls; renderer UI state is irrelevant' };
let h;
try {
  h = await startApp(db);
  result.calls = await h.page.evaluate(async () => {
    const api = window.desktopAPI;
    await api.auth.logout();
    const login = await api.auth.login('denied', 'stress123');
    const session = await api.auth.getSession();
    const key = 'autoparts_inventory_v1::auditPermissionProbe';
    const write = await api.storage.set(key, JSON.stringify({ writtenBy: 'denied-employee' }));
    const read = await api.storage.getCollection('auditPermissionProbe');
    const productWrite = await api.storage.set('autoparts_inventory_v1::products', '[]');
    const mixedBatch = await api.storage.setBatch({
      'autoparts_inventory_v1::sidebarCollapsed': 'true',
      'autoparts_inventory_v1::auditPermissionProbe': JSON.stringify({ mixed: true }),
    });
    const remove = await api.storage.remove('autoparts_inventory_v1::products');
    const clear = await api.storage.clearPrefix('autoparts_inventory_v1::');
    const imported = await api.storage.import({ version: 1, rows: [{ key: 'autoparts_inventory_v1::products', value: '[]' }] });
    const exported = await api.storage.export();
    const protectedWrite = await api.storage.set('__license_token', 'NOT_A_LICENSE');
    const sale = await api.storage.commitSale({});
    const mobile = await api.license.commitMobileStockOps([{ clientOpId: 'denied-op', kind: 'add', productId: 'unknown', quantityMilli: 1000 }]);
    const backup = await api.backup.encryptContent('{}', 'denied-passphrase');
    const updates = {
      check: await api.updates.checkNow(), download: await api.updates.download(),
      cancel: await api.updates.cancelDownload(), install: await api.updates.install(),
      skip: await api.updates.skipRelease('denied-release'),
      preferences: await api.updates.setPreferences({ autoCheck: false }),
    };
    return { login, session, write, read, productWrite, mixedBatch, remove, clear, imported, exported, protectedWrite, sale, mobile, backup, updates };
  });
  result.exit = await stop(h);
  h = null;
  result.afterClose = native('inspect', db, path.join(folder, 'native-after-close.json'));
  expect(result.calls.login.ok).toBe(true);
  expect(result.calls.session.user.role).toBe('employee');
  expect(result.calls.write).toBe(false);
  expect(result.calls.read).toEqual({});
  expect(result.calls.productWrite).toBe(false);
  expect(result.calls.mixedBatch).toBe(false);
  expect(result.calls.remove).toBe(false);
  expect(result.calls.clear).toBe(false);
  expect(result.calls.imported.ok).toBe(false);
  expect(result.calls.exported.rows).toEqual([]);
  expect(result.afterClose.permissionProbe).toBeNull();
  expect(result.calls.protectedWrite).toBe(false);
  expect(result.calls.sale).toBe(false);
  expect(result.calls.mobile).toEqual({ ok: false, error: 'not_authorized' });
  expect(result.calls.backup).toEqual({ ok: false, error: 'not_authorized' });
  for (const response of Object.values(result.calls.updates)) expect(response).toMatchObject({ ok: false, error: 'not_authorized' });
  result.assertionsPassed = true;
} catch (error) { result.error = error.stack; }
finally {
  if (h) await stop(h, true).catch(error => { result.cleanupError = error.stack; });
  result.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(work, 'ipc-permissions.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ error: result.error, write: result.calls?.write, assertionsPassed: result.assertionsPassed }));
}
if (result.error || result.cleanupError) process.exitCode = 1;
