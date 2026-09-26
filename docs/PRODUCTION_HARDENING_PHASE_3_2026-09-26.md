# Production hardening — Phase 3

**Date:** 2026-09-26

**Result:** PASS WITH CONDITIONS
**Scope:** Electron IPC mutation authorization, schema validation, atomic generic batches, and privileged desktop actions.

## Objective

Move authorization for every renderer-exposed mutation to the Electron main-process trust boundary. A compromised renderer or an employee using the preload API must not be able to create arbitrary KV rows, replace protected collections, modify immutable history, invoke owner-only backup/update operations, or obtain a partial success from a rejected batch.

## Reproduced defect

The isolated pre-fix Electron probe authenticated a real employee whose permission matrix was entirely false, then invoked the preload API directly. `storage:set` accepted `autoparts_inventory_v1::auditPermissionProbe`; the row was still present after a graceful close and an independent encrypted-SQLite read. The dedicated sale and mobile-stock channels already rejected this employee, which isolated the defect to the generic storage boundary.

Evidence: `reports/production-hardening-2026-09/phase-3-before-fix/ipc-permissions.json`.

## Root cause

`isRendererStorageKey` checked only the namespace prefix. Once a renderer had any authenticated session, `storage:set` and `storage:set-batch` accepted almost any prefixed key and did not compare logical before/after collection state against the stored employee permissions. `set-batch` also caught per-row errors and committed the remaining rows, so the caller could receive a failed result after a partial database mutation.

Several privileged channels were separately exposed without an owner-session check: update check/download/install/cancel/skip and directory selection. Bosta configuration stored some secrets before validating the rest of the request.

## Implementation

- Added `electron/storage-mutation-policy.cjs`, an explicit key catalogue and logical-diff authorization layer.
- Rejects unknown prefixed keys, operation-receipt keys, malformed chunk manifests, duplicate identities, invalid rows, excessive row counts and excessive payload sizes.
- Applies distinct add/edit/delete/receive/pay/cancel/adjust/stocktake/transfer/shift permissions instead of treating module access as blanket collection-write authority.
- Keeps stock movement, return, transfer, cash and audit history append-only or restricts removal to the corresponding invoice-delete permission.
- Scopes audit entries to the authenticated user and validates the audit action against that user's permission.
- Preserves legitimate coupled business operations, such as product quantity changes that accompany a permitted sale, purchase, return or stocktake.
- Makes `storage:set-batch` validate the complete projected state before entering one SQLCipher transaction. No row is written when any key or logical change is rejected.
- Applies the same policy to single-row writes, the atomic sale channel, raw backup import and cloud-archive restore.
- Limits generic removal and prefix clearing to an authenticated owner.
- Requires an owner session for update mutations and directory selection; backup encryption/decryption and writes remain owner-only.
- Validates every Bosta configuration field before rotating any stored integration secret.
- Restricts print-window operations to authenticated or main-authorized internal print renderers.
- Prevents an employee login from implicitly installing a new starter catalogue revision. Catalogue installation remains an owner operation; employees load the existing product list.
- Corrected sale fault injection to use the unpackaged-only `HW_E2E` gate.

No SQL schema migration was required. Existing KV rows remain compatible; authorization is enforced when a renderer attempts a mutation.

## Tests and evidence

Commands executed:

```text
npx vitest run tests/unit/electron/storage-mutation-policy.test.ts --reporter=dot
npx vitest run tests/unit/electron/storage-security.test.ts tests/unit/electron/storage-mutation-policy.test.ts tests/unit/electron/mobile-stock-transaction.test.ts tests/integration/flows/mobile-stock-delivery.test.tsx --reporter=dot
npx vitest run tests/unit/store/persistence-boundaries.test.ts tests/integration/flows/branch-startup-hydration.test.tsx tests/unit/lib/storage.test.ts tests/unit/lib/storage-ledger.test.ts tests/unit/lib/storage-chunking.test.ts tests/unit/lib/storage-chunking.property.test.ts tests/unit/lib/storage-append.test.ts --reporter=dot
$env:PARTFLOW_HARDENING_PHASE='phase-3-negative-final'; node scripts/hardening-ipc-permissions.mjs
$env:PARTFLOW_HARDENING_PHASE='phase-3-positive-clean'; node scripts/hardening-ipc-positive-sale.mjs
$env:PARTFLOW_HARDENING_PHASE='phase-3-final-critical-rerun'; node scripts/hardening-critical-baseline.mjs login-close-no-business-writes graceful-immediate-sale
npx vite build
npx tsc -b --pretty false
npx tsc -p tsconfig.test.json --noEmit --pretty false
npx eslint electron/main.cjs electron/storage-mutation-policy.cjs scripts/hardening-db-probe.cjs scripts/hardening-ipc-permissions.mjs scripts/hardening-ipc-positive-sale.mjs scripts/hardening-electron-bootstrap.cjs src/store/AppContext.tsx tests/unit/electron/storage-mutation-policy.test.ts
```

Results:

- Policy tests: 11/11 passed.
- Storage security plus mobile transaction/delivery: 60/60 passed.
- Persistence, chunking and branch hydration regression set: 110/110 passed.
- Negative real-Electron probe: all unauthorized storage, mixed-batch, removal, clear, import, export, backup, update, sale and mobile attempts rejected. The injected database key remained absent after close.
- Positive real-Electron probe: a scoped sales employee completed a real POS sale. Invoices 4,991→4,992, cash entries 6,265→6,266, stock movements 19,752→19,753, with the product quantity reduced exactly once.
- Critical regression: no-operation close preserved all 19,752 stock movements byte-for-byte; immediate sale survived close/restart with 19,753 movements.
- Vite production bundle passed.
- Focused ESLint passed with six pre-existing React hook warnings and no errors.
- Application and test TypeScript gates still fail on the previously uncommitted UI/settings work (new backup/license pages and older fixture typing). The Phase 3 files introduced no new reported TypeScript error. These failures are carried into Phase 4 rather than hidden or bypassed.

## Before/after database evidence

Before the repair, the denied employee's arbitrary key was durable after process exit. After the repair:

- `storage:set` unknown key: `false`
- direct products replacement: `false`
- mixed allowed-preference plus unknown-key batch: `false`, with no partial write
- database `permissionProbe`: `null`
- sale and mobile mutations without permission: rejected
- owner-only backup/update/import/export mutations: rejected
- SQLite `integrity_check`: `ok`

Evidence directories:

- `reports/production-hardening-2026-09/phase-3-negative-final/`
- `reports/production-hardening-2026-09/phase-3-positive-clean/`
- `reports/production-hardening-2026-09/phase-3-final-critical-rerun/`

## Risks and remaining conditions

- Phase 4 must repair the existing application/test TypeScript failures and run the complete lint, Vitest, Playwright and official build gates.
- Phase 5 must include durable mobile operation receipts in every structured backup/restore format and prove corrupt-backup rejection.
- Phase 7 still owns ambiguous lost-reply transport recovery, forced-close/restart matrices and the one-hour soak with independent database fingerprints.
- A pre-upgrade mobile operation already applied without a receipt cannot be inferred safely; it requires deployment review rather than a fabricated receipt.
- Retail-unit branch accounting still needs an explicit business rule because branch stock stores cartons only while global inventory also tracks loose pieces.

## Recommendation

Accept Phase 3 as **PASS WITH CONDITIONS** and stop this task at the requested boundary. Do not label the application production-ready until Phases 4–8 and their gates are complete.
