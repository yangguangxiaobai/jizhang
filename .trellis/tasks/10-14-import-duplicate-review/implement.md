# Execution

Final plan approved by user: ��ʼʵ��. Baseline captured before edits. Snapshot affected current sources and diffs; prior import changes are baseline, not owned here.
- [x] Read specs/Android inventory; inspect source facts, pending-action lifecycle and matching/detail reuse.
- [x] Implement bounded action-row scoped current duplicate read service and route, additive source projection with legacy compatibility.
- [x] Add Android repository/typed decoder and in-workspace comparison UI with pagination and explicit keep/exclude, preserving drafts/list state and generation gates.
- [x] Redesign import workspace list cards and comparison screen using Ardot design system (structured Key-Value field comparison with match highlights, clear decision actions, FinanceCategoryIcon, status pills, and overview stats).
- [x] Remove "不可导入" blocking restriction: allow user to select/deselect any positive unimported row in both backend portability-service (relax ignored requirement when explicitly selected) and Android AssistantImportState/Workspace (eligible=true, filter chips "全部/已选入/未选/疑似重复").
- [x] Add server tests for multiple/empty-note matches, dates/type/account/refunds, ownership/auth, bounds, stale/deleted candidates, no writes/no AI; Android pure comparison/selection/request tests and device checklist.
- [x] Update affected README/spec, independent review and scoped checks.

Checks: shared build/tests; server test/lint/typecheck/build; Android testDebugUnitTest/lintDebug/assembleDebug; scoped diff --check. Manual device testing without final production confirm; deployment/install approval separate. Rollback task-owned hunks only, no DB restore.
