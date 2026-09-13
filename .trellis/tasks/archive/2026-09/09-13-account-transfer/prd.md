# 账户间转账

> 父任务 `09-13-accounts-balance-transfer` 的子任务 B。
> **依赖：必须先完成 `09-13-account-balance`** —— 本任务的余额纳入逻辑要调用它交付的 `computeAccountBalances` / `ledgerFlowCents`，UI 也要挂在它交付的首页资产卡上。

## Goal

让钱可以在账户之间搬（支付宝提现到上海银行、微信充值等），**并且这笔搬运不被算成收入或支出**。

用户价值：没有转账，账户余额会随时间偏离现实——搬一次钱就得记两笔假账单，而那两笔会污染预算和统计。有了转账，余额才是可信的。

## Requirements

### R1 转账是一等记账事实

- 一张 `transfers` 表：`from_account_id`、`to_account_id`、`amount_cents`、`date`、`note`、软删除。
- 金额为整数分、正数；`from ≠ to`；两个账户都必须存在且存活。
- 日期校验沿用既有规则（不早于 2000 年、不晚于明天）。

### R2 转账只动余额，不动会计口径

- 转出账户 `−amount`，转入账户 `+amount`，**全部账户合计不变**。
- 转账**不得**改变：预算总分配、总已用、各模块已用、结转池、本月收入、本月净支出、分类占比。
- 实现方式：转账**独立成表**，`budget-engine.ts`、`stats-service.ts`、`budget.ts` 路由**一行不改**。这样"转账不影响口径"是结构性的，不是靠每处记得加过滤条件。

### R3 可查、可改、可删

- 转账列表（按日期倒序）。
- 新建 / 编辑 / 删除。删除后两个账户余额精确还原。

### R4 入口

- 首页资产卡上的「转账」按钮。
- 管理页账户区一个「转账」入口。
- **不新增底部导航入口**（已满 6 格）。

## Acceptance Criteria

- [ ] **AC1** 迁移 `004` 只做加法：建 `transfers` 表 + 索引。重复运行不重复应用；老代码面对多出的表无害。
- [ ] **AC2** `POST /api/v1/transfers` 的拒绝矩阵：金额为 0 / 负数 / 非整数 → `400`；`fromAccountId === toAccountId` → `400`；账户不存在或已软删除 → `400`；日期越界 → `400`。全部为 `400` 与可读文案，不是 `500`。
- [ ] **AC3** 记一笔 ¥1000 的转账后：`GET /api/v1/accounts/balances` 里转出账户 `balanceCents` 减少 1000、转入账户增加 1000、`totalBalanceCents` **完全不变**。
- [ ] **AC4** 同一笔转账前后，`monthlyTrend`、`categoryShare`、`poolTrend` 以及预算总分配/总已用/结转池的输出**逐字段相等**（这条是本任务的核心断言）。
- [ ] **AC5** 删除转账后两个账户的 `balanceCents` 与记账前精确相等（不是"约等于"）。
- [ ] **AC6** 编辑转账的金额或账户时，旧账户被释放、新账户被计入，四个相关账户的余额都正确；把 `fromAccountId` 改成自己的 `toAccountId` 被拒绝。
- [ ] **AC7** 全部转账接口未带会话 cookie → `401`（新增的 route plugin 必须真的在 `app.ts` 的 `extraRoutes` 里）。
- [ ] **AC8** UI：从首页资产卡与管理页都能进入转账列表并新建；列表显示"转出账户 → 转入账户"、金额、日期；编辑与删除可用；校验失败时显示中文错误。
- [ ] **AC9** 全量门禁通过：`pnpm -r run lint` / `typecheck` / `test`、`pnpm build`（4 个静态审计）、容器 e2e、浏览器渲染套件。
- [ ] **AC10** 转账相关页面满足移动端硬规则（可点元素 ≥44px、字号 ≥16px、375px 不横向溢出）且只用颜色 token。

## Out of Scope

- 转账进回收站：沿用「回收站只覆盖账单」的既有范围决定（`spec/backend/database-guidelines.md:93-96`）。转账是软删除、无恢复 UI。**已知代价**：误删只能靠数据库备份找回。
- 转账进 CSV 导出/导入：CSV 保持为账单交换格式。**已知代价**：只靠 CSV 备份会丢转账；整库备份（`cli.js backup`）覆盖。
- 转账进账单列表：账单页与 `transactions` 表保持不动。
- 多币种、手续费、定期转账。

## Open Questions

无。已定决策与理由见 `design.md`。
