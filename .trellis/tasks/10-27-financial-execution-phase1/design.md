# Phase1 Design and Ownership

User approved parent planning summary on2026-10-27. Parent design.md is incorporated in full for Phase1. Concrete endpoint/types freeze in child contract.md before dependent coding; implementation stays within approved behavior.

## Change boundary

Gap: current manual plan knows no salary source, purpose on bills, or actual consumption. Domain lives in shared pure arithmetic, server persisted facts/read models, and native repositories/UI—not by changing global expenseContribution.

Expected necessary changes:
- New shared financial-execution domain/tests and index exports: purpose resolution, ratios, allocation and refund/execution arithmetic.
- Additive server migration/registration, financial-planning service/routes/tests: immutable config/mapping/period/source decisions, operation replay, execution queries.
- Salary service/route optional idempotency inputs and tests: prevent new-client duplicate actual salary writes independently of plan deduplication.
- Transaction-service optional purpose DTO/create/update validation and split lifecycle support plus tests: every writer and soft delete/restore/purge obey one contract. Keep gross contribution and balances unchanged.
- New native execution models/repository/state/UI; existing shell/My/dashboard/budget/salary/editor integrations: one source of API truth and back ownership, no duplicated calculation.
- Native inventory/spec/task evidence: update after actual source readback, not design-as-implementation.

No changes to real-bank integration, transfer accounting, reserve earmarks, forecasts as actual money, existing financial-plan.v1 contracts, global refund accounting, unrelatedWIP or publicWeb. Any local UI extraction preserves category budget behavior and is verified with source/unit/device scopes separately.

## Agent ownership

Parent owns final contract integration, task artifacts and cross-agent merge/review. Configured planner/scout research read-only. Shared coder owns new shared module/tests/index. Backend owns new financial service/routes/migration and salary replay integration. Separate coder may own transaction purpose field integration after contract freeze, coordinated with backend migration. Frontend owns native files only; it does not change API schema. Test-runner verifies only; reviewer reads/reports only; docs-writer updates inventory/spec after source stabilizes. Shared worktree, no resets/staging/commits or overlapping ownership without parent handoff.

## Release / migration

Parent design release/rollback applies: additive backend first only after later authorization. Use isolated test DBs. No product DB/network access, production deploy or APK install in implementation authorization. Build/debug APK is allowed local verification, not release proof.
