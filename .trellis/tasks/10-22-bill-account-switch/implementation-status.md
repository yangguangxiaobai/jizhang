# Bill-page account switching — implementation / verification status

## Authorization and boundary

The user explicitly approved implementation after final planning review. Task is `in_progress`; `approval_gate=approved_by_user`. Built-in frontend and coder subagents own independent Android implementation/JVM tests and isolated backend test additions. No custom subagent was needed.

Production backend routes, database, shared monetary aggregation, account balances, salaries and transfers remain outside the implementation boundary. Preserve the existing dirty worktree. No deployment, physical-device installation or production ledger mutation is part of this task.

## Progress

- Read-only scout and independent planner reviewed the feature gap and final design.
- Existing account filter state/API were confirmed; old account/search advanced-entry documentation was corrected to reflect the missing opener.
- Android source now has the persistent account selector, synchronous query dispatch with full query/generation ownership, per-iteration tail-page correction tokens, independent account metadata child loading, honest unknown/loading counts and retry/refresh feedback. Production helper is `ui/TransactionQueryHelper.kt`; focused class is `ui/TransactionAccountFilterTest.kt` (13 planned/existing `@Test` methods in final source). Full Gradle validation and parent report readback are complete: 13 suites / 169 JVM tests passed (13 new account regressions), debug APK assembled, lint 0 errors / 9 warnings / 18 information entries. No lint entries target the modified bill page or new query helper.
- Backend account tests were added in `packages/server/test/transactions.test.ts` (new describe lines 882–1033; 152 lines / 3 new cases, preserving 24 pre-existing dirty lines). The coder reports shared build, transactions focused 62/62, server typecheck/lint and full server 715/715 across 33 files passed (exit 0). Parent independently reran focused transactions at 09:51:56: 62/62 passed, exit 0; parent independently reran server typecheck/lint/full tests at 09:53:00 and collected completed job `pwsh-833d924e42e44b60`: all exit 0, 33 files / 715 tests passed (14.32s Vitest duration). Independent built-in reviewer found no blockers/warnings in these tests and their source contracts; the reviewer did not execute tests.
- Independent built-in test-runner executed shared tests with bundled Node/pnpm: 7 files / 187 tests passed, exit 0; task manifest validation passed (4 implement / 4 check entries) and `in_progress`/`approved_by_user` state was confirmed. No overlapping Gradle run was started.
- Android implementation, local automated verification and independent source/documentation review are complete. This is local/source delivery, not physical-device acceptance or deployment.
- Native-delivery spec now captures account query identity, historical-account metadata, loading ownership and evidence boundaries.
- Planning Markdown relative-link validation found no missing targets. Android inventory baseline has no duplicate stable-ID rows and no missing Markdown file-link targets. The pre-existing inventory text says 314 stable features, while a syntactic stable-row scan yields 317 (no duplicate IDs); this task does not re-audit unrelated feature counts or silently rewrite historical evidence. Before the new helper is added, all 51 current main Kotlin files are catalogued.

## Deferred device acceptance

See [device checklist](device-checklist.md). Not run. Source review, local JVM/API tests, debug build and lint do not establish dropdown/touch/TalkBack/weak-network interaction acceptance on a physical device.

## Validation results so far

All pnpm commands use the bundled Node executable and pnpm script returned by `load_workspace_dependencies`; Node bin is prepended only in the command process, with no global toolchain changes.

| Check | Result | Evidence |
|---|---|---|
| `pnpm --filter @jizhang/shared build` | PASS, exit 0 | Coder execution report |
| `pnpm --filter @jizhang/shared test` | PASS, 7 files / 187 tests, exit 0 | Independent test-runner execution report |
| `pnpm --filter @jizhang/server exec vitest run test/transactions.test.ts` | PASS, 62 tests, exit 0 | Parent independent direct run at 09:51:56 |
| `pnpm --filter @jizhang/server typecheck` | PASS, exit 0 | Parent independent combined run |
| `pnpm --filter @jizhang/server lint` | PASS, exit 0 | Parent independent combined run |
| `pnpm --filter @jizhang/server test` | PASS, 33 files / 715 tests, exit 0 | Parent completed/collected job `pwsh-833d924e42e44b60`, Vitest 09:53:00 / 14.32s |
| Android focused account JVM tests | PASS, 13/13 | Frontend focused execution; parent read final XML with 13 tests / 0 failures / 0 errors / 0 skipped |
| Android full unit/debug/lint | PASS, exit 0; 13 suites / 169 tests / 0 failures/errors/skips; debug assembly successful; lint 0 errors / 9 warnings / 18 information | Frontend full run and collected build job `pwsh-6c58990ed61446f2`; after frontend completed, parent independently ran `gradlew.bat :app:testDebugUnitTest :app:assembleDebug :app:lintDebug` (BUILD SUCCESSFUL in 2s, 53 tasks / 51 up-to-date) and parsed test/lint XML. No task page/helper lint findings |
| API test / source contract review | PASS, no blockers or warnings | Built-in reviewer; source-only, no execution claims |
| Android source / regression review | PASS, no remaining blockers after follow-up | Reviewer checked visible selector, synchronous dispatch, all load entries, independent account child job, cancellation and per-step page-correction finally tokens; earlier interleaving test gap fixed by added regression. Source-only, not device evidence |
| Task manifests | PASS, 4 implement / 4 check entries | Parent plus independent test-runner |

## Acceptance mapping (local evidence)

| Criterion | Source / automated evidence | Remaining boundary |
|---|---|---|
| AC1 visible account entry | `TransactionsTab.kt` month block followed by unconditional `ListChoice`; `buildAccountChoices` includes all/historical/fallback; independent reviewer checked wiring | Physical dropdown/touch/accessibility NOT RUN |
| AC2 account isolation and preserved predicates | Production-used query helper tests; 3 real API cases with A/B and precise from/to/type/category/tag/q predicates; focused 62 passed | No production-data read/write validation |
| AC3 page reset/correction | `selectAccount` copies other fields and resets page; API A has 51 matching rows on two pages; helper correction and per-step generation-finally tests | Device delete-tail flow NOT RUN |
| AC4 late response ownership | Synchronous startLoad before launch; all entry points use dispatcher; exact-query plus generation guards; ABA, mismatch, page and refresh/retry interleaving regressions; reviewer closed correction/finally issue | No weak-network device claim; synchronous HTTP cancellation is not immediate socket cancellation |
| AC5 history/metadata/errors | Live historical-account API case; independent account metadata child job; state regression for account/category separation and retained choices; visible loading/error/retry source reviewed | JVM model tests do not execute Compose or prove end-to-end HTTP/UI metadata behavior |
| AC6 verification/inventory | Source/test/README independent review, all 52 main Kotlin files catalogued, README file links valid and no duplicate stable-ID rows; fresh Android XML readback confirms 169 passing JVM tests and lint 0 errors / 9 warnings | Local verification complete; device interaction separately deferred |

## Scope / housekeeping

- Task-owned product edits: Android `TransactionsTab.kt`, new `TransactionQueryHelper.kt`, new `TransactionAccountFilterTest.kt`; backend changes are test-only in `transactions.test.ts` (152 new lines; its 24 earlier dirty lines were preserved). Native-delivery spec/index, Android feature inventory and this task's artifacts were also maintained.
- No production server/API/shared implementation or database schema change was made by either implementation subagent. Repository-wide dirty state includes extensive pre-existing changes and is not attributed to this task.
- `git diff --check` passed for tracked changed code; direct checks found no trailing whitespace or merge conflict markers in all four task source/test files. Inventory link/ID and 52-file coverage checks passed.
- `trellis-finish-work` was loaded. Its sanity gate disallows archiving while task-owned source is uncommitted. Because this shared worktree already contains extensive mixed/untracked changes and no commit was requested, no auto-commit/archive/add_session script was run; durable progress is retained in the task artifacts. Other active tasks were not altered or archived.

## Debug artifact (local, not installed)

- Path: `clients/android/app/build/outputs/apk/debug/app-debug.apk`.
- Size: **19,830,293 bytes**.
- SHA-256: **8c10a75b3d0039c2f177144801150ea8d695b02551afefe4bd1624833a6b8e3f** (parent independently computed from the current artifact).
- Test XML: `clients/android/app/build/test-results/testDebugUnitTest/TEST-*.xml`; account suite timestamp `2026-10-22T02:04:21` as serialized by Gradle (UTC-style time, do not confuse with local elapsed time).
- Lint XML: `clients/android/app/build/reports/lint-results-debug.xml`.

## Completion status

**LOCAL VERIFIED / DEVICE NOT VERIFIED.** R1–R5 and AC1–AC6 have source/local evidence mapped above; physical-device acceptance is an explicit out-of-scope follow-up, not a claimed pass. Production backend contracts were unchanged. No commit/archive is performed while task-owned code changes remain uncommitted in the shared dirty worktree; the task remains available for user review and later commit/archive.
