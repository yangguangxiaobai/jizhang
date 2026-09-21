# T8 统计图表

> 父任务:`.trellis/tasks/09-11-web-pwa`
> 依赖:**T4**(账单数据)、**T5**(结余池趋势需复用引擎)。可与 T7/T9 并行。

## Goal

提供两张核心图表:近 30 天分类占比(饼图)与月度收支趋势(柱状图),让用户看到钱花在哪里、趋势如何。

用户价值:记账的回报在于"看清消费结构"。没有统计,记账只是一堆流水。

## Background

- 参考项目用 `fl_chart`,Web 端换 ECharts 或 Chart.js(父任务 design.md §6 未定,本任务定案)
- 参考项目图表逻辑在 `lib/features/charts/charts_data.dart`(21KB)与
  `charts_widgets.dart`(35KB),有完整测试 `test/charts_data_test.dart`

### ⚠️ 必须遵守的口径红线

**净支出口径**(父任务 design.md §4.2 / 参考项目 `transaction.dart:44-51`):

- 支出聚合用 `expenseContribution` = 支出 `+amount` / **退款 `−amount`**
- 收入聚合用 `incomeContribution` = 收入 `+amount` / 退款 `0`
- **退款绝不计为收入**

参考项目有一条明确契约(`charts_data_test.dart:416`):
> `carryoverPoolTrend` 最后一点必须等于预算引擎当前池

即**图表不得另写一套口径**,必须复用 T5 的引擎。

## Requirements

### R1 接口

| 方法 | 路径 | 参数 | 行为 |
|---|---|---|---|
| GET | `/api/v1/stats/category-share` | `from`, `to`, `type` | 各分类净额与占比 |
| GET | `/api/v1/stats/monthly-trend` | `months`(默认 6) | 每月的收入合计与净支出合计 |
| GET | `/api/v1/stats/pool-trend` | — | 结余池随时间的变化序列 |

### R2 分类占比(饼图)

- 按分类聚合**净支出**(`expenseContribution` 之和)
- 响应含:`categoryId`、`categoryName`、`color`、`amountCents`、`percent`
- 占比为 0 的分类不返回(或返回但前端不渲染,需定案并测试)
- 净额为**负**的分类(退款多于支出)如何处理?**需定案**:
  建议照实返回负值,前端聚合展示时不隐藏
- 默认区间:近 30 天;可切换区间

### R3 月度趋势(柱状图)

- 每个月两根柱:收入合计、净支出合计
- 收入用 `incomeContribution`,净支出用 `expenseContribution`
- 区间按月升序排列;无数据的月份也要出现(值为 0),避免图表跳跃

### R4 结余池趋势

- 复用 T5 的引擎逐月计算池值(或按引擎口径派生)
- **最后一点必须等于引擎当前 `computeCarryoverPool` 的值**(硬性契约)
- 参考项目 `charts_data_test.dart:623` 还要求:最早分配前的退款抵扣反向累计

### R5 前端图表

- 图表库:在实现时用真实数据度量体积后定案(ECharts 按需引入 vs Chart.js)
- 移动优先:图表宽度自适应,**不允许横向溢出**;饼图标签在小屏上可折叠为图例
- 加载态与空状态(无数据时给出明确文案,不显示空白图表)
- 数字展示:元为单位,保留两位小数;分转元显示不得出现浮点误差(如 `0.30000000000000004`)

### R6 测试

- 分类占比:造支出 + 同额退款 → 该分类净占比为 **0**(父任务 AC5 的核心断言)
- 退款不计收入:造退款行 → 收入合计不含它
- 月度趋势:跨月数据聚合正确;空月份补 0
- 结余池趋势:最后一点 === 引擎当前池(与 T5 结果对拍)
- 分转元显示无浮点残留

## Acceptance Criteria

- [ ] AC1 一笔支出 + 一笔同额同分类退款 → 该分类在饼图中净额为 0(不是"支出一笔 + 收入一笔")
- [ ] AC2 退款行的金额**不出现**在收入合计里
- [ ] AC3 `carryoverPoolTrend` 的最后一点与 `GET /budget/overview` 的 `carryoverPoolCents` **完全相等**
- [ ] AC4 月度趋势中,无账单的月份出现且值为 0
- [ ] AC5 饼图与柱状图在 375px 宽(iPhone 视口)下无横向溢出
- [ ] AC6 无数据时显示空状态文案,不是空白图表
- [ ] AC7 金额显示无浮点残留(如 `19.99` 不会显示为 `19.989999`)
- [ ] AC8 净额为负的分类不被静默丢弃
- [ ] AC9 `pnpm -r test` 全绿

## Out of Scope

- 年度总结、储蓄目标进度、预算执行卡(参考项目后期功能)→ 父任务 MVP 范围外
- 日历视图 → 父任务 Out of Scope
- 图表导出图片 → 不做
- 自定义图表配置 → 不做

## Technical Notes

- **不要在图表层重新实现聚合口径**。参考项目明确要求"各聚合点统一使用"
  `expenseContribution` / `incomeContribution`,避免各处重复判断(§21)。
  服务端应有一处共享的聚合函数,图表接口与预算接口都从它派生
- 结余池趋势与 T5 引擎的关系:理想做法是让 T5 引擎直接导出一个"历史池序列"函数,
  而不是在 T8 里用不同循环重新推导 —— 否则"最后一点相等"的契约会很容易被破坏
- 分转元:用整数除法配合补零,不要 `cents / 100` 直接 `toFixed` 后再参与计算
