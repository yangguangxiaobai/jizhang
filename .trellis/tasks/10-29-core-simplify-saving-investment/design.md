# C4 手动存钱与投资进度简版 — Technical Design

Status: approved implementation in progress (2026-10-30). Inherits [parent design](../10-29-core-finance-simplification/design.md), [requirements](prd.md) and [acceptance](../10-29-core-finance-simplification/acceptance.md).

## Ownership and dependencies

Requirement ownership: F08, F09. Dependencies: C2、C3. Existing files below are inspection/modification targets, not proof they were changed in planning. New files are proposed; C4's MonthlyPlanWorkspace.kt is produced by C2. Shared routing files are edited only after the preceding child has been reviewed.

| Kind | Exact path |
|---|---|
| Inspect/modify | packages/server/src/app.ts |
| Inspect/modify | packages/server/src/db/migrate.ts |
| Inspect/modify | packages/server/src/services/financial-operation-store.ts |
| Inspect/modify | clients/android/app/src/main/java/com/yansuu1/jizhang/ui/MonthlyPlanWorkspace.kt |
| Inspect/modify | clients/android/app/src/main/java/com/yansuu1/jizhang/ui/FinancialConfigSheet.kt |
| Inspect/modify | packages/shared/src/index.ts |
| Create | packages/shared/src/manual-goal-progress.ts |
| Create | packages/server/src/services/financial-goals-service.ts |
| Create | packages/server/src/services/financial-goal-store.ts |
| Create | packages/server/src/routes/financial-goals.ts |
| Create | packages/server/src/db/migrations/020-manual-goal-progress.ts |
| Create | clients/android/app/src/main/java/com/yansuu1/jizhang/repo/FinancialGoalModels.kt |
| Create | clients/android/app/src/main/java/com/yansuu1/jizhang/repo/FinancialGoalRepository.kt |
| Create | clients/android/app/src/main/java/com/yansuu1/jizhang/ui/ManualGoalProgressWorkspace.kt |
| Behavior test/new or existing | packages/shared/test/manual-goal-progress.test.ts |
| Behavior test/new or existing | packages/server/test/financial-goals.test.ts |
| Behavior test/new or existing | packages/server/test/financial-goals-migration.test.ts |
| Behavior test/new or existing | clients/android/app/src/test/java/com/yansuu1/jizhang/repo/FinancialGoalModelsTest.kt |
| Behavior test/new or existing | clients/android/app/src/test/java/com/yansuu1/jizhang/ui/ManualGoalProgressStateTest.kt |
| Maintain | clients/android/README.md |

## Interfaces

Implement computeManualGoalProgress(input: ManualGoalProgressInput): ManualGoalProgress in shared. Input includes explicit opening reserve/principal/date, unique active/deleted entries (id,goal,kind,amountCents,date), from/to, inclusive asOf, necessary baseline, targetMonths and planned reserve reference. Output includes reserveBalanceCents, investmentPrincipalCents, periodReserveNetCents, periodInvestmentNetCents, targetCents/gapCents/surplusCents/progressRatio/contributionCount nullable where unsupported. API/operation guards and entry shape are specified in parent design §5; FinancialGoalRepository consumes source='manual-confirmed'.

## Data flow and chosen behavior

Opening values are explicit, never imported from old reserve/forecast. Entries are progress facts, with no ledger/salary/account/transfer writes. Calculate after chronological validation using safe integer cents and unique IDs; an active withdrawal cannot make the relevant balance negative at any prefix. Soft-deleted entries do not contribute. Server filters asOf=min(now,to−1) for a selected historical window; periods before opening are not-started, not fabricated zero. Current-period additions exclude opening values and may be negative. Target uses existing confirmed baseline/month count; no baseline means null target/gap/ETA; valid zero target is reached, distinct from missing. ETA needs a positive future reserve reference and clear no-return assumption. Investment tracks principal only; growth is a reference covering skills/investment, so do not advertise an investment completion ratio against the whole growth bucket. Goal settings/entries and operation replay use one guarded state revision, exact identical replay before current CAS, atomic history rejection and complete SQLite backup inclusion. Recheck the actual next migration ordinal before implementation.

## Compatibility and migration

Inherit the parent's exact cents/gross/net/goal/manual-source boundaries. Existing fields/endpoints retain their default behavior; any extension is additive and explicitly documented. Do not use old UI redesign or historic tests as current implementation proof. Unsupported API is an unavailable state, not successful zero values. Only C4 adds the goal-progress migration; its ordinal is checked against the current registry before creating code.

## Validation and rollback

The scoped fixtures are C4-01, C4-02, C4-03, C4-04, C4-05, C4-06, C4-07, C4-08. Use meaningful behavior tests for new calculations/lifecycles; reversible copy/menu/folding changes use existing tests and device QA, not implementation-mirroring source assertions. Verify before a scoped commit. Roll back user-flow changes independently where possible; do not remove accepted historical facts or restore a database with running writers. Full operational checkpoints are in the parent implement.md.
