# Frozen first-release wire contract

## Endpoints (registered inside existing budget/auth module)

- GET `/api/v1/financial-plan` -> `{plan: SavedPlan|null}`.
- POST `/api/v1/financial-plan/preview` body `{monthlyIncomeCents,essentialMonthlyCents,reserveBalanceCents}` -> `{analysis:Analysis}`. Strict numeric safe integer cents. No writes.
- PUT `/api/v1/financial-plan` body `{expectedRevision: nonnegative integer,monthlyIncomeCents,essentialMonthlyCents,reserveBalanceCents}` -> `{plan:SavedPlan}`. expectedRevision0 means create. CAS conflict409 `FINANCIAL_PLAN_CONFLICT`; exact re-send with same inputs and old revision returns current plan (idempotent uncertain-result replay); otherwise cannot overwrite newer inputs. Missing revision400.
- Validation400 `FINANCIAL_PLAN_INVALID`; unsupported/corrupt stored data503 `FINANCIAL_PLAN_UNAVAILABLE`; never default/overwrite corrupt plan.

`Inputs` three fields above. I,C>0; E>=0. All <=safe int but derived target/year totals must also be safe integers. New shared calculation internally BigInt allowed but wire numbers safe. Largest remainder allocation percentages25,15,50,10 stable order growth,reserve,essentials,joy; each nonnegative; sum equals income.

`SavedPlan` = `{version:1,revision:positive integer,updatedAt:epochMs,inputs:Inputs,analysis:Analysis}`. Store only version/revision/update/input envelope under dedicated settings key `financial.plan.v1`; no schema migration, no derived money state. No history/delete/multiple plans. GET recomputes analysis; no automatic changes.

`Analysis` = {
 `ruleVersion:1`,
 `allocations:[{purpose:'growth'|'reserve'|'essentials'|'joy',percent:25|15|50|10,amountCents:number}]` (four ordered),
 `reserveTargetCents:number`,
 `reserveGapCents:number`,
 `reserveSurplusCents:number`,
 `reserveProgress:number` (0..1, clamped display ratio),
 `monthsToTarget:number|null` (0 if initially met, null if contribution0),
 `targetReached:boolean`,
 `essentialShortfallCents:number` max(0,C-essential allocation),
 `monthlyDeficitCents:number` max(0,C-I),
 `warnings:('ESSENTIALS_OVER_HALF'|'ESSENTIALS_EXCEED_INCOME'|'RESERVE_UNDER_ONE_MONTH'|'RESERVE_TARGET_REACHED'|'RESERVE_CONTRIBUTION_ZERO')[]`,
 `projection:[{month:1..12,reserveProjectedCents:number,growthContributionsCents:number,reserveGapCents:number,reserveSurplusCents:number,targetReached:boolean}]`
}.

Projection reserve=E+monthly reserve contribution*k; growth only cumulative planned contribution, NOT asset balance. Fixed contribution continues after goal purely hypothetical, mark surplus. ETA BigInt ceiling safe result. No returns/interest/automatic reallocation. When deficit/shortfall, UI emphasizes hypothetical plan not affordable. Reserve target alwaysC*5. Warnings deterministic backend; static education texts native.

## Android behavior/ownership

BudgetTab gets `onOpenFinancialPlan` callback (default harmless) and always-visible entry even no budget/error; MainShell owns fullscreen second-level state/back/bottom-bar hiding. Dedicated FinancialPlanRepository/typed DTO + screen. Load before save; failed initial GET cannot silently save over unknown current plan. Can preview user input if server available. Draft retained on error. Preview vs saved clearly marked; input edit invalidates displayed preview or marks stale; no financial reaggregation native. Busy exclusive sync before launch, request scope/base/session and coroutine cancellation guard. Save ambiguous retries retain exact expectedRevision+input payload. Conflict shows reload option with confirmation if discarding current draft. No automatic POST/PUT on form change.

Money text strict decimal at most2 places (positive I/C and nonnegative E), BigDecimal exact cents <=JS safe max. Initial empty state no prefilled fake income; examples labeled text. Manual reserve update integrated into same saved input form, latest confirmation timestamp only.
