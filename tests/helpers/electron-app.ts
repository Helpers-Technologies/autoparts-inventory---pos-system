import { _electron as electron } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import fs from "node:fs";

export interface ElectronHandle {
  app: ElectronApplication;
  window: Page;
  dbPath: string;
}

export function authenticatedShellMarker(window: Page) {
  return window
    .getByRole("button", { name: "تسجيل الخروج", exact: true })
    .first();
}

/**
 * Dismisses the optional first-login changelog without Playwright waiting for
 * actionability on a node that AppLayout can replace during post-login state
 * hydration. HTMLElement.click() runs as soon as the locator resolves; the
 * short timeout also keeps the absent/detached case bounded.
 */
export async function dismissWhatsNewIfPresent(window: Page): Promise<void> {
  const dismissButton = window.getByRole("button", {
    name: "تمام، فهمت",
    exact: true,
  });

  try {
    await dismissButton.evaluate(
      (button: HTMLButtonElement) => button.click(),
      undefined,
      { timeout: 1_500 },
    );
  } catch (error) {
    // A post-login remount can remove the whole optional dialog between
    // locator resolution and evaluation. That is already the desired state.
    if (!(await dismissButton.isVisible().catch(() => false))) return;
    throw error;
  }

  await dismissButton.waitFor({ state: "hidden", timeout: 1_500 });
}

export async function launchElectron(options: { dbPath?: string } = {}): Promise<ElectronHandle> {
  const tmpDir = options.dbPath
    ? path.dirname(path.resolve(options.dbPath))
    : path.join(os.tmpdir(), `hw-e2e-${crypto.randomUUID()}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  const dbPath = options.dbPath
    ? path.resolve(options.dbPath)
    : path.join(tmpDir, "autoparts-inventory.secure.sqlite");

  // Build env WITHOUT ELECTRON_RENDERER_URL so main.cjs runs in production mode
  // (isDev = Boolean(ELECTRON_RENDERER_URL)) and loads the built dist/. Setting
  // the key to `undefined` is not enough — Node stringifies it to "undefined",
  // which is truthy and flips the app into dev mode, crashing the launch.
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "test",
    HW_E2E: "1",
    HW_E2E_DB_PATH: dbPath,
  };
  delete env.ELECTRON_RENDERER_URL;
  // Some development shells export this globally so native SQLite utilities
  // can run against Electron's ABI. Playwright must launch the real Electron
  // runtime, not Electron's Node-compatible mode.
  delete env.ELECTRON_RUN_AS_NODE;

  const app = await electron.launch({
    args: [path.resolve("electron/main.cjs")],
    env: env as Record<string, string>,
  });

  const window = await app.firstWindow();
  await window.waitForLoadState("domcontentloaded");

  return { app, window, dbPath };
}

export async function closeElectron(handle: ElectronHandle): Promise<void> {
  try {
    await handle.app.close();
  } catch {
    // Already closed — ignore.
  }
}
