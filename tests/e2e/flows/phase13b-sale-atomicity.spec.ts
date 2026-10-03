import { _electron as electron, expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

const sourceDb = process.env.PARTFLOW_STRESS_DB;
const outputPath = process.env.PARTFLOW_PHASE13B_SALE_OUT;

test("Phase 13B bounded sale is atomic, numbered, durable and restart-safe", async () => {
  test.skip(!sourceDb || !outputPath, "Phase 13B sale fixture is required");
  test.setTimeout(10 * 60_000);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "partflow-phase13b-sale-"));
  const dbPath = path.join(scratch, "autoparts-inventory.secure.sqlite");
  fs.copyFileSync(path.resolve(sourceDb!), dbPath);
  const report: Record<string, unknown> = { sourceDb, isolatedDb: dbPath, failures: [] };

  const launch = async () => {
    const env = { ...process.env, NODE_ENV: "test", HW_E2E: "1", HW_E2E_DB_PATH: dbPath } as Record<string, string>;
    delete env.ELECTRON_RENDERER_URL;
    delete env.ELECTRON_RUN_AS_NODE;
    const app = await electron.launch({ args: [path.resolve("electron/main.cjs")], env, timeout: 180_000 });
    const page = await app.firstWindow();
    await page.getByPlaceholder("Login username").fill("admin");
    await page.locator('input[type="password"]').first().fill("stress123");
    await page.getByRole("button", { name: "تسجيل الدخول" }).click();
    await expect(page.getByRole("button", { name: "تسجيل الخروج" })).toBeVisible({ timeout: 180_000 });
    return { app, page };
  };

  let running = await launch();
  try {
    const saleCount = Math.max(1, Number(process.env.PARTFLOW_PHASE13B_SALE_COUNT || 20));
    const saleQuantity = 0.1;
    const rendererHeapMiB = () => running.page.evaluate(() => Number((((performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize || 0) / 1048576).toFixed(1)));
    const heapBeforeSales = await rendererHeapMiB();
    const fixture = await running.page.evaluate(async () => {
      const customer = (await window.desktopAPI!.query!.catalogSearch("customers", { q: "", limit: 1 })).rows![0];
      const branchRows = await window.desktopAPI!.storage.getCollection!("branchStocks");
      const prefix = "autoparts_inventory_v1::branchStocks";
      const base = JSON.parse(branchRows[prefix] || window.desktopAPI!.storage.get(prefix) || "[]");
      const meta = branchRows[`${prefix}#meta`] ? JSON.parse(branchRows[`${prefix}#meta`]) : null;
      const branchStocks = Array.isArray(base) ? base : Array.from({ length: meta?.chunks || 0 }, (_, index) =>
        JSON.parse(branchRows[`${prefix}#${String(index).padStart(4, "0")}`] || "[]"),
      ).flat() as Array<{ branchId: string; productId: string; quantity: number }>;
      let stock: (typeof branchStocks)[number] | undefined;
      let product: { id: string; name: string; unit: string; wholesalePrice: number; quantity: number } | undefined;
      for (const candidate of branchStocks.filter((row) => row.quantity >= 5)) {
        const row = (await window.desktopAPI!.query!.catalogDetail("products", candidate.productId)).row as typeof product;
        if (row && row.quantity >= 5) {
          stock = candidate;
          product = row;
          break;
        }
      }
      if (!stock || !product) throw new Error("PHASE13B_SALE_FIXTURE_STOCK_REQUIRED");
      const beforeSales = await window.desktopAPI!.query!.page("salesInvoices", { page: 0, pageSize: 1 });
      const beforeDashboard = await window.desktopAPI!.storage.getDashboardSummary!() as { stats: { cashBalance: number } };
      return { customer, stock, product, beforeSales: beforeSales.total!, beforeCash: beforeDashboard.stats.cashBalance };
    });

    const baseCommand = await running.page.evaluate(({ fixture, saleQuantity }) => ({
      invoice: {
        invoiceNumber: "renderer-must-not-authorize-number",
        date: new Date().toISOString().slice(0, 10),
        customerId: fixture.customer.id,
        customerName: "renderer-name-is-not-authoritative",
        lines: [{ id: "line-atomic", productId: fixture.product.id, productName: fixture.product.name, unit: fixture.product.unit, quantity: saleQuantity, price: fixture.product.wholesalePrice, subtotal: fixture.product.wholesalePrice * saleQuantity, priceType: "wholesale" }],
        total: fixture.product.wholesalePrice * saleQuantity,
        amountReceived: fixture.product.wholesalePrice * saleQuantity,
        paymentType: "cash",
        paymentMethod: "cash",
        priceType: "wholesale",
        branchId: fixture.stock.branchId,
      },
    }), { fixture, saleQuantity });

    for (const stage of ["before_sale_persistence", "after_sale_record", "during_stock_update", "before_cash_update", "after_cash_update", "before_commit"]) {
      const result = await running.page.evaluate(async ({ command, stage }) =>
        window.desktopAPI!.sales!.create({ ...command, invoiceId: `failed-${stage}`, failureStage: stage }), { command: baseCommand, stage });
      expect(result.ok).toBe(false);
      const state = await running.page.evaluate(async ({ invoiceId, productId }) => ({
        invoice: await window.desktopAPI!.query!.detail("salesInvoices", invoiceId),
        product: await window.desktopAPI!.query!.catalogDetail("products", productId),
        count: (await window.desktopAPI!.query!.page("salesInvoices", { page: 0, pageSize: 1 })).total,
      }), { invoiceId: `failed-${stage}`, productId: fixture.product.id });
      expect(state.invoice.row).toBeNull();
      expect(state.count).toBe(fixture.beforeSales);
      expect((state.product.row as { quantity: number }).quantity).toBe(fixture.product.quantity);
      (report.failures as unknown[]).push({ stage, rolledBack: true });
    }

    const successes = [];
    const durableValues: number[] = [];
    for (let index = 0; index < saleCount; index += 1) {
      const started = performance.now();
      successes.push(await running.page.evaluate(async ({ command, index }) =>
        window.desktopAPI!.sales!.create({ ...command, invoiceId: `phase13b-sale-${index}` }), { command: baseCommand, index }));
      durableValues.push(performance.now() - started);
    }
    report.successResults = successes;
    expect(successes.every((result) => result.ok && result.invoice)).toBe(true);
    expect(new Set(successes.map((result) => result.invoice!.invoiceNumber)).size).toBe(saleCount);
    expect(successes.every((result) => result.invoice!.invoiceNumber !== "renderer-must-not-authorize-number")).toBe(true);
    const invoiceIds = successes.map((result) => result.invoice!.id);

    const after = await running.page.evaluate(async ({ fixture, invoiceIds }) => {
      const invoices = await Promise.all(invoiceIds.map((id) => window.desktopAPI!.query!.detail("salesInvoices", id)));
      const product = await window.desktopAPI!.query!.catalogDetail("products", fixture.product.id);
      const ledger = await window.desktopAPI!.query!.page("stockMovements", { partyId: fixture.product.id, page: 0, pageSize: 20 });
      const dashboard = await window.desktopAPI!.storage.getDashboardSummary!() as { stats: { cashBalance: number } };
      const branch = await window.desktopAPI!.query!.branchStockDetail(fixture.stock.branchId, fixture.product.id);
      return { invoices, product: product.row as { quantity: number }, ledger: ledger.rows, cash: dashboard.stats.cashBalance, branch: branch.row };
    }, { fixture, invoiceIds });
    expect(after.invoices.every((result) => result.row)).toBe(true);
    expect(after.product.quantity).toBeCloseTo(fixture.product.quantity - saleCount * saleQuantity, 6);
    expect(after.branch).toBeTruthy();
    expect(after.branch!.quantity).toBeCloseTo(fixture.stock.quantity - saleCount * saleQuantity, 6);
    expect((after.ledger as Array<{ referenceId?: string }>).filter((row) => invoiceIds.includes(row.referenceId || ""))).toHaveLength(saleCount);
    expect(after.cash).toBeCloseTo(fixture.beforeCash + fixture.product.wholesalePrice * saleCount * saleQuantity, 2);
    const heapAfterSales = await rendererHeapMiB();
    const metricsAfterSales = await running.app.evaluate(({ app }) => app.getAppMetrics().map((metric) => ({
      type: metric.type,
      workingSetMiB: Number(((metric.memory?.workingSetSize || 0) / 1024).toFixed(1)),
      peakWorkingSetMiB: Number(((metric.memory?.peakWorkingSetSize || 0) / 1024).toFixed(1)),
    })));

    // The test invokes the bounded IPC directly, so the React store never
    // receives the returned product patches. Kill here instead of allowing
    // that deliberately stale test renderer to flush its pre-sale cache.
    const mainPid = running.app.process().pid;
    if (process.platform === "win32") {
      execFileSync("taskkill.exe", ["/PID", String(mainPid), "/T", "/F"], { windowsHide: true });
    } else {
      running.app.process().kill("SIGKILL");
    }
    await running.app.waitForEvent("close", { timeout: 30_000 }).catch(() => undefined);
    running = await launch();
    const restarted = await running.page.evaluate(async ({ invoiceIds, fixture }) => ({
      invoices: await Promise.all(invoiceIds.map((id) => window.desktopAPI!.query!.detail("salesInvoices", id))),
      product: await window.desktopAPI!.query!.catalogDetail("products", fixture.product.id),
      branch: await window.desktopAPI!.query!.branchStockDetail(fixture.stock.branchId, fixture.product.id),
      ledger: await window.desktopAPI!.query!.page("stockMovements", { partyId: fixture.product.id, page: 0, pageSize: 30 }),
      customer: await window.desktopAPI!.query!.catalogDetail("customers", fixture.customer.id),
      dashboard: await window.desktopAPI!.storage.getDashboardSummary!() as { stats: { cashBalance: number } },
    }), { invoiceIds, fixture });
    expect(restarted.invoices.every((result) => result.row)).toBe(true);
    expect((restarted.product.row as { quantity: number }).quantity).toBeCloseTo(fixture.product.quantity - saleCount * saleQuantity, 6);
    expect(restarted.branch.row?.quantity).toBeCloseTo(fixture.stock.quantity - saleCount * saleQuantity, 6);
    expect((restarted.ledger.rows as Array<{ referenceId?: string }>).filter((row) => invoiceIds.includes(row.referenceId || ""))).toHaveLength(saleCount);
    expect(restarted.dashboard.stats.cashBalance).toBeCloseTo(fixture.beforeCash + fixture.product.wholesalePrice * saleCount * saleQuantity, 2);
    expect((restarted.customer.row as { financialSummary?: { balance?: number } }).financialSummary?.balance || 0).toBeCloseTo(fixture.customer.balance || 0, 2);
    const sortedDurable = [...durableValues].sort((a, b) => a - b);
    report.durableSale = {
      values: durableValues.map((value) => Number(value.toFixed(3))),
      p50Ms: Number(sortedDurable[Math.ceil(sortedDurable.length * 0.5) - 1].toFixed(3)),
      p95Ms: Number(sortedDurable[Math.ceil(sortedDurable.length * 0.95) - 1].toFixed(3)),
    };
    report.invoiceNumbers = successes.map((result) => result.invoice!.invoiceNumber);
    report.restartVerified = true;
    report.integrity = "verified-by-successful-encrypted-restart-and-projection-reads";
    report.memory = { heapBeforeSales, heapAfterSales, metricsAfterSales };
  } finally {
    await running.app.close().catch(() => undefined);
    fs.mkdirSync(path.dirname(path.resolve(outputPath!)), { recursive: true });
    fs.writeFileSync(path.resolve(outputPath!), `${JSON.stringify(report, null, 2)}\n`);
    try { fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); }
    catch { report.cleanupDeferred = true; }
  }
});
