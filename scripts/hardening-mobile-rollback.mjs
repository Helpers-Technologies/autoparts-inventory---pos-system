import fs from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { native, stableCapture, startApp, stop } from './hardening-critical-baseline.mjs';

const root = process.cwd(), phase = process.env.PARTFLOW_HARDENING_PHASE || 'phase-2-rollback';
const work = path.join(root, 'reports/production-hardening-2026-09', phase);
const source = JSON.parse(fs.readFileSync(path.join(root, 'reports/system-audit-2026-09-14/load-small.json'), 'utf8')).sourceDb;
fs.mkdirSync(work, { recursive: true });
const results = [];
for (const stage of (process.argv.length > 2 ? process.argv.slice(2).map(Number) : [1, 7])) {
  const folder = fs.mkdtempSync(path.join(work, 'write-' + stage + '-'));
  const db = path.join(folder, 'autoparts-inventory.secure.sqlite');
  fs.copyFileSync(source, db);
  native('mobile', db);
  const op = { clientOpId: 'rollback-' + stage, productId: 'audit-product', kind: 'add', quantityMilli: 2000 };
  const result = { stage, db, startedAt: new Date().toISOString() };
  results.push(result);
  let h;
  try {
    process.env.PARTFLOW_HARDENING_FAIL_MOBILE_AFTER_WRITES = String(stage);
    h = await startApp(db);
    result.beforeOperation = await stableCapture(h.page);
    result.rejected = await h.page.evaluate(op => window.desktopAPI.license.commitMobileStockOps([op]), op);
    expect(result.rejected).toEqual({ ok: false, error: 'commit_failed' });
    result.exit = await stop(h);
    h = null;
    delete process.env.PARTFLOW_HARDENING_FAIL_MOBILE_AFTER_WRITES;
    result.afterClose = native('inspect', db, path.join(folder, 'native-after-rejected-close.json'));
    for (const name of ['products', 'branchStocks', 'stockMovements', 'salesInvoices', 'cashEntries']) {
      const expected = { ...result.afterClose.collections[name] };
      delete expected.rows;
      expect(expected).toEqual(result.beforeOperation[name]);
    }
    expect(result.afterClose.collections.mobileStockOpReceipts.count).toBe(0);
    const fixture = path.join(folder, 'mobile-fixture.json');
    fs.writeFileSync(fixture, JSON.stringify({ ops: [op], ackFailures: 0 }));
    process.env.PARTFLOW_HARDENING_MOBILE_FIXTURE_PATH = fixture;
    h = await startApp(db);
    await expect.poll(() => {
      const file = path.join(folder, 'mobile-network.json');
      return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).acknowledgements.length : 0;
    }, { timeout: 60000 }).toBeGreaterThanOrEqual(1);
    await h.page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect.poll(() => JSON.parse(fs.readFileSync(path.join(folder, 'mobile-network.json'), 'utf8')).acknowledgements.length, { timeout: 60000 }).toBeGreaterThanOrEqual(2);
    await stableCapture(h.page);
    result.restartExit = await stop(h);
    h = null;
    result.afterRetry = native('inspect', db, path.join(folder, 'native-after-retry-close.json'));
    expect(result.afterRetry.collections.products.quantity).toBe(12);
    expect(result.afterRetry.collections.stockMovements.count).toBe(1);
    expect(result.afterRetry.collections.mobileStockOpReceipts.count).toBe(1);
    expect(result.afterRetry.collections.branchStocks.rows.map(row => row.quantity)).toEqual([5, 7]);
    expect(result.afterClose.integrity).toEqual([{ integrity_check: 'ok' }]);
    expect(result.afterRetry.integrity).toEqual([{ integrity_check: 'ok' }]);
    result.assertionsPassed = true;
  } catch (error) { result.error = error.stack; }
  finally {
    delete process.env.PARTFLOW_HARDENING_FAIL_MOBILE_AFTER_WRITES;
    delete process.env.PARTFLOW_HARDENING_MOBILE_FIXTURE_PATH;
    if (h) await stop(h, true).catch(error => { result.cleanupError = error.stack; });
    result.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(work, 'mobile-rollback.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify({ stage, error: result.error, assertionsPassed: result.assertionsPassed }));
  }
}
if (results.some(result => result.error || result.cleanupError)) process.exitCode = 1;
