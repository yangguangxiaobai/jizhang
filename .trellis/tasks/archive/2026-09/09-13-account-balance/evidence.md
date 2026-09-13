# 验收证据 — 账户余额（子任务 A）

执行时间：2026-09-13。全部命令都实际跑过，未跑过的不写在这里。

## 门禁结果

| 命令 | 结果 |
|---|---|
| `pnpm -r run lint` | 通过（eslint `--max-warnings 0`，3 个包） |
| `pnpm -r run typecheck` | 通过（shared / server / web） |
| `pnpm -r run test` | **shared 139 + server 355 = 494 通过，0 失败**（改动前 125 + 336 = 461） |
| `pnpm build` | 通过；4 个静态审计全绿：mobile / motion / colour / PWA |
| 容器 e2e（11 个套件） | 全部 `ALL … CHECKS PASSED` |
| `security-nopassword.mjs` | `ALL NO-PASSWORD SECURITY CHECKS PASSED` |
| 备份演练 `e2e-backup.mjs` | arrange +（stop → restore → start）+ assert 全通过 |
| 浏览器渲染（7 个套件） | dashboard / budget / trash / recurring / theme / motion / color 全通过 |
| Playwright `chromium-iphone` | 4 passed |
| Playwright `webkit-iphone` | **未能运行**（本网络无法下载 WebKit；`JIZHANG_E2E_CHANNEL=chrome` 对 webkit 无效）。既有环境限制，非本次改动引入 |

## 逐条验收

| AC | 证据 |
|---|---|
| AC1 迁移 003 只加列且回填 | `test/db.test.ts`「003 backfills account_id on pre-existing salary rows and makes it required」：手工建 001+002 状态、按旧结构插入工资行、跑迁移 → 金额不变、`account_id = 'builtin-default-account'`、`PRAGMA` 显示 `notnull=1` 且 `dflt_value="'builtin-default-account'"`。线上容器 `schema_migrations` 实测含 `{version:3,name:salary-account}` |
| AC2 工资必填账户 | `test/account-balance.test.ts`：缺 `accountId` → 400 且 message 匹配 `/accountId/i`；不存在 → 400；已软删除 → 400；`PATCH` 改账户把余额从旧账户挪到新账户且总额不变；改成不存在账户 → 400 且余额不动；删除工资后钱离开账户 |
| AC3 余额接口形状 | `test/account-balance.test.ts` 断言 `totalBalanceCents === Σ items.balanceCents`、字段齐全、账户顺序与 `GET /accounts` 一致。`e2e-master-data.mjs` 在容器里独立复验一次 |
| AC4 退款加余额但不计收入 | `test/account-balance.test.ts`「一笔退款让余额增加、净支出减少，同时**不**改变本月收入」：同一用例内断言 `balanceCents +8000`、`expenseCents −8000`、`incomeCents` 不变、`monthlyTrend.incomeCents` 不变 |
| AC5 前端不求和 | `render-dashboard.mjs`：把渲染文本反解回分后与 `GET /accounts/balances` 的 `totalBalanceCents` **精确相等**；`iphone.spec.mjs` 同样断言。渲染脚本不做本地格式化，避免与 `formatYuan` 形成第二份实现 |
| AC6 管理页余额 + 下钻 | `ManageView.vue` 账户行显示余额、整行可点 → `?accountId=`；`TransactionsView.vue` 读该参数并在筛选生效时显示「仅显示X月」+「清除筛选」。`iphone.spec.mjs` 走遍 `/manage` 等路由且无小于 44px 的可点元素 |
| AC7 既有数字不变 | **结构性证据**：`git diff --name-only HEAD` 显示 `budget-engine.ts`、`types.ts`、`stats-service.ts`、`routes/budget.ts`、`routes/stats.ts`、`stores/budget.ts` **全部未被改动**；改动前已有的 461 条测试全数继续通过；`e2e-budget` / `e2e-stats` / `e2e-periods` / `e2e-recurring` 数字断言未改一字而全绿 |
| AC8 新端点受鉴权 | `test/account-balance.test.ts`「未带会话时返回 401」；`security-nopassword.mjs` 亦覆盖同类端点 |
| AC9 全量门禁 | 见上表 |
| AC10 移动端硬规则 | `check-mobile.mjs`（44px / 16px / 375px / 安全区）全绿；`render-dashboard.mjs` 实测「no interactive control on the page is shorter than 44px」；`check-color.mjs` 全绿（无字面量颜色） |
| AC11 工资 CSV 含账户名 | `test/portability.test.ts`「names the receiving account in the salaries export」断言列头 `id,date,amount,account,note,allocations`、含账户名、不含账户 id |

## 刻意没有动的东西

- `packages/shared/src/budget-engine.ts` 与所有预算/统计代码：一行未改（见 AC7）。
- 转账（子任务 B）。
- 回收站不覆盖账户（既有范围决定）。
- 信用卡负债不单独建模：沿用「初始余额可为负」。

## 已知残留

- **未跑 WebKit**：本网络装不了 WebKit 浏览器，`iphone.spec.mjs` 的 `webkit-iphone` project 无法启动（子任务 `09-12-iphone-delivery` 起就是如此）。iPhone 上的真机验证仍需人工做一次。
- 余额**不做日期过滤**：提前记的下月房租会立刻扣减余额。这是 `design.md` 里的明确决策，不是缺陷。
- 前端仍**没有编辑工资的界面**（`api.salaries.update` 已能改收款账户，但没有入口）。这是本次改动之前就存在的缺口。
