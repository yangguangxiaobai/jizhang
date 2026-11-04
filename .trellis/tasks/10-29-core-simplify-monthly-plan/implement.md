# C2 本月计划与工资分配统一 Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: use superpowers:subagent-driven-development or superpowers:executing-plans. Apply Trellis before-dev/context/check routing and the approved planning version.

**Goal:** 一份默认月计划清楚展示消费预算、已确认消费、剩余和应急/成长预留；工资只录一次，分类模板和高级规则不阻挡正常使用。

**Architecture:** Use the existing prepared execution facts, not paged client totals or independently queried gross bills. Current selection is a confirmed frozen window covering server now; no-period is distinct from error and from an unrelated historical period.

**Tech Stack:** Kotlin/Compose and existing TypeScript/Fastify/SQLite/shared tools; no new framework.

**Spec:** [prd.md](prd.md), [design.md](design.md), [parent interfaces](../10-29-core-finance-simplification/design.md), [acceptance matrix](../10-29-core-finance-simplification/acceptance.md).

## Global Constraints

Dependencies: C1. Read the parent global constraints and this child's exact file/interface ownership before implementation. Keep integer cents, server-owned arithmetic, existing historical contracts, scoped request ownership and idempotence. Only implementation approval of the latest planning version permits task activation. Initial checkboxes represent future work, not completed features.

## Review Focus

- C2-01: 10000元守恒分配且消费预算6000；读取零写入。
- C2-02: 3200＋600消费得到1800/400及合计2200剩余。
- C2-03: 工资、账户余额和总收入只增加一次。
- C2-04: 100消费/30退款保持普通毛额与原周期净70。
- C2-05: 当月缺计划不借旧周期；固定日显示真实区间。

## Files and Interfaces

Exact inspect/modify/create/test paths are in design.md. Implement computeMonthlyPlanSummary(input: MonthlyPlanSummaryInput): MonthlyPlanSummary exactly as parent design §3. Expose GET /api/v1/monthly-plan through the existing authenticated registration. MonthlyPlanRepository.load(periodId: String? = null, month: String? = null): MonthlyPlanView strictly decodes its returned state/window/cents. Consume FinancialExecution/FinancialExecutionFactDto; produce the frozen window and reserve/growth reference values for C3/C4.

## Ordered steps

- [ ] **Step 1: Pin summary arithmetic and quality behavior**

  Create monthly-plan.test.ts with600000-cent budget,380000-cent confirmed spending and220000 remaining; include negative remaining, unsafe cents,10000−3000 refund and isExact=false→null. Run the focused shared test and observe missing helper/failing assertions.

- [ ] **Step 2: Build the authoritative read model**

  Implement shared summary, a prepared-facts adapter and MonthlyPlanService.read selection rules. Add authenticated GET /api/v1/monthly-plan without any write path; reusing/refactoring private fact preparation must keep old outputs.

- [ ] **Step 3: Test period and category completeness**

  Add route fixtures for no current period, custom25-day windows, cross-year/multiple candidates, more than one display page, category/refund attribution and changed salary source. Ensure totals do not depend on display pagination.

- [ ] **Step 4: Create default monthly-plan UI**

  Implement strict DTO/repository and MonthlyPlanWorkspace. Existing finance host shows the summary first with details/tools for categories, old envelope, pool, scenario, history, configuration and refund review. Preserve stale/unsupported states.

- [ ] **Step 5: Simplify salary and mapping presentation**

  Wire Income→Salary sequentially after C1. Fold the default template, keep a clear repair state, use one compact source preview/confirm, and retain separate replay keys. Display human purpose labels and actual configured percentages; diagnostics are expandable.

- [ ] **Step 6: Verify cross-view and history behavior**

  Run C2-01–C2-09 and existing financial/wage/refund tests; compare ordinary gross versus financial net deliberately. Check default/old-server UI and source reconciliation on device.

- [ ] **Step 7: Document, review and commit**

  Update affected B01/B03/S01/M02 and optional-purpose entries. Run scoped gates, independently review and commit only this scope; C3/C4 consume this frozen DTO.

## First behavior assertions

These assertions pin the behavior described above; fixtures/imports use the existing test setup and the explicit design interfaces. For UI-only visibility/copy work, no new source-text or mirror test is required.

~~~typescript
expect(computeMonthlyPlanSummary({
  essentialsBudgetCents: 500000, joyBudgetCents: 100000,
  essentialsNetCents: 320000, joyNetCents: 60000, isExact: true,
})).toMatchObject({consumptionBudgetCents: 600000, confirmedNetSpentCents: 380000, remainingCents: 220000});
expect(computeMonthlyPlanSummary({
  essentialsBudgetCents: 500000, joyBudgetCents: 100000,
  essentialsNetCents: 320000, joyNetCents: 60000, isExact: false,
}).remainingCents).toBeNull();
~~~

Focused command before/after the new implementation (from repository root):

~~~powershell
pnpm --filter @jizhang/shared test test/monthly-plan.test.ts
~~~

Initial expected result: new helper/test behavior is absent or fails. Final expected result: exit0 with the named behavior assertions passing. Follow with the relevant existing regression suites; do not change timeouts or expected financial values to hide failures.

## Verification gate

At root run shared tests/build and server lint/typecheck/test --maxWorkers=2/build. At clients/android run JVM tests/lint/assembleDebug. Exercise source-replay and historical/missing-plan cases on device separately.

Use the full authoritative C2 cases in parent acceptance.md; add evidence under this child only during actual execution. Inventory maintenance is part of the same feature change. Source/JVM/API fixture/device/live deployment are separate levels. A missing device leaves those acceptance cases pending rather than making this task product-complete.
