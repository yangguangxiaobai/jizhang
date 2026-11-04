# C3 implementation and verification status

## Implemented locally

- Service-owned month / rolling-720h windows; default month resolved from captured server now and IANA zone.
- Exact account/category statistics predicates and echoed nullable IDs; authoritative unpaged expenseCount.
- Gross expense / salary-and-refund income labels; default 6-month series with real server months and historical endMonth.
- Same-range category drilldown, complete 500-row paging with 100000 cap, server totals instead of Android money sums; read-only bill details over retained statistics. Added server-side read transaction guard (`expectedExpenseCents`/`expectedExpenseCount`) to detect and reject intermediate data mutations during paging.
- More controls folded; pool series retained in advanced envelope tool; deterministic non-AI top category and separately captioned plan warnings.

## Current automated evidence

- Focused `pnpm --filter @jizhang/server test -- test/stats.test.ts --maxWorkers=2`: exit 0, 51/51 (`pwsh-1a6523376ea94817`, output collected).
- Server test `test/transactions.test.ts test/stats.test.ts`: exit 0, 141/141 passed including new drilldown expected expense guards.
- Shared tests 12 files / 385 tests, build and lint passed.
- Server final lint/typecheck/full test/build passed: 46 files / 1020 tests, exit 0. No production server or data was touched.
- Android C3 gate: `:app:testDebugUnitTest :app:lintDebug` BUILD SUCCESSFUL; 49 suites / 505 tests / 0 failures/errors/skips.

## Review

Drilldown independently implemented/reviewed in a bounded worker scope; production query/loader tests include 1203-row fixture, filters, safe wire integers, incomplete pages, scope changes and delayed success/error/finally. Tests were executed by Lead only.

Independent read-only cross-layer review findings:
1. Advanced pool relocation made per-period textual details inaccessible: resolved by adding dedicated chart/detail toggle in `BudgetTab.kt`.
2. No refresh on a successful source statistic after returning from a changed drilldown: resolved by adding explicit guarded header refresh in `StatsTab.kt`.
3. Intermediate data race between summary and paging: resolved by adding `expectedExpenseCents`/`expectedExpenseCount` validation inside `list` query transaction.

## Pending

Device range/rapid switch/scroll/detail-back/IME/small-screen/TalkBack checks remain pending. No install/deploy/production data mutation/commit is claimed. Parent acceptance remains pending where it requires device evidence.
