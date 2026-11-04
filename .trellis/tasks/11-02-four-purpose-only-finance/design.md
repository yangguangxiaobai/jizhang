# Continuous four-purpose fund budget design

## 1. Intent and boundary

The four purposes remain real fund budgets, not merely labels. Each new salary adds funds by saved ratios; ordinary transactions choose one purpose; balances carry forward. Calendar months are query windows only. There is no active start-day setting, created financial period, period confirmation/reconciliation, category budget, pool or salary module template.

The original user request was for a plan only; the user subsequently authorized implementation on 2026-11-03. The files, types and routes below describe the target design, not a claim that every interface is implemented. P01 checks 1–4, P02 and P03 are recorded complete; P04 is underway and P05–P11 are pending; see the canonical plan and `execution-evidence.md` for progress. The single task is an integrated accounting change, so execution is staged rather than split into independent Trellis child tasks.

## 2. Accounting contracts

### 2.1 Vocabulary and exact amounts

- `FundPurpose = growth | reserve | essentials | joy`, in that fixed tie-break order. Preserve existing Chinese display labels.
- `FundRatiosBps` has those four integer fields, each 0..10000, summing to 10000. Preserve the existing saved ratios; initial suggestion is 2500/1500/5000/1000.
- Amounts are integer cents and timestamps epoch milliseconds. Validate safe integers with absolute value at most 9,007,199,254,740,991. Use BigInt for intermediate allocation/projection arithmetic and return validated JSON numbers.
- Reuse the existing largest-remainder allocator and its fixed tie order. Do not use floating percentages or a second Android money calculator.

### 2.2 Continuous projection

For each purpose: balance = verified salary grants + selected ordinary non-refund income - live ordinary expenses + valid confirmed attributed refunds. A salary is not also written as a normal income transaction. Transfers and manually confirmed goal progress do not create fund deltas.

A transaction purpose is independent of its category. A new manual expense or normal non-refund income requires one purpose in Android. Backward-compatible/imported rows may be unassigned, with visible coverage status; missing data is not assigned to a convenient default.

Negative balances mean the purpose was overspent. Record the real transaction and show the negative amount; do not move funds between purposes, clamp the value to zero or block the ledger entry.

Ordinary ledger expense stays gross and refunds stay income. A refund contributes to funds only through a confirmed valid split set and the original transaction purposes; it cannot additionally become normal fund income. Existing whole-set invalidation and explicit reconfirmation after critical source changes remain.

### 2.3 Dates, edits and configuration

- Ratio edits affect future grants. A new salary grant freezes its ratios and source token.
- An edit to a normal single-salary grant recomputes with its frozen ratios in the same transaction as the salary edit; account/date/amount facts and operation revision remain authoritative.
- Editing a transaction amount/type/purpose changes its projected effect once. Soft deletion excludes its effect; restoration reuses saved purpose facts. Refund splits do not auto-reactivate on restoration.
- Preserve grant revisions and source snapshots on delete/purge; supported purge paths detach active references and retain audit evidence.
- A legacy aggregate source correction needs one-time source review because individual old rounding is unknown. No new monthly workflow is introduced.
- Date cutoffs and optional activity windows use server-owned [from,to) boundaries and the configured timezone. A selected month changes displayed activity, never the ongoing fund balance. Historical filtered values use current valid facts, not a fabricated frozen database revision.

## 3. Ownership and interfaces

| Unit | Responsibility |
|---|---|
| `packages/shared/src/fund-budget.ts` (new) | Four-purpose validation, exact allocation/projection types and pure totals. Reuse `allocateFinancialExecutionCents`; no IO. |
| New migration after `020-manual-goal-progress.ts` | Add fund storage and idempotent verified migration; retain legacy facts and constraints. |
| `financial-fund-store.ts` (new) | Grant/source/purpose revisions and migration issue storage inside caller transactions. |
| `financial-fund-service.ts` (new) | Snapshot-consistent balances/activity, config CAS, historical source review and fund capabilities. |
| `financial-funds.ts` route (new) | Typed request validation and one existing error shape; register in `app.ts`. |
| Existing salary/transaction/refund/import services | Own ledger writes and invoke the fund store atomically. The fund layer does not create a second ledger. |
| Android `FundBudgetModels.kt`, `FundBudgetRepository.kt`, `FundBudgetWorkspace.kt` (new) | Decode server results, own refresh/replay/leave state, and render the four fund cards and primary purpose choice. |

Proposed shared exports:

```ts
export type FundPurpose = FinancialPurpose;
export interface FundAmounts { growth: number; reserve: number; essentials: number; joy: number }
export interface FundRatiosBps { growth: number; reserve: number; essentials: number; joy: number }
export function allocateFundIncomeCents(incomeCents: number, ratiosBps: FundRatiosBps): FundAmounts;
export function projectFundBalances(input: FundProjectionInput): FundProjection;
```

`FundProjectionInput` contains validated grants, ordinary ledger facts and confirmed split facts; `FundProjection` contains four balances, funded/income/gross-spent/refunded totals and coverage. Server IO collects facts in one SQLite read snapshot, using bounded scans if needed, and feeds the shared calculation. Do not store a mutable balance column or add cache invalidation as a new system.

### 3.1 DTO names shared by later tasks

- `FundConfigWrite`: ratiosBps, timeZone, operationId, expectedRevision.
- `FundGrantReviewWrite`: optional existing grantId or unclaimed salary source IDs, current source tokens, explicit ratiosBps, operationId and expectedRevision.
- `FundSummaryView`: contractVersion=1, asOf, balances, totals.funded/income/grossSpent/refunded, optional activity, coverage and snapshotToken.
- `FundCoverage`: complete flag, unallocated salary/unassigned transaction/invalid refund/issue counts and known unresolved amounts; it is not a success/error substitute.
- `FundActivityQuery`: purpose/from/to/tags/account/category/text and bounded pagination (default 50, max 100). `FundActivityWindow` contains date bounds/timezone only.
- `FundProjectionInput`: validated grants, ordinary ledger facts and confirmed split facts; ledger facts retain id/type/isRefund/amount/date/purpose/status, and split facts retain unique split identity/original/refund IDs/amount/validity.
- `FundProjection`: four balances plus funded/income/grossSpent/refunded purpose totals and unresolved coverage. FinancialFundService methods in the plan consume/return these DTOs.

Legacy combined grant activity uses the original confirmation timestamp and lists member source dates. It does not invent per-salary historic fund flows; new grants use salary dates. Ordinary ledger salary statistics retain their real salary dates.

## 4. Additive storage

Use the next migration number available at implementation time (021 in this checkout). Do not edit 019/020 or rebuild transactions just to relax old purpose constraints.

| Proposed table | Keys and facts |
|---|---|
| `financial_fund_config_revisions` | Revision primary key, ratios JSON, timezone, actor/operation/time. No cycle fields. |
| `financial_fund_grants` | Stable grant ID, unique origin kind/ref, active revision, status. Origin is a new salary or a verified legacy confirmed group. |
| `financial_fund_grant_revisions` | Unique grant/revision; source amount, frozen ratios, exact four targets, source snapshot, actor/operation/time and reason. Append-only. |
| `financial_fund_grant_sources` | Salary ID unique, grant ID, source token/amount/date, active/deleted/review status. A salary cannot fund a second grant. |
| `financial_fund_purposes` | Transaction ID primary key, nullable four-purpose value, revision, explicit/legacy-override/legacy-mapping/unresolved provenance and evidence. |
| `financial_fund_purpose_events` | Unique transaction/revision, purpose and actor/operation/time. Preserve corrections and clear reasons. |
| `financial_fund_migration_issues` | Unique source/reason identity, bounded evidence and review status. Unknown history remains diagnosable. |

Reuse `financial_operations` for keyed recovery with a distinguishable resource/contract fingerprint. A key belongs to the same actor/resource/method/full payload; changing ratios, revision, purpose or amount under the same key is a conflict.

## 5. Historical migration

The deterministic algorithm and anchors are in `research/fund-budget-contract.md`. Import the current verified active group decision once, preserving its original aggregate targets and source membership. Import explicit legacy purpose facts directly; infer mapping only from unique frozen historical evidence. Current category rules or ratios never silently rewrite old facts.

Unconfirmed salaries, stale source snapshots and conflicting mappings remain review items. Return `coverage.complete=false`, known totals, unresolved counts/amounts and issue references. The UI labels incomplete/provisional values rather than showing an apparently complete zero.

Historical review can allocate one unclaimed salary with explicitly chosen ratios or reconfirm a changed legacy group against live source tokens. Use operation ID and expected grant/config revisions; it is a source correction, not a financial-period workflow.

## 6. API contract

All routes remain authenticated and retain the existing server/user operation ownership and error shape. These proposed routes are API-only.

| Route | Contract |
|---|---|
| `GET /api/v1/financial-funds/capabilities` | contractVersion=1, four purposes, integer-cent rule, bounded history limits, legacy budgets read-only and no accounting periods. |
| `GET/PUT /api/v1/financial-funds/config` | Ratios/timezone; PUT carries operationId and expectedRevision. Prospective only. |
| `GET /api/v1/financial-funds/summary` | Current four balances, funded/income/gross-spent/refunded amounts, snapshotToken and coverage; optional activity date range does not limit balance carryover. |
| `GET /api/v1/financial-funds/activity` | Bounded cursor/page history filtered by purpose/date/tags/account/category/text. Returns grant and ledger source references without duplicating ordinary ledger rows. |
| `GET /api/v1/financial-funds/migration-issues` | Bounded source review queue with actual tokens/evidence. |
| `POST /api/v1/financial-funds/grants/review` | Explicit historic source(s), frozen/chosen ratios, source tokens, expectedRevision and operationId; claim salary once. |
| Existing salary POST/PATCH/DELETE and supported recycle paths | Add contractVersion=1, expectedFundConfigRevision for creation, operationId and returned fundGrant; drop module/template requirements on the new path. |
| Existing transaction create/PATCH/list/summary | Add fundPurpose, fundPurposeRevision/status/source and a consistent fundPurpose filter including unassigned; preserve omitted vs explicit-null and existing ledger concurrency. |
| Existing confirmed refund splits | Period-free original-purpose resolution for funds, retaining source caps/revisions and whole-set lifecycle. Legacy period execution becomes read-only. |

`fundPurpose` is the new canonical four-purpose field. Preserve old `financialPurpose` and its two-purpose revision for legacy read compatibility; do not relabel it as four values and break applied SQLite constraints or old parsers. An old two-purpose write that remains supported must translate into the new canonical fact consistently; conflicting simultaneous old/new fields are rejected. New income/refund policies are expressed through the fund contract, not through the legacy expense-only field.

Active mutation routes for module templates, pools and period preview/confirm/reconcile are retired with a stable feature-retired error (HTTP 410). Immutable old history and exact replay of an already committed old operation can remain readable. Do not replay an unknown legacy request into a new module allocation.

AI/assistant capabilities and tool registries stop proposing/applying module templates. Retained import/category/tag tools continue their current contracts; stale budget proposals can be viewed as historical but cannot apply writes.

## 7. Android flow

- Replace the active period/module workspace with a four-purpose fund page: four cards show remaining balance, funding, spend and refund; ratio settings affect future salary grants; incomplete historical coverage is visible.
- Salary entry keeps amount/date/account/note and shows the four allocation amounts using server/shared results. It does not ask for a template, module ratios, cycle day or period confirmation.
- Ordinary transaction entry makes the four-purpose choice primary, with tags/notes nearby. Keep necessary ledger/category/account metadata and existing valid defaults; remove category-to-purpose mapping as a prerequisite.
- Refund entry/linking uses the existing explicit split confirmation; show original purposes and unresolved status instead of a free-purpose double credit.
- History and statistics use calendar/custom date filters. Purpose cards show continuous balances; filtered income/spend/refund rows explain the selected window.
- Keep optional independent scenarios and manual saving/investment progress out of the main entry path. Their facts remain independent of fund spending; period-derived forecast references are replaced with a clear fund reference or explicitly unavailable state.
- Retain tab state and per-request ownership. Use existing pending request storage/session identity and one outer leave decision for nested flows. Failed refresh labels stale data rather than presenting it as current.

Affected inventory: L00 navigation, L01 dashboard, L02 list/filter, L03 details, L04 entry/edit, L05 refund linking, B01 budgets (mark retired/replaced), B03 four-purpose finance, S01 salary, M02 salary templates (mark retired), B02/S02 statistics, D import/export/backup, T transfer/trash plus the relevant navigation/assistant entries. Preserve IDs and update only source-rechecked audit sections.

## 8. Portability and alternative writers

Extend transaction export with a named `fundPurpose` column; accept old files lacking it and preserve existing dedupe/all-or-nothing rules. Validate unknown nonempty purpose values with line evidence. Platform/AI/recurring imports without reliable purpose evidence remain unassigned, then can be edited explicitly; never infer funds from a retired module budget or current category mapping.

Every writer that inserts/updates transactions must use the same canonical fund-purpose helper. Database backup includes fund grants/revisions/purpose evidence/config; UI restore remains unavailable because replacing a live SQLite file is unsafe under the existing contract.

## 9. Risks and rollback

- The most material risk is double funding or cent drift during historical group migration. Unique salary membership, origin keys and exact group-target checks are release gates.
- A source with no reliable old allocation requires explicit historical review. This may leave a temporarily incomplete balance, and must be shown with counts/evidence.
- New client/server contracts require capability handling. An old server produces unsupported state, not zero funds. An old client cannot recreate retired budget writes on the new server.
- Maintain both generations of facts and take a verified backup before any later real migration. Rollback can preserve/read data and disable writes; it must not silently re-enable retired budgets or erase new fund facts.
- The original design delivery executed no production migration, device work or source edits. Subsequent implementation is in progress; production migration, deployment and commits are not authorized.

## 10. Validation and handoff

Implement P01–P11 in the handoff plan, with meaningful failing tests before accounting/migration changes. Cross-month carryover, exact-cent allocation, replay, legacy aggregate rounding, partial coverage, four-purpose filters, refunds and all alternative writers are mandatory cases. Keep prior audit findings mapped to their owning task.

Run shared/server lint/typecheck/tests and Android JVM/lint/APK checks after the relevant changes. Keep device restart, weak-network, Back/IME and accessibility evidence separate. The original planning delivery required document/manifest/reference consistency checks only; the task is now in implementation, with actual results recorded separately.
