# PartFlow Performance & Scale Hardening

## Phase 10 — Deterministic Scale Fixtures

Date: 2026-09-27  
Generator version: `phase10-v5`  
Fixed seed: `2654435769`  
Fixed history end: `2026-08-01T00:00:00.000Z`

This phase creates and validates scale data only. It does **not** certify the packaged application at 200K or 250K invoices, and it does not make a commercial capacity claim.

## 1. Objective

Create a deterministic, realistic fixture ladder at approximately 90K, 120K, 150K, 180K, 200K, and 250K sales invoices; generate at least the 200K fixture; preserve business invariants; create isolated encrypted databases; and produce hashes, manifests, resource measurements, and regeneration commands without changing application runtime behavior.

## 2. Baseline

- Repository: `D:\Helpers_Tech\win-app\Autoparts-inventory-system\autoparts-inventory-system`
- Branch: `repair/production-hardening-2026-09`
- Starting HEAD: `0415cab46f7494c89f3cf73dde064feb0aedf6bd`
- Node: `v24.19.0`
- Electron: `39.8.10`
- `better-sqlite3-multiple-ciphers`: `12.11.1`
- `argon2`: `0.44.0`
- Initial D: free space: 48,093,065,216 bytes
- Existing worktree was dirty before this phase. All unrelated files and Phase 9 instrumentation were preserved.
- Fixture root: `scale-fixtures/phase-10/`
- Manifest root: `reports/performance-scale-2026-09/phase-10-manifests/`
- No production/customer database path was opened, copied, or modified.

## 3. Investigation performed

The existing chronological fixture generator, invariant verifier, and encrypted profile seeder were audited before changes. The audit measured the existing line mix, purchase ratio, cash-entry production, stock-movement production, deterministic inputs, serialization method, and seeding timestamps/password hashing.

Two concrete tooling limits were reproduced:

1. The original sales mix projected the 200K rung below the requested 250K cash-entry and 1M stock-movement floors.
2. A monolithic 150K JSON fixture reached Node's hard maximum string length and failed validation with `ERR_STRING_TOO_LONG` before any application test occurred.

A first 200K generation also demonstrated why a named minimum must be explicit: probabilistic out-of-stock skips produced 199,544 sales. The final v5 configuration records both a named minimum and a transparent 0.5% generation headroom, then validates the actual count against the named minimum.

## 4. Root cause / findings

- Monolithic `JSON.stringify(dataset)` was the dominant fixture-tool scalability limit, not SQLite.
- Randomly probing only a few products could abandon a sale even when stock existed elsewhere in a broad catalogue.
- The prior sales line distribution was materially lighter than the requested 20% / 40% / 30% / 10% profile.
- The prior seeder used wall-clock timestamps and a random Argon2 salt, preventing deterministic logical seeding.
- The final 200K fixture meets all requested principal floors: 200,956 sales, 32,257 purchases, 80,000 customers, 25,000 products, 5,000 suppliers, 255,792 cash entries, and 1,035,876 stock movements.

## 5. Files changed

- `.gitignore`
- `scripts/generate-load-test-dataset.cjs`
- `scripts/verify-load-test-dataset.cjs`
- `scripts/seed-stress-profile.cjs`
- `scripts/fixture-bundle.cjs` (new)
- `scripts/scale-fixture-config.cjs` (new)
- `scripts/validate-scale-fixture.cjs` (new)
- `scripts/run-scale-fixture-ladder.cjs` (new)
- `reports/performance-scale-2026-09/phase-10-fixtures.md` (new)
- `reports/performance-scale-2026-09/phase-10-manifests/*.manifest.json` (new)
- `reports/performance-scale-2026-09/phase-10-manifests/phase-10-summary.json` (new)

Generated fixture bundles and encrypted profiles are ignored under `scale-fixtures/` and are not committed.

## 6. Architecture changes

These changes affect fixture tooling only; no renderer, Electron main-process runtime, AppContext, query, index, or packaged workflow was changed.

- Large logical datasets are written as deterministic 25,000-record collection chunks rather than one JSON string.
- `index.json` records every chunk's byte size and SHA-256.
- The bundle's aggregate SHA-256 is derived deterministically from ordered collection/chunk hashes.
- Every bundle load verifies each chunk checksum before parsing it.
- The existing full business-invariant verifier now accepts a legacy JSON file or a chunked bundle.
- The encrypted seeder uses fixed fixture timestamps and a deterministic Argon2 salt for equivalent logical input.
- SQLite and SQLCipher integrity checks run before a database manifest is accepted.
- Each named rung records a minimum invoice count and a 0.5% generation target; validation rejects an output below the named minimum.

## 7. Tests added or updated

- Added scale-specific validation for counts, six-year time span, branches, returns, dues, users/permissions, nonnegative stock, line distribution, cash-entry floor, and stock-movement floor.
- Added three unit regressions for deterministic bundle hashes/reload, tamper detection, and legacy single-file compatibility.
- Updated the existing verifier loader to support checksummed bundles.
- Removed a large-array spread from the existing verifier so 200K+ date spans can be calculated safely.
- Smoke pipeline: generation, full business invariant verification, scale validation, encrypted seeding, SQLite integrity, and SQLCipher integrity all passed.
- Critical regression suite: **328/328 passed in 19 files**.
- Phase 10 bundle regressions plus the critical suite: **331/331 passed in 20 files**.
- Licensing tests (included in the critical run): **32/32 passed**.
- Test TypeScript check: passed.
- Production build: passed.

## 8. Commands executed

Principal commands included:

```text
node scripts/run-scale-fixture-ladder.cjs --through scale-200k
node scripts/run-scale-fixture-ladder.cjs --only scale-250k
node scripts/run-scale-fixture-ladder.cjs --summary-only
node scripts/verify-load-test-dataset.cjs <fixture-bundle>
node scripts/validate-scale-fixture.cjs <fixture-bundle> --summary-out <file>
ELECTRON_RUN_AS_NODE=1 npx electron scripts/seed-stress-profile.cjs <fixture-bundle> <isolated-profile> --summary-out <file>
npx vitest run <19 critical test files> --maxWorkers=1 --reporter=default
npm run typecheck:tests
npm run build
```

The 200K deterministic replay used the same v5 inputs and a separate ignored output directory.

## 9. Benchmark results

Times are single-run engineering measurements on the same workstation. `DB total` includes bundle loading, hashing the test owner password, encrypted writes, checkpoint, integrity checks, and database SHA-256.

| Fixture | Named minimum | Actual sales | Purchases | Customers | Products | Suppliers | Cash entries | Stock movements | Bundle MiB | DB MiB | Generate | Gen peak RSS | DB total | DB peak RSS |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| scale-090k | 90,000 | 90,411 | 15,223 | 40,000 | 12,000 | 2,250 | 116,442 | 466,415 | 325.4 | 329.5 | 15.0 s | 905.5 MiB | 35.9 s | 1,143.9 MiB |
| scale-120k | 120,000 | 120,548 | 19,928 | 50,000 | 15,000 | 3,000 | 154,508 | 622,794 | 431.9 | 437.3 | 19.7 s | 1,141.5 MiB | 44.9 s | 1,529.3 MiB |
| scale-150k | 150,000 | 150,717 | 24,591 | 60,000 | 19,000 | 3,750 | 191,842 | 774,667 | 537.0 | 543.7 | 25.3 s | 1,246.6 MiB | 76.2 s | 1,497.8 MiB |
| scale-180k | 180,000 | 180,861 | 29,223 | 72,000 | 22,500 | 4,500 | 230,518 | 929,520 | 644.6 | 652.6 | 51.1 s | 1,058.4 MiB | 87.2 s | 1,558.3 MiB |
| scale-200k | 200,000 | 200,956 | 32,257 | 80,000 | 25,000 | 5,000 | 255,792 | 1,035,876 | 717.2 | 726.2 | 36.4 s | 1,369.8 MiB | 98.8 s | 1,939.7 MiB |
| scale-250k | 250,000 | 251,195 | 39,900 | 100,000 | 31,250 | 6,250 | 318,809 | 1,290,342 | 894.3 | 905.5 | 43.4 s | 1,822.8 MiB | 144.9 s | 1,914.8 MiB |

The non-monotonic timings/peak RSS are retained as observed; these are not smoothed estimates.

## 10. Before / after metrics

| Item | Before | After |
|---|---|---|
| 150K source validation | Failed at monolithic JSON read with `ERR_STRING_TOO_LONG` | Full invariant and scale validation passed from chunked bundle |
| 90K generator peak RSS | 1,604.9 MiB monolithic | 905.5 MiB chunked v5 |
| 200K named floor | Initial evidence was 199,544 (rejected as insufficient) | 200,956 (passes literal floor) |
| 200K cash-entry floor | Projected/initially marginal | 255,792, passed |
| 200K stock-movement floor | Projected/initially marginal | 1,035,876, passed |
| Deterministic 200K replay | Not demonstrated | SHA, byte count, and all collection counts matched exactly |

Final 200K source replay:

- SHA-256: `5805e9262dc38cb591620b1545d6da66345fdcc0025e04f9f7b4b7d104e3489a`
- Bytes: `752090688`
- Original/replay SHA match: true
- Original/replay bytes match: true
- Original/replay collection counts match: true

## 11. Database / integrity verification

Every rung passed:

- source chunk SHA verification
- full referential/business invariant verification
- nonnegative final stock
- ledger-to-product stock reconciliation
- chronological replay without selling stock before it exists
- invoice/return/payment arithmetic
- branch-stock consistency checks
- SQLite `integrity_check = ok`
- SQLCipher `cipher_integrity_check = ok`

Full source and encrypted-database SHA-256 values are in each per-fixture manifest and in `phase-10-summary.json`.

## 12. Remaining bottlenecks

- Generation and validation still hold the logical object graph in memory. This is acceptable through 250K on this machine, but a streaming generator/validator would reduce future 500K memory risk.
- The encrypted seeder constructs serialized storage chunks before the transaction, so its peak RSS is approximately 1.9 GiB at 200K–250K.
- Encrypted database creation is the longest fixture step at larger rungs (144.9 seconds total at 250K).
- The environment blocked deletion of stale generated monolithic/replay artifacts created during investigation. They remain under the ignored `scale-fixtures/` tree and are not customer data or commit content.
- No packaged application startup, login, hydration, or daily workflow was tested in this phase.

### 500K planning estimate (not generated, not certified)

Linear extrapolation from 250K suggests approximately:

- 502K generated sales, ~80K purchases, ~200K customers, ~62.5K products
- ~638K cash entries and ~2.58M stock movements
- ~1.75 GiB source bundle and ~1.77 GiB encrypted database
- ~90–120 seconds generation and ~5–6 minutes database preparation on this workstation
- conservative peak RSS allowance: 3–4 GiB
- recommended free working disk allowance: at least 6 GiB for source, encrypted DB, summaries, and a replay copy

These are planning estimates only. No 500K fixture or real application run occurred.

## 13. Git commits

One focused Phase 10 commit contains the fixture tooling, regressions, manifests, summary, and this report. It excludes all unrelated pre-existing worktree changes and generated fixture/database binaries. The final commit ID is recorded in the phase handoff response because a commit cannot embed its own final ID.

## 14. Recommendation

Accept Phase 10 for supervisor review. The deterministic ladder is reproducible, the literal 200K and optional 250K fixture floors are met, and correctness/integrity checks are green. Phase 11 may use these fixtures only after explicit supervisor approval. The current evidence must not be described as packaged-application certification or supported commercial capacity at 200K/250K.

PASS — ready for supervisor review
