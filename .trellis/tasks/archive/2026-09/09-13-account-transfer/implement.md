# implement.md — 账户间转账（子任务 B）

> **前置：`09-13-account-balance` 已完成并提交。** 本任务依赖它交付的 `computeAccountBalances`、`AccountBalanceService`、首页资产卡与管理页余额。
> 执行顺序即依赖顺序。每一步末尾的验证命令必须真的跑过。

## 前置

```bash
git log --oneline -3                     # 确认子任务 A 的提交已在历史里
python ./.trellis/scripts/task.py current --source
pnpm -r run lint && pnpm -r run typecheck && pnpm -r run test    # baseline 全绿
```

## 步骤

### 1. 共享层：转账的流量

- `packages/shared/src/account-balance.ts`：加 `TransferLike`、`transferFlowCents`；`AccountBalanceInput` 加可选 `transfers`（默认 `[]`）；`AccountFlow` 加 `transferInCents` / `transferOutCents`；`balanceCents` 公式加 `+ transferIn − transferOut`。
- 扩展 `packages/shared/test/account-balance.test.ts`。

⚠️ **关键测试**：`Σ_accounts transferFlowCents(t, accountId) === 0`。这是"转账不创造钱"的数学形式，也是 AC3 的来源。用属性式断言（多组账户/金额），不要只测一组。

```bash
pnpm --filter @jizhang/shared run test && pnpm --filter @jizhang/shared run typecheck && pnpm --filter @jizhang/shared run lint
```

### 2. 迁移 004

- 新建 `packages/server/src/db/migrations/004-transfers.ts`，导出 `MIGRATION_004_TRANSFERS`。
- `packages/server/src/db/migrate.ts` 的 `MIGRATIONS` 末尾追加 `{ version: 4, name: 'transfers', sql: MIGRATION_004_TRANSFERS }`。

⚠️ 与子任务 A 同一个坑：忘了追加数组 → 表永远不存在，而自建夹具的单测仍全绿。用第 8 步的 e2e 兜住。

### 3. 服务层：TransferService

- 新建 `packages/server/src/services/transfer-service.ts`（见 `design.md` §5）。
- 校验规则抄 `salary-service.ts` 的 `requireAmount` / `requireDate` 语义；账户可用性用**子任务 A 抽出的** `assertAccountUsable(db, accountId)`——**不要**在这里写第二份账户查询。
- `list` 的 `accountId` 过滤用 `(from_account_id = ? OR to_account_id = ?)`。

```bash
pnpm --filter @jizhang/server run typecheck
```

### 4. 接口与鉴权接线

- 新建 `packages/server/src/routes/transfers.ts`，导出 `registerTransferRoutes`。
- **`packages/server/src/app.ts`**：在 `extraRoutes` 数组里加一行
  `(instance) => registerTransferRoutes(instance, { db, now: options.now }),`

⚠️⚠️ **本任务最危险的一步**。漏掉这一行：五个端点全部**无鉴权**且返回正常结果，而任何只测"能创建转账"的测试都会通过。`spec/backend/index.md:44-48` 把它列为最贵的坑。

必须写的断言：**无 cookie 逐个访问 5 个端点 → 全部 `401`**。逐个，不是挑一个。

⚠️ **但 3 个写端点必须带上 `X-Requested-With: fetch` 才能测到会话守卫**：CSRF 检查跑在鉴权守卫**之前**，所以一个既没有会话、又没有 CSRF 头的 `POST` 会答 **403**，那条断言就只证明了 CSRF 守卫、对会话守卫什么也没说（`spec/backend/error-handling.md:105-111`）。用 `e2e-reset.mjs` 导出的 `csrfOnlyHeaders`（只有 `X-Requested-With`）配一个假 cookie 或用空 Cookie，断言 401。

```bash
pnpm --filter @jizhang/server run test -- transfers
```

### 5. 前端 API 与 store

- `packages/web/src/api/client.ts`：`api.transfers.{list,create,get,update,remove}` + `Transfer` 类型。
- 新建 `packages/web/src/stores/transfers.ts`（仿 `stores/transactions.ts`：`items` / `total` / `loading` / `errorMessage` / `load()`）。
- 任何成功的写操作后同时刷新 `transfers` **和** `balances`（`useBalanceStore().invalidate()`）——否则回到首页会看到旧余额。

### 6. 前端视图与路由

- 新建 `packages/web/src/views/TransfersView.vue`、`packages/web/src/views/TransferEditView.vue`（见 `design.md` §7）。
- `packages/web/src/router/index.ts`：加 `transfers` / `transfer-new` / `transfer-edit` 三条子路由。**不复用任何既有 route name。**
- `DashboardView.vue`：资产卡加「转账」按钮。
- `ManageView.vue`：账户区加「转账」入口。
- `TransactionsView.vue`：按账户筛选时加「查看该账户的转账」链接。

⚠️ 金额必须**中性色**（`--fg`），不得用 `--ok` / `--danger`。这是语义要求，不是审美偏好。

```bash
pnpm --filter @jizhang/web run typecheck && pnpm --filter @jizhang/web run lint
pnpm --filter @jizhang/web run check:mobile && pnpm --filter @jizhang/web run check:color && pnpm --filter @jizhang/web run check:motion
```

### 7. 测试基础设施（**漏了会污染其它套件**）

`packages/server/scripts/lib/e2e-reset.mjs`：在清库的 `db.transaction` 里加

```js
db.prepare('DELETE FROM transfers').run();
```

不加的后果：转账套件的数据被后续套件继承，而后继套件都假设自己从已知基线开始（`spec/backend/quality-guidelines.md:143-151` 记录过同类事故）。

### 8. 新测试

- `packages/server/test/transfers.test.ts`：AC2 拒绝矩阵、AC3 余额位移、AC5 删除还原、AC6 编辑位移。
- `packages/server/scripts/e2e-transfers.mjs`（新，样式仿 `e2e-trash.mjs`，开头调 `resetToKnownState()`）：
  - 五个端点无 cookie → `401`；
  - CRUD 全流程；
  - **AC4：一笔转账前后，`monthlyTrend` / `categoryShare` / `poolTrend` / 预算总账逐字段相等。** 断言前先确认数据里同时有账单与工资，否则这条断言是空的（空数据前后相等没有意义）。
- `packages/web/scripts/render-transfer.mjs`（新，样式仿 `render-trash.mjs`）：列表渲染、金额不是 `--ok`/`--danger`、从资产卡可以进到转账页。
- `packages/web/scripts/render-dashboard.mjs`：断言资产卡上的「转账」按钮存在且高度 ≥44px。

### 9. 文档

- `USAGE.md`：加一小节「转账」，明确说明**转账不算收入也不算支出**，以及为什么不进账单列表。
  ⚠️ 子任务 A 在 §14 常见问题里留了一句「账户之间的转账目前还没有专门的功能」——**本任务必须把它改掉**，
  否则文档会声称一个已经存在的功能不存在。
- `README.md`：API 表加 5 个端点。

## 验证门禁（全跑，缺一不可）

```bash
pnpm -r run lint
pnpm -r run typecheck
pnpm -r run test
pnpm build
```

镜像与容器：

```bash
docker compose build && docker compose up -d
curl -fsS http://127.0.0.1:8081/api/v1/health
docker compose exec -T jizhang whoami          # 必须是 node
```

容器 e2e（套件不在镜像里，先 `cp`）：

```bash
docker compose cp packages/server/scripts/. jizhang:/app/packages/server/scripts
docker compose exec -w /app/packages/server/scripts -T jizhang node e2e-transfers.mjs
docker compose exec -w /app/packages/server/scripts -T jizhang node e2e-budget.mjs
docker compose exec -w /app/packages/server/scripts -T jizhang node e2e-stats.mjs
docker compose exec -w /app/packages/server/scripts -T jizhang node e2e-home.mjs
docker compose exec -w /app/packages/server/scripts -T jizhang node e2e-master-data.mjs
docker compose exec -w /app/packages/server/scripts -T jizhang node e2e-transactions.mjs
docker compose exec -w /app/packages/server/scripts -T jizhang node e2e-trash.mjs
```

再把 `e2e-transfers.mjs` 换个位置跑第二遍，确认套件彼此独立（`quality-guidelines.md:153-155`）。

浏览器渲染：

```bash
node packages/web/scripts/render-transfer.mjs
node packages/web/scripts/render-dashboard.mjs
```

⚠️ 跑前删掉脚本固定的 `--user-data-dir` 配置目录，否则报告的是旧构建。
⚠️ 前端改动只有**重建镜像**才进容器；重启容器不够。

## 回滚点

| 位置 | 回滚方式 |
|---|---|
| 迁移 004 | 多一张空表，无影响；直接回滚代码 |
| 服务/接口 | `git revert`；`transfers` 表留存不影响老代码 |
| `app.ts` 那一行 | 与 `routes/transfers.ts` 必须同进同退；只回滚其中一个会留下无鉴权端点或死代码 |
| 前端页面 | 独立提交，可单独 revert |

## 完成后自检

- [ ] AC4 的断言真的在数据非空的前提下跑过，而不是在空库上"通过"。
- [ ] 五个端点无 cookie 全部 `401`（逐个确认）。
- [ ] `e2e-reset.mjs` 里有 `DELETE FROM transfers`。
- [ ] 线上：记一笔转账，首页总额不变、两个账户一增一减、账单页与统计页数字不变（浏览器里实际点一遍）。
