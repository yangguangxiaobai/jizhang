# 修复闭环矩阵（R01–R20）

- 对应计划：`docs/superpowers/plans/2026-10-30-core-finance-simplification-repair.md`
- 复核日期：2026-11-01（Asia/Shanghai）
- 源码基线：`bde9a18da5ef33567f52fb544f181479cd4aedf3`
- 证据分级：**SOURCE** 源码核对；**AUTOMATION** 自动化门禁；**DEVICE** 真机（本轮全部未执行）
- 命令与计数详见同目录 `repair-checks.md`

状态含义：`CLOSED-AUTOMATION` = 源码 + 自动化证据闭环，设备项另列待验；`CLOSED-SOURCE` = 仅源码核对闭环（该条本身不含设备专属行为）；`PENDING-DEVICE` = 需真机证据才能判定。

| ID | 结论 | 源码证据 | 自动化证据 | 设备 |
|---|---|---|---|---|
| R01 工资载荷与旧未决 | CLOSED-AUTOMATION | `ui/SalaryOperationReplay.kt`（安全键判定、遗留未键记录隔离）、`ui/SalarySheet.kt`（手工确认对话框、`activeCategoryIds` 模板校验） | `salary-operation-replay-regression.test.ts`(5) | PENDING-DEVICE（旧未决升级弹窗） |
| R02 写入后摘要刷新 | CLOSED-AUTOMATION | `MainShell.kt`（`ledgerRefreshToken` 单源）、`MyTab.kt`、`MonthlyPlanWorkspace.kt`、`FinancialExecutionWorkspace.kt`、`StatsTab.kt`、`SalaryFinancialPrompt.kt` | `FinancialHostAndWorkOwnerTest`、`monthly-plan.test.ts` | PENDING-DEVICE（端到端交互） |
| R03 手动目标未知结果 | CLOSED-AUTOMATION | `ui/ManualGoalOperationReplay.kt`（PUT/POST/PATCH/DELETE 四类先存后发与恢复）、`repo/FinancialGoalRepository.kt`(`sendExact`/`operationResult`) | `ManualGoalOperationReplayTest`、`financial-goals.test.ts` | PENDING-DEVICE（弱网未知结果） |
| R04 网络会话归属 | CLOSED-AUTOMATION | `net/ApiRequestIdentity.kt`、`net/ApiRequestOwner.kt`、`net/ApiTransport.kt`、`net/ApiClient.kt` | `ApiTransportTest`、`NetworkContractTest` | PENDING-DEVICE（A→B→A/401 切换） |
| R05 外层离开与返回守卫 | CLOSED-AUTOMATION | `ui/NavigationLeaveGuard.kt`、`MainShell.kt`（selectTab/BackHandler 统一咨询）、`FinancialHostScreen.kt`（含 planGuard）、`MyTab.kt`、`DataTab.kt`、`AssistantTab.kt`、`PlatformImportHost.kt`、`AssistantBatchImportWorkspace.kt` | `NavigationLeaveGuardTest`(2)、`FinancialHostAndWorkOwnerTest` | PENDING-DEVICE（系统 Back/TalkBack/手势） |
| R06 默认模板静默失效 | CLOSED-AUTOMATION | `ui/SalaryTemplateState.kt`(`isUsableSalaryTemplate`)、`SalarySheet.kt`（失效阻断并提供修复入口） | `SalaryTemplateStateTest`(3) | PENDING-DEVICE |
| R07 冻结区间日期展示 | CLOSED-SOURCE | `ui/format.kt`(`formatFrozenFinancialWindow`，显式 IANA 时区 + 终点排他标注)、`SalaryFinancialPrompt.kt` | `FrozenFinancialWindowFormatTest`(4) | PENDING-DEVICE（跨时区显示） |
| R08 当前计划参考 | CLOSED-AUTOMATION | `services/financial-goals-service.ts`（`monthlyReserveReferenceCents` 只取含 now 的冻结方案，历史窗口置 null） | `financial-goals.test.ts`、`monthly-plan.test.ts` | — |
| R09 手动历史分页 | CLOSED-AUTOMATION | `ui/ManualGoalEntryListState.kt`(`appendManualGoalEntryPage` 有界校验)、`ManualGoalProgressWorkspace.kt` | `ManualGoalEntryListStateTest`(7) | PENDING-DEVICE（分页操作） |
| R10 手动金额精度 | CLOSED-AUTOMATION | `ui/ManualGoalInput.kt`(`parseManualGoalYuanCents`，BigDecimal + 安全整数 + 严格两位小数) | `ManualGoalProgressStateTest` | PENDING-DEVICE（IME 输入） |
| R11 同周期实际存投 | CLOSED-AUTOMATION | `ui/ManualGoalProgressReadState.kt`(`requireManualGoalWindow` 严格回显校验)、`MonthlyPlanWorkspace.kt`、`StatsTab.kt`（账户筛选免责声明、不混入账户总额） | `ManualGoalWindowStateTest`、`financial-goals.test.ts` | PENDING-DEVICE |
| R12 统一人工导入入口 | CLOSED-AUTOMATION | `ui/feature/imports/PlatformImportHost.kt`、`PlatformImportState.kt`（owner=财务范围+请求身份+来源/会话）、`DataTab.kt`、`AssistantTab.kt`（移除全局 `composerBatchFiles`） | `PlatformImportStateTest`、`import-batch-manual-flow.test.ts`(2) | PENDING-DEVICE（SAF 取消） |
| R13 附件会话归属 | CLOSED-AUTOMATION | `AssistantTab.kt`（A→B→A 代次守卫、晚响应拒绝）、`AssistantBatchNetworkContractTest` | `AssistantBatchNetworkContractTest` | PENDING-DEVICE（A/B 会话） |
| R14 导入未知结果恢复 | CLOSED-AUTOMATION | `ui/feature/assistant/AssistantBatchRecoveryState.kt`、`AssistantBatchRecoveryStore.kt`（仅存元数据，不存 bytes/reviewToken/聊天）、`AssistantBatchImportWorkspace.kt`（发送前持久化、UNKNOWN 保留原键、`onRegisterNavigation`/`hasUnresolvedMutation`） | `AssistantBatchRecoveryStateTest`、`import-batch-analysis.test.ts`(13)、`import-batch-regression.test.ts`(14) | PENDING-DEVICE（丢响应/重启重绑） |
| R15 原件哈希一一匹配 | CLOSED-AUTOMATION | `AssistantBatchRecoveryState.kt`(`matchBatchOriginals`：服务端 `fileIndex` 顺序 + SHA-256，每份原件仅占用一次，缺失/重复返回 null)、`AssistantBatchImportWorkspace.kt`（`filesMismatch` 改用内容判定，确认按严格顺序发送） | `AssistantBatchRecoveryStateTest`（同数量异哈希/缺失/重复占用）、`import-batch-confirm.test.ts` | — |
| R16 异常优先核对 | CLOSED-AUTOMATION | `ui/feature/assistant/AssistantImportState.kt`(`batchRowNeedsAttention`：事实冲突/疑似重复/规则异常/未分配或待批准分类；`filterBatchRows` 默认“待核对”且全部视图异常优先稳定排序)、`AssistantBatchImportWorkspace.kt`（空待核对提示“查看全部 N 条”） | `AssistantBatchImportStateTest` | PENDING-DEVICE（首屏异常查看） |
| R17 原备注差异 | CLOSED-AUTOMATION | `AssistantBatchImportWorkspace.kt`（“不同来源原备注”卡片，采用空备注写入 `noteOverrides` 并失效 review，不回退主备注） | `AssistantBatchImportStateTest`(`originalNoteAlternativesPreserveEmptyAndQuotedNotes`) | PENDING-DEVICE（长备注展开） |
| R18 分类实体计数 | CLOSED-AUTOMATION | `services/import-batch-service.ts`（`createdCategoryIds`/`usedCategoryIds` 集合；reused = used − created；review 侧 `categoriesToReuseMap` 按实体去重，含直接指派既有分类） | `import-batch-confirm.test.ts`(32，含 `categoryCountsUseDistinctEntitiesInReviewAndConfirm`)、`core-finance-repair-integration.test.ts` | — |
| R19 历史重复月初 | CLOSED-AUTOMATION | `packages/shared/src/stats-window.ts`(`zonedMonthStart` 有界候选搜索取回拨日最早有效瞬间) | `stats-window.test.ts`(24)、`stats.test.ts` | — |
| R20 验收与证据交付 | CLOSED-SOURCE | 本文档 + `evidence/repair-checks.md`；`clients/android/README.md` 目录/条目更新；`.trellis/tasks/10-29-core-finance-simplification/acceptance.md` 状态更新 | 全部门禁命令与计数见 `repair-checks.md` | — |

## 未闭环与限制

1. **DEVICE 项全部未执行**：无可用真机，所有触摸/IME/SAF/弱网/无障碍/系统返回证据均保持“未执行”，未以源码或 JVM 结果替代。
2. **未部署、未真机安装**：APK 仅为本地 `assembleDebug` 产物，无安装与运行证据。
3. **未提交**：保持工作区 359 项未提交改动原样，未执行 `git reset`/`git clean`/`git add -A`。
4. 父任务产品验收（46 条）在设备证据补齐前不得判定全部满足。
