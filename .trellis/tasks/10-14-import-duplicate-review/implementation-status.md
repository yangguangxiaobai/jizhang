# Implementation status — import duplicate review

## Result
Implementation and local automated gates complete. Independent main-session review and device acceptance remain pending. No deployment, device installation, production/provider calls, real-ledger writes, commit, push or merge performed. Tests use disposable in-memory databases and mocked providers.

The pre-existing `baseline/` snapshot is preserved. The workspace already contained a partial comparison implementation at dispatch; this pass completed missing Android decoder/caller wiring, hardened lifetime/error handling and moved route business rules into the scoped read service. All comparison changes are recorded against the original task baseline in `task-owned.diff`. Existing prior import changes and unrelated working-tree edits were not reverted.

## Change boundary
Gap: a suspicion marker did not let a reviewer inspect current corresponding ledger bills within the import workspace. Matching belongs in PortabilityService; action/display ownership belongs in the assistant comparison service; selection and review drafts remain with the parent Android workspace. Additive source facts (`comparisonAccountId`, `externalId`) participate in the existing row fingerprint. No migrations, new heuristics, ledger edit/merge/delete, relaxed stable-ID blockers, altered final-confirm flow or data-management selection contract.

## Completed files
- `packages/server/src/services/portability-service.ts`: captured comparison account/order facts; current local-day/type/amount/account matching, strict limit 1–50 and bounded ID cursor, all-match count/keyset paging, historical names, full transaction detail/note/refund identity, legacy refresh error and impossible-date rejection.
- `packages/server/src/services/assistant-tool-registry.ts`: additive facts in first-200 stored/displayed rows (not unbounded candidate records).
- `packages/server/src/services/assistant-import-comparison-service.ts` (new): resolves live conversation/pending import action/displayed row; rejects wrong conversation and closed actions; never invokes a tool/provider or writes.
- `packages/server/src/routes/assistant.ts`: thin authenticated GET `/api/v1/assistant/conversations/:conversationId/actions/:id/rows/:rowId/duplicates`; no-store response; injected read timestamp.
- `packages/server/test/assistant.test.ts`: auth/error shapes, wrong conversation/missing displayed row, old-preview refresh, cancel/replacement/archive, strict query bounds, no provider calls and byte-identical database after read.
- `packages/server/test/platform-import.test.ts`: multiple candidates including empty/full notes, day/type/amount/account/deletion filtering, refund identity, deleted-reference labels, current removals, impossible dates and no writes.
- `clients/android/app/src/main/java/com/yansuu1/jizhang/repo/AssistantRepository.kt`: encoded conversation/action/row request with 20-row page size.
- `clients/android/app/src/main/java/com/yansuu1/jizhang/ui/AssistantTab.kt`: capture owning conversation/action and wire comparison read callback.
- `clients/android/app/src/main/java/com/yansuu1/jizhang/ui/feature/assistant/AssistantImportState.kt`: source category projection.
- `clients/android/app/src/main/java/com/yansuu1/jizhang/ui/feature/assistant/AssistantDuplicateState.kt` (new): typed bounded decoder preserving full notes, integer cents, refund identity, source facts/count/cursor/time; malformed response rejection.
- `clients/android/app/src/main/java/com/yansuu1/jizhang/ui/feature/assistant/AssistantImportWorkspace.kt`: full-screen comparison dialog while parent list stays mounted with explicit remembered list state; source/review/existing facts, heuristic and live-read explanation, loading/empty/error/retry/next page, explicit include/exclude respecting eligible/busy/uncertain/100 cap. Closing alone changes nothing. Request action+row/generation gating rejects late responses after close/disposal/new request; terminal action closes comparison.
- `clients/android/app/src/test/java/com/yansuu1/jizhang/ui/feature/assistant/AssistantDuplicateStateTest.kt` (new): four pure tests for typed projection/full notes/empty pages/refund identity/bounds, action-row/pagination/close-reopen isolation, explicit selection and draft independence.
- `clients/android/README.md`: updated A026, new stable A101–A103, API matrix/fields/limits/entry points/known gaps/change log. Global audit date unchanged; source checks distinguished from device evidence.
- `.trellis/spec/backend/ai-provider.md`: executable read-only comparison contract and regression/evidence requirements.

## Final automated verification
| Check | Result |
| --- | --- |
| Shared `build`, `lint`, `typecheck` | PASS |
| Shared `test` | PASS — 7 files / 176 tests |
| Server `lint`, `typecheck`, `build` | PASS |
| Server `test` | PASS — 21 files / 494 tests (full suite; last run after no-store assertion) |
| Android `testDebugUnitTest` | PASS — 4 suites / 24 tests / 0 failures / 0 errors |
| Android `lintDebug`, `assembleDebug` | PASS — final Gradle run BUILD SUCCESSFUL |
| Scoped `git diff --check` and task-added untracked-file whitespace checks | PASS |

Logs: `server-check.log`, `android-check.log`; Android reports: `clients/android/app/build/test-results/testDebugUnitTest/`, `clients/android/app/build/reports/tests/testDebugUnitTest/`. Kotlin emits existing unused-parameter/cast and ArrowBack/Send deprecation warnings; no new failing lint gate. No release/device build claim.

## Self-review
Traced stored parser facts → bounded assistant preview → scoped service → transaction-detail DTO → repository → typed decoder → retained-parent dialog. Candidate payload is response-only, not persisted or sent to AI. Heuristic matches the existing account/local-calendar-day/type/amount rule, including empty-note matches; refund identity is not an invented extra predicate. Deleted categories/accounts label historical records. Existing-ID dedup, preview/final digest/category/selection fingerprints, transactional confirmation and idempotence are unchanged. Read endpoint runs inside existing authentication; terminal/archived/replaced actions fail. No decision controls edit existing ledger records or invoke confirm.

No sub-agent was spawned (implement-agent recursion guard). An independent reviewer must be dispatched by the main session, not claimed as completed here.

## Pending device checklist (no production confirmation)
1. In an isolated test workspace, edit category/note (including clear), select other rows, search/filter and scroll. Open/close/back from comparison; assert drafts, selection, filter/query and exact list position remain.
2. Compare source order/status/counterparty/refund warning where present, full long/empty notes, deleted-reference names and refund identity. Test small screens/large fonts with vertically scrollable controls.
3. With >20 matching disposable records, inspect total, next pages and first-page refresh. Delete/update a candidate in the isolated fixture; assert fresh reads reflect change and empty-state wording.
4. Simulate delayed responses, failure/retry, opening another row and close/reopen; ensure no response leaks across action/row/workspace. Cancel/retry replacement/archive/session expiry while requests are pending and verify no stale data is shown in another workspace.
5. Explicit keep/exclude changes only source selection; hard duplicate/ignored rows remain blocked, selected 100-row cap and busy/uncertain gates hold. Closing comparison never opens or performs final confirmation.
6. Legacy pending card without comparison facts shows re-upload guidance. Do not substitute arbitrary client amounts/account IDs.

## Artifact note / blockers
No implementation tooling blocker remains. The existing `implement.md` contains non-UTF-8 legacy bytes; checkbox updates preserve those bytes rather than transcoding unrelated text. An initial documentation-update script hit UnicodeDecodeError only at that final file; README/spec writes had already completed, and checklist updates were then done byte-preservingly. The last checklist item stays open specifically for independent review; all automated gates are recorded above.
