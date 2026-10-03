import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

describe("Phase 12C projection upgrade workflow", () => {
  it("keeps completion authoritative and supports progress, failure, interruption detection and retry", () => {
    const electron = path.resolve("node_modules/.bin/electron.cmd");
    const output = execFileSync(electron, ["scripts/phase12c-upgrade-workflow-smoke.cjs"], {
      cwd: process.cwd(), encoding: "utf8", env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      shell: process.platform === "win32",
      timeout: 30_000,
    });
    const result = JSON.parse(output.trim());
    expect(result.ok).toBe(true);
    expect(result.cases).toContain("retry");
    expect(result.cases).toContain("legacy-catalog-schema");
  });
});
