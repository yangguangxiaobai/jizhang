# C1 核心导航与快捷记账精简 PRD

日期：2026-10-29。状态：planning；此子任务已创建，实施和设备验收尚未开始。

## Goal

让普通支出通过金额、分类、保存完成；计划直接可达，AI和扩展工具按需进入，返回与草稿保持正确。

## Background

参考 [父任务需求](../10-29-core-finance-simplification/prd.md)、[父设计](../10-29-core-finance-simplification/design.md)及 [用户主计划](../../../docs/superpowers/plans/2026-10-29-core-finance-simplification.md)。对应需求：F01、F02、F11；依赖：无前置子任务。父任务不是自动依赖引擎，按 implement.md 的顺序执行。

- MainShell.kt:209 currently makes Assistant a primary bottom item.
- TransactionEditSheet.kt:831 shows optional purpose and already has editor draft/keyboard ownership.
- TransactionEditSheet.kt:1366 disables parent-category selection; do not list that already-fixed issue as a new feature.
- Existing normal recording has default date/category/account; the change reduces visible choices rather than claiming every optional field is mandatory.

## Requirements

- 实现本子任务负责的 F01、F02、F11，采用父PRD中的推荐范围，实施前审阅完整版本。
- 让普通支出通过金额、分类、保存完成；计划直接可达，AI和扩展工具按需进入，返回与草稿保持正确。
- 保留父设计要求的金额、历史、请求作用域和重放边界；错误/待核对与空数据分别展示。
- 所有设备相关行为单独留证；不能由源码或构建通过推出设备通过。

## Acceptance Criteria

权威步骤、金额和证据要求在 [总验收矩阵](../10-29-core-finance-simplification/acceptance.md)；本子任务必须完成以下条目：

| ID | 验收目标 | 初始状态 |
|---|---|---|
| C1-01 | 核心底部入口与计划/＋返回正确 | 未执行 |
| C1-02 | AI及更多工具可进入、返回，无隐藏触摸覆盖 | 未执行 |
| C1-03 | 20元普通支出最多3个业务步骤 | 未执行 |
| C1-04 | 折叠和键盘切换不丢草稿或载荷 | 未执行 |
| C1-05 | 最近账户失效和作用域切换不沿用错误账户 | 未执行 |
| C1-06 | 退款正确关联，原账户不可用不静默替换 | 未执行 |
| C1-07 | 新建/编辑/取消/保存返回来源并保留位置 | 未执行 |
| C1-08 | 物品/照片/抠图/图标/旧模板仍能访问 | 未执行 |

- [ ] 上表各项留有对应自动化/设备证据并满足结果。
- [ ] 受影响稳定功能ID、字段、入口、API、缺口及局部源码核对日期已同步维护。
- [ ] 向父任务提供 G01–G06 所需的本子任务整合证据。

## Scope Boundaries

只修改 design.md 所列责任范围及按顺序约定的共享接线点。现有工具/历史合同仍可访问。父任务列出的银行/证券执行、虚拟资金覆盖、大型复盘、离线同步及生产部署不属于本子任务。其余子任务未实现的结果不得伪装为已可用。

## Planning Artifacts

技术方案见 [design.md](design.md)，可执行步骤见 [implement.md](implement.md)。本轮只有文档/任务授权，保持 planning，后续按最新完整方案审阅结果激活本子任务。
