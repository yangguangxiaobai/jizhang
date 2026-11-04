# Four-Purpose Execution System Upgrade

Status: planning complete for review; implementation NOT started or approved by this document. User request: 2026-10-26 upgrade proposal, continued 2026-10-27. This is a new upgrade task, not a rewrite of the prior approved independent-plan scope.

## Goal and value

Help the user answer: how should I allocate actual income, am I following the plan, and how far am I from financial goals? Evolve the existing manual 25/15/50/10 scenario into planning → salary-cycle allocation → actual execution → feedback, while preserving real-account and ledger correctness.

## Confirmed repository facts

- Current plan stores three manual inputs in `financial.plan.v1`; it has fixed ratios, actual essential-cost ×5 target and12-month no-return forecast, no ledger linkage (packages/server/src/services/financial-plan-service.ts:4-28; packages/shared/src/financial-plan.ts:24-35,63-77). Prior source/test evidence is historical, not rerun here.
- Salary creation already writes full-income category allocations; explicit later updates can replace them (packages/server/src/services/salary-service.ts:255-279,356-510). They cannot be relabeled immutable four-purpose snapshots.
- Current ledger and envelopes use gross expense/refund income (packages/shared/src/types.ts:173-197; budget-engine.ts:158-185). Refund links lack apportioned cents; original summaries count the entire linked refund (transaction-service.ts:301-312,387-400). Soft deletion removes old links (649-686).
- Budget periods group same-month salaries, use same-month start-day assignment, latest natural-month open-ended range, and next existing period for historical ends (packages/shared/src/budget-engine.ts:90-123,205-228,282-294; date-utils.ts:113-128). They are not paycheck-to-next-paycheck.
- Android already has budget and My financial-plan entries; home lacks purpose switching. My outer return can bypass the plan page guard (clients/android/app/src/main/java/com/yansuu1/jizhang/ui/MyTab.kt:108-123,213; DashboardTab.kt:436-495). Optional bill purpose and AI financial tool are absent (TransactionEditorHelper.kt:17-27; packages/server/src/services/assistant-tool-registry.ts:45-58,325-357).
- Transfer is its own domain; credit repayment can use transfer without new consumption (packages/server/test/account-balance.test.ts:493-548). Existing account balances include future rows, unsuitable alone as current liquidity evidence (account-balance-service.ts:97-122,139-142).

## Requirements and phase boundaries

### R1 — Three distinct financial concepts (all phases)

Real accounts locate money; envelopes detail consumption categories; four purposes express intended use. Saving plans/mappings/designations never changes assets, creates income/expense, or triggers actual bank/investment operations. Transfer remains neither income nor expense. Existing legacy gross APIs are preserved.

### R2 — Salary-driven, versioned cycle allocation (Phase1)

Default growth25%,reserve15%,essentials50%,joy10%. Use only selected confirmed net salary; no automatic refund/loan/transfer inclusion. Post-salary preview requires explicit confirmation, may be skipped, and never creates another salary. Persist stable cycle identity, boundaries/timezone, selected source snapshots, ratios/rules and exact conserved cents. Multiple salaries produce one period with traceable revisions and unique source inclusion. New-client salary and plan submissions are independently idempotent. Changed/deleted source facts require visible reconciliation, not silent historical rewriting. Custom ratios are validated to100% and affect future confirmed revisions only.

### R3 — Actual spending and linked category detail (Phase1)

Map existing child/parent categories to essentials/joy, with optional whole-bill override and explicit unresolved state; never force or silently guess historical classification. Show gross, attributed refunds, net execution and shortfalls. Refunds follow original expense purpose/cycle via confirmed per-original cents; ambiguous or excess old refunds remain review-required. Preserve original gross ledger/envelope read models and label the new net-execution model distinctly. Existing full-income envelope budgets remain reference inputs until an explicit linked-budget preview is confirmed; do not silently shrink, double allocate or claim they already fit50%/10% ceilings. Investment/reserve execution remains unavailable untilPhase2, not inferred from planned targets.

### R4 — Verified funds and emergency goal (Phase2)

Support explicit account dedication or virtual same-account earmarks, confirmed transfers, opening designations, withdrawals/refills and reversals without double ownership. Distinguish stock, current net additions, designated investment contributions and market value (excluded). Enforce combined earmarks against available posted liquid funds; later shortfall makes all purpose positions on that account coverage-unresolved until explicit ownership reconciliation, never automatically choosing losses or double-counting surviving liquidity. Exclude those positions from confirmed usable totals and withhold exact reserve gap/ETA while unresolved. Target = user-confirmed actual monthly necessary spending × configurable months(default5). Show usable reserve/gap/surplus/coverage/conditional ETA. Target reached or later depletion produces suggestions only; future ratio change needs explicit confirmation. Optional bonus/side-income inclusion is an explicitPhase2 extension, not blanket monthly income inference.

### R5 — Review and deterministic AI feedback (Phase3)

Provide historical execution, coverage history, actual net saving rate, eligible success streaks and12-month rolling projection with assumptions/data-quality coverage. Investment/reserve goals and expense utilization are different metrics. AI reads canonical bounded server statistics and explains source facts; never invents balances or writes on read. Any action suggestion follows selection/confirmation and revision checks. Deterministic pages work without paid AI/configuration.

### R6 — Lifecycle and exceptional facts (cross-phase)

Credit purchase counts once; repayment is transfer. Pending recurring rule has no consumption until its one confirmed bill. Partial/multiple/cross-purpose/cross-cycle refunds conserve cents and never become distributable wage. Edit/delete/restore/purge of bills/refunds and salary/transfer corrections invalidate or recompute affected execution safely. Imports, recurring confirmation, old clients and existing AI writers preserve optional-field compatibility. No source event is counted twice.

### R7 — Compatibility, cycle history and protected funds

Preserve independent manual v1 API and forecast as labeled scenario; no automatic migration of entered reserve into verified money. Snapshot existing configured grouping semantics while explicitly freezing finite financial windows and labeling differences from legacy open-ended/skipped-period budgets. No silently invented payday-to-payday cycle. Freeze confirmed windows across settings changes; reject overlapping ownership or require reconciliation. Daily consumption borrowing cannot access growth/reserve. New facts/revisions use integer cents, shared pure rules and additive migrations, not materialized balances. Whole-DB backup/restore must preserve links; CSV is not a full system backup.

### R8 — One coherent Android surface and evidence (all phases)

Keep five bottom positions. Reuse home budget card for category/purpose view, remember per server/user; only changing the home switch changes this preference, internal page navigation does not. Home and My open the same budget/financial host/configuration, with one title/back owner and draft/busy protections. Source writes refresh authoritative affected screens. Explicit unavailable/pending/unsupported states, independent retries, stale-session guards and exact unknown-result replay. Maintain stable Android inventory IDs/fields/API/gaps/date only after corresponding source recheck. Source, automated, device and live-deployment proof are separate gates.

## Acceptance criteria

All30 cases in `acceptance.md` are required at their specified release phase; mapping A01–A30 identifies requirements and observable results. Key fixtures:

- 10,000 salary →2,500/1,500/5,000/1,000 once, no plan-induced balance/ledger/category budget change; same-operation retry and second salary in same cycle remain unique (A01–A04).
- Necessary3,200/joy600 →remaining1,800/400; linked30 refund on100 expense →financial net70, legacy gross100/refund income30, original-cycle attribution (A09–A12).
- Credit purchase and repayment do not double spend; recurring confirm, editing, recycle restoration and purge maintain consistency (A12–A15).
- Bank→reserve1,500 changes account locations, not assets/spending; reserve20,000 used3,000 leaves17,000; same-account earmarks and future rows cannot fabricate liquid reserve (A19–A23).
- Actual necessary5,000→target25,000; reserve12,000→48%,gap13,000 and9 conditional1,500 contributions; baseline independent from income50% (A24–A25).
- One host/config, remembered home selection, no return bypass, unsupported old server graceful behavior; AI values match authoritative API; release evidence recorded separately (A16–A18,A26–A30).

## Key proposed decisions for final approval

- Three independently validated releases, Phase1 first; do not attempt a new banking/investment ledger.
- New net execution view rather than global gross-to-net accounting migration; original-cycle refund restatement with visible unresolved data.
- Preserve legacy envelope distribution, surface mismatch and require explicit linked-envelope adoption; no hidden rescaling.
- One plan per frozen cycle with append-only confirmed revisions; later config changes prospective; source corrections explicitly reconciled.
- Keep old manual scenario functional; real money designation requires separate confirmation, no historical auto-backfill.

## Out of scope

Actual bank transfers/orders, securities advice/quotes/guaranteed returns, market appreciation as contributions, automatic ratio redirects/notifications, global historical gross-ledger rewrite, arbitrary guessed refund allocations, auto-classification of uncertain old bills, Web/Harmony parity, CSV full-fidelity roundtrip or new structured import/export. Deployment/install/production mutation is not part of this planning session or authorized automatically by later test success.

## Risks and deferred work

Gross versus net views and100%-envelope versus60%-spending limits require transparent labels/adoption. Ambiguous old refund relations may need user review. Legacy unusual cycle boundaries need fixtures and explicit warnings before adoption. Source mutation through older clients can invalidate confirmed inputs; never hide it. Device layout/IME/back/weak-network acceptance and live backend/APK rollout remain separate after implementation. Final SQL/DTO schemas, migration ordinal, per-phase operation limits and dependency versions are implementation preparation, not product-scope expansion.

## Artifact status

`design.md` proposes domain boundaries, data inputs, APIs, compatibility and rollback. `implement.md` orders three phases and quality gates. `acceptance.md` defines30 testable cases. `research.md` captures source findings and evidence limitations. Planning complete for user review; no unresolved blocking product question within this proposal. All proposed compatibility decisions are visible in the final approval summary; no implementation before that subsequent approval.
