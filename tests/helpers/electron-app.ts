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

export async function launchElectron(): Promise<ElectronHandle> {
  const tmpDir = path.join(os.tmpdir(), `hw-e2e-${crypto.randomUUID()}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  const dbPath = path.join(tmpDir, "autoparts-inventory.secure.sqlite");

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
    args: process.platform === "linux"
      ? ["--no-sandbox", path.resolve("electron/main.cjs")]
      : [path.resolve("electron/main.cjs")],
    env,
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
