# Independent check review

## Result
PASS for automated/source review after scoped fixes. No remaining verified critical code finding in the reviewed task scope. Device/live-provider acceptance remains open; this is not a deployment or production acceptance claim.

## Completed TODO
- [x] Load check.jsonl, every curated file, task artifacts, implementation-status, baseline snapshots and task-owned diff.
- [x] Inspect actual parser/provider/normalizer/route/registry/service/transaction and Android review paths, not only implementation summary.
- [x] Fix verified scoped defects; add pending-refund, partial-batch-failure and changed-ledger regressions.
- [x] Re-run full shared/server checks and Android unit/lint/debug build after final code edits.
- [x] Separate whole-tree whitespace baseline, update Android inventory/spec and record findings.

## Findings fixed
1. **Critical accounting eligibility:** `packages/shared/src/platform-bills.ts:305` previously accepted every status containing 退款, admitting income marked 退款中/待退款/退款审核中 as completed money. Replaced this substring exception with exact terminal refund labels; existing success statuses, original refunded expenses and actual successful refund income remain supported. Regression: `packages/shared/test/platform-bills.test.ts:185`.
2. **Warning, silently lost human edit:** `clients/android/app/src/main/java/com/yansuu1/jizhang/ui/AssistantTab.kt:272,566` capped the lifetime category draft map at 100 and silently ignored edits beyond that even when earlier rows were deselected. Keep eligible preview drafts (bounded by the 200-row preview); confirmation already projects overrides to the explicit <=100 selection. Refresh no longer truncates reviewed drafts.
3. **Warning, late retry crosses display ownership:** `AssistantTab.kt:579-585` unconditionally cleared workspaceActionId when analysis completed, closing another action/conversation opened during the request. Completion now closes only its owning current workspace; busy cleanup is gated by the current request ticket.
4. **Warning, uncertain retry gate cleared after failed refresh:** `AssistantTab.kt:558-560` removed actionFileErrors even when refresh failed. Clear it only after successful current-conversation refresh; failed reads retain the uncertain-analysis gate.
5. **Minor incorrect blocked count:** `AssistantImportWorkspace.kt:77` counted rows with the obsolete generic 已忽略 label, while decoded statuses are now detailed reasons. Count hard-ineligible nonexisting rows instead and label 来源禁止.

Android behavioral fixes are source-reviewed/build-checked, not instrumented/device-verified. Existing pure helpers/request-gate tests remain green; no claim that they directly exercise Compose callbacks.

## Independently verified contracts
- `assistant-orchestrator.ts:114-164`: deterministic attachment preview precedes saved-provider invocation; sequential 25-row batches over bounded preview; failures discard all recommendations and expose failed status; no ledger writes during analysis.
- `bill-import-analysis.ts:13-32`: exact shape, known/unique/all IDs, boolean inclusion, bounded nonblank reasons, same-type category IDs; financial-fact fields rejected.
- `assistant-tool-registry.ts:274-277,788-834`: active category list, no expense parents with live children, full generated source-note projection, category/digest/source/ledger/selection/override fingerprint; confirmation has no model invocation.
- `portability-service.ts:857-882,934-993`: strict assistant category validation, explicit <=100 displayed eligible rows, empty selection rejected on write, exact empty-string notes, untouched source notes, independent source isRefund. Legacy name-based import remains separate.
- `assistant-orchestrator.ts:254-324`, `assistant.ts:121-180`: original digest/length validation, stale source/category/ledger rejection, explicit retry replacement, current pending state recheck, atomic write/action/message transaction and duplicate-confirm guards.
- Android row decoder/reconciliation excludes hard blockers but permits human override of AI recommendations/soft duplicates; full-screen review displays source/review note, category names and refund labels; request gates and explicit selected-only payload remain intact.
- README stable entries/API coverage distinguish source/build/mock evidence from device/live-provider evidence; global audit date not advanced.

## Added coverage
- Shared pending-refund statuses remain excluded.
- Server second-batch provider failure discards successful first-batch recommendations and writes nothing.
- Server selected source identity inserted after preview causes 409 and no additional ledger write (the previous test named ledger revalidation but only changed categories).

## Check-run changed files
- `packages/shared/src/platform-bills.ts`
- `packages/shared/test/platform-bills.test.ts`
- `packages/server/test/assistant.test.ts`
- `clients/android/app/src/main/java/com/yansuu1/jizhang/ui/AssistantTab.kt`
- `clients/android/app/src/main/java/com/yansuu1/jizhang/ui/feature/assistant/AssistantImportWorkspace.kt`
- `clients/android/README.md`
- `.trellis/spec/backend/ai-provider.md`
- This report and task-local verification logs. Baseline/task-owned.diff preserved as implementation evidence (not regenerated to hide review fixes).

## Verification rerun
| Command / evidence | Result |
| --- | --- |
| shared build / lint / typecheck | PASS |
| shared full tests | PASS: 176 tests, 7 files |
| server full tests | PASS: 489 tests, 21 files |
| server lint / typecheck / build | PASS |
| Android testDebugUnitTest | PASS: XML reports 20 tests, 0 failures/errors |
| Android lintDebug / assembleDebug | PASS; final rerun BUILD SUCCESSFUL |
| Scoped tracked git diff --check | PASS |
| Whole-workspace git diff --check | FAIL only on unchanged unrelated baseline trailing whitespace below |

Logs: `check-android.log`, `check-server-build.log`, `check-whitespace.log`. Shared/server full test output also captured by this review session tool trace. Android Kotlin compilation emits existing deprecated-icon/unused-parameter warnings; these are not lint failures. Windows invocation used `MSYS2_ARG_CONV_EXCL='*' cmd.exe /c "cd clients\android && gradlew.bat testDebugUnitTest lintDebug assembleDebug"`.

Whole-tree baseline: `.agents/skills/trellis-meta/references/local-architecture/workspace-memory.md:127,128,198,199`; `clients/android/app/src/main/java/com/yansuu1/jizhang/ui/DashboardTab.kt:495`. Not touched.

## Remaining warnings / acceptance
- Up to eight sequential provider calls can exceed Android's existing 90-second read window (`assistant-orchestrator.ts:127`, `ApiClient.kt`); honest refresh/retry handling exists, but real-provider latency/custom template compatibility is not verified. Retain this as an acceptance risk, not a claimed successful device flow.
- Real-format file upload, edited/cleared/untouched note and category persistence, refund accounting, 100-selection cap, missing categories, uncertain outcomes, font/keyboard/accessibility and Android/Harmony4 behavior require device/live-provider acceptance per implementation-status.md.
- No real network provider call, production database mutation, installation, commit or deployment performed. Unrelated working-tree changes preserved.
