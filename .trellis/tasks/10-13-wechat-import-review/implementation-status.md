# Reviewed bill-import implementation status

## Result / boundary
Implemented shared parsing → configured provider analysis → Android human review → explicit atomic confirmation. No deployment, commits, live provider requests, device installation or production database writes. Existing unrelated workspace changes were not reverted. Source baseline snapshots (including existing untracked Android helpers/README) are under `baseline/`.

## Completed TODO
- [x] Load task/spec context and snapshot scoped current files.
- [x] Shared independent refund facts and strict reviewed import contract.
- [x] Configured-provider bounded analysis (25-row batches, 200-row preview), strict recommendation normalization and honest failure/explicit retry.
- [x] Android existing-category picker, independent note editing/clear, AI suggestions/reasons/hard blockers and reviewed secondary confirmation.
- [x] Regression coverage, stable inventory/spec synchronization and automated verification.

## Task-owned source/test/documentation files
- `packages/shared/src/platform-bills.ts`: refunded original expense eligibility, actual source refund income identity, no generated movements/links, refund warning, safe integer amounts and calendar validation.
- `packages/shared/test/platform-bills.test.ts`: updated existing real-export regression and partial/missing-refund fixture assertions.
- `packages/server/src/services/bill-import-analysis.ts` (new): exact known-row/type/category/shape/reason normalization, response schema.
- `packages/server/src/services/ai-types.ts`, `ai-provider-service.ts`: advisory bill-import feature prompt, saved preset/custom provider reuse.
- `packages/server/src/services/assistant-orchestrator.ts`: source-first analysis, persist validated recommendations or honest failure, deterministic confirmation carrying reviewed values without provider calls.
- `packages/server/src/services/assistant-tool-registry.ts`: strict assistant-ID adapter, untruncated source-note projection, current category hash projection and reviewed override fingerprint.
- `packages/server/src/services/portability-service.ts`: assistant-only strict category/selection/note validation; legacy independent name-based category creation/restoration preserved. Reviewed notes and independent refund flag persisted atomically.
- `packages/server/src/routes/assistant.ts`: aligned 100-selection/override limit; note overrides; authenticated original-digest-checked explicit analysis retry/replacement card.
- `packages/server/test/assistant.test.ts`: mocked real HTTP provider integration, no preconfirm writes, no model call on confirmation, editable refund/clear note persistence, duplicate confirm, honest failure/retry, invalid output, stale category and transactional rollback.
- `packages/server/test/platform-import.test.ts`: legacy refund regression, strict category restrictions, reviewed-note/refund identity, 200/100/empty selection protection.
- `packages/server/test/bill-import-analysis.test.ts` (new), `packages/server/test/fixtures/refund-review.csv` (new).
- `clients/android/app/src/main/java/com/yansuu1/jizhang/repo/AssistantRepository.kt`: note override and explicit analysis API.
- `clients/android/app/src/main/java/com/yansuu1/jizhang/ui/AssistantTab.kt`: per-action reviewed notes, suggestion category IDs, scoped retry, full reviewed confirmation, uncertain-result refresh gate.
- `clients/android/app/src/main/java/com/yansuu1/jizhang/ui/feature/assistant/AssistantImportState.kt`: typed analysis/source/refund decoding and review helpers.
- `clients/android/app/src/main/java/com/yansuu1/jizhang/ui/feature/assistant/AssistantImportWorkspace.kt`: source/review note separation, category radio picker, reasons/status/blocker/cap explanation, explicit analysis retry.
- `clients/android/app/src/test/java/com/yansuu1/jizhang/ui/feature/assistant/AssistantImportStateTest.kt`: AI eligibility/overriding and reviewed-note/category helpers.
- `clients/android/README.md`: preserve IDs, update A023/A026–A030/A086/A094/A098, D021 refund contract, API coverage and gaps; global audit date unchanged.
- `.trellis/spec/backend/ai-provider.md`: executable reviewed-import contracts.

## Verification evidence
| Check | Result |
| --- | --- |
| Shared build, lint, typecheck | PASS |
| Shared full tests | PASS, 175 tests / 7 files |
| Server build, lint, typecheck | PASS |
| Server full tests | PASS, 487 tests / 21 files |
| Android testDebugUnitTest | PASS, 20 tests (9 assistant helper tests) |
| Android lintDebug | PASS |
| Android assembleDebug | PASS |
| Scoped tracked `git diff --check` | PASS |
| Whole-workspace `git diff --check` | Existing unrelated trailing whitespace in `.agents/skills/trellis-meta/references/local-architecture/workspace-memory.md` lines 127/128/198/199 and `DashboardTab.kt` line 495; not changed |

Logs: `shared-test.log`, `server-test.log`, `android-check.log`. Android command uses `MSYS2_ARG_CONV_EXCL='*' cmd.exe /c "cd clients\android && gradlew.bat testDebugUnitTest lintDebug assembleDebug"`. Initial task-owned test failures (old blanket refund expectations, missing strict category in legacy assistant fixture, SQL fixture missing icon/color, coroutine boundary) were corrected and checks rerun. No baseline failure claimed for these.

## Remaining acceptance / limitations (not automated evidence)
- [ ] Device test on a real configured provider: upload real-format file, observe reasons, reverse AI suggestion, inspect saved reviewed category/note including clear, original expense + actual partial/full refund.
- [ ] Device small screen/large text/keyboard/accessibility and slow/failed provider, weak network and uncertain-write refresh.
- [ ] Exercise missing categories and 100-selection cap on device; verify omitted/unshown rows remain unimported.
- [ ] Real-provider custom template must transmit feature `facts`/`responseSchema` or the corresponding input. Provider failure/partial invalid output is explicitly failed; no live provider compatibility evidence supplied.

Retry intentionally creates a new pending card and closes the old card, resetting review edits (disclosed in UI). Analysis sends at most eight sequential provider calls; a slow provider may exceed the existing Android transport window and require explicit refresh. Source refund warning conservatively asks for actual movement evidence rather than claiming an inferred link. Existing pending cards created before this strict contract may expire on confirmation and need re-upload; no migration is required because storage remains versioned JSON. Device/live-provider acceptance remains open, so automated verification is not end-to-end production acceptance.
