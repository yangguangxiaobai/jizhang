# Research: cycle and module-budget removal impact

- Query: Identify the smallest coherent product change that removes accounting cycles and module budgets while supporting direct four-purpose entry, tags and notes.
- Scope: internal, current dirty worktree
- Date: 2026-11-03
- Status: evidence and recommendations only; product decisions are not approved.

## Confirmed request and planning boundary

The user wants the old repair reviewed first, reports no major problems in personal use, and explicitly wants custom accounting cycles (for example a cycle starting on the tenth) and module budgets removed. The future recording flow should use a four-purpose choice, tags and notes alongside necessary transaction facts. The same-scope existing task is reused. Task/planning consent in this session is dated 2026-11-03; implementation remains unapproved.

## Current implementation and implications

| Area | Source evidence | Consequence for simplification |
|---|---|---|
| Purpose vocabulary | packages/shared/src/financial-execution.ts:33 and :57; packages/shared/src/financial-plan.ts:48 | Four allocation names exist, but actual transaction spending permits only essentials/joy. Growth and reserve are funding purposes. Four selectable transaction purposes require a coherent accounting contract, beyond adding two labels. |
| SQLite purpose constraint | packages/server/src/db/migrations/019-financial-execution.ts:176 and :191 | Both transactions and purpose-event history restrict values to essentials/joy. An additive migration or separately versioned field is required; changing TypeScript alone is insufficient. Never edit an already-applied migration to pretend old databases changed. |
| Transaction contract | packages/server/src/services/transaction-types.ts:32 and financial-purpose-store.ts:156; Android TransactionEditorHelper.kt:123 and :126 | Purpose applies only to live expenses and is optional. Income/refund handling and the four-purpose requirement need explicit treatment; preserve omitted/null/PATCH concurrency semantics. |
| Current transaction UI | clients/android/app/src/main/java/com/yansuu1/jizhang/ui/TransactionEditSheet.kt:965 | Purpose is under optional details and offers inherit/essentials/joy. Requested primary four-purpose selection differs materially from current UX. Tags and notes already exist. |
| Bill filters | packages/server/src/routes/transactions.ts:52 and transaction-service.ts:1153 | Existing list/summary scopes cover tags, category, account, dates and text but do not expose a four-purpose filter. Purpose filtering must be added consistently to list, summary and statistics under the new contract. |
| Monthly summary | packages/server/src/services/monthly-plan-service.ts:224, :265, :300, :367 | Summary requires a confirmed frozen period; no matching window gives no-period, overlapping windows conflict. A period-free query must replace this source for active summaries. |
| Salary writes | packages/server/src/services/salary-service.ts:277, :326, :343, :354, :389 | Salary and old category-module allocations are coupled. Recording a salary cannot simply remove the template UI while the server still requires allocations. Historical salary IDs, account effects and replay responses must remain stable. |
| Financial settings | clients/android/app/src/main/java/com/yansuu1/jizhang/ui/FinancialConfigSheet.kt:647, :658, :669 | Natural-month/start-day choices and day input remain active. Hiding start-day while continuing to operate periods leaves the underlying complexity intact. |
| Legacy tools and entry points | MonthlyPlanWorkspace.kt:478, :494, :502; MyTab.kt:311; packages/server/src/routes/financial-planning.ts:95, :116 | Old envelope reference, category mapping, preview/confirm/reconcile/history, distribution templates and pool tools require retirement from active flows and writes. |
| Manual goals | packages/server/src/services/financial-goals-service.ts:813 | Goal amounts are independent facts, but forecast references read the period-backed summary. Keep manual deposit/withdrawal facts; replace or explicitly omit period-derived forecast input. |
| AI organization | packages/server/src/services/ai-spending-organization-service.ts:103, :619, :869 | AI still proposes and mutates budget templates. Removing only the ordinary budget page would let AI recreate the retired feature. Old proposals/replays need compatibility. |
| Portability and import | packages/server/src/services/portability-service.ts:607, :1019; import-batch-service.ts | Existing ledger writers insert legacy base fields. Inspect export/import/backups and review-confirm payloads together so purposes are preserved or explicitly await classification. Never guess a historical purpose. |
| Ordinary money facts | .trellis/spec/frontend/index.md and .trellis/spec/backend/index.md | Integer cents, gross expense, refund income, salary income and transfer exclusion remain invariant. Purpose attribution must not create a second bank transaction or count saving transfers as consumption. |

Paths abbreviated in the table are in the corresponding service or Android UI directory. Anchors describe current implementation, not approved future behavior.

## Recommended technical boundaries

1. Preserve ledger and salary facts, account balances, tags, notes, refunds, manual goal entries, operation journals and database history. Retire old workflows without a destructive reset.
2. Keep real account movement distinct from purpose attribution or virtual allocations. Reuse shared exact-cent arithmetic and existing idempotent write ownership.
3. Treat a natural month or custom date range as an optional statistics filter, without new-period setup or confirmation.
4. Resolve the retained role of four purposes with the user before final design. Classification-only, continuous allocation and monthly reallocation produce different balances and cannot be selected from source facts.
5. Define historical explicit-purpose and frozen-mapping compatibility. Applying only the newest category mapping to all history would silently rewrite meaning.
6. Separate the new-entry requirement from historical/imported unresolved rows. Preserve history and provide a bounded review path rather than inventing purposes.
7. Remove active module-budget generation paths together: salary allocations/templates, envelope/pool references, AI template proposals, category mapping and period controls. Any retained legacy history must be explicitly historical.
8. Document rollout compatibility: current Android with older server reports unsupported; new server handles older mutation payloads and stored operation replays explicitly. Rollback must not reinterpret new four-purpose data as the old two-purpose model.

## Open user-owned decisions

- Highest priority: whether four purposes should continue allocating income and showing remaining amounts after cycles disappear, or serve only as bill classification/statistics. Recommendation for discussion: one lightweight allocation, continuous balances, calendar month only as a filter. This recommendation is not consent.
- This answer determines treatment of growth/reserve expenses versus savings/investment transfers and manual goal records.
- Category selection is currently mandatory. The request suggests reducing competing classification effort; final UX must settle whether category remains visible or is retained only for compatibility.

## Evidence limits

This file inventories source coupling. Main-session verification logs and independent repair audits record fresh checks separately. No business code, production database, deployment or device state was changed for this research.
