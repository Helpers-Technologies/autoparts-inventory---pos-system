# Production hardening — Phase 7

**Date:** 2026-09-26
**Result:** PASS
**Scope:** shutdown durability, recovery, backup integrity, branch restart behavior, mobile idempotency, and a one-hour soak with independent database verification.

## Shutdown and transaction recovery

`scripts/hardening-critical-baseline.mjs` ran each scenario on a fresh copy of the encrypted Small audit fixture. Every result was inspected directly from SQLite after the Electron process had stopped, then checked again after reopening and closing the application.

| Scenario | Result | Evidence |
|---|---|---|
| Login, then graceful close without business writes | PASS | stock movement count and fingerprint unchanged |
| Sale, then immediate graceful close | PASS | exactly one invoice, cash entry, movement, and stock decrement persisted |
| Sale, then immediate forced process-tree termination | PASS | the complete transaction persisted; no partial state |
| Forced termination after the durable success state | PASS | the complete transaction persisted and matched after restart |
| Failure after three transaction writes | PASS | transaction rejected; all tracked collections rolled back |
| Failure after product write | PASS | transaction rejected; all tracked collections rolled back |
| Failure after cash-entry write | PASS | transaction rejected; all tracked collections rolled back |
| Failure after stock-movement write | PASS | transaction rejected; all tracked collections rolled back |
| Two-branch login and restart | PASS | branch stock fingerprint and quantities unchanged |

The tracked sale collections were `salesInvoices`, `cashEntries`, `products`, `stockMovements`, and `branchStocks`. The failure-injection cases compared all five to the pre-sale snapshot and found no half-committed transaction.

## Multi-branch restart workflows

Each workflow used the explicit two-branch fixture, closed Electron, inspected SQLite, reopened the application, closed it again, and repeated the independent inspection.

| Workflow | Expected final branch quantities | Result |
|---|---:|---|
| Sale from secondary branch | main 3, secondary 6 | PASS |
| Transfer two units to secondary branch | main 1, secondary 9 | PASS |
| Stocktake main branch to six | main 6, secondary 7 | PASS |
| Transfer, then sale from secondary | main 1, secondary 8 | PASS |

Products, branch stocks, invoices, cash entries, movements, transfers, and stocktakes matched exactly across restart. Both native reads returned `integrity_check=ok`.

## Mobile duplicate delivery and rollback

The add, remove, and stocktake/count operations were each delivered repeatedly with the same `clientOperationId`. The simulated remote endpoint rejected two acknowledgement attempts, accepted the third, and delivered the operation again after application restart.

For every operation kind:

- the inventory effect occurred once;
- one stock movement, one durable receipt, and one mobile audit record existed;
- every acknowledgement returned the stored result;
- the post-restart collections matched the pre-restart durable state;
- SQLite integrity passed.

Failure injection after mobile transaction stages 1 and 7 also passed. No product, branch-stock, movement, invoice, or cash collection changed before the retry, and the retry produced one complete effect.

## Backup, export, and restore

The Large generated shop was used for the full archive pipeline:

- plaintext shop state: 261.7 MiB;
- compressed AES-256-GCM envelope: 40.5 MiB;
- encryption: 9,811 ms;
- decryption and byte-for-byte verification: 5,941 ms;
- envelope remained inside the shared 48 MiB desktop/portal limit;
- restored plaintext was byte-identical.

The targeted backup and restore suite passed 87 tests across backup cryptography, cloud archive scope, export redaction, protected-key handling, and application import durability. It explicitly covered wrong passphrases, malformed envelopes, unsupported versions/algorithms, altered ciphertext, altered authentication tags, corrupted gzip payloads, legacy restore compatibility, invalid JSON import, and durable persistence before `importBackup` resolves.

## One-hour soak

The reusable runner is `scripts/hardening-soak.mjs`. It uses an isolated encrypted database, keeps one Electron session open, performs one product search and one durable POS sale per minute, records process memory every minute, and writes progress after every sample. It then:

1. waits for at least 3,600,000 ms of real elapsed uptime;
2. captures the settled renderer state;
3. closes Electron normally;
4. reads SQLite independently and checks integrity;
5. restarts and signs in;
6. closes Electron again;
7. reads SQLite independently a second time;
8. compares semantic hashes and quantities for the five required collections.

| Measure | Result |
|---|---:|
| Actual elapsed duration | 3,600,018 ms |
| Completed samples | 60 / 60 |
| Renderer errors | 0 |
| Console errors | 0 |
| Sales invoices | 4,991 → 5,051 (+60) |
| Cash entries | 6,265 → 6,325 (+60) |
| Stock movements | 19,752 → 19,812 (+60) |
| Product quantity | 6,899 → 6,839 (-60) |
| Branch-stock quantity | 6,899 → 6,839 (-60) |
| Sale latency median / P95 / max | 2,026 / 3,958 / 4,498 ms |
| Search latency median / P95 / max | 46 / 82 / 101 ms |
| Durable-observation median / P95 / max | 156 / 1,366 / 2,097 ms |
| Renderer working set, first / last / max | 337 / 222 / 337 MiB |
| SQLite integrity after restart | `ok` |

The renderer working set did not grow across the hour. A temporary sale-latency rise around samples 42–52 later returned to about two seconds; it produced no errors or missing/duplicate records.

The first full-duration attempt stopped after three samples because the harness selected a virtualised product tile while the filtered grid was still republishing. The product had not entered the cart, so the completion button remained disabled. The runner was corrected to wait for the cleared grid to settle, passed a five-cycle restart smoke test, and the successful hour began again from a fresh database. No elapsed time from the discarded attempt was counted.

## Commands and evidence

```text
PARTFLOW_HARDENING_PHASE=phase-7 node scripts/hardening-critical-baseline.mjs
PARTFLOW_HARDENING_PHASE=phase-7 node scripts/hardening-branch-workflows.mjs
PARTFLOW_HARDENING_PHASE=phase-7 node scripts/hardening-mobile-workflows.mjs
PARTFLOW_HARDENING_PHASE=phase-7 node scripts/hardening-mobile-rollback.mjs
ELECTRON_RUN_AS_NODE=1 npx electron scripts/load-test-pipelines.cjs <large.json>
npx vitest run tests/unit/electron/backup-crypto.test.ts tests/unit/electron/cloud-archive-scope.test.ts tests/integration/ipc/backup-security.test.ts tests/integration/flows/system-probe.test.tsx
PARTFLOW_HARDENING_PHASE=phase-7 node scripts/hardening-soak.mjs
```

Machine-readable results are under `reports/production-hardening-2026-09/phase-7/`, including `critical-reproduction.json`, `branch-workflows.json`, `mobile-workflows.json`, `mobile-rollback.json`, and `soak.json` plus the isolated native snapshots.

## Gate decision

Phase 7 passes. The tested interruption points did not produce inconsistent invoice, cash, product, movement, or branch-stock state. Backup corruption and wrong credentials were rejected, mobile duplicates remained idempotent across restart, and the one-hour workload matched independent post-close and post-restart database reads.

Phase 8 release-candidate verification can proceed. No production deployment is authorized by this result.
