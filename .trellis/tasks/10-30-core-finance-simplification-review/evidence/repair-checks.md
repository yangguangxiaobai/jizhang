# 核心财务修复验收证据（T14）

- 执行日期：2026-11-01（Asia/Shanghai）
- 修复计划：`docs/superpowers/plans/2026-10-30-core-finance-simplification-repair.md`（T01–T14）
- 源码基线 commit：`bde9a18da5ef33567f52fb544f181479cd4aedf3`（2026-10-29T15:19:51+08:00）
- 工作区状态：未提交改动 359 项（含既有 343+ 基线改动与本轮修复新增/修改），未执行任何 reset/clean/`git add -A`
- 证据分级：SOURCE（源码核对）/ AUTOMATION（自动化命令）/ DEVICE（真机）

## 1. 自动化门禁结果（AUTOMATION）

| 门禁 | 命令 | 结果 |
|---|---|---|
| shared 全量测试 | `pnpm --filter @jizhang/shared test` | 12 文件 / **388 项全通过**，exit 0 |
| shared 构建 | `pnpm --filter @jizhang/shared build` | exit 0 |
| server 全量测试 | `pnpm --filter @jizhang/server test --maxWorkers=2` | 49 文件 / **1038 项全通过**，exit 0 |
| server 构建 | `pnpm --filter @jizhang/server build` | exit 0 |
| Android 单元测试 | `./gradlew.bat --no-daemon --offline :app:testDebugUnitTest` | 62 套 / **570 项全通过**，0 失败 0 跳过 |
| Android lint | `./gradlew.bat --no-daemon --offline :app:lintDebug` | **0 错误** / 43 警告，exit 0 |
| Android 打包 | `./gradlew.bat --no-daemon --offline :app:assembleDebug` | BUILD SUCCESSFUL，exit 0 |

产物：`clients/android/app/build/outputs/apk/debug/app-debug.apk`，23,122,366 字节，SHA-256 `7FEC23EE14415B3EDF3F76B0E01D114E414FFCD81665CE32632CDA8649785EEC`。

## 2. 跨域全链路集成用例（AUTOMATION）

新增 `packages/server/test/core-finance-repair-integration.test.ts`（用例名 `coreFinanceRepairKeepsOneSalaryAndDistinctMoneyViews`），在 `app.inject()` + 隔离内存库 + 固定时钟 `now = 2026-10-29 12:00 Asia/Shanghai` 下跑完整合成账本：

1. 工资 10000 元（`amountCents = 10_000` 分）经 preview→confirm 明确纳入 2026-10 周期；
2. 断言工资事实**只 1 笔**（不额外生成普通收入）；
3. 必要 3200 + 随心 600 两笔消费；
4. 月计划视图：`confirmedIncomeCents=10_000`、四用途 `2500/1500/5000/1000`、消费预算 `6_000` 独立于旧模板毛额 `10_000`、已花 `3_800`、剩 `2_200`、必要剩 `1_800`、随心剩 `400`；
5. 手动存投：应急起始 12000、本期存 1500、取 1000（UUID operationId + CAS revision）；
6. 目标视图 `balanceCents=12_500`，窗口内 `reserve.netAdditionsCents=500`（取自完整窗口数据）；
7. 纯人工平台导入 `analyse=false`：3 行共用 1 个既有分类 → review `categoriesToCreate=0`/`categoriesToReuse=1`，confirm 复验原件 SHA-256 → `inserted=3`/`categoriesCreated=0`/`categoriesReused=1`；
8. 导入后工资仍只 1 笔、目标余额仍 `12_500`（各金额视图互不冒充、目标操作不改账本）。

全程 `fetchImpl` 强制抛错，任何模型调用都会使用例失败 → 证明零 AI 调用。

运行：`pnpm --filter @jizhang/server test core-finance-repair-integration.test.ts` → 1 文件 / 1 项通过，exit 0。

## 3. 各任务门禁对照（AUTOMATION）

| 任务 | 关键新增/修改 | 定向自动化证据 |
|---|---|---|
| T01 | `SalaryOperationReplay.kt`、`SalarySheet.kt` | `salary-operation-replay-regression.test.ts`(5)、Salary 相关 JVM 用例 |
| T02 | `ApiRequestIdentity/Owner/Transport`、`ApiClient` | `ApiTransportTest`、`NetworkContractTest` |
| T03 | `ManualGoalInput.kt` | `ManualGoalProgressStateTest` |
| T04 | `ManualGoalOperationReplay.kt`、`FinancialGoalRepository` | `ManualGoalOperationReplayTest`、`financial-goals.test.ts` |
| T05 | `financial-goals-service.ts`、`ManualGoalProgressReadState.kt` | `ManualGoalWindowStateTest`、`financial-goals.test.ts`、`monthly-plan.test.ts` |
| T06 | `ManualGoalEntryListState.kt` | `ManualGoalEntryListStateTest`(7) |
| T07 | `ledgerRefreshToken` 全链路 | `FinancialHostAndWorkOwnerTest`、`monthly-plan.test.ts` |
| T08 | `SalaryTemplateState.kt`、`formatFrozenFinancialWindow` | `SalaryTemplateStateTest`(3)、`FrozenFinancialWindowFormatTest`(4) |
| T09 | `PlatformImportState.kt`、`PlatformImportHost.kt` | `PlatformImportStateTest`、`AssistantBatchNetworkContractTest`、`import-batch-manual-flow.test.ts`(2) |
| T10 | `AssistantBatchRecoveryState/Store.kt`、`matchBatchOriginals` | `AssistantBatchRecoveryStateTest`、`import-batch-analysis.test.ts`(13)、`import-batch-regression.test.ts`(14) |
| T11 | `batchRowNeedsAttention`、review/confirm 去重分类实体 | `AssistantBatchImportStateTest`、`import-batch-confirm.test.ts`(32) |
| T12 | `NavigationLeaveGuard.kt` | `NavigationLeaveGuardTest`(2) |
| T13 | `zonedMonthStart` 回拨最早有效瞬间 | `stats-window.test.ts`(24)、`stats.test.ts` |
| T14 | 集成用例与文档 | `core-finance-repair-integration.test.ts`(1) |

## 4. 源码核对结论（SOURCE）

- R01 工资只提交真实载荷并隔离旧未决记录；模板失效不再造成默认模板静默失效。
- R02 所有已确认财务写入经唯一 `ledgerRefreshToken` 失效刷新；跳过/失败/取消/未知不发成功信号。
- R03/R14 四类手动目标写入与批次变更先持久化元数据再发送，未知结果一律保留原 key 核对，绝不静默换键重发。
- R04 请求归属按 `ApiRequestIdentity` 代次隔离，A→B→A 与晚到 401 不污染新会话。
- R05 外层底栏切换与系统返回统一经 `NavigationLeaveCoordinator`，脏草稿/未决导入状态可拒绝离开。
- R06–R07 冻结区间使用显式 IANA 时区格式化并标注终点排他。
- R08/R11 当前计划参考只取包含 now 的冻结方案，历史窗口不冒充当前预测。
- R09 手动历史游标分页有界且严格校验 revision/游标前进。
- R10 金额解析使用 BigDecimal 精确进位与 JS 安全整数边界。
- R12/R13 Data 与 Assistant 统一人工导入宿主，`analyse=false` 默认，owner 绑定财务范围+请求身份+来源。
- R15 原件匹配按服务端 `fileIndex` + SHA-256 一一对应，同数量不足以判定一致。
- R16–R18 异常优先核对、原备注可核对、分类计数统一为去重分类实体。
- R19 历史重复月初取最早有效瞬间。
- R20 本文档与 `repair-closure.md` 交付闭环矩阵。

## 5. 设备待验项（DEVICE PENDING，未执行）

以下均**未**在真机执行，保持未执行状态，不以源码或 JVM 结果代替：

- C1-01/02/03/04/07/08：底栏跳转、隐藏页触摸/无障碍、IME 折叠、返回来源。
- C2-09：工资/计划双击与断网弱网重放。
- C3-03/06：设备时区切换、快速切月与慢失败。
- C4-08：真机未知结果与升级后备份恢复。
- C5-01/03/06：SAF 选择器取消、超限错误提示、弱网未知结果。
- G01/G02/G03/G05：合成账本真机录像、页面截图、弱网与 401 切换。
- T12 系统 Back 硬件键、TalkBack、手势返回、SAF、IME。
- T10 丢响应/重启/重新绑定原件、真实 Provider。
- T11 长备注展开与全量列表核对。

未部署、未真机安装；APK 仅本地构建产物。
