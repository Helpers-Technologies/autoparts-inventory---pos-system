/**
 * Where do the two minutes between "sign in" and a usable screen go?
 *
 * The data pipeline is not the answer: diagnose-startup.cjs measures the whole
 * of it — SQLCipher read, IPC, parse, first flush — at about three seconds on
 * this fixture, while signing in through the real UI takes over two minutes.
 * Something between the last byte parsed and the first usable frame is eating
 * the difference, and a single end-to-end number cannot say what.
 *
 * So this splits the wait into the phases a user would actually notice, each
 * measured from the same click.
 *
 *   PARTFLOW_STRESS_DB=... npx playwright test tests/e2e/flows/login-timing.spec.ts
 */
import { _electron as electron, expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { performance } from "node:perf_hooks";

const sourceDb = process.env.PARTFLOW_STRESS_DB;

test.describe("login timing breakdown", () => {
  test.skip(!sourceDb, "Set PARTFLOW_STRESS_DB to run");

  // eslint-disable-next-line no-empty-pattern
  test("splits sign-in into the phases a user waits through", async ({}, testInfo) => {
    test.setTimeout(15 * 60_000);
    if (!sourceDb) return;

    const tempRoot = path.resolve(process.env.PARTFLOW_STRESS_TMPDIR || os.tmpdir());
    fs.mkdirSync(tempRoot, { recursive: true });
    const profileDir = fs.mkdtempSync(path.join(tempRoot, "partflow-login-"));
    const dbPath = path.join(profileDir, "autoparts-inventory.secure.sqlite");
    fs.copyFileSync(path.resolve(sourceDb), dbPath);

    const env: NodeJS.ProcessEnv = {
      ...process.env, NODE_ENV: "test", HW_E2E: "1", HW_E2E_DB_PATH: dbPath,
    };
    delete env.ELECTRON_RENDERER_URL;
    delete env.ELECTRON_RUN_AS_NODE;

    const marks: Record<string, number> = {};
    const app = await electron.launch({
      args: [path.resolve("electron/main.cjs")], env: env as Record<string, string>, timeout: 180_000,
    });
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState("domcontentloaded");
      await expect(page.getByPlaceholder("Login username")).toBeVisible({ timeout: 180_000 });

      await page.getByPlaceholder("Login username").fill("admin");
      await page.locator('input[type="password"]').first().fill("stress123");

      const t0 = performance.now();
      const at = (name: string) => { marks[name] = Math.round(performance.now() - t0); };

      await page.getByRole("button", { name: "تسجيل الدخول" }).click();

      // 1. The credential round trip: main process verifies the password and
      //    opens a session. Pure back-end, no rendering yet.
      await expect(page.getByPlaceholder("Login username")).toBeHidden({ timeout: 300_000 });
      at("loginFormGone");

      // 2. Everything the renderer must mount before any screen exists.
      await expect(page.locator("main")).toBeVisible({ timeout: 300_000 });
      at("shellMounted");

      // 3. The dashboard's own content — the first thing with real data on it.
      await expect(page.getByRole("heading", { name: /لوحة التحكم/ }).first())
        .toBeVisible({ timeout: 300_000 });
      at("dashboardHeading");

      // 4. Usable: the chrome a user can actually act on.
      await expect(page.getByRole("button", { name: "تسجيل الخروج" }))
        .toBeVisible({ timeout: 300_000 });
      at("logoutButtonVisible");

      // 5. Responsive: the main thread stops being blocked. A timer due in
      //    500ms that lands late is still-blocked time the phases above hide.
      const drift = await page.evaluate(() => new Promise<number>((resolve) => {
        const started = performance.now();
        window.setTimeout(() => resolve(performance.now() - started - 500), 500);
      }));
      marks.mainThreadDriftAfterLoad = Math.round(Math.max(0, drift));
      at("interactive");

      console.log("[login] " + JSON.stringify(marks, null, 2));
    } finally {
      await app.close().catch(() => undefined);
      fs.writeFileSync(testInfo.outputPath("login-timing.json"), JSON.stringify(marks, null, 2));
      fs.rmSync(profileDir, { recursive: true, force: true });
    }
  });
});
