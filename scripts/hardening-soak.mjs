import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { expect } from "@playwright/test";
import {
  native,
  openPos,
  sell,
  stableCapture,
  startApp,
  stop,
} from "./hardening-critical-baseline.mjs";

const root = process.cwd();
const phase = process.env.PARTFLOW_HARDENING_PHASE || "phase-7";
const work = path.join(root, "reports/production-hardening-2026-09", phase);
const source = process.env.PARTFLOW_HARDENING_SOURCE_DB ||
  JSON.parse(fs.readFileSync(path.join(root, "reports/system-audit-2026-09-14/load-small.json"), "utf8")).sourceDb;
const durationMs = Number(process.env.PARTFLOW_SOAK_DURATION_MS || 60 * 60_000);
const intervalMs = Number(process.env.PARTFLOW_SOAK_INTERVAL_MS || 60_000);
const iterations = Number(process.env.PARTFLOW_SOAK_ITERATIONS || 60);

if (durationMs < intervalMs || iterations < 1) throw new Error("INVALID_SOAK_CONFIGURATION");
fs.mkdirSync(work, { recursive: true });
const folder = fs.mkdtempSync(path.join(work, "soak-"));
const db = path.join(folder, "autoparts-inventory.secure.sqlite");
const reportPath = path.join(work, "soak.json");
fs.copyFileSync(source, db);

const result = {
  source,
  db,
  startedAt: new Date().toISOString(),
  configuredDurationMs: durationMs,
  configuredIntervalMs: intervalMs,
  configuredIterations: iterations,
  scope: "Isolated encrypted fixture; one POS search and durable sale per minute; independent SQLite inspection after close and after restart",
  samples: [],
  rendererErrors: [],
  consoleErrors: [],
};
const save = () => fs.writeFileSync(reportPath, JSON.stringify(result, null, 2));
const comparable = (snapshot, name) => {
  const value = { ...snapshot.collections[name] };
  delete value.rows;
  return value;
};
const runtimeComparable = (snapshot, name) => ({ ...snapshot[name] });

let handle;
try {
  result.before = native("inspect", db, path.join(folder, "native-before.json"));
  handle = await startApp(db);
  handle.page.on("pageerror", (error) => result.rendererErrors.push(error.stack || error.message));
  handle.page.on("console", (message) => {
    if (message.type() === "error") result.consoleErrors.push(message.text());
  });
  result.beforeRuntime = await stableCapture(handle.page);
  await openPos(handle.page);

  const began = performance.now();
  for (let index = 0; index < iterations; index += 1) {
    const scheduledAt = began + index * intervalMs;
    while (performance.now() < scheduledAt) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(5_000, scheduledAt - performance.now())));
    }

    const searchStarted = performance.now();
    const search = handle.page.getByPlaceholder("ابحث عن منتج بالاسم أو الرمز...");
    await search.fill(index % 2 === 0 ? "فلتر" : "تيل");
    await expect(handle.page.locator('[data-testid="pos-product-tile"]:not([disabled])').first())
      .toBeVisible({ timeout: 30_000 });
    const searchMs = performance.now() - searchStarted;
    await search.fill("");

    const sale = await sell(handle.page);
    const expectedInvoices = result.before.collections.salesInvoices.count + index + 1;
    const durableStarted = performance.now();
    let durableInvoices = 0;
    while (performance.now() - durableStarted < 60_000) {
      durableInvoices = await handle.page.evaluate(() => {
        const prefix = "autoparts_inventory_v1::salesInvoices";
        const metadata = window.desktopAPI.storage.get(`${prefix}#meta`);
        return metadata
          ? JSON.parse(metadata).total
          : JSON.parse(window.desktopAPI.storage.get(prefix) || "[]").length;
      });
      if (durableInvoices === expectedInvoices) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    expect(durableInvoices, "sale did not become durable within 60 seconds").toBe(expectedInvoices);

    const nextSale = handle.page.getByRole("button", { name: "عملية بيع جديدة", exact: true });
    await nextSale.click({ noWaitAfter: true, timeout: 30_000 });
    await expect(handle.page.locator('[data-testid="pos-product-tile"]:not([disabled])').first())
      .toBeVisible({ timeout: 30_000 });

    const appMetrics = await handle.app.evaluate(({ app }) => app.getAppMetrics().map((metric) => ({
      type: metric.type,
      privateBytes: metric.memory?.privateBytes,
      workingSetSize: metric.memory?.workingSetSize,
      cpu: metric.cpu?.percentCPUUsage,
    })));
    result.samples.push({
      index: index + 1,
      at: new Date().toISOString(),
      elapsedMs: performance.now() - began,
      searchMs,
      sale,
      durableObservedMs: performance.now() - durableStarted,
      invoiceCount: durableInvoices,
      freeMemory: os.freemem(),
      appMetrics,
    });
    save();
    console.log(JSON.stringify({
      event: "soak-progress",
      sample: index + 1,
      elapsedMinutes: Number(((performance.now() - began) / 60_000).toFixed(2)),
      invoiceCount: durableInvoices,
      saleMs: Math.round(sale.completionMs),
    }));
  }

  while (performance.now() - began < durationMs) {
    const remainingMs = durationMs - (performance.now() - began);
    await new Promise((resolve) => setTimeout(resolve, Math.max(1, Math.min(5_000, remainingMs))));
  }
  result.actualDurationMs = performance.now() - began;
  result.beforeClose = await stableCapture(handle.page);
  result.firstExit = await stop(handle);
  handle = undefined;
  result.afterClose = native("inspect", db, path.join(folder, "native-after-close.json"));

  handle = await startApp(db);
  await stableCapture(handle.page);
  result.restartExit = await stop(handle);
  handle = undefined;
  result.afterRestart = native("inspect", db, path.join(folder, "native-after-restart.json"));

  const tracked = ["salesInvoices", "cashEntries", "products", "stockMovements", "branchStocks"];
  for (const name of tracked) {
    expect(comparable(result.afterClose, name), `${name} was not durable at close`)
      .toEqual(runtimeComparable(result.beforeClose, name));
    expect(comparable(result.afterRestart, name), `${name} changed across restart`)
      .toEqual(comparable(result.afterClose, name));
  }
  expect(result.afterClose.collections.salesInvoices.count - result.beforeRuntime.salesInvoices.count)
    .toBe(iterations);
  expect(result.afterClose.collections.cashEntries.count - result.beforeRuntime.cashEntries.count)
    .toBe(iterations);
  expect(result.afterClose.collections.stockMovements.count - result.beforeRuntime.stockMovements.count)
    .toBe(iterations);
  expect(result.beforeRuntime.products.quantity - result.afterClose.collections.products.quantity)
    .toBe(iterations);
  expect(result.beforeRuntime.branchStocks.quantity - result.afterClose.collections.branchStocks.quantity)
    .toBe(iterations);
  expect(result.afterClose.integrity).toEqual([{ integrity_check: "ok" }]);
  expect(result.afterRestart.integrity).toEqual([{ integrity_check: "ok" }]);
  expect(result.rendererErrors, result.rendererErrors.join("\n\n")).toEqual([]);

  result.outcome = "passed";
} catch (error) {
  result.outcome = "failed";
  result.error = error instanceof Error ? error.stack : String(error);
  process.exitCode = 1;
} finally {
  if (handle) await stop(handle, true).catch((error) => {
    result.cleanupError = error instanceof Error ? error.stack : String(error);
    process.exitCode = 1;
  });
  result.finishedAt = new Date().toISOString();
  save();
  console.log(JSON.stringify({
    event: "soak-finished",
    outcome: result.outcome,
    samples: result.samples.length,
    actualDurationMs: result.actualDurationMs,
    error: result.error,
  }));
}
