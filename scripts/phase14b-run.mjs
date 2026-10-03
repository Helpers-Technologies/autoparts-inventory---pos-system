import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import { openPos, startApp, stop } from "./hardening-critical-baseline.mjs";

const root = process.cwd();
const reports = path.join(root, "reports", "performance-scale-2026-09");
const workRoot = path.join(root, "reports", "production-hardening-2026-09", "phase-14b");
const source = path.join(root, "scale-fixtures", "phase-10", "scale-200k", "profile", "autoparts-inventory.secure.sqlite");
const electron = createRequire(import.meta.url)("electron");
const electronCli = path.join(path.dirname(path.dirname(electron)), "cli.js");
const uiSalesRequired = Number(process.env.PARTFLOW_PHASE14B_UI_SALES || 500);
const durableSalesRequired = Number(process.env.PARTFLOW_PHASE14B_DURABLE_SALES || 1200);
if (uiSalesRequired < 500 || durableSalesRequired < 1200) throw new Error("PHASE14B_MINIMUMS_REQUIRED");

fs.mkdirSync(reports, { recursive: true });
fs.mkdirSync(workRoot, { recursive: true });
const runDir = fs.mkdtempSync(path.join(workRoot, "validation-"));
const dbPath = path.join(runDir, "autoparts-inventory.secure.sqlite");
const crashPath = path.join(runDir, "renderer-crash.ndjson");
const mainTimingPath = path.join(runDir, "main-sale-timings.ndjson");
const outputPath = path.join(reports, "phase14b-validation.json");
fs.copyFileSync(source, dbPath, fs.constants.COPYFILE_EXCL);

const result = {
  phase: "14b",
  status: "running",
  startedAt: new Date().toISOString(),
  environment: { platform: process.platform, arch: process.arch, os: os.version(), cpu: os.cpus()[0]?.model, totalMemoryBytes: os.totalmem() },
  runDir,
  isolatedDatabase: dbPath,
  requested: { visibleElectronSales: uiSalesRequired, authoritativeTransactions: durableSalesRequired },
  startup: {},
  visibleSales: { latenciesMs: [], timing: [], telemetry: [], completed: 0 },
  durableSales: { latenciesMs: [], mainTimings: [], completed: 0 },
  businessCoverage: {},
  failureInjection: [],
  restart: {},
  failures: [],
};
const save = () => fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
const percentile = (values, fraction) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * fraction) - 1)] ?? null;
const stats = (values) => ({ count: values.length, p50Ms: percentile(values, .5), p95Ms: percentile(values, .95), p99Ms: percentile(values, .99), maximumMs: values.length ? Math.max(...values) : null });
const windows = (values, ranges) => Object.fromEntries(ranges.map(([from, to]) => {
  const slice = values.slice(from - 1, Math.min(to, values.length));
  return [`${from}-${Math.min(to, values.length)}`, stats(slice)];
}));
const inspect = (label) => {
  const output = path.join(runDir, `${label}-inspection.json`);
  execFileSync(process.execPath, [electronCli, path.join(root, "scripts", "phase14-db-probe.cjs"), dbPath, output], {
    cwd: root, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, windowsHide: true, timeout: 10 * 60_000,
  });
  return JSON.parse(fs.readFileSync(output, "utf8"));
};
const launchEnv = { PARTFLOW_PHASE14A_TRACE: "1", PARTFLOW_PHASE14A_TRACE_PATH: mainTimingPath, PARTFLOW_PHASE14B_CRASH_PATH: crashPath };
const ensureProjectionReady = async (handle) => {
  let status = await handle.page.evaluate(() => window.desktopAPI.projection.getStatus());
  if (["REQUIRED", "INTERRUPTED", "FAILED"].includes(status?.state)) await handle.page.evaluate(() => window.desktopAPI.projection.start());
  const started = performance.now();
  while (performance.now() - started < 10 * 60_000) {
    status = await handle.page.evaluate(() => window.desktopAPI.projection.getStatus());
    if (["COMPLETE", "NOT_REQUIRED"].includes(status?.state)) return status;
    if (status?.state === "FAILED") throw new Error(`PROJECTION_UPGRADE_FAILED:${status.errorCode || "unknown"}`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("PROJECTION_UPGRADE_TIMEOUT");
};
const installRendererInstrumentation = async (page) => page.evaluate(() => {
  const metrics = { saleTimings: [], longTasks: [], mutations: 0, addedNodes: 0, removedNodes: 0, timeouts: new Set(), intervals: new Set() };
  window.__partflowPhase14B = metrics;
  window.addEventListener("partflow:phase14b-sale-timing", (event) => metrics.saleTimings.push(event.detail));
  const observer = new MutationObserver((records) => {
    metrics.mutations += records.length;
    for (const record of records) { metrics.addedNodes += record.addedNodes.length; metrics.removedNodes += record.removedNodes.length; }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  try { new PerformanceObserver((list) => metrics.longTasks.push(...list.getEntries().map((entry) => ({ startTime: entry.startTime, duration: entry.duration })))).observe({ type: "longtask", buffered: true }); } catch {}
  const nativeTimeout = window.setTimeout.bind(window), nativeClearTimeout = window.clearTimeout.bind(window);
  window.setTimeout = (handler, timeout, ...args) => { let id; id = nativeTimeout((...inner) => { metrics.timeouts.delete(id); if (typeof handler === "function") handler(...inner); else Function(handler)(); }, timeout, ...args); metrics.timeouts.add(id); return id; };
  window.clearTimeout = (id) => { metrics.timeouts.delete(id); return nativeClearTimeout(id); };
  const nativeInterval = window.setInterval.bind(window), nativeClearInterval = window.clearInterval.bind(window);
  window.setInterval = (handler, timeout, ...args) => { const id = nativeInterval(handler, timeout, ...args); metrics.intervals.add(id); return id; };
  window.clearInterval = (id) => { metrics.intervals.delete(id); return nativeClearInterval(id); };
});
const telemetry = async (handle, sale) => {
  const renderer = await handle.page.evaluate(() => ({
    heapMiB: Number((((performance).memory?.usedJSHeapSize || 0) / 1048576).toFixed(1)),
    domNodes: document.getElementsByTagName("*").length,
    timers: window.__partflowPhase14B?.timeouts?.size ?? null,
    intervals: window.__partflowPhase14B?.intervals?.size ?? null,
    mutations: window.__partflowPhase14B?.mutations ?? null,
    addedNodes: window.__partflowPhase14B?.addedNodes ?? null,
    removedNodes: window.__partflowPhase14B?.removedNodes ?? null,
    longTasks: window.__partflowPhase14B?.longTasks?.length ?? null,
  }));
  const processes = await handle.app.evaluate(({ app }) => app.getAppMetrics().map((metric) => ({
    type: metric.type,
    workingSetMiB: Number(((metric.memory?.workingSetSize || 0) / 1024).toFixed(1)),
    privateMiB: Number(((metric.memory?.privateBytes || 0) / 1024).toFixed(1)),
  })));
  return { sale, at: new Date().toISOString(), renderer, processes };
};
const readCollection = async (page, name) => page.evaluate(async (collection) => {
  const prefix = `autoparts_inventory_v1::${collection}`;
  const rows = await window.desktopAPI.storage.getCollection(collection);
  const base = JSON.parse(rows[prefix] || "[]");
  if (base !== "__partflow_chunked__") return { rows: base, chunks: base.length ? 1 : 0 };
  const meta = JSON.parse(rows[`${prefix}#meta`] || "{}");
  const parts = Array.from({ length: Number(meta.chunks) || 0 }, (_, index) => JSON.parse(rows[`${prefix}#${String(index).padStart(4, "0")}`] || "[]"));
  return { rows: parts.flat(), chunks: meta.chunks, chunkSizes: parts.map((part) => part.length), total: meta.total };
}, name);

let handle;
try {
  result.initial = inspect("initial");
  handle = await startApp(dbPath, launchEnv);
  handle.page.on("crash", () => result.failures.push("playwright:renderer-crash"));
  result.projection = await ensureProjectionReady(handle);
  await handle.page.waitForTimeout(2000);
  result.startup.afterHydration = inspect("after-hydration");
  result.startup.firstDivergenceTransaction = result.startup.afterHydration.invariants.orphanBranchStockProducts === 0 ? null : 0;
  if (result.startup.afterHydration.invariants.orphanBranchStockProducts !== 0) throw new Error("STARTUP_BRANCH_STOCK_ORPHAN");

  const branches = await readCollection(handle.page, "branches");
  const products = await readCollection(handle.page, "products");
  const branchStocks = await readCollection(handle.page, "branchStocks");
  const productIds = new Set(products.rows.map((row) => row.id));
  const branchIds = new Set(branches.rows.map((row) => row.id));
  result.startup.branchStockFingerprint = {
    count: branchStocks.rows.length, chunks: branchStocks.chunks, chunkSizes: branchStocks.chunkSizes,
    quantity: branchStocks.rows.reduce((sum, row) => sum + Number(row.quantity || 0), 0),
    orphanProducts: branchStocks.rows.filter((row) => !productIds.has(row.productId)).length,
    orphanBranches: branchStocks.rows.filter((row) => !branchIds.has(row.branchId)).length,
    keys: branchStocks.rows.map((row, ordinal) => ({ ordinal, chunk: Math.floor(ordinal / 500), branchId: row.branchId, productId: row.productId, quantity: row.quantity })),
  };
  const mainBranchId = branches.rows.find((row) => row.isMain)?.id || branches.rows[0]?.id;
  const customer = (await handle.page.evaluate(() => window.desktopAPI.query.catalogSearch("customers", { q: "", limit: 1 }))).rows[0];
  const byId = new Map(products.rows.map((row) => [row.id, row]));
  const saleKeys = [];
  for (const stock of branchStocks.rows.filter((row) => row.branchId === mainBranchId && Number(row.quantity) >= 2).sort((a, b) => Number(b.quantity) - Number(a.quantity))) {
    const product = byId.get(stock.productId); const key = product?.code || product?.partNumber || product?.name;
    if (!key) continue;
    for (let count = 0; count < Math.floor(Number(stock.quantity)) - 1 && saleKeys.length < uiSalesRequired; count += 1) saleKeys.push(key);
    if (saleKeys.length >= uiSalesRequired) break;
  }
  if (saleKeys.length < uiSalesRequired) throw new Error(`INSUFFICIENT_UI_CAPACITY:${saleKeys.length}`);
  const positiveStocks = branchStocks.rows.filter((row) => Number(row.quantity) > 0 && byId.has(row.productId));
  const durableStock = positiveStocks.filter((row) => row.branchId === mainBranchId).sort((a, b) => Number(b.quantity) - Number(a.quantity))[0];
  const nonMainStock = positiveStocks.find((row) => row.branchId !== mainBranchId);
  const nearZeroStock = positiveStocks.filter((row) => row.branchId === mainBranchId && row.productId !== durableStock.productId).sort((a, b) => Number(a.quantity) - Number(b.quantity))[0];
  if (!nonMainStock || !nearZeroStock) throw new Error("TARGETED_BRANCH_STOCK_CASES_UNAVAILABLE");
  const makeSaleCommand = (stock, quantity, label) => {
    const product = byId.get(stock.productId);
    const price = Number(product.wholesalePrice || product.retailPrice || 1);
    return { invoice: { invoiceNumber: `phase14b-${label}`, date: new Date().toISOString().slice(0, 10), customerId: customer.id, customerName: customer.name, lines: [{ id: `phase14b-${label}-line`, productId: product.id, productName: product.name, unit: product.unit, quantity, price, subtotal: price * quantity, priceType: "wholesale" }], total: price * quantity, amountReceived: price * quantity, paymentType: "cash", paymentMethod: "cash", priceType: "wholesale", branchId: stock.branchId } };
  };
  const directQuantity = Math.min(.001, Number(durableStock.quantity) / (durableSalesRequired + 100));
  let saleCommand = makeSaleCommand(durableStock, directQuantity, "main-authoritative");
  const targetedCommands = [
    makeSaleCommand(nonMainStock, Math.min(.001, Number(nonMainStock.quantity) / 2), "non-main-branch"),
    makeSaleCommand(nearZeroStock, Math.max(Number(nearZeroStock.quantity) - .0001, Number(nearZeroStock.quantity) / 2), "near-zero-balance"),
  ];
  result.businessCoverage = {
    repeatedSameProduct: { productId: durableStock.productId, transactionCount: durableSalesRequired - targetedCommands.length },
    differentProducts: { uiCandidateCount: new Set(saleKeys).size, targetedProductIds: targetedCommands.map((command) => command.invoice.lines[0].productId) },
    nonMainBranch: { branchId: nonMainStock.branchId, productId: nonMainStock.productId },
    nearZeroBalance: { branchId: nearZeroStock.branchId, productId: nearZeroStock.productId, expectedRemainder: .0001 },
    chunkBoundary: { branchStockChunkSizes: branchStocks.chunkSizes, rows: branchStocks.rows.length },
  };

  await openPos(handle.page);
  await installRendererInstrumentation(handle.page);
  result.visibleSales.telemetry.push(await telemetry(handle, 0));
  for (let index = 0; index < uiSalesRequired; index += 1) {
    const search = handle.page.getByPlaceholder("ابحث عن منتج بالاسم أو الرمز...");
    await search.fill(saleKeys[index]);
    const tile = handle.page.locator('[data-testid="pos-product-tile"][data-pos-can-increment="true"]').first();
    await tile.waitFor({ timeout: 30000 });
    await tile.click();
    const started = performance.now();
    await handle.page.getByRole("button", { name: /إتمام البيع/ }).click();
    await handle.page.getByRole("button", { name: "عملية بيع جديدة", exact: true }).waitFor({ timeout: 30000 });
    result.visibleSales.latenciesMs.push(Number((performance.now() - started).toFixed(3)));
    await handle.page.locator("div.fixed.inset-0.z-50").last().locator("button").last().click({ noWaitAfter: true });
    result.visibleSales.completed = index + 1;
    if ((index + 1) % 25 === 0) {
      result.visibleSales.telemetry.push(await telemetry(handle, index + 1));
      const captured = await handle.page.evaluate(() => window.__partflowPhase14B?.saleTimings?.splice(0) ?? []);
      result.visibleSales.timing.push(...captured);
      save(); console.log(JSON.stringify({ event: "visible-sales", completed: index + 1, p95Ms: stats(result.visibleSales.latenciesMs).p95Ms }));
    }
  }
  result.visibleSales.stats = stats(result.visibleSales.latenciesMs);
  result.visibleSales.windows = windows(result.visibleSales.latenciesMs, [[1, 50], [51, 100], [101, 200], [201, 300], [301, 400], [401, 500]]);
  result.afterVisible = inspect("after-visible");
  if (result.afterVisible.invariants.orphanBranchStockProducts !== 0) throw new Error("VISIBLE_SALES_CREATED_ORPHANS");

  await stop(handle); handle = await startApp(dbPath, launchEnv); await ensureProjectionReady(handle);
  // The UI workload may legitimately consume the product that had the largest
  // opening balance. Re-select from the committed post-visible state so the
  // 1,200-transaction workload tests persistence rather than exhausting a
  // stale pre-workload capacity estimate.
  const postVisibleStocks = await readCollection(handle.page, "branchStocks");
  const postVisibleProducts = await readCollection(handle.page, "products");
  const postVisibleById = new Map(postVisibleProducts.rows.map((row) => [row.id, row]));
  const liveDurableStock = postVisibleStocks.rows
    .filter((row) => row.branchId === mainBranchId && Number(row.quantity) > 0 && postVisibleById.has(row.productId))
    .sort((a, b) => Number(b.quantity) - Number(a.quantity))[0];
  if (!liveDurableStock) throw new Error("NO_POST_VISIBLE_DURABLE_STOCK");
  const liveQuantity = Math.min(.001, Number(liveDurableStock.quantity) / (durableSalesRequired + 100));
  const liveProduct = postVisibleById.get(liveDurableStock.productId);
  const livePrice = Number(liveProduct.wholesalePrice || liveProduct.retailPrice || 1);
  saleCommand = { invoice: { invoiceNumber: "phase14b-main-authoritative", date: new Date().toISOString().slice(0, 10), customerId: customer.id, customerName: customer.name, lines: [{ id: "phase14b-main-authoritative-line", productId: liveProduct.id, productName: liveProduct.name, unit: liveProduct.unit, quantity: liveQuantity, price: livePrice, subtotal: livePrice * liveQuantity, priceType: "wholesale" }], total: livePrice * liveQuantity, amountReceived: livePrice * liveQuantity, paymentType: "cash", paymentMethod: "cash", priceType: "wholesale", branchId: mainBranchId } };
  result.businessCoverage.repeatedSameProduct = { productId: liveProduct.id, transactionCount: durableSalesRequired - targetedCommands.length, quantityPerSale: liveQuantity };
  for (let index = 0; index < durableSalesRequired; index += 1) {
    const command = targetedCommands[index] || saleCommand;
    const started = performance.now();
    const response = await handle.page.evaluate(({ command, index }) => window.desktopAPI.sales.create({ ...command, invoiceId: `phase14b-durable-${String(index + 1).padStart(4, "0")}` }), { command, index });
    if (!response?.ok) throw new Error(`DURABLE_SALE_${index + 1}:${response?.error || "unknown"}`);
    result.durableSales.latenciesMs.push(Number((performance.now() - started).toFixed(3)));
    if (response.timings) result.durableSales.mainTimings.push(response.timings);
    result.durableSales.completed = index + 1;
    if ((index + 1) % 50 === 0) { save(); console.log(JSON.stringify({ event: "durable-sales", completed: index + 1, p95Ms: stats(result.durableSales.latenciesMs).p95Ms })); }
  }
  result.durableSales.stats = stats(result.durableSales.latenciesMs);
  result.durableSales.mainTotalStats = stats(result.durableSales.mainTimings.map((row) => row.mainTotalMs));

  for (const stage of ["before_sale_persistence", "after_sale_record", "during_stock_update", "before_cash_update", "after_cash_update", "before_commit"]) {
    const response = await handle.page.evaluate(({ command, stage }) => window.desktopAPI.sales.create({ ...command, invoiceId: `phase14b-failure-${stage}`, failureStage: stage }), { command: saleCommand, stage });
    result.failureInjection.push({ stage, ok: response.ok, error: response.error });
    if (response.ok) throw new Error(`FAILURE_STAGE_COMMITTED:${stage}`);
  }
  await stop(handle);
  const beforeForcedRestart = inspect("before-forced-restart");
  handle = await startApp(dbPath, launchEnv); await ensureProjectionReady(handle);
  const pid = handle.app.process().pid;
  execFileSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { windowsHide: true });
  await handle.app.waitForEvent("close", { timeout: 30000 }).catch(() => undefined); handle = undefined;
  handle = await startApp(dbPath, launchEnv); result.restart.projection = await ensureProjectionReady(handle); await stop(handle); handle = undefined;
  result.final = inspect("final");
  result.restart.before = beforeForcedRestart.collections.salesInvoices.count;
  result.restart.after = result.final.collections.salesInvoices.count;
  result.crashEvidence = fs.existsSync(crashPath) ? fs.readFileSync(crashPath, "utf8").trim().split(/\r?\n/).filter(Boolean).map(JSON.parse) : [];
  result.status = "complete";
} catch (error) {
  result.status = "failed";
  result.failures.push(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
} finally {
  if (handle) await stop(handle, true).catch((error) => result.failures.push(String(error)));
  result.finishedAt = new Date().toISOString();
  save();
  console.log(JSON.stringify({ event: "phase14b-finished", status: result.status, outputPath, runDir, failures: result.failures.length }));
}
