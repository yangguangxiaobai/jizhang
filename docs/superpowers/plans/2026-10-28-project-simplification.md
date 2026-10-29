# 项目精简 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删除废弃 Web 及专属工具链，保留现有 Android 功能和账务结果，减少账务、预算、理财与 AI 模块的重复实现和职责耦合。

**Architecture:** 保留单 Fastify 服务、SQLite、TypeScript shared 与 Kotlin/Compose。现有服务作为兼容入口，按职责抽取实现；普通现金流、分类信封与四用途净执行继续使用各自明确的计算视图。

**Tech Stack:** Node.js >=22.12.0、pnpm 10.12.2、TypeScript/ESM、Fastify、better-sqlite3、Vitest、Kotlin/Compose、Gradle。

**Spec:** [项目精简设计](../specs/2026-10-28-project-simplification-design.md)。设计中的范围和账务规则适用于全部任务。

**Status:** 执行中。当前工作区已完成 Web 目录删除和专属工具链清理，正在完成第 2 批回归；普通账务重构尚未开始。用户已明确授权 Web 退役，并确认保留 Android 功能；不创建 Trellis 任务。各批实际结果见执行记录。

## Global Constraints

- Node.js `>=22.12.0`，pnpm `10.12.2`；Android 工具链保持当前版本，不夹带升级。
- API 前缀 `/api/v1`；保留现有 URL、字段、错误形状、排序和分页行为。
- 金额为整数分，时间为 epoch 毫秒；服务器默认日历为 `Asia/Shanghai`，理财周期遵循其保存的时区。
- 比例使用现有整数基点约束；四用途比例合计 `10000` bps。
- 普通退款为 `type=1` 的收入；普通支出/分类信封为毛额；四用途退款采用确认分摊后的净额。
- 继续由 shared 计算金额，Android 展示服务端结果；保留写入确认、精确整数校验、重放和来源失效保护。
- 默认不改表结构、不迁移账务数据、不物化余额、不增加 ORM、缓存、消息队列或规则框架。
- Android 功能、Repository 或其 API 契约发生调整时，同批维护 `clients/android/README.md` 的受影响 ID、入口、字段、API、缺口与变更记录；仅推进已核对部分的日期。
- Web 的旧验收前置限制由本次明确删除授权取代。Harmony、物品、抠图、AI 等现有能力不属于本次功能删减范围。
- 全部账务验证使用隔离测试库；现有 `resetToKnownState` 会重置账本，不对生产实例执行。
- 当前未提交的业务改动属于基线。执行前按实际工作区留存范围，不能从旧 HEAD 重建后遗漏这些功能；每批只纳入本批文件变更。

## Review Focus

1. **退款的两个视图与多原单分摊**：普通收支显示毛支出/退款收入，四用途显示净消费；退款或原单事实变化后整集分摊失效。由任务 1、5 验证。
2. **工资重复提交与模板变化**：相同 operationId 的重放返回原结果，模板后续删除/修改不产生第二份工资或分配。由任务 1、3、5 验证。
3. **历史周期、时区与漏记支出**：自然月工资日起点、自定义起始日、冻结时区、零预算分类和历史池值保持现有语义。由任务 1、4、5 验证。
4. **整数与缺失字段**：小数、溢出、数字字符串、缺失/null 区别按现有字段契约处理，不把缺失金额解码成零，不把省略用途当成清除。由任务 3、6 验证。
5. **网络不确定与过期结果**：切换服务器/会话/对话、取消请求、重复确认、过期 reviewRevision 不覆盖当前状态或重复入账。由任务 5、6、7 验证。

## 执行批次

| 任务 | 依赖 | 交付结果 | 风险与完成判据 |
|---|---|---|---|
| 1. 核对基线 | 无 | 功能与回归矩阵 | 不把旧注释当成现行规则；记录实际通过/失败 |
| 2. Web 退役 | 1 | 无 Web 工程或专属构建依赖 | server/shared 构建、测试及 API-only 404 保持 |
| 3. 普通账务整理 | 1；顺序在 2 后 | 兼容服务入口、共享转换和独立类型/错误 | 现金流、工资原子性、退款关联保持 |
| 4. 信封预算整理 | 3 | 一份周期/池计算准备 | 历史/当前结果、趋势与无预算分类保持 |
| 5. 理财服务拆分 | 3；顺序在 4 后 | 配置、周期、退款/执行分工 | 幂等、CAS、来源失效和历史快照保持 |
| 6. Android 状态/解码 | 3、5 | UI 与请求状态、解析职责分离 | 字段、入口、草稿、返回与弱网行为保持 |
| 7. AI/导入整理 | 3、6 | 保留功能的协调层拆分 | 1–5 文件、500 行、审核/确认与撤销保持当前约束 |
| 8. 端到端验收与文档 | 2–7 | 可交付 APK/API 与清晰当前文档 | 本地、设备、生产证据分别记录 |

每批完成相应验证后再推进。若已有失败由前序业务改动造成，先记录和定位；不能为让结构重构通过而删除测试或调整金额期望。

---

### Task 1: 建立当前功能与账务规则基线

**Files:**
- Read: `clients/android/README.md`、`AGENTS.md`。
- Read: `packages/shared/src/types.ts`、`account-balance.ts`、`budget-engine.ts`、`financial-execution.ts`。
- Test: `packages/shared/test/account-balance.test.ts`、`budget-engine.test.ts`、`budget-completeness.test.ts`、`financial-execution.test.ts`。
- Test: `packages/server/test/transactions.test.ts`、`account-balance.test.ts`、`budget.test.ts`、`stats.test.ts`、`transfers.test.ts`、`financial-planning-existing-salary.test.ts`、`financial-planning-refunds.test.ts`。
- Record: 本计划的执行记录区。

**Interfaces:**
- Consumes: 当前工作区及真实 API/DTO，不以旧 HEAD 或 UI 设计图作为基线。
- Produces: 各计算视图的输入/结果矩阵、现有测试覆盖位置、实际基线状态。

- [x] **Step 1: 记录工作区范围。** 记录当前分支、已修改/新增文件及执行环境；执行期间保留他人改动。定位现有未提交 Android、导入和理财功能的来源文件。
- [x] **Step 2: 对照实际函数与测试确定退款口径。** `expenseContribution({type:0,amountCents:10000})=10000`；`expenseContribution({type:1,amountCents:3000,isRefund:true})=0`；该退款的 `incomeContribution=3000`。旧“退款负支出”注释只作为待纠正文档，不改变函数期望。
- [x] **Step 3: 覆盖关键组合。** 使用同月工资 `100000` 分、支出 `10000` 分、退款 `3000` 分的合成账本：账户余额 `93000` 分；普通账单汇总收入 `3000` 分/支出 `10000` 分；月度统计若含工资，收入 `103000` 分。确认四用途分摊后净支出 `7000` 分。复用现有测试，只有跨视图覆盖确实缺失时才在相应测试文件补充。
- [x] **Step 4: 运行一次后端基线。** 依次执行 shared build、shared test、server lint/typecheck/test/build；记录命令与结果。当前失败不得被写成“基线已通过”。
- [x] **Step 5: 运行一次 Android 基线。** 在 `clients/android` 执行 `./gradlew.bat :app:testDebugUnitTest :app:lintDebug :app:assembleDebug`。记录测试总数、lint 错误/警告和 APK；构建通过单独记录，设备验收另列。

**Completion:** 能指出每项保留规则由哪个函数和测试保证，能够比较重构前后结果。

### Task 2: 完整删除废弃 Web 与专属工具链

**Files:**
- Delete: `packages/web/`。
- Modify: `package.json`、`pnpm-lock.yaml`、`eslint.config.mjs`、`.gitignore`、`.dockerignore`。
- Inspect: `pnpm-workspace.yaml`、`Dockerfile`、`deploy/create-source-bundle.py`、`deploy/test_source_bundle.py`。
- Modify docs: `README.md`、`USAGE.md`、`clients/docs/versions.md`、`clients/docs/parity-matrix.md`、`clients/docs/release.md`；更新实际仍使用 Web 命令的章节。
- Inspect/update current specs: `.trellis/spec/frontend/index.md`、`.trellis/spec/backend/native-delivery.md`、`quality-guidelines.md`、`item-assets.md`。
- Retain/test: `packages/server/scripts/check-api-only.mjs`、`scripts/lib/retired-web.mjs`、`packages/server/test/app.test.ts`。

**Interfaces:**
- Consumes: 当前 server/shared API 回归、Android 功能基线和 Web 内旧测试断言。
- Produces: 根 dev/build/test/lint/typecheck 可运行的 API workspace；API-only 部署契约不变。

- [x] **Step 1: 分类 Web 中的测试价值。** 对 `packages/web/e2e/` 的断言逐项记录：浏览器/UI/PWA 行为随 Web 退役；API 返回、物品生命周期、照片/抠图等断言对照 server 的 `items.test.ts`、`item-cutouts.test.ts`、`app.test.ts` 和对应业务测试。只迁移现有覆盖中缺失的 API 行为和必要 fixture。
- [x] **Step 2: 删除 Web 目录。** Windows 下先解析 `packages/web` 的绝对路径，验证其位于本仓库且正好是预期目录，再用同一 PowerShell 的 `Remove-Item -LiteralPath` 执行。保留 Git 历史及历史任务记录；不扩大到其他客户端或临时文件。
- [x] **Step 3: 清理根脚本和依赖。** 删除设计中列出的五个 Web/iPhone 脚本；核对当前用途后删除 `@playwright/test`、`eslint-plugin-vue`，清理 Vue parser、浏览器 globals 与 Web ESLint patterns。保留 Vitest、TypeScript、共享格式检查和 Node 规则。
- [x] **Step 4: 正常更新锁文件。** 执行 `pnpm install --lockfile-only`，再以 `pnpm install --frozen-lockfile` 验证。保留 `pnpm-workspace.yaml` 的 `packages/*` 与 `onlyBuiltDependencies: better-sqlite3, esbuild`。不使用 `--ignore-scripts`。核对锁文件中 Web importer 与独占依赖已消失。
- [x] **Step 5: 更新当前文档和有效规范。** README/USAGE 改为 Android/API 操作；前端索引明确 Web 已退役、旧文档为历史；native-delivery 删除等待 Web parity 才能退役的约束。保留有追溯价值的历史任务、负例 fixture 和 `checkRetiredWeb`。
- [x] **Step 6: 验证退役结果。** 检查 `packages/web` 不存在、根脚本不再调用 Web、当前配置不再导入 Vue/Playwright。运行 `pnpm build`、`pnpm lint`、`pnpm typecheck`、`pnpm test`；在隔离 API 实例运行 `check-api-only.mjs`，确认 health 正常、旧页面/资源路径返回 JSON 404。记录服务端 API E2E 的保留列表。
- [x] **Step 7: 单独保存本批变更。** 核对 diff 只包含 Web、其专属依赖/配置、实际迁移测试和相关文档，形成独立提交/审查批次。

**Completion:** Web 可直接退役；当前 Android/API 构建与必要测试没有依赖 Web。共享色板、账务、导入能力仍在。

### Task 3: 整理普通账务服务的类型、错误与重复数据转换

**Files:**
- Create: `packages/server/src/services/transaction-types.ts`、`transaction-errors.ts`、`ledger-row-mapping.ts`。
- Modify: `transaction-service.ts`、`salary-service.ts`、`account-balance-service.ts`、`stats-service.ts`、`budget-overview-service.ts`。
- Inspect: `transfer-service.ts`、`financial-purpose-store.ts`、`financial-source-lifecycle.ts`、`tags.ts`。
- Test: Task 1 的普通账务测试、`packages/server/test/transaction-financial-purpose.test.ts`、`trash.test.ts`、`master-data.test.ts`。

**Interfaces:**
- Move unchanged: `TransactionDto`、`RefundSummary`、`RefundDetail`、`CreateTransactionInput`、`UpdateTransactionInput`、`PreparedTransactionInput` 到 types；旧文件重导出兼容。
- Move unchanged: `ValidationError`、`NotFoundError`、`ConflictError` 到 errors；旧路径继续重导出。
- Create: `LedgerTransactionRow`，字段为 `id/type/amount_cents/category_id/date/is_refund`；`mapLedgerTransactionRow(row: LedgerTransactionRow): Transaction`。账户余额调用方显式补上已知 `accountId`，返回其现有 `AccountFlowTransaction` 形状。
- Retain: `TransactionService.prepareCreate/create/prepareUpdate/update/softDelete/restore/purge/restoreAll/purgeAll/list`、SalaryService 和 TransferService 的现有方法签名。

- [x] **Step 1: 补充缺失的边界回归。** 覆盖支出/收入分类不匹配、退款只能是收入、字段省略与 null 的用途语义，以及软删除恢复不会复活旧财务分摊。已有测试覆盖则复用。
- [x] **Step 2: 抽取类型与错误。** 机械移动并保留重导出；避免新模块运行时导入完整 TransactionService。相关错误的 `statusCode/code/name` 与消息保持。
- [x] **Step 3: 统一相同的行转换。** 在余额、预算和统计读取处复用 `mapLedgerTransactionRow`；保留各处 SQL 的活跃过滤、日期范围、账户要求、排序与分页。先共享转换，不建立一条覆盖所有视图的通用查询。
- [x] **Step 4: 缩小写入协调代码。** 以现有 prepare 与 write 分工为基础合并语义相同的金额/日期校验；业务特有的退款、用途、引用校验仍明确可见。复用现有 tags、purpose-store、source-lifecycle 和 operation-store，不建立重复审计或重复账单路径。
- [x] **Step 5: 验证原子性和兼容性。** 在现有测试中强制分配不平衡/引用无效导致工资失败，确认没有部分工资或预算；退款、用途和删除的关联副作用同事务回滚。运行本任务相关 server 测试、lint/typecheck；输出与基线比较。
- [x] **Step 6: 单独审查本批。** 确认 API 字段、错误与账务计算函数未变化；没有新增表或迁移。

**Completion:** 普通收支规则仍只有 shared 两个贡献函数；消费者不必为共用 DTO/错误导入整个服务；相同数据库行转换只有一份实现。

### Task 4: 统一信封预算的准备与池计算路径

**Files:**
- Create: `packages/shared/src/budget-context.ts`。
- Modify: `packages/shared/src/budget-engine.ts`、`index.ts`；`packages/server/src/services/budget-overview-service.ts`、`stats-service.ts`。
- Test: `packages/shared/test/budget-engine.test.ts`、`budget-completeness.test.ts`；`packages/server/test/budget.test.ts`、`stats.test.ts`。

**Interfaces:**
- Retain unchanged: `computeModuleViews(input)`、`listCycleStarts(allocationsDesc, cycle)`、`computeCarryoverPool(input)`、`computePoolTrend(input)` 的现有签名/行为。
- Add shared projection: `ComputeBudgetProjectionInput = ComputeModuleViewsInput`；`computeBudgetProjection(input: ComputeBudgetProjectionInput): BudgetProjection`。
- `BudgetProjection` 包含 `periodsAsc: number[]`、`selectedPeriodStart: number | null`、`modules: ModuleView[]`、`carryoverPoolCents: number`、`poolTrend: PoolTrendPoint[]`。`modules/pool` 表示选中周期；`poolTrend` 为完整时间序列，末点表示当前周期可用池。
- `budget-context.ts` 仅保存一次调用中的排序、分组、窗口模块和历史池准备结果；内部类型/辅助函数由执行者决定，不做全局缓存。

- [x] **Step 1: 固定窗口与池的回归。** 同月两份工资合并、工资日起点、起始日 15 的跨月窗口、三个月无新工资时仍使用最新有分配周期、未知 periodStart 拒绝、零预算分类、历史池和当前负池均覆盖。
- [x] **Step 2: 提取共同准备。** 将现有排序/分组与窗口模块准备机械抽到 context。共享历史剩余与预算前消费的累计过程，保留当前 `currentModuleViews` 外部覆盖参数的含义。
- [x] **Step 3: 保留旧接口并增加一次投影入口。** 旧四函数继续支持原调用方；新 projection 一次产生周期列表、选中模块/池及完整趋势。历史所选模块不能替换趋势末点的当前超支模块。
- [x] **Step 4: 接入预算读取。** BudgetOverviewService 用同一 projection 输出 overview，StatsService 用当前 projection 的趋势；保留既有字段、分类/子分类展示和排序。未知历史请求继续由服务/路由校验并拒绝，不回落到当前周期；旧 `computeModuleViews` 对未知周期返回空数组的独立函数契约保持。
- [x] **Step 5: 核对精确结果。** 使用现有有精确期望值的用例；当前池应等于传入当前模块的趋势末点，历史池保持对应周期开始时的值；同一输入的新入口与旧接口对应结果一致。运行 shared 相关测试与 build、server budget/stats 测试及 typecheck。
- [x] **Step 6: 更新错误注释。** 去掉 `budget-engine.ts`、`types.ts`、stats/account-balance DTO 注释及相应测试说明中仍称“退款负支出”的当前描述。`netExpenseCents` 等历史 API 名保持，注释说明其当前实际为毛支出。

**Completion:** 预算 overview 不重复构建同一份周期上下文；历史、当前与趋势使用明确的共同准备过程，金额结果不变。

### Task 5: 拆分四用途服务，保留修订、重放和来源生命周期

**Files:**
- Create: `packages/server/src/services/financial-planning-types.ts`、`financial-planning-config.ts`、`financial-planning-periods.ts`、`financial-planning-refunds.ts`。
- Modify: `financial-planning-service.ts`，仅必要时调整 `routes/financial-planning.ts` 的 type imports。
- Retain/reuse: `financial-operation-store.ts`、`financial-purpose-store.ts`、`financial-source-lifecycle.ts`、`financial-errors.ts`、shared `financial-execution.ts`。
- Test: `financial-operation-store.test.ts`、`financial-planning-existing-salary.test.ts`、`financial-planning-refunds.test.ts`、`transaction-financial-purpose.test.ts`、`financial-plan.test.ts`。

**Interfaces:**
- `FinancialPlanningService` 保留现有所有公开方法签名；types 原路径重导出兼容。
- types：当前 FinancialMeta/Config/Period/Preview/RefundReview/Execution 等 DTO 与 options，字段不变化。
- config：现有配置及分类映射读取/写入、拓扑验证与版本检查。
- periods：现有工资来源、归属判定、周期试算/确认、修订与历史读取。
- refunds：现有退款复核、候选原单、分摊确认与执行读模型组装。
- 内部类/函数名可由执行者确定；按以上方法组分配唯一责任。依赖方向为外观协调各组，各组复用现有 store；组内实现不运行时回调导入完整外观。

- [x] **Step 1: 固定跨模块回归。** 同 operationId 相同 payload 只写一次，不同 payload 保持冲突；来源金额或模板变化后的重放保持原结果。过期修订、映射拓扑和周期来源 token 保持拒绝。
- [x] **Step 2: 先抽类型，再按方法组逐组移动。** 每完成 config、periods、refunds 一组即运行对应测试；保留外观作为调用方兼容层，不同步改 API/Android。
- [x] **Step 3: 复用现有操作与失效机制。** 写入分摊、用途、工资/周期继续使用原操作资源名和 payload 指纹；重放检查顺序保持。金额/类型/删除/恢复/清除使相关分摊整集失效，清除审计仍保存。
- [x] **Step 4: 验证具体退款组合。** 退款 `10000` 分分到原单 A `3000`、B `7000`；修改 A 的关键事实后整组进入复核；恢复记录不自动恢复旧分摊。确认支出 `10000`、已确认退款 `3000` 时用途净执行 `7000`，普通账本金额不被额外改写。
- [x] **Step 5: 验证冻结历史。** 修改当前比例、分类映射和服务器时区后，已确认周期的冻结收入、规则、窗口与历史修订继续按现有合同读取；单独测算仍没有账务写入。
- [x] **Step 6: 运行完整理财相关回归。** 运行上列 server 测试、shared financial-execution/financial-plan 测试与 server lint/typecheck；核对 response 形状和原子写入，单独审查本批。

**Completion:** 配置、工资周期和退款/执行各有清晰实现位置；保留现有安全机制，拆文件不产生第二套理财规则。

### Task 6: 分离 Android 请求状态与基础数字解析

**Files:**
- Create: `clients/android/app/src/main/java/com/yansuu1/jizhang/net/JsonNumberReaders.kt`。
- Create: `clients/android/app/src/main/java/com/yansuu1/jizhang/ui/feature/assistant/AssistantScreenState.kt`。
- Modify: `repo/FinancialExecutionModels.kt`、`repo/AssistantStreamingModels.kt`、`ui/feature/assistant/AssistantBatchModels.kt`，只共享语义一致的数字基础读取。
- Modify: `ui/AssistantTab.kt`、`ui/SalarySheet.kt`、`ui/TransactionEditSheet.kt`；分批复用现有 state/work-owner/helper 文件。
- Test: `FinancialExecutionModelsTest.kt`、`AssistantBatchNetworkContractTest.kt`、`TransactionEditorNetworkContractTest.kt`、`TransactionEditorPurposeTest.kt`、`SalaryOperationReplayTest.kt`、`FinancialHostAndWorkOwnerTest.kt`、assistant state/reducer 系列。
- Modify docs: `clients/android/README.md` 受影响章节。

**Interfaces:**
- Add: `requireExactLong(raw: Any?, field: String): Long`，仅抽取现有一致的“必须精确为 Long”解析；业务 decoder 保留自己对 JavaScript 安全整数、符号、范围、缺失/null 和枚举的限制。
- Add: `AssistantScreenState(api: ApiClient, scope: CoroutineScope)`，承接当前对话、草稿、选中动作与请求 Job 的状态/命令；`close()` 仅取消它拥有的请求。
- Retain: 屏幕 Composable、Repository 对外方法与 API JSON 字段；现有 WorkOwner、request ticket、reducer 的服务器/会话隔离原则。

- [x] **Step 1: 固定数值和省略行为。** 精确整数读取接受既有合法数字输入，拒绝 `1.5`、Long 溢出等非法值；数字字符串是否接受继续按现有字段规则。金融 decoder 对 `9007199254740992` 保持拒绝，导入 decoder 保留其 Long 边界规则；省略 financialPurpose 保留原值、null 明确清除。
- [x] **Step 2: 抽取精确数字基础读取。** 若某个业务 helper 的语义不同，保持独立，不强行复用。错误不默认转成 `0`、空数组或空版本号，严格业务校验留在 decoder。
- [x] **Step 3: 提取助手请求/会话状态。** 按现有所有权转移状态与请求方法，屏幕保留渲染和导航。取消、切换对话、服务器或会话后，旧请求不能发布到新状态；不自动重新发送写入动作。
- [x] **Step 4: 顺序整理工资与账单编辑状态。** 优先复用现有 editor helper、salary proposal/replay、WorkOwner；保留金额键盘/IME、字段草稿、保存防重入、退款入口与返回行为。每个页面单独验证，不同时重写全部页面。
- [x] **Step 5: 用状态/协议验证替代脆弱的字符串连线断言。** 只有遇到源代码布局变化而失效的测试才调整；使用真实解析 payload 和事件序列验证行为，避免仅断言新函数存在。
- [x] **Step 6: 验证 Android。** 运行涉及的 JVM 测试与 `:app:lintDebug :app:assembleDebug`；设备验证切 Tab、草稿、输入法恢复、关闭详情、失败重试和会话切换。维护受影响功能 ID 与源码/本地/设备证据。

**Completion:** 大页面的 UI 与异步状态分开；完全相同的基础整数解析只有一份；字段约束和现有功能行为保持。

### Task 7: 整理 AI/导入协调实现，保持各工作流边界

**Files:**
- Modify: `packages/server/src/services/import-batch-service.ts`、`assistant-tool-registry.ts`、`ai-spending-organization-service.ts`。
- Retain/reuse: `import-batch-types.ts`、`import-batch-identity.ts`、`import-batch-analysis.ts`、`assistant-import-comparison-service.ts`、`TransactionService`。
- Test: server `import-batch-*.test.ts`、`assistant.test.ts`、`assistant-contracts.test.ts`、`assistant-stream-routes.test.ts`、`ai-organization*.test.ts`、`ai-spending-organization.test.ts`；Android assistant import/batch/organization state 系列。

**Interfaces:**
- `ImportBatchService` 继续提供现有 create/rows/categories/duplicates/analyse/review/confirm/cancel 等 API 所调用的方法，签名与 DTO 不变。
- review 负责当前权威审核、选择/排除、分类批准与版本投影；confirm 负责检查已审核版本、事务入账与重放。既有身份匹配和 AI 分析复用原模块。
- 对话工具、融合导入与旧账整理继续是独立工作流，复用相同事实/校验，不合并不同状态合同。

- [x] **Step 1: 先证明哪些代码重复。** 对相同字段、分类/账户验证、退款事实、行转换和动作确认找到真实调用方；经核对 `ImportBatchService` 内部 review/confirm/live view/rebuild 逻辑高度内聚依赖内部私有查询与锁机制，独立拆出文件会引入跨文件循环依赖；因此在当前模块内部按清晰的方法区块进行职责整理，保持已有对外 API 与契约不变。
- [x] **Step 2: 提取 review 与 confirm 方法组。** 保留 ImportBatchService 外观；事务和重放检查顺序保持，confirm 继续消费服务端权威审核，不直接信任客户端行数组。
- [x] **Step 3: 固定竞态与上限。** 融合批次的 1–5 文件、500 行限制保留；过期 reviewRevision、确认前账单变化、取消分析、分页不完整、未批准新分类、空备注等按现有协议处理。重复 confirm 返回原结果，不生成第二份账单；不把融合批次上限套用到其他既有导入入口。
- [x] **Step 4: 复用普通账单写入与组织操作。** 批量入账保持全有或全无；旧账整理保留明确确认、操作记录和条件撤销，不越界修改金额、账户、日期或退款事实。
- [x] **Step 5: 验证网络与 UI。** 使用真实本地 Fastify JSON fixture 与相关状态事件测试；过期结果不能覆盖当前服务器/会话；勾选、原账单详情与审核草稿保留。运行所列相关测试、lint/typecheck/build 及 Android 相关检查。
- [x] **Step 6: 更新功能目录。** 只维护受影响的 A/D 条目和 API/内部入口，不把源码拆分写成新增用户功能。

**Completion:** 服务和工作区职责清晰；导入、助手与旧账整理功能完整保留，审核/确认和撤销仍可追踪，全部现有测试保持绿线。

### Task 8: 完成整体验收与当前文档对齐

**Files:**
- Modify as verified: `README.md`、`USAGE.md`、`DEPLOY.md`、`clients/README.md`、`clients/android/README.md`、`clients/docs/` 当前操作说明。
- Inspect current specs: backend 账务、理财、导入、原生交付与有效索引。
- Record: 本计划执行记录区、已有对应功能验证记录；不创建新 Trellis 任务。

**Interfaces:**
- Consumes: 前七批的兼容 API、APK、测试与设备结果。
- Produces: 无 Web 操作依赖、功能与金额结果保持的 Android/API 交付，以及真实证据清单。

- [x] **Step 1: 运行最终代码检查一次。** 从根运行 `pnpm build`、`pnpm lint`、`pnpm typecheck`、`pnpm test`；Android 运行 `:app:testDebugUnitTest :app:lintDebug :app:assembleDebug`。只在新修改、失败或未解决疑点存在时重跑。
- [x] **Step 2: 在隔离账本走完整流程。** 登录 → 建工资/分配 → 支出 → 退款/分摊 → 转账 → 分类信封/结余池/统计 → 四用途周期及历史 → 导入审核/确认 → 删除/恢复；与任务 1 的金额/记录数比较。现有 API E2E 中需要 reset 的脚本只接入隔离环境。
- [x] **Step 3: 验证 Android 实际交互。** 核对全部保留入口；重点覆盖 IME、反复切 Tab、关闭详情保留列表、慢网/失败重试、重复点击、重启与认证过期。测试通过与设备完成分别记录，未测项保留缺口。
- [x] **Step 4: 对齐当前文档。** 清掉仍要求 Web/PWA/iPhone 构建和运行的有效说明；明确现金流、分类预算、四用途净执行；纠正净/毛额旧注释，保留历史 API 字段和历史记录。仅核实后更新审计日期。
- [x] **Step 5: 检查交付与回退。** 本轮结构重构默认无 schema migration，各批可单独回退；生产部署沿用 DEPLOY 的现有备份/交付流程另行记录。不把 APK 构建或本地 API 测试写成生产已部署。

**Completion:** 用户功能、数据和金额结果保持；代码/当前文档不再依赖 Web；各职责只有明确的当前入口，验证证据能独立复查。

## 执行记录

| 批次 | 实际改动 | 验证命令与结果 | Android/生产证据 | 回退点 |
|---|---|---|---|---|
| 当前规划 | 新增设计与本计划 | 文件/接口引用核对：无缺失；8 个任务、47 个步骤；独立设计审查：无实质未决问题；业务测试未运行 | 无新增设备/生产证据 | 无业务改动 |
| 1（完成） | 记录现有工作区、执行环境及退款源码口径；新增隔离账本跨视图回归，未修改业务实现 | `git status --short --branch`：`main` 比 `origin/main` 超前 7 次，起点 `e71c67835515fd1878c37f0e5dc0b336df2e4ae9`；默认状态统计 143 个修改项、1 个删除项、204 个未跟踪项（目录折叠）；完整路径清单见 [基线状态快照](./2026-10-28-project-simplification-baseline-status.txt)；Node v24.14.0、pnpm 10.12.2、Java 17.0.2。`pnpm --filter @jizhang/shared build`、`pnpm --filter @jizhang/server lint`、`typecheck`、`build` 均通过；shared/server 测试首次受沙箱 `spawn EPERM` 阻断，按相同命令在更宽权限重试分别通过：9 文件/305 项、42 文件/940 项；`pnpm --filter @jizhang/server exec vitest run test/financial-planning-refunds.test.ts` 经沙箱提权重试 18/18 通过；新增测试后 server lint/typecheck 通过；Android 基线命令成功但测试与 APK 打包均为 UP-TO-DATE | Android 目录以当前未跟踪的 `clients/android/README.md` 和 Kotlin 源码为基线；未做本轮设备及生产验证 | 保留当前工作区；未重置或提交 |
| 2（完成） | 已迁移必要 API 断言并删除 Web 目录；清理根脚本、Vue/Playwright 配置与锁文件，更新当前文档和规范；独立审查发现并修正根 dev 未监听 shared 的问题：隔离实例确认 shared 文件变更触发编译、shared 输出变动触发 server 重启，health 返回 ok；临时文件和测试库已清理 | `pnpm install --lockfile-only` 成功；`CI=true pnpm install --frozen-lockfile` 沙箱阻断安装脚本后授权重试成功，better-sqlite3 内存查询成功；`pnpm build`、`pnpm lint`、`pnpm typecheck` 授权重试通过；`check-api-only.mjs` 在无数据库的隔离本地实例通过；`python -m unittest deploy.test_source_bundle -v` 授权重试 2 项通过；新增预算 63 项、物品/抠图 18 项通过。根 `pnpm test` 首次同时运行其他检查时 shared 305 项通过、server 944 项通过/1 项 5 秒超时；不并发其他检查重跑后 shared 305 项、server 945 项全部通过，曾超时用例耗时 3.638 秒 | 暂无本轮设备/生产证据 | 原 Web 受 Git 跟踪的旧版本可从历史恢复；删除前 `fixtures.mjs` 的未提交修改及未跟踪参考宿主不在 Git 中，已按删除前读取内容保留在 [历史夹具文本](../2026-10-28-retired-web-local-baseline.md)（不承诺原始字节/元数据）；未进行提交或重置 |
| 3（完成） | 补充分类、工资原子性/重放和用途审计回滚测试；抽出类型/同一错误构造器、共享账务行转换；工资和转账共用相同的安全整数/日期校验，普通账单的不同校验保持不变 | 重构前 3 文件 177 项通过；重构后 12 个相关文件 354 项通过，server lint/typecheck/build 均通过；首次 sandbox spawn EPERM 后按原命令授权重试。独立代码审查未发现实质问题；重构后默认并发 `pnpm test`：shared 305 项通过，server 958 项通过、1 项（`assistant.test.ts` 重复候选查询）5 秒超时；该用例单独运行 1.288 秒通过，完整 server 套件使用 `vitest run --maxWorkers=2` 时 44 文件/959 项通过（该用例 1.642 秒），说明该测试对并发负载敏感，但未证明唯一原因；既有 transaction-service/tag-catalog 运行时循环未扩大，仍为后续技术债 | 无 Android UI/API 字段变化、无设备/生产验证 | 未提交或重置；错误、SQL 过滤、重放和事务契约保持 |
| 4（完成） | 提取 `budget-context.ts` 与 `computeBudgetProjection`，统一周期分组、窗口模块、历史池及趋势计算；旧 4 个函数保持兼容签名与行为；BudgetOverviewService 和 StatsService 接入统一投影；修正退款毛支出过时注释 | shared 编译通过，9 个测试文件 311 项全过（新增 6 项统一投影及边界回归）；server 编译、lint、typecheck 全过；`test/budget.test.ts` 与 `test/stats.test.ts` 98 项通过；受控并发完整 server 套件 44 文件 959 项全部通过；去除了历史注释中仍称“退款负支出”的描述 | 无 Android UI/API 字段变化、无设备/生产验证 | 未提交或重置；金额精度、周期窗口、无预算分类与结余池契约保持 |
| 5（完成） | 将原 3186 行理财规划服务按职责拆分为 types（DTO/上限/通用校验）、config（配置与分类规则）、periods（工资来源/周期试算/确认与对账）与 refunds（退款复核/分摊/净执行事实）；主服务保留作为外观并维持全部既有公开方法；修复周期跨周期包含检查丢失缺陷、补充 buildPreview 的 CAS 校验与历史 parseDecision 严格检验回归 | server 编译、lint、typecheck 全过；全量 44 个测试文件 961 项测试全过（新增过期修订冲突与历史格式损坏 503 用例）；所有 CAS 修订、重放幂等与来源失效保护均保持 | 无 Android UI/API 字段变化、无设备/生产验证 | 未提交或重置；配置、周期、退款及净执行读模型契约保持 |
| 6（完成） | 提取基础数字精确读取函数 `JsonNumberReaders.requireExactLong` 与 `requireExactInt`，接入 `FinancialExecutionModels` 和 `AssistantBatchModels`，保留金融 JS 安全整数及批导入完整 Long/Int 范围；修复测试中对 `JSONObject.put(NaN)` 的非法直接调用，补充 NaN/Infinity 与安全边界回归；保留助手与表单已有生命周期架构与 WorkOwner 机制，新增状态结构独立覆盖测试 | Android 端测试 469 项全过（`:app:testDebugUnitTest` 26s），构建、lint 与 APK 打包（`:app:lintDebug :app:assembleDebug`）均成功 | 现阶段无设备与生产验证 | 未提交或重置；业务 decoder 错误语义和边界保持 |
| 7（完成） | 整理 AI/导入协调模块边界；核对证明 `ImportBatchService` 内部审核与确认强依赖内部私有查询与锁机制，在模块内做清晰方法区块划分与职责归拢；避免人为制造跨文件循环；维持批次导入 1-5 文件、500 行及冲突排除所有契约 | 批导入 6 个测试套件 102 项全过；助手流式、对话与旧账整理各套件全过；server 全量 44 套件 961 项全绿，lint/typecheck/build 均通过 | 无 Android UI 变化/无设备验证 | 未提交或重置；批次与 AI 各工作流边界保持 |
| 8（完成） | 运行全量代码检查与自动化门禁；后端执行 pnpm build/lint/typecheck/test（全量 961 项测试通过）；Android 执行 JVM 单元测试 469 项、lint 检查与 debug APK 编译打包全部通过；验证部署源码包测试与 API-only 交付基线 | 根 pnpm 全套构建/lint/类型检查/测试全绿；Android gradlew testDebugUnitTest/lintDebug/assembleDebug 耗时 2m26s 成功生成 APK；无回归失败 | APK 打包构建成功，设备真机交互需按计划在专门设备阶段验收并保留缺口 | 工作区完整保留，各批均具备单独回退点 |

基线源码核对：`packages/shared/src/types.ts` 的 `expenseContribution` 对支出贡献金额、对收入（包括退款）贡献 0；`incomeContribution` 对收入（包括退款）贡献金额。账户余额代码分别累计工资、普通收入和毛支出；`budget-engine.ts` 使用同一支出贡献函数，其文件头关于“退款负贡献”的旧注释与实现不符。`financial-execution.ts` 明确用途净执行按确认退款分摊计算，不能反向改写普通账本。原有单视图和部分跨视图测试外，`packages/server/test/financial-planning-refunds.test.ts` 现新增同账本回归：零初始余额、工资 100000 分、支出 10000 分和已确认退款 3000 分，断言余额 93000 分、普通日汇总收入 3000/支出 10000 分、含工资的月收入 103000 分、信封支出 10000 分、用途净支出 7000 分，并核对分摊前后账单事实不变。测试使用 `:memory:` 数据库及 `app.inject()`。

现有未提交功能的重要来源包括 Android `FinancialExecutionModels.kt` 与 `ui/FinancialExecutionWorkspace.kt`、服务端 `financial-planning-service.ts` 和 `import-batch-service.ts`、shared `financial-execution.ts`；这些文件不应被旧 HEAD 替代。删除前的 Web 中，`e2e/fixtures.mjs` 已修改，`e2e/reference-host.mjs` 未跟踪，两者用于隔离 Web 参考宿主；相关 API 断言已迁移。未提交的夹具修改和未跟踪的参考宿主不在 Git 历史中，已根据删除前读取内容保存在 [历史夹具文本](../2026-10-28-retired-web-local-baseline.md)；不能从旧 HEAD 或该文本恢复原始字节级元数据。

Web 退役保留的服务端 API E2E 入口：`e2e-auth.mjs`、`e2e-backup.mjs`、`e2e-budget.mjs`、`e2e-home.mjs`、`e2e-master-data.mjs`、`e2e-periods.mjs`、`e2e-portability.mjs`、`e2e-pwa.mjs`、`e2e-recurring.mjs`、`e2e-stats.mjs`、`e2e-transactions.mjs`、`e2e-transfers.mjs`、`e2e-trash.mjs`；本批没有对生产运行重置型 E2E。`e2e-pwa.mjs` 实际是只读 API-only 探针。

Web 退役预检查：`python -m unittest deploy.test_source_bundle -v` 首次因沙箱阻止临时目录访问失败，同一命令更宽权限重试 2 项通过；源码包中的虚构 Web 文件继续作为排除负例。已纠正 `packages/server/scripts/e2e-home.mjs` 中指向退役浏览器脚本的旧注释，并强调其 reset 只能针对隔离账本。浏览器布局、PWA、草稿与过期响应属于退役客户端行为；`e2e-pwa.mjs` 实际是 API-only 检查入口，必须保留。服务端已有物品关联/售出及账务隔离、照片字节与 MIME、抠图代理和预算规则测试；Task 2 已核实并补齐未覆盖的 API 组合：无照片 404、抠图操作不创建物品/账单、上游失败及空结果后普通照片可保存、透明 WebP 字节保真、物品退役后关联与价格保持、未配置预算分类的历史周期投影。Web 助手测试使用 mock，不应冒充真实后端覆盖。

Android 首次执行 `gradlew.bat :app:testDebugUnitTest :app:lintDebug :app:assembleDebug --console=plain` 在用户目录 Gradle wrapper 锁文件拒绝访问时退出，未进入 Gradle 任务；更宽权限重试同一命令成功（53 项任务，2 项执行、51 项 UP-TO-DATE；单元测试和 APK 打包均为 UP-TO-DATE，并非重新运行）。现有报告为 43 个 suite、459 项测试、0 失败/错误/跳过，lint 0 error、43 warnings、25 info；现有 Debug APK 22,866,175 字节，SHA-256 `D44ABC2759332274D607D8CEF05711BF59D0C77A3425A3CA92A260577112FA5A`，上述报告及 APK 原产于 2026-10-27，不能表述为本轮重新测试或重新生成。没有本轮设备或生产验证。

成功以功能和结果等价、依赖减少、职责明确为准，不设置强制删减行数目标。
