# Source Research — 2026-10-27

Read-only parent and two independent research agents. No feature tests, build, device install, live Provider, production access or schema migration performed. Existing independent-plan status is prior evidence, not a fresh verification result. Workspace contains extensive unrelated uncommitted work; original task/artifacts were not changed.

## Accounting evidence

- `packages/shared/src/financial-plan.ts:24-35,63-77`: independent fixed allocation, manual existing reserve, target from actual essential costs, no-return hypothetical projection. `packages/server/src/services/financial-plan-service.ts:4-28`: single settings envelope and no ledger writes.
- `packages/server/src/services/salary-service.ts:255-279`: salary+category allocation atomically created; `356-510`: explicit salary corrections, replacement and template apply change existing snapshots; `525-537`: delete both. New immutable plan inputs must be separate facts.
- `packages/shared/src/types.ts:173-197`: authoritative gross expense/refund income. `packages/shared/src/budget-engine.ts:158-185`: envelopes use gross. Old frontend/spec comments describing negative-expense refunds are stale.
- `packages/server/src/db/migrations/005-refund-links.ts:15-28`: IDs only, no split cents. `packages/server/src/services/transaction-service.ts:301-312,387-434`: whole-refund original summaries and validation without cents/cap. `649-686`: soft deletion removes legacy links, so restoring bill alone does not recover provenance.
- `packages/shared/src/budget-engine.ts:90-123,205-228,282-294` and `date-utils.ts:113-128`: month grouping, same-month start-day assignment, open-ended newest natural cycle and historical next-existing-cycle ends. Must not silently reinterpret as payday-to-payday.
- `packages/server/test/account-balance.test.ts:493-548`: source-backed existing credit purchase/transfer repayment regression; cited but NOT run this session.
- `packages/server/src/services/transfer-service.ts:116-127,176-268`: transfers separate, mutable and soft-deleted, existing writes lack plan idempotency/CAS. `packages/shared/src/account-balance.ts:127-155,179-269`: conservation/live-account and liability semantics. `account-balance-service.ts:97-122,139-142`: all live rows including future dates, not as-of liquidity.
- `packages/shared/src/platform-bills.ts:198-215,507-516`: platform imports skip certain investment/repayment rows; cannot promise automatic funding capture from imported bills.
- `packages/server/src/services/portability-service.ts:48-81,273-357`: CSV omits refund/plan relations, salary export only. `400-430,634-757`: transfers actually export/import despite stale spec claim. Whole-DB backup/restore required for complete relations. `db/migrate.ts:47-65`: registered latest migration018 at research time, check again before implementation.

## Android / AI evidence

Paths in this section use `clients/android/app/src/main/java/com/yansuu1/jizhang/` unless qualified.

- `ui/MainShell.kt:59-68,156-245`: four resident tabs plus central action, five visible bottom positions; keep unchanged.
- `ui/DashboardTab.kt:85-113,147-154,436-495`: category budget view only, no persisted financial switch; main-data failure affects access. `ui/BudgetTab.kt:163-253`: existing salary/template and financial entry outside budget success branch.
- `ui/FinancialPlanScreen.kt:147-351,662-687,811,930-945`: load/preview/save guards and rendered input snapshot, manual inputs, actual-essential target and hypothetical forecast. `repo/FinancialPlanModels.kt:189-203`: strict version1 fixed-ratio DTO; don't change wire shape under same ruleVersion.
- `ui/MyTab.kt:108-123,213`: existing financial entry; outer return lacks financial guard/section title treatment. Unified host must own all return paths, not duplicate entry/state.
- `ui/SalarySheet.kt:316-385`: account+template requirement and category allocation payload, no financial plan source. `ui/MainShell.kt:267` and `ui/MyTab.kt:134`: empty salary onSaved callback, refresh integration is missing.
- `ui/TransactionEditorHelper.kt:17-27,78-93,126-141`: no purpose in draft/decode/payload; `ui/TransactionEditSheet.kt:127-177,203-212`: no purpose dirty tracking. Existing arbitrary JSON transport is not implemented-purpose evidence.
- `net/ApiClient.kt:50-53` and `ui/MyTab.kt:330-357`: existing preference mechanism reusable with explicit server/user scope.
- `packages/server/src/services/assistant-tool-registry.ts:45-58,89-101,325-357,481-495,552`: read/write boundary, services and existing tools; financial-plan missing, update whitelist has no purpose. New API alone does not imply AI access.
- `clients/android/README.md:245-256,320-340,848`: independent plan and current accounting/known salary idempotency gap. Stable IDs must survive source changes; design-only ui-redesign is not implementation evidence.

## Planning review consequences

1. Separate new net execution from existing gross APIs.
2. New versioned plan facts instead of reusing mutable category snapshots.
3. Explicit refund cents ownership and unresolved historical data.
4. Freeze period policy and show legacy-window differences.
5. Dedicated-account and virtual designations require posted liquidity and unique ownership.
6. Salary creation deduplication is needed as well as plan deduplication.
7. Preserve old strict v1 DTO/API; capability-gate additive execution APIs.
8. Preserve existing My entry while fixing return ownership in future integration.

No external-video claim was fact-checked; user-provided25/15/50/10 and five-month defaults are product requirements, not independently verified creator attribution.
