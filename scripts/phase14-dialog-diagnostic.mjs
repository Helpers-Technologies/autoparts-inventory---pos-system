import fs from 'node:fs';
import path from 'node:path';
import { openPos, startApp, stop } from './hardening-critical-baseline.mjs';

const dbPath = path.resolve(process.argv[2] || '');
const outputPath = path.resolve(process.argv[3] || 'phase14-dialog-diagnostic.json');
if (!fs.existsSync(dbPath)) throw new Error(`DB_NOT_FOUND:${dbPath}`);

let handle;
try {
  handle = await startApp(dbPath);
  await openPos(handle.page);
  const dialogs = await handle.page.locator('[role="dialog"]').evaluateAll((nodes) =>
    nodes.map((node) => ({
      text: node.textContent?.trim() || '',
      ariaLabelledBy: node.getAttribute('aria-labelledby'),
      html: node.outerHTML.slice(0, 12000),
    })),
  );
  const backdrops = await handle.page.locator('div.fixed.inset-0.z-\\[100\\]').count();
  await handle.page.screenshot({ path: outputPath.replace(/\.json$/i, '.png'), fullPage: true });
  fs.writeFileSync(outputPath, `${JSON.stringify({ dbPath, dialogs, backdrops }, null, 2)}\n`);
} finally {
  if (handle) await stop(handle, true).catch(() => undefined);
}
