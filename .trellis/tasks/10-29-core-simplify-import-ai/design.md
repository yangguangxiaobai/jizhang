# C5 统一账单导入与按需 AI — Technical Design

Status: approved implementation in progress (2026-10-30). Inherits [parent design](../10-29-core-finance-simplification/design.md), [requirements](prd.md) and [acceptance](../10-29-core-finance-simplification/acceptance.md).

## Ownership and dependencies

Requirement ownership: F10, F11. Dependencies: C1、C4. Existing files below are inspection/modification targets, not proof they were changed in planning. New files are proposed; C4's MonthlyPlanWorkspace.kt is produced by C2. Shared routing files are edited only after the preceding child has been reviewed.

| Kind | Exact path |
|---|---|
| Inspect/modify | clients/android/app/src/main/java/com/yansuu1/jizhang/ui/DataTab.kt |
| Inspect/modify | clients/android/app/src/main/java/com/yansuu1/jizhang/ui/AssistantTab.kt |
| Inspect/modify | clients/android/app/src/main/java/com/yansuu1/jizhang/ui/MyTab.kt |
| Inspect/modify | clients/android/app/src/main/java/com/yansuu1/jizhang/ui/MainShell.kt |
| Inspect/modify | clients/android/app/src/main/java/com/yansuu1/jizhang/ui/ProviderSettings.kt |
| Inspect/modify | clients/android/app/src/main/java/com/yansuu1/jizhang/ui/feature/assistant/AssistantBatchImportWorkspace.kt |
| Inspect/modify | clients/android/app/src/main/java/com/yansuu1/jizhang/ui/feature/assistant/AssistantBatchModels.kt |
| Inspect/modify | clients/android/app/src/main/java/com/yansuu1/jizhang/ui/feature/assistant/AssistantImportState.kt |
| Inspect/modify | clients/android/app/src/main/java/com/yansuu1/jizhang/repo/AssistantRepository.kt |
| Inspect/modify | packages/server/src/routes/import-batches.ts |
| Inspect/modify | packages/server/src/services/import-batch-service.ts |
| Create | clients/android/app/src/main/java/com/yansuu1/jizhang/ui/feature/imports/PlatformImportHost.kt |
| Behavior test/new or existing | packages/server/test/import-batch-manual-flow.test.ts |
| Behavior test/new or existing | packages/server/test/import-batch-confirm.test.ts |
| Behavior test/new or existing | packages/server/test/import-batch-regression.test.ts |
| Behavior test/new or existing | packages/server/test/import-batch-limits.test.ts |
| Behavior test/new or existing | clients/android/app/src/test/java/com/yansuu1/jizhang/ui/feature/assistant/AssistantBatchImportStateTest.kt |
| Behavior test/new or existing | clients/android/app/src/test/java/com/yansuu1/jizhang/ui/feature/imports/PlatformImportEntryStateTest.kt |
| Maintain | clients/android/README.md |

## Interfaces

PlatformImportEntryContext carries source=data/assistant, conversationId?, and returnRoute. Use existing AssistantRepository create/get/rows/categories/review/confirm/cancel methods and ImportBatch typed data; the standalone host obtains its real protocol context only after valid selection and explicit start. Do not define a second importer or bypass reviewToken/viewRevision/hash/category approval. C1's secondary tool route is the integration point.

## Data flow and chosen behavior

Extract the batch workspace into a reusable standalone entry without mounting hidden full-size AssistantTab. New platform imports use one host for one/many supported files; Assistant origin keeps conversation/return context. Picker cancel writes no empty context. Manual parse/edit/read/review/confirm never calls analyse/generations/Provider. Explicit AI requests retain existing error and ownership boundaries; failure leaves manual editing available. Exception-first view is a reversible filter with All access, full remarks, distinct rule/user exclusion counts and retained page drafts. Final screen renders the authoritative review result and sends explicit selection plus original hashes/token in one atomic financial confirmation. Keep legacy pending single-file cards and app-native CSV/transfer/backup contracts. No new batch state machine, limits increase or automatic category approval.

## Compatibility and migration

Inherit the parent's exact cents/gross/net/goal/manual-source boundaries. Existing fields/endpoints retain their default behavior; any extension is additive and explicitly documented. Do not use old UI redesign or historic tests as current implementation proof. Unsupported API is an unavailable state, not successful zero values. Only C4 adds the goal-progress migration; its ordinal is checked against the current registry before creating code.

## Validation and rollback

The scoped fixtures are C5-01, C5-02, C5-03, C5-04, C5-05, C5-06, C5-07, C5-08. Use meaningful behavior tests for new calculations/lifecycles; reversible copy/menu/folding changes use existing tests and device QA, not implementation-mirroring source assertions. Verify before a scoped commit. Roll back user-flow changes independently where possible; do not remove accepted historical facts or restore a database with running writers. Full operational checkpoints are in the parent implement.md.
