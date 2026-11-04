# C3 费用统计与月末复盘精简 — Technical Design

Status: approved implementation in progress (2026-10-30). Inherits [parent design](../10-29-core-finance-simplification/design.md), [requirements](prd.md) and [acceptance](../10-29-core-finance-simplification/acceptance.md).

## Ownership and dependencies

Requirement ownership: F06, F07. Dependencies: C1、C2. Existing files below are inspection/modification targets, not proof they were changed in planning. New files are proposed; C4's MonthlyPlanWorkspace.kt is produced by C2. Shared routing files are edited only after the preceding child has been reviewed.

| Kind | Exact path |
|---|---|
| Inspect/modify | clients/android/app/src/main/java/com/yansuu1/jizhang/ui/StatsTab.kt |
| Inspect/modify | clients/android/app/src/main/java/com/yansuu1/jizhang/ui/Charts.kt |
| Inspect/modify | clients/android/app/src/main/java/com/yansuu1/jizhang/ui/TransactionDetailScreen.kt |
| Inspect/modify | clients/android/app/src/main/java/com/yansuu1/jizhang/ui/TransactionMonthLoader.kt |
| Inspect/modify | clients/android/app/src/main/java/com/yansuu1/jizhang/repo/BudgetRepository.kt |
| Inspect/modify | clients/android/app/src/main/java/com/yansuu1/jizhang/repo/LedgerRepository.kt |
| Inspect/modify | packages/server/src/routes/stats.ts |
| Inspect/modify | packages/server/src/services/stats-service.ts |
| Inspect/modify | packages/shared/src/date-utils.ts |
| Inspect/modify | packages/shared/src/index.ts |
| Create | packages/shared/src/stats-window.ts |
| Create | clients/android/app/src/main/java/com/yansuu1/jizhang/ui/TransactionDrilldownScreen.kt |
| Create | clients/android/app/src/main/java/com/yansuu1/jizhang/ui/TransactionDrilldownQuery.kt |
| Behavior test/new or existing | packages/shared/test/stats-window.test.ts |
| Behavior test/new or existing | packages/server/test/stats.test.ts |
| Behavior test/new or existing | clients/android/app/src/test/java/com/yansuu1/jizhang/ui/TransactionDrilldownQueryTest.kt |
| Behavior test/new or existing | clients/android/app/src/test/java/com/yansuu1/jizhang/ui/TransactionMonthLoaderTest.kt |
| Behavior test/new or existing | clients/android/app/src/test/java/com/yansuu1/jizhang/ui/TransactionMonthIntegrationTest.kt |
| Maintain | clients/android/README.md |

## Interfaces

StatsRepository is defined in repo/BudgetRepository.kt:124. Change its statistics methods there; the neighboring BudgetRepository methods keep their existing contract.

Implement resolveStatsWindow(kind: 'month'|'last30', month: string|null, now: number, timeZone: string): StatsWindow with fields kind/from/to/timeZone/label/calculatedAt. Add GET /api/v1/stats/window and optional monthly-trend endMonth. TransactionDrilldownQuery carries the exact from/to/categoryId/accountId?/type=expense/rangeLabel returned/used by the statistic. C4 later adds its manual-goal sections to the deterministic review.

## Data flow and chosen behavior

Capture server now once and resolve calendar windows in its IANA timezone; last30 is720 rolling hours. Preserve existing stats endpoints/fields and add only optional filters/anchor and refund subtotal. UI calls gross amount Expense and identifies wage/refund income. Default category window is the selected month; trend default6 has a caption describing its own distinct interval. Reuse existing bounded complete-list loading and detail cards in a secondary drilldown; do not pretend the primary bill page's month-only filter supports arbitrary ranges. Category/account predicates and from/to match on both sides. Empty scope and failed scope remain distinct. Pool moves to advanced budget details. C3 review uses supported expense data only; manual completion numbers wait for C4.

## Compatibility and migration

Inherit the parent's exact cents/gross/net/goal/manual-source boundaries. Existing fields/endpoints retain their default behavior; any extension is additive and explicitly documented. Do not use old UI redesign or historic tests as current implementation proof. Unsupported API is an unavailable state, not successful zero values. Only C4 adds the goal-progress migration; its ordinal is checked against the current registry before creating code.

## Validation and rollback

The scoped fixtures are C3-01, C3-02, C3-03, C3-04, C3-05, C3-06, C3-07. Use meaningful behavior tests for new calculations/lifecycles; reversible copy/menu/folding changes use existing tests and device QA, not implementation-mirroring source assertions. Verify before a scoped commit. Roll back user-flow changes independently where possible; do not remove accepted historical facts or restore a database with running writers. Full operational checkpoints are in the parent implement.md.
