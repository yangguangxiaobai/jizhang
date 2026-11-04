# Bill layout / daily summary implementation status

## Scope
Approved five bill-page improvements. Local source changes only; no deployment, installation, commit, schema mutation or global accounting policy change. Existing dirty worktree retained.

## Implementation
- TransactionsTab: compact title + month navigation + top-right refresh; removed redundant new action and pagination UI; blank account heading; complete-month loader; server daily summaries displayed by local day with independent unavailable state.
- LedgerRepository: additive daily-summary call strips pagination parameters.
- Shared ListChoice: blank labels omit heading, other callers unchanged.
- Server: additive authenticated daily-summary, complete live ordinary transaction scope, shared contribution rules and IANA day grouping. Refunds remain income. No salary/transfer mixing.
- Existing query generation guards isolate rows/counts/daily statistics; only same-query refresh keeps visibly identified previous results.

## Validation
Backend delegated checks completed and reported with all jobs collected:
- `pnpm --filter @jizhang/server test`: 33 files / 735 tests PASS.
- Final `pnpm --filter @jizhang/server test -- test/transactions.test.ts`: 82 tests PASS.
- `pnpm --filter @jizhang/server typecheck` and `lint`: PASS.
- `pnpm --filter @jizhang/shared test`: 7 files / 187 tests PASS.
- Scoped backend `git diff --check`: PASS.
- Initial new-test helper inference issue found by typecheck was fixed before final rerun.
Android helper final targeted gate (delegated): `:app:testDebugUnitTest --tests com.yansuu1.jizhang.ui.TransactionMonthLoaderTest --no-daemon` PASS, 24 tests including timezone normalization.
Parent full gate `gradlew.bat :app:testDebugUnitTest :app:assembleDebug :app:lintDebug --no-daemon`: PASS, BUILD SUCCESSFUL in 2m37s, exit 0; background job collected. Lint XML: 0 errors / 43 warnings / 21 information. Warnings are launcher/resource/manifest/modifier issues in preexisting source; no entries in the changed bill UI, new loader, repository or ListChoice file. Do not claim zero warnings or reuse the historical 9-warning count. Parent parsed actual Gradle XML: 21 suites / 243 tests / 0 failures / 0 errors / 0 skipped (new 24 loader + 4 loader/coordinator integration tests). Integration tests establish production loader/coordinator contracts, not real Compose window execution or inline summary publication.
APK 22,212,245 bytes, SHA-256 `35fbfe8bdf75e82c4deb9c4d369224a051b2aa405380f01b123175b1ca73f9f7`.
Independent scoped review found optional statistics blocked rows; fixed by publishing complete rows first, then generation-owned summary. Review also found Java whole-hour fixed-offset zone IDs incompatible with Intl; normalizing these to equivalent fixed IANA Etc/GMT zones. Fractional fixed-offset custom IDs remain explicitly unsupported (summary unavailable; named IANA fractional zones are supported). Device acceptance remains pending.

## Runtime / rollout
No production deployment has been performed. Server API must be deployed before production can show daily totals. On old servers the monthly list remains usable and daily totals show unavailable, never client sums or fake zero.
`adb devices` on 2026-10-22 returned an empty device list. No device acceptance or installation this round. Narrow-screen/large-font header and daily labels, account selection, rapid query switching, detail overlay scroll restoration and real production API remain device checks pending.

## Limits
Complete-month loading validates page counts, duplicate IDs and stable totals but is not an atomic multi-request snapshot; simultaneous edits preserving counts cannot be detected without a revisioned API. Daily summary count matching rejects visibly changed day populations, not all concurrent amount edits. Existing network cancellation is cooperative at the coroutine boundary, not guaranteed immediate socket cancellation.
