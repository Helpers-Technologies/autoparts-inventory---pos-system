# PartFlow production hardening — Phase 1A (A01)

Status: COMPLETE.

## 1. Objective

Prevent an unloaded React stock-movement ledger from replacing the durable ledger during graceful shutdown, and preserve complete backups when inventory history has not been opened.

## 2. Audit issue addressed

A01 — stock movement history loss after graceful close.

Baseline reproduced in Phase 0: 19,752 durable movements before login and 0 after graceful close. A real sale preserved its invoice and cash entry but the complete ledger was again replaced by zero records.

## 3. Root cause

`stockMovements` deliberately starts as `[]` and stays unloaded until an inventory-history screen requests it. Ledger append/delete helpers persist their own chunks directly. The normal debounced React-state batch respected this ownership and excluded `stockMovements`, but the graceful-close flush and `beforeunload` fallback spread all of `liveStateRef`, including the unloaded `[]`, into a full replacement write.

Backup creation also relied on a storage read whose lazy behavior was implicit. Internal automatic backup copied the React snapshot directly and could therefore contain the unloaded empty ledger.

## 4. Files changed

- `src/store/persistenceBoundaries.ts`: declares collections with direct persistence ownership and filters them out of generic state writes.
- `src/store/AppContext.tsx`: applies that boundary to both close paths; explicitly loads the authoritative ledger only when producing a complete backup.
- `tests/unit/store/persistence-boundaries.test.ts`: proves a generic flush omits the ledger whether unloaded or hydrated.
- `tests/unit/lib/storage-ledger.test.ts`: proves one explicit lazy collection load supplies all authoritative chunks for backup-style reads.
- `tests/e2e/flows/stock-ledger-shutdown.spec.ts`: persisted regression for unopened-history shutdown and a real sale followed by immediate graceful close/reopen.
- `tests/e2e/helpers/profileDb.ts` and `profileDbReader.cjs`: independent canonical fingerprinting under Electron's matching native-module ABI.
- `scripts/hardening-critical-baseline.mjs`: selectable phase/source inputs for repeatable small and large probes.
- `scripts/hardening-electron-bootstrap.cjs`: records batch-key traces in isolated test processes.

An unrelated pre-existing edit in `src/store/AppContext.tsx` was deliberately left unstaged and is not in the phase commit.

## 5. Architecture changes

Generic renderer-state persistence now has an explicit allow-by-ownership boundary: directly persisted collections cannot enter generic state batches. This makes both an unloaded empty array and a hydrated historical array incapable of replacing the durable ledger during close.

Backups are different: they intentionally require complete data. Backup creation explicitly loads the authoritative ledger once, only when a backup is requested, and exports it in the historical newest-first backup contract. Normal startup and shutdown do not load the ledger into React.

## 6. Tests added or updated

- 2 persistence-boundary cases: unloaded and loaded ledger.
- Lazy ledger fetch test with 1,200 records across chunks.
- Electron/database regression: unopened history → graceful close → native fingerprint → reopen → graceful close → native fingerprint.
- Electron/database regression: real POS sale → immediate graceful close → native fingerprint → reopen → graceful close → native fingerprint.
- Original small fixture probes and representative large fixture probe.

The E2E fingerprint canonicalizes object keys and sorts records by identity representation. This permits an intentional one-time chronological migration while still detecting any missing, duplicated or changed movement.

## 7. Commands executed

- Diagnostic renderer build: `node node_modules/vite/bin/vite.js build` (required because Electron production mode loads `dist`; this does not replace the failing official build gate).
- `node scripts/hardening-critical-baseline.mjs login-close-no-business-writes graceful-immediate-sale` with the small audit source.
- The same no-write scenario with `PARTFLOW_HARDENING_SOURCE_DB` pointing at the large audit source.
- `vitest run tests/unit/store/persistence-boundaries.test.ts tests/unit/lib/storage-ledger.test.ts --maxWorkers=1`.
- `playwright test tests/e2e/flows/stock-ledger-shutdown.spec.ts` with `PARTFLOW_LEDGER_REGRESSION_DB` pointing at an isolated source fixture.
- ESLint on all changed TypeScript test/helper files and separately on `AppContext.tsx`.
- Application and test TypeScript checks, retained even though known baseline failures remain.

One early post-change probe accidentally ran against the pre-change `dist` bundle and reproduced the old 19,752 → 0 result. It was stopped, retained as excluded evidence, then the renderer was rebuilt and every acceptance probe was rerun. This excluded run is not counted as validation of the fix.

## 8. Before/after results

| Scenario | Before | After fix |
| --- | --- | --- |
| Small, login/close, history unopened | 19,752 → 0 | 19,752 → 19,752 → 19,752 after reopen/second close; content and ID hashes identical |
| Small, real sale/immediate graceful close | ledger deleted | invoices 4,991 → 4,992; cash 6,265 → 6,266; movements 19,752 → 19,753; post-sale ledger hash survives reopen |
| Large, login/close, history unopened | audit had complete ledger loss on comparable large runs | 336,849 → 336,849 → 336,849; content and ID hashes identical |
| Targeted unit tests | no ownership-boundary regression | 23/23 pass |
| Stored Electron regression | absent | 2/2 pass in 1.4 minutes |
| Changed-file ESLint | baseline not isolated | exit 0 |
| Application TypeScript | baseline FAIL | still FAIL on documented Settings/UI contract issues; no errors in A01 files |
| Test TypeScript | baseline FAIL | still FAIL on obsolete permission fixtures; no errors in A01 files after correction |

## 9. Database verification

All reported counts and hashes come from the encrypted SQLite database while no application process owns it. Each graceful-close probe records and verifies the Electron PID stopped. Native reads report `integrity_check=ok`, but acceptance is based on logical count plus canonical content and identity hashes.

Evidence paths (ignored runtime artifacts):

- `reports/production-hardening-2026-09/phase-1a-small/critical-reproduction.json`
- `reports/production-hardening-2026-09/phase-1a-large/critical-reproduction.json`
- `reports/production-hardening-2026-09/phase-1a-e2e-final.log`
- `reports/production-hardening-2026-09/phase-1a-unit-final.log`
- `reports/production-hardening-2026-09/phase-1a-types.log`
- `reports/production-hardening-2026-09/phase-1a-test-types-rerun.log`
- Per-run `native-before-login.json`, `native-after-close.json`, `native-after-reopen-close.json`, `persistence-trace.json`, and `network-isolation.json`.

## 10. Remaining risks

A12 transaction atomicity and A02 branch hydration remain reproducible and unfixed. The full build/type/lint/test pipeline remains a later phase gate. Backup restoration, crash interruption, and soak behavior are not claimed by this phase. Backup creation still serializes the complete ledger when explicitly requested; its large-dataset cost will be measured in the performance/reliability phases.

## 11. Git commits

- `c628bfa` — `fix(storage): preserve lazy stock movement ledger on shutdown`
- This phase report is committed separately immediately after the implementation commit.

## 12. Recommendation

PASS — proceed to Phase 1B (A12). The required no-operation and real-sale graceful-close acceptance paths preserve the durable ledger across restart on small and large representative data.
