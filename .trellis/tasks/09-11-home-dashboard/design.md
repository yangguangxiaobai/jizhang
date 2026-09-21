# 首页仪表盘 — 技术设计

> 前置阅读:`prd.md`、`.trellis/spec/frontend/index.md`、`.trellis/spec/frontend/state-management.md`

## 1. 关键约束与由此推出的设计

| 约束(来源) | 推出的设计 |
|---|---|
| 前端不重算口径(`spec/frontend/index.md:14-16,47-53`) | 本月收入/支出**只能**来自后端;首页做零金额运算,只做格式化 |
| 前端不新增必要接口即可满足(`client.ts:218-225,289-300`) | 复用 `stats.monthlyTrend` + `budget.overview`,不新建端点 |
| 用户决定:工资计入所有地方的收入(本轮 Q1) | **必须改后端** `monthlyTrend`,把 `salary_records` 计入 `incomeCents` |
| 统计页已有 35 项 e2e 断言(`scripts/e2e-stats.mjs`) | 该套件必须补工资场景,并复核既有断言在含工资时仍成立 |
| 构建期强制移动端 44px 与 PWA 审计 | 首页新增控件必须遵守,否则 `pnpm build` 直接失败 |

## 2. 后端改动(本任务唯一的跨层改动)

### 2.1 变更点

`packages/server/src/services/stats-service.ts` 的 `monthlyTrend(months)`(`:212-245`):

现状只遍历账单表(`:228` `loadTransactions(firstStart, end)`),把 `incomeContribution` 累加进 `income`。

改为:**在同一窗口内额外读取 `salary_records`,把 `amount_cents` 累加进对应月份的 `income`。**

### 2.2 新增读取路径

`SalaryService` 现有 `list(limit = 200)`(`salary-service.ts:184-191`)是**全量 + LIMIT**,不能用于按窗口聚合(200 条上限会静默截断历史)。

新增一个窗口读取方法:

```ts
/**
 * Live salary records inside `[from, to)`, for income aggregation.
 *
 * Windowed rather than `list()`'s `LIMIT 200`: a chart over a long range must not
 * silently truncate history.
 */
listInWindow(from: number, to: number): { amountCents: number; date: number }[]
```

- 走 `WHERE deleted = 0 AND date >= ? AND date < ?`
- 与 `list()` 的 `deleted = 0` 口径一致(软删除的工资不计入收入)
- `StatsService` 已经 import 了 `SalaryService`(`stats-service.ts:34`),并已在 `cycleConfig()`(`:250`)里实例化,复用同一模式,不引入新依赖

### 2.3 月份归属

工资按 `startOfMonthOf(salary.date)` 归入月份桶,**与账单完全同一套月份归约函数**(`stats-service.ts:229`)。

绝不复用 `monthStartOffset`,那是"从锚点算窗口起点";单条记录归月必须用 `startOfMonthOf`。二者混用是本项目已记录过的真实 bug 类型(见 `stats-service.ts:71-80` 的注释)。

### 2.4 明确不做:工资不进 `categoryShare`

`categoryShare`(`:166-203`)按 `category_id` 分组,而 `salary_records` **没有 `category_id` 列**(`salary-service.ts:218` 的 INSERT 列清单可证)。

**决定:工资不计入 `categoryShare`。**

理由:分类占比回答的是"钱花在哪类",工资没有分类,给它编一个分类(如"其他收入")就是在编造数据;而"本月收入多少"这个问题不需要分类。因此:

- `monthlyTrend.incomeCents` = 账单收入 + 工资 ✅
- `categoryShare` 维持纯支出语义不变 ✅

这必须在 `stats-service.ts` 的模块 docblock 里写清楚,否则下一个人会以为 `categoryShare` 漏了工资是个 bug。

### 2.5 重复计入的风险与处置

用户若既用「记工资」记录了 10000,又手工记了一笔 10000 的收入账单,**收入会显示 20000**。

评估:**不在本任务做去重**。理由:
- 两笔记录在数据上确实是两条独立事实,去重规则(金额相同?同日?同备注?)无法可靠判定,任何猜测都会误删合法数据
- 参考项目同样不处理此情形
- 用户在自己控制记账习惯的前提下,这是"重复录入"这一行为问题,不是算法问题

此限制写入 PRD §Out of Scope 与 spec,不静默留下。

## 3. 前端改动

### 3.1 路由与导航

`packages/web/src/router/index.ts`:

- 新增 `dashboard` 路由,占 `/`(空 path child)
- `TransactionsView` 移到 `transactions` 路径,**保留 `name: 'transactions'` 不变**
- 登录页的 `next` 重定向与 `router/index.ts:101` 的"已登录跳过登录页"目标改为 `dashboard`

> `name` 必须保留:`TransactionsView`、`BudgetView` 等处存在 `router.push({ name: 'transactions' })` 一类引用,且 e2e 依赖可预测的落点。只改 `path`,不改 `name`。

`packages/web/src/views/AppShell.vue`:

- 底部导航从 5 项扩为 6 项,首页排在第一位
- `grid-template-columns` 必须从 `repeat(5, 1fr)` 同步改为 `repeat(6, 1fr)`
- 每项 `min-height: 56px` 保持不变(≥44px 锚点);6 项在 320px 宽屏上约 53px/项,仍在阈值之上

**风险**:6 个中文标签(首页/账单/预算/记一笔/统计/我的)在窄屏会换行。缓解:标签字号保持 `0.75rem`,并在 design 中记录的备选方案是"我的"改图标+短标签。若 `check-mobile.mjs` 或人工实测发现溢出,回退到 5 项方案(见 §4)。

### 3.2 数据获取

首页不新建 store,直接组合既有 store:

| 数据 | 来源 | 说明 |
|---|---|---|
| 本月收入/净支出 | `api.stats.monthlyTrend(1)` 末点 | 新增轻量调用;不放进 budget store(职责不同) |
| 周期预算 | `useBudgetStore().loadOverview()` | 直接复用 `overview` / `overBudgetModules` / `poolIsNegative` |
| 最近账单 | `api.transactions.list({ limit: 5, ... })` | 见 §3.3 |

`monthlyTrend(1)` 的返回是**数组**,取末点前必须处理空数组。按 `noUncheckedIndexedAccess`(已开启),`points[points.length - 1]` 是 `T | undefined`,必须显式判空 ——**不得用 `!` 断言**(spec 禁止)。

月份标签用返回的 `monthStart` 渲染,**不用前端 `new Date()` 另算**,以保证与后端口径一致。

### 3.3 最近账单的排序

需要 `date DESC, updated_at DESC`。**先核实** `routes/transactions.ts` 的 list 是否已支持该排序;若不支持:

- 允许在前端对**已取回的 5 条**做稳定排序
- 这不违反"前端不重算":排序不是金额聚合
- 但必须在代码注释里写明这是排序而非计算,避免被误读为违规

### 3.4 待确认入口占位

T13 未落地前的处理:**完全不渲染该卡片**,而不是渲染一个恒为 0 的卡片。这样 AC7("不显示假数字")自动成立,且不会占用版面。

接入点:一个独立的 `DashboardPendingCard.vue` 组件位(或等价的结构位置),T13 只需往这里塞真实计数。

### 3.5 颜色与深色模式准备

只用既有 CSS 变量(`--surface` / `--border` / `--muted` / `--accent`)。收支颜色若既有代码已有语义变量,复用;否则新增语义变量而非两处写死色值,为 T16 留路。

## 4. Tradeoffs

| 选择 | 备选 | 为什么这样选 |
|---|---|---|
| `monthlyTrend` 计入工资(改后端) | 首页单独加一个"工资"卡片(纯前端) | 用户明确要求工资计入所有地方;且纯前端方案会让"收入"一词在首页与统计页含义不同 |
| 首页零新增接口 | 新增 `GET /api/v1/summary` 专用端点 | 现有接口已够用;少一个端点 = 少一处口径分叉。若后续首页需求变复杂(如需要"上月对比"),再引入专用端点 |
| `categoryShare` 不含工资 | 给工资编"其他收入"分类 | 不编造数据;分类占比的语义是"支出构成" |
| 底部导航扩到 6 项 | 首页不做 tab,只做默认落点 | 若不做 tab,用户在账单页就无法回首页(只能靠浏览器手势),体验不成立。但 6 项有拥挤风险,故列为待确认 |
| `TransactionsView` 只改 path 不改 name | 改成 `transactions` 语义化重命名 | 降低回归面;`name` 是既有代码与测试的契约 |

## 5. 兼容性与迁移

- **数据库:** 无 schema 变更。本任务不新增表、不新增列、不需要迁移。
- **API 契约:** `MonthlyTrendPoint` 的字段与类型**不变**,只有 `incomeCents` 的**取值语义**扩展为含工资。既有前端无需改动即可受益(统计页图表会自动开始显示工资收入)。
- **行为变化(需明确告知):** 统计页的月度收入柱状图在记过工资后会出现更高的柱子。这是**预期变化**,不是回归。
  - **实施时核实(2026-09-11):** 原先担心的"既有 35 项 e2e 断言需同步更新"**并不成立**。`e2e-stats.mjs` 在断言月度趋势时(第 105–116 行)尚未创建任何 `salary_records`(`POST /salaries` 在第 141 行),单测同样只用收入类**账单**而非工资记录。因此既有断言全部原样通过,本任务对 e2e 是纯增量(新增 6 项工资检查)。
- **回滚:** 后端改动集中在 `stats-service.ts` 的 `monthlyTrend`、`SalaryService` 的一个新方法、以及 `app.ts` 的一处 `onSend` 钩子,单 commit 可整体 revert。前端为新增路由与视图,revert 后 `/` 回到账单列表。

### 5.1 验证过程中发现并修复的跨切面问题:API 响应可被浏览器缓存

**不是本任务的设计内容,但在验证 AC9(断网不白屏)时暴露出来,故记录在此。**

`/api/**` 当时**没有任何 `Cache-Control` 头**(静态资源有)。`spec/frontend/quality-guidelines.md` 的 Forbidden Patterns 已经禁止缓存 API,并给出了正确性与隐私理由,但那条规则只被 Service Worker 的 `NetworkOnly` 路由和两个断言执行——**浏览器自身的 HTTP 缓存被漏掉了**。

修复:`packages/server/src/app.ts` 增加一个 `onSend` 钩子,对 `/api` 前缀统一设置 `Cache-Control: no-store`;SPA 外壳刻意不加(已安装的应用必须能离线打开)。`test/app.test.ts` 新增 3 项断言,其中一项覆盖 404 路径,以证明该头来自钩子而非各路由的成功分支。

**一次被推翻的中间结论(保留以警示):** 我最初判断"离线时渲染旧数据"是 HTTP 缓存命中导致 `fetch` 成功所致。该结论来自 CDP 的 `Network.emulateNetworkConditions`,而实测证明**该模拟在此 Chrome 构建下并未断网**(`navigator.onLine === true`、`fetch` 返回 200),因此那几轮"离线验证"全部无效。改用**真实停止容器**后,真正的行为是:登录态解析失败 → 停在登录页 → 显示 `无法连接服务器`,**从未**渲染过期账目。`no-store` 因此被保留是基于隐私与口径一致性的独立理由,而不是"它修好了旧数据"——后者不成立。

**可复用的教训:** 验证离线行为必须真的断掉连接。协议级模拟要先自证有效(例如断言 `navigator.onLine === false` 或 `fetch` 抛错),否则它给出的"通过"与"失败"都是噪声。

## 6. 验证方案

| 层次 | 验证 |
|---|---|
| 单测(`packages/server/test/`) | `monthlyTrend` 在以下情形正确:仅账单、仅工资、两者混合、工资被软删除、工资落在窗口边界(`from` 含 / `to` 不含)、跨月 |
| 单测 | `listInWindow` 的 `[from, to)` 边界与 `deleted = 0` 过滤 |
| 单测 | `categoryShare` **不**因存在工资记录而变化(防回归) |
| e2e(`scripts/e2e-stats.mjs`) | 补工资场景;复核既有 35 项在含工资账本下仍成立 |
| e2e(`scripts/e2e-home.mjs`,新增) | 首页落点、AC2 与统计页逐分相等、AC3 与预算页相等、最近 5 条排序、空账本引导态 |
| 前端构建 | `pnpm --filter @jizhang/web run build` 必须通过 `check-mobile.mjs` 与 `check-pwa.mjs` |
| 人工 | iPhone 宽度(375px)下 6 项导航不溢出、不换行 |

## 7. 已决问题

- **Q2 底部导航扩为 6 项 —— 已决(用户 2026-09-11)。** 新增「首页」tab 并排第一位,底部为:首页 / 账单 / 预算 / 记一笔 / 统计 / 我的。`grid-template-columns` 同步改为 `repeat(6, 1fr)`。
  - **构建期必须验证**:`check-mobile.mjs` 通过,且 375px 宽度下 6 个标签不换行、不溢出。若溢出,按 §3.1 的缓解措施(缩短个别标签文案)处理,而不是回退到 5 项 —— 用户已明确选择 6 项。
