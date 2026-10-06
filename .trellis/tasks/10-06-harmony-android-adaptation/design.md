# Design — 适配鸿蒙和安卓两端（父任务）

子任务：`10-06-android-kotlin-native`（APK）、`10-06-harmony-arkts-native`（Hap）、
`10-06-native-parity-release`（对齐与发版）。本文件是双端共享的技术决策；
端特有细节各放子任务 PRD（A/H/P 编号）。

## 1. Architecture & boundaries

```
┌─ clients/android (Kotlin + Compose, Gradle) ─┐   ┌─ clients/harmony (ArkTS + ArkUI, DevEco) ─┐
│  UI(Compose/ArkUI) → Repository → ApiClient  │   │  同左，同构不同语言                          │
│  只呈现服务端数字，不算账                     │   │  只呈现服务端数字，不算账                     │
└──────────────────┬───────────────────────────┘   └──────────────────┬────────────────────────┘
                   │  HTTPS JSON (/api/v1/**)                         │
                   └──────────────────┬──────────────────────────────┘
                          ┌───────────▼────────────┐
                          │ 现有 Fastify + SQLite   │  不动协议、不动表结构
                          │ 口径唯一实现 shared/*   │  原生端零口径代码
                          └────────────────────────┘
```

- **服务端零改动原则**：复用现有全部路由与 session 鉴权，不新增端点、不改表。
  唯一例外需提前声明：若联调发现移动端必需（如推送 token 注册），另立服务端小任务，
  不在本任务内顺手改。
- **新目录 `clients/`（与 `packages/` 平级）**：原生工程不是 pnpm workspace 成员，
  避免 `pnpm -r` 误扫 Gradle/DevEco 工程。结构：
  `clients/android/`（APK）、`clients/harmony/`（Hap）、`clients/docs/`（对齐矩阵+发版手册）。
- **分层（双端同构）**：`ui`（页面/导航）→ `repository`（拉取+内存缓存）→
  `apiclient`（baseURL/cookie/CSRF/401/离线）。`apiclient` 双端各一份、行为一致，
  接受度以对照测试为准，不以代码共享为准。

## 2. Data flow & contracts

### 2.1 网络基线（双端必须逐项实现）

| # | 规则 | 来源 |
|---|---|---|
| N1 | baseURL 用户可填+记忆（DataStore/Preferences），默认空首启必填；仅改默认配置不改代码 | 父 PRD R3 |
| N2 | session cookie 名 `jizhang_session`，持久化，`SameSite=Lax` 语义由服务端 Set-Cookie 决定；登出/改密后清 cookie | `plugins/auth.ts` `SESSION_COOKIE` |
| N3 | 所有 mutating 请求带 `X-Requested-With: fetch`（含 bodiless POST 如 generate/confirm/ignore；登录也不例外） | `plugins/auth.ts` `CSRF_HEADER` |
| N4 | **无 body 的 POST 不带 `Content-Type: application/json`**，否则 Fastify 报 `400 FST_ERR_CTP_EMPTY_JSON_BODY`（看起来像"没生成"，实际是 UI bug） | 后端 spec recurring 节 |
| N5 | 统一错误体 `{error:{code,message}}`；401 → 回登录页；403 `CSRF_REQUIRED` → 报修网络层 | `app.ts` error handler + `client.ts` ApiError |
| N6 | 在线优先：写操作离线直接报错（对应 `OfflineError` 文案"需要联网才能记账。"），不静默、不排队；`Cache-Control: no-store` 语义延续——原生端不缓存 API 响应 | `client.ts` + `app.ts` onSend |
| N7 | 导出走"带 cookie 的下载"而非经内存拼接（CSV/备份可能是大文件）；备份恢复**不做端点**，只展示 CLI 命令 | `client.ts` portability 注释 + 后端 spec portability 节 |

### 2.2 API 分组（来源唯一真相：`packages/web/src/api/client.ts` + `packages/server/src/routes/*.ts`）

共约 92 个 `request<…>` 调用点，分组如下（双端 Repository 按此分组建文件，一一对应）：

| 组 | 端点族 | 关键语义（原生端只呈现） |
|---|---|---|
| auth | `auth/me·login·logout·password` | 401 文案统一，不区分用户名/密码错 |
| transactions | `transactions` CRUD + list query | 退款=收入勾选；毛支出不冲减（服务端算） |
| transfers | `transfers` CRUD | 非收支，仅改两账户余额；from≠to 由服务端 400 |
| trash | `trash` list/restore/purge/restore-all/purge-all | 仅 transactions 有回收站 |
| master-data | `categories`、`accounts`、`accounts/balances`、`tags` | balances 独立于 list；删账户 total 即掉（预期行为，非 bug） |
| budget | `budget/overview(?periodStart)`、`budget/periods`、`salaries`、`templates`、`settings` | 未知 periodStart=400 不回退；缺省 periodStart 行为与旧版字节一致；salaries 必带 accountId |
| recurring | `recurring/rules·generate·occurrences·pending·confirm·ignore` | 到期只产 PENDING；confirm 幂等（`created:false`）；ignore 已确认=409 |
| stats | `stats/category-share·monthly-trend·pool-trend·range·month-window` | monthlyTrend 收入=交易收入+工资；categoryShare 不含工资（预期行为） |
| portability | `export/*.csv`、`import/transactions·transfers`、`import/platform-bills`、`backups` | 本应用 CSV 全有或全无+未知名 loud-fail；平台导入 dry-run→selectedIds+categoryOverrides；BOM 按字节断言 |
| items | `items*`、`items/summary`、photo PUT/DELETE、cutouts job | 照片原字节 PUT（jpeg/png/webp）；抠图走私有服务，不可用只降级普通上传 |
| assistant/ai | `assistant/conversations·messages·actions`、`ai/config·test`、`ai/*` | 附件 fileBase64；action confirm 携带 fileBase64/selectedIds/categoryOverrides |

### 2.3 口径对照（`packages/shared` → 原生端动作）

| 口径 | shared 实现 | 原生端动作 |
|---|---|---|
| 支出/收入贡献 | `expenseContribution` / `incomeContribution`（退款只进收入） | 不实现，展示服务端值 |
| 预算周期/结余池 | `budget-engine.ts`（groups[0]=当前；periodStart 命名周期） | 不实现；历史周期用 trend 点取值 |
| 周期到期 | `recurring.ts`（anchor 推进；cap 留最新 12 期） | 不实现；调 generate+pending+confirm |
| 账户余额 | `account-balance.ts`（派生、不过滤日期） | 不实现；读 balances 端点 |
| 平台账单解析/去重 | `platform-bills.ts` + 服务端 bill-decode/xlsx-lite | 不实现；dry-run rows 原样渲染 |
| CSV 转义/BOM | `csv.ts` | 导出下载字节流；导入按 text/csv 发原文 |
| 金额/时间表示 | 全链路**分**与 **epoch ms** | 只做 分↔元格式化、ms↔本地日期展示；TZ 跟随系统（服务端 TZ=Asia/Shanghai 不可改） |

## 3. Compatibility & matrix

- **Android APK**：minSdk 在 implement 阶段锁定（建议 26，对应 Android 8，主流机型全覆盖）；
  targetSdk 跟随当年 Play 要求；验证矩阵 = 主流安卓版本 × 鸿蒙 4（兼容 Android）。
- **Harmony Hap**：编译目标 API 12 起（NEXT 基线），DevEco/SDK 基线在 implement 阶段锁定；
  验证矩阵 = HarmonyOS 5 × 6（模拟器+实机其一即可，design 不强制双实机）。
- **鸿蒙 4 不进 Hap 矩阵**（走 APK），避免"一套 Hap 通吃 4/5/6"的误解——4 与 5/6 内核不互通。
- **域名切换**：老域名已重解析不可用；双端默认地址留空待用户新域名填入；
  README/DEPLOY 的域名引用在发版任务中统一更新，不在本设计提前写死。

## 4. Trade-offs（已决策）

| 决策 | 选择 | 放弃的代价（接受） |
|---|---|---|
| 纯原生重写 vs 混合套壳 | 纯原生（Kotlin / ArkTS 各写 UI） | 工期长；但无 WebView 桥接债，上架审核面干净 |
| 全量对齐 vs MVP | 全量对齐（含 AI/抠图/导入/统计） | 首版测试矩阵大；由 parity 任务的对齐矩阵兜底 |
| 服务端解析 vs 端侧解析 | 服务端解析（平台账单/CSV/GBK） | 离线不可导入（与在线优先一致，可接受） |
| 无推送 | 应用内待确认（延续 README 架构决策） | 到期无系统提醒；推送另立任务 |
| 侧载为主 vs 立刻上架 | 侧载直装验证，预留市场位 | 首版无市场分发；包名/签名规则先行固化 |

## 5. Operational / rollback

- 服务端**不动**：回滚面只在客户端。发版产物按
  `clients/docs/release.md` 规则命名+存档，打坏了删包重打，不碰服务端。
- 签名由用户本地生成保管，不入库；versionName 与仓库版本同源，versionCode 自增；
  clean 后重打应一致（parity 任务验收）。
- 联调顺序：先 Web 回归（现有 e2e 不动）→ Android → Harmony → 三端口径矩阵；
  任何一端阻塞不卡另一端（子任务独立验证）。
