import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { _electron, expect } from '@playwright/test';

const require = createRequire(import.meta.url);
const electron = require('electron');
const root = process.cwd();
const phase = process.env.PARTFLOW_HARDENING_PHASE || 'phase-0';
const work = path.join(root, 'reports/production-hardening-2026-09', phase);
fs.mkdirSync(work, { recursive: true });
const source = process.env.PARTFLOW_HARDENING_SOURCE_DB ||
  JSON.parse(fs.readFileSync(path.join(root, 'reports/system-audit-2026-09-14/load-small.json'), 'utf8')).sourceDb;
const results = [];
const save = () => fs.writeFileSync(path.join(work, 'critical-reproduction.json'), JSON.stringify(results, null, 2));
export async function startApp(db) {
  const env = { ...process.env, HW_E2E: '1', HW_E2E_DB_PATH: db, NODE_ENV: 'test' };
  delete env.ELECTRON_RENDERER_URL;
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ args: [path.join(root, 'scripts/hardening-electron-bootstrap.cjs')], cwd: root, env, timeout: 180000 });
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(30000);
    await page.getByPlaceholder('Login username').waitFor({ timeout: 180000 });
    await page.getByPlaceholder('Login username').fill('admin');
    await page.locator('input[type=password]').first().fill('stress123');
    await page.getByRole('button', { name: 'تسجيل الدخول', exact: true }).click();
    await page.getByRole('button', { name: 'تسجيل الخروج', exact: true }).first().waitFor({ timeout: 240000 });
    const dismiss = page.getByRole('button', { name: 'تمام، فهمت', exact: true });
    if (await dismiss.isVisible()) { await dismiss.evaluate(button => button.click()); await dismiss.waitFor({ state: 'hidden' }); }
    return { app, page };
  } catch (error) {
    const pid = app.process().pid;
    execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
    throw error;
  }
}
async function capture(page) {
  return page.evaluate(async () => {
    const out = {}, prefix = 'autoparts_inventory_v1::';
    for (const name of ['products', 'customers', 'salesInvoices', 'cashEntries', 'stockMovements', 'branchStocks', 'shifts']) {
      const raw = await window.desktopAPI.storage.getCollection(name);
      let rows = JSON.parse(raw[prefix + name] || '[]');
      if (rows === '__partflow_chunked__') {
        const meta = JSON.parse(raw[prefix + name + '#meta']);
        rows = Array.from({ length: meta.chunks }, (_, i) => JSON.parse(raw[prefix + name + '#' + String(i).padStart(4, '0')])).flat();
      }
      if (!Array.isArray(rows)) throw new Error('INVALID_COLLECTION: ' + name);
      const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(rows)));
      out[name] = { count: rows.length, sha256: [...new Uint8Array(hash)].map(v => v.toString(16).padStart(2, '0')).join(''), quantity: rows.reduce((sum, row) => sum + (Number(row.quantity) || 0), 0) };
    }
    return out;
  });
}
export async function stableCapture(page) {
  let last, stableSince = Date.now();
  const start = Date.now();
  while (Date.now() - start < 60000) {
    const value = await capture(page), text = JSON.stringify(value);
    if (text !== last) { last = text; stableSince = Date.now(); }
    else if (Date.now() - stableSince >= 3000) return value;
    await new Promise(resolve => setTimeout(resolve, 400));
  }
  throw new Error('STORAGE_DID_NOT_STABILIZE_IN_60S');
}
async function openPos(page) {
  await page.evaluate(() => { location.hash = '/pos'; });
  await page.getByPlaceholder('ابحث عن منتج بالاسم أو الرمز...').waitFor({ timeout: 90000 });
  const floating = page.getByPlaceholder('مثال: 500');
  if (!(await floating.isVisible())) {
    const open = page.getByRole('button', { name: 'فتح وردية', exact: true }).first();
    if (await open.isVisible()) await open.click();
  }
  if (await floating.isVisible()) {
    await floating.fill('2000');
    await page.getByRole('button', { name: /بدء الوردية الآن/ }).click();
    await floating.waitFor({ state: 'hidden' });
  }
  await page.locator('[data-testid="pos-product-tile"]:not([disabled])').first().waitFor({ timeout: 45000 });
}
async function sell(page) {
  const tiles = page.locator('[data-testid="pos-product-tile"]');
  const index = await tiles.evaluateAll(items => items.findIndex(el => !el.disabled && Number((el.textContent.match(/متاح:\s*([\d.,]+)/) || [])[1]?.replaceAll(',', '')) > 0));
  if (index < 0) throw new Error('NO_AVAILABLE_FIXTURE_PRODUCT');
  const product = await tiles.nth(index).locator('h3').innerText();
  await tiles.nth(index).click();
  const complete = page.getByRole('button', { name: /إتمام البيع/ });
  await expect(complete).toBeEnabled();
  const start = Date.now();
  await complete.click();
  await page.getByRole('button', { name: 'عملية بيع جديدة', exact: true }).waitFor({ timeout: 45000 });
  // Termination probes stop at the actual success state, before another UI cycle.
  return { product, completionMs: Date.now() - start };
}
function native(operation, db, output) {
  execFileSync(electron, [path.join(root, 'scripts/hardening-db-probe.cjs'), operation, db, ...(output ? [output] : [])], { cwd: root, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true, timeout: 120000 });
  return output ? JSON.parse(fs.readFileSync(output, 'utf8')) : undefined;
}
export async function stop(handle, forced = false) {
  const pid = await handle.app.evaluate(() => process.pid);
  if (forced) execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
  else await handle.app.close();
  const start = Date.now();
  while (true) {
    try { process.kill(pid, 0); }
    catch (error) { if (error.code === 'ESRCH') return { pid, confirmedStopped: true, forced }; throw error; }
    if (Date.now() - start > 10000) throw new Error('ELECTRON_PID_STILL_ALIVE: ' + pid);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}
if (path.resolve(process.argv[1] || '') === path.join(root, 'scripts/hardening-critical-baseline.mjs')) {
const requestedModes = new Set(process.argv.slice(2));
for (const mode of ['login-close-no-business-writes', 'graceful-immediate-sale', 'abrupt-immediate-sale', 'abrupt-after-durable-sale', 'two-branch-login'].filter(mode => requestedModes.size === 0 || requestedModes.has(mode))) {
  const folder = fs.mkdtempSync(path.join(work, mode + '-'));
  const db = path.join(folder, 'autoparts-inventory.secure.sqlite');
  fs.copyFileSync(source, db);
  if (mode === 'two-branch-login') native('branches', db);
  const result = { mode, db, startedAt: new Date().toISOString(), source, scope: 'Current main/renderer sources; original audit synthetic small fixture; no inventory history navigation; independent encrypted SQLite reads after confirmed process exit' };
  results.push(result);
  let h;
  try {
    result.beforeLogin = native('inspect', db, path.join(folder, 'native-before-login.json'));
    h = await startApp(db);
    result.runtime = await h.app.evaluate(() => process.versions);
    result.afterLogin = await stableCapture(h.page);
    if (mode.endsWith('-sale')) {
      await openPos(h.page);
      result.beforeSale = await stableCapture(h.page);
      result.sale = await sell(h.page);
      if (mode === 'abrupt-after-durable-sale') result.afterDurableSale = await stableCapture(h.page);
    }
    result.exit = await stop(h, mode.startsWith('abrupt'));
    h = null;
    result.afterClose = native('inspect', db, path.join(folder, 'native-after-close.json'));
    h = await startApp(db);
    result.afterRestart = await stableCapture(h.page);
    result.restartExit = await stop(h);
    h = null;
    result.afterReopenClose = native('inspect', db, path.join(folder, 'native-after-reopen-close.json'));
  } catch (error) {
    result.error = error.stack;
  } finally {
    if (h) { try { await stop(h, true); } catch (error) { result.cleanupError = error.stack; } }
    result.finishedAt = new Date().toISOString();
    save();
    console.log(JSON.stringify({ mode, error: result.error, before: result.beforeLogin?.collections.stockMovements.count, after: result.afterClose?.collections.stockMovements.count, exit: result.exit }));
  }
}
}
