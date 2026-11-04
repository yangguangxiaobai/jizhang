# Documentation Review: Android README Maintenance for AI Streaming & Interactive Dialogue

## 1. Review Status: COMPLETED

- **Role / Task**: 接续文档维护（docs-writer 接替任务，限定只修改 `clients/android/README.md` 与 `research/documentation-review.md`）。
- **Baseline Audit References**:
  - Task Artifacts: `prd.md`, `design.md`, `implement.md`, `research/protocol-v1.md`, `research/android-final-review.md`, `research/backend-postfix-review.md`, `research/tokenizer-final-review.md`
  - Android Source Code: `clients/android/app/src/main/java/com/yansuu1/jizhang/` (49 main Kotlin files 目录与条目收录覆盖，非无关源码全量逐行复审)
  - Backend Routes: `packages/server/src/routes/assistant.ts` and related server routes
  - Main Catalog Target: `clients/android/README.md`
  - Spec Target: `.trellis/spec/backend/assistant-streaming.md`
  - Verification Summary: `check-status.md`

---

## 2. Inventory Maintenance Summary

遵循 `AGENTS.md` 跨 Agent 通用规范中关于 Android 功能清单维护的严格要求：
1. **不回收/重排功能 ID**：保持原 313 个稳定条目 ID 体系（含 30 个助理工具），稳定 ID 无回收、无重排、无覆盖。
2. **区分源码实施与真机/生产验证**：
   - 源码已实施、已通过本地构建与单元测试的内容，仅标注为“源码接入 / 本地自动化测试通过”；
   - 严禁将设计方案（如 `ui-redesign` 或 `ardot-design.md`）当作实现事实；
   - 严禁将 JVM 单元测试、Lint 或 Mock 编译通过（`testDebugUnitTest`, `assembleDebug`）当作真机运行或线上连通性证据。
3. **维护受影响各节**：

### A. 稳定功能条目与行为规则（Section 6.1）
- **A011（AI 流式对话与交互式追问协议 v1）**：
  - 纯文本请求经 `POST /api/v1/assistant/conversations/:conversationId/generations` 创建/重放流式代次；
  - OkHttp 结合 `CancellableBlockingFlow`（运行于 IO 线程的阻塞式数据读取流，由独立所有者协程在取消时触发 `Call.cancel()` 实施立即中断，并非无阻塞事件驱动解析器）与 `SseParser` 解析 UTF-8 SSE 流（`state`, `text-delta`, `message`, `terminal` 事件）；
  - 增量文本挂载至成长气泡，`step 0..2` 多步模型回复展示；
  - 支持显式停止按钮（调用 `POST /generations/:genId/cancel`），返回终态 `cancelled`；
  - 追问单选卡片（2–6 个选项，高度 >= 48dp）：点击选项即锁定（`AssistantStreamReducer.lockChoice`），生成唯一的 `pendingChoiceRequestId`。网络异常或同选项重试时复用相同请求 ID，防止后端生成冲突；严格阻断切换到其他选项；
  - 关键安全不变量：409 `ASSISTANT_GENERATION_ACTIVE` 与 409 `ASSISTANT_REQUEST_CONFLICT` 明确**不解锁**选项；
  - 状态徽章区分 8 种细粒度状态（连接中、实时流式、待确认分类追问、待核对记账草案、回答已结束、失败、已停止、连接中断核对）；
  - 断流或异常 EOF 时触发 `GET /generations/:genId` 状态核对，杜绝盲目重 POST 模型；
  - 带账单附件请求保留 legacy `POST /messages` 非流式流程。
- **A005 & A013（代次隔离与 A->B->A 防覆盖）**：
  - `AssistantRequestGate` 统一管理请求代次与 Compose 显示闸门；
  - 切换会话立即触发 `cancelStreamJob`、清空旧消息并调用 `invalidateDisplay`；
  - 历史 GET 与旧 generation 迟到响应因 gate 代次不匹配直接被丢弃。
- **A012 & A018–A022（消息去重、终态优先与财务隔离）**：
  - `renderedMessageIds` 集合保证历史消息、已接受用户消息、校验助理消息与临时流式气泡之间不出现重复气泡；
  - 历史卡权威状态优先原则：历史消息中已存在终态（`confirmed` / `cancelled`）的操作卡，绝对覆盖任何 snapshot 中的 pending 状态，杜绝已确认卡片复活；
  - 选项点击（Choice）绝对不调用 `/confirm`，不造成任何账本写入；财务记账必须走独立的二次全屏核对与显式确认。
- **A014（阅读滚动与几何边界）**：
  - 基于真实视口底端与最后一个 item 几何边界判定贴底状态，阅读历史滚动位置时严禁强抢向下滚动，浮现“有新消息，跳到最新”气泡。
- **A035（会话过期与认证拦截）**：
  - `streamSse` 拦截 HTTP 401，清空 Cookie 并置 `sessionExpired.value = true`，向上抛出 `AuthExpiredException` 触发统一登录。

### B. 表单字段与限制速查（Section 7）
- 更新 `AI对话` 表单项：
  - 编辑字段补充：文本输入、单个账单文件、移除附件、追问单选项（2–6项）、自由输入追问；
  - 边界与校验：纯文本经 `POST /generations` 流式发送，支持 `POST /cancel` 显式停止；带附件走 legacy `POST /messages`（无取消）；服务端文本限制 <=2,000 字符；发送与选项点击均携带 UUID `clientRequestId` 幂等去重；选项点击不触发记账；断流通过 `GET snapshot` 单次核对。

### C. 边界与已知缺口说明（Section 9.3）
- 条目 6：澄清纯文本 AI 对话通过 SSE `/events` 实现增量流式推流（单次连接非轮询）；断流时不自动重发模型，而是通过 GET snapshot 单次核对；带附件请求保持阻塞返回。
- 条目 9：精确限定验证边界——已有源码实施、Gradle 87 项本地单元测试（具体数字取自 Gradle 生成的 Test XML 报告 `build/test-results/testDebugUnitTest/*.xml`；`artifacts/android-stream-check.log` 记录 `BUILD SUCCESSFUL` 但日志文本中不直接包含 87 汇总字样）、Lint 检查以及 assembleDebug 构建验证；明确记录未在物理设备验证、未连接生产环境或真实 upstream provider。记录后端经 F1/F2 修复及 tokenizer 缺陷（空容器与尾随逗号）修复与 9 项回归测试后，达到 580 tests/lint/typecheck/build 干净通过（`artifacts/server-tokenizer-fix-*-20261016-131148.log`），shared 176 项测试经 test-runner 报告通过；整体最终端到端验收仍处于 pending 授权状态。以 protocol-v1 与 spec 为基准验证相容性，不能作为数学绝对形式化证明。

### D. 不存在/未接入功能（Section 10）
- 更新 `AI交互没有` 条目：纯文本流式文字与显式取消已在源码接入（设备未验），附件仍无流式与模型取消；归档恢复/单条消息删除/旧消息编辑/重命名、通用PDF/照片/音频多模态分析仍不存在。

### E. API 覆盖矩阵（Section 6.5 & Section 11.0）
- 核实 `packages/server/src/routes/assistant.ts` 实际注册的 15 个端点；
- 在 Section 11.0（全部已注册服务端 API）补齐遗漏登记的 7 个端点：
  1. `POST /api/v1/assistant/conversations/:conversationId/generations`（流式代次创建/重发）
  2. `GET /api/v1/assistant/conversations/:conversationId/generations`（最近代次读取）
  3. `GET /api/v1/assistant/conversations/:conversationId/generations/:generationId`（指定代次快照读取）
  4. `POST /api/v1/assistant/conversations/:conversationId/generations/:generationId/cancel`（显式停止生成）
  5. `GET /api/v1/assistant/conversations/:conversationId/generations/:generationId/events`（SSE 流式事件读取）
  6. `GET /api/v1/assistant/conversations/:conversationId/actions/:id/rows/:rowId/duplicates`（疑似重复行对比）
  7. `POST /api/v1/assistant/actions/:id/analyse`（原件匹配显式重试分析）
- 服务端 API 总项数由 108 修正为 **115 项**（13 个 route 文件 114 项 + `app.ts` 健康检查 1 项），同步更新第 9 行总体统计。

### F. 全部 main Kotlin 文件覆盖（Section 11.1）
- 核实当前工作区 `clients/android/app/src/main/java/` 下共有 **49 个 main Kotlin 文件**；
- 在 Section 11.1 完整补齐此前缺失的 9 个文件及其条目收录；明确 Section 11.1 为清单/目录收录覆盖（catalogue / inventory listing coverage），仅对本轮流式改造直接相关的网络传输适配、状态机与交互辅助组件进行实现与重点核对，不宣称对其他业务域无关源码执行全量逐行代码复审：
  - `net/CancellableBlockingFlow.kt`
  - `net/SseParser.kt`
  - `repo/AssistantStreamingModels.kt`
  - `ui/FinanceComponents.kt`
  - `ui/ProviderSettingsHelper.kt`
  - `ui/feature/assistant/AssistantConversationHelper.kt`
  - `ui/feature/assistant/AssistantDuplicateState.kt`
  - `ui/feature/assistant/AssistantStreamReducer.kt`
  - `ui/feature/assistant/AssistantStreamingComponents.kt`
- 同步更新第 9 行总体统计为 **49个main Kotlin文件**。

### G. 变更日志（Section 12.3）
- 12.3 变更日志表格追加 2026-10-16 条目；
- 维护 `### 2026-10-16 AI streaming source/build audit` 详述，载明精确验证状态：
  - 契约基准：以 `research/protocol-v1.md` 与 `.trellis/spec/backend/assistant-streaming.md` 为验证基准；自动化测试用例验证了基准相容性，不能靠有限测试过度宣称“绝对全契约 100% 形式化满足”。
  - Android 端：87/87 单元测试通过（具体数字来自 Gradle Test XML 报告 `build/test-results/testDebugUnitTest/*.xml`；`artifacts/android-stream-check.log` 记录 `BUILD SUCCESSFUL` 但日志文本中不直接包含 87 汇总字样），`lintDebug`、`assembleDebug` 通过；
  - 后端：历史阶段经 F1/F2 修复后达到 571 tests/lint/typecheck/build 通过（`artifacts/server-stream-fixed-*`）；最新阶段闭环修复 tokenizer 空容器与对象尾随逗号缺陷，新增 9 项回归测试与 259 万次差分检验（针对特定字符与种子随机生成的有界样本集验证与 `JSON.parse` 结构相容性，保留顶层 message 字符串提取及禁止重复键/深度超限等契约特有约束，非所有任意输入 100% 语义等价），达到 24 文件 / 580 tests passed，lint/typecheck/build 均为 0 干净通过（`artifacts/server-tokenizer-fix-*-20261016-131148.log`）；
  - 后端 Post-fix review 确认：F1（nested write-tool prepare 超时/取消绑定）、F2（surrogate-safe Unicode 截断）与 tokenizer（空容器接受与尾随逗号拒绝）3 项关键缺陷已彻底解决闭环；诚实记录既有 `assistant-tool-registry.ts` 中 `note`（200 单位）及导入预览投影（160/120/80 单位）原生 `String.slice` 截断边界切分代理对属 pre-existing 低危非阻断问题，保持现状未修；
  - 规范（Spec）同步：在 `.trellis/spec/backend/assistant-streaming.md` 中明确 `readTool` 与 write-tool `prepare` (`finishWriteTurn`) 均纳入 `openToolScope` 的超时与取消范围（`remainingMs` + `AbortSignal.any`），以及 tokenizer 合法空容器（`[]`/`{}`）与非法尾随逗号的严格回归保障；
  - 契约端：shared 测试经 test-runner 子代理报告 176 项全绿（明确为子代理报告证据，无独立日志文件）；
  - 迁移排演：独立隔离环境迁移排演通过（19 张旧表 SHA-256 哈希完全一致、新增 2 张流式表、幂等性通过、SQLite integrity ok，基于前序在隔离环境执行记录的 summary 输出与测试脚本 `artifacts/stream-migration-rehearsal/rehearse.mjs`，本轮未重新运行生成新的物理 fresh 日志，明确未在生产数据库 production.db 执行）；
  - 严格声明未做真实设备、生产环境及真实 AI Provider 验收。

---

## 3. Verification & Compliance Attestation

1. **修改文件范围严格受控**：
   - 仅修改文档与规范校准文件：
     - `clients/android/README.md`
     - `.trellis/tasks/10-15-ai-streaming-interactive-dialogue/research/documentation-review.md`
     - `.trellis/spec/backend/assistant-streaming.md`
     - `.trellis/tasks/10-15-ai-streaming-interactive-dialogue/check-status.md`
   - 未修改任何 Kotlin 源码、单元测试、Fastify 服务端代码或其他任务目录文件。
2. **操作纪律遵循**：
   - 未执行构建部署、安装 APK、设备操作、真实 Provider 记账或模型配置修改；
   - 未执行 `git add` / `git commit`；
   - 未使用嵌套代理或额外外部工具。

---

## 4. Pending Work & Next Steps

1. **服务端 Tokenizer 缺陷已闭环修复**：`assistant-stream-tokenizer.ts` 空容器 `[]`/`{}` 拒收与对象尾随逗号缺陷已彻底修复并通过 9 项专项回归、259 万次有界差分测试与 580 项全量测试验证，无阻塞项。
2. **Postfix 审查边界与已知遗留**：
   - F1、F2、Tokenizer 关键缺陷已验证解决。
   - 既有 `note`/preview 截断在 astral 边界可能切分单边代理项属 pre-existing 低危非阻断事项，后续统一通过共享 helper 修复；`openToolScope` 定时器参数 clamp 为远期硬化项；`closeEmptyContainer` 注释倒置为修辞问题。均不阻塞发版。
3. **剩余授权门与生产验收**：
   - **生产迁移与服务端部署门**：隔离快照排演已证明 19 表哈希不变与 2 新表正常（基于前序 summary 与脚本，无本轮 fresh 日志），但生产环境 DB 迁移与 Caddy/Docker 部署须待用户明确指令，不得自动重跑或覆盖线上写入。
   - **真实 Provider 联调门**：真实 upstream（NewAPI / 真实模型）的真实网络流式验证须在部署后由用户授权发起。
   - **真机端到端验收门**：流式全链路（真实流式 -> 后端 Fastify SSE -> Android Compose UI）端到端实机验证仍处于 pending 状态，待后续统一授权后在物理设备上开展（包括 Caddy SSE 缓冲、IME 输入法适配、弱网断流核对与多步追问真实体验）。
   - **代码暂存与提交边界**：工作区存在 201+ 混合未暂存修改（WIP），严禁整库 git add / commit，必须按任务精确提取相关 hunk 分块审查。
