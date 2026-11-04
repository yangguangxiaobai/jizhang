# Financial Execution System (Phase 1)

## 1. Scope / Trigger

Implements Phase 1 of the four-purpose execution system (`/api/v1/financial-planning/*`). Upgrades the independent manual plan (`financial-plan.md`) into a salary-cycle, category-rule, and refund-net execution system without mutating real assets, bank accounts, or legacy ledger accounting rules.

## 2. Invariants & Domain Boundaries

1. **Pure logic lives in `@jizhang/shared/src/financial-execution.ts`**:
   - `allocateFinancialExecutionCents`: largest remainder method in BigInt with fixed tie order (growth, reserve, essentials, joy); exact income conservation down to 1 cent.
   - `resolveFinancialCycleWindow`: finite calendar-month windows in explicit IANA timezone; frozen existing windows never move; start-day grouping anchors to salary's same calendar month.
   - `resolveFinancialPurpose`: live expense explicit override > category rule > nearest frozen ancestor rule > unresolved.
   - `computeFinancialExecution`: gross expense minus attributed refunds; growth/reserve permanently `not-connected` in Phase 1 (no simulated savings).
2. **Immutable Revisions & Unmaterialized Balances**:
   - Only decision facts and source snapshots are persisted (`financial_config_revisions`, `financial_mapping_revisions`, `financial_period_revisions`, `financial_period_sources`, `financial_refund_splits`, `financial_refund_split_sets`).
   - Derived execution amounts, remaining, and coverage states are recomputed on read from live facts.
3. **Idempotency & Replay Protocol**:
   - Every mutation accepts a client-generated UUID `operationId`. Stored in `financial_operations` scoped by `actor_id`.
   - Replay lookup occurs before CAS or live validation: identical requests replay the original status and response; changed requests with the same key fail with 409 `FINANCIAL_OPERATION_MISMATCH`.
   - Failed validations roll back atomically and do not consume the operation key.
4. **Refund Lifecycle & Invalidation**:
   - New financial refund splits are stored independently of `refund_links`.
   - When an original expense or refund transaction changes amount, type, isRefund, or is soft-deleted, the entire split set is invalidated (`financial-source-lifecycle.ts`), requiring explicit user reconfirmation.
   - Restoring a soft-deleted transaction never auto-reactivates split attribution.
   - Hard purging detaches split rows atomically, leaving a durable tombstone audit in `financial_refund_split_sets`.

## 3. Endpoints

- `GET /api/v1/financial-planning/capabilities`: feature support flags, limits, and server timezone.
- `GET/PUT /api/v1/financial-planning/config`: prospective configuration (ratios sum to 10000 bps, essential baseline, target months, cycle, timezone) with revision CAS.
- `GET/PUT /api/v1/financial-planning/category-rules`: full replacement category mapping with `expectedTopologyToken` CAS.
- `GET /api/v1/financial-planning/sources/salaries`: paginated salary facts for grouping and confirmation.
- `POST /api/v1/financial-planning/periods/preview`: read-only period preview and deterministic `previewToken`.
- `POST /api/v1/financial-planning/periods/confirm`: atomic period creation or revision confirmation.
- `POST /api/v1/financial-planning/periods/:periodId/reconcile`: period reconciliation after source facts or mapping changes.
- `GET /api/v1/financial-planning/periods`: paged confirmed periods.
- `GET /api/v1/financial-planning/periods/:periodId?revision=N`: a selected frozen decision revision.
- `GET /api/v1/financial-planning/periods/:periodId/revisions?limit=10&offset=0`: paged confirmed revisions, newest revision first. Each item is a `FinancialPeriod`: `decision`, `confirmedIncomeCents`, and source snapshots are historical; `verifiedIncomeCents`, source statuses and warnings are current consistency checks, not historical actual balances. Android history is read-only and formats `decision.ratiosBps` and `window.timeZone`; `window.end` is exclusive. Empty confirmed-period history does not imply that legacy `financial.plan.v1` (single latest manual scenario) was not saved; never fabricate execution history from that input.
- `GET /api/v1/financial-planning/periods/:periodId/execution`: period execution metrics, envelope reference, and provisional coverage flags.
- `GET /api/v1/financial-planning/execution`: current latest period execution (home card endpoint).
- `GET/PUT /api/v1/financial-planning/bill-purposes/:transactionId`: bill-level purpose override with CAS.
- `GET/PUT /api/v1/financial-planning/refunds/:refundId/splits`: refund review queue and multi-original split confirmation.
- `GET /api/v1/financial-planning/operations/:operationId`: operation replay recovery.
