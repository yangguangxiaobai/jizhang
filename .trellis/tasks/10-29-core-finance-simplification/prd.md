# 核心记账与财务规划功能精简 PRD

日期：2026-10-29；实施启动：2026-10-30。状态：implementation in progress。用户明确要求按已审阅计划实现全部五个子任务；不包含生产数据变更、部署或真机验收授权。

## Goal

让用户沿着“快速记账 → 看清消费 → 确认本月计划 → 记录存钱与投资完成情况 → 调整下月计划”完成日常管理，减少并列预算、重复配置及需要自行解释的金额。

## Confirmed background

当前维护对象是原生 Android、Fastify API、SQLite 和 shared 计算库。10-28 的项目精简文档主要处理废弃 Web 与内部重构；本任务处理产品操作和功能范围。

| 事实 | 当前源码依据 | 对本任务的约束 |
|---|---|---|
| 理财宿主并列四用途执行、分类信封预算、测算预估 | clients/android/app/src/main/java/com/yansuu1/jizhang/ui/FinancialHostScreen.kt:38 | 合并用户操作主线，不能把三个底层模型当作同一个金额 |
| 工资创建依赖模板；正常首次初始化已提供默认模板 | clients/android/app/src/main/java/com/yansuu1/jizhang/ui/SalarySheet.kt:503；packages/server/src/db/seed.ts:93 | 隐藏日常模板选择，缺失模板须明确修复；不重复生成工资 |
| 支出表单常驻可选理财用途，默认跟随规则 | clients/android/app/src/main/java/com/yansuu1/jizhang/ui/TransactionEditSheet.kt:831 | 折叠选项不丢失已有用途或退款草稿 |
| 普通退款计收入，毛支出不减少；图表仍使用“净支出”文案 | packages/server/src/services/stats-service.ts:260；clients/android/app/src/main/java/com/yansuu1/jizhang/ui/Charts.kt:236 | 先修正文案，不全局更改历史账务算法 |
| “近30天”当前上界取下月初 | clients/android/app/src/main/java/com/yansuu1/jizhang/ui/StatsTab.kt:451 | 改为截至同一次服务端当前时间的滚动30×24小时 |
| 用途执行使用已确认工资、冻结窗口和确认退款分摊 | packages/server/src/services/financial-planning-types.ts:160；packages/server/src/routes/financial-planning.ts:139 | 保留来源核对、重放与跨周期退款归属 |
| 成长、应急尚未接入实际划拨；旧测算备用金为手动当前快照 | clients/android/app/src/main/java/com/yansuu1/jizhang/ui/FinancialExecutionWorkspace.kt:1184；clients/android/app/src/main/java/com/yansuu1/jizhang/ui/FinancialPlanScreen.kt:967 | 新手动进度不能被称为银行核验余额，也不能自动导入旧预测 |
| AI 已占一级导航，高级 Provider 配置已经折叠 | clients/android/app/src/main/java/com/yansuu1/jizhang/ui/MainShell.kt:209；clients/android/app/src/main/java/com/yansuu1/jizhang/ui/ProviderSettings.kt:133 | 调整入口，复用已实现的高级折叠与模型选择 |
| 多文件平台导入已有批次、权威审核和原子确认 | clients/android/app/src/main/java/com/yansuu1/jizhang/repo/AssistantRepository.kt:193；packages/server/src/routes/import-batches.ts | 统一新入口，复用协议，保留旧卡片和确认保护 |

此表是局部源码证据，不代表真机、生产部署或全部功能审计通过。

## Requirements

| ID | 功能目标与可观察行为 | 负责子任务 | 验收 |
|---|---|---|---|
| F01 | 底部为首页、账单、中央＋、计划、我的；AI 为可返回来源的二级工具 | C1 | C1-01、C1-02 |
| F02 | 常规支出突出金额和分类，默认日期与可用账户；可选备注、标签、用途折叠 | C1 | C1-03–C1-07 |
| F03 | 当前计划默认展示消费预算、已确认消费、预算剩余、应急/成长预留；分类明细、旧信封和测算在其下展开 | C2 | C2-01、C2-02、C2-07 |
| F04 | 记一笔的收入入口能进入工资录入；正常默认数据不要求先管理模板，工资保存与计划分配均不重复计入 | C2 | C2-03、C2-08、C2-09 |
| F05 | 类别用途用必要、随心、待归类表达；自动跟随规则和单笔覆盖仍可调整，不猜测历史事实 | C2 | C2-04、C2-06 |
| F06 | 统计默认本月，收入、支出、退款和账面结余名称准确；趋势区间明确，结余池进入高级预算详情 | C3 | C3-01、C3-02、C3-05 |
| F07 | 近30天与指定月份使用服务端窗口；点分类查看完全相同时间和分类范围的账单，返回保留位置 | C3 | C3-03、C3-04、C3-06 |
| F08 | 用户明确确认应急金起始值、存入、取出；展示记录余额、目标、缺口和有条件的达标估计 | C4 | C4-01–C4-05 |
| F09 | 投资只记录计划预留、实际投入本金和取回本金；与技能成长、市场价值、收益明确区分 | C4 | C4-02、C4-06、C4-07 |
| F10 | 新平台账单统一为选文件、人工/可选AI整理、异常核对、权威汇总确认；人工流程不依赖 AI | C5 | C5-01–C5-07 |
| F11 | 物品、抠图、旧模板等低频工具收进更多；保留已有能力及历史入口 | C1、C5 | C1-08、C5-08 |
| F12 | 金额/退款/工资/转账边界、新旧服务兼容、未知结果重放、稳定功能目录和设备证据全部闭环 | 全部 | G01–G06 |

## Scope decisions for review

以下方案是本次实施的批准基线；用户明确要求“按照这个文档来”实现全部精简项。实施不得扩展到生产数据、部署、APK安装或改变原有账务语义。

- 默认以四用途执行作为月计划；分类明细展示其消费事实。旧分类信封与结余池作为高级预算及历史工具，不自动按60%缩放旧分配。
- 普通统计保持毛支出和退款收入；用途执行另标“扣除已归属退款的消费”。目标进度使用用户手动确认的记录，不冒充银行实时余额。
- 工资仍是独立工资事实；金额、账户和收入只写一次。保留一次紧凑的纳入计划确认；跳过后明确待确认，不自动创建周期。
- 首版存钱/投资采用手动起始值与存取/投入记录，不实现同账户多用途虚拟资金归属。
- 新平台导入使用现有多文件批次协议；本应用账单/转账CSV和整库备份继续按自己的合同处理。
- 五个子任务顺序完成并各自验收；任务树只管理本次工作，已有任务作为关联证据。

## Acceptance criteria

权威用例见 [acceptance.md](acceptance.md)，用户总览见 [主计划](../../../docs/superpowers/plans/2026-10-29-core-finance-simplification.md)。

- [ ] C1、C2、C3、C4、C5 的全部验收用例通过，并留有对应证据。
- [ ] G01–G06 跨任务验收通过；后端、Android、本地及真机结果分别记录。
- [ ] 任一未验设备行为、未完成迁移恢复或未解决金额来源问题，都明确保持未通过状态。

## Out of scope

- 银行自动划拨、支付机构同步、证券下单、行情/持仓/收益管理。
- 同账户多个用途的资金覆盖审计、自动分配损失、净储蓄率和连续达标评分。
- 全局退款改账、历史信封重分配、旧手动预测自动转真实资金。
- 新离线数据库、同步队列、ORM、缓存、持久化任务队列或通用状态机。
- 再次删除 Web、重做已完成的 Provider 高级折叠、扩大图片抠图或桌面图标功能。
- 生产数据变更、APK安装到真实设备、生产部署；对用户已有的其他未提交改动不做提交或覆盖。源码、本地测试/构建与部署证据分别记录。

## Artifact status

父任务拥有总需求、子任务映射及跨任务验收。技术设计在 design.md，执行顺序在 implement.md，各子任务另有 PRD、设计、实施步骤和真实上下文清单。规划文档的完成不等于上述功能验收通过。
