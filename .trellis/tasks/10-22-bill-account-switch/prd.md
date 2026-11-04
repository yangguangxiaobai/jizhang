# Bill-page account switching

## Goal

Let the user view the selected funding account's monthly transactions directly from the Android bill page, without navigating to account management or relying on an unreachable filter panel.

## Background and confirmed evidence

- The supported client for this scope is Android Compose; Web is reference-only ([Android inventory](../../../clients/android/README.md#L33-L35)). Accounts mean funding accounts, not login users or separate ledgers.
- Existing bill state/query already includes `accountFilter` and `accountId` ([TransactionsTab.kt](../../../clients/android/app/src/main/java/com/yansuu1/jizhang/ui/TransactionsTab.kt#L89-L145)). Filtering changes currently reset pagination ([same source](../../../clients/android/app/src/main/java/com/yansuu1/jizhang/ui/TransactionsTab.kt#L219-L225)).
- The account filter sheet exists but has no opening handler: `showFilters` starts false and is only assigned false ([sheet](../../../clients/android/app/src/main/java/com/yansuu1/jizhang/ui/TransactionsTab.kt#L472-L524)); current header has only the new-bill action ([header](../../../clients/android/app/src/main/java/com/yansuu1/jizhang/ui/TransactionsTab.kt#L246-L273)).
- Historical account names are loaded with `includeDeleted=true` ([metadata loading](../../../clients/android/app/src/main/java/com/yansuu1/jizhang/ui/TransactionsTab.kt#L175-L181)).
- The existing authenticated transaction API accepts `accountId` ([route](../../../packages/server/src/routes/transactions.ts#L61-L73)); SQL uses the same predicates for count and paged items ([service](../../../packages/server/src/services/transaction-service.ts#L790-L861)). No new production backend contract is needed.
- The user replied “开始” on 2026-10-22 after the minimal scope proposal, authorizing task creation and detailed planning. Final planning review and fresh implementation approval remain required by the project workflow.

## Requirements

- **R1 — Visible entry:** Show a persistent, labeled account selector on the bill page, including “全部账户” and individual available/historical account names. Default to all accounts. Select one account at a time and apply immediately, without requiring the advanced filter sheet.
- **R2 — Composable filtering:** Reuse the existing applied account state and server query. Switching accounts preserves the visible month, income/expense type, category, tag and applied search; reset to page 1. Selecting all accounts omits `accountId`.
- **R3 — Correct result scope:** Items, total and pagination must correspond to the selected account and other conditions. Rapid switching and overlapping refresh/page/delete loads must not publish an older scope's success, error or loading completion over the selected scope. While a new scope has no loaded result, its count must be visibly loading/unknown rather than falsely reporting a successful zero result, and previous rows must not be mislabeled as current results.
- **R4 — Historical and failure states:** Keep historical funding accounts selectable through existing `includeDeleted` metadata. Unknown selected IDs retain an explicit “账户信息暂不可用（保留当前条件）” fallback, not an unsupported claim that the account was deleted. Empty results show the existing adjustment/clear-filter guidance. Account choices must be loadable even when the transaction request fails; account metadata failures have visible retry and retain previous valid choices. No deleted-account grouping or badges are promised because the current account DTO has no deletion flag.
- **R5 — Compatibility and maintenance:** Keep existing bill detail/edit/delete, month selection, type filters and clear-filter semantics. Update affected stable L02 feature entries, API coverage, known gaps and change log in the Android feature inventory; distinguish source/local validation from device verification. Preserve unrelated uncommitted changes.

## Acceptance criteria

- [x] **AC1 / R1:** Account choice is wired into the initially visible bill page; it offers either of two funding accounts, displays the selected name and allows switching back to all accounts without entering another page.
- [x] **AC2 / R2–R3:** Two populated accounts return isolated rows and matching totals. All-accounts requests omit `accountId`. Month, type and existing extra conditions survive account switching.
- [x] **AC3 / R2–R3:** From page 2 of an account with at least 51 matching bills, switching accounts requests offset 0 and displays page 1; next/previous pagination and deletion-tail correction use the selected account and matching total.
- [x] **AC4 / R3:** For delayed A→B and A→B→A requests, old success/error/finally cannot overwrite the latest selected result or loading state. Include page/refresh/retry interleavings. A failed B load is not presented as a successful B view containing A's bills or A's count; a new scope shows loading/unknown count until its own result is ready.
- [x] **AC5 / R4:** An account with no matching bills has a useful empty state; a soft-deleted account's retained live bills remain queryable. Failed transaction loads do not prevent account-choice metadata loading. Metadata failure exposes retry without changing the selected account or dropping existing valid choices.
- [x] **AC6 / R5:** Production-used account query/state/request-ownership logic has local JVM tests; isolated API tests cover account isolation, combined conditions and pagination. Android unit tests, debug compilation and lint are run, with exact failures/environment blockers reported. Entry wiring is source-reviewed; no Compose instrumentation infrastructure or device interaction is implied by unit-test/build success. Device interaction acceptance remains pending unless actually executed, and documentation states that boundary.

## Out of scope

- Account balances, account monthly income/expense summaries, statistics-page changes, or client-side money aggregation.
- Salary/transfer rows mixed into the normal transaction list.
- Multiple-account selection, all-history/custom ranges, separate ledgers or multiple login users.
- Deleted-account badges/grouping, API/DB schema changes, deployment, signing or installing on a physical device.
- New guarantees for state persistence across tab changes, detail navigation or process death.
- Restoring unrelated currently unreachable search/advanced-filter entry points unless needed for the agreed account-selector behavior.

## Planning status

No unresolved product decisions within the minimal scope. PRD convergence rewrite/readback and independent built-in planner review are complete; design, implementation plan and real spec/research manifests exist, and `task.py validate` passed with four entries in each manifest. The user explicitly replied “批准实施” after the latest final planning summary; `task.py start` changed the task to `in_progress`. Implementation, source/documentation review and local validation are complete: Android 169 JVM tests / debug build / lint passed (9 existing warning entries retained), server 715 tests / typecheck / lint passed, and shared 187 tests passed. Detailed evidence is in [implementation status](implementation-status.md); physical-device acceptance is NOT RUN and remains separately deferred. No commit/archive was performed in the pre-existing mixed dirty worktree. Planning itself did not run local tests or builds.
