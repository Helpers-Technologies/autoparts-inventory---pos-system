import fs from "node:fs";
import path from "node:path";
import { startApp, stop } from "./hardening-critical-baseline.mjs";

const root = process.cwd();
const progress = JSON.parse(fs.readFileSync(path.join(root, "reports", "performance-scale-2026-09", "phase14-repeat-run-progress.json"), "utf8"));
const output = path.join(root, "reports", "performance-scale-2026-09", "phase14-repeat-postcrash-restart.json");
const result = { startedAt: new Date().toISOString(), database: progress.isolatedDatabase };
let handle;
try {
  handle = await startApp(progress.isolatedDatabase);
  result.projection = await handle.page.evaluate(() => window.desktopAPI.projection.getStatus());
  result.sales = await handle.page.evaluate(() => window.desktopAPI.query.page("salesInvoices", { page: 0, pageSize: 1 }));
  result.dashboard = await handle.page.evaluate(() => window.desktopAPI.storage.getDashboardSummary());
  result.status = "PASS";
} catch (error) {
  result.status = "FAIL";
  result.error = error instanceof Error ? error.stack || error.message : String(error);
} finally {
  if (handle) await stop(handle).catch((error) => { result.stopError = String(error); });
  result.finishedAt = new Date().toISOString();
  fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
}
if (result.status !== "PASS") process.exitCode = 1;
