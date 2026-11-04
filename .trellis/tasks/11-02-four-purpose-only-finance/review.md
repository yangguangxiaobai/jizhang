# Core finance repair audit and four-purpose simplification review

- Date: 2026-11-03 (Asia/Shanghai).
- Audited against `docs/superpowers/plans/2026-10-30-core-finance-simplification-repair.md` on the current dirty worktree.
- HEAD: `bde9a18da5ef33567f52fb544f181479cd4aedf3`. Existing working changes are part of the audit baseline.
- Status: planning. This report does not authorize deployment or destructive data changes.

## Result

The central workflows have broad source and automated-test coverage, but the prior repair is not fully closed in the current checkout. Android review identified six actionable behavior defects. Server review found two additional import defects, both reproduced using an isolated in-memory database. The passing finance suites therefore do not establish that every repair item works end to end. Two server test-only errors also keep the documented lint and typecheck gates red. No production finance source was changed in this audit.

The full scoped reviews, including T01–T14 coverage and exact source/test anchors, are in [Android review](research/android-repair-audit.md) and [server/shared review](research/backend-repair-audit.md). Fresh command output and the synthetic import reproductions are in [verification evidence](research/evidence-2026-11-03/check-results.md).

## Actionable findings

| ID | Area | Finding and consequence | Main evidence |
|---|---|---|---|
| A01 | Android T05/T07 | Monthly-plan and goal reads take turns invalidating a shared response-owner ticket. Refreshing while a plan is loaded can discard one read and leave its loading state stuck. | `clients/android/app/src/main/java/com/yansuu1/jizhang/ui/MonthlyPlanWorkspace.kt:117–175` |
| A02 | Android T10/T12 | Batch replacement/removal use fresh request IDs and do not hydrate stored recovery metadata. A lost response cannot recover the original mutation outcome and draft remapping. | `clients/android/app/src/main/java/com/yansuu1/jizhang/ui/feature/assistant/AssistantBatchImportWorkspace.kt:137–140`, `:670–705`, `:1193–1200` |
| A03 | Android T12 | Several assistant-import, manual-goal and secondary-finance Back routes bypass the active dirty/pending leave decision, so drafts can close without the promised guard. | `clients/android/app/src/main/java/com/yansuu1/jizhang/ui/MainShell.kt:281–292`, `AssistantBatchImportWorkspace.kt:1110`, `MonthlyPlanWorkspace.kt:79–88`, `MyTab.kt:146–165` |
| A04 | Android T08 | A stale salary template rejected after the form has loaded is flattened into an outcome before the template-refresh error handler, so the form cannot enter the claimed repair path. | `clients/android/app/src/main/java/com/yansuu1/jizhang/ui/SalarySheet.kt:630–631`, `:644–668`; catalogue claim at `clients/android/README.md:283` |
| A05 | Android T04/T12 | Goal forms can start another operation while an earlier operation is unresolved; a definite rejection also closes the form and drops its entered values. | `clients/android/app/src/main/java/com/yansuu1/jizhang/ui/ManualGoalProgressWorkspace.kt:453–547`, `:558–589` |
| A06 | Android T05/T07 | Statistics retains prior goal actuals after a failed refresh without showing that the displayed value is stale. | `clients/android/app/src/main/java/com/yansuu1/jizhang/ui/StatsTab.kt:235–238`, `:322–339` |
| F01 | Server T10 | A successfully removed import file cannot replay its original keyed result: current-index/last-file validation runs before operation lookup. An identical retry receives HTTP 400. | `packages/server/src/services/import-batch-service.ts:1758–1790`; reproduced for both indices of a two-file batch; batch version remains 2. |
| F02 | Server T11 | Two approved suggestions renamed to the same new category entity are counted as two creations in Review, while Confirm creates exactly one. | `packages/server/src/services/import-batch-service.ts:2471–2525`, `:2735–2819`; isolated reproduction: Review says 2, Confirm and SQLite say 1. |
| F03 | Test gate | Workspace lint exits 1 because the final `rev` assignment is unused. This is a test-code gate failure, not a demonstrated runtime defect. | `packages/server/test/financial-goals.test.ts:1177` |
| F04 | Test gate | Workspace typecheck exits 2 because `modules[0]` may be undefined. This is a test-code gate failure, not a demonstrated runtime defect. | `packages/server/test/salary-operation-replay-regression.test.ts:233` |

The Android report also identifies limitations in existing test depth and catalogue wording. The findings above are from a bounded audit, not a claim that every row in the 46-item acceptance matrix was newly executed.

## Fresh verification

| Check | Result |
|---|---|
| Shared build / tests | Pass; 12 files, 388 tests. |
| Server tests / production build | Pass; 49 files, 1,047 tests; TypeScript production build passes. |
| Server lint / test typecheck | Fail; F03 and F04. |
| Android unit tests | Fresh forced run passes; 63 suites, 580 tests, no failures, errors or skips. |
| Android lint / APK build | Pass; 43 lint warnings and 26 information items, no lint errors. |

Android results are local JVM/lint/build evidence only. No device interaction, production deployment, provider call or production database was used. Prior recorded device-sensitive cases still need device evidence.

## Four-purpose simplification scope

The request is to remove custom bookkeeping cycles, including a cycle starting on the tenth, and retire module budgets while keeping entry centered on a purpose, tags and notes. Source research is recorded in [simplification impact](research/simplification-impact.md).

The current model has a product-level mismatch that must be resolved before design: actual expense overrides accept only `essentials` and `joy`; `growth` and `reserve` are currently allocation/funding purposes. Salary writes also require a module allocation/template, the monthly summary reads a confirmed period, and AI organization can propose and edit budget templates. Removing only their screens would leave active dependencies in the API and data flow.

Historical transactions, accounts, salaries, refunds, tags, notes, goal records and existing purpose evidence must be preserved. Do not infer historical purpose from the latest mapping. Keep ledger income/expense, refunds, transfers and any virtual purpose allocation distinct. Calendar dates may remain optional statistics filters; they must not require creating or confirming a financial cycle.

## Blocking product decision

For new expenses, should the four purposes be **labels only**—each bill gets one purpose, with no salary split or per-purpose remaining balance—or should salary still be **allocated across all four purposes**, with balances accumulating continuously and calendar months used only as filters? The first matches the “choose one purpose when recording” flow most literally; the second keeps the existing fund-allocation role while removing cycle setup and module budgets. This answer determines the transaction contract, growth/reserve semantics, summary and goal integration, and migration plan.

## Planning state

The same-scope task remains in `planning`. The PRD records confirmed requirements, audit results and the unresolved decision. Technical design and implementation checklist will be finalized after that decision, followed by a single concrete plan review. Product-code implementation has not started.
