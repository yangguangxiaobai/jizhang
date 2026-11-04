# Core Finance Simplification Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> 本项目同时遵守 `AGENTS.md`、`.trellis/workflow.md` 及实际修复任务的 implement/check 上下文。本轮用户要求交付规划，由其他模型实施；本文的复选框表示待修复工作，不表示已实施或已验收。默认按 T01 → T14 顺序执行，共享文件不得并发修改。

**Goal:** 修复 2026-10-30 审查确认的 R01–R20，使当前实现达到原 C1–C5 / G01–G06 合同，并留下可复查的自动化及设备证据。

**Architecture:** 保留 Kotlin/Compose、Fastify、SQLite 与 shared 计算库，在现有请求、重放、冻结窗口和批次工作区上修复接线及状态缺口。先保证真实工资载荷、会话归属和手动写入恢复，再连接同周期进度与摘要刷新，最后统一导入、补齐核对与离开守卫；金额及导入确认仍由服务端权威计算。

**Tech Stack:** Kotlin / Jetpack Compose / coroutines / OkHttp 4.12.0；TypeScript ESM / Fastify / better-sqlite3 / Vitest；Node.js ≥22.12、pnpm 10.12.2；Android Gradle / JUnit 4 / 现有 MockWebServer。

**Spec:** [原实施计划](2026-10-29-core-finance-simplification.md)、[原技术设计](../../../.trellis/tasks/10-29-core-finance-simplification/design.md)、[原验收矩阵](../../../.trellis/tasks/10-29-core-finance-simplification/acceptance.md)、[本次审查报告](../../../.trellis/tasks/10-30-core-finance-simplification-review/review.md)。实施者先读这四份文档，再读受影响的 `.trellis/spec/` 和 `clients/android/README.md`。

**日期与状态:** 2026-10-30；修复规划交接稿，T01–T14 均待实施。技术拆分与安全处理为本规划建议，需求及金额基线沿用原已批准设计。

**模型上下文:** [精简交接索引](../../../.trellis/tasks/10-30-core-finance-simplification-review/repair-handoff.md) 用于 Trellis 自动注入；本完整文档超过32 KiB注入上限，实施/检查模型须按任务读取 Global Constraints、Review Focus、当前任务整节和验证要求，不能依赖截断后的整文件上下文。

## Global Constraints

- 金额为整数分，绝对值不得超过 `9_007_199_254_740_991`；时间为 epoch 毫秒。输入只在边界精确转换，汇总与预测继续使用 shared / 服务端结果。
- 普通支出保持毛额，退款计收入；确认用途只减已归属退款；工资不另写普通收入；转账不算收支。
- 手动目标不修改工资、账单、账户、转账或旧测算，不自动迁移旧备用金，不随月份增长。投资只记录本金，成长预留仍可包含技能支出。
- 窗口采用 `[from,to)`；月计划遵守冻结窗口与时区，统计遵守服务端窗口。无周期、待核对、接口不支持和读取失败不能伪装为零或借用历史方案。
- 新工资请求必须携带与本地记录一致的 `operationId`。保留服务端无键兼容路径；旧无键或键不一致的未决记录禁止自动补键、自动重发或自动删除。
- 已发出的写操作取消、超时、5xx 或响应解析失败仍可能已提交；保留原请求和未知状态，先查询原 operation/batch，再按原载荷恢复。仅确定拒绝才能结束失败记录；恢复不能悄悄更新 revision 或生成新键。
- 新平台导入默认 `analyse=false`；AI 必须由用户显式操作并确认配置可用。保留 1–5 文件、5 MiB/文件、8 MiB/批次、500 行、100 行/页；批次路由 12 MiB 与全局 8 MiB 限额不变。
- 保留 `version`、`analysisRevision`、`viewRevision`、`reviewToken`、原件 SHA-256、分类明确批准、原子确认及旧单文件卡片/账单 CSV/转账 CSV/备份合同。
- 不新增 ORM、缓存、离线同步、通用工作流框架或财务数据迁移。新 helper 只承担对应请求、输入或界面状态责任，不大规模重构现有大文件。
- 开始修复前记录当前 HEAD 和工作区状态。审查起点为 `bde9a18da5ef33567f52fb544f181479cd4aedf3`，当时已有 329 项改动；当前未提交/未跟踪源码也是基线。不得 reset、clean、覆盖他人改动或仅从 HEAD 新开空白工作树丢掉这批实现。
- 每项 Android/UI/API 修复同步更新目录受影响稳定 ID、字段、入口、API、缺口和变更日志；仅推进实际复核章节日期，ID 不回收。设计稿不作实现证据。
- 本地测试、APK 构建、设备交互、真实 Provider 和生产部署分别记录。本文不包含生产操作；涉及 SAF、IME、触摸、Back、无障碍、弱网和进程重启的验收需要设备证据。

## Review Focus

| 高风险输入或时序 | 必须观察到的结果 | 所属任务及补充测试 |
|---|---|---|
| 升级后遇到旧无键工资未决记录，服务端可能已入账 | 保留待核对状态，POST 数为 0；人工核对结束本机记录不新增/撤销工资 | T01 `legacyUnkeyedPendingNeverAutoPosts` |
| A 请求延迟 401 或 Set-Cookie，已退出并登录 B；另测 A→B→A | B cookie、登录态和草稿不变；旧请求以取消/过期结束，不能触发当前会话退出 | T02 `lateResponseCannotExpireOrReplaceNewSession` |
| 目标新增备注含引号、换行和空字符串，提交成功但响应丢失后重启 | 原完整 JSON、operationId、revision 恢复；只产生一次记录，备注保持用户提交内容 | T04 `lostResponseRecoversExactQuotedNoteAfterRestart` |
| 分析/文件替换成功但响应丢失，刷新后文件数量相同而哈希已变 | 分析不重复调用模型；候选原件可恢复，旧 bytes 不能确认，重新核对令牌有效 | T10 `lostMutationResponseKeepsKeyAndCandidateFiles` |
| 子页面有草稿、原件或未知写入时点底栏、外层返回或系统 Back | 最内层先处理，取消离开保留数据；确认离开不伪装为撤销服务端写入 | T12 `outerNavigationConsultsActiveLeaveGuard`，设备返回用例 |

---

## 1. 文件责任与执行顺序

以下为一份交接规划中的四组修复，分别可独立检查：工资/网络安全、手动目标与财务接线、平台导入、窗口与最终证据。不重新实施已符合预期的 C1–C5 功能；只修复审查发现及其必要回归。

| 文件组 | 责任与修改边界 | 所属任务 |
|---|---|---|
| `ui/SalaryOperationReplay.kt`、`ui/SalarySheet.kt`、`ui/SalaryFinancialPrompt.kt` | 工资真实 JSON、旧请求隔离、模板修复、冻结日期；不改变工资账务域 | T01、T07、T08、T12 |
| `net/ApiClient.kt`、`repo/AuthRepository.kt`、`MainActivity.kt` | 认证代次、cookie 副作用及传输取消；所有 API 类型使用同一边界 | T02 |
| `repo/FinancialGoalRepository.kt`、`ui/ManualGoalProgressWorkspace.kt`；新增邻近的输入/重放/读取/分页 helper | 精确输入、四种写入恢复、同窗口读取、完整历史入口 | T03–T07、T12 |
| `financial-goals-service.ts`、`monthly-plan-service.ts` | 当前冻结计划参考；复用现有月计划选择及共享预测规则 | T05 |
| `ui/MainShell.kt`、`ui/MyTab.kt`、`ui/FinancialHostScreen.kt`、`ui/MonthlyPlanWorkspace.kt`、`ui/StatsTab.kt`、`ui/FinancialExecutionWorkspace.kt` | 统一失效通知、同周期实际进度、外层守卫；保留隐藏 composition 的不放置策略 | T05、T07、T09、T12 |
| `ui/AssistantTab.kt`、`ui/DataTab.kt`、`ui/feature/imports/PlatformImportHost.kt`；新增 `PlatformImportState.kt` | 新平台导入统一人工入口、附件与批次的会话归属 | T09、T12 |
| `ui/feature/assistant/AssistantBatchImportWorkspace.kt`、`AssistantImportState.kt`；新增 `AssistantBatchRecoveryState.kt` | 分析/替换恢复、原件匹配、异常筛选、原备注展示 | T09–T12 |
| `import-batch-service.ts` | review / confirm 的分类实体计数，不改财务行和去重规则 | T11 |
| `shared/src/stats-window.ts` | 历史重复月初的最早有效边界，保持单个半开区间 API | T13 |
| Android 目录、原计划状态、验收矩阵及新修复 evidence | 实施状态与证据闭环；旧审查证据保留 | 每项局部维护，T14 汇总 |

表内 `ui/`、`repo/`、`net/` 均位于 `clients/android/app/src/main/java/com/yansuu1/jizhang/`；后文 Files 使用完整路径。所有“新增”文件当前均尚未存在，不得假定其接口已实现。

| 任务 | 审查项 | 前置依赖 | 原验收 ID |
|---|---|---|---|
| T01 工资真实载荷与旧未决安全处理 | R01 P1 | 无 | C2-03、C2-09、G05 |
| T02 网络会话归属与取消 | R04 P2 | 无；顺序在 T01 后 | C3-06、G05 |
| T03 手动金额精度 | R10 P2 | 无 | C4-04 |
| T04 手动目标写入恢复 | R03 P2 | T02、T03 | C4-08、G05 |
| T05 当前预留来源及同周期实际进度 | R08、R11 P2 | T04 | C2-05、C4-01、C4-02、C4-03、C4-07、G01、G02 |
| T06 手动历史分页 | R09 P2 | T04、T05 | C4-05、G06 |
| T07 财务摘要失效刷新 | R02 P2 | T01、T04、T05 | C2-02、C2-04、C2-06、G01 |
| T08 工资模板修复与冻结时区 | R06、R07 P2 | T01；共享文件在 T07 后修改 | C2-08、C2-05 |
| T09 统一导入与附件会话归属 | R12、R13 P2 | T02；接线在 T07 后 | C5-01、C5-02、C5-04、C5-08、G05 |
| T10 导入未知结果恢复与原件匹配 | R14、R15 P2 | T09 | C5-06 |
| T11 核对展示与分类计数 | R16、R17 P2；R18 P3 | T09、T10 | C5-04、C5-05 |
| T12 外层离开守卫 | R05 P2 | T04、T07、T08、T09–T11 | C1-02、C2-07、C5-01、C5-04、C5-06、G05 |
| T13 历史月初边界 | R19 P3 | 无；默认仍按表顺序 | C3-03、G03 |
| T14 目录及全链路证据 | R20 P3 | T01–T13 | G01–G06；全部 46 条验收证据复核 |

每项结束时先检查限定文件 diff、运行对应门禁、更新局部目录及证据，再交给下一项。若使用多模型，交接 Interfaces 和未决状态；MainShell、SalarySheet、MonthlyPlanWorkspace、AssistantTab、AssistantBatchImportWorkspace 同时只允许一个实施者修改。

## 2. 修复任务

### T01：工资真实载荷与旧未决安全处理

**Files:**
- 修改：`clients/android/app/src/main/java/com/yansuu1/jizhang/ui/SalaryOperationReplay.kt`。
- 修改：`clients/android/app/src/main/java/com/yansuu1/jizhang/ui/SalarySheet.kt`。
- 修改：`clients/android/app/src/test/java/com/yansuu1/jizhang/ui/SalaryOperationReplayTest.kt`。
- 新增测试：`clients/android/app/src/test/java/com/yansuu1/jizhang/net/SalaryCreateNetworkContractTest.kt`。
- 新增测试：`packages/server/test/salary-operation-replay-regression.test.ts`；服务端 `salary-service.ts` 无键兼容行为保留。
- 目录：`clients/android/README.md` 的 S01.12、S01.10。

**Interfaces:**
- 保留 `SalaryCreateRequest.build(input: Map<String, Any?>, operationId: String): SalaryCreateRequest`；产出的 `payloadJson` 必须包含相同的键，并覆盖 input 中冲突的 operationId。
- 新增 `internal fun isSafelyKeyedSalaryOperation(operation: PendingFinancialOperation): Boolean`；仅 POST `/api/v1/salaries`、合法 JSON 且 JSON.operationId 等于本地 operationId 时为 true。
- 保留 `SalaryReplayCoordinator.create/retry/recover` 与 gateway 接口；`SalaryRecoveryReport` 增加 `legacyUnkeyed: List<PendingFinancialOperation> = emptyList()`，同时保留这些记录在 `unresolved`，供表单显示核对入口。

- [ ] **Step 1：加入真实载荷和旧请求失败用例。** `buildIncludesOperationIdInActualJson` 使用生产 build：

  ```kotlin
  val request = SalaryCreateRequest.build(mapOf("amountCents" to 1000000L), "salary-op-01")
  assertEquals("salary-op-01", JSONObject(request.payloadJson).getString("operationId"))
  ```

  `legacyUnkeyedPendingNeverAutoPosts` 覆盖无键、键不一致、损坏 JSON 的历史 pending；直接 retry 和重启 recover 后均断言 `sendCount == 0`、pending 未删。新键请求响应丢失、同键重试及已提交查询断言只新增一笔工资，账户增加 `1000000` 分、普通工资收入 transactions 为 0。
- [ ] **Step 2：运行失败测试。** Android 运行 `./gradlew.bat --no-daemon --offline :app:testDebugUnitTest --tests '*SalaryOperationReplayTest' --tests '*SalaryCreateNetworkContractTest'`；当前 JSON 缺键应失败，当前旧无键 404 恢复会发送也应失败。
- [ ] **Step 3：补实际 JSON 键及重放安全检查。** build 写键；create 验证新请求；retry/recover 在任何 POST 前检查键一致性。支持幂等的新记录按原键先查询、必要时原载荷恢复；旧无键查不到本地 key 不能证明工资未入账，绝不补键重发。旧测试中模拟“安全请求”的 fixture 要补 JSON 键，另外保留真正的 legacy fixture。
- [ ] **Step 4：给旧记录提供明确核对处理。** SalarySheet 显示“旧工资请求结果待核对”，提供查看工资历史和显式结束本机未决记录的确认；说明该动作不新增/撤销工资。结束前保留草稿和记录，不能按金额/日期自动认定匹配或自动生成替代工资。
- [ ] **Step 5：验证 HTTP 与服务端行为。** MockWebServer 读取生产载荷的实际请求 body，断言 CSRF、JSON.operationId 和两次重试 body 一致；不只检查 FakeGateway 的 operation 对象。运行 `pnpm --filter @jizhang/server test salary-operation-replay-regression.test.ts --maxWorkers=2`；带同键两次 POST 只新增 1 行，无键旧接口两次新增 2 行的兼容断言仍保留。工资保存失败不尝试计划确认；计划失败不再建工资。
- [ ] **Step 6：完成本项检查。** 更新局部目录及修复证据，检查仅本项文件，记录“本地通过/重启与弱网设备待验”或设备证据后再勾相应验收；若提交，只提交本项明确路径，禁止 `git add -A`。

**完成标准：** 新工资真实 HTTP 带键且同请求至多一次；旧无键未决记录零自动 POST，安全核对路径可用，后台旧接口不被删除。

### T02：网络会话归属与取消

**Files:**
- 修改：`clients/android/app/src/main/java/com/yansuu1/jizhang/net/ApiClient.kt`。
- 修改：`clients/android/app/src/main/java/com/yansuu1/jizhang/repo/AuthRepository.kt`。
- 修改：`clients/android/app/src/main/java/com/yansuu1/jizhang/MainActivity.kt`。
- 新增：`clients/android/app/src/main/java/com/yansuu1/jizhang/net/ApiRequestOwner.kt`。
- 新增：`clients/android/app/src/main/java/com/yansuu1/jizhang/net/ApiTransport.kt`。
- 新增测试：`clients/android/app/src/test/java/com/yansuu1/jizhang/net/ApiTransportTest.kt`。
- 复用测试：`clients/android/app/src/test/java/com/yansuu1/jizhang/net/NetworkContractTest.kt`。
- 目录：`clients/android/README.md` 的认证/网络 API 与已知限制章节。

**Interfaces:**
- 新增 `internal data class ApiRequestIdentity(val baseUrl: String, val generation: Long)`，不含 cookie 或密码。
- `ApiClient` 新增 `internal suspend fun captureRequestIdentity(): ApiRequestIdentity`、`internal fun isCurrent(identity: ApiRequestIdentity): Boolean`，供后续工作区捕获请求归属，不让公开接口暴露 internal 类型。
- 新增 `internal class ApiRequestOwner(initialBaseUrl: String)`，提供 capture(): ApiRequestIdentity、advance(baseUrl: String): ApiRequestIdentity、isCurrent(identity: ApiRequestIdentity): Boolean、ifCurrent(identity: ApiRequestIdentity, action: () -> Unit): Boolean；在同一锁内管理 identity 和认证副作用。退出、换服务、开始新登录代次都会递增 generation，A→B→A 不能回到旧代次。
- 新增不依赖 Android Context 的 `internal class ApiTransport(http: okhttp3.OkHttpClient, owner: ApiRequestOwner, cookieJar: JizhangCookieJar, onCurrentSessionExpired: () -> Unit)`，提供 `suspend fun <T> execute(identity: ApiRequestIdentity, request: okhttp3.Request, read: (okhttp3.Response) -> T): T`；JSON、raw bytes、下载及 SSE 使用同一归属检查。SSE 继续保留现有流解析器与取消机制。

- [ ] **Step 1：加入生产传输时序用例。** `lateResponseCannotExpireOrReplaceNewSession`：A 请求发出后推进代次并保存 B cookie，释放 A 的 401 / Set-Cookie 响应；断言 B cookie 未变、`sessionExpired == false`、B 请求成功。另测 A→B→A、当前代次 401 正常退出、login 401 只显示登录失败。`cancelledJsonAndDownloadCloseTransport`：服务器阻塞 body，取消 coroutine 后限定时间内 `Call.isCanceled == true`，响应/socket 关闭，无成功回调。
- [ ] **Step 2：运行失败测试。** `./gradlew.bat --no-daemon --offline :app:testDebugUnitTest --tests '*ApiTransportTest' --tests '*NetworkContractTest'`；当前不带归属的 401/同步 execute 应不能满足上述断言。测试使用现有 MockWebServer 和 latch，不靠长 sleep 或真实服务。
- [ ] **Step 3：实现 identity 与 cookie/401 守卫。** 在 dispatch 前捕获并绑定服务地址及 generation；cookie 读取、Set-Cookie 持久化、清 cookie 和 sessionExpired 都只能作用于当前 identity。采用绑定 identity 的 cookie adapter/生产 transport，不在 UI 回调里补救已发生的清会话副作用。过期响应以 `CancellationException` 结束，不向当前页面抛可导致退出的 AuthExpiredException；保留当前会话 401 语义。
- [ ] **Step 4：使普通调用真正可取消。** 将 private 同步 call 改为 suspend，通过 cancellable OkHttp 边界取消底层 Call 并关闭 Response；下载同样处理。API verb 的公开 suspend 签名、CSRF、bodiless POST 无 Content-Type、raw bytes、超时、错误映射及 SSE 禁重定向不变。移除 SSE 分支无条件 clearSession 的重复路径。
- [ ] **Step 5：接线认证代次及回调。** AuthRepository / MainActivity 的 refresh、login、logout 结果及 finally 必须属于启动时 identity；过期 logout 的 finally 不能清 B 会话。CancellationException 继续抛出，不能吞成普通登录/读取错误。所有新旧传输路径实际使用 ApiTransport，MockWebServer 测试也调用这一生产边界。
- [ ] **Step 6：复跑本项测试及门禁。** 运行 Step 2 和 Android lint/build；核对 persisted cookie 重启、401、raw 上传、下载、SSE 的原回归未失效。记录 A→B 弱网设备操作证据或明确待验，更新目录。

**完成标准：** 旧请求没有新会话副作用，页面取消可以停止底层网络；已可能提交的写请求由其 pending 状态恢复，取消不能被解释为确定未写入。

### T03：手动金额精度

**Files:**
- 新增：`clients/android/app/src/main/java/com/yansuu1/jizhang/ui/ManualGoalInput.kt`。
- 修改：`clients/android/app/src/main/java/com/yansuu1/jizhang/ui/ManualGoalProgressWorkspace.kt`。
- 修改：`clients/android/app/src/test/java/com/yansuu1/jizhang/ui/ManualGoalProgressStateTest.kt`。
- 目录：`clients/android/README.md` 的 B03.13 输入校验。

**Interfaces:**
- 新增唯一生产解析器 `internal fun parseManualGoalYuanCents(text: String, allowZero: Boolean): Long`；起始值调用 allowZero=true，新增/编辑存取调用 false。
- 普通十进制输入经 trim 后最多两位小数；使用 BigDecimal 精确乘 100、精确转 Long 及 JS 安全整数校验，禁止 Double / Math.round。负号、指数、非数字、NaN、Infinity、超精度与超安全范围抛 IllegalArgumentException。

- [ ] **Step 1：改为测试真实生产函数。** 删除测试内私有 parseYuan 克隆，加入下列断言及边界：

  ```kotlin
  assertEquals(12345L, parseManualGoalYuanCents("123.45", false))
  assertEquals(0L, parseManualGoalYuanCents("0", true))
  assertEquals(9007199254740991L, parseManualGoalYuanCents("90071992547409.91", false))
  assertThrows(IllegalArgumentException::class.java) { parseManualGoalYuanCents("1.234", false) }
  assertThrows(IllegalArgumentException::class.java) { parseManualGoalYuanCents("90071992547409.92", false) }
  ```

  补 `0` 不允许作存取、负数、`NaN`、`Infinity`、`1e2`、空白；合法 `1`、`0.5`、前后空白。生产对第三位小数一律拒绝，包括 `1.230`，不静默舍入。
- [ ] **Step 2：运行失败测试。** `./gradlew.bat --no-daemon --offline :app:testDebugUnitTest --tests '*ManualGoalProgressStateTest'`；当前实现对 `1.234` 静默取整，应不能通过。
- [ ] **Step 3：实现并接通解析器。** 起始、新增、编辑三处都调用同一函数；字段错误留在表单且不创建 pending 或发 HTTP。删除 Workspace 中旧 private Double 解析器。
- [ ] **Step 4：验证及维护目录。** 复跑 Step 2，检查所有调用者确实使用新函数，记录非分精度/安全范围拒绝证据并更新 B03.13。服务端整数分及原子历史校验继续保留，不扩大到其他工资/账单解析器重构。

**完成标准：** 用户输入的金额不会静默改变，真实起始/新增/编辑路径都执行被测试的生产函数。

### T04：手动目标四种写入的未知结果恢复

**Files:**
- 新增：`clients/android/app/src/main/java/com/yansuu1/jizhang/ui/ManualGoalOperationReplay.kt`。
- 修改：`clients/android/app/src/main/java/com/yansuu1/jizhang/repo/FinancialGoalRepository.kt`。
- 修改：`clients/android/app/src/main/java/com/yansuu1/jizhang/ui/ManualGoalProgressWorkspace.kt`。
- 新增测试：`clients/android/app/src/test/java/com/yansuu1/jizhang/ui/ManualGoalOperationReplayTest.kt`。
- 修改测试：`packages/server/test/financial-goals.test.ts`。
- 读取复用：`clients/android/app/src/main/java/com/yansuu1/jizhang/ui/FinancialPrefs.kt` 的 OperationReplayStore / PendingFinancialOperation，及 `repo/FinancialExecutionModels.kt` 的 FinancialOperationResult。
- 目录：`clients/android/README.md` 的 B03.13。

**Interfaces:**
- 新增 `internal fun buildManualGoalOperation(method: String, path: String, body: JSONObject, operationId: String, expectedRevision: Long): PendingFinancialOperation`；完整 JSON 包含键与原 revision，备注通过 JSONObject 编码。
- Repository 新增 `suspend fun sendExact(operation: PendingFinancialOperation): FinancialGoalView`、`suspend fun operationResult(operationId: String): FinancialOperationResult`。保留原 `operation(): JSONObject`；typed wrapper 解码 `operation` 对象（或根对象），验证键、method、resource，再读取 `response`。
- 新增 `ManualGoalMutationGateway` 的 `sendExact` / `lookup`，后者返回 FinancialOperationResult；新增窄存储接口 `ManualGoalPendingOperationStore` 的 record/remove/list，签名与 SalaryPendingOperationStore 相同，生产适配现有 store。
- 新增 `ManualGoalReplayCoordinator(gateway: ManualGoalMutationGateway, store: ManualGoalPendingOperationStore, scopeProvider: suspend () -> FinancialScope)`；其 `submit(operation: PendingFinancialOperation)`、`retry(operation: PendingFinancialOperation)` 返回 `ManualGoalMutationOutcome`（Success(view: FinancialGoalView)、DefinitiveFailure(message: String)、Unknown(message: String)）；`recover(): ManualGoalRecoveryReport` 返回 recovered: List<FinancialGoalView> / failures: List<String> / unresolved: List<PendingFinancialOperation>。
- Workspace 新增 `onDataChanged: () -> Unit = {}`，仅确认提交或恢复成功后调用；T07 负责接到外层失效通知。

- [ ] **Step 1：加入四种操作恢复用例。** PUT opening / POST entry / PATCH entry / DELETE entry 参数化覆盖：先持久化再发送、成功清 pending、存储失败零发送、响应丢失保留 pending、查到结果零重发、已确认支持合同的同作用域 404 才同键原载荷重发、确定 400/409 结束失败记录、查询断网仍保留未知。`lostResponseRecoversExactQuotedNoteAfterRestart` 使用含引号、换行和空字符串的 note，断言恢复 JSON.note 等于首次提交值、operationId 与 expectedRevision 均未变。
- [ ] **Step 2：运行失败测试。** `./gradlew.bat --no-daemon --offline :app:testDebugUnitTest --tests '*ManualGoalOperationReplayTest'`；当前没有恢复协调器，四种保存失败后只能重新生成 UUID 的行为应被拒绝。
- [ ] **Step 3：实现完整载荷及恢复协调器。** 只允许财务目标的四种 method/resource；retry 不接受修改后的金额、备注或 revision。提交前后使用 T02 的 identity 检查归属；通过当前作用域 `FinancialGoalView.contractVersion=1/source=manual-confirmed` 确认该重放合同，能力不明/接口不支持不能把404当可重发。recover 只扫描当前 server/user 的 financial-goals pending，不混入工资/旧测算。查询已提交结果先核对 operation 身份，按 response 恢复，再服务端重读视图/列表；本机清理失败不能把已提交业务改报为保存失败。
- [ ] **Step 4：处理已有目标 pending 的兼容。** 旧目标 API 首次请求本就携带 key/revision，与旧无键工资不同：先按原 key 查询；若合法 JSON 仅把 key/revision 分存于 pending 元数据，可用原元数据重建当时的完整载荷并保存，再按同请求恢复。旧 note 导致 JSON 损坏、原 revision 缺失或身份无法证明时只保留待核对，不能猜备注、取最新 revision 或新建替代记录。
- [ ] **Step 5：接线 Workspace。** 四个表单使用同一协调器；初始化及用户点击“核对未决结果”调用 recover，未知时阻止该草稿产生第二个 key。显示已确认、确定失败、结果未知三个状态；恢复按钮查询原 key。CancellationException/AuthExpiredException 分别处理，取消/离开后保留可能已发送的 pending。任何响应、错误、finally 或 onDataChanged 都要验证当前 identity/owner；作用域变化不清另一账户记录。
- [ ] **Step 6：验证整集不重复与原子性。** 运行 Step 2 及 `pnpm --filter @jizhang/server test financial-goals.test.ts --maxWorkers=2`。新增含特殊 note 的 API 同键重放，断言一条 entry、一份 accepted operation、同键不同载荷 409；非法更正/删除导致后续透支时业务行、revision、operation 均不部分变更；账户/工资/交易整集不变。
- [ ] **Step 7：记录恢复证据及目录。** 设备断网/重启恢复另验；本地 FakeStore/Gateway 必须执行生产协调器，不在测试中重写状态机。更新 B03.13 的实际入口和已知限制。

**完成标准：** 四种目标写入均可按原请求恢复，特殊备注不损坏 pending，未知结果不会通过新 UUID 重录。

### T05：当前计划参考与同周期实际存投

**Files:**
- 修改：`packages/server/src/services/financial-goals-service.ts`。
- 复用：`packages/server/src/services/monthly-plan-service.ts` 的当前冻结周期选择；仅在需要共用时抽取该选择，不改变公开 API。
- 修改测试：`packages/server/test/financial-goals.test.ts`、`packages/server/test/monthly-plan.test.ts`。
- 新增：`clients/android/app/src/main/java/com/yansuu1/jizhang/ui/ManualGoalProgressReadState.kt`。
- 修改：`clients/android/app/src/main/java/com/yansuu1/jizhang/ui/ManualGoalProgressWorkspace.kt`、`clients/android/app/src/main/java/com/yansuu1/jizhang/ui/MonthlyPlanWorkspace.kt`、`clients/android/app/src/main/java/com/yansuu1/jizhang/ui/StatsTab.kt`。
- 新增测试：`clients/android/app/src/test/java/com/yansuu1/jizhang/ui/ManualGoalWindowStateTest.kt`。
- 目录：`clients/android/README.md` 的 B03.12、B03.13、B02.12 与目标 API 覆盖。

**Interfaces:**
- 后端改为 `private monthlyReserveReferenceCents(calculatedAt: number): number | null`：以本次捕获的 now 调用现有 `MonthlyPlanService.getMonthlyPlan()`，仅 ready 当前冻结方案的安全整数 `targetsCents.reserve` 可作为参考；`unresolved.reasons` 包含 `salary-source-changed` / `no-confirmed-salary-source` 时不可用。普通支出待分类不自动否定已有效冻结的预留，消费剩余仍保持待核对。删除按 created_at 取任意最新修订的查询。
- `assembleView` 本次只捕获一个 calculatedAt；参考不可用/冲突/损坏时返回 null，实际手动余额仍按原 shared 规则计算。普通数据读取异常仍正常报错，不能全部 catch 后当“无参考”。
- 新增 `data class ManualGoalWindowContext(val from: Long, val to: Long, val label: String, val timeZone: String)` 及 `internal fun requireManualGoalWindow(view: FinancialGoalView, expected: ManualGoalWindowContext): FinancialGoalWindowView`，严格校验服务端回显范围和 source；context 用于公开 Composable 参数，不能声明为 internal 后让公开函数暴露它。
- Workspace 新增 `window: ManualGoalWindowContext? = null`。周期读取调用原 `FinancialGoalRepository.load(from: Long?, to: Long?)`；Android MonthlyPlanWindow.from/to 和 StatsWindow.from/to 原样传入（工资预览 FinancialWindow 使用 start/end，不能混用字段名）。
- `FinancialGoalWindowView.reserve/investment.netAdditionsCents` 是期间实际值；累计余额继续使用 progress.balanceCents / asOf。选定历史/统计窗口不展示“当前预测”；当前预测在无 window 的目标主视图展示，不用历史余额冒充当前值。

- [ ] **Step 1：加入参考来源失败用例。** `historicalRevisionIsNotCurrentReserveReference`：固定 now 为 `2026-10-29T04:00:00Z`，仅确认九月周期，十月 monthly-plan 为 no-period；目标 API 的 monthlyReferenceCents 和未达标 conditionalContributionCount 必须为 null。补当前方案存在、历史修订创建时间更新更晚、disabled、来源不可用、参考 0、目标基准缺失及周期上界排他用例。
- [ ] **Step 2：加入期间读取和显示合同用例。** `periodManualProgressUsesExactServerWindow` 在 from、to−1、to 插入记录，断言 to 排除；应急起始 `1200000`、存 `150000`、取 `100000` 得余额 `1250000`、本期净存 `50000`；投资起始 `500000`、投 `250000`、取回 `100000` 得本金 `650000`、净投 `150000`。测试生产 requireManualGoalWindow 的错范围拒绝，不把不同 query 的旧数据当本期数据。
- [ ] **Step 3：运行失败测试。** `pnpm --filter @jizhang/server test financial-goals.test.ts monthly-plan.test.ts --maxWorkers=2`；当前只存在旧方案仍返回参考/9次，应失败。Android 运行 `./gradlew.bat --no-daemon --offline :app:testDebugUnitTest --tests '*ManualGoalWindowStateTest' --tests '*FinancialGoalModelsTest'`。
- [ ] **Step 4：修正预测来源及历史标签。** 当前目标主视图仅使用可用当前冻结计划；当前 reserve `1200000`、必要基准 `500000`、5 月、参考 `150000` 时目标 `2500000`、48%、缺 `1300000`、9次；无参考时实际余额仍有效，未达标 ETA=null。带 window 的期间视图保留 asOf 余额与实际净存投，参考及未达标 ETA 置 null，已达标 count=0 仍按 shared 规则；不把历史窗口叫当前预测。
- [ ] **Step 5：接通月计划的实际进度。** 计划 ready 时用其冻结窗口再读目标，展示“本期手动净存入”和“本期本金净投入”，分别与 reserve/growth 预留并列。进入目标详情带同一窗口，保留返回来源。无周期不给伪造范围；目标未设置/接口不支持/读取失败各显示真实状态，不能显示假 0。
- [ ] **Step 6：接通统计复盘。** 统计窗口确定后单独读取该 from/to 的目标 window 值；保留排行、毛收支与用途执行各自范围标签。目标记录没有 accountId 关联：账户筛选下明确显示“手动存投（全部目标，未按账户筛选）”，不把它混入账户总额或推导净储蓄率。快速切月/近30天/账户、关闭页面后旧结果、错误、finally 均由 owner/identity 拒绝；同 query 失败可保留标为过期的数据。
- [ ] **Step 7：复跑并记录页面证据。** 运行 Step 3；验证技能支出 `50000` 分不增加投资本金，投资 `200000` 分不称成长 `250000` 分已执行100%。更新局部目录，记录冻结计划与本期实际值并列的页面截图；无设备则标明接线源码/自动化通过、设备待验。

**完成标准：** 不借用旧方案预测；月计划、统计和目标详情能够读取同一服务端窗口的实际净存投，预测/本金/成长参考不混用。

### T06：手动历史有界分页与全历史操作

**Files:**
- 新增：`clients/android/app/src/main/java/com/yansuu1/jizhang/ui/ManualGoalEntryListState.kt`。
- 修改：`clients/android/app/src/main/java/com/yansuu1/jizhang/ui/ManualGoalProgressWorkspace.kt`。
- 新增测试：`clients/android/app/src/test/java/com/yansuu1/jizhang/ui/ManualGoalEntryListStateTest.kt`。
- 复用/补回归：`packages/server/test/financial-goals.test.ts` 的 cursor、软删除和历史非负校验。
- 目录：`clients/android/README.md` 的 B03.13。

**Interfaces:**
- 继续使用 `FinancialGoalRepository.listEntries(goal, from, to, limit, cursor, includeDeleted): FinancialGoalEntryPageView`，limit=100，不改变服务端默认50/最大100合同。
- 新增 `ManualGoalEntryQuery(goal: ManualGoal?, window: ManualGoalWindowContext?, includeDeleted: Boolean)`；`ManualGoalEntryListState` 保存 query、items: List<FinancialGoalEntryDto>、total: Int?、revision: Long?、hasMore: Boolean、nextCursor: String?、loading: Boolean、error: String?、restartRequired: Boolean。`internal fun appendManualGoalEntryPage(state: ManualGoalEntryListState, page: FinancialGoalEntryPageView): ManualGoalEntryListState` 只拼接同 revision 的有效下一页；查询归属由外层 owner 检查。错误保持原列表并明确不完整，revision 变化置 restartRequired，外层有限重读首屏，不丢编辑草稿。
- window 详情提供“本期明细/全部历史”；无 window 默认全部历史。编辑/删除仍交给 T04，写入确认后失效旧 cursor 并重新读取，不使用部分列表计算目标总额。

- [ ] **Step 1：加入超过100条用例。** `all235EntriesRemainReachableAndEditable` 使用 100/100/35 三页，断言最终 235 个唯一 ID、total=235、hasMore=false、nextCursor=null，最早一页的记录仍可进入编辑/删除。补下一页失败保留100条且可重试、快速切查询丢弃旧页、revision 变化重新加载首屏、重复 ID / 不前进 cursor / 空页但 hasMore=true 拒绝。
- [ ] **Step 2：运行失败测试。** `./gradlew.bat --no-daemon --offline :app:testDebugUnitTest --tests '*ManualGoalEntryListStateTest'`；当前 UI 只取 `.items` 丢掉后续页，不能满足全历史操作。
- [ ] **Step 3：实现生产分页状态与按钮。** 不丢弃 page 元数据；显示“已加载 N / 共 total 条”和“加载更多”、独立加载/错误状态。查询由目标/窗口/includeDeleted/identity 组成，响应需同 owner；多页 revision 改变禁止拼接混合快照。原明细草稿不因分页刷新被清空。
- [ ] **Step 4：接通合法更正/删除与软删除历史。** 最早记录使用真实 ID 和当前全局 revision；非法删旧存入造成后来透支仍整笔拒绝。软删除事实通过历史显示/原 API 保留，不复用其 ID 或把被删除记录计入实际余额。
- [ ] **Step 5：验证及维护。** 复跑 Step 2 和 `pnpm --filter @jizhang/server test financial-goals.test.ts --maxWorkers=2`；设备查看后续页、进入最早记录及返回列表另留证。目录写明分页、加载失败与历史范围，不把已加载数当全历史数。

**完成标准：** 100条之后的合法记录能被查看和操作，分页失败/版本变化不会制造“完整历史”或错误合计。

### T07：所有财务写入后的摘要失效刷新

**Files:**
- 修改：`clients/android/app/src/main/java/com/yansuu1/jizhang/ui/MainShell.kt`、`clients/android/app/src/main/java/com/yansuu1/jizhang/ui/MyTab.kt`。
- 修改：`clients/android/app/src/main/java/com/yansuu1/jizhang/ui/FinancialHostScreen.kt`、`clients/android/app/src/main/java/com/yansuu1/jizhang/ui/MonthlyPlanWorkspace.kt`。
- 修改：`clients/android/app/src/main/java/com/yansuu1/jizhang/ui/FinancialExecutionWorkspace.kt`、`clients/android/app/src/main/java/com/yansuu1/jizhang/ui/ManualGoalProgressWorkspace.kt`。
- 修改：`clients/android/app/src/main/java/com/yansuu1/jizhang/ui/SalarySheet.kt`、`clients/android/app/src/main/java/com/yansuu1/jizhang/ui/SalaryFinancialPrompt.kt`、`clients/android/app/src/main/java/com/yansuu1/jizhang/ui/StatsTab.kt`。
- 复用测试：`packages/server/test/monthly-plan.test.ts`、`clients/android/app/src/test/java/com/yansuu1/jizhang/ui/FinancialHostAndWorkOwnerTest.kt`。
- 目录：`clients/android/README.md` 的 B03.08–B03.13、S01.08/S01.12、B02.12。

**Interfaces:**
- 使用 MainShell 已有 `ledgerRefreshToken: Long` 作为当前会话财务数据失效代次，不再增加平行的全局缓存/事件总线。
- FinancialHostScreen / MonthlyPlanWorkspace / MyTab 增加 `refreshToken: Long = 0L` 与 `onDataChanged: () -> Unit = {}`；StatsTab 增加同名 refreshToken。MainShell 把同一个计数器和递增回调传给各入口。
- FinancialExecutionWorkspace 增加 `onDataChanged: () -> Unit = {}`；ManualGoalProgressWorkspace 使用 T04 同名回调。子操作已确认成功及已提交恢复成功后通知，读取、取消、确定失败、未知结果不通知为“已成功”。
- SalarySheet 保留原 onSaved；SalaryFinancialPrompt 新增 `onPlanConfirmed: () -> Unit = {}`，与 onFinished 分开：跳过不通知计划变更，确认成功才通知。

- [ ] **Step 1：建立实际接线失败用例。** `monthlyPlanReflectsExpenseSavedThroughMainShell`：计划消费预算 `600000` 分，从计划页中央＋分别保存必要 `320000`、随心 `60000` 分；保存回来源后，无需点重试就显示消费 `380000`、剩余 `220000`，两项剩 `180000` / `40000`。`executionToolWriteInvalidatesRetainedSummary`：工具内纳入工资、配置/用途映射、退款分摊和目标存投成功后返回摘要，值立即重新读取。
- [ ] **Step 2：记录当前失败与自动化基线。** 实际设备/现有 UI 操作记录应显示当前摘要未刷新；同时运行 `pnpm --filter @jizhang/server test monthly-plan.test.ts --maxWorkers=2` 及 `./gradlew.bat --no-daemon --offline :app:testDebugUnitTest --tests '*FinancialHostAndWorkOwnerTest'`，分开证明服务端金额与客户端接线。不新增只检查源码字符串或重写计数器的测试；没有设备时，操作用例保持待验。
- [ ] **Step 3：接通外层 token。** MainShell 的支出/编辑/删除/工资/导入成功递增同一 token，并传入计划主入口及 MyTab 二级财务入口。MonthlyPlanWorkspace 的读取 effect 纳入 refreshToken；Stats 的同范围实际进度随之失效。新 identity/query 换代不能先展示旧会话的摘要。
- [ ] **Step 4：接通工具与恢复回调。** 所有影响当前计划事实的子弹窗 onSaved 先保持原局部刷新，再调用 onDataChanged；目标恢复使用 T04，工资纳入使用 onPlanConfirmed。服务端成功而本地重读失败，显示“操作已确认，数据待刷新”，不能重复提交写入。回调也要由当前 owner 校验，旧作用域成功不刷新/覆盖新会话。
- [ ] **Step 5：验证过期状态和父子路径。** 支出100/退款30的独立 fixture 仍为普通支出 `10000`、退款收入 `3000`、用途净消费 `7000`；待核对时 remainingCents=null，读取失败旧数据明确标为过期。按两个入口、所有保存回调复核实际参数接线，复跑 Step 2 和 Android lint/build，记录设备用例结果并同步目录。

**完成标准：** 每个已确认的相关写入会使当前月计划/复盘失效；主入口和二级入口行为一致，恢复成功与读取失败也有准确状态。

### T08：默认工资模板失效修复与冻结日期展示

**Files:**
- 新增：`clients/android/app/src/main/java/com/yansuu1/jizhang/ui/SalaryTemplateState.kt`。
- 修改：`clients/android/app/src/main/java/com/yansuu1/jizhang/ui/SalarySheet.kt`。
- 修改：`clients/android/app/src/main/java/com/yansuu1/jizhang/ui/SalaryFinancialPrompt.kt`、`clients/android/app/src/main/java/com/yansuu1/jizhang/ui/format.kt`。
- 新增测试：`clients/android/app/src/test/java/com/yansuu1/jizhang/ui/SalaryTemplateStateTest.kt`、`clients/android/app/src/test/java/com/yansuu1/jizhang/ui/FrozenFinancialWindowFormatTest.kt`。
- 补测试：`packages/server/test/salary-operation-replay-regression.test.ts`（T01 已新增）。
- 目录：`clients/android/README.md` 的 S01.02、S01.12 与 B03.12 冻结区间说明。

**Interfaces:**
- 将旧 private 判断替换为 `internal fun JSONObject.isUsableSalaryTemplate(activeCategoryIds: Set<String>): Boolean`；原 id/modules 非空条件之外，每个模块引用的分类必须仍可用，不能只验证模板 ID。
- 新增 `internal fun formatFrozenFinancialWindow(start: Long, end: Long, timeZone: String): String`；用显式 IANA 时区，输出日期、时区及“（不含终点）”，不改普通交易的 formatDay 语义。

- [ ] **Step 1：加入失效模板与时区失败用例。** `deletedDefaultCategoryRequiresRepair`：默认模板包含已删分类，生产可用性判 false，保存前进入修复且工资/计划写入数0。补模板载入后分类被删除、保存收到确定拒绝、重新读取后修复状态保留原草稿。`frozenShanghaiDatesDoNotFollowDeviceZone`：冻结上海10月25日00:00→11月25日00:00，设备默认 UTC / America/Los_Angeles 都断言显示 `2026-10-25`、`2026-11-25`、`Asia/Shanghai`、`不含终点`；另测跨年。
- [ ] **Step 2：运行失败测试。** `./gradlew.bat --no-daemon --offline :app:testDebugUnitTest --tests '*SalaryTemplateStateTest' --tests '*FrozenFinancialWindowFormatTest'`；当前分类已删仍判可用，UTC 设备显示24日，应失败。修改全局 TimeZone 的测试用 finally 恢复默认值。
- [ ] **Step 3：接入当前分类可用性。** SalarySheet 的加载、打开新建、可选模板列表、表单默认选择都传当前可用分类 ID；不存在可用默认时显示已有“修复分配模板”入口并阻止工资/计划写入。模板/分类保存后重新读取，不自动造分类、不改已有工资分配。保存时遇到确定模板/分类拒绝，先重读再转入修复；其他4xx不能全部误报模板失效。
- [ ] **Step 4：使用冻结日期格式。** SalaryFinancialPrompt 把 current.window.start/end/timeZone 原样交给 formatter，明确 end 排他；不从设备日历推断窗口，不把 end−1 当显示终点。无效时区拒绝展示伪造范围。
- [ ] **Step 5：复跑与检查零写入。** 运行 Step 2 和 `pnpm --filter @jizhang/server test salary-operation-replay-regression.test.ts --maxWorkers=2`；分类不可用失败时工资、分配、周期、operation 均未部分增加。检查正常默认模板仍无需进入管理页，保留输入后可修复继续；目录与设备日期截图分别记录。

**完成标准：** 失效默认模板有可达修复入口及零写入保护；工资确认与月计划显示相同冻结日期和时区。

### T09：统一人工导入与附件会话归属

**Files:**
- 修改：`clients/android/app/src/main/java/com/yansuu1/jizhang/ui/AssistantTab.kt`、`clients/android/app/src/main/java/com/yansuu1/jizhang/ui/DataTab.kt`。
- 修改：`clients/android/app/src/main/java/com/yansuu1/jizhang/ui/feature/imports/PlatformImportHost.kt`。
- 新增：`clients/android/app/src/main/java/com/yansuu1/jizhang/ui/feature/imports/PlatformImportState.kt`。
- 修改：`clients/android/app/src/main/java/com/yansuu1/jizhang/ui/feature/assistant/AssistantBatchImportWorkspace.kt`、`clients/android/app/src/main/java/com/yansuu1/jizhang/repo/AssistantRepository.kt`。
- 新增测试：`clients/android/app/src/test/java/com/yansuu1/jizhang/ui/feature/imports/PlatformImportStateTest.kt`。
- 补测试：`clients/android/app/src/test/java/com/yansuu1/jizhang/net/AssistantBatchNetworkContractTest.kt`、`packages/server/test/import-batch-manual-flow.test.ts`。
- 目录：`clients/android/README.md` 的 D014–D015、A001/A005/A007 及受影响的附件/批次条目。

**Interfaces:**
- 保留现有 `PlatformImportSource` 和 `PlatformImportEntryContext(source, existingConversationId)`，它们当前定义在 PlatformImportHost.kt；没有可直接复用的 PlatformImportState.kt，以上为新增文件。
- Host 增加 `initialDocuments: List<SelectedDocument> = emptyList()`，用于接收 Assistant 已有效选择的账单；两个来源都在宿主中显式开始人工解析。
- 新增 internal 状态类型 `PlatformImportOwnerKey(scope: FinancialScope, identity: ApiRequestIdentity, source: PlatformImportSource, entryConversationId: String?)`、`PlatformImportWorkspaceRef(owner: PlatformImportOwnerKey, conversationId: String, batchId: String)`。Data 创建的协议会话 ID 存在 workspaceRef，不能被“当前聊天会话”覆盖；这些类型不作为公开 Composable 参数。
- 新增 internal 状态类型 `PendingPlatformImportStart(owner: PlatformImportOwnerKey, conversationId: String?, clientRequestId: String, files: List<SelectedDocument>)`，一次开始只生成一个键；未决重试保持同键/同文件，不重新建会话或新批次提案。
- `AssistantRepository.createImportBatch(conversationId, clientRequestId, files, analyse: Boolean = false)`；两个新平台入口均显式 false。服务端和旧单文件 action API 的兼容默认不改。
- Workspace 在 analysis.state 为 idle 或确定 failed、批次可变、Provider 可用且原件齐全时提供显式“AI 整理（可选）”；running/结果未知时提供查询状态，不能用创建批次隐式调用模型。

- [ ] **Step 1：加入入口及所有权失败用例。** `bothEntryPointsCreateManualBatchWithoutModelCalls`：Data/Assistant 的1份和多份文件均发送 analyse=false，parse→review→confirm 的 analyse/generation/Provider 调用数为0，取消 picker 时 createConversation/createImportBatch 均0。`attachmentsAndSlowCompletionStayWithConversationA`：A 选文件后切 B，B 草稿无 A 文件；A 慢响应不能把 A batch 配给 B workspace，A→B→A 旧票据也不接受。
- [ ] **Step 2：运行失败测试。** `./gradlew.bat --no-daemon --offline :app:testDebugUnitTest --tests '*PlatformImportStateTest' --tests '*AssistantBatchNetworkContractTest'`；当前 Assistant 默默 analyse=true、全局 composerBatchFiles 会失败。运行 `pnpm --filter @jizhang/server test import-batch-manual-flow.test.ts --maxWorkers=2`，保留真实 API 无 Provider 调用的回归。
- [ ] **Step 3：把新账单入口接入 Host。** Assistant 的新1–5文件导入分支不再通过通用聊天“发送”自动建 analyse=true 批次；选择有效后进入相同人工宿主，复用当前会话并保留返回来源。Data 仍显式开始后才获得真实导入会话。取消/空选择不触发网络；旧单文件待确认/历史卡、普通聊天文本及其附件合同保留，不把它们全改成新批次。
- [ ] **Step 4：隔离附件、请求和工作区。** 用 owner key 持有账单草稿和 workspaceRef，移除全局 composerBatchFiles 与仅保存 batchId 的配对方式。切会话/服务/用户或 dispose 时使相关 AssistantRequestGate 票据失效；文件读取、创建、重读、错误和 finally 都核对 owner 与票据，响应 conversationId 必须等于请求 ID。不能只用批次 ID 或 owner 相等绕过 A→B→A 票据失效。
- [ ] **Step 5：加入可选 AI 入口。** idle 人工批次可以主动分析；配置不可用时说明原因并继续人工核对，失败保留人工草稿。按 analysis.state 判定，不把 prepared 状态误当自动分析；当前 complete 状态再次分析须是另一次显式操作，未知结果接 T10 恢复。
- [ ] **Step 6：复跑并验证旧流程。** 运行 Step 2、Android lint/build，及 `pnpm --filter @jizhang/server test import-batch-manual-flow.test.ts import-batch-limits.test.ts import-batch-regression.test.ts --maxWorkers=2`。复核取消 SAF、A/B切会话和 idle→显式AI 的设备路径；更新目录，人工调用数0与设备验证分开写。

**完成标准：** 两个新平台入口人工默认且 AI 可主动选择；附件、批次及异步完成都属于创建时的会话，旧卡片仍可操作。

### T10：分析/文件替换的未知结果恢复与原件匹配

**Files:**
- 新增：`clients/android/app/src/main/java/com/yansuu1/jizhang/ui/feature/assistant/AssistantBatchRecoveryState.kt`。
- 新增：`clients/android/app/src/main/java/com/yansuu1/jizhang/ui/feature/assistant/AssistantBatchRecoveryStore.kt`。
- 修改：`clients/android/app/src/main/java/com/yansuu1/jizhang/ui/feature/assistant/AssistantBatchImportWorkspace.kt`。
- 新增测试：`clients/android/app/src/test/java/com/yansuu1/jizhang/ui/feature/assistant/AssistantBatchRecoveryStateTest.kt`。
- 补测试：`packages/server/test/import-batch-analysis.test.ts`、`packages/server/test/import-batch-regression.test.ts`。
- 目录：`clients/android/README.md` 的批次重试、原件重新绑定、未知结果与内存限制条目。

**Interfaces:**
- 使用原 `getImportBatch(conversationId, batchId)`、`analyseImportBatch(conversationId, batchId, clientRequestId, files)`、`replaceBatchFile(conversationId, batchId, targetFileIndex, expectedVersion, clientRequestId, allFiles): MutationResult`；不增加未经后端支持的“按分析key查询”接口。
- 新增 `BatchMutationKind`（ANALYSE/REPLACE/REMOVE，对应 analyse/replace/remove）、`BatchFileFingerprint(fileIndex: Int, fileName: String, sha256: String)`、`BatchMutationMetadata(conversationId: String, batchId: String, kind: BatchMutationKind, clientRequestId: String, expectedVersion: Long, analysisRevision: Long, targetFileIndex: Int?, files: List<BatchFileFingerprint>)`；发送前持久化到 server/user + conversation/batch 范围。
- 新增 `BatchMutationState`（IDLE/SENDING/UNKNOWN/CONFIRMED/REJECTED）及 `AssistantBatchRecoveryState(metadata: BatchMutationMetadata?, state: BatchMutationState, candidateFiles: List<SelectedDocument>, message: String?)`；hasUnresolvedMutation 为 SENDING/UNKNOWN，供工作区构建 T12 的 handler。
- `AssistantBatchRecoveryStore` 提供 `suspend fun record(scope: FinancialScope, metadata: BatchMutationMetadata)`、`fun list(scope: FinancialScope, conversationId: String, batchId: String): List<BatchMutationMetadata>`、`suspend fun remove(scope: FinancialScope, metadata: BatchMutationMetadata)`；存储失败阻止发送。不持久化原始 bytes、reviewToken 或聊天内容；候选 SelectedDocument 保留在当前 owner 的内存中，重启后用指纹重新绑定。
- 新增 `internal fun matchBatchOriginals(files: List<ImportBatchFile>, docs: List<SelectedDocument>): List<SelectedDocument>?`；按服务端 fileIndex 顺序和 SHA-256 一一匹配，必要时重排，缺失/损坏返回 null。每份 doc 只使用一次，不能以数量相同代替哈希匹配。
- Workspace 明确区分确定失败 / 结果未知 / 已确认；暴露其未决状态给 T12 守卫。已有 confirm 的 batch.status/result 核对继续沿用，结果未知不得用新批次或新 review 提案替代结果确认。

- [ ] **Step 1：加入未知分析与原件恢复失败用例。** `lostMutationResponseKeepsKeyAndCandidateFiles`：分析第一次已完成但客户端丢响应，GET 回 complete 后不再调用 Provider；同键恢复 HTTP 即使重放，Provider 总计1。另测 running、查询断网、确定failed后用户明确新分析、重启载入原元数据。文件替换旧 bytes→新 bytes 成功丢响应、文件数不变：GET 新 hash 后旧 bytes 判不匹配，候选 bytes 可恢复，重新绑定入口仍可见。
- [ ] **Step 2：补匹配与原子确认边界。** `hashMatchingUsesEveryOriginalExactlyOnce` 覆盖顺序变化、同数量不同 hash、缺失文件、重复 hash 的一一占用；旧 bytes / 旧 reviewToken 确认均拒绝且新增财务行0，正确原件重新 review/confirm 后只入账一次。
- [ ] **Step 3：运行失败测试。** `./gradlew.bat --no-daemon --offline :app:testDebugUnitTest --tests '*AssistantBatchRecoveryStateTest'`；当前新 UUID 重试、只比较文件数会失败。运行 `pnpm --filter @jizhang/server test import-batch-analysis.test.ts import-batch-regression.test.ts --maxWorkers=2`，验证后端已有同键缓存重放，不能修改它去适配错误客户端。
- [ ] **Step 4：实现分析恢复状态。** 显式分析开始只分配一个 clientRequestId，保持原文件顺序、索引、名字和哈希；未知时先 GET 原批次。complete/running 采用权威状态或继续查进度；查询失败保留未知。需要补发时只发送原键/原载荷，不能修改文件后同键发送，也不能取新 UUID。只有已确认失败并且用户明确选择另一次分析，才新建分析提案。分析修订变化使本地 review 失效。
- [ ] **Step 5：实现文件变更恢复。** replace/remove 发出前保存候选文件集和原元数据；丢响应后先 GET，再用原键/原载荷取回可重放 MutationResult，必要时执行现有 remapBatchDrafts。只有服务端确认与候选 hash 全匹配后才替换已确认 memoryFiles。版本/哈希不一致不可自动 rebase；显示核对/重新绑定入口，保留原操作和草稿。任何文件变更使 reviewToken 失效，重新 review 后才可 confirm。
- [ ] **Step 6：把 filesMismatch 改成真实内容判定。** 重读成功后用 matchBatchOriginals 校验当前内存文件；解析成功的文件也可能原件缺失，不能只在 parseStatus=failed 分支允许恢复。重启无 bytes 时从当前批次恢复指纹和未决元数据，用户重新选择原件后按原请求继续；未知期间不假装原件有效或自动发 AI。
- [ ] **Step 7：复跑与记录。** 运行 Step 3；补 `pnpm --filter @jizhang/server test import-batch-confirm.test.ts --maxWorkers=2` 验证零部分入账及同批次已确认结果。设备丢响应/重启/重新绑定原件另验，更新目录，不抹去已有“原件仅内存”事实。

**完成标准：** 不重复调用模型；文件数相同也能发现内容失配；响应丢失和重启后有安全恢复路径，原 hash/token/原子保护保持。

### T11：异常优先核对、原备注差异与分类实体计数

**Files:**
- 修改：`clients/android/app/src/main/java/com/yansuu1/jizhang/ui/feature/assistant/AssistantImportState.kt`。
- 修改：`clients/android/app/src/main/java/com/yansuu1/jizhang/ui/feature/assistant/AssistantBatchImportWorkspace.kt`。
- 修改测试：`clients/android/app/src/test/java/com/yansuu1/jizhang/ui/feature/assistant/AssistantBatchImportStateTest.kt`。
- 修改：`packages/server/src/services/import-batch-service.ts`。
- 修改测试：`packages/server/test/import-batch-confirm.test.ts`、`packages/server/test/import-batch-manual-flow.test.ts`。
- 读取复用：`clients/android/app/src/main/java/com/yansuu1/jizhang/ui/feature/assistant/AssistantBatchModels.kt` 的 noteAlternatives / ReviewSummary / ImportBatchResult；后端已保存原备注，不重新解析原件造另一套备注。
- 目录：`clients/android/README.md` 的批次核对、来源备注、汇总计数条目。

**Interfaces:**
- 新增 `internal fun batchRowNeedsAttention(row: ImportBatchRow, assignments: Map<String, CategoryAssignment>, approvedCategories: Map<String, ApprovedCategory>, activeCategoryIds: Set<String>?, userExcluded: Set<String>): Boolean`。
- `filterBatchRows(rows, query, filter, selected, userExcluded)` 保留原参数，追加 assignments / approvedCategories / activeCategoryIds 的默认参数；默认 filter 改为“待核对”。事实冲突、疑似重复/旧账命中、规则异常、无可用分类或待批准分类进入综合视图；显式 userExcluded 不再要求用户分配分类，仍在专门筛选和全部中可见。
- “全部”可切回完整行集；按 attention 优先、ordinal、itemId 稳定排序，只改显示顺序，不改 selected、排除或金额。没有待核对行时显示“查看全部 N 条”，不能伪装空批次。
- 来源展示消费 `ImportRowNoteAlternative(fileName, note)` / row.sources；“采用此备注”把包括空字符串在内的原 note 写入 noteOverrides 并失效 review。
- `ImportBatchResult.categoriesCreated/categoriesReused` 继续原字段名，计数单位为去重分类实体；ReviewSummary.categoriesToCreate / categoriesToReuse 列表也以同单位汇总。selectedRows 仍按财务行计数。

- [ ] **Step 1：加入核对显示失败用例。** `attentionViewIncludesConflictAndUnassignedRowsBeforeOrdinaryRows` 用跨100行的普通/冲突/未分配/待批准/疑似重复/规则忽略 fixture：默认待核对能看到异常，全部保留每一行且异常在前，草稿分类/批准后重新判断，查询与选择不因排序丢失。`originalNoteAlternativesPreserveEmptyAndQuotedNotes` 断言生产模型保留两个来源备注（含空值/引号），采用空原备注后 noteOverrides 包含该 ID 且值为空，不回退为主备注。
- [ ] **Step 2：加入分类计数失败用例。** `categoryCountsUseDistinctEntitiesInReviewAndConfirm`：3行同一个批准新分类，review 列表长度创建1/复用0，confirm 结果 categoriesCreated=1/categoriesReused=0、inserted=3；3行同一个已有分类得到0/1。补两旧分类、多 suggestion 复用同实体、新旧混合、同名不同 type/parent 不合并、unused 批准项及同批次重放；账单金额和 inserted 不随分类计数修复变化。
- [ ] **Step 3：运行失败测试。** `./gradlew.bat --no-daemon --offline :app:testDebugUnitTest --tests '*AssistantBatchImportStateTest'`；当前默认全部且只 filter 不排序，会失败。运行 `pnpm --filter @jizhang/server test import-batch-confirm.test.ts import-batch-manual-flow.test.ts --maxWorkers=2`；当前新分类3行被报复用2，应失败。
- [ ] **Step 4：接通综合筛选和原备注展示。** 使用真实 categoryAssignments / approvedCategories / activeLeaves 判断分类是否解决，保留全部及现有专门筛选。行详情/编辑页显示“不同来源原备注”，带来源文件名并可采用；长备注可展开但真实内容不截断写回，空值明确标“原备注为空”。不把 AI 建议、主备注和用户覆盖混成原件内容。
- [ ] **Step 5：统一后端分类计数。** confirm 用 createdCategoryIds 和 usedCategoryIds 集合计算；本次新建分类被后续行使用仍计创建，不再计复用。复用为实际 used IDs 中排除本次 created IDs 后的数量；review 使用相同的实体/新建计划单位。categoriesSkippedUnused 保留未使用批准提案去重含义，不改分类匹配、审批或原子事务规则。
- [ ] **Step 6：验证并维护。** 复跑 Step 3、人工核对/confirm 原子回归；确认页面摘要仍来自服务端，未修改金额或去重身份。设备查看超首屏异常、展开来源备注、采用空备注及切全部另验；同步目录的单位与入口说明。

**完成标准：** 异常不会淹没在普通行中，来源备注可核对，review 和最终结果的“分类N个”含义一致。

### T12：财务/导入的外层离开与返回守卫

**Files:**
- 新增：`clients/android/app/src/main/java/com/yansuu1/jizhang/ui/NavigationLeaveGuard.kt`。
- 修改：`clients/android/app/src/main/java/com/yansuu1/jizhang/ui/MainShell.kt`、`clients/android/app/src/main/java/com/yansuu1/jizhang/ui/MyTab.kt`。
- 修改：`clients/android/app/src/main/java/com/yansuu1/jizhang/ui/FinancialHostScreen.kt`、`clients/android/app/src/main/java/com/yansuu1/jizhang/ui/FinancialExecutionWorkspace.kt`、`clients/android/app/src/main/java/com/yansuu1/jizhang/ui/MonthlyPlanWorkspace.kt`、`clients/android/app/src/main/java/com/yansuu1/jizhang/ui/ManualGoalProgressWorkspace.kt`。
- 修改：`clients/android/app/src/main/java/com/yansuu1/jizhang/ui/AssistantTab.kt`、`clients/android/app/src/main/java/com/yansuu1/jizhang/ui/DataTab.kt`、`clients/android/app/src/main/java/com/yansuu1/jizhang/ui/feature/imports/PlatformImportHost.kt`、`clients/android/app/src/main/java/com/yansuu1/jizhang/ui/feature/assistant/AssistantBatchImportWorkspace.kt`。
- 新增测试：`clients/android/app/src/test/java/com/yansuu1/jizhang/ui/NavigationLeaveGuardTest.kt`。
- 复用测试：`clients/android/app/src/test/java/com/yansuu1/jizhang/ui/FinancialHostAndWorkOwnerTest.kt`、`clients/android/app/src/test/java/com/yansuu1/jizhang/ui/feature/assistant/AssistantBatchRecoveryStateTest.kt`。
- 目录：`clients/android/README.md` 的 P017–P020、B03.08、S01.10、A001 及 D014/批次返回条目。

**Interfaces:**
- 新增 `typealias LeaveGuard = (onAllowLeave: () -> Unit) -> Unit`、`data class ActiveNavigationHandlers(val requestBack: () -> Unit, val requestLeave: LeaveGuard)`，区分“返回一层”和“离开整个宿主”。
- 新增 `internal class NavigationLeaveCoordinator`，提供 `register(ownerKey: String, handlers: ActiveNavigationHandlers?)`、`requestBack(fallback: () -> Unit)`、`requestLeave(onAllowLeave: () -> Unit)`。同 owner 未决离开只保留首次去向；旧 owner 的延迟允许回调和重复回调均不能提交导航。
- 宿主/内层工作区新增 `onRegisterNavigation: ((ActiveNavigationHandlers?) -> Unit)? = null`；失活/dispose 注销自己的 owner，不清别人的注册。FinancialHost 继续复用 scenarioGuard/executionGuard 的现有 `((() -> Unit) -> Unit)` 形式，并纳入计划内手动目标守卫。
- 需要保留 composition 的 MonthlyPlan / ManualGoal / FinancialExecution 及批次工作区增加 `active: Boolean = true`；只有活动层注册外部处理和 BackHandler，隐藏页不截获返回/触摸。

- [ ] **Step 1：加入生产协调器失败用例。** `outerNavigationConsultsActiveLeaveGuard`：请求底栏切换时 guard 未允许则目的地调用0，取消继续编辑，允许后恰好1；同owner重复点不弹第二份确认，旧 owner 延迟允许不导航。`backClosesInnermostLayerBeforeSource`：编辑/比较/review 先关闭内层，批次再返回宿主，宿主才回 Data/Assistant 来源；保留固定4个财务 composition 和 active-only 处理。
- [ ] **Step 2：记录实际外层失败用例并运行测试。** 财务脏草稿点底栏、Data 批次主列表按系统 Back、AI 批次点外层返回，当前绕过守卫应记录失败。运行 `./gradlew.bat --no-daemon --offline :app:testDebugUnitTest --tests '*NavigationLeaveGuardTest' --tests '*FinancialHostAndWorkOwnerTest' --tests '*AssistantBatchRecoveryStateTest'`；不能用“源码含 BackHandler”断言替代实际导航验证。
- [ ] **Step 3：接通 MainShell / MyTab。** selectTab 把提交动作交给当前 leave handler，允许后才修改 tab/销毁宿主。AI 外层按钮/系统 Back、MyTab 关闭/返回先调用 active requestBack，不能直接 closeAssistant/closeSection。登记/注销和最终导航回调都校验 owner 代次，不能在另一个页面收到旧确认后跳转。
- [ ] **Step 4：接通财务内层。** FinancialHost 的执行/测算保留现有 dirty/busy guard；PLAN 内若打开手动目标，先调用目标 requestBack/leave，再决定返回摘要或离开。隐藏保留页的 handler 分别存储，只有当前 Tab 向外注册，不允许 inactive 注册覆盖 active。系统/顶部返回遵守相同层次，禁止以 alpha 隐藏替代不放置策略。
- [ ] **Step 5：接通导入内层。** PlatformImportHost 把 Back/外部处理注册放在所有提前 return 分支之前；工作区比较、编辑、review、主列表按顺序处理。离开有草稿、选定原件、正在提交或未知结果的页面时显示继续/离开选择；继续保留全部。明确离开只停止本地等待/显示，不撤销可能已提交的服务端操作，T04/T10 的 pending 和恢复元数据不得删除。没有可恢复原件 bytes 时再入页提示重新绑定。
- [ ] **Step 6：设备验证真实接线。** 在脏/干净/提交中/结果未知四种状态分别点底栏、顶部返回、AI外层返回、Data系统Back；取消保留字段/原件，允许不重复写入/模型调用，下一次可按原键恢复；TalkBack 和隐藏页不得截获操作。复跑 Step 2、Android lint/build；设备不可用时明确保留待验并完成源码链路复核。

**完成标准：** 外层导航实际咨询活动页面状态，内层返回优先；离开不会默默抹去未决恢复能力，隐藏财务页不获得 Back 所有权。

### T13：历史重复月初的最早有效瞬间

**Files:**
- 修改：`packages/shared/src/stats-window.ts`。
- 修改测试：`packages/shared/test/stats-window.test.ts`、`packages/server/test/stats.test.ts`。
- 规范同步：`.trellis/spec/backend/statistics-window.md`，仅记录本次统计边界契约及复现，不能扩大其他工资周期的历史时区支持声明。
- 目录：`clients/android/README.md` 的 B02 统计窗口/API 缺口，明确这是 shared/server 计算修复，设备未验状态单列。

**Interfaces:**
- 保留 `resolveStatsWindow(kind: 'month' | 'last30', month: string | null, now: number, timeZone: string): StatsWindow`。
- 保留 private `zonedMonthStart(year: number, month: number, timeZone: string): number`，返回本地月初最早有效 instant；缺午夜用首个存在 instant，重复午夜用第一次。相邻月窗口用该边界分割，不新增多段窗口 API。

- [ ] **Step 1：加入确定历史失败用例。** `repeatedNovemberMidnightUsesFirstInstant`：America/St_Johns、2009-11，断言 `from == Date.parse('2009-11-01T02:30:00Z')`，不是03:30Z；10月窗口 `to` 等于这个 from，02:30:30Z 的账单计入11月。02:31Z 本地日期曾回拨到10月31日，仍按既定连续 epoch 半开窗口分割，不要求此处本地月份单调。
- [ ] **Step 2：补缺午夜及常规回归。** America/Asuncion 的2017-10月初跳过00:00，first instant 为 `2017-10-01T04:00:00Z`（本地01:00）；上海固定 now `2026-10-29T04:00:00Z` 的 last30.from 为 `2026-09-29T04:00:00Z`，持续720小时。保留跨年、闰月、普通DST、非法月份/时区/now 与半开边界用例。
- [ ] **Step 3：运行失败测试。** `pnpm --filter @jizhang/shared test stats-window.test.ts`；当前全局月份二分选第二次月初，应失败。
- [ ] **Step 4：修正边界算法与注释。** 不再对整个 UTC月初±48h 使用“本地月份单调”二分。采用有界分段/候选午夜搜索：收集回拨前后可能偏移，构造候选并用含秒的显式时区 civil parts 回验，按 epoch 从小到大选最早有效值；跳过午夜使用偏移转换后首个有效边界。仅在已确认单调的局部区间精确搜索，复用本次 Intl.DateTimeFormat 实例，避免每次采样重新建 formatter或无限扫描。注释明确重复/缺失策略，不保留错误单调假设。
- [ ] **Step 5：验证 server 使用新 shared 输出。** 先 `pnpm --filter @jizhang/shared build`，再 `pnpm --filter @jizhang/server test stats.test.ts --maxWorkers=2`；公开 stats/window 返回02:30Z，按它查询的统计/明细包括02:30:30Z。API 不返回设备推算窗口，last30 行为保持。同步规范及目录证据。

**完成标准：** St_Johns 复现修正为第一次月初，缺午夜与正常月份不退化，单个半开窗口和 API 签名保持。

### T14：目录校正、全链路验收与证据交付

**Files:**
- 修改：`clients/android/README.md`。
- 修改：`docs/superpowers/plans/2026-10-29-core-finance-simplification.md` 的实施状态段，保留原需求正文。
- 修改：`.trellis/tasks/10-29-core-finance-simplification/acceptance.md` 的分级证据与实际状态，保留全部46个 ID。
- 新增测试：`packages/server/test/core-finance-repair-integration.test.ts`。
- 新增证据：实际修复任务 evidence 下的 `repair-checks.md`、`repair-closure.md` 与必要 API fixture/设备附件；执行时登记实际任务路径，本轮不预建修复任务。
- 保留只读历史：`.trellis/tasks/10-30-core-finance-simplification-review/review.md`、`evidence/checks.md`、`evidence/api-probes.mjs`、`evidence/api-probes.json`。

**Interfaces:**
- 修复闭环表每行包含 R编号、修复任务、修改路径、行为测试/命令、源码/自动化/设备分别结果、证据路径与剩余缺口。
- 原 C/G 验收矩阵每项保留稳定 ID；证据不足的设备部分仍为待验。单元/API通过不能把含真机步骤的整行直接写 PASS。

- [ ] **Step 1：加入全链路集成用例。** `coreFinanceRepairKeepsOneSalaryAndDistinctMoneyViews` 在 app.inject() + 隔离迁移库 + 固定时钟运行工资→确认计划→支出→退款→统计→手动存投→复盘。断言工资只1笔、消费预算6000元、3200＋600消费/剩2200、独立100退30毛/退款/净用途值、应急12500/净存500、投资6500/净投1500；目标本期值来自完整窗口数据，账本整集不因目标操作变更。退款 fixture 与主消费 fixture 独立，不把70元误加进主3800元验收值。
- [ ] **Step 2：核对旧合同与运行门禁。** 使用下节全量命令，记录本次时间、源码状态、真实测试数量和退出码；旧工资、转账、退款、历史周期、旧导入、备份/恢复、401/CSRF/no-store 回归仍通过。旧服务器新接口404应显式 unavailable，旧工具仍可访问，不推导假0；合成库验证，不连接生产账本。
- [ ] **Step 3：校正目录事实。** 逐项按实际源代码核对 S01.02/S01.10/S01.12、B03.08–B03.13、B02.12、P017–P020、A001/A005/A007、D014–D019 及附件/批次相关 ID。D017–D019 中旧单文件禁选、自由文本分类、直接确认描述改成明确的旧流程说明/保留历史条目，当前新批次另记实际合同；不得把旧 ID 回收用于另一功能。写清原件内存、分页、手动来源、默认人工/显式AI与恢复限制。
- [ ] **Step 4：更新实施及验收状态。** 原计划开头的“C2正在实施/C3–C5未完成”改为核对过的实际状态；完成本地不等于产品验收。每个 C/G 条目填写日期、源码/服务/APK版本、fixture、命令或设备步骤、结果及证据链接；设备未执行的 SAF/IME/Back/触摸/无障碍/弱网/重启不能勾 PASS。
- [ ] **Step 5：补齐设备或登记待验。** 用下节设备清单执行 G01/G02/G04/G05，记录 APK 哈希、设备/时区、服务版本和脱敏证据。没有设备或旧服务 fixture 时明确缺口；不得用仓库版本、编译成功或历史截图补足。执行模型可以交付“本地修复已验证、设备待验”，不能称全部46条通过。
- [ ] **Step 6：输出 R01–R20 闭环表并交接。** 所有审查项均有行为回归和源码结论，尚未覆盖的设备行为单列。更新实际修复任务 PRD/design/implement、上下文和新证据索引；提交前只暂存本项所属路径，按项目授权流程处理提交，不混入原有329项改动。

**完成标准：** 20项均可追溯到修复与验证；目录/状态没有超出证据的声明，自动化全绿；完整产品验收还必须满足原46条全部所需证据。

## 3. 固定金额与窗口验收值

金额表以元描述；代码/API断言乘100为整数分。主消费、退款、预测各自使用独立 fixture，避免把示例相加后误改金额规则。

| fixture | 权威结果 |
|---|---|
| 工资10000明确纳入当前计划 | 成长2500 / 应急1500 / 必要5000 / 随心1000；合计10000；消费预算6000；工资事实只1笔 |
| 必要3200＋随心600 | 消费3800，必要剩1800，随心剩400，预算剩2200 |
| 支出100＋已确认退款30 | 普通毛支出100，退款收入30，确认用途净消费70 |
| 应急起始12000＋存1500−取1000 | asOf记录余额12500，本期净存入500；账户/交易/工资不变 |
| 本金起始5000＋投入2500−取回本金1000 | asOf记录本金6500，本期净投入1500；不含收益/市值 |
| 必要基准5000×5，应急12000，当前预留1500 | 目标25000，48%，缺13000，假设9次；无当前可用计划/参考0且未达标时ETA=null |
| fixed now=2026-10-29T04:00:00Z | last30=[2026-09-29T04:00:00Z, 2026-10-29T04:00:00Z)，720小时 |
| 上海冻结10/25零点至11/25零点，UTC设备 | 显示10/25→11/25、Asia/Shanghai、不含终点；不显示24日 |
| St_Johns 2009-11 | 最早月初2009-11-01T02:30:00Z；相邻10月to一致，不取03:30Z |
| 3行使用同一个新/旧分类 | 新分类：创建1/复用0；旧分类：创建0/复用1；财务行仍3 |

## 4. 验证命令与证据边界

每项先运行其失败回归再实现；修复后运行对应回归，最后 T14 跑全量。shared 改动后先 build 再运行 server，避免 server 使用旧 dist；同一工作区不并发运行会写 shared dist 或 Gradle输出的构建。文档/普通 UI 文案不增加镜像实现的测试。

仓库根目录：

```powershell
pnpm --filter @jizhang/shared build
pnpm --filter @jizhang/shared test
pnpm -r run lint
pnpm -r run typecheck
pnpm --filter @jizhang/server test --maxWorkers=2
pnpm --filter @jizhang/server build
```

在 `clients/android`：

```powershell
./gradlew.bat --no-daemon --offline :app:testDebugUnitTest :app:lintDebug :app:assembleDebug
```

若单测被标 UP-TO-DATE 而本次需要新执行证据，追加一次 `./gradlew.bat --no-daemon --offline :app:testDebugUnitTest --rerun-tasks` 并核对 XML 报告的失败/错误/跳过；不要只抄旧计数。使用默认用户 Gradle 缓存，不强制设为仓库 `.gradle-cache`（该缓存未含本项目 AGP 8.5.2）。

审查时的历史基线仅作对照：shared 385 / 12文件、server 1025 / 47文件、Android 518 / 52 suites，失败/错误/跳过0；Android lint 43 warnings、26 information、0 errors。这些数字不是修复后结果，不要求人为凑数量或声称零 warnings。

原 `api-probes.mjs/json` 是旧缺陷复现证据，不是修复后的绿色门禁。特别是 R11“无当前周期仍有1500元参考/9次”的旧断言修复后应失败；新验证放新的修复回归与 evidence，不改写历史证据。R01 无键工资重复探针仍应显示2行，因为后台兼容路径保留；新客户端的带键真实载荷必须单独验证。

设备验证最低清单：

1. 从计划中央＋保存支出、从工具完成计划/退款/目标写入，再返回摘要；观察本期值自动刷新和失败过期标签。
2. 工资保存/纳入分别双击、丢响应、断网、杀进程；新请求只入一次，旧无键记录人工核对、零自动重发。
3. 手动起始/新增/编辑/删除四种写入丢响应及重启恢复；特殊备注准确、最早历史可操作。
4. A/B服务或用户切换、同服务新登录、A→B→A，释放旧401/成功响应；新会话不退出、不串草稿。
5. Data/Assistant SAF选1份/多份/取消，人工全过程无AI，idle可显式分析；A附件不在B发送。
6. 分析/文件替换丢响应，重新绑定相同数量的新原件，核对hash/revision/token后一次确认。
7. 财务/AI/Data内层与外层Back、底栏切换，脏/干净/忙/未知四状态；IME、小屏、TalkBack与隐藏页命中。
8. 旧服务器新接口不支持、旧卡片、本应用账单/转账CSV和备份路径；记录明确不可用/旧工具可达，不宣称未测环境通过。

## 5. 交接与完成判定

- 本轮产物是这份待实施规划；当前审查任务保持 planning，review_status=complete / changes-required，不把规划写入当作修复完成。
- 实施者按实际任务阶段加载规范；单模型按 T01–T14 执行，多模型也遵守同文件顺序所有权。若源码在交接后改变，先用 R编号核对触发路径是否仍存在，再调整对应任务，不重做整个已完成审查。
- 每项交接应包含限定文件、已执行回归及真实输出、接口变更、目录局部更新和设备待验。仅源实现＋自动化通过可记 LOCAL VERIFIED；父任务产品接受仍需原 G01–G06 和46条所需证据闭环。
- 不运行原缺陷复现脚本凑绿门禁，不修改生产数据，不将历史证据替换成新结果；新证据用于说明每一项何时、在哪个版本、如何被修正。
