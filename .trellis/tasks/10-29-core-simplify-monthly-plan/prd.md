# C2 本月计划与工资分配统一 PRD

日期：2026-10-29。状态：planning；此子任务已创建，实施和设备验收尚未开始。

## Goal

一份默认月计划清楚展示消费预算、已确认消费、剩余和应急/成长预留；工资只录一次，分类模板和高级规则不阻挡正常使用。

## Background

参考 [父任务需求](../10-29-core-finance-simplification/prd.md)、[父设计](../10-29-core-finance-simplification/design.md)及 [用户主计划](../../../docs/superpowers/plans/2026-10-29-core-finance-simplification.md)。对应需求：F03、F04、F05；依赖：C1。父任务不是自动依赖引擎，按 implement.md 的顺序执行。

- FinancialHostScreen.kt:38 has three finance tabs.
- SalarySheet.kt:503 requires a template; seed.ts:93 provides a default for normal first-run data.
- FinancialExecutionFactDto contains category/purpose/original/status and can support authoritative detail.
- Ordinary gross/refund income and frozen four-purpose net execution are distinct existing models.

## Requirements

- 实现本子任务负责的 F03、F04、F05，采用父PRD中的推荐范围，实施前审阅完整版本。
- 一份默认月计划清楚展示消费预算、已确认消费、剩余和应急/成长预留；工资只录一次，分类模板和高级规则不阻挡正常使用。
- 保留父设计要求的金额、历史、请求作用域和重放边界；错误/待核对与空数据分别展示。
- 所有设备相关行为单独留证；不能由源码或构建通过推出设备通过。

## Acceptance Criteria

权威步骤、金额和证据要求在 [总验收矩阵](../10-29-core-finance-simplification/acceptance.md)；本子任务必须完成以下条目：

| ID | 验收目标 | 初始状态 |
|---|---|---|
| C2-01 | 10000元守恒分配且消费预算6000；读取零写入 | 未执行 |
| C2-02 | 3200＋600消费得到1800/400及合计2200剩余 | 未执行 |
| C2-03 | 工资、账户余额和总收入只增加一次 | 未执行 |
| C2-04 | 100消费/30退款保持普通毛额与原周期净70 | 未执行 |
| C2-05 | 当月缺计划不借旧周期；固定日显示真实区间 | 未执行 |
| C2-06 | 未分类/退款未归属/来源变化不发布精确剩余 | 未执行 |
| C2-07 | 旧信封/池/测算/历史可查且不叠加消费额度 | 未执行 |
| C2-08 | 正常默认模板无需管理；缺失明确修复、零错写 | 未执行 |
| C2-09 | 工资和计划分别幂等，跳过不建周期 | 未执行 |

- [ ] 上表各项留有对应自动化/设备证据并满足结果。
- [ ] 受影响稳定功能ID、字段、入口、API、缺口及局部源码核对日期已同步维护。
- [ ] 向父任务提供 G01–G06 所需的本子任务整合证据。

## Scope Boundaries

只修改 design.md 所列责任范围及按顺序约定的共享接线点。现有工具/历史合同仍可访问。父任务列出的银行/证券执行、虚拟资金覆盖、大型复盘、离线同步及生产部署不属于本子任务。其余子任务未实现的结果不得伪装为已可用。

## Planning Artifacts

技术方案见 [design.md](design.md)，可执行步骤见 [implement.md](implement.md)。本轮只有文档/任务授权，保持 planning，后续按最新完整方案审阅结果激活本子任务。
