"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { FIXTURES, GENERATOR_VERSION } = require("./scale-fixture-config.cjs");

const repo = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const valueOf = (name, fallback = "") => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const dataRoot = path.resolve(valueOf("--data-root", path.join(repo, "scale-fixtures", "phase-10")));
const reportRoot = path.resolve(valueOf("--report-root", path.join(repo, "reports", "performance-scale-2026-09", "phase-10-manifests")));
const only = valueOf("--only");
const through = valueOf("--through");
const summaryOnly = args.includes("--summary-only");
let selected = only ? FIXTURES.filter((item) => item.name === only) : [...FIXTURES];
if (through) {
  const end = selected.findIndex((item) => item.name === through);
  if (end < 0) throw new Error(`unknown --through fixture: ${through}`);
  selected = selected.slice(0, end + 1);
}
if (selected.length === 0) throw new Error(`unknown fixture: ${only}`);

fs.mkdirSync(dataRoot, { recursive: true });
fs.mkdirSync(reportRoot, { recursive: true });

function run(label, command, commandArgs, options = {}) {
  console.log(`\n[${label}] ${command} ${commandArgs.join(" ")}`);
  const started = process.hrtime.bigint();
  const result = spawnSync(command, commandArgs, {
    cwd: repo,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, NODE_OPTIONS: "--max-old-space-size=12288", ...options.env },
  });
  const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} failed with exit code ${result.status}`);
  return { label, command: [command, ...commandArgs].join(" "), durationMs };
}

const electronCli = path.join(repo, "node_modules", "electron", "cli.js");
const ladderSummary = {
  generatorVersion: GENERATOR_VERSION,
  generatedAt: new Date().toISOString(),
  dataRoot,
  reportRoot,
  fixtures: [],
};

function writeCompleteSummary() {
  ladderSummary.generatedAt = new Date().toISOString();
  ladderSummary.fixtures = FIXTURES.flatMap((fixture) => {
    const manifestPath = path.join(reportRoot, `${fixture.name}.manifest.json`);
    if (!fs.existsSync(manifestPath)) return [];
    return [{ ...JSON.parse(fs.readFileSync(manifestPath, "utf8")), manifestPath }];
  });
  const summaryPath = path.join(reportRoot, "phase-10-summary.json");
  fs.writeFileSync(summaryPath, `${JSON.stringify(ladderSummary, null, 2)}\n`);
  return summaryPath;
}

if (summaryOnly) {
  const summaryPath = writeCompleteSummary();
  console.log(`compiled ${ladderSummary.fixtures.length} fixture manifests: ${summaryPath}`);
  process.exit(0);
}

for (const fixture of selected) {
  const fixtureDir = path.join(dataRoot, fixture.name);
  const summaryDir = path.join(fixtureDir, "summaries");
  fs.mkdirSync(summaryDir, { recursive: true });
  const datasetPath = path.join(fixtureDir, "dataset");
  const profileDir = path.join(fixtureDir, "profile");
  const generatorSummaryPath = path.join(summaryDir, "generator.json");
  const scaleValidationPath = path.join(summaryDir, "scale-validation.json");
  const databaseSummaryPath = path.join(summaryDir, "database.json");
  const commands = [];

  commands.push(run(`${fixture.name}: generate`, process.execPath, [
    "scripts/generate-load-test-dataset.cjs",
    "--bundle-dir", datasetPath,
    "--summary-out", generatorSummaryPath,
    "--years", String(fixture.years),
    "--customers", String(fixture.customers),
    "--invoices", String(fixture.salesInvoices),
    "--minimum-sales-invoices", String(fixture.minimumSalesInvoices),
    "--purchase-invoices", String(fixture.purchaseInvoices),
    "--products", String(fixture.products),
    "--suppliers", String(fixture.suppliers),
    "--seed", String(fixture.seed),
  ]));
  commands.push(run(`${fixture.name}: invariants`, process.execPath,
    ["scripts/verify-load-test-dataset.cjs", datasetPath]));
  commands.push(run(`${fixture.name}: scale validation`, process.execPath,
    ["scripts/validate-scale-fixture.cjs", datasetPath, "--summary-out", scaleValidationPath]));
  commands.push(run(`${fixture.name}: encrypted database`, process.execPath, [
    electronCli, "scripts/seed-stress-profile.cjs", datasetPath, profileDir,
    "--summary-out", databaseSummaryPath,
  ], { env: { ELECTRON_RUN_AS_NODE: "1" } }));

  const generator = JSON.parse(fs.readFileSync(generatorSummaryPath, "utf8"));
  const validation = JSON.parse(fs.readFileSync(scaleValidationPath, "utf8"));
  const database = JSON.parse(fs.readFileSync(databaseSummaryPath, "utf8"));
  const manifest = {
    fixture: fixture.name,
    generatedAt: new Date().toISOString(),
    generator: {
      path: "scripts/generate-load-test-dataset.cjs",
      version: GENERATOR_VERSION,
      seed: fixture.seed,
      config: fixture,
    },
    artifacts: {
      sourceDataset: { path: datasetPath, bytes: generator.bytes, sha256: generator.sha256 },
      encryptedDatabase: { path: database.databasePath, bytes: database.bytes, sha256: database.sha256 },
    },
    counts: generator.counts,
    salesLineBuckets: generator.salesLineBuckets,
    validation: {
      sourceBusinessInvariants: "PASS",
      scaleChecks: validation.valid ? "PASS" : "FAIL",
      sqliteIntegrity: database.integrity,
      sqlcipherIntegrity: database.cipherIntegrity,
    },
    resourceMetrics: {
      generatorMs: generator.generationMs,
      generatorPeakRssBytes: generator.peakRssBytes,
      validatorMs: validation.validationMs,
      validatorPeakRssBytes: validation.peakRssBytes,
      databaseWriteMs: database.writeMs,
      databaseTotalMs: database.totalMs,
      databasePeakRssBytes: database.peakRssBytes,
    },
    commands,
  };
  const manifestPath = path.join(reportRoot, `${fixture.name}.manifest.json`);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`[${fixture.name}] complete: ${manifestPath}`);
}

const summaryPath = writeCompleteSummary();
console.log(`\ncompleted ${selected.length} fixture(s); ${ladderSummary.fixtures.length} in ${summaryPath}`);
