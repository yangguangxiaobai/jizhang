# T5 信封预算引擎

> 父任务:`.trellis/tasks/09-11-web-pwa`
> 依赖:**T2**(schema)。**不依赖 T3/T4**,可与它们并行。T6 依赖本任务。
> ⚠️ **这是全项目最高风险的子任务。** 算错会让整个产品失去信任。

## Goal

把参考项目的信封预算算法逐条复刻为 `packages/shared` 的纯函数,并以参考项目现成的
**21 个行为测试**作为验收规格。让"这个月每类还能花多少"这个核心问题算得对。

用户价值:这是本产品区别于普通记账 App 的差异点。数字错了,记账就没有意义。

## Background

### 行为规格是现成的,不要自己推演用例

参考项目 `test/` 下有 21 个预算相关测试,带精确期望值。已全部提取到:

**`../09-11-web-pwa/research/budget-engine-behavior-spec.md`** ← **实现前必读全文**

来源:

| 文件 | 用例数 | 覆盖 |
|---|---|---|
| `test/budget_engine_test.dart`(386 行) | 13 | 模块视图、同月合并、跨月分组、结余池、退款抵扣 |
| `test/budget_engine_cycle_test.dart` | 8 | `periodStartOf` clamp、配置周期模式 |
| `test/pool_scenario_test.dart` | 1 | 跨月结余池完整场景 |
| `test/charts_data_test.dart:416,623` | — | 图表与引擎口径一致性契约 |

### 算法权威来源

参考项目 `lib/data/repository/budget_engine.dart`(332 行),已逐条核对其规则与行号,
记录在 `../09-11-web-pwa/research/reference-project-rules.md` §4。

## Requirements

### R1 交付位置

- 实现在 `packages/shared/src/budget-engine.ts` 与 `packages/shared/src/period.ts`
- **纯函数,零副作用**:不读库、不读时钟、不发请求、不依赖 Vue/Fastify
- 时间通过参数传入(便于测试注入固定日期)

### R2 契约

```ts
export type CycleConfig = { kind: 'natural-month' } | { kind: 'start-day'; day: number };

export interface ModuleView {
  categoryId: string;
  budgetCents: number;
  spentCents: number;
  remainingCents: number;
}

export function computeModuleViews(input: {
  allocationsDesc: BudgetAllocation[];
  transactions: Transaction[];
  cycle: CycleConfig;
}): ModuleView[];

export function computeCarryoverPool(input: {
  allocationsDesc: BudgetAllocation[];
  transactions: Transaction[];
  currentModuleViews?: ModuleView[];
  cycle: CycleConfig;
}): number;

export function periodStartOf(cycle: CycleConfig, date: Date): string;
export function nextPeriodStart(cycle: CycleConfig, start: Date): string;
```

### R3 必须复刻的语义(逐条对应源码锚点)

1. **净额口径**(`budget_engine.dart:314-331` + `transaction.dart:44-51`)
   `spent` 累加的是 `expenseContribution`,**不是** `amountCents`
2. **自然月模式**(`:39-64`):分组键 `year*100+month`,降序,当前组 = 最新一组;
   周期起点 = 组内最早日期;区间 `[start, ∞)`
3. **配置起始日模式**(`:66-91`):`[start, nextPeriodStart)` 半开区间
4. **短月 clamp**(`:226-248`):配置日超出当月天数时取月末;date 早于当月配置日则归上一月
5. **同周期分配合并**(`:291-304`):同 `categoryId` 金额**相加**
6. **结余池三步,顺序与符号都不能错**(`:103-204`):
   - ① 历史周期 `Σ(分配 − 该周期净消费)`,窗口连续平铺
   - ② 最早周期起点**之前**的消费:`pool -= expenseContribution`
     (退款贡献为负 → 等于把退款**加回**池)
   - ③ 当前周期各模块超支:`pool -= (spent - budget)` 当 `spent > budget`
7. **边界**:`allocations` 为空 → views 为 `[]`、池为 `0`

### R4 必须避开的四个坑

1. **分组用整数键** —— 用 `'YYYY-MM'` 字符串排序会重现原项目记录过的 bug
   (`'2026-12' < '2026-9'`,见 X1 用例)
2. **退款 = `type: 0` + `isRefund: true`** —— 写成 `type: 1` 测试即失败(R1/R2)。
   退款**不计收入**
3. **池可以是负数** —— 禁止 `Math.max(0, pool)` 归零(P2 期望 `-50000`)
4. **日期归一** —— `start` 与被比较的 date 都要 `_dateOnly`(去掉时分秒),
   否则 S1 用例里 `19:24` 的消费会漏算

### R5 服务端接入

- `GET /api/v1/budget/overview` 返回:
  - `cycle`:当前周期区间(起止)
  - `modules`:各模块 `ModuleView`,附分类名称(供前端直接渲染)
  - `carryoverPoolCents`:结余池
- **服务端是唯一计算来源**。前端不重算预算,只渲染(父任务 design.md §5)

### R6 测试(先写测试,再写实现)

- 逐条转写 `research/budget-engine-behavior-spec.md` 里的 21 个用例为 Vitest 测试
- 单位统一用**分**,避免 `amount * 100` 的转写歧义
- 额外补:空分配、`cycleStartDay` 越界(0 / 29)的处理
- 目标:测试数与断言不少于参考项目

## Acceptance Criteria

- [ ] AC1 21 个转写用例全部通过(逐条可对应到行为规格的编号 M1-M3/S1-S2/X1/P1-P4/R1-R3/C1-C10)
- [ ] AC2 **退款用例通过**:支出 1500 + 退款 500 → `spentCents = 100000`(净 1000 元)
- [ ] AC3 **退款多于支出用例通过**:支出 1200 + 退款 800 → `spentCents = 40000` 且不超支
- [ ] AC4 **池为负的用例通过**:当前周期超支 500 → `pool === -50000`(未被归零)
- [ ] AC5 **跨月分组用例通过**:9/10/12 月工资 → 当前周期为 12 月,`budgetCents = 700000`
- [ ] AC6 **短月 clamp 用例通过**:配置 31 → 4 月为 `04-30`、2 月为 `02-28`
- [ ] AC7 **同周期合并用例通过**:同月两次工资 → food `780000`、transport `520000`
- [ ] AC8 分配前的退款使池为正(`pool === 20000`,用例 R3)
- [ ] AC9 空分配 → views `[]` 且池 `0`
- [ ] AC10 `packages/shared` 无任何 IO 依赖(不 import fs/db/fetch)
- [ ] AC11 `GET /api/v1/budget/overview` 返回结构符合契约,且数字与直接调用引擎一致
- [ ] AC12 `pnpm -r test` 全绿

## Out of Scope

- 记工资、模板管理 → T6(本任务只消费已存在的 `budget_allocations`)
- 统计图表(含结余池趋势) → T8
- 预算页 UI → T6/前端随 T5 之后交付
- 年度储蓄目标、预算增强等参考项目后期功能 → 父任务 MVP 范围外

## Technical Notes

- 纯函数设计是刻意的:参考项目 `budget_engine.dart` 也是纯静态方法,
  目标是"可无副作用单测"。保持这一点,测试才能覆盖全部边界
- 前端**不做**本地重算(父任务 design.md §10 已记录该取舍);
  若将来要支持离线算预算,再评估把引擎打包进前端
- 结余池为负是**正常状态**(表示借用了未来的钱),UI 层要能正确展示负值,不要隐藏
- 参考项目 `charts_data_test.dart:416` 有一条契约:图表最后一点必须等于引擎当前池。
  T8 实现图表时必须复用本任务的引擎,不得另写一套口径
