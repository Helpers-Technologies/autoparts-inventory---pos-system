# PartFlow production hardening — Phase 1C (A02)

Status: COMPLETE.

## 1. Objective and audit issue

Preserve inventory allocation by `(branchId, productId)` through login and restart, and verify real branch sales, transfers and stocktakes through immediate graceful close and recovery. Addresses A02.

## 2. Reproduction and root causes

Phase 0 independently reproduced the audit's main=3, secondary=7, global=10 becoming main=10 after login.

The mounted desktop-provider regression reproduced both an unauthenticated fallback write attempt and the subsequent allocation becoming main=10. Before authentication, the provider reads inaccessible storage as default branches and empty products. Its reconciliation effect discarded the stored secondary rows against this incomplete catalog/branch set. Its persistence guard also considered two null identities equal, allowing the optimistic storage cache to be populated with fallback data before login.

A real transfer exposed a second persistence defect: the UI reported success transferring two units, but closing before the separate 1.2-second Pro timer left durable allocations at 3/7 instead of 1/9, with no transfer record. AppProvider's awaited close transaction covered only its own state.

A further mounted regression reproduced loss of an unflushed transfer record when the sale-committed listener reloaded all Pro collections from storage. A sale updates branch stock but does not own pending transfer, branch or vehicle edits.

## 3. Files and architecture

- `src/store/AutoPartsProContext.tsx`: reconciliation and persistence require a non-null authenticated identity matching the completed hydration identity. Registers a hydrated live Pro snapshot for shutdown, using layout effects before success is painted. Sale notifications reload committed branch stock only.
- `src/store/persistenceBoundaries.ts`: explicit auxiliary persistence owners supply live snapshots to the awaited close transaction; only the six Pro collections are accepted. Auxiliary snapshots cannot replace root-owned products or the directly persisted stock ledger. Owners unregister on session loss/unmount.
- `src/store/AppContext.tsx`: root snapshot updates before paint; graceful close includes hydrated auxiliary snapshots in its awaited transaction. The renderer-navigation fallback also includes those owners.
- `scripts/hardening-critical-baseline.mjs`: reusable real-app helpers and exact A02 close/reopen assertions.
- `scripts/hardening-db-probe.cjs`: isolated two-branch workflow fixtures and independent stocktake fingerprints.
- `scripts/hardening-branch-workflows.mjs`: real UI branch sale, transfer, stocktake and transfer-then-sale probes, immediate close, independent SQLCipher reads, restart and second close.
- `tests/integration/flows/branch-startup-hydration.test.tsx`: startup, pending-transfer, stocktake and subsequent-sale regressions.
- `tests/unit/store/persistence-boundaries.test.ts`: auxiliary ownership restrictions and cleanup.

The close snapshot reconciles branch quantities against the same live products written in that transaction, so an immediately applied global stocktake cannot race the provider's normal reconciliation effect. Existing global-correction rules remain: unallocated increases go to the main branch; reductions consume main stock first. No new branch-specific stocktake rule is introduced.

## 4. Compatibility and migration

No schema or data migration. Existing collection keys, chunks, branch IDs and allocations retain their format. The original audit fixture and its encrypted database remain unchanged; probes mutate isolated copies only. Valid allocations are not redistributed by initialization.

## 5. Commands and tests

Evidence root: `reports/production-hardening-2026-09/` (ignored runtime artifacts).

```powershell
npx vitest run tests/integration/flows/branch-startup-hydration.test.tsx --maxWorkers=1
npx vitest run tests/integration/flows/branch-startup-hydration.test.tsx tests/unit/store/persistence-boundaries.test.ts tests/unit/store/auto-parts-pro.test.ts tests/integration/flows/money-stock-defects.test.tsx tests/unit/lib/storage-chunking.test.ts --maxWorkers=1
npx vitest run tests/unit/lib/storage-chunking.test.ts tests/unit/lib/storage-chunking.property.test.ts --maxWorkers=1
npx tsc -b
npx tsc -p tsconfig.test.json --noEmit
npx eslint src/store/AutoPartsProContext.tsx src/store/AppContext.tsx src/store/persistenceBoundaries.ts tests/integration/flows/branch-startup-hydration.test.tsx tests/unit/store/persistence-boundaries.test.ts scripts/hardening-branch-workflows.mjs scripts/hardening-critical-baseline.mjs scripts/hardening-db-probe.cjs
npx vite build
$env:PARTFLOW_HARDENING_PHASE='phase-1c'; node scripts/hardening-critical-baseline.mjs two-branch-login
$env:PARTFLOW_HARDENING_PHASE='phase-1c-before-close-fix'; node scripts/hardening-branch-workflows.mjs transfer
$env:PARTFLOW_HARDENING_PHASE='phase-1c-final'; node scripts/hardening-branch-workflows.mjs
$env:PARTFLOW_HARDENING_PHASE='phase-1c-final-critical'; node scripts/hardening-critical-baseline.mjs login-close-no-business-writes graceful-immediate-sale two-branch-login
```

The standalone Vite command is a diagnostic renderer build for native probes, not the official build gate. TypeScript remains enabled in `npm run build`.

## 6. Before/after evidence

- `phase-1c/hydration-before-fix.log`: both startup tests failed; preauth write attempted and main allocation became 10.
- `phase-1c/hydration-after-fix.log`: startup and existing pure-rule tests passed, 6/6.
- `phase-1c-before-close-fix/branch-workflows.json`: actual completed transfer failed durable 1/9 expectation; process exit confirmed.
- `phase-1c/transfer-sale-before-fix.log`: transfer record became empty on sale notification, 1 failed/4 passed.
- `phase-1c/final-regressions.log`: 54/54 tests passed across five files.
- `phase-1c/storage-regressions.log`: storage and property regressions passed 37/37.
- `phase-1c/final-lint.log`: zero errors, six pre-existing AppContext hook warnings.
- Desktop and test TypeScript gates still exit 2 on baseline contracts. The added transfer fixtures initially omitted their required `date`; this was corrected, their five runtime tests passed again, and `final-test-types.log` contains no changed-provider, boundary or hydration-test errors. No runtime assertion was weakened.

## 7. Independent database verification

The no-operation login/reopen probe (`phase-1c/critical-reproduction.json`) passed exact branch collection content and ID fingerprints: main=3, secondary=7, global=10 after both closes and renderer restart. Product normalization during hydration is outside that unchanged-branch assertion.

The real workflow probes require these exact durable rows after immediate close and after restart/second close:

| Operation | Main | Secondary | Global | Required records |
| --- | ---: | ---: | ---: | --- |
| Secondary branch sale, one unit | 3 | 6 | 9 | One invoice, cash entry and movement |
| Transfer two units from main | 1 | 9 | 10 | One completed transfer |
| Global stocktake to thirteen | 6 | 7 | 13 | One stocktake and adjustment movement |
| Transfer then secondary sale | 1 | 8 | 9 | Transfer plus invoice, cash and movement |

Each probe reads encrypted SQLite using Electron's matching ABI only after confirming the app PID stopped. After recovery, canonical content and ID hashes must match for products, branch stocks, invoices, cash, movements, transfers and stocktakes; both independent `integrity_check` results must be `ok`.

Final frozen-build results: all four scenarios in `phase-1c-final/branch-workflows.json` passed every required assertion; command exit 0. The final critical rerun also exited 0: A02 retained exact 3/7 allocations, the real immediate-close sale retained all effects and 19,753 movements, and the untouched 19,752-movement ledger retained exact canonical content and ID hashes after both closes/restart. The no-operation fingerprint assertion was independently checked against the saved JSON as well as added to the probe for future runs.

## 8. Remaining risks

- This phase verifies immediate graceful close for transfers/stocktakes. Forced interruption before their deferred write is outside this acceptance; unlike checkout, those operations have not yet been redesigned as dedicated main-process actions.
- Generic non-sale batches still have the historical per-row error behavior, pending the authorization/reliability phases.
- Existing global-stocktake allocation semantics and whole-unit mobile rules remain; no new loose-unit branch business rule is invented.
- Renderer reload's async fallback is not a physical power-loss guarantee.
- Baseline build, type, lint, test and product-contract failures still prevent release-candidate acceptance.

## 9. Commit and recommendation

Implementation SHA: `1643a2e3d07323df425429eef84bcf1019794cc2`.

Phase acceptance: PASS — proceed to Phase 2 (A03). Login/restart alone preserved exact allocation, and required real sale, transfer and stocktake workflows passed durable recovery comparisons. Release-candidate acceptance remains FAIL while subsequent authorized phase gates remain unresolved.
