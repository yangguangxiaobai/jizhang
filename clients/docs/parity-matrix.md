# parity-matrix.md — 三端口径对齐矩阵（P1）

> 子任务 `10-06-native-parity-release` P1/P2。
> 种子账本：服务端 e2e 装置 `packages/server/test/`（`budget.test.ts` / `stats.test.ts` /
> `recurring.test.ts` / `portability.test.ts` / `transfers.test.ts` / `trash.test.ts`）。
> 口径唯一实现：`packages/shared/src/`（原生端零口径代码，见设计 §2.3）。

## 状态图例

| 标记 | 含义 |
|---|---|
| ✅ 已验证 | 代码落盘 + 已有可复现证据（构建产物 / 静态点检），无需真机即可确认 |
| 🔶 对齐 | 代码落盘完成（code-complete），待新域名 + 真机联调时做三端同屏数字截图打勾 |
| ⬜ 待补 | 首轮未覆盖，需后续批次补 |

> **全局说明（2026-10-06）**：生产域名 `jz.yansuu1.com` 已重解析不可用，新域名待用户提供。
> 因此所有"三端同账号同周期数字对照"只能在新域名 + 真机/模拟器联调时执行。
> 本矩阵中凡标 🔶 的行，其"对齐"结论依据 = 原生端只呈现服务端返回值（零口径代码）+
> 网络层 N1–N7 点检通过，而非真机截图。待联调时逐项把 🔶 翻为 ✅ 或记录差异。

## P1 对齐表（同一账号、同一周期）

| # | 对照项 | Web（基准） | Android（APK） | Harmony（Hap） | shared 映射行 | 状态 |
|---|---|---|---|---|---|---|
| 1 | 首页资产总额 `totalBalanceCents` | `stores/balances.ts` 直显服务端值 | `ApiClient` + Balances 仓直显 `balances` 端点 | `ApiClient.ets` + repo 直显同端点 | `account-balance.ts` → 原生端不实现，读 `GET /accounts/balances` | 🔶 对齐 |
| 2 | 预算模块已用/剩余（各 module views） | `stores/budget.ts` 无算术，直显 `overview` | 直显 `budget/overview(?periodStart)` | 直显同接口（`BudgetView.ets`） | `budget-engine.ts`（groups[0]=当前；periodStart 命名周期）→ 不实现 | 🔶 对齐 |
| 3 | 结余池 `carryoverPoolCents`（含负值语义） | 同上，直显；`poolIsNegative` 仅做 `<0` 展示判断 | 同上 | 同上 | `budget-engine.ts` `computeCarryoverPool` → 不实现；历史周期取 trend 点值 | 🔶 对齐 |
| 4 | 统计：分类环形图 `categoryShare` | 服务端值手绘 SVG | 原生绘制（A6） | `Charts.ets` 原生绘制（H4） | 不含工资为**预期行为**（后端 spec；工资无 category）→ 不实现 | 🔶 对齐 |
| 5 | 统计：月度柱状 `monthlyTrend` | 同上 | 原生绘制（A6） | `Charts.ets` 原生绘制（H4） | 收入=交易收入+工资（`salary_records` 独立表）→ 不实现 | 🔶 对齐 |
| 6 | 统计：结余趋势 `poolTrend` | 同上 | 原生绘制（A6） | `Charts.ets` 原生绘制（H4） | `PoolTrendPoint.periodStart` 即周期名 → 不实现 | 🔶 对齐 |
| 7 | 账户余额列表（各账户 `balanceCents`） | `stores/balances.ts` 直显 | 直显（A7） | 直显（`Manage.ets`） | `account-balance.ts`：派生、不过滤日期；删账户 total 即掉为**预期行为** → 不实现 | 🔶 对齐 |
| 8 | 账单列表：退款显示 | 退款=收入勾选，毛支出不冲减（服务端算） | 同语义呈现（A3） | 同语义呈现（`TransactionsView.ets`） | `expenseContribution` / `incomeContribution`（退款只进收入）→ 不实现 | 🔶 对齐 |
| 9 | 转账：不计入收支 | `stores/transfers.ts` 只存行，不算余额影响 | 同（A3） | 同（`TransfersTrash.ets`） | `transferFlowCents` 唯一 from/to 判定点；`from≠to` 服务端 400 → 不实现 | 🔶 对齐 |
| 10 | 周期账单：到期→待确认→confirm/ignore | `stores/recurring.ts` 调 generate+pending+confirm | 同（A5）；confirm 幂等（`created:false`）；ignore 已确认=409 | 同（`SalaryPending.ets`） | `recurring.ts`（anchor 推进；cap 留最新 12 期）→ 不实现 | 🔶 对齐 |
| 11 | 数据导入：微信/支付宝 dry-run 预览→勾选→覆盖分类→确认 | 服务端解析/GBK 解码/去重 | 端侧只做选文件+读字节+调 `POST /import/platform-bills`（A8） | 同（`DataView.ets` + Picker）（H3） | `platform-bills.ts` + 服务端 bill-decode/xlsx-lite → 不实现 | 🔶 对齐 |
| 12 | CSV 导出/导入 | BOM 按字节断言；全有或全无；未知名 loud-fail | 下载走带 cookie 字节流（A8） | 同（`DataView.ets`） | `csv.ts`（BOM `EF BB BF`；按 id 去重）→ 端侧不拼 CSV | 🔶 对齐 |
| 13 | 金额/时间表示 | 分 + epoch ms；TZ 跟随系统 | 分↔元仅格式化（A11 前） | `format.ets` 仅格式化（H2） | 全链路分/ms；服务端 TZ=Asia/Shanghai 不可改 → 端侧不转时区 | ✅ 已验证 |
| 14 | 网络层 N1–N7（baseURL/cookie/CSRF/401/离线/无 body POST 去 Content-Type/大文件下载） | `api/client.ts` | `ApiClient.kt` 点检通过；bodiless POST（generate）形状已覆盖 | `ApiClient.ets` 点检通过；同构行为 | —（传输层，非口径） | ✅ 已验证 |
| 15 | 外观：三态主题 + 三套主色 | token 体系（`main.css`） | 三态 system/light/dark + 钛蓝/森林绿/极简黑白（A11） | `theme.ets` 同语义（H2） | `palette.ts`（十二槽分类色顺序）→ 展示层对齐 | 🔶 对齐 |
| 16 | AI 助理（含预览导入行）/ 物品资产（含抠图降级） | Web 全量 | A9/A10 落盘 | `AssistantView.ets` / `ItemsView.ets` 落盘；抠图走私有服务，不可用降级普通上传 | —（服务端算/私有服务推理） | 🔶 对齐 |

允许的唯一差异：小数展示舍入（分→元格式化），且需在联调截图备注中注明。

## P2 对齐测试方法（联调时执行，新域名就绪后）

1. 用 `packages/server/test/` 种子账本起后端（e2e 装置即种子来源，不新增数据）。
2. 同一账号、同一周期，在 Web / Android / Harmony 三端截图记录上表 #1–#7 数字。
3. 逐项打勾：一致 → ✅；不一致 → 记录差异 + 定位是展示 bug 还是口径分叉（后者不允许，必须修）。
4. 构建可重复性：APK `clean assembleRelease` 重打一致（已验证，见 `release.md`）；
   Hap `hvigor assembleHap` 重打一致（2026-10-06 CLI 已验证，见 `release.md`）。
