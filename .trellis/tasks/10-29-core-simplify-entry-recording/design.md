# C1 核心导航与快捷记账精简 — Technical Design

Status: planning for review. Inherits [parent design](../10-29-core-finance-simplification/design.md), [requirements](prd.md) and [acceptance](../10-29-core-finance-simplification/acceptance.md).

## Ownership and dependencies

Requirement ownership: F01, F02, F11. Dependencies: 无前置子任务. Existing files below are inspection/modification targets, not proof they were changed in planning. New files are proposed; C4's MonthlyPlanWorkspace.kt is produced by C2. Shared routing files are edited only after the preceding child has been reviewed.

| Kind | Exact path |
|---|---|
| Inspect/modify | clients/android/app/src/main/java/com/yansuu1/jizhang/ui/MainShell.kt |
| Inspect/modify | clients/android/app/src/main/java/com/yansuu1/jizhang/ui/MyTab.kt |
| Inspect/modify | clients/android/app/src/main/java/com/yansuu1/jizhang/ui/DashboardTab.kt |
| Inspect/modify | clients/android/app/src/main/java/com/yansuu1/jizhang/ui/TransactionEditSheet.kt |
| Inspect/modify | clients/android/app/src/main/java/com/yansuu1/jizhang/ui/TransactionEditorHelper.kt |
| Inspect/modify | clients/android/app/src/main/java/com/yansuu1/jizhang/ui/TransactionEditorStateHelper.kt |
| Create | clients/android/app/src/main/java/com/yansuu1/jizhang/ui/RecordingDefaults.kt |
| Behavior test/new or existing | clients/android/app/src/test/java/com/yansuu1/jizhang/ui/RecordingDefaultsTest.kt |
| Behavior test/new or existing | clients/android/app/src/test/java/com/yansuu1/jizhang/ui/TransactionEditorStateHelperTest.kt |
| Behavior test/new or existing | clients/android/app/src/test/java/com/yansuu1/jizhang/ui/TransactionRefundSeedHelperTest.kt |
| Maintain | clients/android/README.md |

## Interfaces

Implement resolveRecordingAccount(lastAccountId: String?, activeAccountIds: List<String>, refundAccountId: String?): RecordingAccountResult in RecordingDefaults.kt as defined in parent design §2. MainShell remains the sole primary/secondary return owner. Expose an income-to-salary hook for C2; do not implement a second wage writer.

## Data flow and chosen behavior

Recording visibility reuses the existing draft and save owner. Remembered accounts are scoped by serverBaseUrl/username and validated against active accounts; a pinned original refund account cannot fall back. New ordinary recording with no active account blocks with a create/select action. Optional-section folding is UI state and cannot mutate notes/tags/purpose. Keep record-source route and retained base-list state when opening overlays. More tools retain item/cutout/icon/template access. UI changes have no data migration.

## Compatibility and migration

Inherit the parent's exact cents/gross/net/goal/manual-source boundaries. Existing fields/endpoints retain their default behavior; any extension is additive and explicitly documented. Do not use old UI redesign or historic tests as current implementation proof. Unsupported API is an unavailable state, not successful zero values. Only C4 adds the goal-progress migration; its ordinal is checked against the current registry before creating code.

## Validation and rollback

The scoped fixtures are C1-01, C1-02, C1-03, C1-04, C1-05, C1-06, C1-07, C1-08. Use meaningful behavior tests for new calculations/lifecycles; reversible copy/menu/folding changes use existing tests and device QA, not implementation-mirroring source assertions. Verify before a scoped commit. Roll back user-flow changes independently where possible; do not remove accepted historical facts or restore a database with running writers. Full operational checkpoints are in the parent implement.md.
