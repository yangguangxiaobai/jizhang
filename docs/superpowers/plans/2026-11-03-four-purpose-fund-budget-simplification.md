# Continuous Four-Purpose Fund Budget Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> Historical planning handoff: implementation required separate authorization. The user subsequently authorized implementation on 2026-11-03; the Trellis task is now in progress. P01 checks 1–4, P02 and P03 are recorded complete; P04 is underway and P05–P11 are pending. P01's commit-related check remains unchecked. Checkboxes below reflect recorded execution progress, with command evidence in the task's `execution-evidence.md`. Production migration, deployment and commits are not authorized.

**Goal:** Replace accounting cycles and module fund budgets with four-purpose salary allocation and continuous fund balances, keeping direct purpose/tag/note bookkeeping and preserving historical evidence.

**Architecture:** Keep Kotlin/Compose, Fastify, SQLite and shared calculations. Add exact four-purpose grant/purpose facts beside legacy storage, derive balances from authoritative salary/ledger/refund facts, and retire period/module mutations from every active entry point. Migrate only verified unique historical decisions and show unresolved coverage explicitly.

**Tech Stack:** Existing Kotlin/Compose/coroutines/OkHttp Android toolchain; TypeScript ESM/Fastify/better-sqlite3/Vitest; Node.js >=22.12.0; pnpm 10.12.2; existing Android Gradle/JUnit/MockWebServer.

**Spec:** [PRD](../../../.trellis/tasks/11-02-four-purpose-only-finance/prd.md), [technical design](../../../.trellis/tasks/11-02-four-purpose-only-finance/design.md), [prior repair audit](../../../.trellis/tasks/11-02-four-purpose-only-finance/review.md), [migration contract](../../../.trellis/tasks/11-02-four-purpose-only-finance/research/fund-budget-contract.md). The user confirmed proportional salary allocation and cumulative purpose balances on 2026-11-03. The original instruction was to create this plan only; implementation was subsequently authorized on 2026-11-03.

## Global Constraints

- Preserve the existing dirty worktree and audit baseline. No reset/clean, wholesale replacement, empty-HEAD worktree or unrelated commit.
- Money is integer cents with absolute safe-integer bound 9,007,199,254,740,991; intermediate arithmetic uses BigInt. Time is epoch milliseconds; server date windows are [from,to).
- Purpose order is growth/reserve/essentials/joy. Ratios are integer bps, 0..10000 each and sum 10000. Suggested initial split is 2500/1500/5000/1000; retain existing valid saved ratios.
- Configuration affects future grants. No month change/start-day setting creates a period or resets a balance. Negative balances show overspending and do not block real bookkeeping.
- Ordinary expense stays gross, refunds stay income, salary is not duplicated into a normal income transaction, transfers and manual goal entries do not generate fund deltas.
- A confirmed refund credits original purposes only. Preserve split caps, revision checks, whole-set invalidation and no automatic reactivation after source restoration.
- Add a new migration after 020; never edit applied migrations 019/020 or silently assign old salaries using current ratios. Preserve verified aggregate historical targets and unique salary membership.
- Exact full request, operationId, expected revision and server/user ownership survive unknown writes. Query/replay the original operation; never make a replacement key after a lost response.
- Android renders server/shared totals. No new ORM, cache, offline sync, workflow framework or dependency. Keep changes focused; retired Web/PWA remains outside scope.
- Documentation is English and user-facing strings are Chinese. Update affected Android stable IDs, API coverage and change logs; advance only source-rechecked audit sections.
- Local source/JVM/lint/build evidence, real device checks and production deployment are recorded separately. This document executes none of them.

## Review Focus

| Risk/input | Required behavior | Owning test |
|---|---|---|
| Two historic 1-cent salaries whose aggregate rounding differs from individual rounding | Preserve the original aggregate four targets and claim each salary once. | P03 `verifiedLegacyGroupKeepsAggregateTargets` |
| A second salary after the tenth or a month change | Add funds once with no new period or reset; selected month affects activity only. | P04/P05 `crossMonthFundingCarriesBalances` |
| Salary/purpose write commits but response is lost, then the process or session changes | Recover exact original outcome; no new salary/grant or another actor draft update. | P05/P08 `lostResponseReplaysOneFundGrant`, `staleSessionCannotApplyFundReply` |
| A refund across months has an edited/deleted original or an unresolved purpose | Preserve gross ledger semantics; valid splits alone credit funds and unresolved status is visible. | P06 `refundCreditsOnceAcrossMonths`, `invalidSplitNeverCreditsFund` |
| Current ratios differ from unconfirmed/stale history, or category mappings conflict | Keep history unallocated/unassigned with evidence rather than inventing complete balances. | P03/P04 `unknownHistoryShowsIncompleteCoverage` |

## File responsibility and order

| Responsibility | Files | Owner / execution stage |
|---|---|---|
| Pure fund contract and arithmetic | `packages/shared/src/fund-budget.ts`, `src/index.ts`, `test/fund-budget.test.ts` | P02 |
| Additive fund storage and migration | `packages/server/src/db/migrations/021-four-purpose-funds.ts` (next available number), `db/migrate.ts`, new `services/financial-fund-store.ts` | P03 |
| Fund API, summary and historical source review | new `services/financial-fund-service.ts`, new `routes/financial-funds.ts`, `src/app.ts` | P04 |
| Salary allocation and lifecycle | `salary-service.ts`, `routes/budget.ts`, salary replay tests | P05, then P07; serial shared files |
| Four-purpose transactions, filters and refunds | `transaction-service.ts`, `transaction-types.ts`, `financial-source-lifecycle.ts`, `financial-planning-refunds.ts`, `routes/transactions.ts`, `stats-service.ts`, `routes/stats.ts` | P06 |
| Module/period/AI retirement | `template-service.ts`, `budget-overview-service.ts`, `monthly-plan-service.ts`, `monthly-evaluation-service.ts`, `ai-spending-organization-service.ts`, `assistant-tool-registry.ts`, `routes/budget.ts`, `routes/financial-planning.ts`, related AI routes | P07 |
| Native fund workflow | new `repo/FundBudgetModels.kt`, `repo/FundBudgetRepository.kt`, `ui/FundBudgetWorkspace.kt`, `ui/FundBudgetReadState.kt`; existing `MainShell.kt`, `DashboardTab.kt`, `SalarySheet.kt`, `TransactionEditSheet.kt`, helpers/detail/filter/stats/MyTab | P08 |
| Retained prior audit defects | `import-batch-service.ts`, `ui/feature/assistant/AssistantBatchImportWorkspace.kt`, `ui/ManualGoalProgressWorkspace.kt`, read/leave helpers and their tests | P09 after P08 |
| Data portability and alternative writers | `portability-service.ts`, `import-batch-service.ts`, `bill-import-analysis.ts`, `recurring-service.ts`, AI transaction writers, shared CSV and native data UI | P10; serial with P06/P09 where shared files overlap |
| Catalogue/specs/final acceptance | `clients/android/README.md`, affected `.trellis/spec/backend/` and `frontend/` docs, task evidence | P11; one coordinator owns documentation |

All Android paths above are under `clients/android/app/src/main/java/com/yansuu1/jizhang/`; server service/route paths are under `packages/server/src/`. The file list was proposed during planning; some source now exists, while later stages remain pending. Consult the checklist and execution evidence for actual progress. Stage dependencies: P01 -> P02 -> P03 -> P04 -> P05 -> P06 -> P07 -> P08 -> P09 -> P10 -> P11. A later executor may parallelize disjoint tests/UI preparation only after contracts are fixed; shared files never have simultaneous writers.

## Proposed interfaces

```ts
export type FundPurpose = FinancialPurpose;
export interface FundAmounts { growth: number; reserve: number; essentials: number; joy: number }
export interface FundRatiosBps { growth: number; reserve: number; essentials: number; joy: number }
export function allocateFundIncomeCents(incomeCents: number, ratiosBps: FundRatiosBps): FundAmounts;
export function projectFundBalances(input: FundProjectionInput): FundProjection;
export class FinancialFundService {
  getConfig(): FundConfigView;
  updateConfig(input: FundConfigWrite): FundConfigView;
  getSummary(query?: FundActivityWindow): FundSummaryView;
  listActivity(query: FundActivityQuery): FundActivityPage;
  reviewGrant(input: FundGrantReviewWrite): FundGrantView;
}
```

All proposed DTOs are defined once with P02/P04: `FundConfigWrite` carries ratiosBps/timeZone/operationId/expectedRevision; `FundGrantReviewWrite` carries grantId or unclaimed source IDs, source tokens, explicit ratios, operationId and expectedRevision. `FundSummaryView` has contractVersion=1, asOf, balances, funded/income/grossSpent/refunded totals, optional filtered activity, coverage and snapshotToken. `FundActivityQuery` uses purpose/from/to/tags/account/category/text plus bounded pagination (default 50, maximum 100). The optional activity window never resets or limits lifetime balance carryover.

New canonical transaction fields are `fundPurpose`, `fundPurposeRevision`, `fundPurposeStatus` and `fundPurposeSource`. Legacy `financialPurpose` keeps its existing essentials/joy contract. New salary input carries contractVersion=1, expectedFundConfigRevision and operationId, and returns a fundGrant without requiring a module template.

## P01: Establish the executable baseline and close test-only gates

**Files:** Modify `packages/server/test/financial-goals.test.ts` and `test/salary-operation-replay-regression.test.ts`; read prior audit evidence.

**Consumes:** R1 and prior F03/F04. **Produces:** a reproducible lint/typecheck baseline without a finance runtime change.

- [x] Step 1: Record current HEAD/status and read the existing audit logs. Recheck each cited anchor against the current worktree; do not repeat already valid checks merely to recreate evidence.
- [x] Step 2: Run `pnpm --filter @jizhang/server lint` and `pnpm --filter @jizhang/server typecheck`. Confirm the unused final `rev` assignment and possibly undefined `modules[0]` errors if still present.
- [x] Step 3: Remove only the unused final assignment; explicitly narrow/assert the first module before reading it. Keep test assertions and production behavior intact.
- [x] Step 4: Re-run those two gates and the two affected Vitest files. Record results and any new baseline failure instead of hiding it.
- [ ] Step 5: Review the focused diff; commit only approved task hunks if execution includes commits. Never stage the whole dirty worktree.

## P02: Define shared fund types and exact arithmetic

**Files:** Create `packages/shared/src/fund-budget.ts`, `packages/shared/test/fund-budget.test.ts`; modify `packages/shared/src/index.ts`.

**Consumes:** R4/R8–R11 and existing FinancialPurpose/allocator. **Produces:** the shared interfaces above, safe four-purpose validation and pure projection.

- [x] Step 1: Add tests `salaryAllocationConservesCents`, `oneCentUsesFixedLargestRemainder`, `invalidRatioSumRejects`, `unsafeMoneyRejects`, `continuousProjectionCreditsRefundOnce`, `negativePurposeBalanceIsVisible`. Pin exact expected values:

```ts
const ratiosBps = { growth: 2500, reserve: 1500, essentials: 5000, joy: 1000 };
expect(allocateFundIncomeCents(100000, ratiosBps)).toEqual({
  growth: 25000, reserve: 15000, essentials: 50000, joy: 10000,
});
expect(allocateFundIncomeCents(1, ratiosBps)).toEqual({
  growth: 0, reserve: 0, essentials: 1, joy: 0,
});
```

- [x] Step 2: Run `pnpm --filter @jizhang/shared exec vitest run test/fund-budget.test.ts`; expect missing exports or failing assertions before implementation.
- [x] Step 3: Implement the declared types/functions by reusing the existing allocator, validating integer bps and using BigInt intermediate totals. Projection credits ordinary non-refund income, subtracts gross expenses and credits valid split facts once; transfers/goals are absent from deltas.
- [x] Step 4: Run targeted tests, shared lint/typecheck and shared build. Verify no IO/imported server dependency or Android calculator was added.
- [x] Step 5: Review and checkpoint the shared contract before downstream tasks.

## P03: Add fund storage and migrate verified history once

**Files:** Create next migration `packages/server/src/db/migrations/021-four-purpose-funds.ts`, `services/financial-fund-store.ts`, `test/fund-budget-migration.test.ts`; modify migration registration in `db/migrate.ts`.

**Consumes:** P02, R5/R12 and `research/fund-budget-contract.md`. **Produces:** config/grant/revision/source/purpose/migration-issue storage with unique source ownership and unchanged legacy ledger facts.

- [x] Step 1: Build isolated old-schema fixtures and write `verifiedLegacyGroupKeepsAggregateTargets`, `migrationTwiceClaimsSalaryOnce`, `inactiveRevisionNeverAddsFunding`, `staleOrUnconfirmedSalaryStaysUnallocated`, `overlappingConflictingMappingsRemainUnassigned`, `migrationPreservesLedgerAccountAndGoalFacts`.
- [x] Step 2: Pin the rounding counterexample: two 1-cent salaries at 25/15/50/10 have original combined targets growth=1/reserve=0/essentials=1/joy=0, not the independently rounded essentials=2. Run the migration test before implementation and observe failure.
- [x] Step 3: Create the additive tables and unique origin/salary membership/revision constraints from the design. Register the next free migration number; leave 019/020 and old purpose constraints intact.
- [x] Step 4: Import only current verified active group snapshots, preserving their aggregate targets and exact source tokens. Copy explicit purpose evidence or unique frozen mapping; record all other sources as migration issues.
- [x] Step 5: Run `pnpm --filter @jizhang/shared build`, then `pnpm --filter @jizhang/server exec vitest run test/fund-budget-migration.test.ts`. Apply migration twice in the fixture; assert unchanged salary/transaction/account/goal facts and no duplicate claims.
- [x] Step 6: Review source ownership and arithmetic before any later real-database migration. Save/restore test fixtures only; production migration is a separately authorized operation.

P03 completion is limited to isolated fixtures and source review: 47/47 in-memory migration tests passed on independent rerun. No real DB migration, application startup, deployment, device test or commit was performed; see execution evidence for regression repairs and historical results.

## P04: Expose continuous balances, config and historical source review

**Files:** Create `services/financial-fund-service.ts`, `routes/financial-funds.ts`, `test/fund-budget-api.test.ts`; modify `app.ts` registration and shared DTO declarations as needed.

**Consumes:** P02/P03. **Produces:** the declared FinancialFundService interfaces and authenticated capabilities/config/summary/activity/issues/review endpoints in the design.

P04 partial progress: `GET/PUT config`, `GET capabilities`, `GET summary`, `GET migration-issues` and `POST grants/review` (existing legacy aggregate reconfirmation only) are implemented with 14/14 focused in-memory API tests plus 47/47 migration, 5/5 summary and 6/6 review tests; server typecheck and lint pass. **Not implemented:** the activity endpoint (its complete refund-graph attribution depends on P06) and unclaimed-single-salary review. `capabilities.features` reports both as `false` instead of advertising broken features, and `config`/`fund-config` corruption returns 503 rather than a fabricated default.

- [ ] Step 1: Write `crossMonthFundingCarriesBalances`, `activityWindowDoesNotResetBalance`, `unknownHistoryShowsIncompleteCoverage`, `configRevisionConflictPreservesOldGrant`, `historicSourceReviewClaimsOnce`, `activityPaginationIsBounded`, `legacyGroupSourceEditRequiresReview`. (Cross-month, month-window independence, incomplete coverage, config CAS, exact review replay and bounded issue pagination are covered; activity-specific pagination waits on the activity endpoint.)
- [x] Step 2: Assert two 100,000-cent grants with essentials expense=12,000 and confirmed refund=3,000 yield 50,000/30,000/91,000/20,000. A November-only activity request keeps the same current balances. Empty supported history may be complete zero; unsupported/error/incomplete history may not impersonate it.
- [ ] Step 3: Implement snapshot-consistent server reads and exact shared totals. Return coverage, current asOf and snapshotToken. Grant/source review uses expected revisions, full operation identity and unique source membership. (Summary/review done; activity read not done.)
- [ ] Step 4: Preserve a legacy combined grant as one labelled historical funding event at its original confirmation timestamp with member source dates; do not fabricate per-salary historical purpose flow. New grants use salary dates. (Belongs to the unimplemented activity endpoint.)
- [x] Step 5: Run the API tests and server typecheck; verify authentication, error shape, 409 revision conflicts, bounded pagination and no cycle fields in new config.
- [ ] Step 6: Freeze request/DTO names for Android and subsequent writers. (Config/summary/issues/review DTO names are fixed; the activity DTO is not yet frozen.)

Execution review obligations: distinguish a virtual default config using an injected valid timezone from persisted corrupt configuration/timezones; distinguish unresolved live coverage from archival issues on deleted sources. Assess the complete relevant refund graph and whole-set cross-original caps before activity filtering. Keyed replay must retain the exact request and actor/server identity; do not let a different actor replay it.

## P05: Replace salary module allocation with atomic four-purpose funding

**Files:** Modify `services/salary-service.ts`, `routes/budget.ts`, operation/lifecycle integration; create `test/salary-fund-budget.test.ts`; extend existing salary replay tests.

**Consumes:** P03/P04 and R9/R15. **Produces:** new salary create/edit/delete/restoration behavior that writes authoritative salary/account facts and its fund grant atomically.

- [ ] Step 1: Add `salaryNeedsNoModuleTemplate`, `lostResponseReplaysOneFundGrant`, `newRatiosDoNotRewriteOldGrant`, `salaryEditUsesFrozenRatios`, `salaryDeleteRestoreUpdatesFundsOnce`, `legacyUnkeyedPendingNeverAutoPosts`.
- [ ] Step 2: Use a contractVersion=1 create with amountCents=100000, a valid account/date/note, expectedFundConfigRevision and operationId; omit templates/modules/period IDs. Run the targeted tests to observe the existing module requirement failing.
- [ ] Step 3: Add the new path with source/grant/config revision checks inside the same transaction. A changed amount recomputes a single-salary grant with its saved ratios. Source changes on imported aggregate grants produce explicit review state.
- [ ] Step 4: Return the salary with fundGrant. Preserve exact committed legacy replay responses as history; reject fresh retired module-write requests and never generate a new key for ambiguous old pending salary writes.
- [ ] Step 5: Run salary fund/replay tests and account balance tests. Assert one salary affects ordinary income/accounts once and one grant funds four purposes once.
- [ ] Step 6: Review/checkpoint before retiring the old active allocation route in P07.

P05 must persist a source-change latch for imported legacy aggregate grants across edit → revert and delete → restore; source-token equality alone cannot clear the required review. Preserve exact actor-scoped operation identity and original request on replay.

## P06: Connect four-purpose ledger writes, refunds and filters

**Files:** Modify transaction service/types/input/row mapping, fund store, transaction/stats routes/services and period-free fund refund resolution; create `test/transaction-fund-purpose.test.ts`, `test/fund-budget-refunds.test.ts`, `test/fund-purpose-query.test.ts`.

**Consumes:** P02–P05. **Produces:** canonical fundPurpose persistence/revision/provenance plus consistent list/summary/drilldown and refund fund deltas.

- [ ] Step 1: Parameterize create/read/PATCH tests across all four purposes. Test omitted PATCH preserves purpose, explicit clear yields visible unassigned status, old/new contradictory fields reject, and changing income into refund removes its ordinary fund credit.
- [ ] Step 2: Add `refundCreditsOnceAcrossMonths`, `invalidSplitNeverCreditsFund`, `purposeEditMovesOriginalAndConfirmedRefund`, `refundRestoreRequiresReconfirmation`, `listSummaryDrilldownSharePurposeScope`, `purposeJoinNeverDuplicatesRows`.
- [ ] Step 3: Run new test files to observe absent four-purpose fields/filters. Preserve legacy two-purpose fields as defined; write new canonical facts and events atomically with transactions.
- [ ] Step 4: Implement a shared server query scope for purpose/unassigned + existing tag/account/category/date/text filters. Reuse it for list, summary, statistics and drilldown; keep one purpose fact per transaction.
- [ ] Step 5: Resolve valid confirmed refunds against the canonical live original purpose without a period. Keep critical-fact split invalidation/caps; purpose-only edits reattribute original and refund together. An unresolved original does not become a default credit.
- [ ] Step 6: Run targeted tests plus ordinary transaction/refund/statistics regressions. Assert gross ledger expense=12000 and refund income=3000 while essentials fund net outflow=9000.
- [ ] Step 7: Review lifecycle, concurrency and alternative writer responsibilities before UI work.

## P07: Retire cycle/module/AI mutation paths consistently

**Files:** Modify budget/financial-planning/AI routes, template and budget services, monthly plan/evaluation services, assistant tool registry and AI organization service; create `test/retired-budget-contract.test.ts`.

**Consumes:** P04–P06 and R2/R3/R7. **Produces:** no active budget template/module pool/period writer, while immutable legacy read/replay evidence stays recoverable.

- [ ] Step 1: Write `freshModuleTemplateWriteIsRetired`, `salaryAllocationReplaceIsRetired`, `periodConfirmReconcileIsRetired`, `aiCannotRecreateBudgetTemplate`, `legacyCommittedReplayRemainsExact`, `monthlyEvaluationUsesNoModuleBudgetFacts`.
- [ ] Step 2: Run tests against the active old routes/tools to confirm they still write or advertise retired functionality.
- [ ] Step 3: Retire fresh mutation routes with the documented HTTP 410 feature-retired error and remove capabilities/tool entries. Keep explicit immutable legacy history routes as read-only. Preserve existing unrelated category/tag/import tools.
- [ ] Step 4: Replace active monthly-plan reads with fund summaries and remove category budget facts/prompts from retained evaluation. Keep calendar statistics, recurring schedule dates and optional forecast horizons; they are not accounting cycles.
- [ ] Step 5: Search all salary/template/pool/period callers, including AI/assistant resume/apply paths. Remove unreachable production UI/helpers where no legacy read uses them; isolate retained historical models.
- [ ] Step 6: Run retirement/AI/assistant tests and server lint/typecheck. Verify no fresh operation can regenerate active category funding.

## P08: Deliver Android four-purpose funding and direct bookkeeping

**Files:** Create FundBudget models/repository/workspace/read-state and corresponding JVM/MockWebServer tests. Modify MainShell, DashboardTab, SalarySheet, TransactionEditSheet and editor helpers, details/drilldown/query helpers, StatsTab, MyTab and retained finance entry points.

**Consumes:** P04–P07 APIs and R4/R6/R8/R13/R15. **Produces:** four fund cards, ratio settings, salary allocation preview, primary four-purpose entry, filters and no active cycle/module UI.

**Interfaces:** `FundBudgetRepository.getCapabilities()`, `getConfig()`, `updateConfig(input)`, `getSummary(window)`, `listActivity(query)`, `reviewGrant(input)` decode the corresponding server DTOs. New `FundPurpose` supports all four keys; keep legacy SpendingPurpose parsers for isolated history. `FundBudgetReadState` tracks scoped loading/error/stale data and request owner; no independent arithmetic.

- [ ] Step 1: Write model/network tests for all four values, incomplete coverage, negative balances, unsupported old server and payloads without templates/periods. Add `staleSessionCannotApplyFundReply`, `lostResponseRestoresExactFundRequest`, `fundRefreshDoesNotInvalidateGoalRead`, `backGuardOwnsNestedFundDraft`.
- [ ] Step 2: Run the targeted Gradle JVM tests and observe missing fund DTO/repository/wiring failures.
- [ ] Step 3: Build the repository/state adapters using existing ApiClient/session identity/pending replay. The UI distinguishes loading, unsupported, failed, stale, partial and confirmed values; no read failure becomes zero funds.
- [ ] Step 4: Replace the active module/period page with four cards and prospective ratio settings. Salary entry no longer offers template repair or period confirmation; primary transaction entry includes purpose/tags/notes and preserves valid ledger metadata defaults.
- [ ] Step 5: Add purpose selection/filter to detail/list/drilldown/stats and retain calendar filters. Refund UI follows confirmed original splits. Keep manual goals/independent scenarios optional and remove their dependence on a created active period.
- [ ] Step 6: Route outer/nested Back and dirty/pending leave decisions through the existing shared guard. Retain tab composition and owned refresh; stale values show a status.
- [ ] Step 7: Run targeted JVM/network tests, then `./gradlew.bat --no-daemon :app:testDebugUnitTest :app:lintDebug :app:assembleDebug` from `clients/android`. Record compilation/lint/JVM evidence; device checks remain separate.

## P09: Close actionable prior-repair defects in retained flows

**Files:** Modify import-batch service, AssistantBatchImportWorkspace, ManualGoalProgressWorkspace, owned goal read/leave helpers and related tests. Reuse `review.md` anchors; do not repeat the audit from scratch.

**Consumes:** P08 and R1/R15/R16. **Produces:** reliable retained import replay, entity counts, goal request quarantine, draft preservation and outer leave/refresh behavior.

- [ ] Step 1: Write backend `removedFileRetryReturnsOriginalVersionForBothIndices` and `duplicateRenamedSuggestionsCountOneEntity`. Use the existing isolated reproduction evidence: identical two-file removal replay stays version 2; two suggestions for one category create/count exactly one entity.
- [ ] Step 2: Run tests before changes; implement keyed operation identity lookup before current-index/last-file validation, and normalize actual category entity identity before Review counts. Retain version/hash/CAS and atomic Confirm rules.
- [ ] Step 3: Write Android `replacementAndRemovalHydrateOriginalPendingRequest`, `unresolvedGoalBlocksSecondWrite`, `definiteGoalRejectionPreservesDraft`, `retainedReadsHaveIndependentOwners`, `failedGoalRefreshShowsStaleStatus`, `allOuterBackPathsConsultGuard`.
- [ ] Step 4: Run tests before fixes; hydrate exact stored import payload/hash/request identity, quarantine unresolved goal writes and preserve draft values on definite rejection. Fix retained read ownership/leave routes without adding a generic workflow framework.
- [ ] Step 5: Verify A01/A04 are structurally retired in active period/template flows, while A02/A03/A05/A06/F01/F02 have tests in their retained flows. Update the audit-to-task matrix without marking an unchecked case complete.
- [ ] Step 6: Run import/goal/replay/leave regressions and review their focused diffs.

## P10: Preserve fund purposes through portability and alternate writers

**Files:** Modify portability/CSV, import-batch confirmation, recurring and AI transaction writers and native data UI; create `test/fund-purpose-portability.test.ts` and focused alternate-writer tests.

**Consumes:** P06/P09 and R8/R14. **Produces:** reliable fund-purpose round-trip and explicit unassigned status for unsupported import sources; complete budget recovery through database backup.

- [ ] Step 1: Write `csvRoundTripKeepsAllFourPurposes`, `legacyCsvStillImports`, `unknownNonemptyPurposeHasLineError`, `importWithoutEvidenceRemainsUnassigned`, `alternateWritersUseCanonicalPurposeStore`, `backupContainsGrantAndPurposeFacts`.
- [ ] Step 2: Run the tests before implementation. Extend the named CSV field with fundPurpose while preserving BOM, dedupe, all-or-nothing master-data validation and existing amount/date/tag/note fields.
- [ ] Step 3: Route all ledger writers through canonical purpose persistence. Unknown platform/AI/recurring purposes stay visibly unassigned; category budgets/current mappings never guess them.
- [ ] Step 4: Confirm database backup contains salaries/grants/config/purpose/audit facts. Ledger CSV preserves bill purposes but is not a complete fund-budget backup; do not add a live database restore endpoint.
- [ ] Step 5: Run portability/import/recurring/AI regressions and record unchanged ordinary ledger semantics.

## P11: Complete catalogue/specs and integrated acceptance

**Files:** Update `clients/android/README.md`, affected backend financial/database/native-delivery/statistics specs and frontend quality guidance; write actual execution evidence in the active task.

**Consumes:** P01–P10. **Produces:** verified, documented integrated delivery with honest device/deployment limits.

- [ ] Step 1: Recheck source for L00/L01 navigation/home, L02/L03/L04/L05 ledger/refunds, B01 retired module budgets, B03 four-purpose finance, S01 salary, M02 retired templates, B02/S02 statistics, relevant M01/D/T/assistant entries. Preserve IDs; mark retired entries instead of recycling them.
- [ ] Step 2: Update fields/validation, entry points, APIs, known gaps and change log. Record which old period/module routes are historical/read-only; advance audit dates only for rechecked sections.
- [ ] Step 3: Run `pnpm --filter @jizhang/shared build`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` after integration. Save actual results; earlier 388/1047 tests are baseline evidence, not acceptance for new code.
- [ ] Step 4: Run Android `./gradlew.bat --no-daemon :app:testDebugUnitTest :app:lintDebug :app:assembleDebug` from `clients/android`; inspect fresh results and APK/lint output.
- [ ] Step 5: Validate the numeric carryover matrix below and all R1–R16 acceptance mappings. Search for remaining active cycle/template/module writers and for client-side money recomputation.
- [ ] Step 6: If an authorized device is available, exercise month changes, all four entry choices, overspending, refund confirmation, old history issues, lost response/restart, Back/IME/accessibility. Otherwise record device checks pending; compilation is not device evidence.
- [ ] Step 7: Review integration/spec drift and migration uniqueness. Commit only approved task changes if requested by the execution workflow; deployment and production migration require their own explicit authorization.

## Fixed carryover and accounting matrix

| Action | growth | reserve | essentials | joy | Invariant |
|---|---:|---:|---:|---:|---|
| Salary 100000 at 25/15/50/10 | 25000 | 15000 | 50000 | 10000 | One salary and one four-target grant. |
| Essentials expense 12000 | 25000 | 15000 | 38000 | 10000 | Ordinary expense remains gross 12000. |
| Confirmed refund 3000 | 25000 | 15000 | 41000 | 10000 | Ordinary refund income 3000; no double fund credit. |
| Month changes / tenth arrives | 25000 | 15000 | 41000 | 10000 | No automatic action or reset. |
| Next salary 100000, same ratios | 50000 | 30000 | 91000 | 20000 | Total remaining 191000. |
| Ordinary growth income 5000 | 55000 | 30000 | 91000 | 20000 | Selected normal income credits one purpose. |
| Ratios changed to 50/20/20/10 only | 55000 | 30000 | 91000 | 20000 | Existing grants remain unchanged. |
| Next salary 100000 at new ratios | 105000 | 50000 | 111000 | 30000 | New grant alone uses new ratios; total 296000. |

Also test negative purpose balances, safe-integer boundaries, same-key/different-payload conflicts, unrelated transfers, manual goal facts and incomplete historical coverage.

## Handoff and status

- Planning artifacts: PRD/design/implement index/context manifests in `.trellis/tasks/11-02-four-purpose-only-finance/`; this document is the canonical ordered execution plan.
- This is a single integrated Trellis task with explicit task dependencies and disjoint staged responsibilities. Writing the original plan created no child implementation task, product source change, commit or migration.
- The original planning delivery ended with document self-review and required separate implementation authorization. The user subsequently authorized implementation on 2026-11-03; execution is in progress within the user-confirmed scope. Production migration, deployment and commits remain unauthorized.
