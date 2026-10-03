import { _electron as electron, expect, test } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const sourceDb = process.env.PARTFLOW_STRESS_DB;

test.describe("Phase 12C projection upgrade UI", () => {
  test.skip(!sourceDb, "Set PARTFLOW_STRESS_DB to an unprojected isolated fixture");

  // eslint-disable-next-line no-empty-pattern
  test("detects before Dashboard, reports real progress, completes, then no-ops on relaunch", async ({}) => {
    test.setTimeout(10 * 60_000);
    if (!sourceDb) return;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "partflow-phase12c-ui-"));
    const dbPath = path.join(root, "autoparts-inventory.secure.sqlite");
    fs.copyFileSync(path.resolve(sourceDb), dbPath);
    const launch = () => {
      const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "test", HW_E2E: "1", HW_E2E_DB_PATH: dbPath };
      delete env.ELECTRON_RUN_AS_NODE;
      delete env.ELECTRON_RENDERER_URL;
      return electron.launch({ args: [path.resolve("electron/main.cjs")], env: env as Record<string, string>, timeout: 180_000 });
    };
    const login = async (app: Awaited<ReturnType<typeof launch>>) => {
      const page = await app.firstWindow();
      await expect(page.getByPlaceholder("Login username")).toBeVisible({ timeout: 180_000 });
      await page.getByPlaceholder("Login username").fill("admin");
      await page.locator('input[type="password"]').first().fill("stress123");
      await page.locator('button[type="submit"]').click();
      return page;
    };
    try {
      const first = await launch();
      const firstPage = await login(first);
      const upgrade = firstPage.getByTestId("projection-upgrade-screen");
      await expect(upgrade).toBeVisible({ timeout: 30_000 });
      await expect(upgrade.getByText(/PartFlow يجهز قاعدة البيانات/)).toBeVisible();
      await expect.poll(async () => firstPage.evaluate(() => window.desktopAPI?.projection?.getStatus()), { timeout: 120_000 })
        .toMatchObject({ state: "BUILDING" });
      fs.mkdirSync(path.resolve("reports/performance-scale-2026-09"), { recursive: true });
      await firstPage.screenshot({ path: path.resolve("reports/performance-scale-2026-09/phase12c-upgrade-ui.png"), fullPage: true });
      await expect(firstPage.getByRole("button", { name: /تسجيل الخروج/ })).toBeVisible({ timeout: 300_000 });
      await expect(upgrade).not.toBeVisible();
      await first.close();

      const secondStarted = Date.now();
      const second = await launch();
      const secondPage = await login(second);
      await expect(secondPage.getByRole("button", { name: /تسجيل الخروج/ })).toBeVisible({ timeout: 120_000 });
      expect(Date.now() - secondStarted).toBeLessThan(120_000);
      await expect(secondPage.getByTestId("projection-upgrade-screen")).toHaveCount(0);
      const status = await secondPage.evaluate(() => window.desktopAPI?.projection?.getStatus());
      expect(status).toMatchObject({ state: "NOT_REQUIRED" });
      await second.close();
    } finally {
      try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 }); } catch { /* Windows may retain a transient SQLite handle after Electron exits. */ }
    }
  });
});
