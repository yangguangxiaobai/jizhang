# 周期账单 — 执行计划

> 前置阅读:`prd.md` → `design.md`。按顺序执行;每阶段结束可回滚。

## 阶段 0:前置核实(写代码之前)

- [ ] 0.1 读 `db/migrations/001-init.ts` 与 `db/migrate.ts:29-31`,确认追加迁移的方式(版本号、永不重排)
- [ ] 0.2 读 `shared/src/date-utils.ts`,确认可复用的 `daysInMonth` / `dateOnly`,避免重写日期工具
- [ ] 0.3 读 `services/transaction-service.ts` 的 `create` 签名与校验,确认确认到期项时如何复用它(而不是自己 INSERT)
- [ ] 0.4 读 `db/index.ts` 的 `initializeDatabase`,确认迁移在测试里如何被应用
- [ ] 0.5 确认 SQLite 版本支持**部分唯一索引**(`WHERE` 子句)——`better-sqlite3` 内置版本需 ≥ 3.8.0;用一次性查询实际验证,不靠假设
- [ ] 0.6 读 `scripts/lib/e2e-reset.mjs`,确认新增两张表的清理位置
- [ ] 0.7 读 `DashboardView.vue` 当前的 `onMounted`,确认注入 `generate()` 的位置与错误隔离方式

**门禁:** 0.5 若部分索引不可用,退化为"无条件唯一索引 + 重新启用时先物理删除该规则的历史 occurrence",并把结论回写 design.md §3。

## 阶段 1:shared —— 日期推算(纯函数)

- [ ] 1.1 新增 `packages/shared/src/recurring.ts`:`RecurringFrequency`、`nextDueAfter`、`frequencyLabel`?
- [ ] 1.2 **关键**:monthly/quarterly/yearly 始终以 `anchorDate` 为基准做 n 期偏移后 clamp,绝不从上一个到期日加一个月
- [ ] 1.3 `index.ts` 导出(`export * from './recurring.js'`)
- [ ] 1.4 单测 `test/recurring.test.ts`:
  - 5 种频率各自推进正确
  - **1/31 → 2/28 → 3/31**(不漂移)—— AC8 的核心
  - 闰年 2/29 与平年
  - `nextDueAfter` 严格晚于 `after`;`after === anchor` 时返回下一期
  - 跨年(daily/weekly/yearly)
- [ ] 1.5 `pnpm --filter @jizhang/shared test` 全绿
- [ ] 1.6 **构建 shared**(`pnpm --filter @jizhang/shared run build`)——服务端 import 的是 dist,不构建会在运行时 `undefined is not a function`(T14 已踩过)

**回滚点 R1:** 纯新增文件,可整体 revert。

## 阶段 2:数据库 —— 迁移 002

- [ ] 2.1 新增 `db/migrations/002-recurring.ts`(TS 字符串,**不是 `.sql`**)
- [ ] 2.2 在 `db/migrate.ts` 的 `MIGRATIONS` 数组**末尾追加** `{ version: 2, name: 'recurring', sql: MIGRATION_002_RECURRING }`
- [ ] 2.3 `test/db.test.ts` 或新单测:迁移后两张表存在、部分唯一索引真的阻止重复(插入同 `(rule_id, planned_date)` 两次且都未删除 → 第二次失败;软删除后 → 成功)
- [ ] 2.4 确认既有迁移测试不受影响

## 阶段 3:服务层 `RecurringService`

- [ ] 3.1 新增 `services/recurring-service.ts`:`listRules` / `createRule` / `updateRule` / `setRuleEnabled` / `deleteRule`
- [ ] 3.2 `generateDue()`:按 design.md §5.1 的算法;**单事务**;幂等;`MAX_LOOKBACK_PERIODS = 12`;`overflow` 时置 `hasOlderDue`
- [ ] 3.3 `listPending()` / `listOccurrences()`
- [ ] 3.4 `confirmOccurrence(id)`:单事务 + 提前返回(design.md §5.2);`ignored` 抛 `ConflictError`
- [ ] 3.5 `ignoreOccurrence(id)`
- [ ] 3.6 `deleteRule(id)`:软删除规则,并**一并软删除该规则未处理的 pending 项**
- [ ] 3.7 单测(重点):
  - 生成幂等:连续调用两次,第二次新增 0
  - 到期判断:`nextDueDate > today` 的规则不生成
  - 禁用的规则不生成
  - 上限:构造超过 12 期的场景,断言只生成 12 条且 `hasOlderDue` 为真(AC9)
  - **确认幂等**:连续确认两次,`transactions` 行数只 +1(AC5)
  - 忽略不产生账单(AC6)
  - 确认后预算数字变化:走 `/budget/overview` 断言模块已用额增加(AC4)
  - 删除规则清理 pending
  - 重新启用重置 `nextDueDate`
- [ ] 3.8 `pnpm --filter @jizhang/server test` 全绿

**回滚点 R2:** 新增服务文件 + 迁移,可 revert;迁移 002 保留(空表无害)。

## 阶段 4:路由

- [ ] 4.1 新增 `routes/recurring.ts`,注册 10 个端点(design.md §6)
- [ ] 4.2 在 `app.ts` 的 `authModule.extraRoutes` **数组内**注册(不是同级 `app.register`)
- [ ] 4.3 单测:10 个端点未认证一律 401(带 CSRF 头,否则得到 403 而非 401);缺 CSRF → 403
- [ ] 4.4 `pnpm -r run lint`、`pnpm -r run typecheck`

## 阶段 5:前端

- [ ] 5.1 `api/client.ts`:`recurring` 命名空间 + 类型(规则、到期项、结果形状)
- [ ] 5.2 `stores/recurring.ts`:规则 / 待确认 / 全部到期项;`generate()` 后刷新待确认
- [ ] 5.3 `views/RecurringRulesView.vue`:列表 + 启停 + 删除 + 新建入口
- [ ] 5.4 `views/RecurringRuleEditView.vue`:表单(频率选择、锚定日期、分类、账户、金额)
- [ ] 5.5 `views/PendingOccurrencesView.vue`:确认 / 忽略,`busy` 期间禁用
- [ ] 5.6 `DashboardView.vue`:接通待确认卡片;`generate()` 与 `loadPending()` **串行**;失败单独 `catch`,不影响首页其它数据(AC10)
- [ ] 5.7 `router/index.ts`:三条路由;`SettingsView.vue`:「周期账单」入口
- [ ] 5.8 只用既有 CSS 语义变量;所有可点击元素 ≥ 44px;输入 ≥ 16px

## 阶段 6:端到端验证

- [ ] 6.1 扩展 `scripts/lib/e2e-reset.mjs`:新增 `DELETE FROM recurring_occurrences` 与 `DELETE FROM recurring_rules`
- [ ] 6.2 新增 `scripts/e2e-recurring.mjs`(AC1–AC9)
- [ ] 6.3 新增 `scripts/render-recurring.mjs`(复用 `lib/browser.mjs`):待确认列表渲染、按钮尺寸、375px 无溢出、首页卡片有/无两种状态(AC10, AC12)
- [ ] 6.4 **重建镜像并 `--force-recreate`**(否则容器继续提供旧 bundle)
- [ ] 6.5 容器内跑全部套件,确认既有 367 项零回归、无套件间顺序依赖(**用不同顺序跑两遍**)

## 阶段 7:收尾

- [ ] 7.1 全量质量门:`pnpm -r run lint`、`pnpm -r run typecheck`、全部单测、`pnpm --filter @jizhang/web run build`、全部容器 e2e
- [ ] 7.2 用 `trellis-update-spec` 更新 spec:
  - 周期账单的"待确认"语义与为什么不做自动入账
  - **不做系统通知**的取舍(避免被当遗漏)
  - 月末规则的推进基准必须是 `anchorDate`
  - 确认操作的幂等要求
  - 新表与部分唯一索引的原因
- [ ] 7.3 逐条勾选 AC1–AC13 并写验证证据
- [ ] 7.4 按 Phase 3.4 批量提交流程提交

## 验证命令速查

```bash
pnpm --filter @jizhang/shared run build     # 必须先构建,server import 的是 dist
pnpm -r run lint
pnpm -r run typecheck
pnpm -r run test
pnpm --filter @jizhang/web run build
docker compose build && docker compose up -d --force-recreate
docker compose cp packages/server/scripts/. jizhang:/app/packages/server/scripts/
docker compose exec -T -w /app/packages/server/scripts jizhang node e2e-recurring.mjs
node packages/web/scripts/render-recurring.mjs out.png
```

## 风险与回滚点

| 风险 | 缓解 | 回滚点 |
|---|---|---|
| **重复确认导致重复记账**(最危险) | 单事务 + 提前返回;单测与 e2e 双重断言 `transactions` 只 +1 | R2 |
| 月末规则永久漂移 | 推进恒以 `anchorDate` 为基准;1/31 → 2/28 → 3/31 专项单测 | R1 |
| 部分唯一索引不被 SQLite 支持 | 阶段 0.5 实测;不可用则按 design.md 的退化方案 | R2 |
| 被遗忘的 daily 规则一次生成上千行 | 12 期上限 + `hasOlderDue` 提示 | R2 |
| shared 改了源码忘记构建 → 运行时 undefined | 阶段 1.6 明确构建;`pnpm -r run typecheck` 也是门禁 | R1 |
| e2e 套件互相污染 | 扩展 `e2e-reset.mjs`;不同顺序跑两遍验证 | — |
| 前端改完看不出变化 | `docker compose build` **且** `--force-recreate`,并重新 `cp` 脚本 | — |
