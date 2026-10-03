const fs = require('node:fs');
const path = require('node:path');
const { app, ipcMain, session } = require('electron');
const work = path.resolve(process.env.PARTFLOW_PHASE14_WORK_ROOT || path.resolve(__dirname, '../reports/production-hardening-2026-09'));
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
const persistenceTrace = [];
const mainErrors = [];
const originalConsoleError = console.error.bind(console);
console.error = (...args) => {
  mainErrors.push({ at: new Date().toISOString(), message: args.map(value => value instanceof Error ? value.message : String(value)).join(' ') });
  fs.writeFileSync(path.join(path.dirname(dbPath), 'main-errors.json'), JSON.stringify(mainErrors, null, 2));
  originalConsoleError(...args);
};
const originalHandle = ipcMain.handle.bind(ipcMain);
const mobileFixturePath = process.env.PARTFLOW_HARDENING_MOBILE_FIXTURE_PATH;
let mobileFixture;
if (mobileFixturePath) {
  const fixtureTarget = path.resolve(mobileFixturePath);
  if (!fixtureTarget.startsWith(work + path.sep)) throw new Error('ISOLATED_MOBILE_FIXTURE_REQUIRED');
  mobileFixture = JSON.parse(fs.readFileSync(fixtureTarget, 'utf8'));
}
const mobileTracePath = path.join(path.dirname(dbPath), 'mobile-network.json');
const mobileTrace = fs.existsSync(mobileTracePath) ? JSON.parse(fs.readFileSync(mobileTracePath, 'utf8')) : { fetches: [], acknowledgements: [] };
const saveMobileTrace = () => {
  fs.writeFileSync(mobileTracePath + '.tmp', JSON.stringify(mobileTrace, null, 2));
  fs.renameSync(mobileTracePath + '.tmp', mobileTracePath);
};
ipcMain.handle = (channel, listener) => originalHandle(channel, async (event, ...args) => {
  let persistenceEntry;
  if (channel === 'storage:set-batch' || channel === 'sales:commit') {
    const rows = args[0] || {};
    persistenceEntry = {
      channel,
      at: new Date().toISOString(),
      keys: Object.keys(rows),
      manifests: Object.fromEntries(Object.entries(rows).filter(([key]) => key.endsWith('#meta')).map(([key, value]) => {
        try { return [key, JSON.parse(value)]; } catch { return [key, 'invalid']; }
      })),
    };
    persistenceTrace.push(persistenceEntry);
    fs.writeFileSync(path.join(path.dirname(dbPath), 'persistence-trace.json'), JSON.stringify(persistenceTrace, null, 2));
  }
  const result = await listener(event, ...args);
  if (persistenceEntry) {
    persistenceEntry.result = result;
    fs.writeFileSync(path.join(path.dirname(dbPath), 'persistence-trace.json'), JSON.stringify(persistenceTrace, null, 2));
  }
  // Substitute the remote transport only after the real IPC listener has
  // validated permission and, for acknowledgements, durable receipts.
  if (mobileFixture && result?.error === 'not_configured') {
    if (channel === 'mobile-stock-ops:fetch') {
      mobileTrace.fetches.push({ pid: process.pid, at: new Date().toISOString() });
      saveMobileTrace();
      return { ok: true, ops: mobileFixture.ops };
    }
    if (channel === 'mobile-stock-ops:resolve') {
      const ok = mobileTrace.acknowledgements.length >= mobileFixture.ackFailures;
      mobileTrace.acknowledgements.push({ pid: process.pid, at: new Date().toISOString(), ok, results: args[0]?.results });
      saveMobileTrace();
      return ok ? { ok: true } : { ok: false, error: 'injected_acknowledgement_failure' };
    }
  }
  return result;
});
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
app.on('will-quit', () => {
  fs.writeFileSync(path.join(path.dirname(dbPath), 'network-isolation.json'), JSON.stringify({ userData, blocked }, null, 2));
  fs.writeFileSync(path.join(path.dirname(dbPath), 'persistence-trace.json'), JSON.stringify(persistenceTrace, null, 2));
});
require('../electron/main.cjs');
