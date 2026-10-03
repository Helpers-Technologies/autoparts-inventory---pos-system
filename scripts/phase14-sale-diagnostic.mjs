import fs from 'node:fs';
import path from 'node:path';
import { openPos, startApp, stop } from './hardening-critical-baseline.mjs';

const dbPath = path.resolve(process.argv[2] || '');
const outputPath = path.resolve(process.argv[3] || 'phase14-sale-diagnostic.json');
if (!fs.existsSync(dbPath)) throw new Error(`DB_NOT_FOUND:${dbPath}`);

let handle;
try {
  handle = await startApp(dbPath);
  const before = await handle.page.evaluate(() => window.desktopAPI.query.page('salesInvoices', { page: 0, pageSize: 1 }));
  await openPos(handle.page);
  const customerSelect = handle.page.locator('[data-testid="pos-customer-select"]');
  await customerSelect.locator('button').first().click();
  const customerPortal = handle.page.locator('#searchable-select-portal');
  await customerPortal.locator('button').nth(1).waitFor({ timeout: 30000 });
  await customerPortal.locator('button').nth(1).click();
  const tile = handle.page.locator('[data-testid="pos-product-tile"][data-pos-can-increment="true"]').first();
  await tile.click();
  const complete = handle.page.getByRole('button', { name: /\u0625\u062a\u0645\u0627\u0645 \u0627\u0644\u0628\u064a\u0639/ });
  await complete.click();
  await handle.page.waitForTimeout(12000);
  const after = await handle.page.evaluate(() => window.desktopAPI.query.page('salesInvoices', { page: 0, pageSize: 1 }));
  const snapshot = await handle.page.evaluate(() => ({
    hash: location.hash,
    dialogs: [...document.querySelectorAll('[role="dialog"]')].map((node) => node.textContent?.trim() || ''),
    buttons: [...document.querySelectorAll('button')].filter((node) => node.offsetParent !== null).map((node) => node.textContent?.trim() || '').filter(Boolean),
    alerts: [...document.querySelectorAll('[role="alert"]')].map((node) => node.textContent?.trim() || ''),
    bodyText: document.body.innerText.slice(-12000),
  }));
  await handle.page.screenshot({ path: outputPath.replace(/\.json$/i, '.png'), fullPage: true });
  fs.writeFileSync(outputPath, `${JSON.stringify({ dbPath, beforeTotal: before.total, afterTotal: after.total, snapshot }, null, 2)}\n`);
} finally {
  if (handle) await stop(handle, true).catch(() => undefined);
}
