import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf-8"));

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  test: {
    include: ["tests/{unit,component,integration}/**/*.test.{ts,tsx}"],
    environment: "node",
    globals: false,
    setupFiles: ["tests/helpers/setup.ts"],
    reporters: process.env.CI ? ["default", "junit"] : ["default"],
    outputFile: { junit: "reports/vitest-junit.xml" },
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      reportsDirectory: "coverage",
      // Previously scoped to src/lib + _pure.ts only — every page and store
      // context was silently excluded from the coverage report entirely, so
      // "80% coverage" never reflected the actual UI layer. Widened to the
      // whole app; thresholds are lowered accordingly below since the pages/
      // components layer starts from near-zero and can't jump to 80% at once.
      include: ["src/lib/**", "src/store/**", "src/pages/**", "src/components/**", "src/features/**"],
      exclude: ["**/*.d.ts", "src/lib/print.ts"],
      // Measured after widening `include` to the whole app (was 80% against
      // src/lib + _pure.ts only): ~23% lines/statements, ~17% functions,
      // ~17% branches. Set a bit below that real number so CI passes today —
      // raise these as more page/component tests land, not before.
      thresholds: {
        lines: 20,
        functions: 15,
        branches: 15,
        statements: 20,
      },
    },
  },
});
