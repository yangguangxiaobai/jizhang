# 首页仪表盘

> 父任务:`09-11-roadmap-2`。本任务交付第二阶段「块一」的一半;`09-11-trash` 是并列的另一半。

## Goal

给应用一个**首页**:打开就看到「本月过得怎么样」和「预算还剩多少」,而不是直接掉进账单流水。参考项目的 `features/home/dashboard_page.dart` 就是这个角色,本项目第一阶段缺失。

用户价值:记账应用的第一屏应该回答"这个月我还能花多少",而不是要求用户自己去翻列表算。

## Background

### 仓库现状(已核对)

- `packages/web/src/router/index.ts:21-26` — `/` 直接渲染 `TransactionsView`(`name: 'transactions'`),不存在首页路由。
- `packages/web/src/views/AppShell.vue:126-135` — 底部导航固定 5 个 tab:`账单 / 预算 / 记一笔 / 统计 / 我的`,注释明确写着这 5 项。
- `packages/web/src/api/client.ts:218-225` — `BudgetOverview` 已含 `modules`、`carryoverPoolCents`、`totalBudgetCents`、`totalSpentCents`、`hasBudget`、`cycle`。
- `packages/web/src/api/client.ts:289-300` — `MonthlyTrendPoint` 已含 `month`、`monthStart`、`incomeCents`、`netExpenseCents`;`stats.monthlyTrend(months)` 已可用。
- `packages/web/src/stores/budget.ts` — `loadOverview()`、`overBudgetModules`、`poolIsNegative`、`usedRatio` 均已存在,首页可直接复用。
- `packages/server/src/services/stats-service.ts:212-245` — `monthlyTrend(months)` 天然包含**当月**(`anchor = this.now()`,offset 从 `safeMonths-1` 递减到 0),且月份无活动时补零。

**结论:首页不需要任何新后端接口。** 现有 `stats.monthlyTrend(1)` 取末点即本月口径,`budget.overview()` 即周期口径。

### 参考项目行为(权威来源)

`lib/features/home/dashboard_page.dart:159-277`:

| 区块 | 行为 | 本项目对应 |
|---|---|---|
| 标题 | `${year}年${month}月概览` | 复用 |
| 汇总卡 | income / expense 两项 | 复用 |
| 待确认提醒卡 | `pendingCount > 0` 时才出现,点击跳账单页 | **本期只做占位**,计数由 T13 接通 |
| 预算卡 | `budget` = 各模块预算之和,`spent` = 各模块已用之和,`hasBudget = modules.isNotEmpty` | 复用 `BudgetOverview.totalBudgetCents` / `totalSpentCents` / `hasBudget` |
| 快捷入口 | — | 复用 |
| 最近账单 | 按 `date` 倒序、同日期按 `updatedAt` 倒序,**取 5 条**;无数据时显示空状态 | 复用 |
| 账单行点击 | 进入该账单编辑页 | 复用 |

参考项目在客户端 `.fold()` 求和(`dashboard_page.dart:176-190`),**本项目不得照抄** —— 见下。

### 必须遵守的既有硬约定(仓库证据)

`.trellis/spec/frontend/index.md:14-16, 47-53`:

> **The client renders; it does not compute.** Every accounting figure — net expense, the carryover pool, charts — is computed by the server from `@jizhang/shared`.
>
> **Do not re-derive a total on the client.** Formatting cents is fine; summing expenses, or deciding what counts as income, is not.

所以本月收入/支出只能来自后端,**不能**在前端 `reduce` 账单数组。这是本任务与参考项目实现方式的唯一实质性偏离。

## Requirements

### R1 首页路由与导航

- 新增首页视图,作为**登录后的第一屏**(`/` 的默认落点)
- 底部导航新增「首页」tab 并排在第一位,导航共 **6 项**:首页 / 账单 / 预算 / 记一笔 / 统计 / 我的(已决)
- `TransactionsView` 必须仍可通过既有路由名 `transactions` 到达(既有"查看全部"、`router.push` 与测试依赖路由名,只改 `path` 不改 `name`)
- 未登录访问首页仍走既有鉴权门(`router/index.ts:92-109`),不得绕过

### R2 本月汇总

- 展示**本月收入**、**本月支出(净支出)**、**本月结余**(= 收入 − 净支出)
- 数值必须来自后端既有口径接口,**前端不得对账单数组求和**
- **本月收入 = 账单收入 + 工资记录**(已决,用户 2026-09-11)。因此后端 `monthlyTrend` 必须把 `salary_records` 计入收入,见 design.md §2
- 月份标签必须是真实当前月份,且与后端返回的 `monthStart` 一致(不得用前端本地时间另算一个月份)

### R3 周期预算卡

- 展示当前周期的总预算、总已用、剩余,以及使用进度
- 有超支模块或结余池为负时,首页要有可见的提示(复用 `overBudgetModules` / `poolIsNegative`)
- `hasBudget === false`(没记过工资)时显示引导态,而不是显示一堆 0
- 可跳转到预算页

### R4 待确认入口(占位)

- 预留「待确认账单」提醒位。T13 未落地前**不得显示假数字**(不得写死 0 以外的值,也不得显示一个永远为 0 的卡片占用版面)
- T13 落地后由 T13 接通;本任务只需保证接入点清晰

### R5 最近账单

- 取最近 **5 条**账单,排序规则与参考项目一致:按 `date` 倒序,同日期按 `updatedAt` 倒序
- 每条显示:分类名(备注为空时用分类名,与参考项目 `dashboard_page.dart:252-254` 一致)、带符号金额、收支颜色区分
- 点击进入该账单编辑页
- 无数据时显示空状态并引导"记一笔"

### R6 移动端与 PWA 约束

- 所有可点击元素触摸目标 ≥ 44px(`packages/web/scripts/check-mobile.mjs` 会在构建时强制)
- 不允许 `user-scalable=no` 一类回退(`check-pwa.mjs` 会检查)
- 首页不得新增需要联网才能渲染的空壳;断网时按既有离线策略降级(外壳可开,数据区显示既有错误/离线态)
- 新增首页不得让主 chunk 显著膨胀(既有约束:~42 kB gzipped,`spec/frontend/index.md:17-18`)

## Acceptance Criteria

All verified 2026-09-11 on the running container. `home-e2e` = `packages/server/scripts/e2e-home.mjs` (46 checks), `render` = `packages/web/scripts/render-dashboard.mjs` (browser).

- [x] AC1 登录后落在首页,底部导航可进入首页,当前 tab 高亮正确 — `render`: 登录后 DOM 为 `2026年9月概览`(非账单页),6 个 tab 存在且首页为第一项
- [x] AC2 首页显示本月收入/净支出/结余,三项数值与统计页同一月份的数值**完全一致**(逐分相等);收入含工资记录 — `home-e2e` 断言 `dashboard=1200000/140000 chart=1200000/140000`(同源,因此结构上相等)
- [x] AC3 首页的周期预算数值与预算页**完全一致**(总预算/总已用/剩余)— `home-e2e` 断言预算 = 工资 1000000、已用 140000、剩余 860000,与 `/budget/overview` 同源
- [x] AC4 有超支模块时首页出现可见提示;`hasBudget === false` 时显示引导态而非全 0 — `home-e2e`:空账本 `hasBudget=false` 且无模块;`render`:结余池为负时渲染出 `结余池已被透支,本周期支出超过了预算`
- [x] AC5 最近账单恰好最多 5 条,排序为 `date` 倒序、同日期 `updatedAt` 倒序;点击进入该账单编辑页 — `home-e2e`: `limit=5` 恰好 5 条、倒序、同日期 `同一天B,同一天A`;编辑跳转由 `render` 的 tab/路由审计与既有 `transaction-edit` 路由覆盖
- [x] AC6 账单列表页仍可到达(既有路由名 `transactions` 未变),既有 e2e 与前端行为不回归 — `/transactions` 返回外壳 200;全部 266 项容器 e2e 通过
- [x] AC7 待确认入口在 T13 之前不显示任何假数字(该卡片完全不渲染)— 模板中无该卡片,`render` 的离线与在线文本中均无待确认计数
- [x] AC8 `check-mobile.mjs` 与 `check-pwa.mjs` 通过;375px 宽度下 6 项导航不换行不溢出;主 chunk 体积无显著增长 — 两个审计均 PASS;`render` 实测 6 tab 各 **63×57px**、`scrollWidth=375`、无 <44px 控件;主 chunk **42.64 kB gzip**(基线 ~42 kB)
- [x] AC9 断网后打开首页不白屏(降级为可读的离线/错误态)— `render` 真实停容器:`#app` 894 字符、可交互控件 3 个、显示 `无法连接服务器:Failed to fetch`,且**无任何账目数字被当作当前数据渲染**
- [x] AC10 新增「记工资」记录后,统计页与首页的本月收入同步增加(验证后端语义扩展生效)— `e2e-stats` 6 项工资检查 + `home-e2e` 收入 = 账单收入 + 工资
- [x] AC11 `categoryShare` 在存在工资记录时结果不变(工资不进分类占比)— 单测 `does not fold salary income into the expense category share` 断言前后结果 `toEqual` 且 `totalCents` 不变

## Out of Scope

- **待确认账单的真实计数与跳转** — 由 T13(周期账单)交付,本任务只留接入点
- **新后端接口** — 现有接口已满足;若实施中确需新接口,必须先回到本文件改范围并说明理由
- **图表移入首页** — 统计图表仍在统计页
- **自定义首页卡片 / 拖拽排序 / 卡片显隐配置**
- **首页下拉刷新** — 除非实施中证明必要,默认复用既有 `onMounted` 加载
- **深色模式适配** — 由 T16 统一处理;本任务只需使用既有 CSS 变量,不写死颜色

## Technical Notes

- **口径来源(本任务最关键的技术决定)**:
  - 本月收入/净支出 ← `api.stats.monthlyTrend(1)` 的末点(`incomeCents` / `netExpenseCents`),该接口内部走 `incomeContribution` / `expenseContribution`
  - 周期预算 ← `api.budget.overview()`(既有 `budget` store 的 `loadOverview()`)
  - 最近账单 ← `api.transactions.list({ limit: 5, sort: ... })`,排序参数以实现为准(见 design.md)
- **工资记录不是账单,缺省不在 `monthlyTrend` 的收入里**:`stats-service.ts:228` 只遍历账单表,工资落在 `salary_records` 表。若首页收入直接取 `monthlyTrend` 末点,会出现**"记了 10000 元工资,首页本月收入仍显示 0"**。Q1 已决为"工资计入收入",故本任务必须扩展后端 `monthlyTrend`,见 design.md §2。
- **`updatedAt` 同日期次级排序**需要后端 `transactions.list` 支持,或前端在已取回的 5 条内排序。若后端不支持该次级排序,必须在前端仅对这 5 条做稳定排序(允许,因为它不是"重算金额",只是排序),并在 design.md 说明。
- 复用既有 CSS 变量(`--surface` / `--border` / `--muted` / `--accent`),不引入新的颜色字面量,为 T16 深色模式留路。
- 新增前端行为需要对应的 e2e 断言,接入既有 `packages/server/scripts/` 套件风格与重置基线。
- **工资与手工收入账单会重复计入**:**不实现去重**(见 design.md §2.5)。若既用「记工资」记录 10000,又手工记一笔 10000 收入账单,首页与统计页收入会显示 20000。这是预期的数据录入行为,不是缺陷。
- **统计页既有收入语义会变化**:`incomeCents` 由"纯账单收入"扩展为"账单收入 + 工资"。统计页收入柱状图在记过工资后会变高,这是**预期变化**;既有 e2e 断言需同步更新(implement.md 阶段 0.5、2.1)。
- **统计页既有收入语义会变化**:`incomeCents` 由"纯账单收入"扩展为"账单收入 + 工资"。统计页收入柱状图在记过工资后会变高,这是**预期变化**;既有 e2e 断言需同步更新(implement.md 阶段 0.5、2.1)

## Open Questions

无。Q1(工资是否计入收入)与 Q2(底部导航是否扩为 6 项)均已由用户在 2026-09-11 决定,已折入 §Requirements 与 §Technical Notes。
