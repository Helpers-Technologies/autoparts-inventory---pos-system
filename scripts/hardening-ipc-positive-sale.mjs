import fs from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { native, openPos, sell, stableCapture, startApp, stop } from './hardening-critical-baseline.mjs';

const root = process.cwd();
const phase = process.env.PARTFLOW_HARDENING_PHASE || 'phase-3-positive';
const work = path.join(root, 'reports/production-hardening-2026-09', phase);
const source = JSON.parse(fs.readFileSync(path.join(root, 'reports/system-audit-2026-09-14/load-small.json'), 'utf8')).sourceDb;
fs.mkdirSync(work, { recursive: true });
const folder = fs.mkdtempSync(path.join(work, 'sales-employee-'));
const db = path.join(folder, 'autoparts-inventory.secure.sqlite');
fs.copyFileSync(source, db);
native('permissions-sales', db);
const result = { db, startedAt: new Date().toISOString(), scope: 'Real sales employee UI workflow through the permission-enforced main-process transaction' };
let h;
try {
  result.before = native('inspect', db, path.join(folder, 'before.json'));
  h = await startApp(db);
  await h.page.getByRole('button', { name: 'تسجيل الخروج', exact: true }).first().click();
  await h.page.getByPlaceholder('Login username').waitFor();
  await h.page.getByPlaceholder('Login username').fill('salesemployee');
  await h.page.locator('input[type=password]').first().fill('stress123');
  await h.page.getByRole('button', { name: 'تسجيل الدخول', exact: true }).click();
  await h.page.getByRole('button', { name: 'تسجيل الخروج', exact: true }).first().waitFor({ timeout: 120000 });
  const dismiss = h.page.getByRole('button', { name: 'تمام، فهمت', exact: true });
  if (await dismiss.isVisible()) await dismiss.click();
  result.session = await h.page.evaluate(() => window.desktopAPI.auth.getSession());
  result.beforeSale = await stableCapture(h.page);
  await openPos(h.page);
  result.sale = await sell(h.page);
  result.exit = await stop(h); h = null;
  result.after = native('inspect', db, path.join(folder, 'after.json'));
  expect(result.session.user.id).toBe('sales-user');
  expect(result.after.collections.salesInvoices.count).toBe(result.before.collections.salesInvoices.count + 1);
  expect(result.after.collections.cashEntries.count).toBe(result.before.collections.cashEntries.count + 1);
  expect(result.after.collections.stockMovements.count).toBe(result.before.collections.stockMovements.count + 1);
  expect(result.after.collections.products.quantity).toBe(result.before.collections.products.quantity - 1);
  result.assertionsPassed = true;
} catch (error) { result.error = error.stack; }
finally {
  if (h) await stop(h, true).catch(error => { result.cleanupError = error.stack; });
  result.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(work, 'positive-sales-permission.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ error: result.error, assertionsPassed: result.assertionsPassed }));
}
if (result.error || result.cleanupError) process.exitCode = 1;
