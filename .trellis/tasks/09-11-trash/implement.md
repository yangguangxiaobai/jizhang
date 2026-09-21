# 回收站 — 执行计划

> 前置阅读:`prd.md` → `design.md`。按顺序执行;每阶段结束可回滚。

## 阶段 0:前置核实(写代码之前)

- [ ] 0.1 读 `packages/server/src/services/transaction-service.ts` 的 `getById` / `getByIdOrThrow` / `ListTransactionsQuery`,确认 `purge` 要查的两个字段(`deleted`)如何在 service 内取得
- [ ] 0.2 读 `packages/server/src/app.ts:100-122`,确认 `authModule.extraRoutes` 的注册形状,新路由必须加进这个数组
- [ ] 0.3 读 `.trellis/spec/backend/error-handling.md`,确认 409 应如何表达;`ConflictError` 不存在,须按既有错误形状新增
- [ ] 0.4 读 `test/transactions.test.ts:470-485`,确认既有 `restore` 测试的断言,保证幂等改动不破坏它
- [ ] 0.5 确认 Fastify 对 `/api/v1/trash/restore-all`(静态)与 `/api/v1/trash/:id`(参数)的匹配优先级,并在 e2e 里**显式断言两条路径各自命中正确处理器**——不得凭框架理解下结论
- [ ] 0.6 读 `packages/web/src/views/SettingsView.vue:100-125`,确认新增按钮的 DOM 形状与既有三个按钮一致
- [ ] 0.7 读 `packages/web/src/views/TransactionsView.vue` 中金额与分类名的显示方式,保证回收站每行的口径一致

**门禁:** 0.5 若发现路由歧义,改为 `POST /api/v1/trash/restore-all` 之外的显式无歧义路径,并把结论回写 design.md。

## 阶段 1:后端 —— service

- [ ] 1.1 `transaction-service.ts` 新增 `ConflictError`(带 `statusCode = 409` 与 `code`),沿用 `ValidationError` 的既有形状
- [ ] 1.2 新增 `listDeleted(limit)`:`WHERE deleted = 1 ORDER BY updated_at DESC LIMIT ?`;上限默认值与最大值在实现时定并在注释说明
- [ ] 1.3 修改 `restore(id)`:若目标行已 `deleted === 0`,**直接返回,不执行 UPDATE**(design.md §3.2 的 AC5 理由)
- [ ] 1.4 新增 `purge(id)`:行不存在 → `NotFoundError`;`deleted === 0` → `ConflictError`(AC4);否则物理 `DELETE`
- [ ] 1.5 新增 `restoreAll()` / `purgeAll()`,各自**单事务**;返回受影响条数
- [ ] 1.6 单测(新增 `test/trash.test.ts`),至少覆盖:
  - `listDeleted` 只含已删除行,且不含未删除行(AC10)
  - `listDeleted` 按 `updated_at DESC`(删除两笔,断言后删的在前)(AC8)
  - `restore` 幂等:对未删除行调用后 `updated_at` **不变**(AC5 的强断言)
  - `purge` 对未删除行抛 409;对不存在 id 抛 404(AC4)
  - `purge` 后 `getById` 与 `list` 都不再返回该行,且**物理行数**减少(AC3)
  - `restoreAll` / `purgeAll` 的返回条数与最终行数
- [ ] 1.7 `pnpm --filter @jizhang/server test` 全绿

**回滚点 R1:** 阶段 1 只改一个 service 文件 + 新增一个测试文件,可整体 revert。

## 阶段 2:后端 —— 路由

- [ ] 2.1 新增 `routes/trash.ts`,注册五个端点(design.md §3.1)
- [ ] 2.2 在 `app.ts` 的 `authModule.extraRoutes` 数组中注册 `registerTrashRoutes`(**必须在这个数组里,不能是同级 `app.register`**)
- [ ] 2.3 路由级单测:五个端点未认证一律 401(防第一阶段"钩子与路由不在同一上下文"事故的重演)
- [ ] 2.4 断言 `DELETE /api/v1/trash`(清空)与 `DELETE /api/v1/trash/:id`(单条)命中不同处理器
- [ ] 2.5 `pnpm -r run lint`、`pnpm -r run typecheck`、`pnpm --filter @jizhang/server test` 全绿

**回滚点 R2:** 阶段 2 为新增路由文件 + `app.ts` 一处注册,可整体 revert。

## 阶段 3:前端 —— 边界与 store

- [ ] 3.1 `api/client.ts` 新增 `TrashListResult` 类型与五个方法,全部走既有 `request()`
- [ ] 3.2 新增 `stores/trash.ts`(setup style):`items` / `total` / `loading` / `errorMessage` + `load()` 与四个写方法
- [ ] 3.3 写方法成功后重新 `load()` 自己;错误写入 `errorMessage`,不吞掉

## 阶段 4:前端 —— 页面与入口

- [ ] 4.1 新增 `views/TrashView.vue`(design.md §4.2 的结构与交互)
  - 空状态可读(AC9)
  - 单条与批量都有二次确认,破坏性文案写明"不可撤销"与条数
  - `busy` 期间禁用按钮
  - 恢复按钮与彻底删除按钮**不只靠颜色区分**(文字标签 + 描边/危险色)
- [ ] 4.2 `router/index.ts` 新增 `/trash` 路由,`meta: { title: '回收站', nav: 'settings' }`
- [ ] 4.3 `SettingsView.vue` 的「数据管理」分组新增入口按钮
- [ ] 4.4 只在既有 CSS 变量上调色,不写死颜色
- [ ] 4.5 所有可点击元素 ≥ 44px

## 阶段 5:前端验证

- [ ] 5.1 `pnpm --filter @jizhang/web run build` —— 必须通过 `vue-tsc` + `check-mobile.mjs` + `check-pwa.mjs`
- [ ] 5.2 复核主 chunk 体积无显著增长(基线 ~42.6 kB gzip)
- [ ] 5.3 复用 `packages/web/scripts/render-dashboard.mjs` 的测量逻辑,参数化可测路由,对 `/trash` 断言:无横向溢出、无 <44px 控件、页面有实际内容
- [ ] 5.4 新增 `packages/server/scripts/e2e-trash.mjs`,补齐完整闭环(design.md §7)
- [ ] 5.5 容器内跑全部套件,确认既有 266 项无回归、无套件间顺序依赖

## 阶段 6:收尾

- [ ] 6.1 全量质量门:`pnpm -r run lint`、`pnpm -r run typecheck`、全部单测、全部容器 e2e
- [ ] 6.2 用 `trellis-update-spec` 更新 spec:
  - **软删除的例外**:`purge` 是唯一被授权的物理删除,且只允许作用于已删除行
  - 回收站只做账单,分类/账户/模板的软删除行**没有**回收站 UI(否则会被当成遗漏)
  - `updated_at` 作为删除时间代理的成立条件与局限
  - 新增端点清单
- [ ] 6.3 逐条勾选 AC1–AC12 并写验证证据
- [ ] 6.4 提交(按 Phase 3.4 批量流程,等用户确认)

## 验证命令速查

```bash
pnpm -r run lint
pnpm -r run typecheck
pnpm --filter @jizhang/server test
pnpm --filter @jizhang/web run build
docker compose build && docker compose up -d --force-recreate
docker compose cp packages/server/scripts/. jizhang:/app/packages/server/scripts/
docker compose exec -T -w /app/packages/server/scripts jizhang node e2e-trash.mjs
```

> **易漏点(已写入 spec):** 前端改动后必须 `docker compose build` **并且** `--force-recreate`,否则容器继续提供旧 bundle;容器重建后必须重新 `cp` 脚本,否则套件报 `chdir … no such file or directory`。

## 风险与回滚点

| 风险 | 缓解 | 回滚点 |
|---|---|---|
| 路由未进 `extraRoutes` → 五个端点无鉴权且静默可用 | 单测逐一断言 401 | R2 |
| `purge` 抹掉未删除的正常账单 | 409 护栏 + 单测 AC4 + e2e | R1 |
| `restore` 幂等改动破坏既有测试 | 阶段 0.4 先读既有断言;新增"`updated_at` 不变"的强断言 | R1 |
| `restore-all` 与 `:id` 路由歧义 | 阶段 0.5 核实 + e2e 显式断言两条路径 | R2 |
| 物理删除留下悬挂引用 | 已核实 `transactions` 无入向外键(`001-init.ts`),无需级联;若实现时发现新引用须回到 design.md | R1 |
| 前端改完看不出变化 | 见上"易漏点":`--force-recreate` + 重新 cp 脚本 | — |
