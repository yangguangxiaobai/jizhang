# 周期账单 — 需求

> 父任务:`09-11-roadmap-2`,对应 R10。第二阶段「块二」。

## Goal

让固定支出(房租、水电、订阅)不必每月手输:定义一次规则,到期后**生成待确认项**,由用户确认才落为真实账单。

用户价值:记账最烦的不是记,而是**每个月重复记同样几笔**。同时必须避免另一种伤害——自动入账会在用户没看的时候污染账本,让预算数字变得不可信。所以核心设计是**待确认**,不是自动入账。

## Background

### 参考项目行为(权威来源)

`lib/data/models/recurring_transaction.dart` 与 `lib/data/repository/recurring_transaction_repository.dart`:

| 概念 | 参考实现 |
|---|---|
| 规则字段 | `name`、`type`、`amountCents`、`categoryId`、`frequency`、`anchorDate`、`nextDueDate`、`enabled`、`hasOlderDue`、`deleted`、`updatedAt` |
| 频率 | `daily` / `weekly` / `monthly` / `quarterly` / `yearly`(`recurring_transaction.dart:6`) |
| 到期项 | 独立实体 `RecurringOccurrence`:`ruleId`、`periodKey`、`plannedDate`、`status`(`pending`/`confirmed`/`ignored`)、`transactionId`、`amountCents`、`date`、`note` |
| 生成时机 | `generateDueOccurrences()`:遍历**已启用**规则,为已到期的日期生成 `pending` 记录 |
| 上限 | 每条规则每次最多生成**最近 12 个**未生成周期(`:72` 注释、`:81-84`);更早的用 `hasOlderDue` 标记,供 UI 提示 |
| 幂等 | 生成前按 `(ruleId, periodKey)` 查重,已存在则跳过(`:93-100`) |
| 推进 | `nextAfter()` 把 `nextDueDate` 推进到**今天之后**的第一个到期日(`:384-390`) |
| 推进的基准 | `next(frequency, anchorDate, dueDate)` **始终从 `anchorDate` 推算**(`:401-411` 的 `_monthly(year, month, day)`)——所以「每月 31 号」在 2 月落到 28 号,到 3 月会**回到 31 号**,不会永久漂到 28 号 |
| 确认 | `confirmOccurrence(id)`:创建真实账单、把到期项置 `confirmed` 并记 `transactionId`(`:186-241`) |
| 忽略 | `ignoreOccurrence(id)`:只置 `ignored`,不产生账单(`:157-163`) |

### 仓库现状(本任务要新建的部分)

- 数据库**没有** `recurring_rules` / `recurring_occurrences` 表。
- 前端**没有**规则管理页,首页的「待确认」接入点是 T11 预留的空位(`DashboardView.vue` 当前完全不渲染该卡片,AC7 要求"不显示假数字")。
- 参考项目的**本地通知**(`features/notifications/`)在本项目不适用:Web PWA 在 iOS 上无法可靠地发本地通知。本任务改为**应用内提示**(见 R6)。

### 必须遵守的既有硬约定

- **净支出口径**:确认生成的账单必须走既有 `expenseContribution` / `incomeContribution`,退款语义不因来源而改变。
- **金额整数分、时间 epoch 毫秒**;不得引入 `REAL`。
- **软删除**:业务表带 `deleted` 列;账单删除仍是软删除。
- **前端只渲染,不算账**:到期判断、金额汇总由服务端负责。
- **路由必须注册进 `app.ts` 的 `authModule.extraRoutes` 数组**,否则会重演"路由完全无鉴权而单测全绿"的事故。
- **无 body 的 mutating 请求不得送 `Content-Type: application/json`**(否则 Fastify 在路由前返回 400)。
- **按周期分桶的功能,测试必须含至少两个不同周期的数据**。
- 日期相关测试**不得硬编码未来日期**;必须从今天往回推。

## Requirements

### R1 规则管理(后端 + 前端)

- 规则字段:`名称`、类型(收入/支出)、金额、分类、账户、频率(5 种)、**锚定日期**、启用开关
- 支持增删改、启停;删除为软删除
- 校验:金额为正整数分;分类/账户必须存在且未被软删除(沿用既有校验);`anchorDate` 不得晚于今天超过既有宽限(复用 `FUTURE_SLACK_MS` 的口径)
- 前端规则列表 + 编辑页,可启停

### R2 到期项生成

- 必须存在一条"生成已到期项"的路径,对**已启用**规则生成 `pending` 记录
- **幂等**:同一规则的同一计划日期**不得重复生成**;重复调用生成不产生新行
- 生成必须有界:每条规则每次最多生成**最近 N 个**周期(N 在 design.md 定夺并说明),更早的必须用 `hasOlderDue` 之类的标记告知 UI,而不是无界地补历史
- 推进后 `nextDueDate` 必须落在**今天之后**
- **推进的基准必须是 `anchorDate`**,不得是上一次到期日——否则"每月 31 号"会永久漂到 28 号(参考项目 `_monthly` 的语义)
- 生成时机在 design.md 定夺(请求时生成 / 应用启动时生成 / 其它);无论选哪种,都不得引入常驻定时任务(1核1G VPS 约束)

### R3 待确认项处理

- 能列出 `pending` 项,按**计划日期**排序
- **确认**:创建一笔真实账单,并把该到期项置为已确认,同时记录生成的账单 id
- **忽略**:只把到期项置为已忽略,**不产生账单**
- 已确认/已忽略的到期项不再出现在待确认列表
- **确认必须幂等**:对同一条已确认的到期项重复确认,不得产生第二笔账单(这是最容易造成重复记账的地方)
- **不得静默入账**:没有任何路径能在用户未确认的情况下把到期项变成账单

### R4 前端:待确认入口

- 首页的「待确认」卡片由本任务接通(T11 已预留位置)
- 有待确认项时才显示,并显示真实条数;无则不渲染
- 可进入待确认列表页,在那里逐条确认/忽略
- 规则管理页可从"我的"进入(与回收站、模板等既有入口同级)

### R5 与账本口径的一致性

- 生成的账单在账单列表、预算、统计中的表现与手工录入的账单**完全一致**(同一张表、同一套口径)
- 确认一笔支出后,对应模块的已用额与结余池随之变化(由既有引擎自动生效,不需要新算法)
- 规则被禁用后不再产生新的待确认项;已产生的待确认项仍可处理

### R6 提醒方式:应用内

- **不做系统通知/推送**。iOS 上的 Web Push 需要"添加到主屏幕"且受限,参考项目的本地通知能力在 PWA 里没有等价物
- 改为**应用内提示**:打开应用时,若有待确认项,首页显示条数入口
- 该取舍必须写进 PRD 与 spec,避免被当成遗漏

### R7 移动端与无障碍

- 规则页与待确认页的所有可点击元素 ≥ 44px;375px 下无横向溢出
- 不新增底部导航 tab(D12 已定 6 项)
- 只用既有 CSS 语义变量,不写死颜色(为 T16 深色模式留路)

## Acceptance Criteria

全部于 2026-09-11 在运行中的容器上验证。`recurring-e2e` = `packages/server/scripts/e2e-recurring.mjs`(68 项),`recurring-render` = `packages/web/scripts/render-recurring.mjs`(浏览器),`unit` = `packages/server/test/recurring.test.ts`(32 项)+ `packages/shared/test/recurring.test.ts`(26 项)。

- [x] AC1 新建一条"每月"支出规则后,它在规则列表中可见、可编辑、可禁用 — `recurring-e2e`:创建 201、`PATCH` 改名生效、`enabled` 可切换;`recurring-render`:规则页显示名称、频率「每月 2 日」、下次日期与暂停/编辑/删除按钮
- [x] AC2 到期后生成**待确认**项;**没有**任何自动入账 — `recurring-e2e`:生成后 `created > 0` 且**账单数不变**;`unit`:核心断言 `billCount()` 仍为 0
- [x] AC3 重复触发生成不会产生重复的待确认项(幂等) — `recurring-e2e`:第二次 `created === 0` 且队列长度不变;`unit` 同
- [x] AC4 确认一笔待确认项后:出现一笔真实账单、该到期项变成已确认且带上账单 id、账单列表与预算页的金额随之变化 — `recurring-e2e`:账单数 +1、`status='confirmed'`、`transactionId` 等于返回的账单 id;预算模块已用额 `0 → 250000`
- [x] AC5 重复确认同一条到期项**不会**产生第二笔账单 — `recurring-e2e`:`created === false`、返回**同一张**账单、账单数 `1 vs 1`(未增长);`unit` 三重断言
- [x] AC6 忽略一笔待确认项后:不产生任何账单,且它不再出现在待确认列表 — `recurring-e2e`:账单数不变、离开队列、**再次生成也不复活**、对已忽略项确认返回 409
- [x] AC7 禁用规则后不再产生新的待确认项;已产生的仍可确认或忽略 — `recurring-e2e`:禁用后 `created === 0` 且不记账;重新启用把游标推进到未来(`2026-10-03`)而非补历史
- [x] AC8 "每月 31 号"的规则在 2 月落到当月最后一天,并在 3 月**回到 31 号**(不永久漂移)— `unit`(`shared`):`1/31 → 2/28 → 3/31 → 4/30 → 5/31 → 6/30` 全序列断言,含闰年 2/29、quarterly、yearly;`recurring-e2e` 实测 `days 31,30,31,30,31,31`
- [x] AC9 一次生成超过上限时,只生成最近 N 个,并且有明显的"还有更早的到期项"标记,而不是静默丢弃 — `recurring-e2e`:12 期、`truncated=1`、`hasOlderDue=true`,且保留的是**最新**的 12 期;前端 `RecurringRulesView` 渲染警告条
- [x] AC10 首页在有待确认项时显示真实条数并可进入;无待确认项时该卡片完全不渲染 — `recurring-render`:有 3 项时首页显示「3 笔到期账单」+「去确认」;清空后该卡片**消失**且首页其余部分正常
- [x] AC11 生成规则覆盖 5 种频率;至少一种频率的测试包含**两个不同周期**的数据 — `unit`(shared)5 种频率各自推进 + `dueDatesBetween` 的跨两月用例;服务层用 daily/weekly/monthly 三种频率
- [x] AC12 375px 下无横向溢出,新增可点击元素均 ≥ 44px,`check-mobile.mjs` 与 `check-pwa.mjs` 通过 — 两个构建期审计 PASS(期间修掉一个 24px 复选框:改为 `appearance: none` 的 44px 重绘,与 `TransactionEditView` 同一方案);`recurring-render` 实测 `scrollWidth=375`、无 <44px 控件
- [x] AC13 既有测试与容器 e2e 全绿;本任务新增能力均有对应测试(单测 + 新 e2e 套件)— 单测 **269 → 301**(新增 32);shared **54 → 80**(新增 26);容器 e2e **367 → 435**(新增 `e2e-recurring.mjs` 68 项);全部既有套件零回归,且用不同顺序跑两遍验证无顺序依赖

### 实现时发现的真实缺陷(已修)

**`AC9` 的截断方向反了。** 初版把全部到期日枚举出来后从**前端** `slice(0, MAX+1)`,于是"保留最近 12 期"实际保留了**最旧**的 12 期——weekly 锚定 6 月时得到 `06-08…08-24`,而正确结果是 `06-29…09-14`。

它只在超出上限时暴露,所以前两个生成用例都没抓到;是专门为 AC9 写的"超过上限"用例(以及一次直接打印服务输出的探针)才把它逼出来。现在改为**边遍历边限制窗口**,并写进 `spec/backend/index.md`。

## Out of Scope

- **系统通知 / Web Push / 本地通知** — R6 已说明,iOS PWA 无可靠等价物
- **常驻定时任务 / cron** — 与 1核1G VPS 的约束冲突;生成在请求时或应用打开时完成
- **自动入账(无确认)** — 明确禁止;待确认是本任务的核心保护
- **在待确认项上直接改金额后确认** — 参考项目允许,但会引入"到期项与账单不一致"的状态;本期要求先改规则,或忽略后手工记一笔
- **账单模板 / 快速记账预设** — 与周期账单是两件事
- **规则的结束日期 / 次数上限**(如"分期 12 期后停止")— 参考项目也没有;可用手动禁用替代
- **跨设备同步**(D4/D7)

## Technical Notes

- **`periodKey` 是否需要**:参考项目用 `'2026-09'` / `'2026-W37'` 这类自然键做幂等。本项目明确规定**月分组键必须是整数**(字符串比较下 `'2026-12' < '2026-9'` 是第一阶段真实 bug),因此**倾向用 `(ruleId, plannedDate)` 作为唯一性约束**,而不是引入字符串周期键。design.md 必须给出结论与理由。
- **`hasOlderDue` 的语义**:它标记"仍有更早的到期项未被生成"。UI 必须显示,否则用户会以为系统漏了。参考项目 `:72` 的注释明确这是给 UI 做可见提示用的。
- **推进基准是 `anchorDate` 而非上次到期日**,这是参考项目 `_monthly`(`:401-406`)的关键语义;用错会让月末规则永久漂移(AC8)。
- 确认操作的幂等性是**本任务最危险的失效模式**:重复确认 = 重复记账,而用户很难发现。必须有单测 + e2e 双重覆盖。
- 生成路径要么在读取待确认列表时顺带执行,要么提供一个显式端点;design.md 定夺,并说明为什么不会漏生成。
- 新增 e2e 套件名为 `e2e-recurring.mjs`;`resetToKnownState()` 需要**新增清理这两张表**,否则套件之间会互相污染(既有基线只清 `transactions` / `budget_allocations` / `salary_records` / `settings`)。

## Open Questions

无。范围由父任务 R10 界定;生成时机、N 的取值、`periodKey` 取舍、推进基准的存储方式在 design.md 中给出结论与理由。
