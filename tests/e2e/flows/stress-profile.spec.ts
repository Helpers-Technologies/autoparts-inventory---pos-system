/**
 * Opt-in, destructive-on-a-copy stress audit for a mature PartFlow shop.
 *
 * The source database is never opened by the app.  The test copies it to an
 * isolated directory, signs in through the real Electron UI, visits every
 * feature route, exercises global search, validates rejected and accepted cash
 * entries, and completes a real POS sale.  It is intentionally excluded from
 * normal E2E runs unless PARTFLOW_STRESS_DB is set.
 *
 * Example:
 *   PARTFLOW_STRESS_DB=../PartFlow-stress-profile/autoparts-inventory.secure.sqlite \
 *   PARTFLOW_STRESS_TMPDIR=/mnt/data/partflow-test-tmp \
 *   PARTFLOW_KEEP_STRESS_COPY=1 \
 *   npx playwright test tests/e2e/flows/stress-profile.spec.ts
 */
import { _electron as electron, expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { performance } from "node:perf_hooks";

const sourceDb = process.env.PARTFLOW_STRESS_DB;

type RouteResult = {
  path: string;
  milliseconds: number;
  bodyCharacters: number;
  outcome: "ok" | "error";
  detail?: string;
};

const ROUTES = [
  "/",
  "/products",
  "/customers",
  "/suppliers",
  "/purchases",
  "/sales",
  "/returns",
  "/quotations",
  "/shifts",
  "/cashbox",
  "/dues",
  "/reports",
  "/reports/financial",
  "/reports/analytics",
  "/reports/employees",
  "/alerts",
  "/customer-garage",
  "/vehicle-catalog",
  "/part-alternatives",
  "/parts-finder",
  "/warranty-center",
  "/purchasing-assistant",
  "/branches",
  "/stocktakes",
  "/pricing-rules",
  "/shipping",
  "/drivers",
  "/marketing",
  "/employees",
  "/users",
  "/audit-log",
  "/import",
  "/integrations",
  "/settings",
  "/help",
  // Keep the ledger-hydrating and transaction-heavy pages last so their memory
  // cost does not contaminate every earlier route measurement.
  "/inventory",
  "/pos",
] as const;

async function dismissWhatsNew(page: import("@playwright/test").Page) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const button = page.getByRole("button", { name: "تمام، فهمت" }).first();
    if (!(await button.isVisible({ timeout: 500 }).catch(() => false))) return;
    const clicked = await button
      .evaluate((element) => (element as HTMLButtonElement).click())
      .then(() => true)
      .catch(() => false);
    if (clicked) {
      await expect(button).toBeHidden({ timeout: 3_000 }).catch(() => undefined);
      return;
    }
  }
}

async function appMemory(electronApp: import("@playwright/test").ElectronApplication) {
  return electronApp.evaluate(({ app }) =>
    app.getAppMetrics().map((metric) => ({
      type: metric.type,
      pid: metric.pid,
      workingSetKb: metric.memory.workingSetSize,
      peakWorkingSetKb: metric.memory.peakWorkingSetSize,
      privateKb: metric.memory.privateBytes,
    })),
  );
}

test.describe("opt-in five-year stress profile", () => {
  test.skip(!sourceDb, "Set PARTFLOW_STRESS_DB to run the isolated heavy-profile audit");

  // Playwright hands fixtures first and testInfo second, and this suite
  // deliberately takes NO fixtures: asking for `page` would spin up a
  // Chromium browser alongside the Electron app under test.
  // eslint-disable-next-line no-empty-pattern
  test("opens every feature and completes real work under mature-shop load", async ({}, testInfo) => {
    test.setTimeout(20 * 60_000);
    if (!sourceDb) return;

    const resolvedSource = path.resolve(sourceDb);
    if (!fs.existsSync(resolvedSource)) throw new Error(`stress database not found: ${resolvedSource}`);

    const tempRoot = path.resolve(process.env.PARTFLOW_STRESS_TMPDIR || os.tmpdir());
    fs.mkdirSync(tempRoot, { recursive: true });
    const profileDir = fs.mkdtempSync(path.join(tempRoot, "partflow-stress-ui-"));
    const dbPath = path.join(profileDir, "autoparts-inventory.secure.sqlite");
    fs.copyFileSync(resolvedSource, dbPath);
    console.log(`[stress] isolated database: ${dbPath}`);

    const report: {
      sourceBytes: number;
      copyPath: string;
      launchMs?: number;
      loginMs?: number;
      routes: RouteResult[];
      search?: Record<string, number>;
      cashEntry?: Record<string, number | boolean>;
      posSale?: Record<string, number | boolean>;
      rendererErrors: string[];
      consoleErrors: string[];
      memory?: unknown;
    } = {
      sourceBytes: fs.statSync(resolvedSource).size,
      copyPath: dbPath,
      routes: [],
      rendererErrors: [],
      consoleErrors: [],
    };

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: "test",
      HW_E2E: "1",
      HW_E2E_DB_PATH: dbPath,
    };
    delete env.ELECTRON_RENDERER_URL;
    delete env.ELECTRON_RUN_AS_NODE;

    let electronApp: import("@playwright/test").ElectronApplication | undefined;
    try {
      const launchStarted = performance.now();
      electronApp = await electron.launch({
        args: [path.resolve("electron/main.cjs")],
        env: env as Record<string, string>,
        timeout: 180_000,
      });
      const page = await electronApp.firstWindow();
      await page.waitForLoadState("domcontentloaded");
      report.launchMs = performance.now() - launchStarted;

      page.on("pageerror", (error) => report.rendererErrors.push(error.stack || error.message));
      page.on("console", (message) => {
        if (message.type() === "error") report.consoleErrors.push(message.text());
      });

      await expect(page.getByPlaceholder("Login username")).toBeVisible({ timeout: 180_000 });
      await page.getByPlaceholder("Login username").fill("admin");
      await page.locator('input[type="password"]').first().fill("stress123");
      const loginStarted = performance.now();
      await page.getByRole("button", { name: "تسجيل الدخول" }).click();
      await expect(page.getByRole("button", { name: "تسجيل الخروج" })).toBeVisible({ timeout: 240_000 });
      report.loginMs = performance.now() - loginStarted;
      await dismissWhatsNew(page);

      // Allow the first debounced persistence pass to finish before route
      // timings.  Otherwise its one-off cost is attributed to whichever page
      // happens to be visited two seconds after sign-in.
      await page.waitForTimeout(5_000);

      for (const route of ROUTES) {
        const before = await page.locator("main").innerText().catch(() => "");
        const started = performance.now();
        try {
          await page.evaluate((nextRoute) => {
            window.location.hash = nextRoute;
          }, route);
          await page.waitForFunction(
            ({ nextRoute, previousText }) => {
              const main = document.querySelector("main");
              const text = main?.textContent?.trim() || "";
              const expectedHash = `#${nextRoute}`;
              return window.location.hash === expectedHash && text.length > 0 &&
                (nextRoute === "/" || text !== previousText);
            },
            { nextRoute: route, previousText: before },
            { timeout: 120_000 },
          );
          // Two paints make the number include React rendering rather than only
          // the hash update callback.
          await page.evaluate(() => new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
          const bodyText = await page.locator("body").innerText();
          const failed = bodyText.includes("حدث خطأ غير متوقع");
          report.routes.push({
            path: route,
            milliseconds: performance.now() - started,
            bodyCharacters: bodyText.length,
            outcome: failed ? "error" : "ok",
            detail: failed ? "global error boundary rendered" : undefined,
          });
        } catch (error) {
          report.routes.push({
            path: route,
            milliseconds: performance.now() - started,
            bodyCharacters: 0,
            outcome: "error",
            detail: error instanceof Error ? error.message : String(error),
          });
        }
      }

      // Global search builds an index over products, customers and every line
      // in both invoice histories; this is one of the most expensive real UI
      // actions on a mature shop.
      await page.evaluate(() => { window.location.hash = "/"; });
      await expect(page.getByRole("heading", { name: "لوحة التحكم" })).toBeVisible({ timeout: 120_000 });
      const searchOpenStarted = performance.now();
      await page.getByRole("button", { name: /بحث شامل عن منتج/ }).click();
      const searchInput = page.getByPlaceholder("رقم القطعة، OEM، باركود، سيارة، عميل أو فاتورة...");
      await expect(searchInput).toBeVisible({ timeout: 120_000 });
      const searchOpenMs = performance.now() - searchOpenStarted;
      const searchQueryStarted = performance.now();
      await searchInput.fill("فلتر");
      await expect(page.locator("[data-idx]").first()).toBeVisible({ timeout: 120_000 });
      report.search = {
        openMs: searchOpenMs,
        queryMs: performance.now() - searchQueryStarted,
        renderedResults: await page.locator("[data-idx]").count(),
      };
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");

      // Invalid and valid input through the real cashbox dialog.  The payload
      // also proves that stored user text remains inert when rendered.
      await page.evaluate(() => { window.location.hash = "/cashbox"; });
      await expect(page.getByRole("button", { name: "إضافة نقدية" })).toBeVisible({ timeout: 120_000 });
      await page.getByRole("button", { name: "إضافة نقدية" }).click();
      const cashDialog = page.getByRole("dialog", { name: "إضافة نقدية" });
      await cashDialog.getByRole("button", { name: "حفظ" }).click();
      const rejectedEmpty = await page.getByText("المبلغ يجب أن يكون أكبر من صفر").isVisible();
      await cashDialog.locator('input[type="number"]').fill("123.45");
      const xssProbe = 'AUDIT-XSS <img src=x onerror="window.__partflowAuditXss=1">';
      await page.evaluate(() => { (window as unknown as { __partflowAuditXss: number }).__partflowAuditXss = 0; });
      await cashDialog.getByPlaceholder(/إيداع من صاحب المحل/).fill(xssProbe);
      const cashStarted = performance.now();
      await cashDialog.getByRole("button", { name: "حفظ" }).click();
      await expect(page.getByText("تم إضافة نقدية")).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText(xssProbe)).toBeVisible({ timeout: 30_000 });
      const xssExecuted = await page.evaluate(() =>
        Boolean((window as unknown as { __partflowAuditXss?: number }).__partflowAuditXss));
      report.cashEntry = {
        rejectedEmpty,
        saveUiMs: performance.now() - cashStarted,
        xssExecuted,
      };

      // Complete one sale through the real POS.  A 2.5s in-renderer timer is
      // started before checkout; any synchronous serialization freeze caused by
      // the 2s debounce appears as positive timer drift.
      await page.evaluate(() => { window.location.hash = "/pos"; });
      await expect(page.getByText("سلة المشتريات فارغة")).toBeVisible({ timeout: 120_000 });
      const openShift = page.getByRole("button", { name: "فتح وردية" });
      if (await openShift.isVisible().catch(() => false)) {
        await openShift.click();
        const shiftDialog = page.getByRole("dialog", { name: "بدء وتفعيل وردية الكاشير" });
        await shiftDialog.locator('input[type="number"]').fill("500");
        await shiftDialog.getByRole("button", { name: "بدء الوردية الآن" }).click();
        await expect(page.getByRole("button", { name: "إغلاق الوردية" })).toBeVisible({ timeout: 30_000 });
      }

      const productCards = page.getByRole("button").filter({ hasText: "متاح:" });
      let selected = false;
      for (let index = 0; index < Math.min(await productCards.count(), 40); index += 1) {
        const card = productCards.nth(index);
        if (await card.isEnabled()) {
          await card.click();
          selected = true;
          break;
        }
      }
      if (!selected) throw new Error("no in-stock POS product was rendered in the first virtual page");

      const timerPromise = page.evaluate(() => new Promise<number>((resolve) => {
        const started = performance.now();
        window.setTimeout(() => resolve(performance.now() - started), 2_500);
      }));
      const saleStarted = performance.now();
      await page.getByRole("button", { name: /إتمام البيع/ }).click();
      await expect(page.getByText("تم حفظ الفاتورة بنجاح!")).toBeVisible({ timeout: 120_000 });
      const modalMs = performance.now() - saleStarted;
      const timerElapsed = await timerPromise;
      report.posSale = {
        completed: true,
        modalMs,
        debounceTimerDriftMs: Math.max(0, timerElapsed - 2_500),
      };

      report.memory = await appMemory(electronApp);
      await page.screenshot({ path: testInfo.outputPath("stress-final.png"), fullPage: false });

      const failedRoutes = report.routes.filter((row) => row.outcome === "error");
      expect(report.cashEntry?.rejectedEmpty).toBe(true);
      expect(report.cashEntry?.xssExecuted).toBe(false);
      expect(report.posSale?.completed).toBe(true);
      expect(failedRoutes, JSON.stringify(failedRoutes, null, 2)).toEqual([]);
      expect(report.rendererErrors, report.rendererErrors.join("\n\n")).toEqual([]);
    } finally {
      if (electronApp) await electronApp.close().catch(() => undefined);
      const json = JSON.stringify(report, null, 2);
      fs.writeFileSync(testInfo.outputPath("stress-audit.json"), json);
      await testInfo.attach("stress-audit", { body: json, contentType: "application/json" });
      if (process.env.PARTFLOW_KEEP_STRESS_COPY !== "1") {
        fs.rmSync(profileDir, { recursive: true, force: true });
      } else {
        console.log(`[stress] kept isolated copy: ${profileDir}`);
      }
    }
  });
});
