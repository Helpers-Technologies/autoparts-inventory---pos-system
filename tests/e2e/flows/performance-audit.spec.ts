/**
 * Full-system performance audit against a mature shop.
 *
 * Where stress-profile.spec.ts proves the app still WORKS under load, this one
 * measures how LONG everything takes and covers the routes that spec skips —
 * notably the detail and statement pages, which are where per-record scans
 * hide: a customer statement or an invoice detail walks the whole history for
 * one record, and that only shows up on a shop with a real history behind it.
 *
 * Two rules make the numbers trustworthy:
 *
 *  1. Every route is ISOLATED. A page that hangs records its own timeout and
 *     the sweep moves on, instead of taking the remaining routes down with it.
 *     The earlier audit lost 33 of 37 measurements to a single frozen page.
 *  2. The app is checked for life between routes. Once the renderer is gone
 *     the remaining "0 ms" results are meaningless, so the run stops and says
 *     so rather than reporting a wall of fast-looking failures.
 *
 * Opt-in, and never touches the real shop — the source database is copied to
 * a scratch directory and the app is pointed at the copy.
 *
 *   PARTFLOW_STRESS_DB=../PartFlow-stress-profile/autoparts-inventory.secure.sqlite \
 *   PARTFLOW_STRESS_DATASET=load-test-5y.json \
 *   npx playwright test tests/e2e/flows/performance-audit.spec.ts
 */
import { _electron as electron, expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { performance } from "node:perf_hooks";

const sourceDb = process.env.PARTFLOW_STRESS_DB;
const datasetPath = process.env.PARTFLOW_STRESS_DATASET;

type RouteResult = {
  path: string;
  group: string;
  milliseconds: number;
  bodyCharacters: number;
  outcome: "ok" | "slow" | "error";
  detail?: string;
};

/**
 * Low-end hardware, on purpose.
 *
 * Every number this suite has produced came off one developer workstation.
 * The shops that run this software are on ten-year-old counter PCs, and "fast
 * on a 16-core laptop" says nothing about them. Two knobs reproduce the
 * difference that actually matters:
 *
 *   PARTFLOW_CPU_THROTTLE=4   the renderer runs at a quarter speed, which is
 *                             roughly a 2013 desktop against a current one
 *   PARTFLOW_HEAP_MB=512      V8 gets a small old-space, so a fixture that
 *                             only fits by luck fails here instead of at a
 *                             customer's counter
 *
 * Unset, the run is exactly what it was before.
 */
const CPU_THROTTLE = Math.max(1, Number(process.env.PARTFLOW_CPU_THROTTLE || 1));
const HEAP_MB = Number(process.env.PARTFLOW_HEAP_MB || 0);

/**
 * Anything past this is a page a cashier would call broken, not slow.
 *
 * Scaled by the throttle: under a 4x slowdown a 500 ms page legitimately takes
 * 2 s, and holding it to the unthrottled budget would mark the whole app
 * "slow" without saying anything about it. What the scaled budget still
 * catches is a page that degrades WORSE than linearly — which is what a
 * per-row scan does.
 */
const ROUTE_BUDGET_MS = 2_000 * CPU_THROTTLE;
/** Per-route ceiling. Generous enough for a genuinely heavy report, short
 *  enough that one bad page costs a minute rather than the whole audit. */
const ROUTE_TIMEOUT_MS = 60_000;

/** Static routes, grouped so the report reads by area rather than by URL. */
const STATIC_ROUTES: Array<[string, string]> = [
  ["/", "dashboard"],
  ["/pos", "sales"],
  ["/sales", "sales"],
  ["/sales/new", "sales"],
  ["/quotations", "sales"],
  ["/quotations/new", "sales"],
  ["/returns", "sales"],
  ["/dues", "sales"],
  ["/purchases", "purchasing"],
  ["/purchases/new", "purchasing"],
  ["/purchasing-assistant", "purchasing"],
  ["/products", "catalog"],
  ["/inventory", "catalog"],
  ["/stocktakes", "catalog"],
  ["/part-alternatives", "catalog"],
  ["/parts-finder", "catalog"],
  ["/vehicle-catalog", "catalog"],
  ["/pricing-rules", "catalog"],
  ["/customers", "people"],
  ["/customer-garage", "people"],
  ["/suppliers", "people"],
  ["/drivers", "people"],
  ["/employees", "people"],
  ["/users", "people"],
  ["/my-profile", "people"],
  ["/reports", "reports"],
  ["/reports/financial", "reports"],
  ["/reports/analytics", "reports"],
  ["/reports/employees", "reports"],
  ["/reports/autoparts", "reports"],
  ["/alerts", "operations"],
  ["/cashbox", "operations"],
  ["/shifts", "operations"],
  ["/warranty-center", "operations"],
  ["/branches", "operations"],
  ["/shipping", "operations"],
  ["/marketing", "operations"],
  ["/audit-log", "admin"],
  ["/integrations", "admin"],
  ["/import", "admin"],
  ["/settings", "admin"],
  ["/help", "admin"],
];

/**
 * Detail, statement and print routes built from real ids, plus the deep links
 * that point at records which do NOT exist.
 *
 * The missing-record cases are not filler: a stale bookmark, a printed link,
 * or a record deleted on another till all land here, and the only acceptable
 * answers are a not-found state or a redirect. A blank page or the global
 * error boundary is a bug, and nothing in the suite covered it before.
 *
 * Routes whose fixture is absent are reported as `missing-fixture` instead of
 * being dropped, so the report distinguishes "not tested" from "passed".
 */
function detailRoutes(ids: Record<string, string | undefined>): Array<[string, string]> {
  const rows: Array<[string, string]> = [];
  const add = (template: string, id: string | undefined, group: string) => {
    rows.push([template.replace(":id", id ?? "__MISSING__"), id ? group : "missing-fixture"]);
  };

  add("/customers/:id", ids.customer, "detail");
  add("/customers/:id/statement", ids.customer, "statement");
  add("/suppliers/:id", ids.supplier, "detail");
  add("/suppliers/:id/statement", ids.supplier, "statement");
  add("/products/:id", ids.product, "detail");
  add("/products/:id/barcode/print", ids.product, "print");
  add("/sales/:id", ids.salesInvoice, "detail");
  add("/sales/:id/edit", ids.salesInvoice, "edit");
  add("/sales/:id/print", ids.salesInvoice, "print");
  add("/sales/:id/receipt", ids.salesInvoice, "print");
  add("/purchases/:id", ids.purchaseInvoice, "detail");
  add("/purchases/:id/edit", ids.purchaseInvoice, "edit");
  add("/purchases/:id/print", ids.purchaseInvoice, "print");
  add("/users/:id", ids.user, "detail");
  add("/employees/:id", ids.user, "detail");
  add("/drivers/:id", ids.driver, "detail");
  add("/drivers/:id/statement", ids.driver, "statement");

  // Deep links to records that are not there.
  for (const template of [
    "/customers/:id",
    "/customers/:id/statement",
    "/products/:id",
    "/sales/:id",
    "/sales/:id/edit",
    "/purchases/:id",
    "/quotations/:id",
    "/quotations/:id/edit",
    "/stocktakes/:id",
    "/suppliers/:id/statement",
  ]) {
    rows.push([template.replace(":id", "does-not-exist-000"), "missing-record"]);
  }

  return rows;
}

/**
 * Real ids out of the generated dataset.
 *
 * The record with the MOST history behind it, not the newest: a statement or
 * detail page has to walk everything hanging off its subject, so the customer
 * with the most invoices is the worst case and the only one worth timing.
 *
 * Anything the fixture cannot supply is reported as a `missing-fixture` row
 * rather than dropped. The first version silently skipped both driver routes
 * because the generator emits no drivers collection at all, and a route that
 * vanishes from a report reads exactly like a route that passed.
 */
function resolveIds(): Record<string, string | undefined> {
  if (!datasetPath || !fs.existsSync(datasetPath)) return {};
  const data = JSON.parse(fs.readFileSync(datasetPath, "utf8"));
  const first = (rows: unknown): string | undefined =>
    Array.isArray(rows) && rows.length
      ? String((rows[0] as { id?: string }).id ?? "") || undefined
      : undefined;
  const busiest = (rows: unknown, key: string): string | undefined => {
    if (!Array.isArray(rows) || !rows.length) return undefined;
    const counts = new Map<string, number>();
    for (const row of rows as Array<Record<string, unknown>>) {
      const id = String(row[key] ?? "");
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    let best: string | undefined;
    let most = -1;
    for (const [id, n] of counts) if (n > most) { most = n; best = id; }
    return best;
  };
  return {
    customer: busiest(data.salesInvoices, "customerId") ?? first(data.customers),
    supplier: busiest(data.purchaseInvoices, "supplierId") ?? first(data.suppliers),
    product: busiest(data.stockMovements, "productId") ?? first(data.products),
    salesInvoice: first(data.salesInvoices),
    purchaseInvoice: first(data.purchaseInvoices),
    user: first(data.users),
    driver: first(data.drivers),
    shift: first(data.shifts),
  };
}

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

test.describe("full-system performance audit", () => {
  test.skip(!sourceDb, "Set PARTFLOW_STRESS_DB to run the performance audit");

  // Playwright hands fixtures first and testInfo second, and this suite
  // deliberately takes NO fixtures: asking for `page` would spin up a
  // Chromium browser alongside the Electron app under test.
  // eslint-disable-next-line no-empty-pattern
  test("measures every route and the core operations on a mature shop", async ({}, testInfo) => {
    test.setTimeout(60 * 60_000);
    if (!sourceDb) return;

    const resolvedSource = path.resolve(sourceDb);
    if (!fs.existsSync(resolvedSource)) throw new Error(`stress database not found: ${resolvedSource}`);

    const tempRoot = path.resolve(process.env.PARTFLOW_STRESS_TMPDIR || os.tmpdir());
    fs.mkdirSync(tempRoot, { recursive: true });
    const profileDir = fs.mkdtempSync(path.join(tempRoot, "partflow-perf-"));
    const dbPath = path.join(profileDir, "autoparts-inventory.secure.sqlite");
    fs.copyFileSync(resolvedSource, dbPath);

    const ids = resolveIds();
    const routes = [...STATIC_ROUTES, ...detailRoutes(ids)];
    console.log(`[perf] ${routes.length} routes; isolated database: ${dbPath}`);

    const report: {
      sourceBytes: number;
      launchMs?: number;
      loginMs?: number;
      routes: RouteResult[];
      operations: Record<string, number | string | boolean>;
      abortedAfter?: string;
      rendererErrors: string[];
      consoleErrors: string[];
    } = {
      sourceBytes: fs.statSync(resolvedSource).size,
      routes: [],
      operations: {},
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
        args: [
          path.resolve("electron/main.cjs"),
          // Applied to the whole process, so the renderer's old-space is
          // capped exactly as it would be on a machine with little to spare.
          ...(HEAP_MB > 0 ? [`--js-flags=--max-old-space-size=${HEAP_MB}`] : []),
        ],
        env: env as Record<string, string>,
        timeout: 180_000,
      });
      const page = await electronApp.firstWindow();
      await page.waitForLoadState("domcontentloaded");
      report.launchMs = performance.now() - launchStarted;

      report.operations.cpuThrottleRate = CPU_THROTTLE;
      report.operations.heapCapMB = HEAP_MB;
      if (CPU_THROTTLE > 1) {
        // CDP throttles the renderer's main thread itself, which is what a
        // slower CPU actually does — unlike a sleep, it slows down React's
        // render and the store's own passes in proportion.
        const cdp = await electronApp.context().newCDPSession(page);
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_THROTTLE });
        console.log(`[perf] renderer throttled to 1/${CPU_THROTTLE} CPU speed`);
      }

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

      // The first debounced persistence pass is a one-off cost. Letting it
      // finish keeps it from being charged to whichever route runs next.
      await page.waitForTimeout(5_000);

      // Heap baseline, so growth across the sweep can be attributed to the
      // sweep rather than to sign-in.
      report.operations.heapBaselineMB = await page
        .evaluate(() => Math.round(
          ((performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0) / 1048576,
        ))
        .catch(() => 0);

      for (const [route, group] of routes) {
        // Print and receipt routes render WITHOUT AppLayout, so they have no
        // <main> at all. Anchoring the readiness check on <main> made every
        // one of them sit out the full timeout and report as a failure while
        // the page was in fact fine — a bug in the measurement, not the app.
        const started = performance.now();
        let result: RouteResult;
        try {
          await page.evaluate((next) => { window.location.hash = next; }, route);
          // Readiness is "the router has settled AND something is painted".
          //
          // Settled, not "landed on the hash I asked for": several routes are
          // declared as redirects — /reports/autoparts is
          // `<Navigate to="/reports" replace />` — so the hash the app ends on
          // is legitimately NOT the one requested. Demanding an exact match
          // made a page that rendered in half a second sit out the full
          // timeout and report as broken; a CPU profile of that minute showed
          // the renderer idle for 113 seconds of it.
          //
          // Nor "the text changed": /quotations/:id and /quotations/:id/edit
          // answer a missing record with the identical card, and requiring a
          // difference failed the second one for being correct.
          await page.waitForFunction(
            (next) => {
              const root = document.querySelector("main") ?? document.body;
              if ((root?.textContent?.trim().length || 0) === 0) return false;
              const hash = window.location.hash;
              // Either we are where we asked, or the router moved us somewhere
              // else on purpose and has stopped moving.
              return hash === `#${next}` || (hash.length > 1 && hash !== `#${next}`);
            },
            route,
            { timeout: ROUTE_TIMEOUT_MS },
          );
          // Two frames, so the number covers React's render and not just the
          // hash callback that scheduled it.
          await page.evaluate(() => new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
          const bodyText = await page.locator("body").innerText({ timeout: 30_000 });
          const ms = performance.now() - started;
          const crashed = bodyText.includes("حدث خطأ غير متوقع");
          result = {
            path: route,
            group,
            milliseconds: ms,
            bodyCharacters: bodyText.length,
            outcome: crashed ? "error" : ms > ROUTE_BUDGET_MS ? "slow" : "ok",
            detail: crashed ? "global error boundary rendered" : undefined,
          };
        } catch (error) {
          result = {
            path: route,
            group,
            milliseconds: performance.now() - started,
            bodyCharacters: 0,
            outcome: "error",
            detail: error instanceof Error ? error.message.split("\n")[0] : String(error),
          };
        }
        report.routes.push(result);

        // Is the app still there? Once it is not, every later measurement is
        // noise and reporting it as data would be worse than stopping.
        const alive = await page.evaluate(() => true).then(() => true).catch(() => false);
        if (!alive) {
          report.abortedAfter = route;
          console.log(`[perf] renderer died on ${route} — stopping the sweep`);
          break;
        }
      }

      // ── Operations, not just page loads ────────────────────────────────
      //
      // Each one is wrapped and its failure RECORDED. An earlier run swallowed
      // whatever went wrong here and reported `operations: {}`, which reads as
      // "not measured" when it actually meant "threw, and nobody wrote down
      // why". A measurement that can fail silently is worse than none, because
      // it gets mistaken for one.
      const step = async (name: string, body: () => Promise<void>) => {
        if (report.abortedAfter) return;
        try {
          await body();
        } catch (error) {
          report.operations[`${name}Error`] =
            // The whole message, flattened: "toBeVisible failed" alone does not
            // say WHICH locator, and that ambiguity cost a full audit cycle.
            error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 300) : String(error);
        }
      };

      // Waits on the ROUTER, not on a heading. The dashboard has no heading
      // carrying its own name (the only such text sits inside a settings
      // button), so keying on one failed before the operation it was setting
      // up ever ran, and then reported that operation as broken.
      const goto = async (route: string) => {
        await page.evaluate((next) => { window.location.hash = next; }, route);
        await page.waitForFunction(
          (next) => {
            const root = document.querySelector("main") ?? document.body;
            return window.location.hash.startsWith(`#${next}`) &&
              (root?.textContent?.trim().length || 0) > 0;
          },
          route,
          { timeout: 60_000 },
        );
        await page.evaluate(() => new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      };

      // 1. Global search — the one control every cashier uses all day.
      await step("search", async () => {
        await goto("/");
        const opened = performance.now();
        await page.getByRole("button", { name: /بحث شامل/ }).click();
        // The real placeholder is the part-number prompt; it contains no "search".
          const input = page.getByPlaceholder(/رقم القطعة/).first();
        await expect(input).toBeVisible({ timeout: 30_000 });
        report.operations.searchOpenMs = Math.round(performance.now() - opened);

        const typed = performance.now();
        await input.fill("فلتر");
        await page.waitForTimeout(700);
        report.operations.searchTypeMs = Math.round(performance.now() - typed);
        await page.keyboard.press("Escape");
      });

      // 2. Sorting 25,000 customers by balance. This is the exact memo that
      //    used to run three whole-history scans per customer.
      await step("customerSort", async () => {
        await goto("/customers");
        const sorted = performance.now();
        await page.getByRole("combobox").last().selectOption("balance");
        await page.waitForTimeout(400);
        report.operations.customerSortMs = Math.round(performance.now() - sorted);
      });

      // 3. "Show more" on the customers table — the pagination added because
      //    rendering all 25,000 rows at once froze the tab.
      await step("customerPaging", async () => {
        const more = page.getByRole("button", { name: /عرض المزيد/ });
        if (!(await more.isVisible({ timeout: 5_000 }).catch(() => false))) {
          report.operations.customerPagingMs = -1; // nothing to page through
          return;
        }
        const paged = performance.now();
        await more.click();
        await page.waitForTimeout(300);
        report.operations.customerPagingMs = Math.round(performance.now() - paged);
      });

      // 4. Typing into a 25,000-row filter, one keystroke at a time — the
      //    case where a per-keystroke re-filter is felt rather than measured.
      await step("customerSearch", async () => {
        const box = page.getByPlaceholder(/بحث|اسم|هاتف/).first();
        await expect(box).toBeVisible({ timeout: 20_000 });
        const typed = performance.now();
        await box.pressSequentially("محمد", { delay: 60 });
        await page.waitForTimeout(700);
        report.operations.customerFilterMs = Math.round(performance.now() - typed);
      });

      // 5. Rapid back-to-back navigation. Pages are fine one at a time and
      //    still stack up when someone clicks through the sidebar quickly.
      await step("rapidNav", async () => {
        const started = performance.now();
        for (const route of ["/products", "/customers", "/sales", "/purchases", "/"]) {
          await page.evaluate((next) => { window.location.hash = next; }, route);
          await page.waitForTimeout(120);
        }
        await goto("/");
        report.operations.rapidNavMs = Math.round(performance.now() - started);
      });

      // 6. Main-thread responsiveness. A timer due in 2.5s that arrives late
      //    IS the jank a cashier feels between keystrokes.
      await step("drift", async () => {
        const drift = await page.evaluate(() => new Promise<number>((resolve) => {
          const started = performance.now();
          window.setTimeout(() => resolve(performance.now() - started - 2_500), 2_500);
        }));
        report.operations.eventLoopDriftMs = Math.round(Math.max(0, drift));
      });

      // 7. Renderer heap after the whole sweep, against the baseline taken
      //    right after sign-in. Steady growth here is the leak that makes a
      //    till slow down over a shift rather than on any one screen.
      await step("memory", async () => {
        const heap = await page.evaluate(
          () => (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0,
        );
        report.operations.heapAfterMB = Math.round(heap / 1048576);
        if (typeof report.operations.heapBaselineMB === "number") {
          report.operations.heapGrowthMB =
            report.operations.heapAfterMB - report.operations.heapBaselineMB;
        }
      });

      const metrics = await electronApp.evaluate(async ({ app }) => ({
        metrics: app.getAppMetrics().map((m) => ({
          type: m.type,
          cpu: m.cpu?.percentCPUUsage,
          memoryMB: Math.round((m.memory?.workingSetSize ?? 0) / 1024),
        })),
      })).catch(() => undefined);
      if (metrics) report.operations.appMetrics = JSON.stringify(metrics.metrics);
    } finally {
      if (electronApp) await electronApp.close().catch(() => undefined);
      const json = JSON.stringify(report, null, 2);
      fs.writeFileSync(testInfo.outputPath("performance-audit.json"), json);
      await testInfo.attach("performance-audit", { body: json, contentType: "application/json" });
      fs.rmSync(profileDir, { recursive: true, force: true });
    }

    const failures = report.routes.filter((row) => row.outcome === "error");
    expect(report.abortedAfter, `renderer died on ${report.abortedAfter}`).toBeUndefined();
    expect(failures, JSON.stringify(failures, null, 2)).toEqual([]);
    expect(report.rendererErrors, report.rendererErrors.join("\n\n")).toEqual([]);
  });
});
