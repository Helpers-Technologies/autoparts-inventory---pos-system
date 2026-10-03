import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import { startApp, stop } from "./hardening-critical-baseline.mjs";

const root = process.cwd();
const reports = path.join(root, "reports", "performance-scale-2026-09");
const work = path.join(root, "reports", "production-hardening-2026-09", "phase-14a");
const source = path.join(root, "scale-fixtures", "phase-10", "scale-200k", "profile", "autoparts-inventory.secure.sqlite");
const electron = createRequire(import.meta.url)("electron");
fs.mkdirSync(work, { recursive: true });
const runDir = fs.mkdtempSync(path.join(work, "extended-"));
const db = path.join(runDir, "autoparts-inventory.secure.sqlite");
fs.copyFileSync(source, db, fs.constants.COPYFILE_EXCL);
const output = path.join(reports, "phase14a-extended-1200-sales.json");
const probeOutput = path.join(reports, "phase14a-extended-final-inspection.json");
const tracePath = path.join(reports, "phase14a-extended-main-timings.ndjson");
fs.rmSync(tracePath, { force: true });
process.env.PARTFLOW_PHASE14A_TRACE = "1";
process.env.PARTFLOW_PHASE14A_TRACE_PATH = tracePath;

const result = { startedAt: new Date().toISOString(), source, db, sales: [], resources: [], errors: [] };
const save = () => fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
const percentile = (values, fraction) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * fraction) - 1)] ?? null;
const stats = (values) => ({ count: values.length, p50Ms: percentile(values, .5), p95Ms: percentile(values, .95), p99Ms: percentile(values, .99), maxMs: values.length ? Math.max(...values) : null });
const storageState = (page) => page.evaluate(() => {
  const prefix = "autoparts_inventory_v1::";
  const meta = (name) => JSON.parse(window.desktopAPI.storage.get(`${prefix}${name}#meta`) || "null");
  return { sales: meta("salesInvoices"), cash: meta("cashEntries"), stockMovements: meta("stockMovements") };
});
const resource = async (handle, sale) => ({
  sale, at: new Date().toISOString(), dbBytes: fs.statSync(db).size,
  walBytes: fs.existsSync(`${db}-wal`) ? fs.statSync(`${db}-wal`).size : 0,
  rendererHeapBytes: await handle.page.evaluate(() => performance.memory?.usedJSHeapSize || 0),
  processes: await handle.app.evaluate(({ app }) => app.getAppMetrics().map((row) => ({ type: row.type, workingSetKiB: row.memory?.workingSetSize || 0, privateKiB: row.memory?.privateBytes || 0 }))),
});
const ensureProjection = async (handle) => {
  let status = await handle.page.evaluate(() => window.desktopAPI.projection.getStatus());
  if (!["COMPLETE", "NOT_REQUIRED"].includes(status.state)) await handle.page.evaluate(() => window.desktopAPI.projection.start());
  const deadline = Date.now() + 15 * 60_000;
  while (!["COMPLETE", "NOT_REQUIRED"].includes(status.state) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    status = await handle.page.evaluate(() => window.desktopAPI.projection.getStatus());
  }
  if (!["COMPLETE", "NOT_REQUIRED"].includes(status.state)) throw new Error(`PROJECTION_NOT_READY:${JSON.stringify(status)}`);
  return status;
};

let handle;
try {
  handle = await startApp(db);
  result.initialProjection = await ensureProjection(handle);
  result.initialStorage = await storageState(handle.page);
  const fixture = await handle.page.evaluate(async () => {
    const customer = (await window.desktopAPI.query.catalogSearch("customers", { q: "", limit: 1 })).rows[0];
    const rows = await window.desktopAPI.storage.getCollection("branchStocks");
    const prefix = "autoparts_inventory_v1::branchStocks";
    let stocks = JSON.parse(rows[prefix] || "[]");
    if (stocks === "__partflow_chunked__") {
      const meta = JSON.parse(rows[`${prefix}#meta`]);
      stocks = Array.from({ length: meta.chunks }, (_, index) => JSON.parse(rows[`${prefix}#${String(index).padStart(4, "0")}`] || "[]")).flat();
    }
    const stock = stocks.reduce((best, row) => Number(row.quantity) > Number(best?.quantity || 0) ? row : best, null);
    const product = (await window.desktopAPI.query.catalogDetail("products", stock.productId)).row;
    return { customer, stock, product };
  });
  result.fixture = { customerId: fixture.customer.id, productId: fixture.product.id, branchId: fixture.stock.branchId, initialBranchQuantity: fixture.stock.quantity };
  const quantity = Math.min(.001, Number(fixture.stock.quantity) / 2400);
  const price = Number(fixture.product.wholesalePrice || fixture.product.retailPrice || 1);
  const baseCommand = {
    invoice: {
      invoiceNumber: "main-process-authoritative", date: new Date().toISOString().slice(0, 10),
      customerId: fixture.customer.id, customerName: fixture.customer.name,
      lines: [{ id: "phase14a-line", productId: fixture.product.id, productName: fixture.product.name, unit: fixture.product.unit, quantity, price, subtotal: price * quantity, priceType: "wholesale" }],
      total: price * quantity, amountReceived: price * quantity, paymentType: "cash", paymentMethod: "cash", priceType: "wholesale", branchId: fixture.stock.branchId,
    },
  };
  result.quantityPerSale = quantity;
  result.resources.push(await resource(handle, 0));
  for (let index = 1; index <= 1200; index += 1) {
    const command = { ...baseCommand, invoiceId: `phase14a-sale-${String(index).padStart(4, "0")}` };
    const started = performance.now();
    const response = await handle.page.evaluate((value) => window.desktopAPI.sales.create(value), command);
    const ipcMs = Number((performance.now() - started).toFixed(3));
    if (!response.ok || !response.invoice) throw new Error(`SALE_${index}_FAILED:${JSON.stringify(response)}`);
    const projection = await handle.page.evaluate(() => window.desktopAPI.projection.getStatus());
    if (!projection.completionValid || projection.pendingEntities?.length) throw new Error(`SALE_${index}_PROJECTION_INVALID:${JSON.stringify(projection)}`);
    const storage = await storageState(handle.page);
    result.sales.push({ sale: index, invoiceId: response.invoice.id, invoiceNumber: response.invoice.invoiceNumber, ipcMs, mainMs: response.timings?.mainTotalMs, timings: response.timings, salesCount: storage.sales.total, salesChunks: storage.sales.chunks, projectionSignature: projection.sourceSignature });
    if (index % 100 === 0) {
      result.resources.push(await resource(handle, index));
      save();
      console.log(JSON.stringify({ event: "phase14a-extended", sale: index, ipcMs, mainMs: response.timings?.mainTotalMs, chunks: storage.sales.chunks }));
    }
  }
  const windows = [[1,50],[51,100],[101,250],[251,500],[501,750],[751,1000],[1001,1200]];
  result.latencyWindows = Object.fromEntries(windows.map(([from,to]) => [`${from}-${to}`, stats(result.sales.slice(from - 1, to).map((row) => row.ipcMs))]));
  result.mainLatencyWindows = Object.fromEntries(windows.map(([from,to]) => [`${from}-${to}`, stats(result.sales.slice(from - 1, to).map((row) => row.mainMs))]));
  result.preRestartStorage = await storageState(handle.page);
  result.preRestartProjection = await handle.page.evaluate(() => window.desktopAPI.projection.getStatus());
  await stop(handle, true);
  handle = undefined;
  result.forcedTermination = { ok: true, at: new Date().toISOString() };
  handle = await startApp(db);
  result.restartProjection = await ensureProjection(handle);
  result.restartStorage = await storageState(handle.page);
  await stop(handle);
  handle = undefined;
  execFileSync(electron, [path.join(root, "scripts", "phase14-db-probe.cjs"), db, probeOutput], { cwd: root, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, timeout: 15 * 60_000, windowsHide: true });
  result.finalInspection = JSON.parse(fs.readFileSync(probeOutput, "utf8"));
  result.status = "passed";
} catch (error) {
  result.status = "failed";
  result.errors.push(error instanceof Error ? error.stack || error.message : String(error));
} finally {
  if (handle) await stop(handle).catch(() => undefined);
  result.finishedAt = new Date().toISOString();
  save();
}
if (result.status !== "passed") process.exitCode = 1;
