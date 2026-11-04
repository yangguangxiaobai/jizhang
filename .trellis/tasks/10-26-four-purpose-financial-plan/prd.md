# Four-Purpose Financial Plan and Reserve Progress

## Goal and confirmed scope

User requested 25/15/50/10 planning with useful guidance, then explicitly chose saved independent plan/progress rather than calculator-only or ledger linkage. Task creation approved through that choice. User explicitly approved the complete final summary with 开始 on 2026-10-26; implementation authorized.

## Repository evidence

- Expense templates reference categoryId/ratio (packages/server/src/services/template-service.ts:31-34); no independent growth/emergency purpose model.
- Salary creation writes actual income/allocation snapshots (salary-service.ts:255-277), unsuitable for forecasts.
- Existing budget carryover pool is not an emergency reserve (packages/shared/src/budget-engine.ts:10-17).
- Transfers are neither income nor expense and do not execute bank movements (transfer-service.ts:1-7).
- Shared owns canonical financial calculations; integer cents, no client duplicate policy. Legacy allocateSalaryCents has tiny-value remainder edge (seed-data.ts:150-186); new purposes need nonnegative conserving rounding, without changing legacy math.

## Requirements

R1. Independent Android second-level plan, budget-page entry; preserve existing ledger/budget/account behavior. Save monthly take-home income, actual necessary monthly costs and manually confirmed existing liquid emergency reserve. Do not infer from total balance, carryover or all monthly income.
R2. Default four purpose allocations growth25/reserve15/essentials50/joy10, sum exactly income in integer cents, all nonnegative. No automatic ledger/category/account/template changes.
R3. Target = entered actual necessary monthly costs * 5 (not always half income * 5). Show existing reserve, gap, progress and forecast time. Preserve above-target reserves, handle zero-contribution/no-estimate safely.
R4. Show 12-month equal-income/no-return projection distinct from actual progress. Mark forecasts and assumptions; no future salaries or invented asset returns. Actual reserve updates explicitly manual, never increase by elapsed calendar time.
R5. Helpful contextual guidance: necessary costs exceed half income; costs exceed income/plan not affordable; reserve below one month; refill after usage; liquidity/principal-risk; high-interest debt/variable income; 7-day cooling-off education. No new transaction interception/automatic system notifications in scope yet.
R6. On target reached suggest reviewing future15% allocation, no auto redirect. Existing reserve remains earmarked. First release ratios fixed; baseline15% projection continues hypothetically while clearly marking target/excess, never indicating actual reallocation.
R7. Preserve source/test/device/live-deployment distinctions, update Android inventory in same implementation. Do not claim creator/video facts independently verified or promise returns.

## Acceptance

- Saving/reopening restores selected independent plan and actual reserve inputs in agreed persistence scope.
- 10000 income/5000 actual essentials/0 reserve =>2500/1500/5000/1000; target25000; baseline17 monthly contributions to reach; 12-month estimated reserve18000, clearly not actual balance.
- Different actual essentials changes target independently of50% allocation. Insufficient budget/negative available cash produces explicit warning, not a claim plan affordable.
- Target reached, excess reserve, extremely small amounts, invalid inputs/overflow, failed load/save and stale edit cases handled safely.
- No writes to ledger/salaries/transfers/templates/allocations from save/projection/progress; fixed prompts do not invoke paid AI.
- Automated shared/server/Android checks and build, separately documented device checks.

## Approved first-release decisions

- One server-persisted current plan; latest manually confirmed reserve snapshot only, no movement history. Editing reserve can show refill guidance while current reserve is below target, without pretending a verified withdrawal history.
- Monthly income and actual essential costs must be positive, reserve nonnegative. Four ratios fixed. No automatic account/salary input or integration.
- In-page guidance only; no system notifications, transaction interception, investment orders or automatic redistributions.
- Server owns shared exact-cents projection; Android renders results. Forecast months are relative contribution1..12, no new start-date input required.

## Out of scope

Automatic bank transfers, investment orders/quotes/recommended securities, guaranteed returns, auto income/expense inference, live salary/budget linkage, historical budget rewrites, AI paid calls. No implementation/production mutation until approved.
