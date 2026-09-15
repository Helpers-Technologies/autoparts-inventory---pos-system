# PartFlow production hardening — Phase 1B (A12)

Status: COMPLETE.

## 1. Objective and audit issue

A12: make completed sales atomic and durable before the application reports success. Phase 0 reproduced a forced termination after UI success that kept one stock movement while losing the invoice, cash receipt and product deduction.

## 2. Root cause

`addSalesInvoice` returned synchronously after scheduling React updates. The ledger appended directly to storage, while invoice/product/cash/audit arrays waited for the two-second batch timer. POS then independently scheduled branch consumption, delivery creation and customer-credit settlement. SQLite transactions around those separate batches could not make the complete business operation atomic.

The generic `storage:set-batch` handler also catches individual row errors inside its transaction and commits the other rows. It is therefore unsuitable as the acknowledgment boundary for a completed sale.

## 3. Files changed

- `electron/main.cjs`: dedicated `sales:commit` handler with one SQLCipher transaction, a sale-module permission check, a narrow collection allowlist, required core manifests and JSON validation. Any write error aborts the whole transaction. Test-only failure injection is gated by `HW_E2E`.
- `electron/preload.cjs` and `src/types/desktop.d.ts`: asynchronous `commitSale` contract.
- `src/lib/storage.ts`: prepares collection rows plus a lazy ledger append, awaits the dedicated transaction and advances cache/identity metadata only after success. Blocks stale timer batches for the in-flight business keys.
- `src/store/AppContext.tsx`: asynchronous sale action reads the latest live store even when a context retains an older action. Computes invoice, payment log, cash, product stock, credit sources, audit and optional quotation conversion before writing. Publishes React state and the live shutdown snapshot only after commit. Shutdown awaits in-flight sale durability; normal timer batches also read the latest live snapshot. Default branch reconciliation is included in that write when the caller does not supply explicit branch rows.
- `src/types/index.ts` and `src/store/InvoicingContext.tsx`: sale-effects and asynchronous action contracts.
- `src/store/AutoPartsProContext.tsx` and `src/store/ShippingContext.tsx`: pure preparation helpers and committed-sale cache reload events.
- `src/pages/POSPage.tsx`, `SalesInvoiceNewPage.tsx` and `QuotationDetailPage.tsx`: prepare associated rows and await commit before success, sequence advancement, draft clearing or navigation. Separate post-sale credit/branch/shipping mutations were removed from these paths.
- `tests/unit/lib/storage-chunking.test.ts`: durable sale, rejected-cache and stale-timer regressions.
- `tests/integration/flows/money-stock-defects.test.tsx`: rejected sale, retained-action stock, explicit branch/delivery and credit/cash regressions; existing sale tests await the new contract.
- `tests/integration/flows/system-probe.test.tsx`: existing sale/conversion tests await durability and assert rejected asynchronous conversions.
- `scripts/hardening-critical-baseline.mjs` and `hardening-electron-bootstrap.cjs`: actual POS interruption and failure-stage probes, canonical database comparisons and IPC write traces.

Pre-existing branding, product-card and product-audit edits are excluded from the implementation commit. All other original user changes remain in the working tree.

## 4. Business-state ownership

The transaction includes complete invoice data/items, initial payment history, product deductions, cash receipts, stock-ledger append, branch allocations, sale audit entries, delivery orders when present and quotation conversion when present. Customer balances are derived from invoices; credit usage modifies both source credit and target payment in the same transaction. Credit is capped by actual available credit and does not increase cash received.

Open-shift summaries and accounting/reporting totals are derived from committed invoices, returns and cash entries. Sale and cash rows retain their cashier/shift IDs. Creating a sale does not write separate persisted shift aggregate totals. The local invoice-number sequence is advanced after durable commit; it is not used as the authority for invoice existence.

The main process owns durability and rollback. The renderer still prepares business values from its authenticated state; comprehensive generic IPC authorization is reserved for Phase 3.

## 5. Compatibility and migration

No database schema or historical invoice format changes. Existing chunk manifests and rows remain compatible. A legacy single-blob ledger is converted with the first sale in the same transaction; a new shop establishes its first ledger chunks in that transaction. Existing chunked ledgers append by reading only the tail chunk, without hydrating the complete history into React.

Desktop builds without the new IPC method reject sale commit rather than fall back to non-atomic per-key writes. Web-mode storage remains a compatibility path and is not claimed to provide SQLite crash guarantees.

## 6. Tests and commands

- `npx vite build`: diagnostic production renderer for Electron tests. This is explicitly separate from the failing official TypeScript/build gate.
- `node scripts/hardening-critical-baseline.mjs graceful-immediate-sale abrupt-immediate-sale failure-injected-sale failure-after-stock-sale failure-after-cash-sale failure-after-ledger-sale`, using isolated copies of the audit fixture, network-blocking bootstrap and an isolated Electron user-data directory.
- Failure injection occurs after three invoice-row writes, after a product row, after a cash row and after a ledger row. Each rejected sale must leave its pre-sale durable fingerprints unchanged after close and restart.
- `npx vitest run tests/integration/flows/money-stock-defects.test.tsx tests/integration/flows/system-probe.test.tsx tests/unit/lib/storage-chunking.test.ts tests/unit/store/auto-parts-pro.test.ts tests/component/POSPage.test.tsx --maxWorkers=1 --reporter=dot`.
- ESLint on all changed TypeScript/CJS product and test files; `node --check` on main and preload.
- Application and test TypeScript checks retained with their baseline failures.

## 7. Results

| Check | Result |
| --- | --- |
| Normal POS sale, immediate graceful close, reopen and second close | PASS: invoices 4,991 → 4,992; cash 6,265 → 6,266; movements 19,752 → 19,753; product/branch totals 6,899 → 6,898 |
| POS success followed by immediate forced process-tree termination | PASS: the same complete changes survive restart |
| Failure after three invoice-row writes | PASS: all tracked pre-sale fingerprints unchanged after close/reopen |
| Failure after a product row | PASS: all tracked pre-sale fingerprints unchanged after close/reopen |
| Failure after a cash row | PASS: all tracked pre-sale fingerprints unchanged after close/reopen |
| Failure after a stock-ledger row | PASS: all tracked pre-sale fingerprints unchanged after close/reopen |
| Committed targeted unit/component/store suite | PASS: 71/71, five files |
| Changed-file ESLint and main/preload syntax | PASS: exit 0; six existing AppContext hook warnings remain |
| Diagnostic Vite renderer build | PASS: exit 0; this is not the official build gate |
| Application and test TypeScript | FAIL: documented baseline UI/contracts/test fixtures; no errors in the changed sale/transaction files |

Every successful-sale scenario preserves the five tracked post-sale canonical content and record-ID fingerprints through reopen and second close. Every rejected-sale scenario preserves the pre-sale fingerprints, including exact product and branch quantities. The final six-scenario command exits 0 and every result has `assertionsPassed=true`.

One concurrent targeted run passed 67/68 tests and timed out on the POS branch-badge test under heavy validation load. The unchanged test passed when rerun with one worker. After adding retained-action, explicit branch/delivery and corrupt-manifest coverage, the committed targeted suite passed 71/71 tests across five files. No timeout or assertion was weakened.

One desktop probe rolled back correctly after the product-stage injected failure, but its reopen timed out waiting for the login screen while the renderer was being rebuilt concurrently. This run is excluded from complete acceptance. The product-stage probe passed its complete close/reopen and canonical database comparison in the subsequent frozen-build rerun.

## 8. Independent database evidence

After each close/forced termination, the script verifies the Electron PID stopped before invoking the native SQLCipher reader under Electron's matching ABI. It compares collection counts, quantities, canonical content hashes and record-ID hashes after reopen. Successful sales must add exactly one invoice, receipt and movement and deduct one product/branch unit; rejected sales must add none.

Runtime artifacts are isolated and ignored under:

- `reports/production-hardening-2026-09/phase-1b/`: initial core sale/rollback probes.
- `reports/production-hardening-2026-09/phase-1b-final/`: staged failure probes, canonical native fingerprints, network isolation, IPC traces, diagnostic build, TypeScript and test logs.
- `reports/production-hardening-2026-09/phase-1b-verification/`: final six-scenario rerun on a completed, unchanged renderer build.

## 9. Remaining risks

- A02 startup branch redistribution is still pending Phase 1C.
- Generic non-sale persistence still has its historical row-error and deferred-write behavior; this phase replaces the completed-sale path only.
- This phase tests process interruption and rollback, not physical power loss or filesystem corruption.
- Invoice/cash histories remain renderer-owned arrays; large-history sale preparation/serialization performance is pending Phase 6.
- Renderer-derived business values and simultaneous unrelated mutations require the authorization/reliability work in subsequent phases.
- Official build/type/lint/test and package-contract baseline failures still prevent release-candidate approval.

## 10. Commit and acceptance

Implementation SHA: `f3872ee7afa2daa19a49e4a340a599d759b02eb8`.

Phase acceptance: PASS for A12's tested sale/rollback/process-interruption scenarios. Release-candidate acceptance: FAIL; subsequent authorized phases remain. Proceed to Phase 1C (A02).
