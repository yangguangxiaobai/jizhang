# Core Finance Simplification — Technical Design

Date: 2026-10-29. Status: user-approved implementation baseline; execution began 2026-10-30. Production deployment/device acceptance remains separate and is not authorized by this document.

## 1. Architecture and responsibilities

Keep Kotlin/Compose, the API-only Fastify service, SQLite and shared pure accounting functions. This is a product-flow change following the earlier internal refactor, not another Web removal or a new finance platform.

| Child | Primary ownership | Interfaces shared with later children |
|---|---|---|
| C1 | MainShell/MyTab/Dashboard navigation; transaction form folding and recording defaults | Plan route, secondary-tool return route, income-to-salary hook |
| C2 | Monthly-plan read model, plan host, salary flow, purpose-rule presentation | MonthlyPlanView, frozen window, reserve/growth reference amounts |
| C3 | Statistics window, money labels, category drilldown, expense review | StatsWindow, TransactionDrilldownQuery, review data sections |
| C4 | Manual goal storage/calculation/API/UI and goal review sections | ManualGoalProgressView with explicit manual source |
| C5 | New platform-import entry host and optional AI; old-card compatibility | Existing batch/review/confirm contracts, secondary entry wiring |

Execute C1 → C2 → C3 → C4 → C5. Later integration edits to MainShell, MyTab and the plan host are sequential, never parallel ownership of the same file. Each child updates the inventory entries it actually changes.

## 2. Navigation and fast recording — F01/F02/F11

The visible bottom positions become Dashboard, Transactions, central recording action, Plan and My. Assistant remains an internal secondary destination reachable from My/tools and contextual help. It must have a recorded source route and its own back owner; moving it does not remove conversations, attachments or existing pending cards.

MainShell.kt retains authority over primary/secondary navigation. Do not keep an invisible full-size Assistant or scenario page in the hit-test tree. Preserve the existing retained-financial-tab placement isolation when replacing the three visible finance tabs with a default summary plus details/tools.

TransactionEditSheet.kt keeps the existing editor draft, original refund seed, amount keyboard and single-submit ownership. Folding optional metadata changes visibility only. Edited notes/tags/purpose remain in the draft and are posted exactly as before, including explicitly cleared purpose.

New UI-only helper in ui/RecordingDefaults.kt:

~~~kotlin
data class RecordingAccountResult(val accountId: String?, val error: String?)
fun resolveRecordingAccount(
    lastAccountId: String?,
    activeAccountIds: List<String>,
    refundAccountId: String?,
): RecordingAccountResult
~~~

Ordinary recording chooses the remembered account only if active, otherwise the first active account. A refund with a supplied original account must retain that account or return the existing unavailable-account error; it never silently chooses a different account. Preferences are scoped by serverBaseUrl and authenticated username. No active accounts yields a blocking create/select-account state, not a fake default.

## 3. Monthly plan and wages — F03/F04/F05

### Read model and selection

Add shared/src/monthly-plan.ts and server/src/services/monthly-plan-service.ts. Expose an additive GET /api/v1/monthly-plan with optional periodId or month; the parameters are mutually exclusive. No parameters selects the confirmed frozen window containing server now. Natural-month absence returns no-period; it must not return the latest unrelated historical month. For an explicit group month with multiple candidate periods, return a conflict and require an explicit periodId. Custom-start windows retain their stored boundaries and timezone and display the range.

Reuse FinancialPlanningService.getExecution and its fact preparation from financial-planning-refunds.ts. FinancialExecutionFactDto already identifies expenses/refund splits, originals, category, purpose and counted/unresolved/excluded state. Extract one private prepared-facts reader if needed; do not calculate amounts by collecting a paged API response or re-querying unfiltered ledger rows.

The new pure summary contract is:

~~~typescript
export interface MonthlyPlanSummaryInput {
  essentialsBudgetCents: number;
  joyBudgetCents: number;
  essentialsNetCents: number;
  joyNetCents: number;
  isExact: boolean;
}
export interface MonthlyPlanSummary {
  consumptionBudgetCents: number;
  confirmedNetSpentCents: number;
  remainingCents: number | null;
  status: 'exact' | 'review-required';
}
export function computeMonthlyPlanSummary(input: MonthlyPlanSummaryInput): MonthlyPlanSummary;
~~~

Validate nonnegative safe-integer inputs, sum in exact integer cents, allow a negative remaining amount for overspending, and return remainingCents=null when isExact=false. Server isExact comes from the existing execution coverage and source-validity contract; the client does not invent completeness.

Server MonthlyPlanView includes state=ready/no-period/disabled, periodId, revision, frozen window, confirmedIncomeCents, four target amounts, summary, category rows, unresolved reasons/counts, calculatedAt and the existing legacy-envelope reference. Category rows use the original expense category/purpose for attributed refunds; an expense100/refund30 produces gross100/refund30/net70. Sum complete facts independently of display pagination. Existing period details may gain an additive categoryId filter using the same prepared facts; totals remain unpaged.

Android adds repo/MonthlyPlanModels.kt and repo/MonthlyPlanRepository.kt plus ui/MonthlyPlanWorkspace.kt. It decodes strict cents/status/window values and displays service results. A new endpoint failure cannot be interpreted as an empty plan or zero actual consumption.

### Default surface and compatibility

The default page displays consumption budget, confirmed consumption and budget remaining, then necessary/discretionary detail and reserve/growth references. Category expense detail sits below. Old envelope budgets, carryover pool, scenario calculations, history, configuration and refund review are tools/details with explicit names. Existing endpoints and salary-allocation snapshots remain unchanged; a full-income envelope is not rescaled or added to the consumption budget.

Growth allocation remains a growth reference that may cover investing or skills. C4 does not treat it as an exclusive investment ceiling or calculate a growth completion percentage from investment entries alone.

Purpose rules show Necessary, Discretionary, Not yet classified and Follow category. Their existing inheritance/explicit-unresolved semantics remain intact under the UI; no automatic guessing or historical restatement. Technical revision/token/bps information moves to diagnostic details. Custom percentages still apply only to future explicit confirmations; displayed percentages come from the actual decision rather than fixed50/10 labels.

### Salary write flow

Income → Salary invokes the existing salary domain, not POST /transactions. In normal seeded data the default template is preselected and its selector is folded. Missing or unusable templates yield a clear repair action and zero writes; do not seed arbitrary categories or change old allocations automatically.

Salary save and plan confirmation remain distinct server operations. Save returns an explicit wage success, then at most one compact preview/confirm for inclusion in the plan. Skipping confirmation leaves the wage saved and plan pending. Preview reads confirmed salary sources; confirmation sends their source tokens and the exact preview token. A wage-save failure does not attempt a plan confirmation. A plan failure never repeats a wage creation.

Reuse SalaryOperationReplay and existing financial operation replay. Unknown results are resolved using the original operation/batch key before any new proposal. Same-month additional wages are included once in an explicit revision; later wage correction requires reconciliation and does not silently rewrite a frozen decision.

## 4. Statistics and drilldown — F06/F07

Add shared/src/stats-window.ts and an additive GET /api/v1/stats/window. Reuse existing month-window/date helpers. A server StatsWindow contains kind, from, to, timeZone, label, calculatedAt. month uses [monthStart,nextMonthStart); last30 uses [now−30×86400000,now), with a single captured server now. This is a rolling720-hour range, not thirty local midnight boundaries.

The pure interface is resolveStatsWindow(kind:'month'|'last30', month:string|null, now:number, timeZone:string):StatsWindow. Invalid month/timezone is rejected. Optional endMonth on the existing monthly-trend API anchors historical trends; omitted endMonth retains its existing current-month behavior. Trend length remains3/6/12 with default6, and its caption displays its own range.

StatsTab uses server windows. StatsRepository is defined inside repo/BudgetRepository.kt:124; change its statistics methods without changing the neighboring budget repository contract. Labels are ordinary Income (including wages/refunds), Expense (gross), Refund income and Ledger surplus. Add an explicit refund-income subtotal to stats output if absent, computed by the existing shared income contribution on refund rows. No global field rename breaks old clients: netExpenseCents remains compatible while UI copy becomes Expense. Pool trend stays available in advanced budget details.

TransactionDrilldownQuery contains from, to, categoryId, accountId?, type=expense and rangeLabel. Stats.categoryShare gets the same optional accountId filter if needed so summary and drilldown share conditions. Category share remains exact categoryId, not silently merged parent descendants. TransactionDrilldownScreen uses the existing transaction API/month loader and read-only detail overlay. It does not force arbitrary from/to into the primary month-only bill page. Refuse an exceeded completeness limit instead of claiming partial rows are the full category total.

C3 expense review shows top expense categories and supported budget warnings without AI. C4 appends actual reserve net additions and investment principal additions. Do not call ledger surplus or a transfer between goal labels actual new assets.

## 5. Manual saving and investment progress — F08/F09

### Scope and data

First release tracks user-confirmed progress, not bank-verified liquidity. Users explicitly enter reserve opening balance and investment opening principal with openingAt. The old financial.plan.v1 reserve/scenario is not automatically migrated. Opening values are setup facts, not income, current-period contributions or transactions.

Add shared/src/manual-goal-progress.ts; server services financial-goals-service.ts and financial-goal-store.ts; an additive migration currently proposed as020-manual-goal-progress.ts. Recheck the migration registry before execution and choose the actual next ordinal if another task has advanced it. The design requires the shape, not an ordinal collision.

Store one confirmed opening setup, append/editable progress entries and operation replay records. Entries have id, goal=reserve/investment, kind=deposit/withdrawal, amountCents>0, date, note, revision, createdAt, updatedAt and deletedAt. SQL rows use existing integer cents/timestamps and soft deletion. Entry dates cannot precede the confirmed openingAt or be future confirmations. Opening changes that invalidate an existing chronology are rejected.

The server checks the complete candidate chronological history atomically. Reserve balance and tracked investment principal may not become negative at any step. An edit/delete that makes a later withdrawal unfunded fails completely; replay bookkeeping is rolled back too. No partial restoration or automatic relabeling of withdrawn funds.

All-time balances are derived from confirmed opening plus active deposits minus withdrawals up to server asOf. Requested-period net additions are selected by exact from/to and may be negative. Reserve and investment totals are not summed and advertised as verified assets; moving manually recorded money from one goal to the other must not produce a fabricated saving rate.

Reserve target uses the explicitly confirmed actual necessary monthly baseline and targetMonths from the financial config (default5, range1–120). A missing baseline yields null target/gap/ETA; zero future reserve reference with a positive gap yields null ETA. With baseline5000, reserve12000 and monthly reference1500, target25000, progress48%, gap13000, conditional contribution count9. An ETA is explicitly an unchanged-contribution/no-return assumption.

Investment entries track principal invested/returned, excluding proceeds that represent gains. Skills expense remains an ordinary expense and does not create an investment entry. Growth allocation is displayed as a plan reference, not a guaranteed investment budget or verified contribution.

### Public contracts

New routes under /api/v1/financial-goals:

| Method/path | Behavior |
|---|---|
| GET /api/v1/financial-goals | Return opening setup, manual progress, selected-window totals and calculatedAt; source='manual-confirmed' |
| PUT /api/v1/financial-goals/opening | Explicit opening confirmation/correction with expectedRevision and operationId |
| GET /api/v1/financial-goals/entries | Bounded cursor list; goal/from/to filters, default limit50, max100 |
| POST /api/v1/financial-goals/entries | Record goal/kind/positive amount/date/note with expectedRevision and operationId |
| PATCH /api/v1/financial-goals/entries/:id | Correct one entry with revision guard and atomic history validation |
| DELETE /api/v1/financial-goals/entries/:id | Soft-delete one entry with revision guard and atomic history validation |
| GET /api/v1/financial-goals/operations/:operationId | Resolve an unknown result without repeating a new operation |

All writes share one global goal-state revision for this single-user service and reuse the existing financial operation-store pattern. Replay identical accepted operation payloads before current revision validation; different payload under the same key is409. Auth/actor isolation remains the same as other financial writes. No bank balance, salary, ledger or transfer mutation occurs.

Android adds FinancialGoalModels.kt, FinancialGoalRepository.kt and ManualGoalProgressWorkspace.kt. State is scoped by authenticated server/user and owner tickets. Existing confirmed records remain visible with a stale-data label on load failure; zero records and load failure are different states. Input dates use the server window/timezone contract; opening/record confirmations are explicit.

## 6. Platform import and AI — F10/F11

Extract ui/feature/imports/PlatformImportHost.kt from the existing assistant batch workspace rather than rendering the entire hidden AssistantTab. New platform import from Data or Assistant uses the same batch workspace, preserving an entry/return context. Existing API paths require conversationId: standalone entry obtains a real import conversation after valid file selection and explicit start; an Assistant-origin entry reuses its current conversation. Do not create empty conversations/batches on picker cancellation. This protocol context is internal, not a required user chat setup step.

Manual parsing/category assignment/review/confirm never invokes /analyse or generation endpoints. AI analysis occurs only after explicit user action and configured-provider availability. AI failure leaves manual editing usable. Initial exception-only presentation can be a filter, but all rows remain inspectable and server counts identify excluded versus rule-ignored rows.

Preserve1–5CSV/XLSX files,5MiB/file,8MiB/batch,500 rows,100/page; server batch route request-size limit remains12MiB and the global limit remains8MiB. Auto platform detection, exact original remarks/empty remarks, category approval, identity collision rules, viewRevision, reviewToken, original hash validation, atomic confirmation and unknown-result handling remain. Review is a server request before the one final financial confirmation screen, not a second unrelated client total.

Old single-file pending/history cards keep their original contracts. App-native transaction/transfer CSV and backups remain distinct file formats. Existing Provider advanced folding and model picker are already implemented; only entry/first-use explanatory copy is changed.

## 7. Migration, compatibility and rollout

C1/C3 UI changes and C2 additive read model need no destructive data migration. C4 adds isolated manual-progress tables; backups and restores include them. Old clients continue using existing endpoints. New API capabilities must be explicit: unsupported new monthly/goal API renders unavailable or an existing advanced tool, never fabricated zero progress. Do not infer production version from the repository.

Each child can be locally verified before the next. C4 requires an isolated old-schema backup upgrade/restore fixture. Release rollback can retain old APK on the upgraded additive schema; reverting a server binary that rejects the newer schema requires the documented stopped-writer backup restoration process. No production migration/install/deploy is included in planning.

## 8. Verification and inventory

Use the parent acceptance matrix as the release contract. UI-only menu/copy/folding changes use build/lint, existing behavior tests and device checks; do not add source-text tests that simply mirror a layout. New account selection, cents/window computation, goal lifecycle, aggregation and import wire changes get meaningful failing behavior tests before implementation.

Read clients/android/README.md before each affected change and update only its corresponding IDs/fields/API/gaps and audit date after rechecking source. Removed/repositioned entries retain IDs. Source/JVM/API fixture/device/live deployment are separate evidence levels. C1–C5 can be locally complete while device evidence stays pending; the parent is not product-accepted until G01–G06 pass.
