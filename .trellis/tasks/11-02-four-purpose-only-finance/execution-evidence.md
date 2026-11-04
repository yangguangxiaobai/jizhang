# Implementation execution evidence

## Scope and baseline

- The user authorized implementation after the planning-only handoff. The Trellis task was activated for execution; the earlier PRD/design statements about planning describe the prior delivery, not the current authorization.
- HEAD at baseline: `bde9a18da5ef33567f52fb544f181479cd4aedf3` on `main` (ahead by 8). The pre-existing worktree contained 363 changed/untracked entries; preserve them. No reset, clean, commit, production database migration, device testing, or deployment was performed.
- The P01 audit anchors and recorded results were rechecked against `review.md` and `research/evidence-2026-11-03/`.

## P01 — test-only baseline gates

- Before repair, `pnpm --filter @jizhang/server lint` failed with the unused final `rev` assignment in `test/financial-goals.test.ts`; `pnpm --filter @jizhang/server typecheck` failed because `modules[0]` could be undefined in `test/salary-operation-replay-regression.test.ts`.
- Removed only the unused assignment while retaining the awaited operation; narrowed the first module while retaining the length assertion. Both test files were already untracked, so Git cannot display their pre-existing baseline as a diff.
- After repair, server lint and server typecheck both passed. `pnpm --filter @jizhang/server exec vitest run test/financial-goals.test.ts test/salary-operation-replay-regression.test.ts` passed: 2 files, 39 tests.
- No full workspace suite was rerun for this milestone. Review was limited to the touched snippets and existing assertions; no changes were staged or committed.

## P02 — shared fund arithmetic

- Added the pure four-purpose fund allocation/projection contract and tests. It reuses the existing largest-remainder allocator, uses BigInt for projection totals, retains negative balances and reports unresolved coverage; no server or Android dependency was added.
- Test-first targeted run: 10 of 13 tests failed because exports were missing; three throw-only tests passed vacuously. The implementer subsequently ran all shared tests: 13 files, 404 passed, before the additional review regression below.
- Review found that preserved split audit rows for a deleted or reclassified refund incorrectly made current coverage incomplete. A new regression reproduced the failure before repair. After repair, targeted fund/execution tests passed: 2 files, 84 tests; shared lint, typecheck and build also passed.
- The projection requires the caller to supply a complete, consistent source snapshot and lifecycle-validated split facts. Grant membership and source tokens remain responsibilities of later storage/service work.

## P03/P06 review notes

- A confirmed legacy period is eligible only when its active revision, complete salary membership, source snapshots and exact aggregate targets are verified. Per-salary rounding must not replace the original aggregate targets; mapping revision zero is not frozen mapping evidence. Testing and migration must use isolated fixtures only.
- The existing scoped `FinancialPlanningRefundService.assessRefundSets` discovers competitors by original ID but does not necessarily load every sibling of a newly discovered competing refund. P06 must assess complete relevant refund sets and cross-original caps in one snapshot before any activity filtering, with a cross-original competitor regression; a per-split validity flag alone is not proof of whole-set validity.

## Remaining milestones

Current state: P01 steps 1–4 and P02/P03 are complete; P01 step 5 remains unchecked. P04 is underway; P05–P11 remain pending. Record fresh commands, results and limitations here as work progresses; prior audit test counts are not integrated acceptance evidence. The first-implementation notes below are historical and superseded by the later P03 completion section.

## P03 — first implementation evidence and independent review

- P03 is **not accepted**; hardening is in progress. The initial test-first migration run failed because the migration module was missing.
- The subsequent isolated run comprised 19 fund migration tests plus selected in-memory migration regressions: 30 passed and 22 were intentionally skipped. The skipped tests did not run; this result is not integrated acceptance evidence.
- Shared build, server lint and server typecheck passed. Migration 021 was registered and is configured to auto-run on application startup; no real database or application was started for this evidence.
- Independent review found invalid inactive/orphan mapping evidence and corrupt configuration/default-timezone issues. Another agent is addressing these findings; no completed fix or successful revalidation is claimed here.
- Downstream P04 must establish whole-refund-graph and cross-cap validity and cover issue/unknown salary and deleted cases. This complements the P03/P06 review note above; individual split validity is not sufficient evidence of whole-set validity.
- Downstream P05 needs a durable latch for source edit → revert and delete → restore transitions; a source token alone is insufficient.

## P03 — isolated completion and independent rerun

- P03 isolated migration/backfill and independent rerun completed: 47/47 in-memory tests passed. Server lint/typecheck and shared build passed. The earlier 30 passed / 22 intentionally skipped selection above remains historical evidence, not the 47-test run or integrated acceptance.
- Reviewer-detected stale/inactive/orphan mappings, invalid configs/timezones, premature claims on rerun, deleted coverage, malformed frozen windows and zero salary were regression-tested and repaired. The lead reviewed P03 sources and the focused existing `migrate.ts`/AI-organization test diff.
- After the shared refund fix, the full shared suite passed 405/405 and shared lint/typecheck passed. This is shared-layer evidence, not complete P04–P11 acceptance.
- No real database migration, application startup, deployment, device test or commit was performed. Migration registration can run on startup, so startup and any real database operation remain separate from this isolated evidence.

## P04 — partial implementation (not complete)

Implemented (source + focused in-memory tests):
- `GET /api/v1/financial-funds/capabilities` reports purposes, integer-cent rule, `accountingPeriods: false`, `moduleBudgets: false`, `legacyBudgetsReadOnly: true` and honest `features` flags.
- `GET/PUT /api/v1/financial-funds/config`: prospective only, virtual default with injected server timezone when nothing is saved, 503 when a `config`/`fund-config` `invalid-current-config` issue is open or the latest saved row is unreadable. PUT carries `operationId` + `expectedRevision` and runs replay-before-CAS with the authenticated actor; grants are never rewritten.
- `GET /api/v1/financial-funds/summary`: one SQLite read snapshot over the full lifetime fact set, shared `projectFundBalances`, deterministic content-based `snapshotToken`, `coverage` with `unknownUnallocatedSalaryCount`. A requested month window returns identical balances and token.
- `GET /api/v1/financial-funds/migration-issues`: bounded `limit` (default 50, max 100) / `offset`, rejects unsafe, fractional, negative and repeated query values.
- `POST /api/v1/financial-funds/grants/review`: reconfirmation of one existing `legacy-group` grant only, with grant-revision CAS, frozen-ratio equality, unique source tokens, exact actor-scoped replay, rollback that leaves the key reusable, and `review-required` rows requiring explicit review.

Verification: `test/fund-budget-api.test.ts` 14/14, `test/fund-budget-summary.test.ts` 5/5, `test/fund-budget-review.test.ts` 6/6, `test/fund-budget-migration.test.ts` 47/47; server typecheck and lint pass. In-memory databases only — no application startup, real database, migration run, device test or commit.

Not implemented, therefore P04 is incomplete: the `activity` endpoint (its complete refund-graph attribution belongs with P06) and unclaimed single-salary review. Both are reported as `false` in `capabilities.features`; no DTO is frozen for them. `fundGrantNeedsReview` still compares current facts only, so P05's persistent edit→revert/delete→restore latch remains outstanding.

## P04/P05 follow-through

- P04 must distinguish virtual config using an injected valid timezone from corrupt persisted config/timezones, and distinguish live coverage from archival issues for deleted sources. Evaluate the complete relevant refund graph and whole-set cross-original caps in one snapshot before activity filtering; a per-split flag alone is insufficient. Preserve exact actor/server ownership and full request identity on operation replay.
- P05 must persist a source-change latch for legacy aggregate edit → revert and delete → restore; comparing current tokens alone does not preserve the intervening change and cannot clear review. Exact actor-scoped replay remains required.

## Parallel research notes — read-only, not implementation or device verification

- Android: `clients/android/app/src/main/java/com/yansuu1/jizhang/net/ApiRequestOwner.kt:7–36` uses monotonically increasing session generations, including A→B→A. `ui/SalaryOperationReplay.kt:184–250,294–295` looks up a stored operation and replays the exact request on authenticated 404; recheck actor/server identity and generation around lookup/replay and application of results. `ui/MonthlyPlanWorkspace.kt:79–88,117–175` has the previously audited shared plan/goal owner and outer leave-guard concern; see `research/android-repair-audit.md` A01/A03 for scope and limits.
- P07: `packages/server/src/services/ai-spending-organization-service.ts:769–917,941–967` includes template apply and conditional undo writers; `packages/server/src/db/seed.ts:41–47,62–67,93–99` seeds a template on boot. Account for both paths when retiring fresh template generation without damaging historical replay.
- P10: `packages/server/src/services/portability-service.ts:441–458,512–514` currently requires every `TRANSACTION_COLUMNS` header and reports record index + 2 as a line. Keep the new purpose column optional for legacy CSV while validating existing required columns. `packages/shared/src/csv.ts:56–60,80–80,111–125,189–207` supports quoted multiline fields and filters blank records without preserving physical source positions, so record index is not always the physical line; define and test accurate line evidence rather than assume equivalence.
- P10: direct SQL transaction inserts in `packages/server/src/services/portability-service.ts:606,1018` and `packages/server/src/services/import-batch-service.ts:2825` bypass ordinary service entry points; all such portability/import and other alternate writers need canonical purpose persistence or explicit unassigned status, without inference from current mappings.

## 2026-11-04 integration round — verified results

Commands were run in this worktree, against in-memory databases. No application startup, real database, deployment, commit or device test was performed.

- `pnpm --filter @jizhang/server exec vitest run` (whole package): **58 files, 1176 tests passed**.
- `pnpm --filter @jizhang/server run lint` and `run typecheck`: **pass**.
- `pnpm --filter @jizhang/shared run build` and `exec vitest run`: **build pass, 13 files / 405 tests passed**.

### Fixes landed in this round

- **P04 review replay response** (`financial-fund-service.ts`, `financial-fund-review.ts`): a review operation now stores the *complete HTTP body* `{contractVersion:1, grant}` so a lost response recovers byte-for-byte, while records written by the older build (bare grant) replay unchanged and are never rewritten in place. `my` earlier edits had briefly left a duplicate `grant` binding; that is fixed and `tsc` is clean.
- **P04 operation lookup ownership** (`routes/financial-planning.ts`, `financial-planning-service.ts`): `GET /financial-planning/operations/:operationId` now resolves the *session* actor (`requireUserId`) instead of the first `users` row. `test/financial-operation-ownership.test.ts` pins the two-account case (stale row sorts first; own key 200, foreign key 404, unknown key 404, anonymous 401) and that the service default still resolves the database actor for internal callers.
- **Refund graph completeness** (`financial-planning-refunds.ts`): `assessRefundSets` now traverses the connected refund/original component before assessing any set, so a competing refund's siblings are loaded before capacity math; caps are computed against one snapshot (no order-dependent invalidation); each valid set is additionally checked against its latest confirmed audit (`revision`, `splits_json`, `facts_json`) and against the refund's own total; `refundReview`/`listRefunds`/`collectExecution` run inside one SQLite read snapshot; `collectExecution` assesses the whole graph but only emits facts for the period's own originals; `putRefundSplits` re-assesses after replacement and rolls back rather than returning 200 for an already-conflicting set. New regressions: `loads every sibling of a competing refund…`, `evaluates overlapping over-cap originals against the same set snapshot`, `rejects tampered confirmed splits that exceed the refund…`.
- **Legacy bill-purpose entry** (`financial-planning-refunds.ts` + `financial-fund-purpose-store.ts`): `PUT bill-purposes` writes the canonical four-purpose fact in the same IMMEDIATE transaction, enforces the anti-downgrade rule for `explicit` sources, reads canonical revision/status/source in the GET view, and keeps the legacy revision/token contract. Replay lookup moved inside the operation transaction so an already-committed answer survives later edits/deletes.
- **P09 backend defects (F01/F02)**: keyed operation lookup now precedes current-index/last-file validation for removed-file retries, and duplicate renamed category suggestions count real entities. Regressions `removedFileRetryInLargerBatchReturnsOriginalOutcome` etc. pass.
- **P07 (partial)**: `salary.create` and `budget.template.apply` are removed from the assistant tool allowlist and registry, so AI can no longer prepare/confirm module-allocation salary writes or template application; the corresponding tests now assert the unknown-tool path with zero writes. **Not done**: the HTTP routes for template CRUD, salary allocation replacement, cycle-start setting and period preview/confirm/reconcile are still active (see below).

### Test-fixture migration required by the retired salary contract

Retiring fresh legacy salary writes broke tests that merely used `POST /api/v1/salaries` as a fixture. They now seed the same historical facts directly through the new shared helper `packages/server/test/support/historical-salary-fixture.ts` (`seedHistoricalSalary`), which is the only implementation of that fixture:

- `stats.test.ts` (13), `transfers.test.ts` (2), `recurring.test.ts` (1), `platform-import.test.ts` (1)
- `monthly-plan.test.ts` (11), `financial-planning-existing-salary.test.ts` (8)
- `budget.test.ts` (39): payment-engine/historical-cycle cases now seed salary+module snapshot; the tests whose subject *was* the retired write now assert `410 FEATURE_RETIRED` with zero rows, and one asserts a committed legacy operation still replays byte-for-byte.
- `assistant.test.ts`, `ai.test.ts`, `financial-plan.test.ts`, `core-finance-repair-integration.test.ts`

### Still open (not claimed as complete)

- **P07 HTTP retirement**: template create/patch/delete/default/apply-current, `PUT /salaries/:id/allocations`, `PUT /settings` (cycle start day) and `POST /financial-planning/periods/preview|confirm|reconcile` are still live writers. They can still **regenerate module budget facts** for historical salaries, which is the P07 risk. Tests in `budget.test.ts`, `financial-planning-*` and `monthly-plan.test.ts` still drive these paths, so retiring them is a coordinated test migration, not a mechanical 410.
- **P04 activity endpoint** remains unimplemented (`capabilities.features.activity === false`).
- **P06 purpose filters** (list/summary/drilldown/stats sharing one purpose/unassigned scope) are unimplemented; the canonical column and transaction PATCH exist.
- **P08 Android** fund workspace/UI integration is not implemented. `clients/android/README.md` was updated (2026-11-04) to record that the current Android build still sends the legacy salary contract and therefore gets 410 from this server; that is a real compatibility gap, not a documentation gap.
- **P10** CSV `fundPurpose` round-trip and alternate-writer canonical persistence are not implemented.
- Salary **restore** has no existing entry point and remains unimplemented; unclaimed historical salaries cannot yet be keyed-deleted (requires a source CAS design).
- No device, deployment or production-migration evidence exists for any of the above.

