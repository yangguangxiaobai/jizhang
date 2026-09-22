# Follow-up research: monthly AI evaluation

## Existing authoritative data

- `packages/server/src/services/stats-service.ts` owns category share, monthly trend, and pool trend.
- Monthly trend income includes live income transactions plus salaries; category share deliberately excludes salary income.
- `packages/server/src/routes/stats.ts` is already authenticated.
- `packages/server/src/routes/budget.ts` exposes budget overview, but budget cycles are not always calendar months: natural-month cycles use the earliest salary date and configured start-day cycles use their configured boundary.
- `packages/web/src/views/StatsView.vue` is the existing statistics surface.

## Recommended MVP

Add an on-demand `POST /api/v1/ai/monthly-evaluation` with no persistence. The server computes the facts from existing stats/budget owners, sends aggregates only to the provider, and returns:

```ts
{
  period: { month, monthStart, from, to },
  facts: {
    monthly: { incomeCents, netExpenseCents },
    categories: [{ categoryId, categoryName, amountCents, ratio }],
    trend: [{ month, monthStart, incomeCents, netExpenseCents }],
    budget: { periodStart, cycle, totalBudgetCents, totalSpentCents, remainingCents, carryoverPoolCents, modules } | null
  },
  evaluation: { summary, highlights, risks, suggestions }
}
```

The UI should render server facts separately from AI prose. Every AI statement should carry an evidence id pointing to a returned fact. The panel belongs below the existing monthly trend in `StatsView.vue`, with an explicit “生成月度评价” button; it must not call the provider on page load or add a new navigation tab.

## Safety and acceptance

- Current natural month first; historical period selection can be a follow-up once period semantics are explicit.
- Provider receives aggregates only: no transaction notes, account data, raw tags, or ledger rows.
- No ledger, budget, category, tag, or settings row is written.
- Provider failure leaves existing charts usable.
- Tests must cover salaries, refunds, soft-deleted rows, empty months, category-share exclusions, auth/CSRF, evidence references, and no-write behavior.

## Shared-file conflicts

The feature will eventually touch `ai.ts`, `ai-types.ts`, `ai-provider-service.ts`, `ai-config-service.ts`, `ai.test.ts`, `api/client.ts`, `StatsView.vue`, and stats/budget service boundaries. Generalize provider context first, then keep monthly logic in a new service/component.
