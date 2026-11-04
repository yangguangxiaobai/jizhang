# Execution System — Proposed Technical Design

Status: planning proposal, not implementation approval. Baseline: `../10-26-four-purpose-financial-plan/`; its independent v1 contract remains authoritative until explicitly replaced by an approved migration.

## 1. Architecture and invariants

- Shared pure functions own integer-cents allocation, purpose resolution, refund attribution, execution metrics and forecasts. Server reads authoritative SQLite facts, validates references, and executes atomic mutations. Android only renders server results and submits explicit actions.
- Real accounts answer where money is; envelope categories answer spending detail; purposes answer intended use. Creating a plan, setting a mapping or assigning existing funds never posts a ledger transaction.
- Plan snapshots are historical decisions, not materialized balances. Current account balances, consumption and execution remain derived; no stored `remaining` or `balance` columns.
- Existing `financial.plan.v1` is a manual scenario, not evidence of income or reserve. Keep old GET/PUT/preview semantics for old clients. An explicit adoption wizard may copy its assumptions as proposed defaults, never as verified movements or opening capital.
- No bank integration, securities pricing, market gains treated as contributions, automatic orders, automatic fund transfers, or silent ratio changes.

## 2. Consequential compatibility decisions (proposed for approval)

### Gross ledger versus net execution

Current `expenseContribution` and envelope budgets are gross; refunds are income. Do NOT change this shared legacy contract. Add a named `financial-net-v1` execution contract and display gross expense, attributed refund, net consumption, and unresolved refund amounts separately. Existing ledger/monthly stats and legacy envelope remaining retain their labels and behavior; the linked envelope detail inside the financial page explicitly uses net execution. Do not claim the two remaining figures are interchangeable. A future global gross-to-net migration is out of scope.

### Existing 100% envelope allocations

Salary creation currently allocates its entire amount to expense categories. Never allocate another 100% or silently scale those rows. Phase 1 associates existing category envelopes with purpose groups, shows their configured total versus the 50%/10% spending ceilings, and flags the difference. The financial page uses the purpose ceilings as authoritative for financial progress. A later explicit preview-and-confirm operation can author a linked child-envelope distribution within those ceilings; it must version its inputs, not mutate legacy salary snapshots. Until confirmed, label legacy envelopes as reference budgets, not a validated nested allocation. Growth/reserve never become spendable pool resources.

### Immutable decisions and mutable source facts

Freeze salary identifiers, amounts, revisions, ratios, category mapping version, actual-essential-cost baseline, cycle configuration, timezone and boundaries in each confirmed plan revision. Later salary edits/deletions invalidate the affected income-source status; retain original targets with a visible warning and require explicit reconciliation/new revision. Exclude invalid sources from verified execution metrics. Do not quietly continue to describe invalid salary targets as current confirmed income. Old revisions remain inspectable.

Actual bill corrections intentionally recompute execution for the affected window; do not freeze derived execution. Category mapping/config changes are prospective; historical restatement requires an explicit preview/new mapping revision. A bill edit uses the mapping of its destination plan window unless it has an explicit purpose override. Every response exposes the plan revision, rule version and calculation timestamp.

## 3. Logical storage (minimal authoritative inputs)

Final SQL names and next migration number must be checked again at implementation time; current registered migrations end at 018. Additive TypeScript migrations only, no retroactive edits.

| Logical structure | Stored input facts | Phase |
| --- | --- | --- |
| financial config revisions | four ratios in integer basis points (sum 10000), target months, actual monthly essential-cost baseline, enabled state | 1 |
| financial period + revisions | stable cycle key, start/end/timezone snapshot, config/mapping revisions, confirmed source total and immutable allocation decision; active revision/status | 1 |
| financial income sources | salary ID or explicitly selected non-refund income ID, source amount/revision snapshot; unique active inclusion | 1 (salary); 2 (optional income) |
| purpose rule revisions | category IDs, inherited parent mapping, purpose essentials/joy or unresolved; prospective effective revision | 1 |
| bill-purpose facts | per-transaction override and resolution provenance; no duplicated bill amount/balance | 1 |
| financial refund splits | refund ID, original expense ID, integer split cents and confirmation provenance; globally conserve each refund | 1 |
| account bindings / earmark events | account/purpose binding, explicit opening designation, contribution/release/reclassification facts, effective dates and source links | 2 |
| movement links | confirmed transfer/source ID, purpose, direction, unique accounting ownership and immutable reversal relationship | 2 |

A financial mutation records actor/session, operation ID, expected revision and idempotency identity. Same key/same payload replays the persisted result; same key/different payload returns conflict. Enforce source uniqueness at the database level inside a transaction, not only in UI checks.

Source hard purge must atomically detach invalid associations (or retain a non-executable tombstone reference) so live computations cannot count purged money. Preserving audit provenance is not permission to retain an executable orphan fact. Full database backup carries every new table. Legacy CSV is not full-fidelity backup; do not silently assert round-trip support for new relations.

## 4. Salary and period workflow

1. Save salary using existing accounting behavior. Phase 1 also adds optional request-key deduplication to salary creation for the new client: old callers remain accepted; new caller retries cannot create a second salary. A plan-level unique key alone cannot prevent duplicate salary rows.
2. If financial planning is enabled, show a confirmation sheet with selected actual net income, computed allocation and the explicit no-transfer statement. Skipping keeps the salary and leaves no plan side effect.
3. Server resolves the same authoritative cycle grouping as existing budget code and returns an explicit window. Use period identity, not calendar-month display strings. Current implementation has same-calendar-month start-day assignment even before the boundary and an open-ended latest natural-month cycle; do not silently redefine either. For a financial window, snapshot a finite monthly boundary and expose a warning where legacy envelope windows differ. Implement fixtures for those edge cases before enabling adoption.
4. Multiple salaries in one cycle belong to one period. Adding one selected source creates a new confirmed revision with the new aggregate base, never a duplicate period or a second inclusion of that salary. Display included/excluded sources and the precise date range.
5. Existing historical salaries are opt-in adoption, no mass backfill. A cycle-config change creates prospective settings; already confirmed windows do not regroup. Reject overlapping adopted windows unless an explicit reconciliation resolves ownership.
6. Expense assignment uses occurrence time in `[start,end)` with persisted timezone, not HTTP/server-now time. Current means most recent confirmed financial period, not necessarily the calendar period containing today; stale periods are visibly dated.

## 5. Spending and refund calculation

Purpose resolution: explicit bill override > direct child rule > nearest parent rule > unresolved. Automatic defaults are proposals from stable category IDs, not assumptions from category names. No AI inference on normal saves. Ordinary spending resolves to essentials/joy; investment and reserve are movement facts, not expense classifications that magically increase savings.

`grossPurposeSpend = sum(live eligible expense cents)`

`netPurposeSpend = grossPurposeSpend - sum(valid confirmed refund split cents attributed to those expenses)`

`remaining = purposeBudget - netPurposeSpend` (negative is allowed and displayed).

- Each refund split inherits its original expense's purpose and cycle, not the refund income category. Cross-cycle refunds restate the original period and show the refund date in its audit trail; do not create new wage income or reuse the credit in the receipt period.
- A single linked original can be suggested automatically only with unambiguous, within-cap amount; confirming a new refund can confirm its split in the same operation. Multiple originals require explicit cents splits; no duplication of the entire refund for every original.
- Sum of split cents cannot exceed live refund amount or each expense's remaining refundable amount. Legacy over-refunds/unlinked/multi-original ambiguous links remain pending attribution, with visible unresolved amount; never silently cap/guess and then claim exact net progress.
- Deleted originals/refunds and invalid links contribute nothing to attributed refunds. Restore reevaluates constraints; an edit that invalidates a split marks it unresolved instead of using stale cents. New financial-mode mutations can reject over-allocation atomically. Legacy writers must still trigger deterministic validation on read.
- A credit-card purchase is one expense on the card account; repayment must be an own-account transfer. Do not infer repayment merely from a category/note. Legacy repayment entered as an ordinary expense requires explicit correction, not silent exclusion.
- Recurring pending/ignored occurrences have no financial consumption. Only their one confirmed live bill counts.

## 6. Phase 2 funds and movements

Distinguish (a) current designated stock, (b) this-period net additions, (c) investment contribution, and (d) unavailable/uncertain funds.

- Dedicated-account mode derives designated stock from its live liquid account balance; virtual mode derives it from opening designations and earmark/release facts. The same funds cannot simultaneously be counted through both modes, two bindings, or a movement plus virtual designation.
- Confirmed transfer into/out of a purpose yields one net addition/release, tied to that transfer ID; undo/delete/edit removes or reconciles its contribution. Transfer between two accounts in the SAME purpose is zero net addition. Switching purpose is a reclassification, not new saving.
- Opening designations seed stock but are not current-period savings. Account appreciation/initial-balance edits do not fabricate contributions. Investment figure says 已划拨投资资金, never 已完成购买 or market value.
- Validate each account's combined virtual growth/reserve earmarks against nonnegative available liquid balance in the same transaction. Direct bill/account changes can later breach coverage: keep provenance and require explicit release/reconciliation; never silently choose which purpose loses money. If aggregate earmarks exceed available funds, mark ALL purpose positions on that account as coverage-unresolved and exclude their entire amounts from confirmed usable purpose totals until the user reconciles ownership. Show the account's available liquidity and aggregate shortfall separately; do not present the excluded amount as actual loss or confirmed zero stock. Example: growth5,000 + reserve5,000, liquidity falls to6,000 →4,000 aggregate shortfall, both allocations unresolved, no automatic1,000/3,000/5,000 reserve choice, exact reserve gap/ETA unavailable (an explicitly labeled conservative confirmed-only bound may be shown). A confirmed revised designation growth1,000 + reserve5,000 yields funded1,000/5,000 with sum6,000. Shared validation enforces sum(funded purpose cents) <= available cents after every mutation/read; no per-purpose independent min(balance, earmark).
- Credit/debt accounts cannot supply emergency reserve. Disabling/deleting a bound account prompts reconciliation; historical movement provenance remains, live available reserve excludes missing/deleted/unavailable funds. Existing account-balance APIs include future-dated rows; they are not sufficient evidence of currently liquid money. New reserve availability uses posted/as-of-now facts in the shared rule and exposes scheduled amounts separately, without changing the legacy all-history balance API. Bindings alone are location metadata until the user confirms an opening designation or explicit whole-account dedication.
- Emergency withdrawal changes reserve stock once. Transfer out is not consumption; the eventual bill is ordinary purpose consumption. Direct emergency spending on a dedicated account also reduces available stock, without inventing a second transfer. Restoring/refilling recomputes gap and ETA.
- Emergency target = user-confirmed actual monthly necessary costs × target months (default five), not necessarily the 50% plan ceiling. Above-target surplus remains owned reserve until explicit release. Zero contributions yield no ETA, not division by zero.
- Target reached only suggests a future config (e.g. 40/0/50/10); confirmation and effective cycle are required. New costs or withdrawal prompt a review, never auto-restore ratios.

## 7. Native UI and API contracts

Keep bottom navigation unchanged. Home reuses the existing budget card with remembered category/purpose view, preference scoped to server/account. Both budgets and My route to one financial page/state/config. Single top bar and protected draft exit; current My outer close path needs integration attention.

Financial page: period overview; purpose details and drill-down to counted/excluded/pending facts; emergency goal; forecast; historical review; shared configuration. Missing data is unavailable/pending, not numeric zero. Growth/reserve without phase 2 show 未接入实际划拨 rather than simulated completion. The old manual scenario remains clearly marked 测算.

Proposed additive resource family `/api/v1/financial-planning`:
- GET capabilities/config/periods; explicit PUT config with expectedRevision.
- POST period preview/confirm or reconcile with selected source IDs and operation key.
- GET period execution/details with contract version, window, gross/refund/net, pending amounts, source validity, targets, executed values and shortfalls.
- PUT category purpose rules/bill override and refund-split confirmation with expected source revisions.
- Phase 2 POST binding/designation/link/reversal operations and GET emergency position.
- Phase 3 GET history/review/rolling forecast; AI tool wraps these same read services.

Exact route schemas are frozen per phase before code, not independent ad-hoc DTOs. Require auth/CSRF, integer safety, bounded pagination, no financial calculation fallback on Android, stale-request/session/server guards and safe replay after unknown network result. Old servers disable execution capability without breaking manual or ledger pages.

## 8. Phase 3 metrics and AI

Metrics distinguish investment/reserve target completion from expense-budget use. Savings rate = verified net new growth+reserve contributions / explicitly included net income; no fabricated savings from initial stock or market gains. State treatment of negative additions and zero income. Consecutive success requires configured goals and complete classification; pending inputs yield provisional/not evaluated.

Rolling 12-month forecast uses documented observed contribution/income windows, exposes assumptions/sample size, and falls back to labeled manual projection when evidence is insufficient. No return guarantee. AI receives deterministic results and supporting IDs, not permission to recompute balances. Read-only questions never mutate ratios or history. Any future action uses suggestion → selection → explicit confirmation with revision conflict checks.

## 9. Release and rollback

Per phase: isolated restored test DB migration → shared/server checks → Android tests/lint/build → scoped review → physical-device acceptance → explicit production deployment approval. No deployment in planning. Deploy additive backend capability before matching APK. Keep old APIs functional; feature-disable new UI on rollback, do not downgrade a database in place. Restore only from a verified backup under the project's downtime procedure. Current repository has extensive unrelated uncommitted changes; record an allowlisted implementation diff and do not reset or commit unrelated work.
