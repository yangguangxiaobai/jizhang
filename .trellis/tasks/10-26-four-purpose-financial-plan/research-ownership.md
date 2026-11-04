# Implementation ownership and scope

- Configured backend agent6c7abd97 owns new shared financial-plan pure domain/tests/export and server service/tests/budget-route registration. No legacy budget math changes; no Android/docs overlap.
- Configured frontend agent4849a11f owns new Android FinancialPlanModels/Repository/State/Screen plus BudgetTab/MainShell additive entry and tests. No backend/docs overlap.
- Parent owns task contracts, specs, Android README, integration/full gate, independent review, verified source packaging and final evidence. No deployment or installation in this task.

Expected first-release delivery uses four new main Kotlin files and three extra API routes in existing budget route module, no migration/new route module, one settings envelope. Final inventory must be recounted from completed source rather than assumed.

Accounting roles are semantic purposes independent of expense categories. Both agents received same frozen contract.md and acceptance.md. Review must distinguish projection vs manual reserve, planning capacity vs actual asset balance; projections use no return/rate data or AI.
