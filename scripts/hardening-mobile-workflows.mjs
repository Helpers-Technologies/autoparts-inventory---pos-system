import fs from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { native, stableCapture, startApp, stop } from './hardening-critical-baseline.mjs';

const root = process.cwd();
const phase = process.env.PARTFLOW_HARDENING_PHASE || 'phase-2';
const work = path.join(root, 'reports/production-hardening-2026-09', phase);
const source = JSON.parse(fs.readFileSync(path.join(root, 'reports/system-audit-2026-09-14/load-small.json'), 'utf8')).sourceDb;
fs.mkdirSync(work, { recursive: true });
const results = [], requested = new Set(process.argv.slice(2));
for (const kind of ['add', 'remove', 'count'].filter(kind => !requested.size || requested.has(kind))) {
  const folder = fs.mkdtempSync(path.join(work, kind + '-'));
  const db = path.join(folder, 'autoparts-inventory.secure.sqlite');
  fs.copyFileSync(source, db);
  native('mobile', db);
  const op = { clientOpId: 'mobile-' + kind, productId: 'audit-product', kind, quantityMilli: kind === 'count' ? 15000 : 2000, actorName: 'Synthetic storeman', deviceLabel: 'Isolated test phone' };
  const fixture = path.join(folder, 'mobile-fixture.json');
  fs.writeFileSync(fixture, JSON.stringify({ ops: [op], ackFailures: 2 }));
  process.env.PARTFLOW_HARDENING_MOBILE_FIXTURE_PATH = fixture;
  const result = { kind, db, source, op, startedAt: new Date().toISOString(), scope: 'Real mounted polling hook, main inventory IPC and encrypted DB; isolated simulated remote delivery/acknowledgement only' };
  results.push(result);
  let h;
  const trace = () => JSON.parse(fs.readFileSync(path.join(folder, 'mobile-network.json'), 'utf8'));
  const waitAcknowledgements = async count => {
    await expect.poll(() => {
      try { return trace().acknowledgements.length; }
      catch (error) { if (error.code === 'ENOENT') return 0; throw error; }
    }, { timeout: 60000 }).toBeGreaterThanOrEqual(count);
  };
  try {
    result.beforeLogin = native('inspect', db, path.join(folder, 'native-before-login.json'));
    h = await startApp(db);
    await waitAcknowledgements(1);
    await h.page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await waitAcknowledgements(2);
    await h.page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await waitAcknowledgements(3);
    result.beforeClose = await stableCapture(h.page);
    result.networkBeforeClose = trace();
    result.exit = await stop(h);
    h = null;
    result.afterClose = native('inspect', db, path.join(folder, 'native-after-close.json'));
    const expectedQuantity = kind === 'add' ? 12 : kind === 'remove' ? 8 : 15;
    expect(result.afterClose.collections.products.quantity).toBe(expectedQuantity);
    expect(result.afterClose.collections.branchStocks.rows.map(row => row.quantity)).toEqual(kind === 'add' ? [5, 7] : kind === 'remove' ? [1, 7] : [8, 7]);
    expect(result.afterClose.collections.stockMovements.count).toBe(1);
    expect(result.afterClose.collections.mobileStockOpReceipts.count).toBe(1);
    expect(result.afterClose.collections.mobileStockAudit.count).toBe(1);
    expect(result.networkBeforeClose.acknowledgements.slice(0, 3).map(ack => ack.ok)).toEqual([false, false, true]);
    h = await startApp(db);
    await waitAcknowledgements(4);
    await h.page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await waitAcknowledgements(5);
    result.afterRestart = await stableCapture(h.page);
    result.networkAfterRestart = trace();
    result.restartExit = await stop(h);
    h = null;
    result.afterReopenClose = native('inspect', db, path.join(folder, 'native-after-reopen-close.json'));
    expect(result.networkAfterRestart.acknowledgements.some(ack => ack.pid === result.restartExit.pid)).toBe(true);
    for (const name of ['products', 'branchStocks', 'salesInvoices', 'cashEntries', 'stockMovements', 'mobileStockOpReceipts', 'mobileStockAudit']) {
      expect(result.afterReopenClose.collections[name]).toEqual(result.afterClose.collections[name]);
    }
    for (const acknowledgement of result.networkAfterRestart.acknowledgements) {
      expect(acknowledgement.results).toEqual([result.afterClose.collections.mobileStockOpReceipts.rows[0].result]);
    }
    expect(result.afterClose.integrity).toEqual([{ integrity_check: 'ok' }]);
    expect(result.afterReopenClose.integrity).toEqual([{ integrity_check: 'ok' }]);
    result.assertionsPassed = true;
  } catch (error) { result.error = error.stack; }
  finally {
    if (h) await stop(h, true).catch(error => { result.cleanupError = error.stack; });
    delete process.env.PARTFLOW_HARDENING_MOBILE_FIXTURE_PATH;
    result.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(work, 'mobile-workflows.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify({ kind, error: result.error, assertionsPassed: result.assertionsPassed }));
  }
}
if (results.some(result => result.error || result.cleanupError)) process.exitCode = 1;
