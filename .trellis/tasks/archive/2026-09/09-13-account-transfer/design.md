# design.md — 账户间转账（子任务 B）

## 1. 最核心的设计决定：为什么转账必须独立成表

有两种实现方式，**选错了会让整个会计口径变得脆弱**：

| 方案 | 做法 | 后果 |
|---|---|---|
| ❌ 两笔联动账单 | 在 `transactions` 插两行（转出记支出、转入记收入），用 `transfer_group_id` 关联 | `expenseContribution` 会把转出算成**支出**（冲击预算），`incomeContribution` 会把转入算成**收入**（虚增本月收入）。必须去 `budget-engine.ts`、`stats-service.ts`、`budget` 路由、仪表盘等**十几处**加 `AND transfer_group_id IS NULL` 过滤——漏一处就是静默错账，而且前端还会把它显示成一个不存在的"分类" |
| ✅ 独立 `transfers` 表 | 一张与 `transactions` 平级的表 | 预算引擎、统计服务、账单路由**一行不改**。"转账不影响收支"成为**结构性**事实，而不是一串需要维护的约定 |

选方案二。这与既有先例一致：`salary_records` 之所以独立成表，正是因为它装不进 `transactions` 的形状（`spec/backend/index.md:57-63`）。

**可验证的推论**：本任务对 `packages/shared/src/budget-engine.ts`、`packages/server/src/services/stats-service.ts`、`packages/server/src/routes/budget.ts` 的 diff 必须是**空的**。AC4 用"转账前后逐字段相等"把它钉死。

## 2. 架构与边界

```
packages/shared/src/account-balance.ts          + transferFlowCents，input 加 transfers
packages/server/src/db/migrations/004-transfers.ts          只加表
packages/server/src/services/transfer-service.ts            新
packages/server/src/routes/transfers.ts                      新
packages/server/src/app.ts                      + 1 行进 extraRoutes
packages/web/src/api/client.ts                  + api.transfers.*
packages/web/src/stores/transfers.ts            新
packages/web/src/views/TransfersView.vue        新
packages/web/src/views/TransferEditView.vue     新
packages/web/src/router/index.ts                + 3 条路由
packages/web/src/views/DashboardView.vue        资产卡加「转账」按钮
packages/web/src/views/ManageView.vue           账户区加「转账」入口
packages/web/src/views/TransactionsView.vue     下钻页加「该账户的转账」链接
```

## 3. 共享层（纯函数，加法式扩展）

```ts
export interface TransferLike {
  readonly fromAccountId: string;
  readonly toAccountId: string;
  readonly amountCents: number;
}

/** 一笔转账让这个账户收到的钱：转出 −amount，转入 +amount，其它账户 0。 */
export function transferFlowCents(transfer: TransferLike, accountId: string): number {
  if (transfer.fromAccountId === accountId) return -transfer.amountCents;
  if (transfer.toAccountId === accountId) return transfer.amountCents;
  return 0;
}
```

`AccountBalanceInput` 增加 `transfers?: readonly TransferLike[]`（默认 `[]`），`AccountFlow` 增加 `transferInCents` / `transferOutCents`，`balanceCents` 的公式变为：

```
初始余额 + 收入账单 − 净支出账单 + 工资 + 转入 − 转出
```

**唯一需要为转账写的算式就是 `transferFlowCents` 一个。** 另一条不变量由它自动成立，且值得写成测试：

> `Σ_accounts transferFlowCents(t, accountId) === 0` —— 转账不创造也不销毁钱，所以总余额不变。

这正是 AC3 的数学形式。测试要直接断言它，而不是通过接口间接猜。

## 4. 迁移 `004-transfers.ts`

```sql
CREATE TABLE transfers (
  id              TEXT    PRIMARY KEY,
  from_account_id TEXT    NOT NULL,
  to_account_id   TEXT    NOT NULL,
  amount_cents    INTEGER NOT NULL,
  date            INTEGER NOT NULL,
  note            TEXT    NOT NULL DEFAULT '',
  deleted         INTEGER NOT NULL DEFAULT 0,
  updated_at      INTEGER NOT NULL
);

CREATE INDEX idx_transfer_date ON transfers(deleted, date DESC);
CREATE INDEX idx_transfer_from ON transfers(from_account_id, deleted, date DESC);
CREATE INDEX idx_transfer_to   ON transfers(to_account_id, deleted, date DESC);
```

与本项目 schema 约定一致：金额 `INTEGER` 分、时间 `INTEGER` epoch 毫秒、业务行软删除、无外键（`transactions` 与 `salary_records` 也不给账户加外键）、索引命名 `idx_<table>_<column>`。

**回滚形状**：老代码不知道 `transfers` 表，多一张表无害。不需要降级迁移。

## 5. 服务层

`TransferService`（`packages/server/src/services/transfer-service.ts`）：

```ts
export interface TransferDto {
  readonly id: string;
  readonly fromAccountId: string;
  readonly toAccountId: string;
  readonly amountCents: number;
  readonly date: number;
  readonly note: string;
  readonly updatedAt: number;
}

list(query: { limit?: number; offset?: number; accountId?: string }): { items: TransferDto[]; total: number }
getById(id: string): TransferDto | undefined
create(input: unknown): TransferDto
update(id: string, changes: unknown): TransferDto
softDelete(id: string): void
```

### 校验（全部 `400`，文案可读）

| 规则 | 来源 |
|---|---|
| `amountCents` 是正的安全整数 | 与 `SalaryService.requireAmount` 同规则 |
| `date` ≥ 2000-01-01 且 ≤ 现在 + 1 天 | 与 `SalaryService.requireDate` 同规则 |
| `fromAccountId !== toAccountId` | 本任务特有——同账户转账没有意义且会让 `transferFlowCents` 的语义变模糊 |
| 两个账户都存在且 `deleted = 0` | **复用子任务 A 抽出的 `assertAccountUsable(db, accountId)`**，不写第二份 |

`accountId` 过滤用 `WHERE (from_account_id = ? OR to_account_id = ?)`，这样"这个账户的转账"一次查全。

### 软删除，不进回收站

`softDelete` 置 `deleted = 1` + 更新 `updated_at`。沿用既有范围决定：回收站只覆盖账单（`spec/backend/database-guidelines.md:93-96`）。理由：把一个金额行塞进只认 `TransactionDto` 的回收站，会让那个端点变成异构列表，并且要顺带定义"彻底删除一笔转账"意味着什么——这是本任务不做的一个决定。

## 6. 接口

```
GET    /api/v1/transfers?limit&offset&accountId
POST   /api/v1/transfers
GET    /api/v1/transfers/:id
PATCH  /api/v1/transfers/:id
DELETE /api/v1/transfers/:id
```

⚠️ **本任务唯一的部署级风险**：`registerTransferRoutes` **必须**加进 `app.ts:149-164` 的 `extraRoutes` 数组。`spec/backend/index.md:44-48` 把这条列为"学得最贵的三条规则"之首：hook 与路由不在同一个 plugin 里会**静默失守**，而针对旧接线写的单测全都通过。

因此 AC7 要求：无 cookie 访问五个端点中的每一个都返回 `401`。断言写在 e2e 里，覆盖**全部五个**而不是只测一个。

## 7. 前端

### 路由（新增三个，不复用既有 name）

| path | name |
|---|---|
| `/transfers` | `transfers` |
| `/transfers/new` | `transfer-new` |
| `/transfers/:id/edit` | `transfer-edit` |

都是 `AppShell` 的子路由。**不加底部导航入口**（已满 6 格，`spec/frontend/index.md:122-133`）。

### `TransfersView.vue`

- 列表按日期倒序；每行：`支付宝 → 上海银行`、金额、日期、备注；行内「编辑」「删除」。
- 金额**中性显示**：用 `--fg`，**不用** `--ok`/`--danger`。转账既不是收入也不是支出，染色会立刻误导。这是把 `design.md` §1 的语义变成看得见的事实。
- 顶部「转账」按钮 → `transfer-new`。
- 带 `?accountId=` 时显示一个标题说明正在看哪个账户。
- 空态文案说明"还没有转账记录"。

### `TransferEditView.vue`

- 字段顺序：金额 → 从哪个账户 → 到哪个账户 → 日期 → 备注。
- 两个账户下拉**互相排除**已选的对方（比"提交后报错"好），同时保留服务端校验作为真正的关卡。
- 默认：`from` = `meta.defaultAccountId()`，`to` = 第一个不等于 `from` 的账户。
- 默认日期 = 今天（沿用 `toDateInputValue(Date.now())`）。
- 保存成功后 `transfers` store 与 `balances` store 都要刷新，然后回到列表。

### 入口接线

- `DashboardView.vue` 资产卡：加「转账」按钮（`min-height: 44px`），子任务 A 里刻意没放，本任务补上。
- `ManageView.vue` 账户区：加「转账」入口。
- `TransactionsView.vue`：当按账户筛选时，加一行「查看该账户的转账」→ `/transfers?accountId=…`。**这一条是为了补上一个真实的可见性缺口**：账单页不会显示转账，否则用户按账户下钻时会以为那笔钱凭空消失了。

## 8. 测试基础设施（必须改，否则套件互相污染）

`packages/server/scripts/lib/e2e-reset.mjs` **必须**加：

```js
db.prepare('DELETE FROM transfers').run();
```

不加的后果：转账套件建的行会被后续套件继承，而每个套件都假设自己从已知基线开始（`spec/backend/quality-guidelines.md:143-151` 记录过同类事故）。这是"加一张表"必须同步改的那一处。

## 9. 验证策略

- **单元**（`packages/shared/test/account-balance.test.ts` 扩展）：`transferFlowCents` 的三分支；`Σ transferFlow === 0`。
- **单元**（`packages/server/test/transfers.test.ts`）：AC2 的完整拒绝矩阵、AC3 的余额位移、AC5 的删除还原、AC6 的编辑位移。
- **e2e**（新增 `packages/server/scripts/e2e-transfers.mjs`）：五个端点的 `401`；CRUD 走一遍；**AC4 —— 转账前后 `monthlyTrend` / `categoryShare` / `poolTrend` / 预算总账逐字段相等**。
- **渲染**（`packages/web/scripts/render-transfer.mjs`，仿 `render-trash.mjs`）：列表渲染、金额中性色（不是 `--ok`/`--danger`）、从资产卡能进到转账页。
- **构建审计**：`check-mobile.mjs` / `check-color.mjs` / `check-motion.mjs` 覆盖新页面的硬规则。
