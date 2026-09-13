# 验收证据 — 账户间转账（子任务 B）

执行时间：2026-09-13。全部命令都实际跑过。

## 门禁结果

| 命令 | 结果 |
|---|---|
| `pnpm -r run lint` / `typecheck` | 通过（3 个包） |
| `pnpm -r run test` | **shared 148 + server 376 = 524 通过，0 失败**（子任务 A 结束时 139 + 355 = 494） |
| `pnpm build` | 通过；mobile / motion / colour / PWA 四个静态审计全绿（bundle 240 kB < 300 kB 上限） |
| 容器 e2e | **12 个套件全通过**（新增 `e2e-transfers.mjs`，41 项断言） |
| `security-nopassword.mjs` | 通过 |
| 浏览器渲染 | **8 个套件全通过**（新增 `render-transfer.mjs`，19 项断言） |
| Playwright `chromium-iphone` | 4 passed（路由清单已加入 `/transfers` 与 `/transfers/new`） |
| Playwright `webkit-iphone` | 仍无法运行（本网络装不了 WebKit，环境限制） |

## 逐条验收

| AC | 证据 |
|---|---|
| AC1 迁移 004 只加表 | `test/db.test.ts`「004 adds transfers with the indexes the account drill-down needs」断言列清单、三个索引存在，并用 `EXPLAIN QUERY PLAN` 证明 `idx_transfer_date` **真的被 SQLite 用上**而不只是声明了 |
| AC2 拒绝矩阵 | `test/transfers.test.ts`：金额 0/负/非整数/NaN/字符串/缺失 → 400；`from === to` → 400；不存在或已软删除账户 → 400；缺字段 → 400 且文案指名；日期越界（未来 / 1999 / 非数字）→ 400；不存在的 id 读取与重复删除 → 404；`limit=0`/`limit=9999`/`offset=-1` → 400 |
| AC3 只位移总额 | `test/transfers.test.ts` 与 `e2e-transfers.mjs` 双重断言：转出账户减、转入账户增、`totalBalanceCents` **完全不变**（e2e 实测 900000 → 900000） |
| **AC4 口径零影响** | 两处：单测「记一笔转账前后，所有口径端点逐字段相等」；e2e 在**有预算、有消费、有退款**的数据上比对 `monthly-trend` / `category-share` / `pool-trend` / `budget/overview` / 账单列表，**五个全部逐字节相等**。并且先断言 snapshot 非空（budget 1000000、spent 200000），否则"前后相等"是句空话 |
| AC5 删除还原 | `e2e-transfers.mjs` 断言删除后整个 `/accounts/balances` 响应与记账前**逐字节相等**（不是"约等于"）；单测同样断言 |
| AC6 编辑位移 | 改金额 → 源账户跟着变、总额仍不变；改转入方 → 银行归零、钱包拿到新金额；`from` 改成 `to` → 400 且原记录不动 |
| AC7 五个端点都要鉴权 | `e2e-transfers.mjs` 逐个断言，实测 401/401/401/401/401 |
| AC8 UI | `render-transfer.mjs`：资产卡上有入口；列表显示两账户、金额、备注、日期；编辑/删除按钮存在；表单恰好两个账户下拉，且**互相排除对方**；无 44px 以下控件、375px 不横向溢出 |
| AC9 全量门禁 | 见上表 |
| AC10 移动端硬规则 | `check-mobile.mjs` / `check-color.mjs` 全绿；`render-transfer.mjs` 在 375px 下实测无短于 44px 的可点元素、无横向滚动；Playwright 在 375/390/430 三个宽度走遍含转账页的路由 |

## 两个只有浏览器能验的点

1. **金额必须是中性色**。`render-transfer.mjs` 读取 `.amount` 的计算颜色，并与 `--ok`、`--danger` 的**实际解析值**比较（对两个 token 各建一个探针元素取 `getComputedStyle`，而不是在测试里手写颜色解析——那会是"这个颜色是什么"的第二份实现）。实测 `rgb(28,31,35)` 既不等于 `rgb(20,119,58)` 也不等于 `rgb(201,42,42)`。
2. **表单不会让人选出同账户转账**：断言目标下拉里**不包含**已选源账户的值。

## 过程中被测试抓到的一个真问题

`e2e-transfers.mjs` 第一版的鉴权断言**假通过**：它复用了 `e2e-reset.mjs` 的 `csrfOnlyHeaders`，而那个 helper **带着有效的会话 cookie**（它是给"已登录但无 body 的写请求"用的）。于是五个端点都返回 200/400/404 而不是 401 —— 由于已登录请求本来就该成功，这个断言只是证明了 CSRF 守卫，对会话守卫什么也没说。

这正是 `spec/backend/error-handling.md:105-111` 记录的那个陷阱。修法是就地构造 `{ 'X-Requested-With': 'fetch' }`（无 Cookie），随后五个端点实测全部 401，证明 `registerTransferRoutes` 确实在 `app.ts` 的 `extraRoutes` 里。

## 一个被测试抓到的自造错误

同一套件里"源账户余额减少金额"最初写成 `startDefault - 30_000`，而 `startDefault` 是在**播种工资与账单之前**读的，于是期望值错得离谱。规约里那条「永远不要用算出来的期望值去推理钱，先把真实行 dump 出来」说的就是这件事。修法是：基线改到播种**之后**读取，并断言读到的真实值（800000）。

## 刻意没有动的东西

- `budget-engine.ts`、`types.ts`、`stats-service.ts`、`routes/budget.ts`、`routes/stats.ts`、`stores/budget.ts` **一行未改**（`git diff --name-only HEAD` 已验证）。这是 AC4 成立的结构性原因。
- 转账不进回收站、不进 CSV、不进账单列表（子任务 B 的 Out of Scope，文档里已写明代价）。

## 已知残留

- **未跑 WebKit**（环境限制，非本次引入）。
- 转账**不进 CSV 导出**：只靠 CSV 备份会丢转账；整库备份覆盖。已在 `USAGE.md` §12 明确写出。
- 转账**不进回收站**：软删除后只能靠数据库备份找回。
