import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { openPos, startApp, stop } from "./hardening-critical-baseline.mjs";

const root = process.cwd();
const db = path.resolve(process.env.PARTFLOW_PHASE14B_DIAGNOSTIC_DB || "");
if (!db || !fs.existsSync(db)) throw new Error("PARTFLOW_PHASE14B_DIAGNOSTIC_DB_REQUIRED");
const count = Number(process.env.PARTFLOW_PHASE14B_DIAGNOSTIC_SALES || 100);
const output = path.join(root, "reports", "performance-scale-2026-09", "phase14b-renderer-diagnostic.json");
const result = { startedAt: new Date().toISOString(), db, count, latenciesMs: [], memory: [], failures: [] };
const sample = async (handle, sale) => ({
  sale,
  heapMiB: await handle.page.evaluate(() => Number((((performance).memory?.usedJSHeapSize || 0) / 1048576).toFixed(1))),
  processes: await handle.app.evaluate(({ app }) => app.getAppMetrics().map((metric) => ({ type: metric.type, workingSetMiB: Number(((metric.memory?.workingSetSize || 0) / 1024).toFixed(1)), privateMiB: Number(((metric.memory?.privateBytes || 0) / 1024).toFixed(1)) }))),
  domNodes: await handle.page.locator("*").count(),
});
let handle;
try {
  handle = await startApp(db);
  await openPos(handle.page);
  const data = await handle.page.evaluate(async (required) => {
    const prefix = "autoparts_inventory_v1::";
    const read = async (name) => { const stored = await window.desktopAPI.storage.getCollection(name); const base = JSON.parse(stored[`${prefix}${name}`] || "[]"); if (base !== "__partflow_chunked__") return base; const meta = JSON.parse(stored[`${prefix}${name}#meta`]); return Array.from({ length: meta.chunks }, (_, index) => JSON.parse(stored[`${prefix}${name}#${String(index).padStart(4, "0")}`] || "[]")).flat(); };
    const [branches, stocks, products] = await Promise.all([read("branches"), read("branchStocks"), read("products")]);
    const branchId = branches.find((row) => row.isMain)?.id || branches[0].id;
    const byId = new Map(products.map((row) => [row.id, row])); const keys = [];
    for (const stock of stocks.filter((row) => row.branchId === branchId && Number(row.quantity) >= 2).sort((a, b) => Number(b.quantity) - Number(a.quantity))) { const product = byId.get(stock.productId); const key = product?.code || product?.partNumber || product?.name; if (!key) continue; for (let i = 0; i < Math.floor(Number(stock.quantity)) - 1 && keys.length < required; i += 1) keys.push(key); if (keys.length >= required) break; }
    return { keys };
  }, count);
  result.memory.push(await sample(handle, 0));
  for (let index = 0; index < count; index += 1) {
    const search = handle.page.getByPlaceholder("ابحث عن منتج بالاسم أو الرمز..."); await search.fill(data.keys[index]);
    const tile = handle.page.locator('[data-testid="pos-product-tile"][data-pos-can-increment="true"]').first(); await tile.waitFor(); await tile.click();
    const started = performance.now(); await handle.page.getByRole("button", { name: /إتمام البيع/ }).click(); await handle.page.getByRole("button", { name: "عملية بيع جديدة", exact: true }).waitFor({ timeout: 30000 });
    result.latenciesMs.push(Number((performance.now() - started).toFixed(3))); await handle.page.locator("div.fixed.inset-0.z-50").last().locator("button").last().click({ noWaitAfter: true });
    if ((index + 1) % 25 === 0) { result.memory.push(await sample(handle, index + 1)); fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`); console.log(JSON.stringify({ event: "diagnostic", completed: index + 1 })); }
  }
  result.status = "complete";
} catch (error) { result.status = "failed"; result.failures.push(error instanceof Error ? error.stack : String(error)); process.exitCode = 1; }
finally { if (handle) await stop(handle, true).catch(() => undefined); result.finishedAt = new Date().toISOString(); fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`); }
