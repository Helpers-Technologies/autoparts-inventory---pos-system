import { _electron as electron, expect, test } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

const sourceDb = process.env.PARTFLOW_STRESS_DB;

type ProcessSnapshot = {
  main: NodeJS.MemoryUsage;
  processes: Array<{
    type: string;
    memory: { workingSetSize: number; peakWorkingSetSize: number; privateBytes: number };
  }>;
};

test.describe("Phase 9 startup/login profile", () => {
  test.skip(!sourceDb, "Set PARTFLOW_STRESS_DB to run the isolated Phase 9 profile");

  // eslint-disable-next-line no-empty-pattern
  test("captures timing, memory, payload, and event-loop evidence", async ({}, testInfo) => {
    test.setTimeout(15 * 60_000);
    if (!sourceDb) return;

    const resolvedSource = path.resolve(sourceDb);
    const tempRoot = path.resolve(process.env.PARTFLOW_STRESS_TMPDIR || os.tmpdir());
    fs.mkdirSync(tempRoot, { recursive: true });
    const profileDir = fs.mkdtempSync(path.join(tempRoot, "partflow-phase09-"));
    const dbPath = path.join(profileDir, "autoparts-inventory.secure.sqlite");
    const mainProfilePath = path.join(profileDir, "main-profile.jsonl");
    fs.copyFileSync(resolvedSource, dbPath);

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: "test",
      HW_E2E: "1",
      HW_E2E_DB_PATH: dbPath,
      PARTFLOW_PHASE9_PROFILE_PATH: mainProfilePath,
    };
    delete env.ELECTRON_RENDERER_URL;
    delete env.ELECTRON_RUN_AS_NODE;

    const launchStarted = performance.now();
    const app = await electron.launch({
      args: [path.resolve("electron/main.cjs")],
      env: env as Record<string, string>,
      timeout: 180_000,
    });

    const readProcesses = () => app.evaluate(({ app: electronApp }) => ({
      main: process.memoryUsage(),
      processes: electronApp.getAppMetrics().map((entry) => ({
        type: entry.type,
        memory: entry.memory,
      })),
    })) as Promise<ProcessSnapshot>;

    try {
      const page = await app.firstWindow();
      await page.waitForLoadState("domcontentloaded");
      const launchToDomMs = performance.now() - launchStarted;
      await expect(page.getByPlaceholder("Login username")).toBeVisible({ timeout: 180_000 });

      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Performance.enable");
      await page.evaluate(() => {
        const target = window as Window & {
          __PARTFLOW_PHASE9_PROFILE__?: boolean;
          __PARTFLOW_PHASE9_LONG_TASKS__?: Array<{ startTime: number; duration: number }>;
        };
        target.__PARTFLOW_PHASE9_PROFILE__ = true;
        target.__PARTFLOW_PHASE9_LONG_TASKS__ = [];
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            target.__PARTFLOW_PHASE9_LONG_TASKS__!.push({
              startTime: entry.startTime,
              duration: entry.duration,
            });
          }
        }).observe({ type: "longtask", buffered: true });
      });

      const before = await readProcesses();
      const beforeRendererMetrics = await cdp.send("Performance.getMetrics");
      let peakMainRss = before.main.rss;
      let peakRendererWorkingSetKb = 0;
      let sampling = true;
      const sampler = (async () => {
        while (sampling) {
          const sample = await readProcesses().catch(() => undefined);
          if (sample) {
            peakMainRss = Math.max(peakMainRss, sample.main.rss);
            for (const processRow of sample.processes) {
              if (processRow.type === "Tab") {
                peakRendererWorkingSetKb = Math.max(
                  peakRendererWorkingSetKb,
                  processRow.memory.workingSetSize,
                  processRow.memory.peakWorkingSetSize,
                );
              }
            }
          }
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      })();

      await page.getByPlaceholder("Login username").fill("admin");
      await page.locator('input[type="password"]').first().fill("stress123");
      const loginStarted = performance.now();
      await page.getByRole("button", { name: "تسجيل الدخول" }).click();
      await expect(page.getByRole("button", { name: "تسجيل الخروج" }))
        .toBeVisible({ timeout: 300_000 });
      const usableMs = performance.now() - loginStarted;
      const settleMs = Number(process.env.PARTFLOW_PROFILE_SETTLE_MS || 0);
      if (settleMs > 0) await page.waitForTimeout(settleMs);
      const timerDriftMs = await page.evaluate(() => new Promise<number>((resolve) => {
        const started = performance.now();
        setTimeout(() => resolve(Math.max(0, performance.now() - started - 500)), 500);
      }));
      sampling = false;
      await sampler;

      const after = await readProcesses();
      const afterRendererMetrics = await cdp.send("Performance.getMetrics");
      const rendererMarks = await page.evaluate(() => performance.getEntriesByType("mark")
        .filter((entry) => entry.name.startsWith("partflow:"))
        .map((entry) => ({
          name: entry.name,
          startTime: entry.startTime,
          detail: (entry as PerformanceMark).detail,
        })));
      const longTasks = await page.evaluate(() => (
        window as Window & { __PARTFLOW_PHASE9_LONG_TASKS__?: Array<{ startTime: number; duration: number }> }
      ).__PARTFLOW_PHASE9_LONG_TASKS__ ?? []);
      const mainStages = fs.existsSync(mainProfilePath)
        ? fs.readFileSync(mainProfilePath, "utf8").trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
        : [];

      const result = {
        sourceDb: resolvedSource,
        isolatedDb: dbPath,
        sourceBytes: fs.statSync(resolvedSource).size,
        launchToDomMs,
        loginToUsableMs: usableMs,
        timerDriftMs,
        memory: {
          before,
          after,
          peakMainRss,
          peakRendererWorkingSetKb,
          beforeRendererMetrics: beforeRendererMetrics.metrics,
          afterRendererMetrics: afterRendererMetrics.metrics,
        },
        rendererMarks,
        longTasks: {
          count: longTasks.length,
          totalDurationMs: longTasks.reduce((sum, entry) => sum + entry.duration, 0),
          maxDurationMs: Math.max(0, ...longTasks.map((entry) => entry.duration)),
          top: longTasks.sort((a, b) => b.duration - a.duration).slice(0, 20),
        },
        mainStages,
      };
      const json = JSON.stringify(result, null, 2);
      fs.writeFileSync(testInfo.outputPath("phase09-profile.json"), json);
      if (process.env.PARTFLOW_PROFILE_OUTPUT) {
        fs.writeFileSync(path.resolve(process.env.PARTFLOW_PROFILE_OUTPUT), json);
      }
      console.log(`[phase09] ${json}`);
    } finally {
      await app.close().catch(() => undefined);
      fs.rmSync(profileDir, { recursive: true, force: true });
    }
  });
});
