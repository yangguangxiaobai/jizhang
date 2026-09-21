# Implementation Plan: Hierarchical Budget Modules

## Scope

Expected product files:

- packages/server/src/db/migrations/007-category-hierarchy.ts
- packages/server/src/db/migrate.ts
- packages/server/src/services/master-data-service.ts
- packages/server/src/services/transaction-service.ts
- packages/server/src/services/template-service.ts
- packages/server/src/routes/master-data.ts and budget/stats routes as required
- packages/shared/src/types.ts and budget-engine.ts
- packages/web/src/api/client.ts
- packages/web/src/stores/meta.ts and budget.ts
- packages/web/src/views/ManageView.vue
- packages/web/src/views/TemplatesView.vue
- packages/web/src/views/BudgetView.vue
- existing server/shared/web tests plus a focused hierarchy browser suite

No account, salary, import, deployment, or authentication redesign is planned.

## Ordered work

1. Add migration 007 and typed category parent data.
   - Keep all existing rows standalone.
   - Add parent validation and safe detach-on-parent-delete behavior.
   - Extend API DTOs and frontend meta refresh paths.

2. Extend shared budget normalization.
   - Add an optional parent projection with identity fallback.
   - Normalize allocation and transaction category ids before module merge/spend aggregation.
   - Preserve all existing no-hierarchy test outputs exactly.
   - Add child-spending projection without changing existing monetary rules.

3. Wire server budget and stats paths.
   - Load the category hierarchy once per request.
   - Pass the same projection to overview, pool, and pool-trend calculations.
   - Attach child actual-spending details to budget modules.
   - Reject selecting a parent category for a new bill.

4. Update category management.
   - Show parent rows and child rows with one-level indentation.
   - Allow creating a parent and assigning/unassigning children.
   - Do not auto-group built-ins.
   - Detach children before deleting a parent, with a confirmation that states the result.

5. Update template and budget screens.
   - Template editor offers only parent/standalone budget modules for new selections.
   - Budget cards render parent pool totals and expandable child spending.
   - Preserve standalone layouts and current template-application confirmation.

6. Add regression coverage.
   - Migration and CRUD tests.
   - Engine rollup and pool tests.
   - API and transaction validation tests.
   - Mobile browser flow for parent creation, child bill entry, template allocation, and budget display.

7. Run final checks.
   - pnpm -r typecheck
   - pnpm -r lint
   - pnpm -r test
   - pnpm --filter @jizhang/web run build
   - focused hierarchy browser tests
   - full existing Chrome suite where available
   - git diff --check and Trellis final review

## Risk and rollback points

- Migration 007 is the first irreversible schema boundary; rely on the existing pre-migration backup and test it against a seeded database.
- Shared-engine normalization is the highest-risk code path; keep identity fallback and compare all existing budget fixtures before enabling hierarchy inputs.
- Do not silently rewrite allocation JSON when grouping categories; only the explicit template application feature may rewrite current allocations.

