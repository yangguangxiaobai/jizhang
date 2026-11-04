# Check Status: AI Streaming & Interactive Dialogue (Task 10-15)

## 1. Executive Summary & Verification Boundary

本文件汇总 `.trellis/tasks/10-15-ai-streaming-interactive-dialogue`（AI 流式对话、可点击追问与明确状态反馈）的全部验证证据与状态边界。

**诚实验证原则与边界声明**：
- **本地代码与测试闭环**：
  - 服务端：全量自动化测试 **24 个测试文件 / 582 项测试全部通过**（在原 580 项基础上增加 2 项连续追问单选与自由文本回归用例），静态检查 `npm run lint` 0 告警，TypeScript `typecheck` 通过，生产编译 `npm run build` 干净退出（`BUILD_EXIT=0`）。
  - 客户端：10 个测试套件 / **91 项 JVM 单元测试全部通过**（在原 89 项实际基线基础上增加 2 项 Triple vs Pair 状态流式回归用例，经 Gradle Test XML 报告严格核实，原 88 记述系历史少计 1 项手民之误），`lintDebug` 0 errors / 9 warnings，Debug APK 顺利编译。本地新版产物 SHA-256 为 `5c004350fefcfe7b3b284f94a5972fba03c6e28ce23f99b5ad8b7176d083896e`，已通过 `adb install -r` 覆盖安装并 pull 回核对字节完全一致（`cmp` IDENTICAL）；前序 4 组专项基线 APK `d2a37b55...` 作为历史版本保留。
- **线上部署与实机验收已执行（已获授权）**：
  - 用户已显式授权并执行了服务端补丁部署：运行镜像 `jizhang:api-chained-choice-20261016T083118Z`（SHA-256 `31bb967e806c556c39c2b257c33c927976d9e568ce2255335b6c9bdb7e9ef11b`），有效密钥哈希完全一致，22/22 数据库表无结构变动。
  - 用户已显式授权并执行了真机端到端验收：在真机 `TNL0220A15028072` (HUAWEI nova 7 Pro / Android 12) 上确认已装 base.apk 字节哈希与最新构建 `5c004350...` 完全相同（且保留前序 `d2a37b55...` 历史记录）。
  - 真机实测通过项：连续追问两跳推进（Choice A -> Question B -> Choice B）、0-delta 占位与首字前 Stop 成功取消（3.5s 静默无迟到卡片）、Provisional 流式正文多帧递增（35 帧真机截帧，~450ms 采样周期）与单气泡接管去重、会话切换 A->B->A 生命周期与数据隔离（B 零污染，切回 A 严格对齐同一代次）、滚动药丸在离底阅读历史时显现及自然到底后自动消失（实测离底 pill 出现，04terminal 留存 pill=1 符合未到底几何，06scroll-bottom 自然触底后 pill=0 自动消失，swipe 发生在终态后数分钟，不称微秒时序；35 帧原生采样 ~400ms，总 event payload 字节非正文字符数）。
- **保留缺陷与验收定性（核心专项通过，整体验收 PARTIAL）**：
  - **上游 Provider 稳定性失败**：跨会话 ABA 补测中因上游首字超过 20s 触发超时中断，未能产出有效答复；首轮 ABA 发生 219 字符 `INVALID_ENVELOPE` 语法解析失败。两项失败事实如实记录，绝不改判通过；但 Provider 专项审查证实 20s 超时严格遵照 saved 全 call 预算（headers + full body），且未捕获 raw payload 不能断言 parser 脆弱性，100% 外部成功率非既定契约；
  - **整体定性**：核心已列功能专项通过；外部 provider 可靠性有两失败记录 / 大字弱网长对话未全测，完整验收仍 **PARTIAL / NOT ACCEPTED**；财务数据全程零变更，零未授权记账。旧 spec 保留失败 partial provisional 机制与不自动 retry，不建议违约静默 fallback 或改 timeout/model。

---

## 2. Categorized Verification Evidence by Source

### A. Source (源码实施与契约对齐)
- **服务端源码** (`packages/server/src/`):
  - `routes/assistant.ts`: 注册流式代次管理全部端点（`POST /generations`, `GET /generations`, `GET /generations/:id`, `POST /generations/:id/cancel`, `GET /generations/:id/events`），保留 legacy 附件端点。
  - `services/assistant-generation-runner.ts`: 实现多步轮询编排、Scoped Context 工具调用、超时与取消中断感知。
  - `services/assistant-generation-service.ts`: 负责代次快照、事件持久化及并发保护。本轮部署补丁（Patch #2 `31bb967e`）在 `create()` 中将新代次自身 answer 列由绑定 source 篡改修复为插入字面量 `NULL`，彻底根除“出生即已答”引发的 409 `ASSISTANT_CHOICE_STALE` 缺陷。
  - `services/assistant-stream-tokenizer.ts`: 纯状态机增量 JSON 解析器，支持安全顶层 message 字符串提取、空容器（`[]`/`{}`）正确识别、严格拒绝对象与数组尾随逗号。
  - `services/assistant-types.ts`: 补充 surrogate-safe Unicode 截断，保证 4,000 字符边界绝不截断代理对。
- **Android 客户端源码** (`clients/android/app/src/main/java/`):
  - 全部 49 个 main Kotlin 文件在客户端功能清单（`clients/android/README.md` §11.1）中完成目录与条目收录覆盖。
  - `net/CancellableBlockingFlow.kt` 与 `net/SseParser.kt`: 实现运行于 IO 线程的阻塞式数据流读取，在取消时触发底层 OkHttp `Call.cancel()` 实施立即中断。
  - `ui/feature/assistant/AssistantStreamReducer.kt`: 状态机处理 8 种细粒度状态徽章，确保消息原子合并与去重。
  - `ui/feature/assistant/AssistantConversationHelper.kt`: 实现选项点击锁定、相同 `clientRequestId` 幂等重试、0-delta 阶段注入占位气泡（`StreamProvisionalMessage`）、几何在底计算 `isGeometryAtBottom`。
  - `ui/AssistantTab.kt` 与 `ui/feature/assistant/AssistantStreamingComponents.kt`: 挂载 >=48dp 的 Stop 按钮与 Progress 进度条，实现 clar 单实例渲染抑制历史重复卡，底部普通文本坚决以 `GenerationInput.Text` 发送实施 supersede。
- **契约规范对齐**:
  - 以 `research/protocol-v1.md` 协议规范与 `.trellis/spec/backend/assistant-streaming.md` 为验证基准，自动化测试与实机验证证实了契约相容性。

### B. Mock / Socket / Unit Tests (自动化单元与契约测试)
- **服务端测试 (Server Unit & Integration Tests)**:
  - **最新全量日志**: `artifacts/server-tokenizer-fix-test-20261016-131148.log` 与 `artifacts/release-postfix-review/backend-focused-tests.log`
  - **结果**: **24 test files / 582 tests passed** (0 failures, 0 skipped, 100% 通过)。
  - **新增连续追问回归测试 (`test/assistant-stream-routes.test.ts`)**:
    - `describe('chained clarification choices')` 包含选项点击链路（A 问 -> A 答 -> B 问 -> B 答）与自由文本 supersede 链路，断言代次自身 `answeredOptionId/answeredAt` 为 null，断言重复重放返回 200 `{created:false}` 且无重复调用，断言全程 `COUNT(*) FROM transactions` 不变。
  - **独立 Probe 探针 (`artifacts/release-postfix-review/independent-chained-choice-probe.mjs`)**:
    - 正对照：I1~I8 全部通过，退出码 0；
    - 负对照（恢复 pre-fix 逻辑）：I1 失败（born answered）且 I2b 报错 `ASSISTANT_CHOICE_STALE` 退出码 1，证明探针具备严格判别力。
- **跨端契约测试 (Shared Contract Tests)**:
  - **结果**: **7 files / 176 tests passed** (0 failures)。
  - **证据**: `artifacts/shared-stream-final-lint.log`、`artifacts/shared-stream-final-typecheck.log`、`artifacts/shared-stream-final-test.log`（EXITCODE=0）。
- **Android 客户端单元测试 (JVM Unit Tests)**:
  - **测试日志与产物**: `clients/android/app/build/test-results/testDebugUnitTest/*.xml`（10 个 testsuite 文件，实际 testcase 节点总和）
  - **结果**: **10 test suites / 91 tests passed** (0 failures, 0 errors, 0 skipped，100% 通过)。
  - **各套件测试数明细**:
    - `AssistantConversationHelperTest` (25 passed，包含 0-delta 占位气泡测试及 2 项本轮新增 Triple vs Pair 状态流式回归测试)
    - `AssistantStreamReducerTest` (13 passed)
    - `SseParserTest` (12 passed)
    - `AssistantImportStateTest` (10 passed)
    - `NetworkContractTest` (10 passed)
    - `AssistantIdentityCoordinatorTest` (6 passed)
    - `AssistantDuplicateStateTest` (5 passed)
    - `ProviderSettingsHelperTest` (5 passed)
    - `InputContractTest` (4 passed)
    - `CancellableBlockingFlowTest` (1 passed)
    - （1+10+12+4+5+25+5+6+10+13 = 91 项）

### C. Build & Lint (构建与代码质量检查)
- **服务端**:
  - `npm run lint` -> 退出码 0，无任何 warning。
  - `npm run typecheck` -> 退出码 0，TypeScript 校验完全通过。
  - `npm run build` -> 退出码 0，生产构建成功 (`BUILD_EXIT=0`)。
- **Android 端**:
  - `./gradlew lintDebug` -> BUILD SUCCESSFUL，0 errors / 9 warnings。
  - `./gradlew assembleDebug` -> BUILD SUCCESSFUL，Debug APK 顺利编译。

### D. Migration Rehearsal (隔离数据库迁移排演)
- **排演脚本与产物**: `artifacts/stream-migration-rehearsal/rehearse.mjs`
- **结果**: 19 张既有业务表哈希一致、新增 2 张流式表、重复执行幂等、`integrity: ok`。
- **真实线上表结构比对**: 部署前后生产库均为 22 张表（`before-after-manifest.json`），无未排演结构变更。

### E. Live Provider (真实上游模型连通性实测)
- **授权与执行状态**: **已获授权并在特定测试轮次中实际执行**（修正旧“NONE / PENDING”措辞）。
- **实测表现与事实**:
  1. **成功轮次**:
     - 连续追问 Round 2：S1（代次 `81750f01` -> `66823722` -> `8cd41716`）与 S2（代次 `61bf4dac` -> `3006d620` -> `baee1991`）均成功从外部模型获得结构化追问与答复；
     - 正文增量 Visible Stream：代次 `4abe2b48` 成功产出 36 条 delta，累计 808 字符，平滑完成并接管。
  2. **失败轮次（如实记录，绝不改判）**:
     - 跨会话切换 ABA 补测：代次 `21dba779` 在首字等待 20 秒后，触发上游 TTFT 超时中断（`status: failed`, `error_code: ASSISTANT_STREAM_BOUNDS`, `AI 响应超时，本次生成已中断。`）；
     - 首轮 ABA 实测：代次 `3da7ef99` 产出 10 条 delta（219 字符）后抛出 `INVALID_ENVELOPE` 终止，经本地探针证实为 envelope 语法解析被拒，非 4000 字符超限（详见 `research/aba-provider-failure.md`）。

### F. Device (物理设备端到端专项核验)
- **授权与执行状态**: **已获授权并在 HUAWEI nova 7 Pro (JER-AN20 / Android 12) 实机执行**（修正旧“NONE / PENDING”措辞）。
- **实测结果汇总**:
  1. **连续追问 Round 2 (PASS)**: Choice A -> Question B -> Choice B 顺畅推进，49 份 UI 树 0 处 409 STALE；16 张账务表哈希完全一致；旧 stuck 卡不修不翻案；
  2. **0-delta 占位与 Stop (PASS)**: 首字前渲染占位气泡，+1.103s 点击 Stop 成功取消，服务端置 `cancelled`，0 delta 0 消息，3.5s 静默无迟到卡片；
  3. **正文增量多帧递增 (PASS)**: 捕获 35 帧真机截帧（~450ms 采样），气泡自适应拉伸并连续递增正文，终态由单个 final 气泡接管，无双泡；文案“结构化草案”为 UI 沿用，非记账草案；
  4. **跨会话 A->B->A 隔离 (有限 PASS / 核心生成 FAIL)**: +1.68s 切入 B 证实服务端生成不中断；B 零污染（0 消息 0 代次）；切回 A 严格对齐同一代次无双泡；但该代次因上游 20s 超时失败。
  5. **流式滚动药丸修复与实机复测 (PASS)**: 用户两张最新截图证实离底显示/自然触底消失，与 `artifacts/phone-verifier-scroll-live-retest` 实测记录完全一致。流式期间上滑阅读历史触发“有新消息，跳到最新”药丸出现（Frame 14~21）；在 `04-terminal.xml` 中药丸保留 count=1（合法未触底）；随后在 `06-scroll-bottom.xml` 中自然滑动到底部后药丸自动消失（count=0，未点击药丸）；期间额外自然 swipe 发生在终态后数分钟，不宣称 terminal 瞬间自动清除或微秒时序；35 帧原生采样 ~400ms，总 event payload 字节（19294 bytes）非正文字符数（用户 210 + 助理 2152 字符）；无双泡残留。
  6. **财务账本安全 (PASS)**: 全流程零 `/confirm` 调用，无自动记账。除 Round 2 证实 16 表 SHA-256 哈希一致外，Stop/Visible/ABA 专项仅验证了表记录计数（59/2/11）不变，不夸大为全量哈希一致。

---

## 3. Remaining Authorization Gates (剩余授权门状态)

| 授权门 | 名称 | 当前状态 | 规则与事实说明 |
|:---:|:---|:---:|:---|
| **Gate 1** | **生产部署与生产库迁移** | **已授权并执行** | 补丁镜像 `31bb967e` 已在线运行，数据库表结构与密钥哈希已核验 |
| **Gate 2** | **真实 AI Provider 联调** | **已授权并执行** | 已在受控测试会话中调用，已如实记录成功与失败轮次（Provider review 证实 20s 全 call 预算） |
| **Gate 3** | **物理真机 APK 部署与验证** | **已授权并执行** | 已在真机上验证，最新 APK 哈希为 `5c004350...` 字节一致；前序基线 `d2a37b55...` 历史保留 |
| **Gate 4** | **财务记账安全红线 (G-Auth)** | **保持守卫 / 未触碰** | 全程坚决禁止自动调用 `/confirm`，绝无未授权财务记账 |
| **Gate 5** | **Git 提交与任务归档** | **未授权 (LOCKED)** | 用户未授权 git stage/commit，未授权任务归档；必须保持工作树原样 |

---

## 4. Working Tree & Mixed WIP Staging Boundary (工作区隔离与提交边界)

- **工作区现状**:
  - 当前工作区包含 201+ 项未提交修改（跨阶段历史任务、Agent 技能与环境配置）。
- **提交边界纪律**:
  - **严禁整库暂存 (`git add .` / `git commit -a`)**。
  - **严禁私自将任务归档 (task archive)**。
  - 必须严格保持工作树原样，等待用户进一步明确指令。
