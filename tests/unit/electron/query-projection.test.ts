import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Phase 12 query projection", () => {
  it("keeps canonical/projection synchronization, rollback, search, statements and dashboard correct", () => {
    const repo = process.cwd();
    const electron = path.join(repo, "node_modules", ".bin", process.platform === "win32" ? "electron.cmd" : "electron");
    const output = execFileSync(electron, ["scripts/phase12-projection-smoke.cjs"], {
      cwd: repo,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      encoding: "utf8",
      shell: process.platform === "win32",
      timeout: 30_000,
    });
    expect(JSON.parse(output.trim())).toMatchObject({ ok: true, integrity: "ok" });
  });
});
