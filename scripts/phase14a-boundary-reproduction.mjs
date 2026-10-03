import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { openPos, startApp, stop } from "./hardening-critical-baseline.mjs";

const root = process.cwd();
const reports = path.join(root, "reports", "performance-scale-2026-09");
const work = path.join(root, "reports", "production-hardening-2026-09", "phase-14a");
const source = path.join(root, "scale-fixtures", "phase-10", "scale-200k", "profile", "autoparts-inventory.secure.sqlite");
fs.mkdirSync(work, { recursive: true });
const runDir = fs.mkdtempSync(path.join(work, "boundary-"));
const db = path.join(runDir, "autoparts-inventory.secure.sqlite");
fs.copyFileSync(source, db, fs.constants.COPYFILE_EXCL);
const output = path.join(reports, "phase14a-boundary-60-sales.json");
process.env.PARTFLOW_PHASE14A_TRACE = "1";
process.env.PARTFLOW_PHASE14A_TRACE_PATH = path.join(reports, "phase14a-main-sale-timings.ndjson");
fs.rmSync(process.env.PARTFLOW_PHASE14A_TRACE_PATH, { force: true });
const result = { startedAt: new Date().toISOString(), source, db, sales: [], resources: [], errors: [] };
const save = () => fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
const storageSnapshot = (page) => page.evaluate(() => {
  const prefix = "autoparts_inventory_v1::";
  const readMeta = (name) => JSON.parse(window.desktopAPI.storage.get(`${prefix}${name}#meta`) || "null");
  const sales = readMeta("salesInvoices");
  const lastIndex = sales.chunks - 1;
  const last = JSON.parse(window.desktopAPI.storage.get(`${prefix}salesInvoices#${String(lastIndex).padStart(4, "0")}`) || "[]");
  return {
    sales, cash: readMeta("cashEntries"), stockMovements: readMeta("stockMovements"),
    salesChunk: lastIndex, salesChunkRows: last.length,
    lastInvoiceNumber: last.at(-1)?.invoiceNumber || "",
  };
});
const resources = async (handle, sale) => ({
  sale, at: new Date().toISOString(), dbBytes: fs.statSync(db).size,
  walBytes: fs.existsSync(`${db}-wal`) ? fs.statSync(`${db}-wal`).size : 0,
  rendererHeapBytes: await handle.page.evaluate(() => performance.memory?.usedJSHeapSize || 0),
  processes: await handle.app.evaluate(({ app }) => app.getAppMetrics().map((row) => ({
    type: row.type, workingSetKiB: row.memory?.workingSetSize || 0, privateKiB: row.memory?.privateBytes || 0,
  }))),
});
const sellSelected = async (page, productName) => {
  const search = page.getByPlaceholder("ابحث عن منتج بالاسم أو الرمز...");
  await search.fill(productName);
  await page.waitForTimeout(250);
  const tile = page.locator('[data-testid="pos-product-tile"][data-pos-can-increment="true"]').first();
  await tile.waitFor({ timeout: 30_000 });
  await tile.click();
  const complete = page.getByRole("button", { name: /إتمام البيع/ });
  const started = Date.now();
  await complete.click();
  await page.getByRole("button", { name: "عملية بيع جديدة", exact: true }).waitFor({ timeout: 45_000 });
  return { completionMs: Date.now() - started };
};

let handle;
try {
  handle = await startApp(db);
  let status = await handle.page.evaluate(() => window.desktopAPI.projection.getStatus());
  if (!["COMPLETE", "NOT_REQUIRED"].includes(status.state)) {
    await handle.page.evaluate(() => window.desktopAPI.projection.start());
    const deadline = Date.now() + 15 * 60_000;
    do {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      status = await handle.page.evaluate(() => window.desktopAPI.projection.getStatus());
    } while (!["COMPLETE", "NOT_REQUIRED"].includes(status.state) && Date.now() < deadline);
  }
  result.initialProjection = status;
  result.initialStorage = await storageSnapshot(handle.page);
  await openPos(handle.page);
  const selectedProducts = await handle.page.evaluate(async () => {
    const rows = await window.desktopAPI.storage.getCollection("branchStocks");
    const prefix = "autoparts_inventory_v1::branchStocks";
    const stored = JSON.parse(rows[prefix] || "[]");
    const chunks = [];
    if (stored === "__partflow_chunked__") {
      const meta = JSON.parse(rows[`${prefix}#meta`]);
      for (let index = 0; index < meta.chunks; index += 1) {
        chunks.push(JSON.parse(rows[`${prefix}#${String(index).padStart(4, "0")}`] || "[]"));
      }
    } else {
      chunks.push(stored);
    }
    const branchRows = await window.desktopAPI.storage.getCollection("branches");
    const branches = JSON.parse(branchRows["autoparts_inventory_v1::branches"] || "[]");
    const mainBranchId = branches.find((row) => row.isMain)?.id || branches[0]?.id;
    const candidates = chunks.flat().filter((row) => row.branchId === mainBranchId && Number(row.quantity) >= 2)
      .sort((left, right) => Number(right.quantity) - Number(left.quantity)).slice(0, 120);
    const products = [];
    for (const row of candidates) {
      const product = (await window.desktopAPI.query.catalogDetail("products", row.productId)).row;
      if (product) products.push({ id: product.id, name: product.name, branchId: row.branchId, quantity: row.quantity });
    }
    return products;
  });
  result.selectedProducts = selectedProducts;
  const saleProductNames = selectedProducts.flatMap((product) =>
    Array.from({ length: Math.max(0, Math.floor(Number(product.quantity)) - 1) }, () => product.name),
  );
  if (saleProductNames.length < 60) throw new Error(`INSUFFICIENT_UI_SALE_CAPACITY:${saleProductNames.length}`);
  result.resources.push(await resources(handle, 0));
  for (let index = 1; index <= 60; index += 1) {
    const rendererStarted = performance.now();
    const sale = await sellSelected(handle.page, saleProductNames[index - 1]);
    const storage = await storageSnapshot(handle.page);
    const projection = await handle.page.evaluate(() => window.desktopAPI.projection.getStatus());
    const projected = await handle.page.evaluate(() => window.desktopAPI.query.page("salesInvoices", { page: 0, pageSize: 1 }));
    result.sales.push({
      sale: index, completionMs: sale.completionMs,
      instrumentedCycleMs: Number((performance.now() - rendererStarted).toFixed(3)),
      storage, projection, projectedCount: projected.total, queryOk: projected.ok,
    });
    if (index % 10 === 0) result.resources.push(await resources(handle, index));
    save();
    if (index < 60) {
      await handle.page.getByRole("button", { name: "عملية بيع جديدة", exact: true }).click({ noWaitAfter: true });
      await handle.page.locator('[data-testid="pos-product-tile"]:not([disabled])').first().waitFor({ timeout: 30_000 });
    }
    console.log(JSON.stringify({ event: "phase14a-boundary-sale", sale: index, ms: sale.completionMs, count: storage.sales.total, state: projection.state }));
  }
  result.status = "passed";
} catch (error) {
  result.status = "failed";
  result.errors.push(error instanceof Error ? error.stack || error.message : String(error));
} finally {
  result.finishedAt = new Date().toISOString();
  save();
  if (handle) await stop(handle).catch(() => undefined);
}
if (result.status !== "passed") process.exitCode = 1;
