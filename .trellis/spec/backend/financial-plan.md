# Independent Four-Purpose Financial Plan

## Domain boundary

The25/15/50/10 growth/reserve/essentials/joy plan is not a salary allocation template or expense envelope. Saving it must never write salaries, transactions, transfers, categories, templates or budget allocations. A user-entered reserve is an earmarked liquid amount they confirm manually, not account-total or carryover-pool inference. Forecasts do not create assets or income. No bank integration, investment order, provider/AI call or return assumption.

## First-release contract

Frozen implementation task wire definition: `.trellis/tasks/10-26-four-purpose-financial-plan/contract.md`.

- GET `/api/v1/financial-plan` -> `{plan:SavedPlan|null}`.
- POST `/api/v1/financial-plan/preview` -> `{analysis}` from3 strict safe-integer-cent inputs: monthlyIncomeCents>0, essentialMonthlyCents>0, reserveBalanceCents>=0.
- PUT same base path includes expectedRevision>=0. Revision0 creates; save uses atomic CAS; immediate previous-revision exact-input replay returns current result without duplicating revision. Other stale writes409 FINANCIAL_PLAN_CONFLICT. Initial unread/corrupt state must not be overwritten as empty.
- Single version1 envelope in existing settings under `financial.plan.v1`; store inputs/revision/updatedAt only. No schema migration/materialized derived balance. Corrupt/unsupported envelope503 FINANCIAL_PLAN_UNAVAILABLE; invalid inputs400 FINANCIAL_PLAN_INVALID.
- Same protected budget registration, existing session/CSRF; preview POST is explicit but read-only.

## Canonical financial policy

Pure shared calculation, no native reimplementation. Fixed purpose IDs/order growth/reserve/essentials/joy and percentages25/15/50/10. BigInt intermediates with JSON-safe integer outputs; largest remainder tie-break by fixed order. Amounts nonnegative and conserve income even tiny inputs. Do not change legacy salary rounding to support this new domain.

Target=actual essential monthly costs*5, not income*50%*5. Existing reserve above goal preserved; display progress clamped, gap/surplus explicit. ETA0 if already met, null if rounded monthly contribution0; otherwise ceiling(gap/contribution). Forecast12 relative contributions, unchanged fixed monthly plan/no returns, growth field is cumulative contribution capacity not actual asset balance. Contributions past target are hypothetical surplus, never automatic redirects. Guard every derived monetary value against overflow.

Warnings distinguish essentials above50%, essentials beyond total income (not affordable), reserve under1month, goal reached and zero reserve contribution. Deficit/shortfall cannot be presented as feasible actual savings. Educational prompts suggest debt review, liquid/principal-safe emergency reserve, replenishing after use,7day cooling and reviewing future15% after goal; no specific investment/return guarantee.

## Verification

Shared tests: cent conservation/nonnegative/tiny/tie/overflow/target/goal/no-contribution/12months/deficit. API: auth/CSRF, persistence/replay/CAS/corruption, preview no-write and unrelated ledger byte-projection invariant. Android: strict DTO/money parsing, request ownership and immutable uncertain save replay, saved vs preview vs dirty states, no old-scope late response. Device layout/IME/back/TalkBack acceptance is separately recorded, never inferred from JVM/build.
