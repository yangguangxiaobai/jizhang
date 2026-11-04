# C2 本月计划与工资分配统一 — Technical Design

Status: planning for review. Inherits [parent design](../10-29-core-finance-simplification/design.md), [requirements](prd.md) and [acceptance](../10-29-core-finance-simplification/acceptance.md).

## Ownership and dependencies

Requirement ownership: F03, F04, F05. Dependencies: C1. Existing files below are inspection/modification targets, not proof they were changed in planning. New files are proposed; C4's MonthlyPlanWorkspace.kt is produced by C2. Shared routing files are edited only after the preceding child has been reviewed.

| Kind | Exact path |
|---|---|
| Inspect/modify | clients/android/app/src/main/java/com/yansuu1/jizhang/ui/FinancialHostScreen.kt |
| Inspect/modify | clients/android/app/src/main/java/com/yansuu1/jizhang/ui/FinancialExecutionWorkspace.kt |
| Inspect/modify | clients/android/app/src/main/java/com/yansuu1/jizhang/ui/FinancialConfigSheet.kt |
| Inspect/modify | clients/android/app/src/main/java/com/yansuu1/jizhang/ui/FinancialCategoryMappingSheet.kt |
| Inspect/modify | clients/android/app/src/main/java/com/yansuu1/jizhang/ui/SalarySheet.kt |
| Inspect/modify | clients/android/app/src/main/java/com/yansuu1/jizhang/ui/SalaryFinancialPrompt.kt |
| Inspect/modify | clients/android/app/src/main/java/com/yansuu1/jizhang/ui/SalaryOperationReplay.kt |
| Inspect/modify | clients/android/app/src/main/java/com/yansuu1/jizhang/ui/MainShell.kt |
| Inspect/modify | packages/server/src/routes/financial-planning.ts |
| Inspect/modify | packages/server/src/services/financial-planning-service.ts |
| Inspect/modify | packages/server/src/services/financial-planning-refunds.ts |
| Inspect/modify | packages/shared/src/index.ts |
| Inspect/modify | packages/server/src/app.ts |
| Create | packages/shared/src/monthly-plan.ts |
| Create | packages/server/src/services/monthly-plan-service.ts |
| Create | clients/android/app/src/main/java/com/yansuu1/jizhang/repo/MonthlyPlanModels.kt |
| Create | clients/android/app/src/main/java/com/yansuu1/jizhang/repo/MonthlyPlanRepository.kt |
| Create | clients/android/app/src/main/java/com/yansuu1/jizhang/ui/MonthlyPlanWorkspace.kt |
| Behavior test/new or existing | packages/shared/test/monthly-plan.test.ts |
| Behavior test/new or existing | packages/server/test/monthly-plan.test.ts |
| Behavior test/new or existing | packages/server/test/financial-planning-existing-salary.test.ts |
| Behavior test/new or existing | packages/server/test/financial-planning-refunds.test.ts |
| Behavior test/new or existing | clients/android/app/src/test/java/com/yansuu1/jizhang/repo/MonthlyPlanModelsTest.kt |
| Behavior test/new or existing | clients/android/app/src/test/java/com/yansuu1/jizhang/ui/SalaryOperationReplayTest.kt |
| Behavior test/new or existing | clients/android/app/src/test/java/com/yansuu1/jizhang/ui/SalaryFinancialProposalTest.kt |
| Maintain | clients/android/README.md |

## Interfaces

Implement computeMonthlyPlanSummary(input: MonthlyPlanSummaryInput): MonthlyPlanSummary exactly as parent design §3. Expose GET /api/v1/monthly-plan through the existing authenticated registration. MonthlyPlanRepository.load(periodId: String? = null, month: String? = null): MonthlyPlanView strictly decodes its returned state/window/cents. Consume FinancialExecution/FinancialExecutionFactDto; produce the frozen window and reserve/growth reference values for C3/C4.

## Data flow and chosen behavior

Use the existing prepared execution facts, not paged client totals or independently queried gross bills. Current selection is a confirmed frozen window covering server now; no-period is distinct from error and from an unrelated historical period. Aggregation includes every counted fact; attributed refunds use the original category/purpose/cycle. Pending/source-invalid coverage returns null precision-dependent remaining. Default summary replaces parallel visible finance modes; old envelope/pool/scenario/history remain tools with separate labels. Salary save and plan confirm are two independently idempotent operations with one compact allocation confirmation, and skip leaves a saved wage without a new period. Default template is folded; missing templates are explicit repair states. Percentages come from the actual decision. No existing snapshots or legacy algorithms are rescaled.

## Compatibility and migration

Inherit the parent's exact cents/gross/net/goal/manual-source boundaries. Existing fields/endpoints retain their default behavior; any extension is additive and explicitly documented. Do not use old UI redesign or historic tests as current implementation proof. Unsupported API is an unavailable state, not successful zero values. Only C4 adds the goal-progress migration; its ordinal is checked against the current registry before creating code.

## Validation and rollback

The scoped fixtures are C2-01, C2-02, C2-03, C2-04, C2-05, C2-06, C2-07, C2-08, C2-09. Use meaningful behavior tests for new calculations/lifecycles; reversible copy/menu/folding changes use existing tests and device QA, not implementation-mirroring source assertions. Verify before a scoped commit. Roll back user-flow changes independently where possible; do not remove accepted historical facts or restore a database with running writers. Full operational checkpoints are in the parent implement.md.
