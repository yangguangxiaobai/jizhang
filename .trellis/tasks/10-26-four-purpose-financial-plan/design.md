# Approved First-Release Design

## Boundary

Independent saved planning domain, not expense envelopes. Proposed first release has one active server-saved plan for current authenticated single-user ledger: monthlyIncomeCents, essentialMonthlyCents, reserveBalanceCents (manual current snapshot), startMonth/rule version, revision and timestamps. Preview never writes; explicit save updates own domain only. No reserve movement history in first version, no ledger linkage. Inputs income/actual essentials positive, reserve nonnegative, safe integer cents; enforce overflow bounds for target/projections. Null/nonpositive essentials does not silently default to50% income. Fixed25/15/50/10 baseline; target factor5.

## Calculation

New pure shared calculation using fixed semantic purposes, integer-safe nonnegative largest-remainder distribution (stable tie order). Do not modify legacy salary rounding. Four amounts exactly conserve income. Projection uses 12 constant-income contributions with no growth/interest assumptions, preserving starting actual reserve separately. Fixed15% baseline continues after target only as a hypothetical projection, clearly mark surplus and first reached month; no automatic cap/redistribution. Existing over-target reserve preserved. ETA ceil(gap/reserveMonthly), month0 if already met; no valid ETA if rounded contribution0. Domain caution states under1month/essentials>50%/expenses>income. Show in-page educational guidance; no OS notification scheduler or transaction interception.

## API/storage

Use isolated `financial.plan.v1` versioned settings envelope and atomic revision CAS; only plan input snapshot saved, no schema migration. Frozen contract in contract.md is authoritative. Preview/current/save endpoints return shared-computed analysis; exact input replay of immediately previous revision returns current unchanged result. Do not persist derived balances; compute outputs in shared from saved inputs. Proposed GET current / preview POST / save PUT protected by existing auth and CSRF. Server owns validation/math; Android strictly decodes typed DTO, formats figures and holds draft. Optimistic revision avoids silent overwrite/retry confusion. Existing salaries/budget endpoints unchanged. No secret/provider dependency.

## UX

Budget entry opens second-level screen, hide bottom global navigation. Inputs with explicit Save/Calculate actions, dirty draft indication, loaded-saved vs preview distinction. Four allocation cards; actual reserve progress/last-updated label and manual update; 12-month forecast with no-return footnote; conditional concise prompts and expandable method/risk explanations. Reuse native tokens/components and exact cents input conventions. Reserve target from actual essentials, correcting frontend proposal's misleading50%-equals-actual wording. No latest-salary or account prefill, no fake actual joy-budget spending stats.

## Rollout

Backend + APK if server saved plan approved; build/tests first, no production deploy/installation without separately authorized action. Historical budgets/records untouched. Stored inputs never imply funds moved or investments purchased. Video attribution remains user-supplied, no endorsement claim.
