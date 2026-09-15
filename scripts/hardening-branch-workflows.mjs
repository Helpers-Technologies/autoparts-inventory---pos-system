import fs from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { native, openPos, sell, stableCapture, startApp, stop } from './hardening-critical-baseline.mjs';

const root = process.cwd();
const phase = process.env.PARTFLOW_HARDENING_PHASE || 'phase-1c';
const work = path.join(root, 'reports/production-hardening-2026-09', phase);
const source = JSON.parse(fs.readFileSync(path.join(root, 'reports/system-audit-2026-09-14/load-small.json'), 'utf8')).sourceDb;
const results = [];
fs.mkdirSync(work, { recursive: true });
const requested = new Set(process.argv.slice(2));
for (const mode of ['sale-secondary', 'transfer', 'stocktake', 'transfer-then-sale'].filter(mode => !requested.size || requested.has(mode))) {
  const folder = fs.mkdtempSync(path.join(work, mode + '-'));
  const db = path.join(folder, 'autoparts-inventory.secure.sqlite');
  fs.copyFileSync(source, db);
  native('branch-workflows', db);
  const result = { mode, db, source, startedAt: new Date().toISOString() };
  results.push(result);
  let h;
  try {
    result.beforeLogin = native('inspect', db, path.join(folder, 'native-before-login.json'));
    h = await startApp(db);
    result.afterLogin = await stableCapture(h.page);
    const page = h.page;
    if (mode === 'sale-secondary') {
      await openPos(page);
      await page.locator('select').filter({ has: page.locator('option[value="branch-other"]') }).first().selectOption('branch-other');
      result.sale = await sell(page);
    } else if (mode.startsWith('transfer')) {
      await page.evaluate(() => { location.hash = '/branches'; });
      await page.getByRole('button', { name: 'تحويل مخزون', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'تحويل مخزون بين الفروع', exact: true });
      await dialog.locator('label').filter({ hasText: 'إلى فرع' }).locator('..').getByRole('button').first().click();
      await page.getByRole('button', { name: 'Other', exact: true }).click();
      await dialog.getByRole('button', { name: 'اختر القطعة المراد تحويلها', exact: true }).click();
      await page.getByRole('button', { name: /قطعة اختبار التدقيق/ }).click();
      await dialog.locator('input[type=number]').fill('2');
      await dialog.getByRole('button', { name: 'تنفيذ التحويل', exact: true }).click();
      await page.getByText('تم تحويل المخزون', { exact: true }).waitFor();
      if (mode === 'transfer-then-sale') {
        await openPos(page);
        await page.locator('select').filter({ has: page.locator('option[value="branch-other"]') }).first().selectOption('branch-other');
        result.sale = await sell(page);
      }
    } else {
      await page.evaluate(() => { location.hash = '/stocktakes'; });
      await page.getByRole('button', { name: 'جرد جديد', exact: true }).first().click();
      await page.locator('input[type=number]').first().fill('13');
      await page.getByRole('button', { name: 'حفظ التغييرات', exact: true }).click();
      await page.getByRole('button', { name: 'تطبيق الجردة', exact: true }).click();
      await page.getByRole('dialog', { name: 'تطبيق الجردة', exact: true }).getByRole('button', { name: 'تطبيق', exact: true }).click();
      await page.getByText('تم تطبيق الجردة', { exact: true }).waitFor();
    }
    result.exit = await stop(h);
    h = null;
    result.afterClose = native('inspect', db, path.join(folder, 'native-after-close.json'));
    const quantities = mode === 'sale-secondary' ? [3, 6] : mode === 'transfer' ? [1, 9] : mode === 'transfer-then-sale' ? [1, 8] : [6, 7];
    const expected = quantities.map((quantity, i) => ({ branchId: i ? 'branch-other' : 'branch-main', productId: 'audit-product', quantity }));
    const keyedRows = snapshot => snapshot.collections.branchStocks.rows.map(({ branchId, productId, quantity }) => ({ branchId, productId, quantity })).sort((a, b) => a.branchId.localeCompare(b.branchId));
    result.expectedBranchStocks = expected;
    expect(keyedRows(result.afterClose)).toEqual(expected);
    expect(result.afterClose.collections.products.quantity).toBe(quantities[0] + quantities[1]);
    if (mode.startsWith('transfer')) expect(result.afterClose.collections.stockTransfers.count).toBe(1);
    if (mode === 'stocktake') {
      expect(result.afterClose.collections.stocktakes.count).toBe(1);
      expect(result.afterClose.collections.stockMovements.count).toBe(1);
    }
    if (mode === 'sale-secondary' || mode === 'transfer-then-sale') {
      expect(result.afterClose.collections.salesInvoices.count).toBe(1);
      expect(result.afterClose.collections.cashEntries.count).toBe(1);
      expect(result.afterClose.collections.stockMovements.count).toBe(1);
    }
    h = await startApp(db);
    result.afterRestart = await stableCapture(h.page);
    result.restartExit = await stop(h);
    h = null;
    result.afterReopenClose = native('inspect', db, path.join(folder, 'native-after-reopen-close.json'));
    expect(keyedRows(result.afterReopenClose)).toEqual(expected);
    for (const name of ['products', 'branchStocks', 'salesInvoices', 'cashEntries', 'stockMovements', 'stockTransfers', 'stocktakes']) {
      expect(result.afterReopenClose.collections[name]).toEqual(result.afterClose.collections[name]);
    }
    expect(result.afterClose.integrity).toEqual([{ integrity_check: 'ok' }]);
    expect(result.afterReopenClose.integrity).toEqual([{ integrity_check: 'ok' }]);
    result.assertionsPassed = true;
  } catch (error) {
    result.error = error.stack;
    if (h) await h.page.screenshot({ path: path.join(folder, 'failure.png') }).catch(screenshotError => { result.screenshotError = screenshotError.stack; });
  } finally {
    if (h) await stop(h, true).catch(error => { result.cleanupError = error.stack; });
    result.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(work, 'branch-workflows.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify({ mode, error: result.error, assertionsPassed: result.assertionsPassed, exit: result.exit }));
  }
}
if (results.some(result => result.error || result.cleanupError)) process.exitCode = 1;
