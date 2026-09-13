# Journal - quiz (Part 1)

> AI development session journal
> Started: 2026-09-11

---



## Session 1: 账户余额：工资入账、首页总余额、账户下钻

**Date**: 2026-09-13
**Task**: 账户余额：工资入账、首页总余额、账户下钻
**Branch**: `master`

### Summary

shared 新增 account-balance.ts（余额=初始+收入−净支出+工资，退款经 expenseContribution 自动加回且不计收入）；迁移 003 只加 salary_records.account_id NOT NULL DEFAULT builtin（常量默认值回填，无需 UPDATE）；AccountBalanceService + GET /accounts/balances（服务端派生，不落库）；工资 accountId 必填，缺失/不存在/已删除一律 400；首页资产卡 + 管理页余额与按账户下钻；工资 CSV 导出增加 account 列。AC7 的结构性证据：budget-engine/types/stats-service/routes-budget/routes-stats/stores-budget 一行未改。门禁：494 单测、11 容器 e2e、security、备份演练、7 浏览器套件、chromium-iphone 4 全绿；webkit-iphone 因本网络装不了 WebKit 仍未跑。

### Git Commits

| Hash | Message |
|------|---------|
| `35c81a5` | (see git log) |

### Status

[OK] **Completed**


## Session 2: 账户间转账：独立成表，口径零影响

**Date**: 2026-09-13
**Task**: 账户间转账：独立成表，口径零影响
**Branch**: `master`

### Summary

transferFlowCents 是唯一算式,所有账户求和恒为 0;迁移 004 建 transfers 表(两方向各一索引);TransferService 校验矩阵;5 个端点注册进 app.ts 的 extraRoutes。转账独立成表使 budget-engine/types/stats-service/routes-budget/routes-stats/stores-budget 一行未改——AC4 因此是结构性的,并由 e2e 在含收入+支出+退款+工资+转账的数据上逐字节比对五个端点。前端转账列表/录入页 + 资产卡入口 + 账单下钻链接,金额用中性色(不用 --ok/--danger)。门禁:524 单测、12 容器 e2e、8 渲染套件、chromium-iphone 4 全绿。过程中抓到两个自己的错误:e2e 鉴权断言误用带 cookie 的 csrfOnlyHeaders 导致假通过;余额期望值用算出来的而非先 dump 真实行。

### Git Commits

| Hash | Message |
|------|---------|
| `57ec57d` | (see git log) |

### Status

[OK] **Completed**
