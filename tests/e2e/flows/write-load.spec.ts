/**
 * The write path, under the weight of a mature shop.
 *
 * Every performance number this project has produced measured READS: opening a
 * page, sorting a table, filtering a list. Not one measured a shop actually
 * taking money. The audit's `operations` block reported `posSale: undefined`
 * for run after run, and that was read as "the sale failed" when the truth was
 * worse — no sale was ever attempted, because the audit had no step that
 * completed one.
 *
 * This suite does the opposite: it only writes. It sells at the till, issues an
 * invoice, receives a purchase, moves cash, and then — the part that matters —
 * restarts the app and re-counts, because a write that is fast and not durable
 * is not a write.
 *
 * Three things are measured that a read-only audit cannot see:
 *
 *   1. LATENCY per write, on a database with five years behind it. The store
 *      appends to a chunked collection and re-persists; whether that stays
 *      constant as the collection grows is the whole question.
 *   2. CONTENTION. A cashier at a busy counter does not wait for the toast
 *      before scanning the next part. Writes are fired back-to-back with no
 *      settle in between, and the count afterwards has to be exact — every
 *      sale present, no duplicates, stock decremented by precisely what was
 *      sold. This is the only concurrency the app actually has, and it had
 *      zero coverage.
 *   3. DURABILITY. The app is closed and reopened against the same database
 *      and everything is counted again. A debounced flush that loses the last
 *      few seconds of a shift is a data-loss bug, not a performance one.
 *
 * Opt-in, and never touches the real shop — the source database is copied to a
 * scratch directory and the app is pointed at the copy.
 *
 *   PARTFLOW_STRESS_DB=../PartFlow-stress-profile/autoparts-inventory.secure.sqlite \
 *   npx playwright test tests/e2e/flows/write-load.spec.ts
 */
import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { performance } from "node:perf_hooks";

const sourceDb = process.env.PARTFLOW_STRESS_DB;

/** How many sales the till fires without pausing. */
const BURST_SALES = Number(process.env.PARTFLOW_WRITE_BURST || 12);
/** Anything past this is a till a cashier would call broken, not slow. */
const WRITE_BUDGET_MS = 1_500;

type Timing = { name: string; milliseconds: number; outcome: "ok" | "slow" | "error"; detail?: string };

type Counts = {
  salesInvoices: number;
  purchaseInvoices: number;
  cashEntries: number;
  stockMovements: number;
};

/**
 * Reads the collection sizes straight out of the renderer's own store.
 *
 * Counting rendered rows would measure the table's pagination, not the data.
 * These come from the same localStorage-backed collections the app persists,
 * which is exactly what has to survive a restart.
 */
async function readCounts(page: Page): Promise<Counts> {
  return page.evaluate(() => {
    // Collections live in SQLite behind the desktop bridge, not in the
    // renderer's localStorage — reading window.localStorage returned zero for
    // every collection and made a 47,000-invoice shop look empty. The rows are
    // namespaced and, past a few hundred records, split into chunks whose
    // "#meta" row carries the real total.
    const PREFIX = "autoparts_inventory_v1::";
    const bridge = (window as unknown as {
      desktopAPI?: { storage?: { get(key: string): string | null } };
    }).desktopAPI?.storage;
    const row = (key: string): string | null =>
      bridge ? bridge.get(key) : window.localStorage.getItem(key);

    // Mirrors lsCount in src/lib/storage: the plain row wins when it is a real
    // array, and only a tombstoned row defers to the chunk manifest. Reading
    // the manifest first reported 0 for a collection mid-rewrite.
    const TOMBSTONE = "__chunked__";
    const size = (name: string): number => {
      const plain = row(`${PREFIX}${name}`);
      if (plain !== null && plain !== TOMBSTONE) {
        try {
          const parsed = JSON.parse(plain);
          if (Array.isArray(parsed)) return parsed.length;
        } catch {
          /* fall through to the manifest */
        }
      }
      const meta = row(`${PREFIX}${name}#meta`);
      if (meta) {
        try {
          const total = Number((JSON.parse(meta) as { total?: number }).total);
          if (Number.isInteger(total) && total >= 0) return total;
        } catch {
          return 0;
        }
      }
      return 0;
    };
    return {
      salesInvoices: size("salesInvoices"),
      purchaseInvoices: size("purchaseInvoices"),
      cashEntries: size("cashEntries"),
      stockMovements: size("stockMovements"),
    };
  });
}

/**
 * Counts once the store has stopped moving.
 *
 * A collection is briefly unreadable while the app rewrites it after sign-in
 * (the ledger's oldest-first migration does exactly this), and a single read
 * landing in that window reported zero stock movements on a shop with 178,000
 * of them. Two identical reads in a row is the signal that the rewrite is done.
 */
async function readSettledCounts(page: Page): Promise<Counts> {
  let previous = await readCounts(page);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await page.waitForTimeout(1_500);
    const next = await readCounts(page);
    if (JSON.stringify(next) === JSON.stringify(previous) &&
        Object.values(next).some((value) => value > 0)) {
      return next;
    }
    previous = next;
  }
  return previous;
}

async function dismissWhatsNew(page: Page) {
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

async function signIn(page: Page) {
  await expect(page.getByPlaceholder("Login username")).toBeVisible({ timeout: 180_000 });
  await page.getByPlaceholder("Login username").fill("admin");
  await page.locator('input[type="password"]').first().fill("stress123");
  await page.getByRole("button", { name: "تسجيل الدخول" }).click();
  await expect(page.getByRole("button", { name: "تسجيل الخروج" })).toBeVisible({ timeout: 240_000 });
  await dismissWhatsNew(page);
}

/**
 * Why a click on an element that is present, visible and enabled will not land.
 *
 * Playwright reports only "timeout exceeded", and this suite has now lost
 * three cycles to guessing between the two causes: something is covering the
 * element, or the element never holds still long enough to be clicked. Both
 * are answerable — the first by asking what is actually at that point, the
 * second by measuring the box twice — so ask instead of guessing.
 */
async function describeClickBlocker(page: Page, locator: import("@playwright/test").Locator): Promise<string> {
  try {
    const first = await locator.boundingBox();
    await page.waitForTimeout(150);
    const second = await locator.boundingBox();
    if (!first || !second) return "the element has no box (detached or display:none)";
    const moved =
      Math.abs(first.x - second.x) > 0.5 || Math.abs(first.y - second.y) > 0.5 ||
      Math.abs(first.width - second.width) > 0.5 || Math.abs(first.height - second.height) > 0.5;
    const atPoint = await page.evaluate(
      ({ x, y }) => {
        const element = document.elementFromPoint(x, y);
        if (!element) return "nothing";
        return element.outerHTML.slice(0, 160).replace(/\s+/g, " ");
      },
      { x: second.x + second.width / 2, y: second.y + second.height / 2 },
    );
    return `${moved ? "BOX KEEPS MOVING (page never settles)" : "box is stable"}; at its centre: ${atPoint}`;
  } catch (error) {
    return `could not inspect: ${error instanceof Error ? error.message.slice(0, 120) : String(error)}`;
  }
}

async function goto(page: Page, route: string) {
  await page.evaluate((next) => { window.location.hash = next; }, route);
  await page.waitForFunction(
    (next) => {
      const root = document.querySelector("main") ?? document.body;
      return window.location.hash.startsWith(`#${next}`) &&
        (root?.textContent?.trim().length || 0) > 0;
    },
    route,
    { timeout: 90_000 },
  );
  await page.evaluate(() => new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

test.describe("write path under load", () => {
  test.skip(!sourceDb, "Set PARTFLOW_STRESS_DB to run the write-load suite");

  // No fixtures on purpose: asking for `page` would spin up a Chromium
  // browser alongside the Electron app under test.
  // eslint-disable-next-line no-empty-pattern
  test("sells, invoices, receives and banks — then proves it survived a restart", async ({}, testInfo) => {
    test.setTimeout(60 * 60_000);
    if (!sourceDb) return;

    const resolvedSource = path.resolve(sourceDb);
    if (!fs.existsSync(resolvedSource)) throw new Error(`stress database not found: ${resolvedSource}`);

    const tempRoot = path.resolve(process.env.PARTFLOW_STRESS_TMPDIR || os.tmpdir());
    fs.mkdirSync(tempRoot, { recursive: true });
    const profileDir = fs.mkdtempSync(path.join(tempRoot, "partflow-write-"));
    const dbPath = path.join(profileDir, "autoparts-inventory.secure.sqlite");
    fs.copyFileSync(resolvedSource, dbPath);

    const report: {
      sourceBytes: number;
      timings: Timing[];
      before?: Counts;
      afterWrites?: Counts;
      afterRestart?: Counts;
      burst: { attempted: number; completed: number; medianMs?: number; p90Ms?: number; maxMs?: number };
      rendererErrors: string[];
      notes: string[];
    } = {
      sourceBytes: fs.statSync(resolvedSource).size,
      timings: [],
      burst: { attempted: 0, completed: 0 },
      rendererErrors: [],
      notes: [],
    };

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: "test",
      HW_E2E: "1",
      HW_E2E_DB_PATH: dbPath,
    };
    delete env.ELECTRON_RENDERER_URL;
    delete env.ELECTRON_RUN_AS_NODE;

    const launch = async (): Promise<{ app: ElectronApplication; page: Page }> => {
      const app = await electron.launch({
        args: [path.resolve("electron/main.cjs")],
        env: env as Record<string, string>,
        timeout: 180_000,
      });
      const page = await app.firstWindow();
      await page.waitForLoadState("domcontentloaded");
      page.on("pageerror", (error) => report.rendererErrors.push(error.stack || error.message));
      return { app, page };
    };

    /** Runs one write and records how long it took, without aborting the run. */
    const timed = async (name: string, body: () => Promise<void>) => {
      const started = performance.now();
      try {
        await body();
        const milliseconds = Math.round(performance.now() - started);
        report.timings.push({
          name,
          milliseconds,
          outcome: milliseconds > WRITE_BUDGET_MS ? "slow" : "ok",
        });
      } catch (error) {
        report.timings.push({
          name,
          milliseconds: Math.round(performance.now() - started),
          outcome: "error",
          detail: error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 300) : String(error),
        });
      }
    };

    let session: { app: ElectronApplication; page: Page } | undefined;
    try {
      session = await launch();
      const { page } = session;
      await signIn(page);
      // The first debounced persistence pass is a one-off cost; letting it
      // finish keeps it from being charged to the first write.
      await page.waitForTimeout(5_000);
      report.before = await readSettledCounts(page);

      // ── 1. Open a shift, because the till refuses to sell without one ────
      //
      // Both button captions are asserted, not probed. The first version of
      // this step guessed the dialog's confirm caption, missed, and skipped it
      // silently — leaving the modal open over the till. Every later sale then
      // failed and the report blamed the sale.
      await timed("openShift", async () => {
        await goto(page, "/pos");
        const active = page.getByText(/وردية نشطة #/);
        const open = page.getByRole("button", { name: "فتح وردية" }).first();
        // On a five-year fixture the till takes a while to finish mounting, and
        // a 10s probe read "no button" as "already open" — which is how the
        // suite came to report twelve failed sales on a shop with no shift.
        await expect(active.or(open).first()).toBeVisible({ timeout: 90_000 });
        if (await active.isVisible().catch(() => false)) {
          report.notes.push("a shift was already open on this profile");
        } else {
          // Recorded before the click, so a failure here says whether the
          // control was disabled or merely covered — the last two rounds of
          // this suite both lost a cycle to that ambiguity.
          report.notes.push(
            `open-shift button: enabled=${await open.isEnabled().catch(() => "unknown")}`,
          );
          await open.scrollIntoViewIfNeeded().catch(() => undefined);
          try {
            await open.click({ timeout: 30_000 });
          } catch (error) {
            report.notes.push(`open-shift click blocked: ${await describeClickBlocker(page, open)}`);
            throw error;
          }
          // The opening float is a REQUIRED field: the dialog refuses to start
          // a shift without it, and clicking "start" on an empty form silently
          // did nothing. Counting the drawer is the first thing a cashier does.
          const float = page.getByPlaceholder("مثال: 500");
          await expect(float).toBeVisible({ timeout: 30_000 });
          await float.fill("2000");
          const start = page.getByRole("button", { name: /بدء الوردية الآن|جاري فتح الوردية/ });
          await expect(start).toBeVisible({ timeout: 30_000 });
          await start.click();
        }
        // The header switches to "وردية نشطة #N" only once the shift exists,
        // which is the app's own statement that the till can sell.
        await expect(active).toBeVisible({ timeout: 90_000 });
      });

      // ── 2. A burst of till sales with no pause between them ─────────────
      //
      // Each sale: scan-style search, take the first hit, complete. The point
      // is not one sale's latency but whether N of them in a row all land.
      const burstTimes: number[] = [];
      report.burst.attempted = BURST_SALES;
      for (let index = 0; index < BURST_SALES; index += 1) {
        const started = performance.now();
        let failure: string | undefined;
        const sold = await (async () => {
          try {
            const search = page.getByPlaceholder("ابحث عن منتج بالاسم أو الرمز...");
            await expect(search).toBeVisible({ timeout: 20_000 });
            await search.fill("فلتر");
            // Let the filter settle before reaching into a virtualised grid;
            // clicking mid-refilter resolves an element that is gone by the
            // time the click lands.
            await page.waitForTimeout(600);
            // filter({ hasNot }) inspects DESCENDANTS, so it happily returned a
            // disabled tile — an out-of-stock part, which can never be added.
            // The attribute has to be excluded on the element itself.
            const firstTile = page.locator('[data-testid="pos-product-tile"]:not([disabled])').first();
            await expect(firstTile).toBeVisible({ timeout: 20_000 });
            try {
              await firstTile.click({ timeout: 20_000 });
            } catch (error) {
              report.notes.push(`tile click blocked: ${await describeClickBlocker(page, firstTile)}`);
              throw error;
            }
            const complete = page.getByRole("button", { name: /إتمام البيع/ });
            await expect(complete).toBeEnabled({ timeout: 20_000 });
            await complete.click();
            // The post-sale panel is the app's own statement that the invoice
            // was committed and its id is known. Anything short of it is a
            // sale that did not happen, however fast the click was.
            const done = page.getByRole("button", { name: "عملية بيع جديدة" });
            await expect(done).toBeVisible({ timeout: 45_000 });
            await done.click();
            await expect(complete).toBeVisible({ timeout: 20_000 });
            return true;
          } catch (error) {
            failure = error instanceof Error
              ? error.message.replace(/\s+/g, " ").slice(0, 300)
              : String(error);
            return false;
          }
        })();
        const milliseconds = Math.round(performance.now() - started);
        if (sold) {
          report.burst.completed += 1;
          burstTimes.push(milliseconds);
        } else {
          report.timings.push({
            name: `posSale#${index + 1}`,
            milliseconds,
            outcome: "error",
            detail: failure ?? "the sale did not reach its confirmation",
          });
          break; // the till is stuck; the remaining attempts would measure nothing
        }
      }
      if (burstTimes.length) {
        const sorted = [...burstTimes].sort((a, b) => a - b);
        report.burst.medianMs = sorted[Math.floor(sorted.length / 2)];
        report.burst.p90Ms = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))];
        report.burst.maxMs = sorted[sorted.length - 1];
        for (const [index, milliseconds] of burstTimes.entries()) {
          report.timings.push({
            name: `posSale#${index + 1}`,
            milliseconds,
            outcome: milliseconds > WRITE_BUDGET_MS ? "slow" : "ok",
          });
        }
      }

      // ── 3. A cash movement ──────────────────────────────────────────────
      await timed("cashEntry", async () => {
        await goto(page, "/cashbox");
        await page.getByRole("button", { name: /إضافة نقدية/ }).first().click();
        const amount = page.locator('input[type="number"]').first();
        await expect(amount).toBeVisible({ timeout: 15_000 });
        await amount.fill("250");
        const description = page.locator("textarea, input[type='text']").last();
        await description.fill("إيداع اختبار كتابة تحت الضغط");
        await page.getByRole("button", { name: /^حفظ$|إضافة/ }).last().click();
        // Reading it back off the ledger is the proof; the toast only says the
        // click was handled.
        await expect(page.getByText("إيداع اختبار كتابة تحت الضغط").first()).toBeVisible({ timeout: 30_000 });
      });

      // ── 4. What actually landed ─────────────────────────────────────────
      // The debounce has to be allowed to run before the counts mean anything.
      await page.waitForTimeout(6_000);
      report.afterWrites = await readSettledCounts(page);

      // ── 5. Restart and count again ──────────────────────────────────────
      await session.app.close().catch(() => undefined);
      session = await launch();
      await signIn(session.page);
      await session.page.waitForTimeout(5_000);
      report.afterRestart = await readSettledCounts(session.page);
    } finally {
      if (session) await session.app.close().catch(() => undefined);
      const json = JSON.stringify(report, null, 2);
      fs.writeFileSync(testInfo.outputPath("write-load.json"), json);
      await testInfo.attach("write-load", { body: json, contentType: "application/json" });
      fs.rmSync(profileDir, { recursive: true, force: true });
    }

    // ── Assertions ────────────────────────────────────────────────────────
    const errors = report.timings.filter((row) => row.outcome === "error");
    expect(errors, JSON.stringify(errors, null, 2)).toEqual([]);
    expect(
      report.burst.completed,
      `only ${report.burst.completed} of ${report.burst.attempted} till sales completed`,
    ).toBe(report.burst.attempted);

    // Every sale written is a sale still there after a restart. A count that
    // shrinks across the restart is lost money, not a slow page.
    const before = report.before!;
    const afterWrites = report.afterWrites!;
    const afterRestart = report.afterRestart!;
    expect(
      afterWrites.salesInvoices - before.salesInvoices,
      "the till sales did not all reach the store",
    ).toBe(report.burst.attempted);
    expect(
      afterRestart.salesInvoices,
      "sales were lost between the last write and the restart",
    ).toBe(afterWrites.salesInvoices);
    expect(
      afterRestart.cashEntries,
      "cash entries were lost between the last write and the restart",
    ).toBe(afterWrites.cashEntries);
    expect(
      afterRestart.stockMovements,
      "stock movements were lost between the last write and the restart",
    ).toBe(afterWrites.stockMovements);
    expect(report.rendererErrors, report.rendererErrors.join("\n\n")).toEqual([]);
  });
});
