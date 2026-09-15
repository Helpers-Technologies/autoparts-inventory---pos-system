# PartFlow production hardening — Phase 2 (A03)

Status: COMPLETE.

## 1. Objective and audit issue

Give each mobile `clientOpId` exactly one durable inventory effect, with a stored result that can be acknowledged again after network failure and application restart. Addresses A03; the portal field called `clientOperationId` in the audit reaches desktop as `clientOpId`.

## 2. Reproduction and root cause

`phase-2/delivery-before-fix.log` reproduces the real polling hook with a simulated remote queue/acknowledgement: the same add-two operation changes stock 10 → 12 → 14 when acknowledgement returns `ok:false`. The hook applied through deferred `adjustStock`, had no durable processing receipt, and ignored acknowledgement failure. A pending operation fetched again was planned against the new quantity and applied again.

## 3. Files and architecture

- `electron/mobile-stock-transaction.cjs`: validates mobile intents, reads authoritative encrypted-store products, applies existing whole-unit add/remove/count rules and branch correction rules, records movements/audit and indexed receipts within one transaction. A receipt lookup returns the original result with no stock writes, including duplicates inside one batch. Valid chunked stock history appends through its tail only; legacy history converts in the same transaction, and corruption rejects the whole operation.
- `electron/main.cjs`: `mobile-stock-ops:commit` requires authenticated inventory-adjust permission and the mobile entitlement. Fetch/resolve also enforce that boundary. Acknowledgement sends the stored receipt result, rather than trusting renderer-supplied result fields. Generic renderer mutations cannot rewrite receipts; startup omits receipt history.
- `electron/preload.cjs`, `src/types/desktop.d.ts`, `src/features/mobile/mobileStockOps.ts`: typed commit request/result contract.
- `src/store/AppContext.tsx`, `src/store/CatalogContext.tsx`: awaited mobile business action; persist pending desktop state before main reads stock; share checkout's execution lock; protect changed collections from stale debounce writes; adopt committed cache/state before close is released.
- `src/lib/storage.ts`, `src/store/persistenceBoundaries.ts`: main-owned receipt boundary and acknowledged-row cache adoption without loading historical stock chunks.
- `src/store/AutoPartsProContext.tsx`: reload committed branch stock after mobile application, retaining pending unrelated Pro edits.
- `src/features/mobile/useMobileStockOps.ts`: apply/acknowledge durable results, count only newly processed work, preserve counts on failed/throwing acknowledgement, retain a retriable error, and never acknowledge rejected persistence.
- New transaction and mounted-hook regressions, plus isolated native workflow/rollback probes and their network/database helpers.

Receipts live under `autoparts_inventory_v1::mobileStockOpReceipts#<SHA256(clientOpId)>`, using the existing KV primary-key index. They contain operation identity, product, kind, wire quantity, stored result and processing time. Main's transaction checks/inserts them together with inventory. No renderer history scan is needed to deduplicate.

## 4. Compatibility and migration

No SQL schema migration is required: historical encrypted KV databases accept new receipt keys. Existing products, branch IDs, collection/chunk format and whole-unit rounding remain unchanged. Unknown products and insufficient-stock removes retain their existing rejection rules; zero-delta counts get a receipt without a noise movement. Existing global correction behavior allocates increases to main and consumes main first on reductions.

This implementation prevents repeat application of operations first processed by the repaired path. Pre-repair operations have no receipts, so it cannot retrospectively distinguish an already applied but unacknowledged historical operation; that ambiguity must be reviewed before upgrading a shop with such a pending queue.

## 5. Tests and commands

```powershell
npx vitest run tests/integration/flows/mobile-stock-delivery.test.tsx --maxWorkers=1
npx vitest run tests/integration/flows/mobile-stock-delivery.test.tsx tests/unit/electron/mobile-stock-transaction.test.ts tests/unit/features/mobileStockOps.test.ts tests/integration/flows/money-stock-defects.test.tsx tests/integration/flows/branch-startup-hydration.test.tsx --maxWorkers=1
npx vitest run tests/unit/electron/mobile-stock-transaction.test.ts tests/integration/flows/mobile-stock-delivery.test.tsx tests/unit/lib/storage-chunking.test.ts tests/unit/store/persistence-boundaries.test.ts --maxWorkers=1
npx tsc -b
npx tsc -p tsconfig.test.json --noEmit
npx eslint electron/main.cjs electron/preload.cjs electron/mobile-stock-transaction.cjs src/features/mobile/useMobileStockOps.ts src/features/mobile/mobileStockOps.ts src/store/CatalogContext.tsx src/store/AppContext.tsx src/store/AutoPartsProContext.tsx src/lib/storage.ts tests/unit/electron/mobile-stock-transaction.test.ts tests/integration/flows/mobile-stock-delivery.test.tsx scripts/hardening-mobile-workflows.mjs scripts/hardening-electron-bootstrap.cjs scripts/hardening-db-probe.cjs
node --check electron/main.cjs
node --check electron/preload.cjs
node --check electron/mobile-stock-transaction.cjs
npx vite build
$env:PARTFLOW_HARDENING_PHASE='phase-2-final'; node scripts/hardening-mobile-workflows.mjs
$env:PARTFLOW_HARDENING_PHASE='phase-2-rollback'; node scripts/hardening-mobile-rollback.mjs
$env:PARTFLOW_HARDENING_PHASE='phase-2-final-critical'; node scripts/hardening-critical-baseline.mjs login-close-no-business-writes abrupt-immediate-sale two-branch-login
```

Standalone Vite remains a diagnostic renderer build for Electron execution, not an official build pass. The official build still runs TypeScript first.

## 6. Before/after and intermediate failures

- Initial mounted-hook reproduction: one failed test, quantity 14 instead of 12; exit 1.
- First implementation run: 41 passed/2 failed; newly added counter assertions caught a state replacement that discarded the counters after acknowledgement. The state merge was corrected; unchanged assertions passed.
- Subsequent targeted run: 43/43 passed across five files.
- Expanded durability run: 57/57 passed, including 19 main transaction cases, three mounted-hook cases, 32 storage cases and three ownership cases.
- Committed durability coverage: 58/58 passed after adding invalid legacy chronology rejection and unloaded receipt ownership assertions; 20 transaction cases.
- Final focused mobile run: 22/22 passed after receipt metadata and chronology validation changes.
- Transaction failures are injected at writes 1, 2, 4, 5, 7 and 9 in unit coverage. Rejected writes preserve the exact pre-transaction row map and leave no receipt; subsequent retry applies once.
- Changed-file lint: zero errors, six baseline AppContext hook warnings. Main/preload/transaction syntax checks pass.
- Desktop TypeScript still fails with baseline page contracts; no new mobile/store errors. The first test-type run exposed the deterministic ID test stub's mismatch with Node's UUID template return type. The ID factory is now typed as a general string-producing factory, preserving generated UUIDs in production; final type evidence is recorded after rerun.
- First native workflow run (`phase-2-verification`) failed because the test reader observed partially written evidence JSON. The evidence writer now writes a temporary file and renames it. That failed run is retained and excluded from acceptance; assertions and quantities were not weakened.
- Final test-type rerun (`final-test-types.log`) still exits 2 on baseline contracts and contains no changed mobile, storage, provider or transaction-test errors. Final changed-file lint (`final-committed-lint.log`) exits 0 with the same six baseline warnings.

## 7. Independent database verification

Native probes run the actual mounted polling hook, preload, permission-validated main commit and encrypted SQLite. Only the remote pending queue/acknowledgement is simulated; network isolation prevents any fixture data from reaching the live portal.

For each add/remove/count operation, acknowledgement fails twice, succeeds on redelivery, and redelivery continues after app restart. All replies must equal the durable receipt result. Independent native reads after confirmed PID exit require one receipt, one stock movement and one stock-adjustment audit entry:

| Operation from global 10, branch 3/7 | Global | Main | Secondary |
| --- | ---: | ---: | ---: |
| Add 2 | 12 | 5 | 7 |
| Remove 2 | 8 | 1 | 7 |
| Count 15 | 15 | 8 | 7 |

Products, branch quantities by exact key, invoices, cash, stock movements, receipts and stock-adjustment audit fingerprints must remain identical through restart/second close. Every acknowledgement after restart must come from the new app PID and carry the original stored result.

Native rollback probes interrupt the transaction through injected write failures, independently compare pre-operation canonical fingerprints after close, require no receipt, then reopen without the fault and deliver the same operation through the actual polling hook.

Final results: `phase-2-final/mobile-workflows.json` contains three passing add/remove/count scenarios; command exit 0. Canonical content, exact branch rows and receipt/stock-audit identities remained unchanged after restart, with the original result acknowledged from the new PID. `phase-2-rollback/mobile-rollback.json` contains two passing real main-process failure probes (write 1 after receipt insertion; write 7 during ledger persistence); command exit 0. Neither retained a partial receipt or stock effect, and retry through the mounted hook applied once.

Final critical regression rerun (`phase-2-final-critical/critical-reproduction.json`) also exited 0 with all three assertions passing: A01's 19,752 movements retained exact identity/content through close/reopen, an immediately forced-terminated A12 sale retained its invoice/cash/stock transaction and 19,753 movements through recovery, and A02 retained exact 3/7 allocation after login/restart.

## 8. Remaining program work

- Backups: raw KV/cloud snapshots include receipt keys, but the renderer's structured manual/folder/internal backup builder currently enumerates its old collections. Receipt export/restore must be integrated atomically with inventory during Phases 5/7; structured backup recovery is not accepted by this phase.
- Generic non-sale batch errors, concurrent unrelated edits, and recovery from an ambiguous main-IPC transport failure remain reliability work. Server acknowledgement failure/restart is the acceptance tested here.
- Full renderer-wide IPC review and employee negative tests remain Phase 3.
- Duplicate processing performs a pending desktop flush before main lookup; its large-dataset serialization cost remains measured optimization work in Phase 6.
- Production phone/server communication and the one-hour soak remain unverified until later phases.
- Baseline release pipeline and product-contract failures still block release-candidate approval.

## 9. Commit and recommendation

Implementation SHA: `7b9f5302a34dbcfb408eb9f656d9358ad30800ac`.

Phase acceptance: PASS for A03's first/duplicate/failed-ack/restart/add/remove/count criteria on operations processed by the repaired path. Proceed to Phase 3. Release-candidate acceptance remains FAIL; later program gates, structured receipt backup recovery and pre-upgrade pending-queue review remain required.
