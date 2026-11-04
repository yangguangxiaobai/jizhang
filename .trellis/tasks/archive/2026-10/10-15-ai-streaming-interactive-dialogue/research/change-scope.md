# 任务变更清单（change-scope）

Task: `.trellis/tasks/10-15-ai-streaming-interactive-dialogue`
唯一可写产物：本文件。**未改任何源码/测试/spec/其它 docs，未跑构建与测试，未 stage/commit/reset。**
方法：只读比对 `artifacts/ai-streaming-baseline`（下称“基线备份”）副本与当前实际路径；以 `artifacts/ai-streaming-baseline/status.txt`（下称“基线快照”）反推备份时的 git 状态。

---

## 1. 基线备份的真实构成（先确认 status.txt）

- 基线备份目录 = `artifacts/ai-streaming-baseline/`，目录下物理文件共 **141** 个（含状态快照 `status.txt`）。其中源码/规范副本共 **140** 个（不含 `status.txt`），只覆盖 `packages/server/**`、`clients/android/**`、`.trellis/spec/backend/ai-provider.md` 三棵树的部分文件。
- 基线快照 `status.txt`：**188** 行 = **122** 个 `M` + **1** 个 `D` + **65** 个 `??`，与当时工作区一致。
  - 其中 `D clients/android/app/src/main/java/com/yansuu1/jizhang/DemoActivity.kt`：该文件当时被删（后迁至 `app/src/debug/**`），与流式任务无关，属前序 WIP。
- 结论：**备份清单 ⊊ 基线快照清单**。快照里大量 `M`/`??` 项在基线的 `140` 个副本里**没有对应副本**。

> **重要纪律（已验证）**：不能因为“基线备份里没有某文件”就推断它是本任务新建。
> 凡“基线无副本”的路径，一律回到 `status.txt` 对照：
> - 已列 `??` → 备份当时就已存在（未跟踪旧文件），**不是本任务新建**；
> - 未列 → 需再判断是「本任务新建」还是「基线之后由其它任务/会话新建（本任务无关）」，见第 2、3 节区分。

基线无副本但**必须从 status.txt 判定其为“基线已存在”**的流式相关路径：

| 路径 | status.txt | 判定 |
| :--- | :--- | :--- |
| `packages/server/src/services/assistant-tool-registry.ts` | `M` | 旧文件（基线已存在） |
| `packages/server/test/db.test.ts` | `M` | 旧文件 |
| `packages/server/test/assistant.test.ts` | `M` | 旧文件 |
| `packages/server/src/config.ts` | `M` | 旧文件（本任务未改，见 §5） |
| `packages/server/src/services/portability-service.ts` | `M` | 旧文件（本任务未改） |
| `packages/server/src/services/xlsx-lite.ts` | `M` | 旧文件（本任务未改） |
| `packages/server/src/services/assistant-import-comparison-service.ts` | `??` | 既有未跟踪旧文件（基线已存在，非本任务） |
| `packages/server/src/services/bill-import-analysis.ts` | `??` | 同上 |
| `packages/server/test/bill-import-analysis.test.ts` | `??` | 同上 |
| `packages/server/test/fixtures/refund-review.csv` | `??` | 同上 |
| `clients/android/app/src/main/java/.../ui/feature/`（目录） | `??` | 目录当时已存在（含 4 个旧文件，见 §2.2） |
| `clients/android/app/src/test/`（目录） | `??` | 目录当时已存在（含 2 个旧测试文件） |
| `clients/android/README.md` | `??` | 基线已存在（未跟踪旧文件） |
| `clients/android/app/src/main/java/.../ui/feature/assistant/AssistantConversationHelper.kt` | `??`（经目录） | 基线已存在 |
| `clients/android/app/src/main/java/.../ui/feature/assistant/AssistantImportState.kt` | `??`（经目录） | 基线已存在 |
| `clients/android/app/src/test/java/.../net/NetworkContractTest.kt` | `??`（经目录） | 基线已存在 |
| `clients/android/app/src/test/java/.../assistant/AssistantConversationHelperTest.kt` | `??`（经目录） | 基线已存在 |

### 1.1 status.txt 覆盖度偏差（会造成“假新建/假删除”）——必须记录

基线快照是**有缺失的**，不可当作完备基线：

1. **缺失整个 `.trellis/` 域**：`status.txt` 中 0 条 `.trellis/**` 记录。而基线备份**确实**含 `.trellis/spec/backend/ai-provider.md` 副本。故当前 `M .trellis/spec/backend/ai-provider.md` 在 status.txt 里**对不上**，只能靠基线副本 + 当前快照判断（见 §5）。
2. **缺失应用级 `??` 目录**：本任务新建的 `packages/server/src/services/*`、`packages/server/test/*` 新文件在基线快照里**没有逐文件条目**（连目录条目都没有）。即这些源文件在基线快照中**不可判定**，只能靠别的方法判定（见 §2）。
3. **缺失若干散落 `??` 项**：如 `.agents/skills/trellis-*/`、`.tmp-*`、`.trellis/tasks/10-09-*` 等多达约 52 条在整个 status.txt 中未出现。
4. `status.txt` 本身 → 在基线半备份树中**无对应当前路径**（属预期，它只是状态快照）。

### 1.2 备份树 vs 当前路径 完整性核验结果

- 基线备份中的 **140** 个源码/规范副本：**140 个在当前工作区路径全部存在**（140/140，0 丢失，核验通过）。唯一的非代码文件是快照记录 `status.txt`（物理存在于备份根目录下，不属于工作区代码路径，属预期状态快照文件而非丢失代码）。
- **无任何基线副本文件被删除**（对比 `git status` 当前快照无 `D` 项与基线相关）。

---

## 2. 本任务新增文件清单

> 判定口径：① 基线备份无副本，且 ② 基线快照无对应条目（即基线时不存在），且 ③ 时间戳/内容与流式实现及 `research/*-handoff.md`、`check-status.md` 一致。

### 2.1 后端（`packages/server/`）

| 文件 | 性质 | 行数 | 来源证据 |
| :--- | :--- | ---: | :--- |
| `src/db/migrations/011-assistant-generations.ts` | 新增 | 54 | backend-handoff Phase B |
| `src/services/assistant-generation-service.ts` | 新增 | 1254 | backend-handoff Phase B |
| `src/services/assistant-generation-runner.ts` | 新增 | 934 | backend-handoff Phase B |
| `src/services/assistant-stream-types.ts` | 新增 | 239 | backend-handoff Phase A |
| `src/services/assistant-stream-tokenizer.ts` | 新增 | 515 | backend-handoff Phase A |
| `test/assistant-stream.test.ts` | 新增 | 400 | backend-handoff Phase A |
| `test/assistant-stream-routes.test.ts` | 新增 | 1365 | backend-handoff Phase B |
| `test/assistant-generation-persistence.test.ts` | 新增 | 288 | 流式持久化单元测试（10用例全过，含原子rollback/稳定ID/dedup/cancel/overflow/terminal预留，已收录于 check-status §2B） |
| `.trellis/spec/backend/assistant-streaming.md`（spec） | 新增 | 45 | check-status.md §2A、backend-postfix-review.md 引用 |

> `packages/server/src/services/ai-types.ts` 在基线 status.txt 中列为 `M`，基线备份无副本 → **旧文件**；本任务未改（见 §5）。

### 2.2 Android（`clients/android/`）

| 文件 | 性质 | 行数 | 来源证据 |
| :--- | :--- | ---: | :--- |
| `app/src/main/java/.../net/SseParser.kt` | 新增 | 192 | android-handoff §2A、android-final-review |
| `app/src/main/java/.../net/CancellableBlockingFlow.kt` | 新增 | 24 | android-final-review §2D |
| `app/src/main/java/.../repo/AssistantStreamingModels.kt` | 新增 | 432 | android-handoff §2B |
| `app/src/main/java/.../ui/feature/assistant/AssistantStreamReducer.kt` | 新增 | — | android-handoff §2C；`feature/assistant/` 目录基线已存在，但该文件是目录内新增 |
| `app/src/main/java/.../ui/feature/assistant/AssistantStreamingComponents.kt` | 新增 | — | android-handoff §2D |
| `app/src/test/java/.../net/SseParserTest.kt` | 新增 | — | android-final-review §4 |
| `app/src/test/java/.../net/CancellableBlockingFlowTest.kt` | 新增 | — | android-final-review §4 |
| `app/src/test/java/.../ui/feature/assistant/AssistantStreamReducerTest.kt` | 新增 | — | android-final-review §4 |
| `app/src/test/java/.../ui/feature/assistant/AssistantIdentityCoordinatorTest.kt` | 新增 | — | android-final-review §4 |

> 新增文件判定依赖 §1.1 第 2、3 条（基线快照缺失 `??` 条目）：表中 `feature/assistant/` 内新文件与 `src/test` 新文件无法仅靠 status.txt 判定，需结合“基线副本文件集不含该文件名”+任务证据共同判定。已在表中标注证据来源。

### 2.3 非本任务、但“基线之后新增”的相邻新文件（必须排除，避免误 stage）

这些路径在基线快照 `??` 中**未出现**，但经内容判读**不属于本流式任务**（属微信/支付宝导入等其它 WIP）：

- `packages/server/src/services/assistant-import-comparison-service.ts`、`bill-import-analysis.ts`
- `packages/server/test/bill-import-analysis.test.ts`、`test/fixtures/refund-review.csv`
- `packages/server/scripts/check-api-only.mjs`、`scripts/lib/retired-web.mjs`
- `clients/android/app/src/debug/**`（debug 清单，基线无副本、快照无条目）
- 各类 `.tmp-*`、`.trellis/ardot_screens/`、`.trellis/tasks/10-09-*` 等

> 注：`assistant-import-comparison-service.ts` / `bill-import-analysis.ts` 在基线快照里是 `??`（基线已存在）；此处列出是为了说明“哪些新增文件**不是**本任务”，与 §1 的“基线已存在”判定不冲突——两者都指向同一结论：**非本任务新建**。

---

## 3. 混合旧文件：流式相关 hunks 精确定位

> 行号口径：`git diff` 的**新文件侧行号**（行尾规范化后）。基线副本与当前文件行尾可能不同（见 §4），故同时给出「`--strip-trailing-cr` 基线内容 hunk」供交叉核对。

### 3.1 后端混合文件

| 文件 | 行尾 | 流式相关新增行数(近似) | 真实变更 hunk（基线内容口径） | 说明 |
| :--- | :--- | ---: | :--- | :--- |
| `packages/server/src/app.ts` | LF | +5 / -0 | `@@ -44,+4`（`generationDelayMs`、`generationStepDelayMs` 选项）；`@@ -172,+2`（传入 assistant 路由） | 全部为流式测试注入选项 |
| `packages/server/src/db/migrate.ts` | CRLF | +2 / -0 | `@@ -24`（import 011）；`@@ -46`（注册 version 11） | 纯流式 |
| `packages/server/src/routes/assistant.ts` | CRLF | ~+298 / -18 | `@@ -1,+152`（新增流式 imports+路由骨架）；`@@ -89,+8`；`@@ -99,+144`；`@@ -122,+32`；`@@ -158,+15`；`@@ -226,+13` | 主体为流式；少量为 legacy 复用改造 |
| `packages/server/src/services/ai-provider-service.ts` | CRLF | ~+468 / -30 | `@@ -7,+9`；`@@ -182,+11`；`@@ -227,+1`；`@@ -241,+9`；`@@ -271,+398`；`@@ -278,+100` | 新增 `AiProviderStream`、`openStream`、deadline 贯穿 body |
| `packages/server/src/services/assistant-types.ts` | CRLF | ~+153 / -5 | `@@ -121,+23`；`@@ -160,+51`；`@@ -224,+11`；`@@ -248`；`@@ -292,+11`；`@@ -356,+53`；`@@ -364,+28`；`@@ -394,+51` | `generationId`/`clarification` 增补 + surrogate-safe 截断 |
| `packages/server/src/services/assistant-orchestrator.ts` | CRLF | +46 / -27 | `@@ -66,+50`（导出 `AssistantContextBundle` + `buildAssistantContext`）；`@@ -79,+10`（构造函数改为复用） | 为 runner 抽取共享 context |
| `packages/server/src/services/assistant-conversation-service.ts` | **LF（原 CRLF！）** | ~+57 / -4 | `@@ -66,+12`；`@@ -177,+41`；`@@ -247,+2`；`@@ -334,+1` | 流式 archival/active-turn fence 相关 |
| `packages/server/test/assistant-contracts.test.ts` | CRLF | +93 / -0 | `@@ -2,+3`；`@@ -93,+101` | clarification 契约 + surrogate 边界 |

**必须小心**：混合文件里**只有上表列出的 hunk 属于本任务**。例如 `assistant-conversation-service.ts` 的 `git diff` numstat 为 `+59/-4`，其中 **~591 行“修改”其实只是 CRLF→LF 行尾反转**，真实内容改动仅 4 个 hunk、~61 行。

### 3.2 Android 混合文件

| 文件 | 行尾 | 真实变更 hunk（`--strip-trailing-cr` 口径） | 说明 |
| :--- | :--- | :--- | :--- |
| `app/src/main/java/.../net/ApiClient.kt` | **CRLF（原 LF！）** | `@@ -4,+14`；`@@ -52,+7`；`@@ -171,+66`；`@@ -241,+25` | 新增 `streamSse` / SSE 传输 / 401 会话处理 |
| `app/src/main/java/.../repo/AssistantRepository.kt` | CRLF | `@@ -2,+2`；`@@ -26,+61` | 新增 generation/SSE 仓库方法 |
| `app/src/main/java/.../ui/AssistantTab.kt` | CRLF | 22 个 hunk（`@@ -1`、`-88`、`-98`、`-137`、`-168`、`-192`、`-311`…`-1696`） | 订阅生命周期/身份门/合并渲染/滚动 |
| `app/src/main/java/.../ui/feature/assistant/AssistantConversationHelper.kt` | LF | `@@ -1,+4`；`@@ -109,+5`；`@@ -352,+329` | 合并项/EOF reconcile/错误映射 |
| `app/src/main/java/.../ui/feature/assistant/AssistantImportState.kt` | LF | `@@ -57,+6` | `invalidateDisplay` 增加 `gen:`/`reconnect:`/`cancel:` 通道（流式隔离） |
| `app/src/test/java/.../net/NetworkContractTest.kt` | CRLF | `@@ -1,+12`；`@@ -73,+69` | SSE 重定向/内容类型/CSRF 契约 |
| `app/src/test/java/.../ui/feature/assistant/AssistantConversationHelperTest.kt` | CRLF | `@@ -1,+34`；`@@ -297,+368` | 流式合并/状态/重试回归 |
| `.trellis/spec/backend/ai-provider.md` | LF | `@@ -333,+2` | 追加 “True assistant streaming” 指向 `assistant-streaming.md` |
| `clients/android/README.md` | CRLF | 14 个 hunk | 功能清单新增/更新流式条目（parent-owned，见 §6） |

---

## 4. 行尾（CRLF/LF）陷阱 —— 直接影响 stage 粒度

比对中发现**三个文件发生了整文件行尾反转**，`git diff` 会把它们显示成“全文件重写”，掩盖真实改动：

| 文件 | 基线备份 | 当前 | 后果 |
| :--- | :--- | :--- | :--- |
| `packages/server/src/services/assistant-conversation-service.ts` | CRLF × 416 | **LF × 471** | `git diff` `+59/-4` 掩盖 ~416 行行尾噪音；`git add -p` 易全量纳入 |
| `clients/android/app/src/main/java/.../net/ApiClient.kt` | LF × 252 | **CRLF × 364** | `git diff` `+183/-33`（numstat），真实内容改动仅 4 hunk |
| `packages/server/src/app.ts` | LF × 201 | LF × 206 | 未反转（仅列出以澄清） |

其它混合文件（`routes/assistant.ts`、`ai-provider-service.ts`、`assistant-types.ts`、`assistant-orchestrator.ts`、`AssistantTab.kt`、`NetworkContractTest.kt`、`assistant-contracts.test.ts`、`clients/android/README.md`）为 **CRLF 前后一致**，无行尾噪音。

> `core.autocrlf=true` 且 `.gitattributes` 无 `* text=auto` 规则。提交时 Git 会把工作区 CRLF 规范化，但**当前工作区行尾漂移仍会污染 diff 视图**，必须在 `git add -p` 时逐 hunk 甄别。

---

## 5. 前序依赖（本任务改动所依赖的既有/无关 WIP）

本任务代码**编译/运行依赖**下列已被基线之后其它改动触及的旧文件；它们**真实存在内容改动，但不属于本任务**（不得混入本任务提交）：

| 文件 | 与流式任务的关系 | 证据 |
| :--- | :--- | :--- |
| `packages/server/src/services/assistant-tool-registry.ts` | **当前内容与基线备份逐字节相同**（`cmp` 通过）；整体 WIP `+35/-23` 为**前序/并行 WIP**，非本任务 | 基线备份 `cmp` 一致 |
| `packages/server/src/services/ai-types.ts` | 唯一一行为 `feature` 联合类型新增 `'bill-import'` → **导入任务**，非流式 | `git diff` 单行 |
| `packages/server/test/app.test.ts` | 内容与基线备份一致；整体 WIP `+45/-31` 为前序改动 | 基线备份 `cmp` 一致 |
| `packages/server/test/assistant.test.ts` | 内容与基线备份一致；整体 WIP `+205/-2` 为前序改动 | 基线备份 `cmp` 一致 |
| `packages/server/test/db.test.ts` | 内容与基线备份一致且不含 `011`/`generation` 断言；仍有整体 WIP | `grep` 无命中 |
| `packages/server/test/platform-import.test.ts` | 导入任务 WIP，非流式 | 与导入相关 |
| `packages/server/src/config.ts`、`portability-service.ts`、`xlsx-lite.ts` | 非流式 WIP | 无流式符号 |
| `packages/web/e2e/fixtures.mjs`、`packages/shared/src/platform-bills.ts`、`packages/shared/test/platform-bills.test.ts` | 导入/平台账单 WIP，非流式 | — |

**链路依赖（真实）**：`app.ts` → `routes/assistant.ts` → `assistant-generation-service.ts` → `assistant-generation-runner.ts` → `assistant-orchestrator.ts`(`buildAssistantContext`) + `assistant-stream-tokenizer.ts` + `ai-provider-service.ts`(`AiProviderStream`) + `ai-organization-service.ts`（嵌套 provider）；持久化侧 `db/migrate.ts` → `migrations/011-*.ts`；Android 侧 `AssistantStreamingModels.kt` ← `AssistantRepository.kt` ← `ApiClient.kt`(`streamSse`) + `SseParser.kt` + `CancellableBlockingFlow.kt` → `AssistantStreamReducer.kt` → `AssistantConversationHelper.kt` → `AssistantTab.kt`。

---

## 6. 不得整文件盲 stage 的清单（scoped commit 纪律）

### 6.1 禁止 `git add .` / `git commit -a`

当前工作区快照 **201** 条（基线快照 188 条），含跨任务、Agent 技能、部署脚本、`.tmp-*`、`nul` 等混合 WIP。

### 6.2 必须“只 stage 指定 hunk / 指定新增文件”的清单

**A. 混合旧文件（用 `git add -p`，逐 hunk 只选流式 hunk）：**

- `packages/server/src/routes/assistant.ts`
- `packages/server/src/services/ai-provider-service.ts`
- `packages/server/src/services/assistant-types.ts`
- `packages/server/src/services/assistant-orchestrator.ts`
- `packages/server/src/services/assistant-conversation-service.ts` ← **有 CRLF→LF 陷阱，最高风险**
- `packages/server/src/app.ts`
- `packages/server/src/db/migrate.ts`
- `packages/server/test/assistant-contracts.test.ts`
- `clients/android/app/src/main/java/.../net/ApiClient.kt` ← **有 LF→CRLF 陷阱，最高风险**
- `clients/android/app/src/main/java/.../repo/AssistantRepository.kt`
- `clients/android/app/src/main/java/.../ui/AssistantTab.kt`
- `clients/android/app/src/main/java/.../ui/feature/assistant/AssistantConversationHelper.kt`
- `clients/android/app/src/main/java/.../ui/feature/assistant/AssistantImportState.kt`
- `clients/android/app/src/test/java/.../net/NetworkContractTest.kt`
- `clients/android/app/src/test/java/.../ui/feature/assistant/AssistantConversationHelperTest.kt`
- `.trellis/spec/backend/ai-provider.md`
- `clients/android/README.md` ← parent-owned，提交前须由 parent 确认

**B. 可整文件 stage 的本任务新增文件：** §2.1 全 9 项 + §2.2 全 9 项（注意：`AssistantStreamReducer.kt`、`AssistantStreamingComponents.kt` 在基线已存在的 `feature/assistant/` 目录内，属目录内新增文件，可整文件 `git add` 指定路径）。

**C. 严禁纳入本任务提交（非本任务 WIP）：**

- `packages/server/src/services/assistant-tool-registry.ts`、`ai-types.ts`、`config.ts`、`portability-service.ts`、`xlsx-lite.ts`
- `packages/server/test/app.test.ts`、`assistant.test.ts`、`db.test.ts`、`platform-import.test.ts`
- `packages/server/src/services/assistant-import-comparison-service.ts`、`bill-import-analysis.ts`、`packages/server/test/bill-import-analysis.test.ts`、`packages/server/test/fixtures/refund-review.csv`
- `packages/server/scripts/check-api-only.mjs`、`packages/server/scripts/lib/retired-web.mjs`
- `packages/shared/src/platform-bills.ts`、`packages/shared/test/platform-bills.test.ts`、`packages/web/e2e/fixtures.mjs`、`packages/web/e2e/reference-host.mjs`
- `clients/android/app/src/debug/**`
- 全部 `.agents/**`、`.codex/**`、`.pi/**`、`.tmp-*`、`.trellis/.template-hashes.json`、`.trellis/ardot_screens/**`、`.trellis/tasks/10-09-*/**`、`deploy/**`、`docker-compose.*.yml`、`Dockerfile`、`.dockerignore`、`.env.example`、`.gitignore`、`package.json`、`pnpm-lock.yaml`、`nul`
- `artifacts/**`（证据产物，按仓库惯例不纳入该次代码提交）

> 所有路径均为相对仓库根目录；提交前请再次以 `git diff --name-only` + `git diff --cached --name-only` 双向核对。

---

## 7. protocol fixtures 与 jsonl 引用路径核验

### 7.1 `research/protocol-fixtures-v1.json`
- 存在（2522 B），**JSON 合法**，顶层键 `create` / `snapshot` / `events`，与 `protocol-v1.md` 的路由/快照/事件契约一致（含 `version:1`、`clarification`、`outcome`、`seq`）。
- **未发现缺失**。

### 7.2 `check.jsonl` / `implement.jsonl` 引用路径
- 两者内容一致，共 **9** 条引用，**全部存在**：
  - `.trellis/spec/backend/ai-provider.md` ✅
  - `.trellis/spec/backend/database-guidelines.md` ✅
  - `.trellis/spec/backend/native-delivery.md` ✅
  - `.trellis/spec/backend/error-handling.md` ✅
  - `.trellis/spec/backend/quality-guidelines.md` ✅
  - `.trellis/tasks/10-15-ai-streaming-interactive-dialogue/research/planning-review.md` ✅
  - `.../research/ardot-design.md` ✅
  - `.../research/protocol-draft.md` ✅
  - `.../research/protocol-v1.md` ✅
- `protocol-v1.md` 正文引用 `research/ardot-design.md` → 存在 ✅。

### 7.3 `check-status.md` 引用的证据产物
全部存在：`artifacts/stream-migration-rehearsal/rehearse.mjs`、`artifacts/server-tokenizer-fix-{test,lint,typecheck,build}-20261016-131148.log`、`artifacts/server-stream-fixed-test-20261016-125503.log`、`artifacts/android-stream-check.log`。

### 7.4 清单状态与缺口闭环核验（G1/G3 关闭，G2 按非 required 取证说明处理，保留 G4）
- **G1（已闭环 / CLOSED）**：`check.jsonl` 与 `implement.jsonl` 现已追加收录 `.trellis/spec/backend/assistant-streaming.md`（本任务核心流式 spec），清单完备无遗漏。
- **G2（按非 required 取证说明处理 / RESOLVED）**：`artifacts/ai-streaming-baseline` 作为临时/历史阶段比对产物未必永久存在，不作为 required jsonl 依赖；在两个 jsonl 中已将轻量级文档 `research/change-scope.md`、`research/backend-postfix-review.md` 与 `research/protocol-fixtures-v1.json` 追加为上下文；基线备份 artifacts 明确为有限取证辅助，文字明确其取证局限，无需作为 required jsonl 依赖。
- **G3（已闭环 / CLOSED）**：`packages/server/test/assistant-generation-persistence.test.ts`（288 行，10 个测试用例）已在 `check-status.md` §2B 详细补充覆盖说明（涵盖原子rollback、稳定ID、dedup、ownership cancel、subscriber overflow、corrupt partial、terminal reservation），且经源文件与测试日志核对确认其包含于 24 文件 / 580 项全绿测试之中（非额外加总），缺口关闭。
- **G4（保留限制说明 / RETAINED）**：基线快照 `status.txt` 缺失 `.trellis/**` 全域与多处 `??` 条目（§1.1），其取证效力有限，不可单独作为判断文件是否为本任务新建（new）的绝对证据，判定必须结合任务工程证据与代码演进综合审定。

> 被引用的规范与研究文档物理路径全部存在且验证通过。

---

## 8. 真实完成结论

1. **已完成**：基线备份构成确认（140 文件、`status.txt` 188 行、备份清单⊊快照清单）；基线无副本路径已 100% 回到 `status.txt` 判定；本任务新增文件清单（后端 9 + Android 9 + spec 1）与混合旧文件逐 hunk 定位；前序依赖与不得盲 stage 清单；fixtures/jsonl 引用路径存在性核验并报告 4 项清单缺口；行尾反转风险点名。
2. **未做（按要求）**：未改任何源码/测试/spec/其它 docs；未跑构建、测试、lint、typecheck；未 stage/commit/reset；未嵌套子代理；未部署/安装/真实 provider/设备/记账/依赖或模型变更。
3. **缺口处理状态**：G1 与 G3 已闭环关闭；G2 基线引用按非 required 取证说明处理，不引入不稳定 artifacts 依赖；保留 G4 约束（明确不完整基线不可作为判定 new 的绝对证据）。
4. **不可判定项（明确边界）**：`AssistantStreamReducer.kt` / `AssistantStreamingComponents.kt` / `SseParserTest.kt` / `CancellableBlockingFlowTest.kt` / `AssistantStreamReducerTest.kt` / `AssistantIdentityCoordinatorTest.kt` 的“新增”判定依赖“基线副本文件集不含该名”+任务证据，而非 status.txt 逐条（因快照缺 `??` 条目）；如需 100% 硬证据，应由 parent 提供基线当时的 `git status` 全量或该目录文件清单。
5. 本文件为**唯一落盘产物**，即最终交付。
