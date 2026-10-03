import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { authenticatedShellMarker, closeElectron, launchElectron } from "../../helpers/electron-app";
import { fingerprintCollectionOnDisk } from "../helpers/profileDb";
import { LoginScreen } from "../screens/LoginScreen";

const sourceDb = process.env.PARTFLOW_STRESS_DB;

test.describe("Phase 12B forced-stop integrity", () => {
  test.skip(!sourceDb, "Set PARTFLOW_STRESS_DB to run the isolated forced-stop check");

  test("projection build survives forced termination and restart without changing canonical sales", async () => {
    test.setTimeout(8 * 60_000);
    if (!sourceDb) return;
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "partflow-phase12b-kill-"));
    const dbPath = path.join(folder, "autoparts-inventory.secure.sqlite");
    fs.copyFileSync(path.resolve(sourceDb), dbPath);
    const before = fingerprintCollectionOnDisk(dbPath, "salesInvoices");

    const first = await launchElectron({ dbPath });
    try {
      const login = new LoginScreen(first.window);
      await login.loginAs("admin", "stress123");
      await expect(authenticatedShellMarker(first.window)).toBeVisible({ timeout: 300_000 });
      // Dashboard projection starts after the first interactive paint. Kill
      // after that window so WAL recovery covers the new derived structures.
      await first.window.waitForTimeout(8_000);
      first.app.process().kill("SIGKILL");
      await first.app.waitForEvent("close", { timeout: 30_000 }).catch(() => undefined);

      const electron = createRequire(import.meta.url)("electron") as string;
      const probe = path.resolve("scripts/profile-startup-sql.cjs");
      const output = execFileSync(electron, [probe, dbPath, "--integrity-only"], {
        encoding: "utf8",
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
        timeout: 180_000,
        windowsHide: true,
      });
      const integrity = JSON.parse(output) as { integrityCheck: string; cipherIntegrityCheck: unknown[] };
      expect(integrity.integrityCheck).toBe("ok");
      expect(integrity.cipherIntegrityCheck).toEqual([]);
      expect(fingerprintCollectionOnDisk(dbPath, "salesInvoices")).toEqual(before);

      const second = await launchElectron({ dbPath });
      try {
        const restartLogin = new LoginScreen(second.window);
        await restartLogin.loginAs("admin", "stress123");
        await expect(authenticatedShellMarker(second.window)).toBeVisible({ timeout: 300_000 });
      } finally {
        await closeElectron(second);
      }
      expect(fingerprintCollectionOnDisk(dbPath, "salesInvoices")).toEqual(before);
    } finally {
      await closeElectron(first);
      fs.rmSync(folder, { recursive: true, force: true });
    }
  });
});
