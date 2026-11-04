# C4 手动存钱与投资进度简版 Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: use superpowers:subagent-driven-development or superpowers:executing-plans. Apply Trellis before-dev/context/check routing and the approved planning version.

**Goal:** 把计划预留和用户手动确认的存钱/投资完成情况放在同一主线，清楚展示应急缺口、期间净存入与投资本金，避免虚构增长。

**Architecture:** Opening values are explicit, never imported from old reserve/forecast. Entries are progress facts, with no ledger/salary/account/transfer writes.

**Tech Stack:** Kotlin/Compose and existing TypeScript/Fastify/SQLite/shared tools; no new framework.

**Spec:** [prd.md](prd.md), [design.md](design.md), [parent interfaces](../10-29-core-finance-simplification/design.md), [acceptance matrix](../10-29-core-finance-simplification/acceptance.md).

## Global Constraints

Dependencies: C2、C3. Read the parent global constraints and this child's exact file/interface ownership before implementation. Keep integer cents, server-owned arithmetic, existing historical contracts, scoped request ownership and idempotence. Only implementation approval of the latest planning version permits task activation. Initial checkboxes represent future work, not completed features.

## Review Focus

- C4-01: 应急12000+1500−1000=12500，净存500；账本不变。
- C4-02: 本金5000+2500−1000=6500，净投入1500，无收益。
- C4-03: 目标25000、48%、缺13000、9次假设；缺失不猜。
- C4-04: 超取/负数/非分精度/非法日期整笔拒绝。
- C4-05: 合法编辑删除重算；破坏后续余额的修改整体拒绝。

## Files and Interfaces

Exact inspect/modify/create/test paths are in design.md. Implement computeManualGoalProgress(input: ManualGoalProgressInput): ManualGoalProgress in shared. Input includes explicit opening reserve/principal/date, unique active/deleted entries (id,goal,kind,amountCents,date), from/to, inclusive asOf, necessary baseline, targetMonths and planned reserve reference. Output includes reserveBalanceCents, investmentPrincipalCents, periodReserveNetCents, periodInvestmentNetCents, targetCents/gapCents/surplusCents/progressRatio/contributionCount nullable where unsupported. API/operation guards and entry shape are specified in parent design §5; FinancialGoalRepository consumes source='manual-confirmed'.

## Ordered steps

- [ ] **Step 1: Pin progress arithmetic and chronological rejection**

  Create shared manual-goal-progress tests for opening1200000, deposit150000, withdrawal100000→1250000, plus investment500000+250000−100000→650000; include exact target/ETA, negative history, missing baseline and deleted entries. Run focused tests before implementation.

- [ ] **Step 2: Implement shared manual progress**

  Implement the explicit interface above using integer-cent sums and chronology checks. Historical asOf and selected-window totals must be explicit inputs; no clock or DB access in shared.

- [ ] **Step 3: Add isolated storage/migration and atomic operations**

  Verify the next migration number then add setup/entries/replay storage, goal service and authenticated routes. Reuse the financial operation-store pattern without changing other domain outputs. Reject invalid candidates and roll back both business and replay writes.

- [ ] **Step 4: Pin API integrity and restoration**

  Create financial-goals route fixtures for independent opening confirmation, no old-scenario backfill, no ordinary-ledger mutation, identical/different-key replay, global revision conflict, edits/deletes and future/prior-opening dates. Upgrade/backup/restore an isolated old schema.

- [ ] **Step 5: Build manual goal UI and review integration**

  Implement strict models/repository and user-confirmed opening/record UI, with history/edit/delete. Show planned references, manual actual totals and conditional reserve ETA separately; connect sections to C2 plan and C3 review.

- [ ] **Step 6: Verify full C4 scope and device recovery**

  Run C4-01–C4-08, shared/server/JVM/lint/build; device-test amounts, past windows, record/delete confirmations, stale load, scoped401 and unknown operation replay. Check source='manual-confirmed' labels.

- [ ] **Step 7: Document, independently review and commit**

  Add stable inventory entries without recycling IDs, record migration/restore/device evidence, review money-source boundaries and commit only C4 scope.

## First behavior assertions

These assertions pin the behavior described above; fixtures/imports use the existing test setup and the explicit design interfaces. For UI-only visibility/copy work, no new source-text or mirror test is required.

~~~typescript
expect(progress.reserveBalanceCents).toBe(1250000);
expect(progress.periodReserveNetCents).toBe(50000);
expect(investmentProgress.investmentPrincipalCents).toBe(650000);
expect(targetProgress).toMatchObject({targetCents:2500000, gapCents:1300000, progressRatio:0.48, contributionCount:9});
expect(() => computeManualGoalProgress(overdrawnHistory)).toThrow();
~~~

Focused command before/after the new implementation (from repository root):

~~~powershell
pnpm --filter @jizhang/shared test test/manual-goal-progress.test.ts
~~~

Initial expected result: new helper/test behavior is absent or fails. Final expected result: exit0 with the named behavior assertions passing. Follow with the relevant existing regression suites; do not change timeouts or expected financial values to hide failures.

## Verification gate

Run shared progress tests/build, server goal/migration tests and server full lint/typecheck/test --maxWorkers=2/build. Validate old-snapshot upgrade and stopped-writer restore in an isolated DATA_DIR; then Android JVM/lint/build and device recovery.

Use the full authoritative C4 cases in parent acceptance.md; add evidence under this child only during actual execution. Inventory maintenance is part of the same feature change. Source/JVM/API fixture/device/live deployment are separate levels. A missing device leaves those acceptance cases pending rather than making this task product-complete.
