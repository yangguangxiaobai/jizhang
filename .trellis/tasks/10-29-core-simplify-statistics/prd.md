# C3 费用统计与月末复盘精简 PRD

日期：2026-10-29；实施：2026-10-30。状态：in_progress；本地C3实现与门禁/独立审查正在闭环，设备验收尚未执行。

## Goal

统计准确说明本月花在哪里，时间范围和金额可核对，点分类直接查看同条件账单，并在无AI时给出基础消费复盘。

## Background

参考 [父任务需求](../10-29-core-finance-simplification/prd.md)、[父设计](../10-29-core-finance-simplification/design.md)及 [用户主计划](../../../docs/superpowers/plans/2026-10-29-core-finance-simplification.md)。对应需求：F06、F07；依赖：C1、C2。父任务不是自动依赖引擎，按 implement.md 的顺序执行。

- StatsTab.kt:101 keeps category and trend ranges independent.
- StatsTab.kt:451 ends last30 at next month start.
- Charts.kt:236 labels ordinary gross expense net expense; stats-service.ts:260 exposes gross in the compatible netExpenseCents field.
- Ordinary category statistics are exact category rows and income includes wages/refunds.

## Requirements

- 实现本子任务负责的 F06、F07，采用父PRD中的推荐范围，实施前审阅完整版本。
- 统计准确说明本月花在哪里，时间范围和金额可核对，点分类直接查看同条件账单，并在无AI时给出基础消费复盘。
- 保留父设计要求的金额、历史、请求作用域和重放边界；错误/待核对与空数据分别展示。
- 所有设备相关行为单独留证；不能由源码或构建通过推出设备通过。

## Acceptance Criteria

权威步骤、金额和证据要求在 [总验收矩阵](../10-29-core-finance-simplification/acceptance.md)；本子任务必须完成以下条目：

| ID | 验收目标 | 初始状态 |
|---|---|---|
| C3-01 | 普通毛支出、工资/退款收入与名称准确 | 未执行 |
| C3-02 | 本月排行与默认6月趋势各有真实范围 | 未执行 |
| C3-03 | 滚动30天截至同次now，跨年/时区窗口正确 | 未执行 |
| C3-04 | 分类明细同条件完整加载，合计等于统计 | 未执行 |
| C3-05 | 池仍可查；账面结余不叫实际存款 | 未执行 |
| C3-06 | 空/失败/快速切换/返回标签和位置正确 | 未执行 |
| C3-07 | 无AI基础复盘可用，不足数据明确 | 未执行 |

- [ ] 上表各项留有对应自动化/设备证据并满足结果。
- [ ] 受影响稳定功能ID、字段、入口、API、缺口及局部源码核对日期已同步维护。
- [ ] 向父任务提供 G01–G06 所需的本子任务整合证据。

## Scope Boundaries

只修改 design.md 所列责任范围及按顺序约定的共享接线点。现有工具/历史合同仍可访问。父任务列出的银行/证券执行、虚拟资金覆盖、大型复盘、离线同步及生产部署不属于本子任务。其余子任务未实现的结果不得伪装为已可用。

## Planning Artifacts

技术方案见 [design.md](design.md)，可执行步骤见 [implement.md](implement.md)。用户已明确按完整计划实施；本子任务已激活，进展与证据见 implementation-status.md，设备项保留待验。
