# PartFlow production hardening — Phase 0

Status: COMPLETE. Product behavior has not been changed.

## 1. Objective

Capture the exact current working state and reproduce A01, A12 and A02 before implementing repairs. Source of truth: [September audit](SYSTEM_AUDIT_AR_2026-09-15.md).

## 2. Audit issues investigated

| Issue | Independently observed baseline |
| --- | --- |
| A01 | Login without opening inventory history, graceful close: 19,752 stock movements → 0. Reopening still reads 0. Existing invoices remain 4,991. |
| A01 after sale | A real POS sale followed immediately by graceful close preserves invoice 4,992 and cash entry 6,266, but deletes the movement ledger. |
| A12 | POS success followed by forced process-tree termination: invoices remain 4,991, cash entries remain 6,265, movements become 19,753, and product quantity remains 6,899. Recovery/login preserves the partial sale. |
| A12 control | Waiting for durable storage before forced termination retains the new invoice, cash entry and movement. |
| A02 | One product, total 10, catalog marker 3, branch-main=3 and branch-other=7: login replaces this with branch-main=10 and no secondary row; reopening preserves the incorrect distribution. |

These reproductions agree with the audit. No repair is inferred from source inspection or SQLite structural integrity.

## 3. Root causes supported by evidence

- A01: React starts with an empty lazy ledger. Direct ledger writes own persistence, but `flushPendingWritesNow` expands `liveStateRef`, including the unloaded ledger, into a replacement batch. The normal deferred batch already excludes that ledger.
- A12: `addSalesInvoice` appends movements directly but defers the invoice, product and cash state. POS displays success before this latter batch becomes durable. Branch consumption and customer credit are additional separate renderer operations.
- A02: `AutoPartsProContext` reconciles allocations without waiting for authoritative catalog and branch hydration. Empty/startup catalog state can discard valid allocations before the real products arrive.

## 4. Files changed

Only new engineering tooling and this report:

- `scripts/hardening-baseline.mjs`: state capture, user-work backup, branch creation, checks and individual command results.
- `scripts/hardening-db-probe.cjs`: independent encrypted SQLite inspection and isolated two-branch fixture.
- `scripts/hardening-electron-bootstrap.cjs`: isolated userData and external-network blocking.
- `scripts/hardening-critical-baseline.mjs`: real UI sale/shutdown/restart reproductions and confirmed PID termination.
- `docs/PRODUCTION_HARDENING_PHASE_0_2026-09-15.md`.

## 5. Architecture and migration

No product architecture, schema, business rule or migration has been changed. All mutation probes use copied synthetic audit fixtures under `reports/production-hardening-2026-09/phase-0`; real customer databases are not targeted.

## 6. Tests added or updated

Executable baseline probes were added. Existing assertions, expectations, skips and lint rules were not changed. Required repair regression assertions will be added in the corresponding implementation phases.

## 7. Commands and environment

- `git status --short`, `git rev-parse HEAD`, `git branch --show-current`, `git diff --binary HEAD`.
- `node scripts/hardening-baseline.mjs` runs `tsc -b`, test TypeScript, `eslint .`, Vitest, the unchanged official `npm run build`, and Playwright. Exact executable/argument arrays, timings and exit codes are in each `*.result.json`.
- `node node_modules/vite/bin/vite.js build`: a diagnostic renderer bundle from current source, solely to reproduce failures. It is not an official-build pass and does not replace the failed mandatory TypeScript gate.
- `node scripts/hardening-critical-baseline.mjs`.
- Electron's Node runtime runs `scripts/hardening-db-probe.cjs inspect` after process exit. Forced termination uses `taskkill /PID <owned test PID> /T /F`, followed by PID-liveness verification.
- Isolated rerun: `vitest run tests/component/LoginPage.test.tsx --maxWorkers=1`.

Runtime: Node 24.19.0; npm 11.17.0; Electron 39.8.10 (embedded Node 22.22.1); TypeScript 6.0.3; Windows x64 10.0.26200; AMD Ryzen 5 3500U; approximately 6.31 GB RAM. Actual Electron/Chromium versions are also captured in each reproduction's `runtime` object.

## 8. Before/after check results

| Check | Baseline | After repairs |
| --- | --- | --- |
| Application TypeScript | FAIL, exit 2 | Not run; no repair yet |
| Test TypeScript | FAIL, exit 2 | Not run; no repair yet |
| Official build | FAIL, exit 2 at mandatory TypeScript gate | Not run; no repair yet |
| Raw `eslint .` | FAIL, 225 errors / 104 warnings | Not run; no repair yet |
| Vitest | FAIL: 82/85 files pass; 1,172/1,179 tests pass; 7 fail | Not run; no repair yet |
| Electron E2E | PASS: 7 passed / 7 opt-in scenarios skipped by their existing guards; exit 0 | Not run; no repair yet |
| Diagnostic renderer bundle | Exit 0; reproduction-only | Not a release gate |

The raw lint command traverses historical audit copies and the preserved user-work copies because the existing config ignores only `dist` and `coverage`; its 329 findings are not 329 unique product defects. The full raw result is retained. Artifact scope must be handled explicitly in Phase 4, without disabling product rules.

Vitest failures: four missing-provider failures in `IntegrationsPageSetup`, two moved-backup-controls failures in `SettingsPageBackupRestore`, and one login recovery timeout in the concurrent baseline. The unchanged login test passes 8/8 in the isolated rerun; this is evidence of sensitivity to concurrent load, not a reason to erase the failed baseline or weaken assertions. Types also expose obsolete permission fixtures plus actual UI/IPC contract problems.

## 9. Database verification and evidence

Evidence root: [`phase-0`](../reports/production-hardening-2026-09/phase-0/).

- [`initial-state.json`](../reports/production-hardening-2026-09/phase-0/initial-state.json), `user-work.patch`, and `user-work/`: starting status, SHA-256 hashes and preserved content.
- [`critical-reproduction.json`](../reports/production-hardening-2026-09/phase-0/critical-reproduction.json): original-source database path, per-scenario runtime, counts, canonical record hashes, identity hashes, restart capture and exit confirmation.
- Each scenario directory contains `native-before-login.json`, `native-after-close.json`, `native-after-reopen-close.json` where the read completed, and network-isolation evidence on graceful exit.
- [`abrupt-immediate-retry.json`](../reports/production-hardening-2026-09/phase-0/abrupt-immediate-retry.json) and [`abrupt-immediate-restart-followup.json`](../reports/production-hardening-2026-09/phase-0/abrupt-immediate-restart-followup.json): successful independent follow-up of the immediate-crash scenario. The first post-kill native read failed with `SQLITE_IOERR_TRUNCATE`; that error remains in the original reproduction and log. A later read succeeded and recovery/login retained the missing-invoice/surviving-movement defect. The cause of the transient I/O error is not established.

Successful native reads report `integrity_check=ok`, including logically broken states. The original synthetic fixture lacks the starter-catalog migration marker: its first login adds 115 catalog products and 1,195 to summed product quantity, as already identified by A10. Comparisons for sale effects therefore use `beforeSale`/`afterLogin`, rather than claiming the original total was unchanged. The A02 fixture explicitly sets marker 3 and excludes this confounder.

## 10. Remaining risks

All reproduced product defects remain unfixed. The baseline probes do not establish transaction safety, large-dataset capacity, authorization safety, backup recovery, soak stability, signing or release readiness. A graceful second close can delete the ledger of a crash-recovered database again, so the immediate-crash native follow-up is the relevant pre-close evidence.

## 11. Git commits and preservation

Original branch: `main`. Original and repair starting HEAD: `55837aa6ecdca07a25364026cd641b37d224da66`. Dedicated branch: `repair/production-hardening-2026-09`.

Starting user work: 18 tracked paths (including the existing deleted ImportPage) and four untracked files. `scripts/hardening-baseline.mjs` itself was added by this program immediately before the capture and is not pre-existing user work. No reset, clean, revert, historical checkout, customer-data mutation or unrelated-work commit was performed.

Phase evidence/tooling commit: `4532a4b` (`test(hardening): capture production repair baseline`).

## 12. Recommendation

PASS — proceed to Phase 1A. The three critical reproduction results agree with the audit, so the audit-contradiction stop condition has not been triggered. Phase 0 passes as an evidence-capture gate; product release readiness remains FAIL.
