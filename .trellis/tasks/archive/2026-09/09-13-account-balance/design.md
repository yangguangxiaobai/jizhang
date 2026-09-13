# design.md — 账户余额（子任务 A）

## 1. 架构与边界

沿用既有的 `routes → services → shared` 三段式，新增的东西全部落在既有边界内：

```
packages/shared/src/account-balance.ts     纯函数：余额的唯一口径（零 IO）
packages/server/src/db/migrations/003-salary-account.ts   只加列
packages/server/src/services/account-balance-service.ts   读行 → 交给 shared
packages/server/src/routes/master-data.ts   + GET /api/v1/accounts/balances
packages/server/src/services/salary-service.ts  create/update 接受 accountId
packages/web/src/stores/balances.ts         新的 Pinia store
packages/web/src/views/DashboardView.vue    + 资产卡
packages/web/src/views/ManageView.vue       账户行显示余额 + 下钻
packages/web/src/views/SalaryEntryView.vue  + 账户选择
packages/web/src/views/SalaryRecordsView.vue 显示账户
packages/web/src/views/TransactionsView.vue  读 ?accountId= 查询参数
```

**没有新的一级路由名，没有新的底部导航入口。**

## 2. 余额口径：唯一的实现

`packages/shared/src/account-balance.ts`（纯函数，可单测，零 IO）：

```ts
/** 一行账单让这个账户收到的钱：收入 +，净支出 −。退款行的 expenseContribution 为负，故自动加回。 */
export function ledgerFlowCents(txn: Transaction): number {
  return incomeContribution(txn) - expenseContribution(txn);
}

export interface AccountLike { readonly id: string; readonly initialBalanceCents: number }
export interface SalaryLike { readonly accountId: string; readonly amountCents: number }

export interface AccountFlow {
  readonly accountId: string;
  readonly initialBalanceCents: number;
  /** 收入账单合计（退款不计，与 monthlyTrend 口径一致）。 */
  readonly incomeCents: number;
  /** 净支出合计（退款已扣减），可能为负。 */
  readonly expenseCents: number;
  /** 打进这个账户的工资合计。 */
  readonly salaryCents: number;
  readonly balanceCents: number;   // initial + income + salary − expense
}

export function computeAccountBalances(input: {
  accounts: readonly AccountLike[];
  transactions: readonly Transaction[];
  salaries: readonly SalaryLike[];
}): AccountFlow[];

export function totalBalanceCents(items: readonly AccountFlow[]): number;
```

为什么这条公式是对的、且不会与别处打架：

| 事实 | 机制 |
|---|---|
| 退款是「钱回来了」 | `expenseContribution(refund) = −amount`，故 `−expenseContribution = +amount`，余额自动增加 |
| 退款**不是**收入 | `incomeContribution(refund) = 0`，故 `incomeCents` 不涨。与 `monthlyTrend` 同源，无法漂移 |
| 工资不是账单 | 单独一个 `salaryCents` 桶，与 `StatsService.monthlyTrend` 把工资单列的做法一致 |
| 账户只影响自己 | `computeAccountBalances` 按 `accountId` 分桶，不跨账户 |

**复用而非重写**：`ledgerFlowCents` 是本文件唯一的新算式，其余全部委托给 `types.ts` 里既有的 `expenseContribution` / `incomeContribution`。退款规则的实现仍然只有一处。

## 3. 迁移 `003-salary-account.ts`

```sql
ALTER TABLE salary_records ADD COLUMN account_id TEXT NOT NULL
  DEFAULT 'builtin-default-account';
CREATE INDEX idx_salary_account ON salary_records(account_id, deleted, date DESC);
```

理由与取舍：

- **只加列，不改表**。`ALTER TABLE ADD COLUMN` 带常量 `DEFAULT`，既有行自动落到 builtin 账户，无需数据回填语句；线上 0 笔工资，实际影响为零。
- **`DEFAULT` 用常量字符串**：SQLite 的 `ADD COLUMN` 只接受常量默认值，而 `BUILTIN_DEFAULT_ACCOUNT_ID` 正是设计上不可删除、不可变的稳定常量（`001-init.ts:44`）。这是少数可以直接硬编码 id 的场合，注释里写明理由。
- **不加外键**：schema 现有的 `REFERENCES` 只有 `sessions→users` 与 `recurring_occurrences→recurring_rules`。账单表也从不给 `account_id` 加外键，保持同构。
- **迁移顺序**：`initializeDatabase` 先迁移后 seed（`db/index.ts:76-77`），所以新库上这列会先于账户行存在。没有外键约束，因此安全。
- 迁移必须追加到 `migrate.ts` 的 `MIGRATIONS` 数组末尾（顺序由数组决定，不由文件名决定）。

**回滚形状**：代码回滚后老版本不认识 `account_id`，`SELECT *` 多一列无害；`INSERT` 不写该列则取默认值。所以回滚安全，无需降级迁移。

## 4. 服务层

`AccountBalanceService.balances()`：三条只读查询，交给 shared 计算。

```ts
// 只读活账户，顺序与管理页一致
SELECT id, initial_balance_cents FROM accounts WHERE deleted = 0 ORDER BY sort_order, name
// 活账单
SELECT id, type, amount_cents, account_id, date, is_refund FROM transactions WHERE deleted = 0
// 活工资
SELECT account_id, amount_cents FROM salary_records WHERE deleted = 0
```

**不经过 `SalaryService`**：那会为了两列数据把模板服务也构造一遍。共享的口径在 `computeAccountBalances` 里，不在服务之间的调用里。

### 顺手做一次去重：`assertAccountUsable` 提成模块级函数

现在"这个账户能不能用"的检查是 `TransactionService` 的**私有方法**（`transaction-service.ts:222-230`）。本任务需要同一检查来校验工资的 `accountId`，子任务 B 还需要它校验转账的两个账户。

按规约「一条规则一份实现」（`spec/backend/quality-guidelines.md:36-40`），**在本任务里把它提成导出的模块级函数**：

```ts
// packages/server/src/services/transaction-service.ts
export function assertAccountUsable(db: Db, accountId: string): void {
  const found = db
    .prepare('SELECT 1 AS x FROM accounts WHERE id = ? AND deleted = 0')
    .get(accountId) as { x: number } | undefined;
  if (found === undefined) {
    throw new ValidationError(`Unknown or deleted account: ${accountId}`);
  }
}
```

`TransactionService` 的私有方法改为委托它，行为与错误文案保持不变（既有测试必须继续通过——这是这次重构正确的证据）。这样"账户是否可用"就只有一处实现，三个调用方共用。

### 两个已定决策（口径问题，写清楚以免以后被"修"坏）

1. **不做日期过滤**：余额统计**全部存活行**，与账单列表同口径。理由：账单列表不按「已发生」过滤，若余额加了「只算今天以前」，首页总额就会与列表里能加出来的数目对不上，而账单本身没有「待入账」概念（周期账单只有被确认才成为账单）。代价：提前记的下月房租会立刻扣减余额——这是记账（cash book）的常规语义。

2. **软删除账户 = 该账户连同余额退出资产表**。`deleteAccount` 目前**不检查**引用（`master-data-service.ts:351-364`，引用数只通过 `/accounts/:id/usage` 暴露给前端做提醒），所以活账单可以指向已删除账户。选择「按活账户汇总」而不是「把已删除账户也算进总额」，因为规约本来就说「软删除行必须从派生视图里消失」（`database-guidelines.md:69-73`）。
   - 为了让这件事**不意外**：管理页删除确认里显示「删除后总余额将减少 ¥X」。余额在删除前已经拿到，成本为零。

## 5. 接口契约

### `GET /api/v1/accounts/balances`

```json
{
  "items": [
    { "accountId": "…", "name": "支付宝", "initialBalanceCents": 58935,
      "incomeCents": 0, "expenseCents": 0, "salaryCents": 0, "balanceCents": 58935 }
  ],
  "totalBalanceCents": 628132
}
```

- 注册在 `routes/master-data.ts` 内（**已经在 `app.ts:152` 的 `extraRoutes` 里，因此天然受鉴权保护**）。
- `name` 随行返回，这样首页资产卡在 `meta` 还没加载完时也能正确渲染名字。
- **路由无歧义，已核对**：`/api/v1/accounts` 下现有的同层路由是 `PATCH`/`DELETE /accounts/:id`，**没有** `GET /accounts/:id`；`/accounts/:id/usage` 是不同深度。因此 `GET /accounts/balances` 没有同方法的竞争路由。唯一值得保留的断言是鉴权（未带 cookie → `401`），因为"新端点忘了受保护"是本项目记录过的最贵的事故类型。

### 工资接口

- `POST /api/v1/salaries` 新增必填 `accountId`：缺失 / 非字符串 / 空串 → `400`；指向不存在或已删除的账户 → `400`（用上面抽出的 `assertAccountUsable`，不静默回退默认账户——项目在导入路径上已确立「宁可直接报错」的取向，见 `spec/backend/index.md:186-197`）。
- `PATCH /api/v1/salaries/:id` 新增可选 `accountId`；改动时只写这一列，不触碰金额与分配快照。
- `SalaryDto` / `SalaryDetailDto` 增加 `accountId`。
- 编辑工资**不需要**同时提供 `allocations`（既有规则「改金额必须同时给分配」与改账户无关）。

## 6. 前端

### `stores/balances.ts`

```ts
items: AccountBalance[]; totalBalanceCents: number;
load(force = false): Promise<void>;   // loaded 标志 + 强制刷新
invalidate(): void;                   // 让下次 load 真的去取
balanceOf(accountId): number | undefined;
```
- 首页与管理页在 `onMounted` 里调用 `load(true)`（强制）。这样「忘记 invalidate 导致显示旧余额」这一整类 bug 不可能发生在唯一会展示总额的两个页面上。
- 任何改钱的视图（账单新建/编辑/删除、工资新建/删除、回收站恢复/彻底删除、转账）在成功后调用 `invalidate()`，作为同路由内的兜底。
- **前端不求和**：`totalBalanceCents` 直接用接口返回值；`items` 只用来渲染每行。

### 首页资产卡（`DashboardView.vue`）

位置：`本月概览` 卡**之上**。

```
┌──────────────────────────────┐
│ 总余额                        │
│ ¥6,281.32            [转账]   │   ← 转账按钮（子任务 B 提供）
│ 支付宝            ¥589.35     │
│ 微信               ¥49.12     │
│ 上海银行        ¥5,642.85     │
└──────────────────────────────┘
```

- 总余额为负时用 `--danger`；正负都用 `formatYuan`，符号交给格式化函数。
- 每账户一行复用最近账单行的排版习惯（左名称、右数字、`tabular-nums`）。
- 账户为 0 个时不出现（理论上不可能：builtin 不可删）。
- 加载失败时**整卡不渲染**，而不是显示 ¥0 —— 显示 0 是在报一个假数字。
- 颜色只用 token，可点元素 ≥44px（`转账` 按钮 min-height 44px）；`[转账]` 按钮在子任务 A 里先**不渲染**（子任务 B 加），避免出现点不动的按钮。

### 管理页（`ManageView.vue`）

- 账户行右侧显示余额（来自 balances store；未加载时显示 `—`）。
- 账户行本身变成可点 → `router.push({ name: 'transactions', query: { accountId } })`。**不新增路由名**（`spec/frontend/index.md:121-133`）。
- 删除确认文案带上「总余额将减少 ¥X」。

### 账单页（`TransactionsView.vue`）

- `onMounted` 读 `route.query.accountId`，若是非空字符串则写入 `store.filters.accountId` 并加载。这样下钻链接一进页面就已经筛好。
- 已有的账户下拉保持不变，用户可自行改筛选。

### 记工资（`SalaryEntryView.vue`）

- 新增「收款账户」`<select>`，默认 `meta.defaultAccountId()`。
- **默认值与账单表单同一个 helper**，所以「新建账单默认哪个账户」和「工资打进哪个账户」不会给出两个不同的答案。
- 「发薪日」下方，排在「分配模板」之前（先回答钱去哪，再回答怎么分）。

## 7. 兼容性与迁移

| 面 | 影响 |
|---|---|
| 线上库 | 迁移只加一列；0 笔工资，数据面零影响 |
| 既有 API | `POST /api/v1/salaries` 变严（新增必填字段）。无外部调用方，前端与测试同步改 |
| `e2e-reset.mjs` | **必须**同步：重置时清 `salary_records` 已覆盖；该文件硬编码了 builtin 账户名与初始余额，新增列无需改动（`DELETE FROM salary_records` 不受影响） |
| 12 个容器 e2e | 工资相关套件（`e2e-budget.mjs`、`e2e-home.mjs`）需补 `accountId` |
| 浏览器渲染套件 | `render-dashboard.mjs` 增加资产卡断言 |

## 8. 验证策略

- **单元**：`packages/shared/test/account-balance.test.ts` 覆盖收入/支出/退款/工资/空账户/负初始余额；并断言 `totalBalanceCents === Σ balanceCents`。
- **单元**：`packages/server/test/account-balance.test.ts` 覆盖迁移、接口形状、`401` 无 cookie、非法的 `accountId`。
- **回归**：AC7 用「同一份数据，改动前后 `monthlyTrend` / `categoryShare` / `poolTrend` / 预算总账逐字段相等」的断言实现。
- **渲染**：`render-dashboard.mjs` 断言资产卡出现、总额数字等于接口值、每账户一行；`scripts/check-mobile.mjs` 与 `check-color.mjs` 覆盖硬规则。
