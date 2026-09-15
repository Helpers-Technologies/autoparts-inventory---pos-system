const fs = require('node:fs');
const path = require('node:path');
const { app, session } = require('electron');
const work = path.resolve(__dirname, '../reports/production-hardening-2026-09');
if (process.env.HW_E2E !== '1' || !process.env.HW_E2E_DB_PATH) throw new Error('ISOLATED_E2E_DATABASE_REQUIRED');
const dbPath = path.resolve(process.env.HW_E2E_DB_PATH);
if (!dbPath.startsWith(work + path.sep)) throw new Error('ISOLATED_HARDENING_DB_REQUIRED');
const userData = path.join(path.dirname(dbPath), 'electron-user-data');
fs.mkdirSync(userData, { recursive: true });
app.setPath('userData', userData);
const allowed = value => {
  try { const url = new URL(typeof value === 'string' ? value : value.url); return ['file:', 'data:', 'devtools:', 'chrome-extension:'].includes(url.protocol) || ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname); }
  catch { return false; }
};
const blocked = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async function(input, ...args) {
  if (!allowed(input)) { blocked.push({ transport: 'fetch', at: new Date().toISOString() }); throw new Error('HARDENING_EXTERNAL_NETWORK_BLOCKED'); }
  return originalFetch.call(this, input, ...args);
};
app.whenReady().then(() => session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
  const cancel = !allowed(details.url);
  if (cancel) blocked.push({ transport: 'chromium', at: new Date().toISOString() });
  callback({ cancel });
}));
app.on('will-quit', () => fs.writeFileSync(path.join(path.dirname(dbPath), 'network-isolation.json'), JSON.stringify({ userData, blocked }, null, 2)));
require('../electron/main.cjs');
