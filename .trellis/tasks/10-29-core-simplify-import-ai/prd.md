# C5 统一账单导入与按需 AI PRD

日期：2026-10-29；实施：2026-10-30。状态：in_progress；本地C5实现与测试门禁已闭环，设备验收待执行。

## Goal

新平台导入只需一个工作区，默认人工核对，AI按需分析；权威确认、旧卡片和其他数据格式都保持正确。

## Background

参考 [父任务需求](../10-29-core-finance-simplification/prd.md)、[父设计](../10-29-core-finance-simplification/design.md)及 [用户主计划](../../../docs/superpowers/plans/2026-10-29-core-finance-simplification.md)。对应需求：F10、F11；依赖：C1、C4。父任务不是自动依赖引擎，按 implement.md 的顺序执行。

- AssistantRepository.kt:193 creates batches under real conversationId-bound routes.
- Current batch protocol is already paged and review/confirm validates original files and approved categories.
- DataTab has a separate legacy platform panel; app-native CSV and backups have different contracts.
- ProviderSettings.kt:133 already defaults advancedExpanded=false; do not reimplement the existing model-picker/folding feature.

## Requirements

- 实现本子任务负责的 F10、F11，采用父PRD中的推荐范围，实施前审阅完整版本。
- 新平台导入只需一个工作区，默认人工核对，AI按需分析；权威确认、旧卡片和其他数据格式都保持正确。
- 保留父设计要求的金额、历史、请求作用域和重放边界；错误/待核对与空数据分别展示。
- 所有设备相关行为单独留证；不能由源码或构建通过推出设备通过。

## Acceptance Criteria

权威步骤、金额和证据要求在 [总验收矩阵](../10-29-core-finance-simplification/acceptance.md)；本子任务必须完成以下条目：

| ID | 验收目标 | 初始状态 |
|---|---|---|
| C5-01 | 数据/AI的新平台导入共用工作区；取消不建空批次 | 未执行 |
| C5-02 | 无AI人工可用，全程模型调用0 | 未执行 |
| C5-03 | 1–5文件、5/8MiB及500行合同保留 | 未执行 |
| C5-04 | 异常优先仍可看全部；备注/选项/分页草稿准确 | 未执行 |
| C5-05 | 权威总计/批准/哈希/令牌验证与原子确认正确 | 未执行 |
| C5-06 | 双击/未知结果/分析失败不重复入账或偷重发模型 | 未执行 |
| C5-07 | 旧单文件卡/本应用CSV/转账CSV/备份兼容 | 未执行 |
| C5-08 | 已有Provider高级折叠、模型与真实状态保持 | 未执行 |

- [ ] 上表各项留有对应自动化/设备证据并满足结果。
- [ ] 受影响稳定功能ID、字段、入口、API、缺口及局部源码核对日期已同步维护。
- [ ] 向父任务提供 G01–G06 所需的本子任务整合证据。

## Scope Boundaries

只修改 design.md 所列责任范围及按顺序约定的共享接线点。现有工具/历史合同仍可访问。父任务列出的银行/证券执行、虚拟资金覆盖、大型复盘、离线同步及生产部署不属于本子任务。其余子任务未实现的结果不得伪装为已可用。

## Planning Artifacts

技术方案见 [design.md](design.md)，可执行步骤见 [implement.md](implement.md)。本轮只有文档/任务授权，保持 planning，后续按最新完整方案审阅结果激活本子任务。
