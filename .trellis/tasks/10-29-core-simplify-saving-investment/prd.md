# C4 手动存钱与投资进度简版 PRD

日期：2026-10-29；实施：2026-10-30。状态：in_progress；本地C4实现与测试门禁已闭环，设备验收待执行。

## Goal

把计划预留和用户手动确认的存钱/投资完成情况放在同一主线，清楚展示应急缺口、期间净存入与投资本金，避免虚构增长。

## Background

参考 [父任务需求](../10-29-core-finance-simplification/prd.md)、[父设计](../10-29-core-finance-simplification/design.md)及 [用户主计划](../../../docs/superpowers/plans/2026-10-29-core-finance-simplification.md)。对应需求：F08、F09；依赖：C2、C3。父任务不是自动依赖引擎，按 implement.md 的顺序执行。

- FinancialExecutionWorkspace.kt:1184 marks funding unavailable.
- FinancialPlanScreen.kt:967 says old reserve changes only by manual entry and forecast is hypothetical.
- Financial config already stores an explicit necessary baseline and target month count.
- No bank transfers, positions, prices or market returns are part of the current manual scenario.

## Requirements

- 实现本子任务负责的 F08、F09，采用父PRD中的推荐范围，实施前审阅完整版本。
- 把计划预留和用户手动确认的存钱/投资完成情况放在同一主线，清楚展示应急缺口、期间净存入与投资本金，避免虚构增长。
- 保留父设计要求的金额、历史、请求作用域和重放边界；错误/待核对与空数据分别展示。
- 所有设备相关行为单独留证；不能由源码或构建通过推出设备通过。

## Acceptance Criteria

权威步骤、金额和证据要求在 [总验收矩阵](../10-29-core-finance-simplification/acceptance.md)；本子任务必须完成以下条目：

| ID | 验收目标 | 初始状态 |
|---|---|---|
| C4-01 | 应急12000+1500−1000=12500，净存500；账本不变 | 未执行 |
| C4-02 | 本金5000+2500−1000=6500，净投入1500，无收益 | 未执行 |
| C4-03 | 目标25000、48%、缺13000、9次假设；缺失不猜 | 未执行 |
| C4-04 | 超取/负数/非分精度/非法日期整笔拒绝 | 未执行 |
| C4-05 | 合法编辑删除重算；破坏后续余额的修改整体拒绝 | 未执行 |
| C4-06 | 旧测算不迁移，不随时间增加；起始前为not-started | 未执行 |
| C4-07 | 技能/市值/收益不作本金，成长不作独占投资限额 | 未执行 |
| C4-08 | 幂等/CAS/迁移/整库恢复与账务边界正确 | 未执行 |

- [ ] 上表各项留有对应自动化/设备证据并满足结果。
- [ ] 受影响稳定功能ID、字段、入口、API、缺口及局部源码核对日期已同步维护。
- [ ] 向父任务提供 G01–G06 所需的本子任务整合证据。

## Scope Boundaries

只修改 design.md 所列责任范围及按顺序约定的共享接线点。现有工具/历史合同仍可访问。父任务列出的银行/证券执行、虚拟资金覆盖、大型复盘、离线同步及生产部署不属于本子任务。其余子任务未实现的结果不得伪装为已可用。

## Planning Artifacts

技术方案见 [design.md](design.md)，可执行步骤见 [implement.md](implement.md)。本轮只有文档/任务授权，保持 planning，后续按最新完整方案审阅结果激活本子任务。
