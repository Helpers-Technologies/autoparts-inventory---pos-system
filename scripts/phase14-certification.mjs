import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import { openPos, startApp, stop } from "./hardening-critical-baseline.mjs";

const root = process.cwd();
const reports = path.join(root, "reports", "performance-scale-2026-09");
// The isolated database grows beyond the source fixture during the two-hour
// certification. Allow the disposable working copy to live on a volume with
// enough headroom while keeping the authoritative report artifacts in-repo.
const workRoot = path.resolve(process.env.PARTFLOW_PHASE14_WORK_ROOT || path.join(root, "reports", "production-hardening-2026-09", "phase-14", "repeat"));
const source = path.resolve(process.env.PARTFLOW_PHASE14_SOURCE_DB ||
  path.join(root, "scale-fixtures", "phase-10", "scale-200k", "profile", "autoparts-inventory.secure.sqlite"));
const electron = createRequire(import.meta.url)("electron");
fs.mkdirSync(reports, { recursive: true });
fs.mkdirSync(workRoot, { recursive: true });
const runDir = fs.mkdtempSync(path.join(workRoot, "certification-"));
const dbPath = path.join(runDir, "autoparts-inventory.secure.sqlite");
const progressPath = path.join(reports, "phase14-repeat-run-progress.json");
const soakDurationMs = Number(process.env.PARTFLOW_PHASE14_SOAK_MS || 2 * 60 * 60_000);
const soakIntervalMs = Number(process.env.PARTFLOW_PHASE14_SOAK_INTERVAL_MS || 60_000);
const controlledSales = Number(process.env.PARTFLOW_PHASE14_CONTROLLED_SALES || 500);
const burstSales = Number(process.env.PARTFLOW_PHASE14_BURST_SALES || 1000);
const restartCycles = Number(process.env.PARTFLOW_PHASE14_RESTART_CYCLES || 20);
const validateOnly = process.env.PARTFLOW_PHASE14_VALIDATE_ONLY === "1";
if (soakDurationMs < 2 * 60 * 60_000 || controlledSales < 500 || burstSales < 1000 || restartCycles < 20) {
  throw new Error("FORMAL_PHASE14_MINIMUMS_REQUIRED");
}

fs.copyFileSync(source, dbPath, fs.constants.COPYFILE_EXCL);
const result = {
  phase: "14",
  status: "running",
  startedAt: new Date().toISOString(),
  environment: {
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    osVersion: os.version(),
    hostname: os.hostname(),
    logicalCpuCount: os.cpus().length,
    cpuModel: os.cpus()[0]?.model,
    totalMemoryBytes: os.totalmem(),
    node: process.version,
    electron: process.versions.electron,
    applicationVersion: JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version,
  },
  sourceDatabase: source,
  isolatedDatabase: dbPath,
  configuration: { soakDurationMs, soakIntervalMs, controlledSales, burstSales, restartCycles },
  workload: {
    requested: { sales: 500, purchases: 100, salesReturns: 50, purchaseReturns: 20, customerPayments: 150, supplierPayments: 50, stockOperations: 150, branchTransfers: 50, quotations: 100, quotationConversions: 50 },
    completed: { sales: 0, purchases: 0, salesReturns: 0, purchaseReturns: 0, customerPayments: 0, supplierPayments: 0, stockOperations: 0, branchTransfers: 0, quotations: 0, quotationConversions: 0 },
    deviations: [],
  },
  journey: [],
  controlledSaleLatenciesMs: [],
  burstSaleLatenciesMs: [],
  soak: { samples: [], performanceTimeline: [], memoryTimeline: [] },
  forcedStops: [],
  restarts: [],
  failures: [],
};
const save = () => fs.writeFileSync(progressPath, `${JSON.stringify(result, null, 2)}\n`);
const percentile = (values, fraction) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * fraction) - 1)] ?? null;
const stats = (values) => ({
  count: values.length,
  p50Ms: percentile(values, 0.50),
  p95Ms: percentile(values, 0.95),
  p99Ms: percentile(values, 0.99),
  maximumMs: values.length ? Math.max(...values) : null,
});
const inspect = (label) => {
  const output = path.join(reports, `phase14-repeat-${label}-inspection.json`);
  execFileSync(electron, [path.join(root, "scripts", "phase14-db-probe.cjs"), dbPath, output], {
    cwd: root,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    windowsHide: true,
    timeout: 10 * 60_000,
  });
  return JSON.parse(fs.readFileSync(output, "utf8"));
};
const kill = async (handle) => {
  const pid = handle.app.process().pid;
  execFileSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { windowsHide: true });
  await handle.app.waitForEvent("close", { timeout: 30_000 }).catch(() => undefined);
};
const loginMetrics = async (handle) => ({
  projection: await handle.page.evaluate(() => window.desktopAPI.projection.getStatus()),
  page: await handle.page.evaluate(() => window.desktopAPI.query.page("salesInvoices", { page: 0, pageSize: 1 })),
});
const memory = async (handle, checkpoint, elapsedMs) => ({
  checkpoint,
  at: new Date().toISOString(),
  elapsedMs,
  rendererHeapMiB: await handle.page.evaluate(() => Number((((performance).memory?.usedJSHeapSize || 0) / 1048576).toFixed(1))),
  processes: await handle.app.evaluate(({ app }) => app.getAppMetrics().map((metric) => ({
    type: metric.type,
    workingSetMiB: Number(((metric.memory?.workingSetSize || 0) / 1024).toFixed(1)),
    peakWorkingSetMiB: Number(((metric.memory?.peakWorkingSetSize || 0) / 1024).toFixed(1)),
    privateMiB: Number(((metric.memory?.privateBytes || 0) / 1024).toFixed(1)),
  }))),
});
const ensureProjectionReady = async (handle) => {
  let status = await handle.page.evaluate(() => window.desktopAPI.projection.getStatus());
  const statesThatNeedStart = new Set(["REQUIRED", "INTERRUPTED", "FAILED"]);
  if (statesThatNeedStart.has(status?.state)) {
    await handle.page.evaluate(() => window.desktopAPI.projection.start());
  }
  const started = performance.now();
  while (performance.now() - started < 10 * 60_000) {
    status = await handle.page.evaluate(() => window.desktopAPI.projection.getStatus());
    if (["COMPLETE", "NOT_REQUIRED"].includes(status?.state)) return status;
    if (status?.state === "FAILED") throw new Error(`PROJECTION_UPGRADE_FAILED:${status?.error || "unknown"}`);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`PROJECTION_UPGRADE_TIMEOUT:${JSON.stringify(status)}`);
};

let handle;
try {
  result.initial = inspect("initial");
  save();
  handle = await startApp(dbPath);
  result.runtimeVersions = await handle.app.evaluate(() => process.versions);
  result.projectionBeforeWorkload = await ensureProjectionReady(handle);
  save();

  // Build the entire burst before any sale.  This is deliberately a one-unit
  // plan across real stock rows: it neither invents fractional stock nor edits
  // a database value.  One unit per planned sale also makes the maximum sale
  // count and the expected remainder independently auditable.
  const fixture = await handle.page.evaluate(async ({ requiredBurstSales }) => {
    const prefix = "autoparts_inventory_v1::";
    const readCollection = async (name) => {
      const rows = await window.desktopAPI.storage.getCollection(name);
      const stored = JSON.parse(rows[`${prefix}${name}`] || "[]");
      if (stored !== "__partflow_chunked__") return stored;
      const meta = JSON.parse(rows[`${prefix}${name}#meta`] || "{}");
      return Array.from({ length: Number(meta.chunks) || 0 }, (_, index) =>
        JSON.parse(rows[`${prefix}${name}#${String(index).padStart(4, "0")}`] || "[]"),
      ).flat();
    };
    const [customers, branches, stocks, products] = await Promise.all([
      window.desktopAPI.query.catalogSearch("customers", { q: "", limit: 1 }).then((result) => result.rows),
      readCollection("branches"), readCollection("branchStocks"), readCollection("products"),
    ]);
    const customer = customers[0];
    const branch = branches.find((row) => row.isMain) || branches[0];
    if (!customer || !branch) throw new Error("CERTIFICATION_CUSTOMER_OR_BRANCH_MISSING");
    const productsById = new Map(products.map((product) => [product.id, product]));
    const candidates = stocks
      .filter((stock) => stock.branchId === branch.id)
      .map((stock) => {
        const product = productsById.get(stock.productId);
        const branchAvailable = Number(stock.quantity);
        const productAvailable = Number(product?.quantity);
        // Preserve one sellable unit outside the plan for the later safe
        // rollback-injection matrix.  It is never added by a direct write.
        const maximumPossibleSales = Math.max(0, Math.floor(Math.min(branchAvailable, productAvailable)));
        const planCapacity = Math.max(0, maximumPossibleSales - 1);
        return { stock, product, branchAvailable, productAvailable, maximumPossibleSales, planCapacity };
      })
      .filter((row) => row.product && !row.product.archived && row.planCapacity > 0)
      .sort((left, right) => right.planCapacity - left.planCapacity || String(left.product.id).localeCompare(String(right.product.id)));
    let remaining = requiredBurstSales;
    const pairs = [];
    const sales = [];
    for (const candidate of candidates) {
      if (remaining <= 0) break;
      const plannedSales = Math.min(candidate.planCapacity, remaining);
      const pair = {
        productId: candidate.product.id,
        productCode: candidate.product.code || candidate.product.partNumber || null,
        productName: candidate.product.name,
        productUnit: candidate.product.unit,
        productPrice: Number(candidate.product.wholesalePrice || candidate.product.retailPrice || 1),
        branchId: branch.id,
        branchName: branch.name,
        requestedQuantityPerSale: 1,
        initialBranchStock: candidate.branchAvailable,
        initialProductStock: candidate.productAvailable,
        maximumPossibleSales: candidate.maximumPossibleSales,
        reservedSafetyStock: 1,
        plannedSales,
        plannedQuantity: plannedSales,
        expectedFinalBranchStock: candidate.branchAvailable - plannedSales,
        expectedFinalProductStock: candidate.productAvailable - plannedSales,
      };
      pairs.push(pair);
      for (let offset = 0; offset < plannedSales; offset += 1) {
        const ordinal = sales.length + 1;
        sales.push({
          ordinal,
          productId: pair.productId,
          productCode: pair.productCode,
          productName: pair.productName,
          productUnit: pair.productUnit,
          branchId: pair.branchId,
          branchName: pair.branchName,
          requestedQuantity: 1,
          availableBranchStock: candidate.branchAvailable - offset,
          availableProductStock: candidate.productAvailable - offset,
          expectedRemainingBranchStock: candidate.branchAvailable - offset - 1,
          expectedRemainingProductStock: candidate.productAvailable - offset - 1,
          status: "planned",
        });
      }
      remaining -= plannedSales;
    }
    return { customer, branch, pairs, sales, unplannedSales: remaining };
  }, { requiredBurstSales: burstSales });
  if (fixture.unplannedSales !== 0 || fixture.sales.length !== burstSales) {
    throw new Error(`INSUFFICIENT_LEGITIMATE_BURST_STOCK:${JSON.stringify({ planned: fixture.sales.length, required: burstSales })}`);
  }
  result.stockSufficiency = {
    status: "PASS",
    selectionLogic: "Main branch; existing non-archived product/branch rows sorted by sellable one-unit capacity descending then product ID; one unit retained per selected pair; pairs are excluded from all UI sales.",
    branch: { id: fixture.branch.id, name: fixture.branch.name },
    requiredBurstSales: burstSales,
    plannedBurstSales: fixture.sales.length,
    pairs: fixture.pairs,
    sales: fixture.sales,
  };
  save();
  const burstProductById = new Map(fixture.pairs.map((pair) => [pair.productId, pair]));
  let uiSaleCursor = 0;
  const uiSaleKeys = await handle.page.evaluate(async ({ branchId, required, excludedProductIds }) => {
    const prefix = "autoparts_inventory_v1::";
    const readCollection = async (name) => {
      const rows = await window.desktopAPI.storage.getCollection(name);
      const stored = JSON.parse(rows[`${prefix}${name}`] || "[]");
      if (stored !== "__partflow_chunked__") return stored;
      const meta = JSON.parse(rows[`${prefix}${name}#meta`] || "{}");
      return Array.from({ length: Number(meta.chunks) || 0 }, (_, index) =>
        JSON.parse(rows[`${prefix}${name}#${String(index).padStart(4, "0")}`] || "[]"),
      ).flat();
    };
    const [stocks, products] = await Promise.all([readCollection("branchStocks"), readCollection("products")]);
    const byId = new Map(products.map((product) => [product.id, product]));
    const keys = [];
    const excluded = new Set(excludedProductIds);
    for (const stock of stocks.filter((row) => row.branchId === branchId && !excluded.has(row.productId) && Number(row.quantity) >= 2).sort((a, b) => Number(b.quantity) - Number(a.quantity))) {
      const product = byId.get(stock.productId);
      const key = product?.code || product?.partNumber || product?.name;
      if (!key) continue;
      const usable = Math.max(0, Math.floor(Number(stock.quantity)) - 1);
      for (let count = 0; count < usable && keys.length < required; count += 1) keys.push(key);
      if (keys.length >= required) break;
    }
    return keys;
  }, { branchId: fixture.branch.id, required: controlledSales + 100, excludedProductIds: [...burstProductById.keys()] });
  if (uiSaleKeys.length < controlledSales + 30) throw new Error(`INSUFFICIENT_UI_SALE_CAPACITY:${uiSaleKeys.length}`);
  result.stockSufficiency.uiWorkload = {
    requiredSalesIncludingSoakAndRestartAllowance: controlledSales + 30,
    plannedSales: uiSaleKeys.length,
    excludedBurstProductIds: [...burstProductById.keys()],
    status: "PASS",
  };
  if (validateOnly) {
    result.status = "stock-sufficiency-validated";
    result.finishedAt = new Date().toISOString();
    save();
    await stop(handle);
    handle = undefined;
    console.log(JSON.stringify({ event: "phase14-stock-sufficiency-validated", progressPath, runDir, pairs: fixture.pairs.length, burstSales: fixture.sales.length, uiSales: uiSaleKeys.length }));
    process.exit(0);
  }
  const commandForPlannedSale = (planned) => {
    const pair = burstProductById.get(planned.productId);
    const price = Number(pair.productPrice || 1);
    return {
      invoice: {
        invoiceNumber: "main-process-authoritative",
        date: new Date().toISOString().slice(0, 10),
        customerId: fixture.customer.id,
        customerName: fixture.customer.name,
        lines: [{ id: `phase14-line-${planned.ordinal}`, productId: planned.productId, productName: planned.productName, unit: planned.productUnit, quantity: planned.requestedQuantity, price, subtotal: price * planned.requestedQuantity, priceType: "wholesale" }],
        total: price * planned.requestedQuantity,
        amountReceived: price * planned.requestedQuantity,
        paymentType: "cash",
        paymentMethod: "cash",
        priceType: "wholesale",
        branchId: planned.branchId,
      },
    };
  };
  const createUiSale = async () => {
    const key = uiSaleKeys[uiSaleCursor++];
    const search = handle.page.getByPlaceholder("ابحث عن منتج بالاسم أو الرمز...");
    await search.fill(key);
    await handle.page.waitForTimeout(250);
    const tile = handle.page.locator('[data-testid="pos-product-tile"][data-pos-can-increment="true"]').first();
    await tile.waitFor({ timeout: 30_000 });
    await tile.click();
    const complete = handle.page.getByRole("button", { name: /إتمام البيع/ });
    const started = performance.now();
    await complete.click();
    await handle.page.getByRole("button", { name: "عملية بيع جديدة", exact: true }).waitFor({ timeout: 45_000 });
    const elapsed = Number((performance.now() - started).toFixed(3));
    const nextSale = handle.page.locator("div.fixed.inset-0.z-50").last().locator("button").last();
    await nextSale.click({ noWaitAfter: true, timeout: 30_000 });
    await handle.page.locator('[data-testid="pos-product-tile"]:not([disabled])').first().waitFor({ timeout: 30_000 });
    return { elapsed, invoiceId: null, invoiceNumber: null };
  };
  const createDurableSale = async (index) => {
    const planned = result.stockSufficiency.sales[index];
    const preflight = await handle.page.evaluate(({ branchId, productId }) =>
      window.desktopAPI.query.branchStockDetail(branchId, productId), { branchId: planned.branchId, productId: planned.productId });
    const observedBranchStock = Number(preflight?.row?.quantity);
    if (!preflight?.ok || !Number.isFinite(observedBranchStock)) {
      planned.status = "unexpected-stock-query-failure";
      throw new Error(`BURST_STOCK_PREFLIGHT_UNAVAILABLE:${planned.ordinal}:${JSON.stringify(preflight)}`);
    }
    planned.observedAvailableBranchStock = observedBranchStock;
    if (Math.abs(observedBranchStock - planned.availableBranchStock) > 1e-9) {
      planned.status = observedBranchStock + 1e-9 < planned.requestedQuantity ? "expected-workload-exhaustion" : "unexpected-stock-divergence";
      throw new Error(`BURST_STOCK_PREFLIGHT_DIVERGENCE:${planned.ordinal}:${JSON.stringify({ expected: planned.availableBranchStock, observed: observedBranchStock, classification: planned.status })}`);
    }
    const started = performance.now();
    const saleCommand = commandForPlannedSale(planned);
    const response = await handle.page.evaluate((command) => window.desktopAPI.sales.create(command), {
      ...saleCommand,
      invoiceId: `phase14-repeat-burst-${String(index + 1).padStart(4, "0")}`,
    });
    const elapsed = Number((performance.now() - started).toFixed(3));
    if (!response?.ok || !response.invoice) {
      planned.status = response?.error === "insufficient_branch_stock" || response?.error === "insufficient_stock" ? "unexpected-stock-rejection" : "rejected";
      throw new Error(`BURST_SALE_${index + 1}_FAILED:${JSON.stringify(response)}`);
    }
    const postflight = await handle.page.evaluate(({ branchId, productId }) =>
      window.desktopAPI.query.branchStockDetail(branchId, productId), { branchId: planned.branchId, productId: planned.productId });
    const observedRemaining = Number(postflight?.row?.quantity);
    const productPatch = response.productPatches?.find((patch) => patch.id === planned.productId);
    planned.observedRemainingBranchStock = observedRemaining;
    planned.observedRemainingProductStock = Number(productPatch?.quantity);
    if (!postflight?.ok || Math.abs(observedRemaining - planned.expectedRemainingBranchStock) > 1e-9 ||
      !productPatch || Math.abs(Number(productPatch.quantity) - planned.expectedRemainingProductStock) > 1e-9) {
      planned.status = "unexpected-post-sale-stock-divergence";
      throw new Error(`BURST_STOCK_POSTFLIGHT_DIVERGENCE:${planned.ordinal}:${JSON.stringify({ expectedBranch: planned.expectedRemainingBranchStock, observedBranch: observedRemaining, expectedProduct: planned.expectedRemainingProductStock, observedProduct: productPatch?.quantity })}`);
    }
    planned.status = "completed";
    return { elapsed, invoiceId: response.invoice.id, invoiceNumber: response.invoice.invoiceNumber };
  };
  const selectUiCustomer = async () => {
    const customerSelect = handle.page.locator('[data-testid="pos-customer-select"]');
    await customerSelect.locator('button').first().click();
    const customerPortal = handle.page.locator('#searchable-select-portal');
    await customerPortal.locator('input').fill(fixture.customer.name);
    const customerOption = customerPortal.locator('button').filter({ hasText: fixture.customer.name }).first();
    await customerOption.waitFor({ timeout: 30000 });
    await customerOption.click();
  };
  const measure = async (name, action) => {
    const started = performance.now();
    const value = await action();
    const elapsedMs = Number((performance.now() - started).toFixed(3));
    result.journey.push({ name, elapsedMs, ok: true, at: new Date().toISOString() });
    return value;
  };
  await measure("Dashboard", () => handle.page.evaluate(() => window.desktopAPI.storage.getDashboardSummary()));
  await measure("Product Search", () => handle.page.evaluate(() => window.desktopAPI.query.catalogSearch("products", { q: "P", limit: 25 })));
  await measure("Customer Search", () => handle.page.evaluate(() => window.desktopAPI.query.catalogSearch("customers", { q: "C", limit: 25 })));
  await measure("Customer Detail", () => handle.page.evaluate((id) => window.desktopAPI.query.catalogDetail("customers", id), fixture.customer.id));
  await measure("Customer Statement", () => handle.page.evaluate((id) => window.desktopAPI.query.statement("customer", id, { page: 0, pageSize: 25 }), fixture.customer.id));
  await measure("Global Search", () => handle.page.evaluate(() => window.desktopAPI.query.globalSearch({ q: "P", limit: 25 })));
  for (const entity of ["salesInvoices", "purchaseInvoices", "salesReturns", "purchaseReturns", "stockMovements", "quotations", "stockTransfers"]) {
    await measure(entity, () => handle.page.evaluate((value) => window.desktopAPI.query.page(value, { page: 0, pageSize: 25 }), entity));
  }
  await openPos(handle.page);
  await selectUiCustomer();
  result.soak.memoryTimeline.push(await memory(handle, "pre-workload", 0));
  save();

  const controlledNumbers = [];
  for (let index = 0; index < controlledSales; index += 1) {
    const sale = await createUiSale();
    result.controlledSaleLatenciesMs.push(sale.elapsed);
    controlledNumbers.push(sale.invoiceNumber);
    result.workload.completed.sales += 1;
    if ((index + 1) % 25 === 0) { save(); console.log(JSON.stringify({ event: "controlled-sales", completed: index + 1 })); }
  }
  result.controlledSales = { ...stats(result.controlledSaleLatenciesMs), invoiceNumbersAuditedInFinalDatabase: true };
  save();

  await stop(handle);
  handle = await startApp(dbPath);
  await ensureProjectionReady(handle);

  const burstNumbers = [];
  for (let index = 0; index < burstSales; index += 1) {
    const sale = await createDurableSale(index);
    result.burstSaleLatenciesMs.push(sale.elapsed);
    burstNumbers.push(sale.invoiceNumber);
    if ((index + 1) % 25 === 0) { save(); console.log(JSON.stringify({ event: "sale-burst", completed: index + 1 })); }
  }
  const latencyWindows = [[1, 50], [51, 100], [101, 250], [251, 500], [501, 750], [751, 1000]];
  result.saleBurst = {
    ...stats(result.burstSaleLatenciesMs),
    invoiceNumbersAuditedInFinalDatabase: true,
    expected: burstSales,
    latencyWindows: Object.fromEntries(latencyWindows.map(([from, to]) => [
      `${from}-${to}`,
      stats(result.burstSaleLatenciesMs.slice(from - 1, to)),
    ])),
  };
  save();

  await stop(handle);
  handle = await startApp(dbPath);
  await ensureProjectionReady(handle);
  await openPos(handle.page);
  await selectUiCustomer();

  const soakStarted = performance.now();
  let nextCheckpoint = 0;
  let soakIndex = 0;
  const checkpointMinutes = [0, 30, 60, 90, 120];
  while (performance.now() - soakStarted < soakDurationMs) {
    const elapsedMs = performance.now() - soakStarted;
    while (nextCheckpoint < checkpointMinutes.length && elapsedMs >= checkpointMinutes[nextCheckpoint] * 60_000) {
      result.soak.memoryTimeline.push(await memory(handle, `${checkpointMinutes[nextCheckpoint]} min`, elapsedMs));
      nextCheckpoint += 1;
    }
    const sampleStarted = performance.now();
    const timings = await handle.page.evaluate(async ({ customerId, productId }) => {
      const timed = async (fn) => { const began = performance.now(); await fn(); return Number((performance.now() - began).toFixed(3)); };
      return {
        dashboardMs: await timed(() => window.desktopAPI.storage.getDashboardSummary()),
        productSearchMs: await timed(() => window.desktopAPI.query.catalogSearch("products", { q: "P", limit: 25 })),
        customerSearchMs: await timed(() => window.desktopAPI.query.catalogSearch("customers", { q: "C", limit: 25 })),
        globalSearchMs: await timed(() => window.desktopAPI.query.globalSearch({ q: "P", limit: 25 })),
        customerDetailMs: await timed(() => window.desktopAPI.query.catalogDetail("customers", customerId)),
        stockHistoryMs: await timed(() => window.desktopAPI.query.page("stockMovements", { partyId: productId, page: 0, pageSize: 25 })),
      };
    }, { customerId: fixture.customer.id, productId: fixture.sales[0].productId });
    let sale = null;
    if (soakIndex % 5 === 0) sale = await createUiSale();
    const sample = { index: soakIndex, at: new Date().toISOString(), elapsedMs, timings, durableSaleMs: sale?.elapsed || null, cycleMs: performance.now() - sampleStarted };
    result.soak.samples.push(sample);
    if (soakIndex === 0 || elapsedMs >= soakDurationMs / 2 && !result.soak.performanceTimeline.some((row) => row.checkpoint === "midpoint")) {
      result.soak.performanceTimeline.push({ checkpoint: soakIndex === 0 ? "beginning" : "midpoint", ...sample });
    }
    save();
    console.log(JSON.stringify({ event: "soak", sample: soakIndex, elapsedMinutes: Number((elapsedMs / 60_000).toFixed(2)), saleMs: sale?.elapsed || null }));
    soakIndex += 1;
    const waitMs = Math.max(0, soakStarted + soakIndex * soakIntervalMs - performance.now());
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(waitMs, soakIntervalMs)));
  }
  const finalElapsed = performance.now() - soakStarted;
  result.soak.actualDurationMs = finalElapsed;
  result.soak.performanceTimeline.push({ checkpoint: "end", ...(result.soak.samples.at(-1) || {}) });
  if (nextCheckpoint < checkpointMinutes.length) result.soak.memoryTimeline.push(await memory(handle, "120 min", finalElapsed));
  result.soak.completed = true;
  save();

  await kill(handle);
  handle = undefined;
  result.forcedStops.push({ case: "idle/after-activity", result: "terminated", at: new Date().toISOString() });
  handle = await startApp(dbPath);
  await loginMetrics(handle);
  await openPos(handle.page);
  await selectUiCustomer();
  const postRestartSale = await createUiSale();
  await kill(handle);
  handle = undefined;
  result.forcedStops.push({ case: "after successful sale", result: "terminated and committed sale observed on next restart", invoiceNumber: postRestartSale.invoiceNumber });
  handle = await startApp(dbPath);
  const failureCommand = commandForPlannedSale(result.stockSufficiency.sales[0]);
  for (const stage of ["before_sale_persistence", "after_sale_record", "during_stock_update", "before_cash_update", "after_cash_update", "before_commit"]) {
    const response = await handle.page.evaluate(({ command, stage }) => window.desktopAPI.sales.create({ ...command, invoiceId: `phase14-failure-${stage}`, failureStage: stage }), { command: failureCommand, stage });
    result.forcedStops.push({ case: `safe failure harness: ${stage}`, rolledBack: !response.ok, error: response.error });
    if (response.ok) throw new Error(`FAILURE_STAGE_COMMITTED:${stage}`);
  }
  await stop(handle);
  handle = undefined;
  save();

  for (let cycle = 1; cycle <= restartCycles; cycle += 1) {
    const started = performance.now();
    handle = await startApp(dbPath);
    const observed = await loginMetrics(handle);
    await stop(handle);
    handle = undefined;
    result.restarts.push({ cycle, elapsedMs: Number((performance.now() - started).toFixed(3)), projection: observed.projection, salesCount: observed.page.total, ok: true });
    save();
    console.log(JSON.stringify({ event: "restart", cycle }));
  }

  // Exercise the same supported export, encrypted-backup, decrypt and import
  // operations used by the product.  The restored payload is this exact
  // completed certification state, never a hand-edited database value.
  handle = await startApp(dbPath);
  await ensureProjectionReady(handle);
  const backupDir = path.join(runDir, "backup");
  fs.mkdirSync(backupDir, { recursive: true });
  const beforeRestore = await handle.page.evaluate(() => window.desktopAPI.query.page("salesInvoices", { page: 0, pageSize: 1 }));
  const backupPayload = await handle.page.evaluate(() => window.desktopAPI.storage.export());
  const backupText = JSON.stringify(backupPayload);
  const backupPassphrase = "phase14-disposable-certification-only";
  const backupWrite = await handle.page.evaluate(({ dir, content, passphrase }) =>
    window.desktopAPI.backup.writeFile(dir, "phase14-certification", content, passphrase), { dir: backupDir, content: backupText, passphrase: backupPassphrase });
  const encrypted = await handle.page.evaluate(({ content, passphrase }) =>
    window.desktopAPI.backup.encryptContent(content, passphrase), { content: backupText, passphrase: backupPassphrase });
  const decrypted = await handle.page.evaluate(({ content, passphrase }) =>
    window.desktopAPI.backup.decryptContent(content, passphrase), { content: encrypted.encrypted, passphrase: backupPassphrase });
  const restored = await handle.page.evaluate((payload) => window.desktopAPI.storage.import(payload), JSON.parse(decrypted.plaintext));
  const projectionAfterRestore = await ensureProjectionReady(handle);
  const afterRestore = await handle.page.evaluate(() => window.desktopAPI.query.page("salesInvoices", { page: 0, pageSize: 1 }));
  result.backupRestore = {
    exportRows: backupPayload.rows?.length || 0,
    encryptedBackupWritten: Boolean(backupWrite?.ok && backupWrite.path && fs.existsSync(backupWrite.path)),
    decryptMatchesExport: decrypted?.ok === true && decrypted.plaintext === backupText,
    importOk: restored?.ok === true,
    salesCountBefore: beforeRestore.total,
    salesCountAfter: afterRestore.total,
    projectionAfterRestore,
    status: backupWrite?.ok && encrypted?.ok && decrypted?.ok && restored?.ok && beforeRestore.total === afterRestore.total ? "PASS" : "FAIL",
  };
  if (result.backupRestore.status !== "PASS") throw new Error(`BACKUP_RESTORE_FAILED:${JSON.stringify(result.backupRestore)}`);
  await stop(handle);
  handle = undefined;

  result.workload.deviations.push(
    "Purchases, returns, payments, stock adjustments, transfers, quotations and conversions have no bounded authoritative certification IPC equivalent to sales:create; this runner did not fabricate those operations through raw storage writes.",
    "Forced termination after an independently committed stock adjustment and payment was not executed for the same reason.",
  );
  result.final = inspect("final");
  const expectedCreatedSales = result.final.collections.salesInvoices.count - result.initial.collections.salesInvoices.count;
  const reconciliationPath = path.join(reports, "phase14-repeat-reconciliation.json");
  execFileSync(electron, [path.join(root, "scripts", "phase14-reconcile.cjs"), source, dbPath, reconciliationPath, String(expectedCreatedSales)], {
    cwd: root,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", PARTFLOW_PHASE14_WORK_ROOT: workRoot },
    windowsHide: true,
    timeout: 15 * 60_000,
  });
  result.reconciliation = JSON.parse(fs.readFileSync(reconciliationPath, "utf8"));
  if (result.reconciliation.status !== "PASS") throw new Error(`FINAL_RECONCILIATION_FAILED:${JSON.stringify(result.reconciliation.reconciliation)}`);
  result.status = "workload-complete-with-deviations";
} catch (error) {
  result.failures.push(error instanceof Error ? error.stack : String(error));
  result.status = "failed";
  process.exitCode = 1;
} finally {
  if (handle) await stop(handle, true).catch((error) => result.failures.push(String(error)));
  result.controlledSales ||= stats(result.controlledSaleLatenciesMs);
  result.saleBurst ||= stats(result.burstSaleLatenciesMs);
  result.finishedAt = new Date().toISOString();
  save();
  console.log(JSON.stringify({ event: "phase14-finished", status: result.status, progressPath, runDir, failures: result.failures.length }));
}
