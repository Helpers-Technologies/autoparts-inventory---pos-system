import fs from "node:fs";
import path from "node:path";
import { startApp, stop } from "./hardening-critical-baseline.mjs";

const root = process.cwd();
const source = path.join(root, "scale-fixtures", "phase-10", "scale-200k", "profile", "autoparts-inventory.secure.sqlite");
const work = path.join(root, "reports", "production-hardening-2026-09", "phase-14", "ui-inventory");
fs.mkdirSync(work, { recursive: true });
const db = path.join(work, "autoparts-inventory.secure.sqlite");
if (!fs.existsSync(db)) fs.copyFileSync(source, db, fs.constants.COPYFILE_EXCL);

const routes = ["/", "/pos", "/customers", "/purchases", "/purchases/new", "/dues", "/returns", "/quotations", "/quotations/new", "/inventory", "/branches", "/backup-and-restore"];
const result = { capturedAt: new Date().toISOString(), db, routes: {} };
let handle;
try {
  handle = await startApp(db);
  for (const route of routes) {
    await handle.page.evaluate((value) => { location.hash = value; }, route);
    await handle.page.waitForTimeout(1200);
    result.routes[route] = await handle.page.locator("body").evaluate((body) => {
      const clean = (value) => String(value || "").replace(/\s+/g, " ").trim().slice(0, 180);
      return {
        title: clean(body.querySelector("h1")?.textContent),
        buttons: [...body.querySelectorAll("button")].map((node, index) => ({ index, text: clean(node.textContent), title: node.getAttribute("title"), disabled: node.disabled })).filter((row) => row.text || row.title),
        inputs: [...body.querySelectorAll("input,textarea,select")].map((node, index) => ({ index, tag: node.tagName.toLowerCase(), type: node.getAttribute("type"), name: node.getAttribute("name"), ariaLabel: node.getAttribute("aria-label"), placeholder: node.getAttribute("placeholder"), value: node.value, disabled: node.disabled })),
        links: [...body.querySelectorAll("a")].map((node, index) => ({ index, text: clean(node.textContent), href: node.getAttribute("href") })).filter((row) => row.text),
      };
    });
    console.log(JSON.stringify({ route, title: result.routes[route].title, buttons: result.routes[route].buttons.length, inputs: result.routes[route].inputs.length }));
  }
} finally {
  if (handle) await stop(handle).catch(() => undefined);
  fs.writeFileSync(path.join(root, "reports", "performance-scale-2026-09", "phase14-repeat-ui-inventory.json"), `${JSON.stringify(result, null, 2)}\n`);
}
