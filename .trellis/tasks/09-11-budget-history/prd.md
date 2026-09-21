# 预算深化 — 需求

> 父任务:`09-11-roadmap-2`,对应 R11。第二阶段「块三」。

## Goal

让预算页从"只能看当前周期"变成"能回看任何一个有过分配的周期",并把结余池的变化按周期看清楚。

用户价值:第一阶段已经把每个周期的预算分配**存进了库**(`budget_allocations`),但前端只能读当前周期。结果是**一个周期结束后,上个月的预算与超支就再也看不到了**——数据在库里、入口不存在。这是本项目最典型的"MVP 数据白存"缺口。

## Background

### 仓库现状(已核对,含 `file:line`)

| 能力 | 现状 | 证据 |
|---|---|---|
| 历史分配**已入库** | ✅ | `budget_allocations` 表按周期存 `allocations_json`;`SalaryService` 每次记工资写一条 |
| 当前周期模块视图 | ✅ 引擎已有 | `shared/budget-engine.ts` `computeModuleViews({ allocationsDesc, transactions, cycle })` |
| 结余池当前值 | ✅ 引擎已有 | `computeCarryoverPool({ ..., currentModuleViews, cycle })` |
| 结余池**趋势** | ✅ **已有** | `stats-service.ts:309-340` `poolTrend()` 返回 `points[]`(`periodStart` + `poolCents`)+ `currentCents` + `cycle`;路由 `GET /api/v1/stats/pool-trend` |
| 预算总览接口 | ⚠️ **不接受任何周期参数** | `routes/budget.ts` 的 `/api/v1/budget/overview` 只能返回当前周期 |
| 前端历史回看 | ❌ **不存在** | `BudgetView.vue` 只调 `budget.loadOverview()`,没有周期切换控件 |
| 多模板 | ✅ **第一阶段已完成** | 见下 |

### 关于「多模板」:已完成,本任务只做复核,不重做

父任务 R11 第 3 条列了「多模板」,但核实后确认**它在第一阶段 T6 已完整交付**:

- 模板 CRUD 与设为默认:`routes/budget.ts:200-235`
- 服务与校验:`template-service.ts:170-251`;比例必须为正、**和必须为 1(容差 `1e-4`)**(`:6`、`:94-96`、`:108-112`)
- 前端模板管理页:`TemplatesView.vue`(增删改 + 设为默认)
- **记工资时可选模板**:`SalaryEntryView.vue:162-169` 的 `<select>`,`:126` 提交 `templateId`;边界字段 `api/client.ts:269`;服务端 `salary-service.ts:224-229,288-291` 按其生成分配
- 已被测试覆盖:`test/budget.test.ts:183-209` 与 `e2e-budget.mjs:177-189`(后者显式使用非默认模板)

**因此本任务对多模板只做两件事:**(1) 在验收时复核上述行为仍然成立;(2) **不重写、不重构**。把它算成本任务的工作量是错的。

### 参考项目行为

参考项目 `budget_page.dart` 同样只呈现当前周期,没有历史回看。因此本任务**没有可逐条复刻的参考实现**,需求来自父任务 R11 与上述缺口本身。设计自由度更大,风险也更高(见 design.md)。

### 必须遵守的既有硬约定

- **历史回看必须复用引擎口径,不得另写一套计算**。父任务 Technical Notes 明确要求:若引擎缺少"给定周期计算模块视图"的能力,应扩展引擎并补单测,**而不是在路由层拼算**。这是本任务最关键的技术约束。
- **前端只渲染,不算账**(`spec/frontend/index.md:14-16,47-53`)。
- **周期边界按目标月 clamp**:`periodStartOf` / `nextPeriodStart` 的既有语义(如配置起始日 31 → 4月30日、2月28日、5月31日)不得改变。
- **月分组键是整数 `year*100+month`**,不是字符串(第一阶段真实 bug:字符串比较下 `'2026-12' < '2026-9'`)。
- 金额整数分、时间 epoch 毫秒。
- 每个按周期分桶的功能,**测试必须包含至少两个不同周期的数据**(单周期 fixture 抓不到错误的桶键)。这是 `spec/backend/quality-guidelines.md` 明写的教训。

## Requirements

### R1 引擎:支持"给定周期"的模块视图

- 必须能计算**任意一个历史周期**的模块视图(预算 / 已用 / 剩余),使用与当前周期**完全相同**的规则
- 必须能取该周期的结余池数值(该周期结束时的池,或该周期期间已借用后的池——语义在 design.md 定夺并写清)
- 引擎的新增能力必须有单测,且测试数据覆盖**至少两个不同周期**
- **不得**在路由或前端重新实现任何金额算法

> 引擎现有三个函数的签名与假设(尤其它们如何认定"当前周期")决定了这是"扩展引擎"还是"增加调用点",由 design.md 给出结论与 `file:line` 证据。R1 只约束能力与口径。

### R2 后端:周期化的预算总览

- `GET /api/v1/budget/overview` 必须能按请求的周期返回数据,或新增一个等价端点
- **既有调用方与既有测试不得被破坏**:不带周期参数时的行为必须与今天完全一致
- 非法周期入参必须被拒绝(400),不得静默回退到当前周期——静默回退会让用户以为在看某个月,实际看到的是另一个月
- 必须能列出**有哪些周期可回看**(例如可用的 `periodStart` 列表),否则前端无法渲染切换控件

### R3 前端:周期切换与历史回看

- 预算页可以切换到任意一个**存在分配记录**的周期,并看到该周期的:各模块预算 / 已用 / 剩余 / 超支高亮、周期总预算 / 总已用 / 剩余、结余池
- 必须能一键回到"当前周期";处于历史周期时界面要有**明确的视觉提示**,不能让人误以为在看当前周期
- 该周期的数值必须与同一周期在统计页/账单页的口径一致
- 无历史周期(只有当前或完全没有)时,切换控件应隐藏或禁用,而不是显示一个空选择器

### R4 前端:结余池趋势

- 把结余池的变化按周期呈现出来,而不是只给一个当前值
- 数据来源为既有 `GET /api/v1/stats/pool-trend`(`stats-service.ts:309-340`),**除非** design.md 论证它不足
- 图表沿用既有的手写 SVG 方案(项目明确不引图表库,`spec/frontend/component-guidelines.md:46-57`)

### R5 多模板:仅复核

- 不新增实现。在验收时复核:R11 第 3 条所列的模板 CRUD、比例校验(和为 1、容差 `1e-4`)、记工资选模板、并按所选模板生成分配,仍然全部成立
- 若复核发现缺陷,**记录下来作为独立问题**,不在本任务内顺手改(避免扩大范围)

### R6 移动端与无障碍

- 周期切换控件与趋势图的可点击元素 ≥ 44px;375px 下无横向溢出
- 不新增底部导航 tab(D12 已定 6 项)
- 只用既有 CSS 语义变量,不写死颜色(为 T16 深色模式留路)

## Acceptance Criteria

全部于 2026-09-11 在运行中的容器上验证。`periods-e2e` = `packages/server/scripts/e2e-periods.mjs`(40 项),`budget-render` = `packages/web/scripts/render-budget.mjs`(浏览器),`engine` = `packages/shared/test/budget-engine.test.ts`。

- [x] AC1 切换到一个历史周期后,该周期的各模块预算 / 已用 / 剩余与当时一致,且**与当前周期不同**(证明不是把当前数据换了标题) — `periods-e2e`:最旧周期 `500000/200000` 对比当前 `1000000/0`;`budget-render`:切到 7 月后屏幕显示 `¥5000.00` 而当前周期的 `¥20000.00` 消失
- [x] AC2 历史周期的超支模块被正确高亮,且该周期的结余池数值与引擎口径一致 — `periods-e2e`:历史周期内追加超支后 `remainingCents = -50000`(未被钳制),且 `carryoverPoolCents` 等于 `/stats/pool-trend` 中该周期的点
- [x] AC3 带非法周期参数请求总览接口被拒绝(400),**不静默返回当前周期** — `periods-e2e`:未知周期 → 400 `VALIDATION` / `Unknown budget period.`,且**响应中不含 `modules` 字段**;非数字 → 400
- [x] AC4 不带周期参数时,总览接口的响应与第一阶段完全一致(既有测试原样通过) — 既有 55 项 budget 测试全部原样通过;`periods-e2e` 断言 `periodStart=` 空值、以及显式传最新周期,与省略参数**逐字段 JSON 相等**
- [x] AC5 能列出可回看的周期;只有一个周期或没有周期时,切换控件隐藏或禁用而非报错 — 新增 `GET /api/v1/budget/periods`;空账本返回 `periods: []` 与 `currentPeriodStart: null`;前端 `canReviewHistory`(`periods.length > 1`)控制显隐;**反漂移**:周期列表与 `computePoolTrend` 的点逐点相等
- [x] AC6 处于历史周期时界面有明确的"你在看历史"提示;可一键回到当前周期 — `budget-render`:切换后出现 `正在查看历史周期 2026年7月…`,点击「回到当前周期」后提示消失、当前数字恢复
- [x] AC7 结余池趋势按周期呈现,且**序列末端与 `computeCarryoverPool` 的当前值一致**(继承第一阶段契约,`stats-service.ts:305-308`) — **后端无需改动**:`computePoolTrend` 已每周期输出一点,第一阶段的一致性契约测试继续通过;`periods-e2e` 断言周期列表与其逐点相等
- [x] AC8 引擎新增能力的单测覆盖**至少两个不同周期**,且周期边界 clamp(配置起始日)在历史周期上同样正确 — `engine` 新增 14 项(含历史窗口上界为下一周期起点、起始日模式历史回看),`budget.test.ts` 新增 13 项,全部跨两个周期。**clamp 说明**:`day` 被限制在 1..28(`salary-service.ts:30-31`)而 clamp 只在 day > 28 时生效(`date-utils.ts:88-111`),故无法经 HTTP 触达,已由引擎层既有测试覆盖(`budget-engine.test.ts:493-497`),见 design.md §9.1
- [x] AC9 多模板复核:R11 第 3 条的模板 CRUD、比例校验、记工资选模板全部仍然成立(引用既有测试作为证据,不新增实现)— 复核通过:`test/budget.test.ts:183-209` 与 `e2e-budget.mjs:177-189`;期间**未改动任何模板代码**
- [x] AC10 375px 下无横向溢出,新增可点击元素均 ≥ 44px,`check-mobile.mjs` 与 `check-pwa.mjs` 通过 — 两个构建期审计 PASS;`budget-render` 实测 `scrollWidth=375`、无 <44px 控件(切换器 `<select>` 为 44px / 16px 字号)
- [x] AC11 既有 269 项单测与容器 e2e 全绿;本任务新增能力均有对应测试 — 单测 **269**(shared 54 + server 215);容器 e2e **327 → 367**(新增 `e2e-periods.mjs` 40 项);全部既有套件零回归

### 与 design.md 的差异(实现时核实)

- **`stats-service.ts` 未改动**,与 §2.2 的结论一致。
- **AC4 采用"字面"口径**:周期列表放在独立端点 `/budget/periods`,因此无参总览响应逐字节不变。

## Out of Scope

- **重新实现或重构多模板** — 第一阶段已完成(R5 仅复核)
- **跨周期对比视图**(如"本月 vs 上月"并排)— 父任务未要求;历史回看已能逐个查看
- **按周期导出/打印预算报表** — 属 T15 数据可携带性的范围
- **修改周期起始日的语义或 `periodStartOf` 的 clamp 行为**
- **预测/建议类功能**(预算达成率预测、超支预警)
- **深色模式适配** — 由 T16 统一处理
- **新增底部导航 tab**(D12)

## Technical Notes

> **已由 design.md 回答(2026-09-11,均带 `file:line`)。** 以下三条原为"最大未知",现均已有结论,保留原文以便对照:

- **最大的技术未知 —— 已答:必须扩展引擎。** 三个函数都是**位置化**的,写死最新一组:`budget-engine.ts:238 const current = groups[0]`、`:301 const current = groups[0]`、`:305 const historical = groups.slice(1)`;且它们的输入类型(`:214-221`、`:270-276`)**没有任何字段能表达目标周期**。它们也不读时钟(`:8-10`),所以"当前周期"的含义是"**最新一个有分配的周期**",而不是"包含今天的周期"——最后一次记工资在三个月前时,那个周期就是"当前"。
- **`poolTrend` 已经够用 —— 已答:是的,R4 后端零改动。** `stats-service.ts:309-340` 已返回 `points[]` + `currentCents` + `cycle`,已被路由、`api/client.ts:296-300` 与 `StatsView.vue:102-125` 消费。缺的只是**按周期可读的呈现**。
- **周期标识 —— 已决:用引擎自报的 `periodStart`(epoch 毫秒)。** 即 `group.start`,自然月下等于该月**最早的工资日**(不是 1 号),起始日模式下等于 `periodStartOf` 的键;`computePoolTrend` 已经把它作为 `PoolTrendPoint.periodStart` 输出(`:452-456`)。**不得用 `year*100+month` 月键**——它无法表达"每月 5 号起算"的周期。非法值必须 400,**不得静默回退到当前周期**。
- **改动面更正**:`packages/server/src/services/stats-service.ts` **无需改动**(依据上一条)。实际改动面为 `packages/shared`(引擎)、`packages/server/src/routes/budget.ts`,以及前端 `BudgetView.vue`。与 T12(回收站)的改动面**不重叠**,且**完全不碰 `router/index.ts`**,因此在回收站开发期间也不冲突。
- **AC8 的 clamp 只能在引擎层验证**:`day` 被限制在 1..28(`salary-service.ts:30-31`),而 clamp 只在 day > 28 时生效(`date-utils.ts:88-111`),所以无法通过 HTTP 触达。验收时按引擎层单测记录,见 design.md §9.1。

## Open Questions

无。R11 三条的范围已澄清(第 3 条已完成);结余池历史语义与周期切换 UI 位置已由用户拍板(见 design.md §9),其余实现选择均在 design.md 中给出结论与证据。
