# Proposed Implementation Plan

Status: implementation authorized by user 开始 after complete final summary on2026-10-26. Contract frozen in contract.md; independent server settings plan, no schema migration.

1. Finalize product summary: one server-saved active plan, fixed baseline, current manual reserve rather than movement history, positive actual essentials, in-page tips, no auto redirect or bank/ledger effects. User approves summary first.
2. Read shared/backend/native pre-dev specs and latest storage/migration patterns. Freeze typed DTO, optimistic revision and input/overflow/rounding rules.
3. Delegate focused shared/server vertical slice to configured backend agent with complete contract; independent frontend agent implements native screen once contract fixed. Do not overlap file ownership.
4. Shared unit tests: cents conservation/tiny inputs/tie order/overflow, target based on actual expenses, initial met/excess reserve/zero contribution/12month crossing, shortfall warnings. API tests: auth/CSRF, persistence/conflict/retry, preview read-only, ledger/salary/template/transfer invariance.
5. Android input/state/DTO tests, budget/navigation entry; fail-safe load/save/retry without lost draft. Same-change README stable feature inventory/fields/API/known gaps/log.
6. Parent integrates full shared/server lint/typecheck/test/build and Android JVM/lint/assemble, independent scoped reviewer verifies finance invariants/no unapproved scope.
7. Deliver APK + backend bundle/checksum/deployment guide if applicable; source/tests/device claims separated. No commits/staging/archiving/production deploy/bank calls/paid AI unless authorized.
