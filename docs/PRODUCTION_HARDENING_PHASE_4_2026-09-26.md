# Production hardening — Phase 4

**Date:** 2026-09-26  
**Result:** PASS  
**Scope:** A05 release-pipeline health and the relevant A11 test-contract repairs.

## Objective

Restore every required desktop release gate without bypassing TypeScript, weakening assertions, increasing test timeouts, or hiding product failures: application types, test types, ESLint, Vitest, Electron E2E, and the official production build.

## Audit issues addressed

- A05: the desktop build and type pipeline did not compile.
- A11 (relevant contract portion): component fixtures and page tests described older contracts and page ownership.
- A Phase 3 regression found by E2E: owner-only directory IPC blocked the first-run wizard before the owner account existed.

## Root cause discovered

The in-progress settings split moved backup/import, licence/update, referral, and mobile-linking controls into new pages but left stale imports, invalid settings fields, old licence result shapes, and tests aimed at `SettingsPage`. Test fixtures also lagged required fields added to the current domain types.

Vitest's default unbounded worker count saturated this high-core host. Two real `user-event` recovery flows then exceeded their unchanged five-second interaction timeout only during the full suite; both passed in isolation. Capping workers at four kept timers responsive without increasing timeouts.

The Phase 3 directory authorization required an existing owner session. The first-run wizard legitimately selects its backup and invoice directories before creating the first user, so it could never advance beyond step 5.

## Files and architecture changed

- Completed the page split into `BackupAndRestorePage`, `LicenseAndUpdatesPage`, `IntegrationsPage`, and the remaining general `SettingsPage` controls.
- Replaced the obsolete `/import` route with owner-only backup/restore navigation and added the owner-only licence/update route.
- Aligned licence UI calculations with signed start/expiry fields and the typed IPC activation result.
- Removed unsupported settings fields and dead state/actions exposed by the page split.
- Kept directory selection owner-only after initialization, with a narrow bootstrap allowance only while the durable users collection is empty.
- Excluded generated output directories already ignored by Git from ESLint traversal; application and test source remain linted.
- Limited Vitest to four workers to make the unchanged interaction timeouts deterministic.

No SQL or customer-data migration was required.

## Tests updated

- Updated fixtures to current `AppUser`, `SalesInvoice`, `CashEntry`, `VehicleMake`, and permission contracts.
- Retargeted the internal-backup confirmation test to `BackupAndRestorePage`; it still proves that restore cannot execute before explicit confirmation.
- Supplied the application context required by the expanded integrations page while retaining all Bosta setup assertions.
- Preserved the destructive restore warning and its exact confirmation contract.
- Ran the real first-run Electron flow after repairing bootstrap directory authorization.

## Commands and results

```text
npm run build
npm run typecheck:tests
npm run lint
npm test
npm run test:e2e
node --check electron/main.cjs
```

- Application TypeScript and official Vite production build: passed.
- Test TypeScript: passed.
- ESLint: exit 0, zero errors, 21 non-blocking pre-existing warnings.
- Vitest: 90 files passed; 1,230 tests passed; zero failed.
- Playwright/Electron: all 7 enabled tests passed; 9 explicitly opt-in profiling/load/durability tests remained skipped by their existing environment gates.
- Production bundle generated successfully. Vite reports a non-blocking 3.15 MB main chunk (735 kB gzip), retained for Phase 6 performance work.

Before repair, application/test TypeScript failed, lint reported blocking errors, and the full desktop suite had seven known failures. The first Phase 4 run exposed eight failures: six obsolete page/provider contracts and two resource-starved recovery interactions. After the repairs, the complete suite is green with the original assertions and timeouts.

## Database verification

Phase 4 introduced no persistence schema change. Electron E2E used isolated fresh encrypted SQLite databases and completed owner creation, logout/login, MFA recovery, permission denial, rate limiting, customer workflow, boot, and guarded-page rendering. The enabled E2E set passed after close of each isolated application.

The Phase 3 authorization guarantees remain intact: initialized shops require an owner session for directory selection; only a database with zero users receives the first-run bootstrap allowance.

## Risks and remaining work

- Twenty-one existing lint warnings should be reduced when their owning modules are changed; none is a lint error.
- The large renderer bundle needs measured code-splitting work in Phase 6 rather than an arbitrary warning-limit change.
- The nine opt-in profiling/load/durability E2E cases belong to Phases 6 and 7 and were not relabelled as ordinary release tests.
- Phase 5 must finish the cross-product licence/package/route contract review and automatic-backup scheduling contract.

## Git commits

- `2872b88` — `fix(build): restore release pipeline health`
- Documentation commit: this report.

## Recommendation

**PASS — proceed to Phase 5.** Every Phase 4 acceptance gate completed successfully without bypasses or weakened tests.
