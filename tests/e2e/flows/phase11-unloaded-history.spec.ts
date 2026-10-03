import { _electron as electron, expect, test } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const sourceDb = process.env.PARTFLOW_STRESS_DB;

type Sentinel = { base: string | null; meta: string | null; first: string | null; last: string | null };

test.describe("Phase 11 unloaded history durability", () => {
  test.skip(!sourceDb, "Set PARTFLOW_STRESS_DB to run the isolated durability check");

  // eslint-disable-next-line no-empty-pattern
  test("login -> graceful close does not persist unloaded sales history as empty", async ({}) => {
    test.setTimeout(10 * 60_000);
    if (!sourceDb) return;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "partflow-phase11-close-"));
    const dbPath = path.join(root, "autoparts-inventory.secure.sqlite");
    fs.copyFileSync(path.resolve(sourceDb), dbPath);

    const launch = async () => {
      const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "test", HW_E2E: "1", HW_E2E_DB_PATH: dbPath };
      delete env.ELECTRON_RUN_AS_NODE;
      delete env.ELECTRON_RENDERER_URL;
      return electron.launch({
        args: [path.resolve("electron/main.cjs")],
        env: env as Record<string, string>,
        timeout: 180_000,
      });
    };
    const loginAndReadSentinel = async (app: Awaited<ReturnType<typeof launch>>): Promise<Sentinel> => {
      const page = await app.firstWindow();
      await expect(page.getByPlaceholder("Login username")).toBeVisible({ timeout: 180_000 });
      await page.getByPlaceholder("Login username").fill("admin");
      await page.locator('input[type="password"]').first().fill("stress123");
      await page.getByRole("button", { name: "تسجيل الدخول" }).click();
      await expect(page.getByRole("button", { name: "تسجيل الخروج" })).toBeVisible({ timeout: 300_000 });
      return page.evaluate(() => {
        const storage = window.desktopAPI!.storage;
        const prefix = "autoparts_inventory_v1::salesInvoices";
        const meta = storage.get(`${prefix}#meta`);
        const chunks = meta ? Number(JSON.parse(meta).chunks) : 0;
        return {
          base: storage.get(prefix),
          meta,
          first: chunks > 0 ? storage.get(`${prefix}#0000`) : null,
          last: chunks > 0 ? storage.get(`${prefix}#${String(chunks - 1).padStart(4, "0")}`) : null,
        };
      });
    };

    try {
      const firstApp = await launch();
      const before = await loginAndReadSentinel(firstApp);
      expect(Number(JSON.parse(before.meta!).total)).toBeGreaterThan(0);
      await firstApp.close();

      const secondApp = await launch();
      const after = await loginAndReadSentinel(secondApp);
      expect(after).toEqual(before);
      await secondApp.close();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
