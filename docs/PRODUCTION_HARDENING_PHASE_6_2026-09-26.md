# Production hardening — Phase 6

**Date:** 2026-09-26
**Result:** PASS
**Scope:** measured large-dataset performance work, focused on `/dues`.

## Finding

The dues page rebuilt party summaries with repeated full-history scans. For every customer it filtered all open sales invoices and all sales invoices again, then sorted that customer's dates. It repeated the same pattern for every supplier. Search and branch filtering also scanned all due rows once per party.

With `C` parties and `N` invoices, the dominant page work was proportional to `C × N`. The generated Large profile contains 40,000 customers and 89,748 sales invoices, so the renderer could remain busy after the measurement timeout had already elapsed.

## Change

- Added reusable single-pass `groupByKey` and `latestValueByKey` helpers.
- Built customer and supplier due-row indexes once per invoice-list change.
- Built latest customer and supplier activity maps once per invoice-list change.
- Reused those indexes for party summaries, free-text lookup, and branch filtering.
- Kept the existing visible-row limit and sort behavior.
- Added an opt-in route filter to the performance audit so one route can be measured without running unrelated operations afterward.
- Added explicit login and route timing output to separate startup hydration from route-render cost.

The dominant aggregation is now proportional to the number of invoices plus the number of parties. No database format or customer-data migration was required.

## Representative datasets

All profiles were deterministically generated, encrypted with the shipped storage layer, and copied to an isolated temporary database for each Electron run.

| Profile | Products | Customers | Sales invoices | Purchase invoices | Encrypted DB |
|---|---:|---:|---:|---:|---:|
| Small | 1,000 | 2,000 | 4,986 | 1,087 | 16.4 MB |
| Medium | 4,000 | 15,000 | 29,895 | 4,347 | 89.9 MB |
| Large | 12,000 | 40,000 | 89,748 | 12,286 | 265.1 MB |

## Before and after

The pre-fix audit measured Small at 573 ms. Medium and Large both reached the 60-second route timeout and were recorded as errors. A dedicated Large reproduction remained inside the renderer task for more than eight minutes and had to be stopped; Playwright's timeout could report the failure, but could not interrupt the synchronous renderer work.

After the change, the production bundle was rebuilt before each Electron measurement:

| Profile | Before `/dues` | After `/dues` | Result |
|---|---:|---:|---|
| Small | 573 ms | 156 ms | PASS |
| Medium | >60,000 ms, timeout | 246 ms | PASS |
| Large | >60,000 ms, timeout; dedicated run >8 min | 411 ms | PASS |

The measured route time rises gradually across the three datasets and Small also improved. Large login/hydration was measured separately at 34,327 ms; it is not included in the 411 ms route result.

No claim is made for 180,000 invoices because that profile was not run.

## Regression evidence

- `tests/unit/lib/grouping.test.ts` verifies grouping output, latest-date parity with a filter-and-sort reference, source order, excluded records, and exactly one selector pass per source record.
- `tests/e2e/flows/performance-audit.spec.ts` measures the production Electron bundle against an isolated encrypted database and records route outcome, body output, renderer errors, console errors, heap, and process metrics.
- Existing dues settlement component tests continued to pass, covering customer and supplier rows and the irreversible settlement confirmation flow.

## Verification

| Command | Result |
|---|---|
| `npm run build` | PASS; production bundle built, existing chunk-size warning only |
| `npm run typecheck:tests` | PASS |
| `npm run lint` | PASS; 0 errors, 21 existing warnings |
| `npm test` | PASS; 92 files, 1,240 tests |
| Small route-only Electron audit | PASS; login 2,682 ms, `/dues` 156 ms |
| Medium route-only Electron audit | PASS; login 8,763 ms, `/dues` 246 ms |
| Large route-only Electron audit | PASS; login 34,327 ms, `/dues` 411 ms |

One earlier full-test attempt ran concurrently with ESLint and TypeScript and produced five unchanged five-second UI test timeouts under resource contention. All affected files passed immediately when rerun, and the complete suite then passed alone with the original timeouts and assertions.

## Remaining performance work

- Large-profile login/hydration is still material at about 34 seconds and should be treated as a separate measured startup problem.
- The production build still reports a roughly 3.15 MB main JavaScript chunk. Route-level code splitting should be assessed from startup profiles rather than by increasing the warning limit.
- The Phase 6 acceptance target is satisfied for the audited `/dues` bottleneck. Phase 7 reliability and recovery testing can proceed.
