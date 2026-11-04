# Bill-page account switching — implementation plan

## Approval gate

The user explicitly approved the latest final planning summary with “批准实施”. `task.py start` has changed the task to `in_progress`, and the approval metadata records `approved_by_user`. The earlier “开始” was task-creation consent; implementation began only after the later explicit approval.

## Ordered checklist

1. Read `trellis-before-dev`, applicable spec indexes and native-delivery guidance before implementation. Read affected current files and preserve the large pre-existing dirty worktree.
2. Implement the persistent account selector in the Android bill page, reusing current account IDs/names and applied account state. Keep historical choices, all-accounts behavior and useful metadata retry/fallbacks. The selected production-used helper is `ui/TransactionQueryHelper.kt`; focused JVM regression class is `ui/TransactionAccountFilterTest.kt`.
3. Make filter/page request scope explicit and production-testable with the smallest helper needed. Unify latest-response ownership across filter, page, refresh, retry and delete reload paths. Prevent old-account rows/totals and cancellation/finally races from being published under new selection.
4. Add local tests of production query/state behavior: all versus one account, preservation of other filters, page reset, no-op same selection, request ownership/cancelled/error completion and page correction. Extend isolated backend account-filter tests for two accounts, combined month/type filters, >50 rows with correct total/offset, and live historical bills after account soft delete as appropriate. Do not change production backend contracts.
5. Update Android inventory stable L02 entries, entry-point descriptions, affected source-audit date, API coverage/known gaps and change log; do not advance unrelated section audit dates or claim device verification. Mention unrelated missing advanced/search entry points accurately rather than claiming they were restored.
6. Run focused tests first, then Android debug unit tests/build/lint; run backend focused tests/typecheck/lint if test code changes. Read actual reports. Use `trellis-check` and an independent reviewer; resolve findings within scope.
7. Finish with `trellis-finish-work` as applicable, record verification evidence and outstanding device acceptance. Do not commit unrelated work or deploy/install without a further request.

## Validation commands

From `clients/android` (Windows):

```powershell
.\gradlew.bat :app:testDebugUnitTest --tests "com.yansuu1.jizhang.ui.TransactionAccountFilterTest"
.\gradlew.bat :app:testDebugUnitTest :app:assembleDebug :app:lintDebug
```

The focused test class name is a planned name, not an existing test. If implementation selects another name, update this plan to the real one before running it.

From repository root, only if backend tests are extended:

```powershell
pnpm --filter @jizhang/shared build
pnpm --filter @jizhang/server exec vitest run test/transactions.test.ts
pnpm --filter @jizhang/server typecheck
pnpm --filter @jizhang/server lint
```

Discover the installed toolchain rather than assuming Java/Android SDK/Node versions or installing/reconfiguring globally. Use bundled Node/pnpm paths if dependency-loading tools provide them. Record exact commands and any infrastructure blockers, not presumed success.

## Review and rollback points

- Risky area: TransactionsTab's current overlapping request/effect paths and last-page deletion correction. Review all UI publications, not only items/total.
- Review the actual visible account entry and production helper wiring; standalone helper tests do not prove UI integration.
- Server additions are tests only. No schema, auth, aggregate arithmetic or external service changes.
- Device acceptance remains pending unless actually executed. Build success is not dropdown interaction proof.
- No `git reset`/restore of whole files: bill page and README already contain unrelated uncommitted work. Revert only task-owned hunks if needed.
