# 预算深化 — 执行计划

> 前置阅读:本任务 `prd.md`(R1–R6、AC1–AC11,权威)→ `design.md`。
> 按阶段顺序执行;**每个阶段结束都是一个可回滚点**。多模板(R5)**零实现**,只在阶段 5 复核。

## 阶段 0:前置核实(写代码之前,不得猜测)

- [ ] 0.1 读 `packages/shared/src/budget-engine.ts:214-264`,确认 `ComputeModuleViewsInput` 的三个字段、
      `:238` 的 `groups[0]`、`:243-251` 的 `start`/`end` 规则
- [ ] 0.2 读 `budget-engine.ts:270-369`,确认 `computeCarryoverPool` 的 `:301` `groups[0]`、`:305`
      `groups.slice(1)`、**:317-334 的"已关闭周期窗口 = `[本周期起点, 下一(更新)周期起点)`"**、
      :337-356 的无现役周期消费、:358-366 的"只处理超支模块" ③ 步
- [ ] 0.3 读 `budget-engine.ts:371-504`,确认 `PoolTrendPoint { periodStart, poolCents }`(`:375-380`)、
      每周期一点(`:440-483`)、`:459` 最新周期不进池、**:485-501 末点被替换为实时池**
- [ ] 0.4 读 `packages/server/src/routes/budget.ts:121-162`,确认:无任何 query 参数、
      `:146-160` 的 totals/`hasBudget`/按 `budgetCents` 降序/分类名 join 是必须保留的既有行为
- [ ] 0.5 读 `packages/web/src/api/client.ts:59-68`,确认 `buildUrl` 丢弃 `undefined` 与 `''`
      → 省略 `periodStart` 时 URL 与今天逐字符相同
- [ ] 0.6 读 `packages/web/src/router/index.ts:46-49`(**只读,不得修改**),确认 `name: 'budget'` 存在、
      周期选择可用 query 承载而无需改路由文件
- [ ] 0.7 读 `packages/server/src/routes/stats.ts:41-101` 的 query 解析写法(`raw === undefined || raw === ''`
      视为省略)→ 新参数沿用同一 house style
- [ ] 0.8 列清必须保持不动的既有断言:`packages/shared/test/budget-engine.test.ts` 各 describe
      (M1-M3 `:98`、P1-P4 `:297`、配置周期 `:505`/`:550`、池趋势一致性 `:626`)、
      `packages/server/test/budget.test.ts:525-646`(AC11 overview)、
      `packages/server/test/stats.test.ts:540-589`(池趋势契约)
- [ ] 0.9 确认 `packages/web` **当前没有单测文件**(glob `packages/web/**/*.test.ts` 为空)
      → 前端验证靠构建期审计(`check-mobile.mjs`/`check-pwa.mjs`)+ e2e + 浏览器复核
- [ ] 0.10 读 `packages/server/scripts/e2e-budget.mjs:21-33,64-215`,确认它**已经**构造 M2/M1/M0
      三段连续周期夹具与精确池期望;历史回看的 e2e 断言应挂在既有夹具上,不另起套件
- [ ] 0.11 复核 R5 的既有证据仍在:`test/budget.test.ts:183-209`、`:276-297`、`e2e-budget.mjs:177-189`
      (只读,不改)

**门禁:** 0.3 若发现 `PoolTrendPoint.periodStart` 与 `group.start` 不相等,停止并回到 design.md §2.3
重新设计 —— 周期标识的一致性是本次契约的支点。0.4 若发现响应字段的既有语义与 design.md §3.3 冲突,
先改 design.md 再动代码。

---

## 阶段 1:`@jizhang/shared` 引擎扩展(R1 / AC1 / AC8)

- [ ] 1.1 `packages/shared/src/budget-engine.ts`:`ComputeModuleViewsInput`(`:214-221`)增加可选
      `readonly periodStart?: number`,注释写明"省略 = 最新周期,既有行为不得改变"
- [ ] 1.2 选取逻辑:把 `:237-241` 的 `groups[0]` 改为
      `periodStart === undefined ? 0 : groups.findIndex((g) => g.start === dateOnly(input.periodStart))`;
      未命中返回 `[]`(骨架保持全函数,合法性校验属于路由边界)
- [ ] 1.3 `end`(`:248-251`):`index > 0` → `groups[index - 1]?.start ?? null`(已关闭周期沿用既有窗口约定);
      `index === 0` → 原规则。**不得**对历史周期使用 `nextPeriodStart`
      —— 自然月模式没有"下一周期"的日历定义(`:187`)
- [ ] 1.4 新增导出 `listCycleStarts(allocationsDesc, cycle?)`,返回升序的 `group.start` 列表,
      内部复用 `groupByCycle`;docblock 写明它与 `computePoolTrend` 的 `periodStart` 序列必须一致
- [ ] 1.5 单测(`packages/shared/test/budget-engine.test.ts`)—— **每个用例都必须含 ≥2 个不同周期的数据**
      (`spec/backend/quality-guidelines.md:130-132`;单周期夹具抓不到错误的周期键):
  - 历史周期模块视图:该周期的预算/已用/剩余正确,更新周期的支出**不**进该视图(AC1)
  - 与"当时"一致:把该周期单独喂进去的当期视图做对照,逐字段相等(AC1 后半)
  - **不变式**:显式传最新周期起点 与 省略参数 逐字段相等 —— 自然月 与 `start-day: 10` 两种模式(AC4 的引擎侧)
  - 未知 `periodStart` → `[]`;`listCycleStarts` 升序(AC8)
  - `listCycleStarts` 与 `computePoolTrend(...).map(p => p.periodStart)` 逐元素相等(R1 补充)
  - 起始日模式跨月周期(7/15–8/14 vs 8/15–9/14):边界日归属正确(AC8)
  - **起始日 clamp**:`{kind:'start-day', day:31}`,分配落在 `2026-03-31` 与 `2026-04-30`;查 3/31 周期时
    窗口终点为 **4/30**,4/15 的支出进、4/30 的不进;再补 2 月(周期起点 `2026-01-31` → 下一周期 `2026-02-28`,
    2/27 进、2/28 不进)。**`day = 31` 无法经 `/settings` 设置**(`salary-service.ts:30-31`、`:451-459` 限 1..28),
    故该用例直接调引擎,与既有 `budget-engine.test.ts:493-497` 同构(AC8)
  - 退款在历史视图仍为负贡献(`expenseContribution`);周期起点之前的支出不进该周期模块(R1 补充)
- [ ] 1.6 `pnpm --filter @jizhang/shared test` 全绿(或根目录 `pnpm -r run test`)

**回滚点 R1:** 阶段 1 只动 1 个源文件 + 1 个测试文件,单 commit 可整体 revert。

---

## 阶段 2:后端路由(R2 / AC3 / AC4 / AC5)

- [ ] 2.1 `packages/server/src/routes/budget.ts:121`:`/api/v1/budget/overview` 改为读
      `request.query.periodStart`;`undefined` 与 `''` 视为省略(沿用 `routes/stats.ts:52/:71/:93` 写法);
      非有限整数 → `ValidationError`(→400)
- [ ] 2.2 用 `listCycleStarts(allocations, cycle)` 取周期列表并校验存在性;未知周期 → `ValidationError`
      (**不得**静默回落到当期 —— 那会把"周期不存在"伪装成"那个月没有预算",违反 R2:65 / AC3)
- [ ] 2.3 把 `periodStart` 传给 `computeModuleViews`;**`:146-160` 的 totals、`hasBudget`、
      按 `budgetCents` 降序排序、分类名 join 全部保持原样**
- [ ] 2.4 `carryoverPoolCents`:
  - 省略参数 → **维持今天的代码路径** `computeCarryoverPool({ …, currentModuleViews: views })`(`:131-136`),不改一字
  - 显式给出周期 → `computePoolTrend({ …, currentModuleViews: views })` 中
    `periodStart === target` 的点的 `poolCents`(design.md §3.3:该周期**开始时**的池)
- [ ] 2.5 在路由 docblock 与相关注释里写清两点:
  (a) 历史池取"该周期开始时的池",**有意不含**该周期自身的剩余(它要等周期关闭才进池);
  (b) 校验失败必须 400 而不是回落到当期
- [ ] 2.6 新增 `GET /api/v1/budget/periods`,返回
      `{ periods: number[](升序), currentPeriodStart: number | null, cycle: CycleConfig }`;
      注册在**同一个 auth 插件块内**(见 `:22` 的说明)
- [ ] 2.7 单测(`packages/server/test/budget.test.ts`,新增 describe「历史周期回看」+「periods 列表」):
  - ≥2 周期夹具:用上周期的 `periodStart` 调接口,数值属于该周期**且与当期不同**(AC1)
  - 该周期的 `carryoverPoolCents` === `computePoolTrend` 对应点的值(AC2)
  - `?periodStart=abc` / `1.5` / 不存在的时间戳 → 400,且响应**不是**当期数据(AC3)
  - **零回归**:既有 `describe('AC11 budget overview')`(`:525-646`)**一行不改**全绿;
    补断言:无参响应与显式传最新周期起点时**逐字段相等**(含 `carryoverPoolCents`)(AC4)
  - `GET /budget/periods`:升序、`currentPeriodStart === periods[periods.length - 1]`;
    无工资时 `periods === []` 且 `currentPeriodStart === null`(AC5)
  - 三周期夹具:中间周期的池 === 对应趋势点值,且 ≠ 当期池
- [ ] 2.8 `pnpm --filter @jizhang/server test` 全绿

**回滚点 R2:** 阶段 2 集中在 1 个路由文件 + 1 个测试文件,单 commit 可 revert。
**注意 R2 与 R3 必须同批发布或先回滚 R3**,否则前端会打到不存在的端点。

---

## 阶段 3:前端(R3 / R4 / R6 / AC6 / AC7 / AC10)

- [ ] 3.1 `packages/web/src/api/client.ts`:`budget.overview` 加可选 `periodStart`
      (`{ query: { periodStart } }`);新增 `budget.periods()` 与类型
      `BudgetPeriods { periods: number[]; currentPeriodStart: number | null; cycle: CycleConfig }`;
      **`BudgetOverview` 不改动**(AC4)
- [ ] 3.2 `packages/web/src/stores/budget.ts`:`loadOverview(periodStart?: number)` 透传;
      新增 `periods` / `currentPeriodStart` 两个 ref 与 `loadPeriods()`;`loadAll()`(`:83-96`)加入
      `loadPeriods()` 并继续无参调用 `loadOverview()`。**不**在 store 放"选中周期"
      (`state-management.md:28-29`)
- [ ] 3.3 `packages/web/src/views/BudgetView.vue`:
  - 周期选择器,选项来自 `budget.periods`,标签由 `periodStart` 格式化为本地 `YYYY-MM`(**仅格式化**)
  - 选中态由既有 `budget` 路由 query 驱动:读 `route.query.periodStart`,
    `watch` → `budget.loadOverview(value)`;`@change` → `router.replace({ name: 'budget', query: { periodStart: String(value) } })`
  - **AC6**:`isHistory`(选中值存在且 ≠ `currentPeriodStart`)时显示「历史周期」徽标、
    池标签改为「该周期开始时的结余池」,并给出「回到当前周期」按钮 → `router.replace({ name: 'budget' })`
  - **AC5**:`budget.periods.length <= 1` → 不渲染选择器与历史控件(不显示空选择器、不报错)
  - **AC10**:选择器与按钮 `min-height: 44px`;375px 下不横向溢出
  - 模块进度条、超支提示(`:92-94`)、三个入口按钮(`:131-147`)**不动**;只用既有 CSS 变量
- [ ] 3.4 `packages/web/src/views/StatsView.vue`:结余池卡片(`:229-266`)在 sparkline 后补逐周期表格
      (`周期 | 结余池`,最新在前),形态对齐月度收支表(`:208-225`),数据取自既有 `pool.points`,
      **零聚合**;保留 `:258-260` 空态与 `:262-265` 说明(hint 措辞已与选定的池语义一致)(R4 / AC7)
- [ ] 3.5 **不修改** `router/index.ts`、`AppShell.vue`、`views/` 下回收站相关视图
      (并发任务 `09-11-trash` 拥有);不新增路由、不新增导航 tab(R6:89)

**回滚点 R3:** 阶段 3 只动 4 个前端文件,revert 后预算页回到"只看当前周期"。

---

## 阶段 4:验证

- [ ] 4.1 `pnpm -r run lint`(`--max-warnings 0`)
- [ ] 4.2 `pnpm -r run typecheck`(`noUncheckedIndexedAccess` 已开启:数组下标必须显式判空,
      **禁止** `!` 断言)
- [ ] 4.3 `pnpm --filter @jizhang/web run build` —— 必须通过 `vue-tsc` + `check-mobile.mjs` + `check-pwa.mjs`(AC10)
- [ ] 4.4 复核主 chunk 体积无显著增长(基线 ~42 kB gzipped)
- [ ] 4.5 扩展 `packages/server/scripts/e2e-budget.mjs`(夹具已在 `:21-33`,`resetToKnownState()` 已在 `:19`):
  - 用 M1 的 `periodStart` 调 `/budget/overview`,断言 `isCurrentPeriod` 语义下的数值等于"当时"
    (即 `food.spentCents === 0`)且与 M0 不同(AC1)
  - 断言该周期的 `carryoverPoolCents` 与 `/stats/pool-trend` 中对应点相等(AC2 / AC7)
  - 断言 `?periodStart=<乱值>` → 400(AC3)
  - 断言无参响应与显式传 `currentPeriodStart` 时**逐字段相等**(AC4)
  - **跨屏同口径**(AC3:72):取 `[periods[k], periods[k+1])` 窗口,调
    `/stats/category-share?from=&to=` 并断言每个有分配模块的 `spentCents` 等于对应分类的 `amountCents`
  - **不得改动** `:151`、`:162-166`、`:211-215` 的既有精确池期望(它们钉住当期口径)
- [ ] 4.6 `packages/server/scripts/e2e-stats.mjs`:既有一致性断言(`:171-179`)保持;
      新增 `points.length === 周期数` 且 `periodStart` 升序(AC7)
- [ ] 4.7 把套件复制进容器并运行(既有流程):
  ```
  docker compose cp packages/server/scripts/. jizhang:/app/packages/server/scripts/
  docker compose exec -T -w /app/packages/server/scripts jizhang node e2e-budget.mjs
  docker compose exec -T -w /app/packages/server/scripts jizhang node e2e-stats.mjs
  docker compose exec -T -w /app/packages/server/scripts jizhang node e2e-home.mjs
  ```
  容器被重建后必须**重新 cp**(`scripts/` 不烘进镜像,`quality-guidelines.md:211-214`)
- [ ] 4.8 套件独立性:换顺序 / 各跑两次,确认检查数不变(`quality-guidelines.md:153-155`)
- [ ] 4.9 浏览器复核(375px):选择器与「回到当前周期」可点(≥44px)、无横向溢出、切换后数值变化、
      后退键回到上一周期、历史徽标出现与消失正确(AC6 / AC10)。若复用
      `packages/web/scripts/render-dashboard.mjs` 一类脚本,**先删除其固定 `--user-data-dir` 目录**,
      否则会从 HTTP 缓存读到旧构建(`quality-guidelines.md:229-231`)

---

## 阶段 5:收尾

- [ ] 5.1 全量质量门:`pnpm -r run lint`、`pnpm -r run typecheck`、全部单测、全部容器 e2e(AC11)
- [ ] 5.2 **R5 多模板复核(只读)**:运行并引用 `test/budget.test.ts:183-209`、`:276-297`、
      `e2e-budget.mjs:177-189` 作为 AC9 证据。**不新增实现、不重构**;若发现缺陷,按 R5:84
      **记录为独立问题**并在交付说明里列出,不在本任务内顺手改
- [ ] 5.3 逐条核对 `design.md` §8 的 AC1–AC11,把验证证据(命令 + 通过数)写进实现说明;
      确认既有 235 项单测与 266 项容器 e2e 计数未减少(AC11)
- [ ] 5.4 按 `trellis-update-spec` 更新 `.trellis/spec/backend/`,把三条最容易被后人误判的约定写进去:
  - **周期标识 = 引擎自报的 `periodStart`**;自然月模式 = 组内**最早发薪日**,不是 1 号,"当前周期" =
    最近一次有分配记录的周期
  - **已关闭周期的窗口 = `[本周期起点, 下一(更新)周期起点)`**,与 `computeCarryoverPool` 同源
  - **历史周期的池 = 该周期开始时的池**,有意不含该周期自身剩余(它要等周期关闭才进池)
- [ ] 5.5 提交(按 `workflow.md` Phase 3.4 批量提交流程,等用户确认;不 amend、不 push)

---

## 验证命令速查

```bash
pnpm -r run lint
pnpm -r run typecheck
pnpm -r run test
pnpm --filter @jizhang/shared test
pnpm --filter @jizhang/server test
pnpm --filter @jizhang/web run build
docker compose cp packages/server/scripts/. jizhang:/app/packages/server/scripts/
docker compose exec -T -w /app/packages/server/scripts jizhang node e2e-budget.mjs
docker compose exec -T -w /app/packages/server/scripts jizhang node e2e-stats.mjs
docker compose exec -T -w /app/packages/server/scripts jizhang node e2e-home.mjs
```

## 风险与回滚点

| 风险 | 缓解 | 回滚点 |
|---|---|---|
| 改动 `groups[0]` 选取逻辑导致**当期**行为回归 | 省略参数走原代码路径;AC4 的"显式最新 === 省略"逐字段断言;既有 AC11 单测一行不改通过 | R1 |
| 历史窗口终点选错(误用 `nextPeriodStart`)导致模块视图与池算术分叉 | 复用引擎既有的"下一(更新)周期起点"约定;AC8 用跨月 + clamp 夹具钉住 | R1 |
| 用"截断分配列表 + `computeCarryoverPool`"求历史池 → 丢掉未超支模块的剩余 | design.md §3.3 已举证该做法错误(`:360-366` 只处理超支);历史池只取既有序列的点 | R1/R2 |
| 把自然月周期起点误当成"当月 1 号" | 周期标识一律用引擎自报的 `periodStart`;夹具用"5 号发薪"而非 1 号 | R1 |
| 单周期夹具掩盖错误的周期分桶 | 强制 ≥2 周期夹具(`quality-guidelines.md:130-132`) | — |
| 未知 `periodStart` 静默回落到当期,把"周期不存在"伪装成"没有预算" | 路由用 `listCycleStarts` 先校验再抛 400;AC3 覆盖三种非法输入并断言**不是**当期数据 | R2 |
| 给 `/budget/overview` 响应加字段 → 违反 AC4 的"响应完全一致" | 周期列表独立成 `/budget/periods`;总览响应零改动 | R2 |
| 历史池"不含本周期自身剩余"被读成 bug | UI 文案写「该周期开始时的结余池」;spec 记录;design.md §6 边界 4 | R3 |
| `e2e-budget.mjs` / `e2e-stats.mjs` 既有精确池断言被改动 | 省略参数路径不变;先只跑既有套件确认零回归,再加新断言 | R2 |
| 选择器/按钮破坏 44px 或 375px 溢出 → 审计失败 | `check-mobile.mjs` 在 `pnpm build` 中强制;`min-height: 44px`;浏览器复核(AC10) | R3 |
| 与并发任务 `09-11-trash` 的文件冲突 | 不碰 `router/index.ts`、`AppShell.vue`、`transaction-service.ts`、`routes/transactions.ts`、回收站视图;不新增路由 | — |
| 前端读到旧构建导致"改了但没生效" | 改前端后**重建镜像**并 `docker compose up -d --force-recreate`;浏览器脚本先删固定 profile 目录(`quality-guidelines.md:189-231`) | — |
| R5 复核时手痒顺手改多模板 → 范围扩大 | 缺陷只记录不修(R5:84);交付说明里单列 | — |
| 前端被诱导重算金额 | 评审时检查新代码里没有金额 `reduce`/`+`;所有金额来自响应 | R3 |

**贯穿全部阶段的两条本项目不变量:**

1. **金额是整数分,时间是 epoch 毫秒**(`packages/shared/src/types.ts:1-9`;父 PRD §Technical Notes:122)
   —— 新字段一律 `*Cents` / epoch-ms,转换只在边界做。
2. **每个按周期分桶的功能都必须有"至少两个不同周期"的测试夹具**
   (`spec/backend/quality-guidelines.md:130-132`)。单周期夹具抓不到错误的周期键 —— 本项目真实发生过一次。
