# Execution plan

## Review gate
User explicitly approved final plan and implementation (开始). Implement agent loaded curated context and layer specs; source-only baseline snapshot preserved unrelated work. Automated implementation/checks complete; device/live-provider acceptance remains open as recorded in implementation-status.md.

## Steps
- [x] Snapshot affected working-tree diffs; read provider, assistant lifecycle, shared parser, portability, Android repository/state/UI and affected README entries. Do not overwrite unrelated work.
- [x] Add representative refund/source fixtures; implement independent refund facts and refunded-original-expense eligibility without inventing amounts/movements.
- [x] Add bounded provider analysis and structured normalizer, valid-ID/category restrictions, honest failure/retry semantics. Preserve deterministic confirmation and no-write analysis.
- [x] Extend assistant review contracts for category IDs and editable notes, including explicit note clearing, strict category mode and refund metadata. Revalidate selection/edits/digest/fingerprint on confirm; retain legacy import compatibility.
- [x] Wire Android recommendations/reasons/blockers, existing-category picker, note editing, selection and second review. Preserve request gates and explicit selected-only writes.
- [x] Add shared parser tests, provider mocks and invalid-output tests, assistant/API tests for no writes before approval, correct reviewed persistence, category-independent refund flags, stale-file/category rejection, duplicate confirmation and rollback. Add Android pure state/selection/edit tests and manual device checklist.
- [x] Update clients/android/README.md affected stable IDs and gaps; capture new executable contracts in relevant specs.
- [x] Run checks, inspect full scoped diff, document baseline failures and evidence levels. Present validation results; do not deploy or commit unrelated work.

## Validation commands
- `pnpm --filter @jizhang/shared build`
- `pnpm --filter @jizhang/shared test`
- `pnpm --filter @jizhang/shared lint`
- `pnpm --filter @jizhang/shared typecheck`
- `pnpm --filter @jizhang/server test`
- `pnpm --filter @jizhang/server lint`
- `pnpm --filter @jizhang/server typecheck`
- `pnpm --filter @jizhang/server build`
- From clients/android: `./gradlew.bat testDebugUnitTest lintDebug assembleDebug` (invoke with platform-compatible shell).
- `git diff --check` and focused change review.

## Manual acceptance (not implied by build)
Upload a real-format fixture, observe AI analysis and reasons; review refunded expense + actual partial/full refund; change categories and notes, reverse recommendation, confirm, inspect saved ledger. Exercise missing provider, invalid AI response, 100-selection bound, source mismatch and uncertain write refresh. Device/real-provider tests require available environment; do not use production writes implicitly.

## Rollback boundaries
Parser/shared fixture change; provider integration; additive review contracts; Android UI. Revert only task-owned hunks. Keep original-file/dedup safeguards at every boundary.
