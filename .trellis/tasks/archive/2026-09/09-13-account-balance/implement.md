# implement.md — 账户余额（子任务 A）

> 执行顺序即依赖顺序。每一步末尾的验证命令必须真的跑过，未跑过的步骤不算完成。

## 前置

```bash
git status --porcelain          # 期望：只有 .trellis/ .agents/ .dsh/ 未跟踪
pnpm install                    # 确认依赖就绪
pnpm -r run lint && pnpm -r run typecheck && pnpm test   # baseline：先确认当前全绿
```

## 步骤

### 1. 共享层：余额口径

- 新建 `packages/shared/src/account-balance.ts`（见 `design.md` §2）。
- 从 `packages/shared/src/index.ts` 导出。
- 新建 `packages/shared/test/account-balance.test.ts`。

要点：
- 只用 `expenseContribution` / `incomeContribution`，**不得**自己判断 `isRefund`。
- `expenseCents` 是**净支出**（退款已扣减），注释里写明，否则下一个人会以为它是毛支出。
- 测例必须包含：一笔支出 + 一笔退款（余额增加、`incomeCents` 不变）、一笔工资、一笔收入账单、初始余额为负的账户、没有流水的账户（余额 = 初始余额）。

```bash
pnpm --filter @jizhang/shared run test
pnpm --filter @jizhang/shared run typecheck
pnpm --filter @jizhang/shared run lint
```

### 2. 迁移 003

- 新建 `packages/server/src/db/migrations/003-salary-account.ts`，导出 `MIGRATION_003_SALARY_ACCOUNT`。
- 在 `packages/server/src/db/migrate.ts` 的 `MIGRATIONS` 数组**末尾**追加 `{ version: 3, name: 'salary-account', sql: MIGRATION_003_SALARY_ACCOUNT }`。

⚠️ **风险点**：忘记追加到数组 → 迁移永不运行，而单测若只 `CREATE TABLE` 自建夹具仍会全绿。用「完成后自检」里的 `schema_migrations` 端到端检查兜住。

```bash
pnpm --filter @jizhang/server run test -- db
```

### 3. 服务层：AccountBalanceService

- 新建 `packages/server/src/services/account-balance-service.ts`。
- `balances(): { items: AccountBalanceDto[]; totalBalanceCents: number }`，DTO 为 camelCase（snake_case→camelCase 的边界在服务层）。
- 三条读查询按 `design.md` §4；**活账户** + **活账单** + **活工资**。

```bash
pnpm --filter @jizhang/server run typecheck
```

### 4. 接口

- **先做一次去重**：把 `transaction-service.ts:222-230` 的私有 `assertAccountUsable` 提成导出的模块级函数 `assertAccountUsable(db, accountId)`，私有方法改为委托它（错误文案与行为不变）。见 `design.md` §4 末节。子任务 B 会复用它，所以这一步必须在本任务里完成。
- `packages/server/src/routes/master-data.ts`：加 `GET /api/v1/accounts/balances`（该插件已在 `extraRoutes` 内，鉴权自动生效，**不需要改 `app.ts`**）。
- `packages/server/src/services/salary-service.ts`：
  - `CreateSalaryInput` / 内部写入加 `accountId`（必填 + 用 `assertAccountUsable` 校验）。
  - `update()` 支持可选 `accountId`。
  - `SalaryDto` / `SalaryDetailDto` 加 `accountId`；`toDto` 映射。

⚠️ **本任务最贵的风险点**：迁移忘了追加到 `MIGRATIONS` 数组（第 2 步）——表列永远不会存在，而自建夹具的单测仍全绿。
次要风险：新端点漏鉴权。已核对路由无歧义（`/accounts` 下没有同方法的 `GET /:id`），但仍要断言**未带 cookie → `401`**——"新端点忘了受保护"是本项目记录过的最贵的事故类型。

⚠️ 重构 `assertAccountUsable` 后，`test/transactions.test.ts` 的账户错误断言必须**原样通过**——它是这次重构没有改变行为的证据。

```bash
pnpm --filter @jizhang/server run test -- master-data
pnpm --filter @jizhang/server run test -- budget stats
```

### 5. 前端 API 与 store

- `packages/web/src/api/client.ts`：`api.accounts.balances()`、`AccountBalance` 类型、`salary.create` 的 `accountId`、`SalaryDto.accountId`。
- 新建 `packages/web/src/stores/balances.ts`（见 `design.md` §6）。

### 6. 前端视图

按 `design.md` §6 依次改：`DashboardView.vue` → `ManageView.vue` → `TransactionsView.vue` → `SalaryEntryView.vue` → `SalaryRecordsView.vue`。

⚠️ 注意：
- `ManageView` 的账户行现在既是「显示余额」又是「可点下钻」，`check-mobile.mjs` 会检查可点元素高度——需要 ≥44px。
- `TransactionsView` 读 `route.query.accountId` 时用 `typeof === 'string'` 判断（query 可能是数组）。
- 资产卡里**不要**渲染转账按钮（子任务 B 才加）。

```bash
pnpm --filter @jizhang/web run typecheck
pnpm --filter @jizhang/web run lint
pnpm --filter @jizhang/web run check:mobile
pnpm --filter @jizhang/web run check:color
```

### 7. 更新既有测试与 e2e

- `packages/server/test/*`：所有构造工资的地方补 `accountId`。
- `packages/server/scripts/e2e-budget.mjs`、`e2e-home.mjs`：补 `accountId`。
- `packages/server/scripts/e2e-master-data.mjs`：加余额接口的断言（含初始余额进总额）。
- `packages/web/scripts/render-dashboard.mjs`：加资产卡断言。
- **`packages/server/scripts/lib/e2e-reset.mjs` 不需要改**（它 `DELETE FROM salary_records`，已覆盖），但要确认重置后的 builtin 账户 `initial_balance_cents = 0` 使总额可预测。

### 8. 回归断言（AC7）

新增一条服务端测试：在同一份数据上先取 `monthlyTrend` / `categoryShare` / `poolTrend` / 预算总账，插一笔收入、一笔支出、一笔退款、一笔工资后，断言各数字按预期变化，且**预算分配与结转池只受工资/支出影响、与本次改动前口径一致**。这条测试的作用是证明余额的引入没有把会计口径改掉。

## 验证门禁（全跑，缺一不可）

```bash
pnpm -r run lint                # eslint --max-warnings 0
pnpm -r run typecheck           # tsc --noEmit
pnpm -r run test                # vitest run
pnpm build                      # vue-tsc + check-mobile + check-motion + check-color + vite build + check-pwa
```

镜像与容器（`spec/backend/quality-guidelines.md:19-25`）：

```bash
docker compose build && docker compose up -d
curl -fsS http://127.0.0.1:8081/api/v1/health
docker compose exec -T jizhang whoami          # 必须是 node，不能是 root
```

容器 e2e（套件**不在镜像里**，必须先 `cp`）：

```bash
docker compose cp packages/server/scripts/. jizhang:/app/packages/server/scripts
docker compose exec -w /app/packages/server/scripts -T jizhang node e2e-master-data.mjs
docker compose exec -w /app/packages/server/scripts -T jizhang node e2e-budget.mjs
docker compose exec -w /app/packages/server/scripts -T jizhang node e2e-home.mjs
docker compose exec -w /app/packages/server/scripts -T jizhang node e2e-stats.mjs
docker compose exec -w /app/packages/server/scripts -T jizhang node e2e-transactions.mjs
docker compose exec -w /app/packages/server/scripts -T jizhang node e2e-trash.mjs
```

**独立性必须显式验证**（`quality-guidelines.md:153-155`）：把套件换个顺序、或每个跑两遍，确认计数不变。

浏览器渲染（前端改动必须有浏览器证据）：

```bash
node packages/web/scripts/render-dashboard.mjs
```

⚠️ 跑之前删掉脚本固定的 `--user-data-dir` 配置目录，否则 HTTP 缓存会喂回旧构建，报告一个假结果（`quality-guidelines.md:229-231`）。

⚠️ 前端改动只有**重建镜像**才会进到容器里（`packages/web/dist` 在构建期烤进镜像）；重启容器不够（`quality-guidelines.md:206-209`）。

## 回滚点

| 位置 | 回滚方式 |
|---|---|
| 迁移 003 之后、代码未上 | 数据库多一列，无影响；可直接回滚代码 |
| 服务/接口改动 | `git revert` 该提交；老代码不认识 `account_id`，`SELECT *` 多列无害 |
| 前端资产卡 | 独立提交，可单独 revert，不影响服务端 |
| 线上事故 | `docker compose` 回退镜像标签 + 用 `/opt/jizhang` 的备份恢复数据库（若数据库已迁移且需要降级） |

## 完成后自检

- [ ] 线上库升级后 `schema_migrations` 出现 `version = 3`。
- [ ] `GET /api/v1/accounts/balances` 对用户真实的 3 个账户返回 `totalBalanceCents = 628132`（¥6,281.32，0 笔账单时等于初始资金之和）。
- [ ] 首页总余额与上面的数字一致。
- [ ] 无 cookie 访问该接口得到 `401`。
