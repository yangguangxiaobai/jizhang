# 首页仪表盘 — 执行计划

> 前置阅读:`prd.md` → `design.md`。按顺序执行;每个阶段结束后可回滚。

## 阶段 0:前置核实(写代码之前)

必须先查证、不得猜测:

- [ ] 0.1 读 `packages/server/src/routes/transactions.ts`,确认 `GET /api/v1/transactions` 支持的 query 参数,特别是 `limit` 与排序能力
- [ ] 0.2 读 `packages/server/scripts/lib/e2e-reset.mjs`,确认新增 e2e 套件要接入的重置基线
- [ ] 0.3 读 `packages/web/src/views/StatsView.vue`,确认统计页当前如何取得月度收入(保证首页与它同源)
- [ ] 0.4 读 `packages/web/src/stores/transactions.ts`,确认列表查询的既有封装能否直接复用取 5 条
- [ ] 0.5 读 `packages/server/test/stats.test.ts`,确认既有断言是否会在"含工资"下失效,并列出需改动的断言

**门禁:** 0.1 若发现无排序支持,采用 design.md §3.3 的前端稳定排序方案并在注释说明;0.5 若发现断言冲突,先在 `prd.md` 记录行为变化是预期而非回归。

## 阶段 1:后端 —— 工资计入月度收入

- [ ] 1.1 `packages/server/src/services/salary-service.ts`:新增 `listInWindow(from, to)`,按 `deleted = 0 AND date >= ? AND date < ?` 读取,返回 `{ amountCents, date }[]`
- [ ] 1.2 `packages/server/src/services/stats-service.ts`:
  - 在 `monthlyTrend` 内用 `startOfMonthOf` 把窗口内工资归入对应月份桶,**累加进 `income`**(不是 `expense`)
  - **不得**改用 `monthStartOffset` 做单条归月(见 design.md §2.3)
  - 更新模块 docblock:写明 `incomeCents` 含工资,而 `categoryShare` 刻意不含工资(design.md §2.4)
- [ ] 1.3 单测(`packages/server/test/`):
  - `monthlyTrend`:仅账单 / 仅工资 / 混合 / 工资软删除 / 窗口边界(`[from, to)` 含头不含尾)/ 跨月归属
  - `listInWindow` 的边界与 `deleted = 0`
  - **防回归:**`categoryShare` 在存在工资记录时结果不变
- [ ] 1.4 复核并更新 `packages/server/test/stats.test.ts` 中因语义扩展而失效的断言
- [ ] 1.5 `pnpm --filter @jizhang/server test` 全绿

**回滚点 R1:** 阶段 1 全部改动集中在 2 个 service 文件 + 测试,单 commit 可整体 revert。revert 后首页收入回到纯账单口径。

## 阶段 2:后端 e2e

- [ ] 2.1 更新 `packages/server/scripts/e2e-stats.mjs`:补工资场景,复核既有 35 项在含工资账本下仍成立
- [ ] 2.2 把套件复制进容器并运行(既有流程):
  ```
  docker compose cp packages/server/scripts/. jizhang:/app/packages/server/scripts/
  docker compose exec -T -w /app/packages/server/scripts jizhang node e2e-stats.mjs
  ```
- [ ] 2.3 确认全部检查通过,记录通过数

## 阶段 3:前端 —— 路由与导航

- [ ] 3.1 `packages/web/src/router/index.ts`:新增 `dashboard` 路由占 `/`;`TransactionsView` 移到 `transactions` path 且**保留 `name: 'transactions'`**
- [ ] 3.2 登录跳转目标与"已登录跳过登录页"的落点改为 `dashboard`
- [ ] 3.3 `packages/web/src/views/AppShell.vue`:底部导航加「首页」为第一项,`grid-template-columns` 改为 `repeat(6, 1fr)`
- [ ] 3.4 全局搜索 `{ name: 'transactions' }` 一类引用,确认无一处因路由调整而失效

**回滚点 R2:** 阶段 3 只动路由与 shell,revert 后 `/` 回到账单列表。

## 阶段 4:前端 —— 首页视图

- [ ] 4.1 新增 `packages/web/src/views/DashboardView.vue`
  - 本月汇总卡:收入 / 净支出 / 结余,数据取 `api.stats.monthlyTrend(1)` 末点
  - **空数组必须显式判空**,不得用 `!`(spec 禁止)
  - 月份标签用返回的 `monthStart`,不用前端 `new Date()` 另算
  - 周期预算卡:复用 `useBudgetStore()` 的 `overview` / `overBudgetModules` / `poolIsNegative` / `usedRatio`
  - `hasBudget === false` → 引导态(引导去记工资),不是全 0
  - 最近账单:最多 5 条,字段与排序见 design.md §3.3
  - 空账本 → 空状态 + 引导「记一笔」
- [ ] 4.2 待确认卡片**不渲染**(T13 接入点预留,AC7)
- [ ] 4.3 只用既有 CSS 变量,不写死颜色
- [ ] 4.4 所有可点击元素 ≥44px

## 阶段 5:前端验证

- [ ] 5.1 `pnpm --filter @jizhang/web run build` —— 必须通过 `vue-tsc` + `check-mobile.mjs` + `check-pwa.mjs`
- [ ] 5.2 确认 6 项导航在窄屏不换行不溢出(必要时按 design.md §7 缩短标签文案,**不回退到 5 项**)
- [ ] 5.3 复核主 chunk 体积无显著增长(基线 ~42 kB gzipped)
- [ ] 5.4 新增 `packages/server/scripts/e2e-home.mjs`,断言:
  - 登录后落在首页;`transactions` 路由名仍可达(AC6)
  - 首页本月三项数值与统计页**逐分相等**(AC2)
  - 首页周期预算与预算页相等(AC3)
  - 最近账单恰好 ≤5 条且排序正确(AC5)
  - 空账本显示引导态(AC4 的一半)
- [ ] 5.5 容器内运行全部 e2e 套件,确认既有套件不回归、无套件间顺序依赖

## 阶段 6:收尾

- [ ] 6.1 全量质量门:`pnpm lint`、`pnpm typecheck`、全部单测、全部容器 e2e
- [ ] 6.2 按 `trellis-update-spec` 更新 spec:
  - `incomeCents` 含工资、`categoryShare` 刻意不含工资(这是最容易被后人误判为 bug 的一点)
  - 首页落点与 6 项导航的约定
- [ ] 6.3 勾选本任务 AC1–AC9 并在 `prd.md` 留下验证证据
- [ ] 6.4 提交(按 Phase 3.4 批量提交流程,等用户确认)

## 验证命令速查

```bash
pnpm lint
pnpm typecheck
pnpm --filter @jizhang/server test
pnpm --filter @jizhang/web run build
docker compose cp packages/server/scripts/. jizhang:/app/packages/server/scripts/
docker compose exec -T -w /app/packages/server/scripts jizhang node e2e-stats.mjs
docker compose exec -T -w /app/packages/server/scripts jizhang node e2e-home.mjs
```

## 风险与回滚点

| 风险 | 缓解 | 回滚点 |
|---|---|---|
| 统计页既有 e2e 因收入语义扩展而失败 | 阶段 0.5 先列清单;区分"预期变化"与"回归" | R1 |
| 6 项导航在窄屏溢出 | 构建期 `check-mobile.mjs` + 人工 375px 复核;缩短标签而非回退 | R2 |
| 首页与统计页数值不一致 | AC2 用逐分相等断言强绑 | — |
| 前端被诱导重算金额 | 代码评审时检查首页无 `reduce`/`+` 金额聚合 | — |
| 工资与手工收入重复计入 | 已在 design.md §2.5 明确不做去重及理由,不静默 | — |
