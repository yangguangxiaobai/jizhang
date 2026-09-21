# 预算深化 — 技术设计

> 前置阅读:本任务 `prd.md`(R1–R6、AC1–AC11,**权威**)、父任务 `.trellis/tasks/09-11-roadmap-2/prd.md` §R11、
> `.trellis/spec/backend/index.md`、`.trellis/spec/backend/quality-guidelines.md`、
> `.trellis/spec/frontend/index.md`、`.trellis/spec/frontend/state-management.md`。
>
> 本任务范围 = **历史周期回看 + 结余池按周期呈现**;多模板按 R5 **仅复核,不实现、不重构**。

---

## 1. 关键约束与由此推出的设计

| 约束(来源) | 推出的设计 |
|---|---|
| 历史回看必须复用引擎口径,不得另写一套;引擎缺能力就扩展引擎 + 补单测,不得在路由层拼算(prd.md:43;父 R11:85) | 扩展 `@jizhang/shared` 的 `computeModuleViews` 接受"目标周期";路由只解析入参、转交引擎 |
| 引擎把"当前周期"**位置化**写死为最新分组(见 §2.1) | 新增**可选** `periodStart`;省略时走原代码路径,**响应逐字节不变** |
| AC4:不带周期参数时"总览接口的**响应**与第一阶段完全一致" | **不得**给 `/budget/overview` 的响应加任何字段;"有哪些周期"由**新端点** `GET /api/v1/budget/periods` 提供 |
| AC3 + R2:非法周期入参必须 400,**不得静默回退**(否则用户以为在看 A 月、实际看 B 月) | 先用引擎自报的周期列表校验存在性,不命中即 `ValidationError`(→400) |
| AC2 + AC7:结余池数值必须与引擎口径一致,且趋势序列末端须等于 `computeCarryoverPool` 当前值 | 历史周期的池直接取 `computePoolTrend` 已产出的**对应点**,不新算;不动 `computeCarryoverPool` 签名 |
| R4:池趋势优先用既有 `pool-trend`,`除非` design.md 论证其不足 | **它已经足够**(§2.2):`stats-service.ts` 与 `routes/stats.ts` **零改动** |
| 自然月模式的周期起点是**组内最早发薪日**,不是 1 号(`budget-engine.ts:102`) | 周期标识一律用引擎自报的 `group.start` / `periodStart`,**不得**用月键或"当月 1 号" |
| 已关闭周期的窗口约定已存在于引擎:`[本周期起点, 下一(更新)周期起点)`(`:317-334`、`:462-482`) | 历史周期的 `end` 复用该约定;**不得**用 `nextPeriodStart` 拼历史窗口 |
| 前端只渲染、不算账(`spec/frontend/index.md:14-16,47-53`) | 前端只传 `periodStart`、只格式化;所有金额来自响应 |
| "选中哪个周期"属于 URL 而非 store(`state-management.md:28-29`) | 选中态放既有 `budget` 路由的 query;**不新增路由**(见 §4.5) |
| AC8:单测必须含 ≥2 个周期,且起始日 clamp 在历史周期上同样正确 | 全部新单测使用 ≥2 周期夹具;额外补 `start-day: 31` 的跨月 clamp 历史用例 |
| AC10 + R6:新增可点元素 ≥44px、375px 无横向溢出、`check-mobile.mjs`/`check-pwa.mjs` 通过;不新增导航 tab | 选择器与"回到当前周期"按钮 `min-height: 44px`;不碰 `AppShell.vue` 与 `router/index.ts` |
| 金额整数分、时间 epoch 毫秒;月分组键为整数 `year*100+month`(父 Technical Notes:122) | 新字段一律 `*Cents` / epoch-ms;不引入字符串日期与浮点 |

---

## 2. 调查结论(全部 `file:line`,不是推断)

### 2.1 三个引擎函数如何认定"当前周期" —— 结论:**位置化写死,必须扩展引擎**

| 函数 | 签名 | 解析"当前周期"的行 | 是否读时钟 |
|---|---|---|---|
| `computeModuleViews` | `budget-engine.ts:229-231` `(input: ComputeModuleViewsInput): ModuleView[]` | `:232` 解析 `cycle`;`:237` `groupByCycle`;**:238 `const current = groups[0]`**;`:240` anchor;`:243-246` start;`:248-251` end | **否** |
| `computeCarryoverPool` | `:292-294` `(input: ComputeCarryoverPoolInput): number` | `:300` `groupByCycle`;**:301 `const current = groups[0]`**;**:305 `const historical = groups.slice(1)`**;`:307-310` currentStart | **否** |
| `computePoolTrend` | `:408-412` `(input: Omit<…,'currentModuleViews'> & { currentModuleViews?: … }): PoolTrendPoint[]` | `:418` `groupByCycle`;`:440` `oldestFirst = groups.slice().reverse()`;**:459 `if (i === lastIndex) continue`**(最新周期不进池);`:489-501` 末点替换 | **否** |

三个函数**都不读时钟、不读库**(纯函数,`:8-10` docblock 明写),`ComputeModuleViewsInput`(`:214-221`)与
`ComputeCarryoverPoolInput`(`:270-276`)的字段里**没有任何**能表达"我要第几个周期"的入参。

**"当前周期"在这三个函数里的真实含义是:`groupByCycle` 排出的最新分组**(`groupByMonth` 按 `monthKey` 降序
`:99-103`,`groupByPeriod` 按 `periodStartOf` 降序 `:121-122`),也就是**最近一次有分配记录的周期** ——
它**不是**"包含今天的周期"。用户的最后一次工资若在 3 个月前,`groups[0]` 就是那个 3 个月前的周期,
而自然月模式给它的 `end` 是 `null`(`:248-251`),即"从那天起、无上界"。

→ **结论:这是"必须扩展引擎",不是"增加调用点"。** 过去周期无法用任何现有入参表达,
必须给 `computeModuleViews` 增加目标周期选择,并补单测(prd.md R1:52-59 的要求)。

### 2.2 结余池趋势 —— 引擎**已经具备**,`stats-service.ts` 零改动

- `computePoolTrend`(`:408-504`)遍历**全部**周期分组(升序,`:440-483`),**每个周期产出一个点**
  `PoolTrendPoint { periodStart, poolCents }`(`:375-380`)。"按周期看池"在数据层已完成。
- `poolTrend()`(`stats-service.ts:309-340`)已包成 DTO(`PoolTrendPointDto`,`:62-65`),
  `GET /api/v1/stats/pool-trend`(`routes/stats.ts:81-83`)已提供,客户端类型已存在(`client.ts:296-300`),
  `StatsView.vue:102-125` 已画出 sparkline。
- 唯一的"当前"假设是**末点替换**:`:485-501` 用 `currentModuleViews` 把最后一点的 `poolCents`
  换成"截至此刻的可用池",`periodStart` 不动。该替换的目的正是让序列末端 == `computeCarryoverPool`
  (`stats-service.ts:305-308`;`test/stats.test.ts:559-561`、`e2e-stats.mjs:171-179` 断言)。
- **真正缺的是呈现**:sparkline 没有周期标签、没有逐周期数值(`StatsView.vue:258-265` 只有一句文字说明),
  用户看不出"哪个点对应哪个周期"。

→ **结论:R4 不需要任何后端改动。** 明确记:本任务对 `packages/server/src/services/stats-service.ts`
与 `packages/server/src/routes/stats.ts` **不做修改**。

### 2.3 周期如何标识 —— 用引擎自报的 `periodStart`,不用月键

- 引擎的规范周期键是 `group.start`:自然月 = 组内**最早分配日** `earliestDate(bucket)`(`:102`);
  起始日 = `periodStartOf(startDay, a.date)`(`:116`),而 `groupByPeriod` 直接把该值当 key 存进 `start`(`:122`)。
  两种模式下 `group.start` 都是本地日 00:00 的 epoch 毫秒。
- `computePoolTrend` 把同一个值对外报为 `PoolTrendPoint.periodStart`(`:452-456`),所以
  **`periodStart` 就是引擎已经对外承诺过的周期标识**,引入它 = 零新概念。
- **不能用 `year*100+month` 月键**:自然月周期起点不是 1 号,月键无法表达"7/5 起算"的周期边界;
  月键的用途是"按月分组"(`monthKey`,`date-utils.ts:43-46`),不是"按预算周期"。
- `currentCycleRange`(`:190-208`)虽已导出,但**全仓无调用点**(grep 确认),且也只能回答"当前",不构成回看能力。

### 2.4 多模板 —— 已完整交付,本任务只复核(R5)

`prd.md:25-35` 已把结论写定,并已独立核对:`routes/budget.ts:200-235`、`template-service.ts:170-251`
与比例校验 `:94-96,108-112`(容差 `1e-4`)、`TemplatesView.vue`、`SalaryEntryView.vue:162-169` + `:126`、
`client.ts:269`、`salary-service.ts:224-229,288-291`;测试 `test/budget.test.ts:183-209`、
`e2e-budget.mjs:177-189`。**本期零实现**;若复核发现缺陷,按 R5:84 记录为独立问题,不顺手改。

### 2.5 工作量归纳

| 块 | 真实工作量 |
|---|---|
| R1 引擎 | `periodStart` + `listCycleStarts` + 单测(**主体**) |
| R2 后端 | `/budget/overview?periodStart=` + 新端点 `/budget/periods` + 单测 |
| R3 前端 | `BudgetView.vue` 周期切换 + 历史提示 + 回到当前 |
| R4 前端 | `StatsView.vue` 池趋势逐周期可读化(**后端零改动**) |
| R5 多模板 | 仅复核既有测试 |
| R6 | 44px / 375px / 既有 CSS 变量 |

---

## 3. 后端改动

### 3.1 引擎扩展:`ComputeModuleViewsInput.periodStart`

`packages/shared/src/budget-engine.ts`:

```ts
export interface ComputeModuleViewsInput {
  readonly allocationsDesc: readonly BudgetAllocation[];
  readonly transactions: readonly Transaction[];
  readonly cycle?: CycleConfig;
  /**
   * Cycle to report, identified the same way `PoolTrendPoint.periodStart` reports it
   * (the group's own start: the earliest salary day for `natural-month`, the configured
   * boundary for `start-day`).
   *
   * Omitted = the newest cycle, which is the behaviour every existing caller depends on
   * and must not change. An unknown start yields `[]`; the route validates first, so a
   * `[]` here always means "no live allocations".
   */
  readonly periodStart?: number;
}
```

替换 `:237-241` 的 `groups[0]` 硬编码:

```ts
const groups = groupByCycle(live, cycle);
const index =
  input.periodStart === undefined
    ? 0
    : groups.findIndex((group) => group.start === dateOnly(input.periodStart));
if (index < 0) return [];
const target = groups[index];
if (target === undefined) return [];
```

替换 `:248-251` 的 `end`:

```ts
// The newest cycle keeps the existing rule. Any older cycle is a CLOSED cycle, and a
// closed cycle's window is [its start, the next newer cycle's start) — the convention
// `computeCarryoverPool` (:317-334) and `computePoolTrend` (:462-482) already use.
// `nextPeriodStart` is deliberately NOT used: in `natural-month` mode there is no
// calendar definition of "the next cycle" (the engine uses `end = null`, :187/:248-251),
// and mixing the two would make a historical module view disagree with the pool
// arithmetic for the very same cycle.
const end =
  index > 0
    ? (groups[index - 1]?.start ?? null)
    : cycle.kind === 'natural-month'
      ? null
      : nextPeriodStart(cycle.day, start);
```

`dateOnly` 已在 `:26` 导入,不新增依赖。

**不变式(必须写成单测)**:对最新周期,显式传 `periodStart` 与省略参数**逐字段相等**;
自然月与 `start-day` 两种模式都要覆盖。

### 3.2 引擎新增:`listCycleStarts`

```ts
/**
 * Period starts of every live cycle, ascending — the authoritative answer to "which
 * cycles exist", used to populate the period picker and to validate a requested
 * `periodStart`.
 *
 * Built on the same `groupByCycle` as the rest of the engine, so it can never disagree
 * with `computePoolTrend(...).map((p) => p.periodStart)` (unit-tested).
 */
export function listCycleStarts(
  allocationsDesc: readonly BudgetAllocation[],
  cycle: CycleConfig = { kind: 'natural-month' },
): number[];
```

约 10 行纯函数。备选方案见 §5。

### 3.3 路由:`GET /api/v1/budget/overview?periodStart=`

今天该路由是 `async (_request, reply)`(`routes/budget.ts:121`),**不接受任何 query 参数**
(全仓 grep:stats 路由有 `from`/`to`/`months`/`monthStart`,budget 路由一个都没有)。

```ts
app.get('/api/v1/budget/overview', async (request, reply) => {
  const allocations = loadAllocations();
  const transactions = loadTransactions();
  const cycle = cycleConfig();

  const query = (request.query ?? {}) as Record<string, unknown>;
  const raw = query['periodStart'];            // '' and undefined mean "omitted",
  let requested: number | undefined;           // matching routes/stats.ts:52/:71/:93
  if (raw !== undefined && raw !== '') {
    const value = Number(raw);
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      throw new ValidationError('periodStart must be an epoch-millisecond timestamp.');
    }
    requested = value;
  }

  const starts = listCycleStarts(allocations, cycle);   // ascending
  const target = requested === undefined ? undefined : dateOnly(requested);
  if (target !== undefined && !starts.includes(target)) {
    // Fail loudly. Silently falling back to the current cycle would show one month's
    // numbers under another month's heading (prd.md R2:65, AC3).
    throw new ValidationError('Unknown budget period.');
  }

  const views = computeModuleViews({
    allocationsDesc: allocations, transactions, cycle,
    ...(target === undefined ? {} : { periodStart: target }),
  });
  // :146-160 unchanged: totalBudgetCents / totalSpentCents / hasBudget
  //                     / budgetCents-descending sort / category-name join
```

`carryoverPoolCents` —— **本任务必须定夺的语义,结论如下:**

- `periodStart` **省略**时:走今天的代码路径 `computeCarryoverPool({ …, currentModuleViews: views })`
  (`:131-136`),**一个字符都不改** → AC4 成立。
- `periodStart` **显式给出**时:取既有池趋势序列中 `periodStart === target` 的那一点
  `computePoolTrend({ …, currentModuleViews: views }).find(p => p.periodStart === target)?.poolCents`,
  即 **`points[index]` = "该周期开始时的结余池"**。

**为什么是"周期开始时"而不是"周期结束时"/"期间借用后"(§9 待复核项 1):**

1. `points[index]` 是引擎**已经算好并已经在图表上画出来**的那个数。若改用"结束时"(`points[index+1]`),
   预算页对周期 k 显示的数字会等于趋势图上周期 k+1 的点 —— 同一周期在两张屏上给出不同数字,
   直接制造"两页对不上"的 bug 报告。取 `points[index]` 则**一周期一数字,预算页与趋势图逐分相同**。
2. 它**不需要任何新算术**(纯索引),因此不可能与引擎口径分叉 —— AC2 "与引擎口径一致"是构造性成立的。
3. 对**最新**周期,`points[last]` 已被引擎刻意替换为实时池(`:485-501`),因此在"显式请求最新周期"时
   它仍然等于 `computeCarryoverPool` 的当前值 —— 与省略参数的结果一致(必须是单测断言项)。
4. 语义上它配得上一句真话:「该周期开始时你有多少可用额度」+ 该周期的模块是否把它花超。
   注意:已关闭周期的**自身剩余/超支要等周期关闭才进池**(`:337-356` 的 ② 与 `:332` 的 ①),
   所以这个数**有意不包含**该周期自己的剩余。UI 文案必须写清(§4.3),否则会被读成 bug。

**为什么不改成"截断分配列表 + 调 `computeCarryoverPool`"**:`computeCarryoverPool` 的 ③ 步只处理
**超支**模块(`:360-366`),它不会把同一周期内**未超支**模块的剩余加进池;而已关闭周期的剩余必须经 ① 步
(`:332`)进入。`e2e-budget.mjs:159-166` 记录的正是这个区别("一个模块超支、其它模块没花,该周期整体仍为正")。
所以截断重算会给出**错误**的历史池值。这也再次证明:历史池只能取既有序列的点。

### 3.4 新端点:`GET /api/v1/budget/periods`

AC5 要求"能列出可回看的周期"。因为 AC4 要求总览接口在无参时响应完全不变,**不能**把周期列表塞进
`/budget/overview` 的响应,故独立成端点:

```ts
app.get('/api/v1/budget/periods', async (_request, reply) => {
  const cycle = cycleConfig();
  const starts = listCycleStarts(loadAllocations(), cycle);   // ascending
  return reply.send({
    periods: starts,
    currentPeriodStart: starts[starts.length - 1] ?? null,
    cycle,
  });
});
```

- 无分配 → `periods: []`、`currentPeriodStart: null`(AC5 的"隐藏或禁用"由前端据此判断)。
- `cycle` 一并返回,前端不必额外请求 `/settings` 就能正确格式化。
- 该端点落在既有 auth 模块内,与 `:22` 的说明一致 —— 沿用同一注册块,守卫自动覆盖。

### 3.5 明确不做

- 不在路由做任何金额加减(只解析 → 交引擎 → 组装)。
- 不改 `stats-service.ts` / `routes/stats.ts`(§2.2)。
- 不改 `computeCarryoverPool` / `computePoolTrend` 的签名与行为(保护 AC7 的既有契约)。
- 不给 `/budget/overview` 的响应增删任何字段(AC4)。
- 不动 `transaction-service.ts` / `routes/transactions.ts` / `router/index.ts`(并发任务 `09-11-trash` 的文件)。

---

## 4. 前端改动

### 4.1 `packages/web/src/api/client.ts`

```ts
budget: {
  overview: (periodStart?: number) =>
    request<BudgetOverview>('/api/v1/budget/overview', { query: { periodStart } }),
  periods: () => request<BudgetPeriods>('/api/v1/budget/periods'),
  // ...
}
```

`buildUrl`(`:59-68`)丢弃 `undefined` 与 `''`,所以省略参数时 URL 与今天**逐字符相同**。
新增类型 `BudgetPeriods { periods: number[]; currentPeriodStart: number | null; cycle: CycleConfig }`;
`BudgetOverview`(`:218-225`)**不改动**。

### 4.2 `packages/web/src/stores/budget.ts`

- `loadOverview(periodStart?: number)` 透传;
- 新增 `periods` / `currentPeriodStart` 两个 `ref` 与 `loadPeriods()`;
- `loadAll()`(`:83-96`)继续以无参调用 `loadOverview()`,并加入 `loadPeriods()`;
- **不**在 store 里放"当前选中的周期"(`state-management.md:28-29`)。

### 4.3 `packages/web/src/views/BudgetView.vue` —— 周期切换(核心)

选中态放**既有 `budget` 路由的 query**(`router/index.ts:46-49`,**不新增路由、不改路由文件**):

- `selectedPeriodStart = computed(() => { const raw = route.query.periodStart; const value = Number(raw); return Number.isFinite(value) && raw !== undefined && raw !== '' ? value : undefined; })`
- `watch(selectedPeriodStart, (value) => { void budget.loadOverview(value); }, { immediate: true })`
- 选择器选项来自 `budget.periods`,标签由 `periodStart` 格式化为本地 `YYYY-MM`(**仅格式化**,
  `state-management.md:48` 允许);`@change` → `router.replace({ name: 'budget', query: { periodStart: String(value) } })`
  → 由 URL 驱动加载(单一数据源,后退键即"回到上一个周期",深链可分享)。
- **AC6 历史提示**:`isHistory = selectedPeriodStart !== undefined && selectedPeriodStart !== budget.currentPeriodStart`
  为真时显示「历史周期」徽标,并把池的标签从「累积结余池」改为「该周期开始时的结余池」;
  同时给出「回到当前周期」按钮 → `router.replace({ name: 'budget' })`(清空 query)。
- **AC5 无历史时隐藏**:`budget.periods.length <= 1` → 不渲染选择器与历史控件(不渲染空选择器、不报错)。
- 当前周期项的文案沿用既有「本周期」口径(`:57`、`:84`),但 design 层已记录它的精确定义是
  **"最近一次有分配记录的周期"**(§2.1)—— 可能不是"包含今天的月份"。
- AC10:选择器与「回到当前周期」按钮 `min-height: 44px`;`grid` 布局保证 375px 不横向溢出。
- 模块进度条、超支提示(`:92-94`)、三个入口按钮(`:131-147`)的既有逻辑**不动**。
- 只用既有 CSS 语义变量(`--surface`/`--border`/`--muted`/`--accent`/`--danger`),不写死颜色(R6)。

### 4.4 `packages/web/src/views/StatsView.vue` —— 池趋势按周期可读化

数据已存在(`pool.value.points`,`:103`),**后端零改动**。在结余池卡片(`:229-266`)的 sparkline 之后补一个
逐周期表格(`周期 | 结余池`),形态对齐既有月度收支表(`:208-225`):最新周期在前、`formatYuan`、
负数沿用 `.negative` 类;数据来自 `pool.points` 倒序展示,**零聚合**。
保留 `:258-260` 的空态与 `:262-265` 的说明(hint 的措辞已经与 §3.3 选定的语义一致)。

沿用既有手写 SVG sparkline(`spec/frontend/component-guidelines.md:46-57` 不引图表库),不新增依赖。

### 4.5 不改动的文件(与并发任务隔离)

`packages/web/src/router/index.ts`、`packages/web/src/views/AppShell.vue`、
`packages/web/src/views/TransactionsView.vue` 及 `views/` 下回收站相关视图、
`packages/server/src/services/transaction-service.ts`、`packages/server/src/routes/transactions.ts`。
**不新增路由、不新增导航 tab**(R6:89)。

---

## 5. Tradeoffs

| 选择 | 备选 | 为什么这样选 |
|---|---|---|
| 周期列表放**新端点** `/budget/periods`,总览响应**一个字段都不加** | 把 `periods`/`periodStart`/`isCurrentPeriod` 塞进 `/budget/overview` 响应 | AC4 的字面要求是"不带周期参数时**响应**与第一阶段完全一致"。加字段虽然对既有断言无害,但违反该字面要求;独立端点还顺带避免了"池字段语义随 flag 变化"的设计。代价:预算页多一次请求(该页本来就有 4 个并发请求,可接受) |
| 扩展 `/budget/overview` 加可选 `periodStart` | 新增 `GET /api/v1/budget/period?periodStart=` | 少一个端点 = 少一处口径分叉;query 可选参数对既有调用方零影响;R2:63 也允许等价端点 |
| 历史池 = `points[index]`("该周期**开始时**的池") | `points[index+1]`("该周期**结束时**的池") | 见 §3.3 四点论证:与趋势图对同一周期给同一个数、零新算术、最新周期自动等于今天的行为、且语义上配得上"这个周期开始时我有多少额度"。**已由用户拍板选定前者的** —— 见 §9 第 1 条 |
| 周期标识用引擎自报的 `periodStart` | 用整数月键 `year*100+month` | 自然月周期起点是组内最早发薪日(`:102`),不是 1 号,月键无法表达;`periodStart` 已由 `computePoolTrend` 对外提供 |
| 历史窗口终点 = 下一(更新)周期起点 | `nextPeriodStart(day, start)` | 自然月模式没有"下一周期"的日历定义(引擎刻意 `end = null`,`:187`);"下一周期起点"已是 `:317-334` 与 `:462-482` 对已关闭周期的既有约定。用 `nextPeriodStart` 会让模块视图与池算术走不同窗口 |
| 新增 `listCycleStarts`(约 10 行) | 从 `computePoolTrend(...).map(p => p.periodStart)` 派生 | 后者把"有哪些周期"变成趋势函数的副作用,且校验入参要白算整条序列。前者可单测、被 2 个调用点共享。**若评审偏好更小的引擎表面积,可退化为后者**,代价是失去"周期列表与趋势逐点相等"这条直接的防漂移断言 |
| 选中周期放 URL query | 放 Pinia store | `state-management.md:28-29`;store 方案会让后退键失效 |
| 周期切换内嵌预算页 | 新增 `/budget/history` 路由与视图 | `router/index.ts` 由并发任务 `09-11-trash` 拥有;query 参数零路由改动,也避免两任务在同文件冲突;R6:89 亦要求不新增 tab |
| 引擎对未知 `periodStart` 返回 `[]` | 引擎抛错 | `@jizhang/shared` 必须保持纯函数、不依赖服务端错误类型;合法性校验属于路由边界。路由先用 `listCycleStarts` 校验并抛 `ValidationError`,因此 `[]` 语义上只剩"无分配" |
| 多模板零实现(R5) | 按 R11 字面重做 | 已完整交付且有单测 + e2e(§2.4);重做 = 第二份 100% 比例校验规则,必然漂移 |

---

## 6. 兼容性与迁移

- **数据库:无 schema 变更。** 不新增表/列、不需要迁移。`budget_allocations` 已在按周期存历史
  (`salary-service.ts:243-248`,`date` 即周期起点),本任务只是给它一个入口。
- **`@jizhang/shared`:** `periodStart` 为**可选**输入;新增导出 `listCycleStarts`。既有调用点
  (`routes/budget.ts:126`、`stats-service.ts:318`、全部单测)不传新参数即行为不变。
- **HTTP 契约:**
  - `GET /api/v1/budget/overview` —— **响应形状完全不变**(仅新增可选 query 参数);
    省略参数时行为与今天逐字段相同(AC4)。
  - `GET /api/v1/budget/periods` —— 全新端点,无既有调用方。
  - `GET /api/v1/stats/pool-trend` —— 不动。
- **行为变化:** 无。这是本设计的硬指标:所有新行为都必须由**新的入参**触发。
- **已知语义边界(必须写进 UI 文案与 spec,否则会被当 bug):**
  1. "当前周期"= **最近一次有分配记录的周期**,不是"包含今天的月份"(`§2.1`)。
  2. 自然月模式下周期起点 = 该周期内**最早的发薪日**;同月多次记工资**合并为一个周期**
     (`:83-104`;`test/budget.test.ts:636-645`)。**周期数 ≠ 工资条数**,选择器不得被描述成"工资记录"。
  3. 周期起点**之前**的消费不计入该周期的模块已用额,而按引擎既有规则直接扣减结余池(`:337-356`)。
     所以历史周期的"已用"= "那个周期内的模块净消费",与当时的实时视图口径一致 —— 这正是 AC1 要的。
  4. 历史周期显示的池是**该周期开始时**的池,不含该周期自身的剩余(§3.3)。

---

## 7. 回滚

| 回滚点 | 范围 | revert 后 |
|---|---|---|
| **R1**(阶段 1) | `budget-engine.ts` 的 `periodStart` + `listCycleStarts` + `test/budget-engine.test.ts` 新增用例 | 引擎回到"只能算当期";`shared` 单测全绿 |
| **R2**(阶段 2) | `routes/budget.ts` 的可选参数 + `/budget/periods` + `test/budget.test.ts` 新增用例 | `/budget/overview` 回到无 query 参数;新端点消失。前端若已上选择器会拿到 404,故 **R2 与 R3 必须同批发布,或先回滚 R3** |
| **R3**(阶段 3) | `client.ts` / `stores/budget.ts` / `BudgetView.vue` / `StatsView.vue` | 预算页回到"只看当前周期";池趋势表消失;后端能力仍在但无人调用 |

R1 与 R2/R3 相互独立;R2+R3 是"历史回看"这一个用户可见能力的完整边界,应同 commit。
R4(前端呈现)与 R5(仅复核)没有可回滚的后端耦合。多模板**无代码可回滚**。

---

## 8. 验证方案(逐条映射 AC1–AC11)

> 每一个分桶/周期用例**都必须含至少两个不同周期的数据**;单周期夹具抓不到错误的周期键
> (`spec/backend/quality-guidelines.md:114-132`,本项目真实事故)。

| AC | 层次 | 具体测试 |
|---|---|---|
| **AC1** 切到历史周期,模块预算/已用/剩余与当时一致且**与当前周期不同** | 引擎单测 | ≥2 周期夹具:周期 A(7/5 发薪 1,000,000,food 400,000)、周期 B(8/5 发薪)。A 内支出 550,000、B 内支出 10,000。`computeModuleViews({periodStart: A})` 的 `food.spentCents === 550000` 且 **B 的 10,000 不进该视图**;`computeModuleViews({})` 仍等于 B(两者必须不同) |
| AC1 | 引擎单测 | 与"当时"一致:把 A **单独**喂进去得到的当期视图,与 `periodStart: A` 的结果逐字段相等(证明是同一口径,不是近似) |
| **AC2** 超支高亮 + 该周期池与引擎口径一致 | 引擎单测 | A 周期 food 超支时 `isOverBudget(view) === true`(`types.ts:138-140`),页面 highlight 条件与之一致;服务端单测断言 A 周期的 `carryoverPoolCents === computePoolTrend 中 A 点的 poolCents`(**构造性相等**) |
| **AC3** 非法周期 → 400,不静默回退 | 服务端单测 | `?periodStart=abc`、`?periodStart=1.5`、`?periodStart=<不存在的时间戳>` 均 400;并断言响应**不是**当前周期的数据(错误包符合 `spec/backend/error-handling.md`) |
| **AC4** 无参响应与第一阶段一致,既有测试原样通过 | 服务端单测 | `describe('AC11 budget overview')`(`test/budget.test.ts:525-646`)**一行不改**全绿;另加断言:无参响应与显式传最新周期起点时**逐字段相等**(含 `carryoverPoolCents`) |
| **AC5** 列出可回看周期;≤1 个周期时控件隐藏/禁用不报错 | 服务端 + 前端 | `GET /budget/periods` 返回升序 `periods` 与 `currentPeriodStart`;无工资时 `periods === []`、`currentPeriodStart === null`;前端 `periods.length <= 1` 时不渲染选择器 |
| **AC6** 历史提示 + 一键回到当前 | 浏览器复核 | 375px 下切到历史周期出现「历史周期」徽标与「回到当前周期」按钮;点击后 URL query 清空、数值回到当期;浏览器后退键回到上一周期 |
| **AC7** 池趋势按周期 + 末端 == `computeCarryoverPool` 当前值 | e2e(`e2e-stats.mjs`)+ 服务端单测 | 既有一致性断言(`:171-179`、`test/stats.test.ts:559-561`)**保持通过**;新增 `points.length === 周期数`、`periodStart` 升序;前端呈现不改变任何数值 |
| **AC8** 引擎单测覆盖 ≥2 周期 + 起始日 clamp 在历史周期同样正确 | 引擎单测 | (a) ≥2 周期夹具见 AC1;(b) `start-day: 31` 的历史夹具:分配落在 `2026-03-31` 与 `2026-04-30`(即 `periodStartOf(31, …)` 的 clamp 结果,`date-utils.ts:88-111`),查 3/31 周期时窗口终点必须是 **4/30**(下一周期起点),4/15 的支出进、4/30 的支出不进;再补 2 月:周期起点 `2026-01-31` → 下一周期 `2026-02-28`,2/27 进、2/28 不进。**注意 `day = 31` 无法通过 `/settings` 设置**(`salary-service.ts:30-31`、`:451-459` 限制 1..28),故该用例只能直接调引擎,与既有 `budget-engine.test.ts:493-497` 的直接调用同构 |
| **AC9** 多模板复核,引用既有测试,不新增实现 | 复核 | 运行并引用:`test/budget.test.ts:183-209`(显式 `templateId` 走该模板比例)、`:276-297`(比例和 1e-4 容差 / 重复分类)、`e2e-budget.mjs:177-189`(非默认模板)。**不新增实现**;发现缺陷按 R5:84 记录为独立问题 |
| **AC10** 375px 无横向溢出 + ≥44px + 两项审计通过 | 前端构建 + 浏览器 | `pnpm --filter @jizhang/web run build` 必须通过 `check-mobile.mjs` 与 `check-pwa.mjs`;375px 浏览器复核选择器与按钮可点、无横向滚动 |
| **AC11** 既有 235 项单测 + 266 项容器 e2e 全绿,新增能力均有测试 | 门禁 | `pnpm -r run lint`、`pnpm -r run typecheck`、`pnpm -r run test`、`pnpm --filter @jizhang/web run build`、全部容器 e2e;**换顺序/各跑两次确认计数不变**(`quality-guidelines.md:153-155`) |
| R1 补充 | 引擎单测 | `listCycleStarts` 与 `computePoolTrend(...).map(p => p.periodStart)` **逐元素相等**(防漂移);退款在历史视图仍为负贡献(`expenseContribution`);周期起点之前的支出不进该周期模块 |
| R3 补充(AC3 的"口径一致") | e2e(`e2e-budget.mjs`) | 历史周期窗口 = `[periods[k], periods[k+1])`(取自新端点);对该窗口调 `/stats/category-share?from=&to=`,断言每个有分配的模块 `spentCents` 等于对应分类的 `amountCents` —— 用另一条既有路径证明同口径 |

---

## 9. 已决事项(用户 2026-09-11 拍板)

1. **历史周期的结余池语义 —— 已决:取 `points[index]`,即"该周期开始时的结余池"**(§3.3)。
   理由:与趋势图对同一周期给出同一个数;不需要任何新算术,因此构造性地与引擎口径一致;最新周期那一端仍等于 `computeCarryoverPool` 的实时值。
   **明确否决** `points[index + 1]`("该周期结束时的池"):它会让预算页在周期 k 显示趋势图为周期 **k+1** 绘制的数字,即两个页面对同一个周期给出不同数字——那会变成一份我们自找的 bug 报告。
2. **`listCycleStarts` —— 已决:新增**(§3.2)。
   它同时服务于"校验非法周期"与"列出可回看周期"两处,且有测试;代价是引擎表面积略增。保留它换来一条直接断言:**周期列表与 `computePoolTrend` 的点逐点相等**(反漂移)。这与本项目既有的 `poolTrend` 末端必须等于 `computeCarryoverPool` 的契约是同一类做法。
3. **周期列表用独立端点 `/budget/periods` —— 保留**(§3.4)。
   代价是预算页多一次 GET;换来 AC4 的**字面**要求成立:不带参数时总览响应**完全一致**,而不是"既有测试恰好还通过"。
4. **不新增路由,周期切换走 `budget` 路由 query —— 已决**(§4.3)。
   用户明确选择"直接在预算页加周期选择器"。这同时使本任务**完全不碰 `router/index.ts`**,与并发的 `09-11-trash` 冲突面为零。

### 9.1 已记录但不在本任务内处理的问题

- **AC8 的 clamp 无法通过 HTTP 验证**:`day` 被限制在 1..28(`salary-service.ts:30-31`),而 clamp 语义只在 day > 28 时生效(`date-utils.ts:88-111`)。因此该 AC 只能如既有 `budget-engine.test.ts:493-497` 那样在引擎层验证。**这不是缺陷,也不改代码**;验收时按"引擎层已验证"记录,并在 PRD 的 AC8 证据里写明。
- **`stats-service.ts` 不需要改动**,尽管父任务 PRD 的技术备注把它列为改动面之一(依据 §2.2)。已在该 PRD 中标注更正。
