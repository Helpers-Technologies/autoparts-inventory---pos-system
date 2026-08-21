/**
 * CPU profile of the ~116 seconds between signing in and the first frame.
 *
 * Reading the provider tree and guessing which one is expensive already cost
 * one wrong answer (buildStarterProductFitments, measured at 8 ms). A profile
 * names the function instead of nominating a suspect.
 *
 *   PARTFLOW_STRESS_DB=... npx playwright test tests/e2e/flows/login-profile.spec.ts
 */
import { _electron as electron, expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const sourceDb = process.env.PARTFLOW_STRESS_DB;

type Node = { id: number; callFrame: { functionName: string; url: string; lineNumber: number }; children?: number[] };

test.describe("login CPU profile", () => {
  test.skip(!sourceDb, "Set PARTFLOW_STRESS_DB to run");

  // eslint-disable-next-line no-empty-pattern
  test("names the functions that own sign-in time", async ({}, testInfo) => {
    test.setTimeout(20 * 60_000);
    if (!sourceDb) return;

    const tempRoot = path.resolve(process.env.PARTFLOW_STRESS_TMPDIR || os.tmpdir());
    fs.mkdirSync(tempRoot, { recursive: true });
    const profileDir = fs.mkdtempSync(path.join(tempRoot, "partflow-prof-"));
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

      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Profiler.enable");
      await cdp.send("Profiler.setSamplingInterval", { interval: 1000 });
      await cdp.send("Profiler.start");

      await page.getByRole("button", { name: "تسجيل الدخول" }).click();
      await expect(page.getByRole("button", { name: "تسجيل الخروج" }))
        .toBeVisible({ timeout: 300_000 });

      const { profile } = await cdp.send("Profiler.stop");
      const nodes = profile.nodes as unknown as Node[];
      const byId = new Map(nodes.map((n) => [n.id, n]));

      // Self time per node, from the sample stream.
      const self = new Map<number, number>();
      const samples = profile.samples ?? [];
      const deltas = profile.timeDeltas ?? [];
      for (let i = 0; i < samples.length; i += 1) {
        self.set(samples[i], (self.get(samples[i]) ?? 0) + (deltas[i] ?? 0));
      }

      const rows = [...self.entries()]
        .map(([id, us]) => {
          const n = byId.get(id);
          const f = n?.callFrame;
          const where = f ? `${f.url.split("/").pop() ?? ""}:${f.lineNumber + 1}` : "?";
          return { ms: Math.round(us / 1000), name: f?.functionName || "(anonymous)", where };
        })
        .filter((r) => r.ms >= 200)
        .sort((a, b) => b.ms - a.ms)
        .slice(0, 25);

      console.log("[profile] total sampled: " + Math.round(deltas.reduce((a, b) => a + b, 0) / 1000) + " ms");
      for (const r of rows) console.log(`[profile] ${String(r.ms).padStart(7)} ms  ${r.name.padEnd(38)} ${r.where}`);
      fs.writeFileSync(testInfo.outputPath("login-profile.json"), JSON.stringify(rows, null, 2));
    } finally {
      await app.close().catch(() => undefined);
      fs.rmSync(profileDir, { recursive: true, force: true });
    }
  });
});
