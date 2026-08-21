/**
 * CPU profile of a single route, named by env var.
 *
 * Reading a 1,000-line page and nominating a suspect has already been wrong
 * once today (buildStarterProductFitments: guessed as the cause of a
 * two-minute sign-in, measured at 8 ms). This names the function instead.
 *
 * Build UNMINIFIED first or every frame comes back as "(anonymous)":
 *   npx vite build --minify false
 *   PARTFLOW_STRESS_DB=... PARTFLOW_PROFILE_ROUTE=/reports/autoparts \
 *     npx playwright test tests/e2e/flows/route-profile.spec.ts
 */
import { _electron as electron, expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const sourceDb = process.env.PARTFLOW_STRESS_DB;
const target = process.env.PARTFLOW_PROFILE_ROUTE;

type Node = { id: number; callFrame: { functionName: string; url: string; lineNumber: number } };

test.describe("route CPU profile", () => {
  test.skip(!sourceDb || !target, "Set PARTFLOW_STRESS_DB and PARTFLOW_PROFILE_ROUTE");

  // eslint-disable-next-line no-empty-pattern
  test("names the functions that own one route's time", async ({}, testInfo) => {
    test.setTimeout(20 * 60_000);
    if (!sourceDb || !target) return;

    const tempRoot = path.resolve(process.env.PARTFLOW_STRESS_TMPDIR || os.tmpdir());
    fs.mkdirSync(tempRoot, { recursive: true });
    const profileDir = fs.mkdtempSync(path.join(tempRoot, "partflow-rprof-"));
    const dbPath = path.join(profileDir, "autoparts-inventory.secure.sqlite");
    fs.copyFileSync(path.resolve(sourceDb), dbPath);

    const env: NodeJS.ProcessEnv = {
      ...process.env, NODE_ENV: "test", HW_E2E: "1", HW_E2E_DB_PATH: dbPath,
    };
    delete env.ELECTRON_RENDERER_URL;
    delete env.ELECTRON_RUN_AS_NODE;

    const app = await electron.launch({
      args: [path.resolve("electron/main.cjs")], env: env as Record<string, string>, timeout: 180_000,
    });
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState("domcontentloaded");
      await expect(page.getByPlaceholder("Login username")).toBeVisible({ timeout: 180_000 });
      await page.getByPlaceholder("Login username").fill("admin");
      await page.locator('input[type="password"]').first().fill("stress123");
      await page.getByRole("button", { name: "تسجيل الدخول" }).click();
      await expect(page.getByRole("button", { name: "تسجيل الخروج" })).toBeVisible({ timeout: 300_000 });
      await page.waitForTimeout(4_000); // let sign-in settle out of the profile

      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Profiler.enable");
      await cdp.send("Profiler.setSamplingInterval", { interval: 500 });
      await cdp.send("Profiler.start");

      const started = Date.now();
      await page.evaluate((next) => { window.location.hash = next; }, target);
      await page
        .waitForFunction(
          (next) => {
            const root = document.querySelector("main") ?? document.body;
            return window.location.hash === `#${next}` && (root?.textContent?.trim().length || 0) > 0;
          },
          target,
          { timeout: 120_000 },
        )
        .catch(() => undefined); // profile the stall too, do not abandon it
      const wallMs = Date.now() - started;

      const { profile } = await cdp.send("Profiler.stop");
      const nodes = profile.nodes as unknown as Node[];
      const byId = new Map(nodes.map((n) => [n.id, n]));
      const self = new Map<number, number>();
      const samples = profile.samples ?? [];
      const deltas = profile.timeDeltas ?? [];
      for (let i = 0; i < samples.length; i += 1) {
        self.set(samples[i], (self.get(samples[i]) ?? 0) + (deltas[i] ?? 0));
      }
      const rows = [...self.entries()]
        .map(([id, us]) => {
          const f = byId.get(id)?.callFrame;
          return {
            ms: Math.round(us / 1000),
            name: f?.functionName || "(anonymous)",
            where: f ? `${f.url.split("/").pop() ?? ""}:${f.lineNumber + 1}` : "?",
          };
        })
        .filter((r) => r.ms >= 100)
        .sort((a, b) => b.ms - a.ms)
        .slice(0, 20);

      console.log(`[route] ${target} wall ${wallMs} ms`);
      for (const r of rows) console.log(`[route] ${String(r.ms).padStart(7)} ms  ${r.name.padEnd(36)} ${r.where}`);
      fs.writeFileSync(testInfo.outputPath("route-profile.json"), JSON.stringify({ target, wallMs, rows }, null, 2));
    } finally {
      await app.close().catch(() => undefined);
      fs.rmSync(profileDir, { recursive: true, force: true });
    }
  });
});
