# 账户余额：工资入账与首页总余额

> 父任务 `09-13-accounts-balance-transfer` 的子任务 A。**必须先于子任务 B（转账）完成。**

## Goal

给出「我有多少钱」这个问题的答案：工资能指定收进哪个账户，每个账户有余额，首页顶上展示总余额。

用户价值：3 个账户的 ¥6,281.32 初始资金目前被存下来却从不显示、从不参与计算，用户无法回答「我还有多少钱」。

## Requirements

### R1 工资落到账户

- `salary_records` 增加 `account_id`。
- 记工资时可以选账户；服务端**必填**。
- 选错账户要能改（编辑工资时可改）。

### R2 余额是派生的，不是存的

- 每个账户余额 = `初始余额 + 收入账单 − 净支出账单 + 收到的工资`。
- **不新增余额列**（`spec/backend/database-guidelines.md:105-109` 禁止物化余额）。
- 退款必须**加回**余额（退款行的 `expenseContribution` 为负，故 `−净支出` 自动加回），同时仍然**不计收入**。
- **不做日期过滤**：与账单列表同口径，全部存活行。

### R3 首页展示总余额

- 首页顶部一张「资产」卡：大字总余额 + 每个账户一行。
- 数字来自服务端，前端只格式化，不求和。
- 总余额为负时用 danger 色。

### R4 管理页显示余额并可下钻

- 「我的 → 账户」每一行显示该账户余额。
- 点某个账户 → 跳到已按该账户筛选的账单列表。

### R5 工资的收款账户进入导出文件

工资现在有了账户，而 CSV 是用户把数据带出这个应用的唯一可读出口。导出工资记录时必须写明收款账户，
否则「这笔钱进了哪张卡」这个事实在导出文件里丢失。列名与账单导出的 `account` 一致。

## Acceptance Criteria

- [ ] **AC1** 迁移 `003` 只做加法：`ALTER TABLE salary_records ADD COLUMN account_id TEXT NOT NULL DEFAULT 'builtin-default-account'` + 索引。已应用 001/002 的库升级后，既有工资行落到 builtin 账户且金额不变；全新库迁移后 seed 正常；重复运行不重复应用。
- [ ] **AC2** `POST /api/v1/salaries` 不带 `accountId` → `400`；`accountId` 指向不存在/已删除账户 → `400`；合法时工资 DTO 含 `accountId`，且该账户余额增加 `amountCents`。`PATCH /api/v1/salaries/:id` 可改 `accountId` 并把余额从旧账户挪到新账户。
- [ ] **AC3** `GET /api/v1/accounts/balances` 返回 `{ items: [...], totalBalanceCents }`；每个 item 含 `accountId / initialBalanceCents / incomeCents / expenseCents / salaryCents / balanceCents`；`totalBalanceCents === Σ items.balanceCents`。
- [ ] **AC4** 一笔退款让 `expenseCents` 减少、`balanceCents` 增加 `amountCents`，同时 `monthlyTrend` 的 `incomeCents` **不变**——两处断言写在同一个测试里。
- [ ] **AC5** 首页渲染出的总余额等于接口返回值，**即使把客户端的账户列表清空也不变**（证明没有前端求和）。
- [ ] **AC6** 管理页账户行显示余额；点击后路由进入已带该账户筛选条件的账单列表，列表只显示该账户的账单。
- [ ] **AC7** 与本次改动无关的既有数字逐字节不变：`monthlyTrend`、`categoryShare`、`poolTrend`、预算总分配/总已用/结转池在改动前后完全相同。
- [ ] **AC8** `GET /api/v1/accounts/balances` 未带会话 cookie → `401`（新端点必须真的在受保护的路由组里）。
- [ ] **AC9** 全量门禁通过：`pnpm -r run lint`、`pnpm -r run typecheck`、`pnpm test`、`pnpm build`（含 4 个静态审计）、容器 e2e、浏览器渲染套件。
- [ ] **AC10** 首页资产卡满足移动端硬规则：任何可点元素 ≥44px、表单控件字号 ≥16px、窄于 375px 不横向溢出；颜色只用 token（`check-mobile.mjs` / `check-color.mjs` 通过）。
- [ ] **AC11** `GET /api/v1/export/salaries.csv` 的列头为 `id,date,amount,account,note,allocations`，`account` 一列是**账户名**而不是 id（R5）。

## Out of Scope

- 账户余额的历史曲线、按周期的余额快照。
- 信用卡/负债的独立建模（沿用「初始余额可为负」）。
- 转账（子任务 B）。
- 首页「结余」的语义变更：它仍是**本月**收入 − 本月支出，与「总余额」并存。

## Open Questions

无。已确认的产品决定见 `design.md` 的「已定决策」。
