# C3 费用统计与月末复盘精简 Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: use superpowers:subagent-driven-development or superpowers:executing-plans. Apply Trellis before-dev/context/check routing and the approved planning version.

**Goal:** 统计准确说明本月花在哪里，时间范围和金额可核对，点分类直接查看同条件账单，并在无AI时给出基础消费复盘。

**Architecture:** Capture server now once and resolve calendar windows in its IANA timezone; last30 is720 rolling hours. Preserve existing stats endpoints/fields and add only optional filters/anchor and refund subtotal.

**Tech Stack:** Kotlin/Compose and existing TypeScript/Fastify/SQLite/shared tools; no new framework.

**Spec:** [prd.md](prd.md), [design.md](design.md), [parent interfaces](../10-29-core-finance-simplification/design.md), [acceptance matrix](../10-29-core-finance-simplification/acceptance.md).

## Global Constraints

Dependencies: C1、C2. Read the parent global constraints and this child's exact file/interface ownership before implementation. Keep integer cents, server-owned arithmetic, existing historical contracts, scoped request ownership and idempotence. Only implementation approval of the latest planning version permits task activation. Initial checkboxes represent future work, not completed features.

## Review Focus

- C3-01: 普通毛支出、工资/退款收入与名称准确。
- C3-02: 本月排行与默认6月趋势各有真实范围。
- C3-03: 滚动30天截至同次now，跨年/时区窗口正确。
- C3-04: 分类明细同条件完整加载，合计等于统计。
- C3-05: 池仍可查；账面结余不叫实际存款。

## Files and Interfaces

Exact inspect/modify/create/test paths are in design.md. Implement resolveStatsWindow(kind: 'month'|'last30', month: string|null, now: number, timeZone: string): StatsWindow with fields kind/from/to/timeZone/label/calculatedAt. Add GET /api/v1/stats/window and optional monthly-trend endMonth. TransactionDrilldownQuery carries the exact from/to/categoryId/accountId?/type=expense/rangeLabel returned/used by the statistic. C4 later adds its manual-goal sections to the deterministic review.

## Ordered steps

- [ ] **Step 1: Pin server window boundaries**

  Add stats-window.test.ts for fixed2026-10-29 12:00 +08, cross-year December/January, invalid months and supported timezone. Run the focused test before creating the new helper.

- [ ] **Step 2: Implement service-owned ranges and compatible aggregates**

  Implement the pure window and GET /stats/window; retain month-window, add optional trend endMonth and exact account filtering/refund subtotal as needed. Preserve gross contribution functions.

- [ ] **Step 3: Test summaries against complete matching rows**

  Extend stats.test.ts with wages/refunds, exact-category/account matching, boundary timestamps and a matching list exceeding the first500-row batch. Assert all amounts and range labels match.

- [ ] **Step 4: Simplify charts and add query-preserving drilldown**

  Change StatsTab/Charts labels and folded range controls, add the typed drilldown screen/query, reuse loader/detail and retain the source view position. Move pool to advanced budget navigation.

- [ ] **Step 5: Add deterministic expense review**

  Show supported top expense categories and budget warnings with their source/range, without model calls or an invented saving rate. Define the section hook consumed by C4.

- [ ] **Step 6: Verify devices and update inventory**

  Run C3-01–C3-07, existing loader/query/stat tests, Android lint/build and backend gates. Test blank/error/rapid-switch/back on device; update B02/S02 and new detail entry coverage.

- [ ] **Step 7: Review and commit the scope**

  Independently review cents/window/pagination behavior and commit the scoped code plus evidence before C4.

## First behavior assertions

These assertions pin the behavior described above; fixtures/imports use the existing test setup and the explicit design interfaces. For UI-only visibility/copy work, no new source-text or mirror test is required.

~~~typescript
const now = Date.parse('2026-10-29T12:00:00+08:00');
const window = resolveStatsWindow('last30', null, now, 'Asia/Shanghai');
expect(window.from).toBe(Date.parse('2026-09-29T12:00:00+08:00'));
expect(window.to).toBe(now);
~~~

Focused command before/after the new implementation (from repository root):

~~~powershell
pnpm --filter @jizhang/shared test test/stats-window.test.ts
~~~

Initial expected result: new helper/test behavior is absent or fails. Final expected result: exit0 with the named behavior assertions passing. Follow with the relevant existing regression suites; do not change timeouts or expected financial values to hide failures.

## Verification gate

Run shared stats-window tests/build, server stats tests and full server lint/typecheck/test --maxWorkers=2/build after integration. At clients/android run JVM/lint/assembleDebug, then device range/drilldown checks.

Use the full authoritative C3 cases in parent acceptance.md; add evidence under this child only during actual execution. Inventory maintenance is part of the same feature change. Source/JVM/API fixture/device/live deployment are separate levels. A missing device leaves those acceptance cases pending rather than making this task product-complete.
