# release-postfix-acceptance.md — 独立核验：新 patch 部署 + Android 修复实现

- 任务：`.trellis/tasks/10-15-ai-streaming-interactive-dialogue`
- 角色：只读核验方（backend/server 复核的补充）。**未操作设备、未发 provider、未部署/重启、未改产品/测试/其他 docs/spec、未 stage/commit、未嵌套子代理。**
- 采集时间（UTC）：2026-10-16T13:5x ~ 14:2x（本地 +0800 约 21:5x ~ 22:2x）
- 可写范围（已遵守）：本文件 + `artifacts/release-postfix-review/*`
- 依据（实际逐条读了源文件与证据，不照抄 hand-off）：`research/chained-choice-fix.md`、`deploy-status.md`（含 §“Patch deployment #2”）、
  `artifacts/DEPLOYED_PATCH-chained-choice-20261016T083118Z.md`、`artifacts/phone-verifier-chained-choice/round2/REPORT.md`、
  `research/android-retest-handoff.md`，以及它们引用的原始 artifact。

## 0. 结论（先给判定）

| 核验对象 | 判定 | 限定范围 |
|---|---|---|
| 后端 new-answer NULL 修复（本 patch 唯一代码 delta） | **PASS（已证实）** | 代码/编译产物/部署物 hash、事务与原子 consume+dedup 语义、运行时编译产物证据、独立 probe（含负对照）、现有 targeted tests |
| Android 修复实现（4 项 UI 修复） | **PASS（源码实现层已证实，设备层沿用 round2 证据）** | 无 delta 占位 + Stop、发送/流式滚动与 wasAtBottom 语义、clarification 单实例、Text supersede |
| Android UI 修复的**回归/生命周期** | **未发现实质回归**；发现 **1 项交互缺陷（中低危，非崩溃/非数据丢失）** | 见 §4.3 |
| 流式 provisional 正文（原 device-status 缺陷 1） | **仍未证实（范围外/无法只读复现）** | 见 §6 |
| 剩余风险 | 2 项：`onDelta` 未用于行内渲染、每次 delta 的无条件 snap | 见 §6、§4.3 |

**一句话**：本 patch 的后端修复可以被独立复核为真（含运行时编译产物级证据与独立负对照 probe）；Android 侧本轮 UI 修复在源码层站得住，但滚动/占位交互仍有一处“边看边被拽到底”的行为，且与 0-delta 占位是同一根因（同一轮 dispatch 内无条件 `scrollToItem`）。

---

## 1. 后端：new-answer NULL + 原 source 原子 consume + dedup（逐行）

### 1.1 实际代码（`packages/server/src/services/assistant-generation-service.ts`，1255 行；本 patch 唯一 delta 文件）

| 位置 | 行为 | 判定 |
|---|---|---|
| `create()` 542-549 | 先按 `(conversation_id, client_request_id)` 查既有行；命中即 `created:false` 返回同一 `generation`，且**在 stale 检查之前** | 幂等优先，正确 |
| 549-551 | 同 `clientRequestId` 但 `request_hash` 不同 → `ASSISTANT_REQUEST_CONFLICT` | 防请求号复用，正确 |
| 553-559 | 单活跃生成守卫：同会话已有 `accepted/running` → `ASSISTANT_GENERATION_ACTIVE` | 正确 |
| 561 | `resolveInput()` 在**同一事务内**执行（`this.db.transaction(...)` 入口 543） | 原子，正确 |
| 566-575 | choice 路径：`UPDATE assistant_generations SET answered_at=?, answered_option_id=? WHERE id=? AND answered_at IS NULL`——写到 **source** 行，条件更新（`AND answered_at IS NULL`） | 原子单次消费，正确 |
| 576-590 | 纯文本路径：把本会话所有 `completed/awaiting-choice/answered_at IS NULL` 置为 answered（supersede） | 与协议一致，正确 |
| 613-625 | `INSERT ... answered_option_id, answered_at ... VALUES (..., NULL, NULL, ...)`；bind 列表（626-638）**不再传 `source.optionId/answeredAt`** | **本 patch 的核心修复**，正确 |
| 641-642 注释 | 明确列属主语义：两列描述“本代次自己的问题是否已被回答” | 文档化到位 |
| 664-686 `resolveInput` | `status/outcome` 守卫 → `source.answered_at !== null` 拒绝（669-671）→ `question_id/question_json` 匹配（672-674）→ `findClarification` 合法（675-679）→ `choice` 选项必须属于该追问（681-684） | 篡改/重放防护完整 |
| 686-689 | `choice-text`：文本入 user message，`optionId: null`（只记 `answered_at`） | 正确 |

consume + 新建在**同一个 `better-sqlite3` 事务**里（543 开、653 关），因此“消费成功但生成行未落库”的崩溃窗口不存在——这与 `chained-choice-fix.md` 的声称一致，我在源码里逐条确认，不是照抄。

### 1.2 部署物与编译产物（可独立复核）

| 断言（来自 `deploy-status.md` §Patch #2 / `DEPLOYED_PATCH`） | 我的复核 | 结果 |
|---|---|---|
| source bundle sha256 `042baf4e…75127` | `sha256sum artifacts/jizhang-api-source-20261016T083118Z.tar.gz` | **一致** |
| bundle 内服务器源码 == 当前工作树 | `diff -rq`（bundle 内 `packages/server/src` vs 工作树） | 仅差 `db/migrations/README.md`（非运行时代码）；`assistant-generation-service.ts` 双侧 `bb1e6691…` **完全一致** |
| 运行镜像编译产物 `dist/services/assistant-generation-service.js` = `60fc43e0…476f6c` | 本地 dist `sha256sum` | **一致**（`.js.map` 亦与声称的 `975172f2…` 一致） |
| 相对部署 #1 只有 1 文件变化 | 对比 `jizhang-api-source-20261016T061009Z` 与 `…083118Z` 两个 bundle | **只有** `assistant-generation-service.ts`（+ `SHA256SUMS`），`061009Z` 侧 hash = `2952c9cc…`（pre-fix），`083118Z` 侧 = `bb1e6691…`（post-fix）→ 该 patch 的 delta 就是这一个文件 |
| compiled diff 仅 2 文件（js + js.map），两边各 241 文件 | 读 `artifacts/chained-choice-deploy-20261016T083118Z-compiled-diff.log` | 日志为 `IDENTICAL FILE LIST`、164-165 行仅两文件 hash 变化、`241/241`。**结论一致**（注意：该日志是 hash 清单级对比，不是完整字节镜像 diff——表述上不宜说成“整镜像全文件逐一比对”以外的更强保证，但作为“无别的编译产物变化”的证明已足够） |
| manifest 布尔比较 | `before-after-manifest.json` | `integrity ok/ok`、**22/22 表**、added/removed 空、changed 空（`schema_migrations` 在本次 patch 未变） |
| `env-values comparison` | 读 `artifacts/chained-choice-deploy-20261016T083118Z-env-comparison.json` + `switch.sh` 196-211 | `effectiveSecretValuesIdentical:true`；脚本对**全部**匹配 `AI/KEY/SECRET/TOKEN/PASSWORD/OPENAI/PROVIDER` 的 key 逐个算 `sha256(env值)` 与 before 比较（`assert identical`），只落布尔与 key 名。**本 patch 的值级比较成立**（详见 §5.2） |

### 1.3 独立 probe（我自己写，不复用部署期 probe）+ 负对照

新脚本：`artifacts/release-postfix-review/independent-chained-choice-probe.mjs`（临时目录 DB，绝不触碰 `/data/jizhang.db`，不调 provider）。
不变量：I1 new-answer NULL、I2 source 保留消费、I3 provenance/input 逐字保留、I4 同请求号重放 `created:false`、I5 二次点击 stale、I6 choice-text 路径同样 NULL、**I7 第三跳仍可回答（把“第二跳永久卡死”类别连跑两跳）**、I8 ledger 行数不变。

```
node independent-chained-choice-probe.mjs
→ {"invariants":{I1..I8: true}, "ledgerRows":{"before":0,"after":0}, "result":"PASS"}   exit 0
ASSISTANT_PROBE_DIST=<dist 副本，恢复 pre-fix SQL+bind>
→ {"result":"FAIL","failures":[I1 new generation born unanswered: …"answered_option_id":"a1","answered_at":12345,
   I2 second-hop source consumed: … , "I2b second hop created (the historically stuck hop)":{"hop2Error":"ASSISTANT_CHOICE_STALE"}]}  exit 1
```

负对照以**未改动的旧逻辑产物**复现“出生即已答 → 第二跳 409”，证明该 probe 是有效的判别器，而不是恒真的空断言。证据：`independent-probe.log`、`independent-probe-negative-control.log`。

### 1.4 现有 targeted tests（只读执行，不重编译、不改 APK）

```
cd packages/server
npx vitest run test/assistant-stream-routes.test.ts test/assistant-generation-persistence.test.ts \
  test/assistant-stream.test.ts test/assistant-contracts.test.ts test/assistant.test.ts
→ Test Files 5 passed (5) · Tests 110 passed (110) · exit 0        （日志：artifacts/release-postfix-review/backend-focused-tests.log）
```

回归用例本身经审阅是**有效断言**（`packages/server/test/assistant-stream-routes.test.ts:1404-1553`，`describe('chained clarification choices')`）：断言 202 → genB `answeredOptionId/answeredAt = null` → genC `outcome=answer` → genA/genB 二次点击 409 `ASSISTANT_CHOICE_STALE` → `choice-text` 路径 + 同请求号 `200 {created:false}` 且 **provider 调用次数不变** → 全程 `COUNT(*) FROM transactions` 不变。没有“只断言状态码”的空洞。

---

## 2. Android：4 项修复的源码核查（逐行）

源码与已安装 APK 的对应关系：`clients/android/app/build/outputs/apk/debug/app-debug.apk`
= `d2a37b550fb110e9b6174ec2fe874b681f924423e08c7c5be465749e3bb56da8`，与 `round2/01-installed-apk-sha256.txt`（设备上的 base.apk）**字节一致**。因此对本地源码的审阅对安装包成立（我未重编译，未触发标识漂移）。

### 2.1 无 delta 占位 + Stop（TTFT 阶段）

- `AssistantConversationHelper.kt:528-542`：`sortedProvisionals` 为空且 `status ∈ {accepted, running}` 或 `visualState ∈ {CONNECTING, RECEIVING}` 时，注入占位 `StreamProvisionalMessage("provisional_${generationId}", 0, "", false)` 并渲染为 `AssistantMergedItem.ProvisionalBubble`。
- `AssistantTab.kt:1122-1127`：`ProvisionalBubble` → `StreamingGrowingBubble(text, onStop = stopGeneration(id, gen))`。
- `AssistantStreamingComponents.kt:155-238`：`text.ifBlank { "正在生成回答…" }`（198 行）、`LinearProgressIndicator`（190 行）、`OutlinedButton("停止生成 (保留已输出片段)")` 且 `heightIn(min = 48.dp)`（213-227 行）→ 与 hand-off 一致，行号已核对。
- **设备侧同时刻证据**：`round2/18-s1-send-1s.xml`、`22-clickA-1s.xml`、`25-clickB-1s.xml` 三个“第 1 秒”UI 树里同时出现
  `● 流式生成中 · 结构化草案` / `正在生成回答…` / `停止生成` / `正在实时流式响应` → 在没有 streaming 数据的 0-delta 相即已可用，同轮（S1）A 点击后同样出现，**不再只有 S2 一轮**。

### 2.2 发送滚动 / wasAtBottom / 拖拽不夺取阅读

- `isGeometryAtBottom`（`AssistantConversationHelper.kt:383-401`）：`isScrollInProgress → false`；`totalCount==0 → true`；可见项为空 → false；**只有最后一项且其底边 ≤ viewportEnd+tolerance 才 true**。
- `AssistantTab.kt:2219-2231` `isAtBottom()` 把 `layoutInfo`（含 `viewportEndOffset`）与 `state.isScrollInProgress` 传入；`AssistantTab.kt:141` 只有一个 `rememberLazyListState()`，即 LazyColumn 用的那个（1086-1094）。
- 发送瞬间：`AssistantTab.kt:605-610` `newMessagesAvailable=false` + `withFrameNanos{}` + `scrollToItem(countAfterCreate-1)` → 无条件拉到最新（用户主动发送，合理）。
- 流式期间：`AssistantTab.kt:410-436` 每事件先算 `wasAtBottom`，随后 **只在 `wasAtBottom` 为真时** `scrollToItem(countAfter-1)`；否则仅置 `newMessagesAvailable=true`（“跳到最新”）。
- 横向对比 HEAD 版本：HEAD 里 `isAtBottom`/`wasAtBottom` 全不存在（0 命中）→ 这套“几何在底 + 不夺取”的逻辑**确为本轮新增**，说法成立。
- 结论：静态上确实“用户上滚/正在拖动时不跳走”。**但见 §4.3 的活体反例。**

### 2.3 clarification 单实例

- live 卡：`AssistantConversationHelper.kt:574-576` → `AssistantMergedItem.LiveClarification(clar, selectedOptionId)` → `AssistantTab.kt:1142-1156` 渲染 `ClarificationCard(isLive = true, …)`。
- 历史卡抑制：`AssistantTab.kt:1105` 计算 `liveClarificationId`（仅当 `visualState == AWAITING_CHOICE`），传至 `MessageCard`，`AssistantTab.kt:1949-1956`：
  `if (msgClar != null && card == null && (liveClarificationId == null || msgClar.id != liveClarificationId))` → 同一 `clarification.id` 不会被渲染两次。
- 行号与 hand-off 一致（“1105 / 1949”），我用 grep 复核过实际行号。
- **一个被 hand-off 漏说的细节（非缺陷）**：被抑制的是同一会话回答当前追问时那张历史卡；而**上一跳已消费**的历史卡仍会以 `isLive=false` 显示（旧问题文本 + 禁用选项，`onSelectOption = {}`），所以 UI 上出现两个 `● 待确认分类 · 请选择`。这是“保留历史追问”的有意设计，不是重复渲染；设备树（`22-clickA-29s.xml`/`24-before-clickB.xml`）也只看到两张**不同问题**的卡。旧报告的“Screen-12 历史卡 + live 卡共存”与之不同，属组织性表述差异，不是回归。

### 2.4 Text supersede

- `AssistantTab.kt:1396-1400`：底部输入框发送（无附件）走 `startStreamingGeneration(id, requestId, GenerationInput.Text(capturedDraft.text))`；附件路径（1359-1395）是另一分支。
- 服务端对应：`assistant-generation-service.ts:576-590` 的 supersede UPDATE（本次 patch 未改），因此普通文本**永远**是 `type:"text"`，不会伪造 `Choice`/`ChoiceText`，也不会复用旧 source id。
- 设备侧“点选项”这条唯一带 source 的路径（`AssistantTab.kt:660-675` → `GenerationInput.Choice`）只由 `ClarificationCard` 的 `onSelectOption` 触发，且被 `canSelectChoiceOption`（`AssistantConversationHelper.kt:683-686`，两侧取 TRUE）+ `pendingChoiceRequestId` 幂等收口，重试同一次选择不会产生新请求号（`AssistantTab.kt:670`）。

---

## 3. 设备轮（round2）证据的独立复核

我没有操作设备，只复核 round2 的证据是否**支持** hand-off 的说法：

| round2 声称 | 我的复核（读了哪些 artifact） | 结论 |
|---|---|---|
| 运行镜像即 patch 镜像 | `round2/02-server-identity.txt`：`jizhang:api-chained-choice-20261016T083118Z` / `31bb967e…` / `60fc43e0…476f6c` | **成立**（该 hash 也是我在本地复核过的 patch 产物 hash） |
| 第二跳 B 出生 `answeredOpt/At=null` | `round2/23-gen-after-clickA.txt`、`38-s2-gen-after-A.txt` | **成立**（S1、S2 各一例） |
| B 可被消费并推进 | `26-gen-after-clickB.txt`（S1 → `8cd41716 outcome=answer`）、`41-s2-gen-after-B.txt`（S2 → `baee1991 outcome=pending-confirmation`） | **成立** |
| 无 `ASSISTANT_CHOICE_STALE` | `stale-scan.txt`（49 个 UI 树 0 命中）+ `49-s1s2-generation-status.txt`（全部 `error_code:null`） | **成立**（UI 树文本级扫描，非日志级，属弱证据但方向一致） |
| 账本未变 | `round2/04`、`27`、`47` 计数一致；`50-manifest-after-round2.json` vs 部署后 manifest：changed = 5 张 `assistant_*`（会话/消息/代次/事件/pending），**非 assistant 业务表 changed = []** | **成立**（我独立跑了该哈希比较） |
| 测试提示词与实机输入一致 | `round2/28-s1-messages.txt`：S1 的 user message 是纯文本，**content 里是「支付宝」**；`35-gen-latest.txt`：pending 的 live 生成 `input={"type":"choice","sourceGenerationId":"66823722…","optionId":"8ba703b0…"}` | **成立**。推论（与 hand-off 不同）：round2 的 S1 **第三跳用的是选项点击**（source=66823722/Dining 那问），而 **S2 第三跳才是用户手打「支付宝」文本**；round2 REPORT 的“S1 点支付宝→8cd41716”是**事后重述偏差**，实际 S1 是选项点击、用户手打文本发生在 S2。结论方向不变（都能推进），但复现步骤表该改。 |
| 无 `/confirm` | `45-no-confirm-check.txt`（`events_with_confirm_word=2`，词面出现但非动作）、`43a/43`（pending 行未确认） | 成立（词面命中已自证，不当作动作） |

---

## 4. 新增 UI 修复的实质回归 / 生命周期排查

### 4.1 生命周期（结论：未发现回归）

- 只有一处 `rememberLazyListState()`（`AssistantTab.kt:141`），且所有滚动写入都发生在**当前**会话分支之后（每次写入前都重查 `conversationId == targetConvId`），所以不存在“持旧 `LazyListState` 拉到新会话”的经典生命周期 bug；会话切换时会重建列表（`conversationId` 变化 → `LaunchedEffect` 重置 `messages`，827-837）。
- `installMessages`（280-333）里的 `withFrameNanos` 在写入后再校验 target 与 `showHistory/workspaceActionId`，无 `IllegalStateException` 面。
- 同一函数里对 `selectedRows/overrides/actionFiles/notes` 的清理按 `targetId` 归属（`actionConversationIds`）过滤，切换会话不会把新会话的选择状态清掉（只在 incoming 卡过期时清）。
- `remember(messages, currentGen)`（`AssistantTab.kt:1036`）→ `buildAssistantMergedItems` 是纯函数，无 IO/无副作用，直接放进 `rememberLazyListState` 的滚动写入路径（410/428）是安全的（同帧最多多一次 O(n) 组合）。
- `onStop` 闭包读取的是**当前** `conversationId/currentGen`（1131-1134），不是捕获的旧代次，所以 0-delta 占位上的停止按钮不会误停别的代次。

### 4.2 与后端修复的交互

- 后端的“纯文本即 supersede”与新 UI 的“Text supersede”方向一致：点击选项后若模型又出下一问，用户手打文本会把该追问置 answered（不会再 409）。设备侧 `25-clickB`, `40-s2-B` 期间无 409 文本命中。
- `shouldUnlockChoiceOnError`（`AssistantConversationHelper.kt:694-702`）对 `409 ASSISTANT_CHOICE_STALE` 会解锁选项（`400..499 且 ≠408/429`），配合 `pendingChoiceRequestId` 复用同一请求号——在服务端修好之后这条路径已是幂等重试而非重复计费，行为正确。

### 4.3 【发现】占位/滚动交互缺陷：同一流式阶段里“无条件 snap”导致“跳到最新”药丸在**新内容已部分可见**时仍常驻（中低危）

**事实链（可复现，全为静态 + 已有设备证据）**

1. `AssistantTab.kt:605-610`（dispatch 阶段，**无条件**）：
   `withFrameNanos {}` → `listState.scrollToItem(countAfterCreate - 1)`。
   `dispatch` 事件在 `accepted` 状态就被发出（服务端 `create()` 里 650 行 `appendEventWithin(id, { type: 'state', status: 'accepted' })`），此时 `buildAssistantMergedItems` 会因占位规则返回 “user + ProvisionalBubble” 两项 → 视口被拉到流式气泡底部。
2. 随后每个 `TextDelta`，`AssistantTab.kt:410-436`：`wasAtBottom` 因为上一步刚被拉到底而为 **true** → 每次 delta 都再执行一次 `scrollToItem(countAfter - 1)`。
   → **在本轮流式期间，视口基本恒久处于底部**（这正是设计目标），但也意味着用户一旦上滚并**仍在拖动**时 `isAtBottom` 返回 false（`isScrollInProgress`）会打断自动跟随——这是对的；问题出在**拖动结束后的下一次 delta**。
3. 终局（clarification/pending 卡作为**新的一行**插入）时，若最后一项底边未完全进入视口，`isGeometryAtBottom` 返回 false → 进入 else 分支 434 行 → 置 `newMessagesAvailable = true`。
   → 药丸出现，且**这一次不会**再被“空文本 delta 兜底”清掉：`else if (!wasAtBottom) { if (event is TextDelta || countAfter > countBefore) newMessagesAvailable = true }`，而清空 `newMessagesAvailable` 只发生在“用户点药丸”“发送”“新建/切换会话”等少数分支（1254-1263、605、693、740、834），**没有**基于“底部已重新可见”的自动清除。
4. 设备活证：`round2/44-s2-pending-card.xml`（13:35:56Z）——pending 卡已渲染、`● 待确认记账草案` 已在顶部状态条，但
   `text="有新消息，跳到最新" ... bounds="[378,1809][702,1857]"` **仍在屏上**；同一文本也出现在 `37-s2-A-26s.xml`/`40-s2-B-*`。
   而 `36-s2-before-A.xml`（点 A 前）与 `39-s2-after-A-latest.xml`（点药丸后）**均无该文本** → 说明它是被流式期间的自动 snap 交互“重新推出来”的，且需要用户额外点一次才能操作最新追问。
5. 代价与边界：不丢数据、不崩溃、不写账本、不影响后端权威性；影响是**可读性/操作摩擦**（多一次点击；若用户不看药丸可能误以为追问没出现），并且与“0-delta 占位”共享同一根因（同一 dispatch 内先无条件 `scrollToItem`）。
6. 最小修复方向（**本轮不改代码，仅建议**）：把 605-610 的“无条件回到最新”改为仅在 `wasAtBottom || countAfterCreate <= visibleCountBefore` 时执行；或在扫描到“最后一项已完全可见”时清除 `newMessagesAvailable`（例如在 `LazyListState` 的 `layoutInfo` 变更后判断，而非只在事件回调里判断）。

> 备注（不是缺陷）：收集循环内 416-426 的 `getGeneration` 对账是**挂起**的，`countAfter` 会包含对账后的真实状态，因此它引起的 snap 与屏幕内容一致，不构成“视图与状态错位”。

---

## 5. 已证实 vs 旧报告谬误（按母指令逐条）

### 5.1 “20 vs 21 tables 是笔误，不是 migration nuance” —— **证实，且真值比两方说的都更该修正**

- 我方直接读部署产物 JSON：`chained-choice-deploy-20261016T083118Z-{before,after,prev-deployed}-manifest.json` **都是 22 张表**；
  即 **本 patch（部署 #2）开关前后表集合完全一致，无新增/删除/变化**（added `[]`, removed `[]`, changed `[]`）。
- 因此 `research/live-stream-diagnosis.md §7` 里写的“`before-manifest.json` → `tables = 20`”是对**部署 #2** 产物的错误归属（那个 20/22 的过渡发生在**部署 #1**，其产物不在本地）。
- 同时 `deploy-status.md:37` 的“Pre-change live manifest: … 20 tables, migrations 1–10”与现有产物不符；`research/deployment-acceptance-review.md:46` 的“live pre-manifest 21 tables”同样是错的。
- 判定：**这是记录口径/笔误问题**，不是任何 migration nuance；对“账本不变”结论无影响（表集合与哈希在我能核的产物上完全持平）。

### 5.2 “原 env keyname equality 不能证明值；本 patch 已有 effective 值私有比较可核” —— **成立，并已核对实现**

- 旧弱点（`research/live-stream-diagnosis.md §6`）指的是**部署脚本只断言 key 名**；本 patch 的 `switch.sh:196-211` 已经对每个匹配 key 逐值 `sha256` 与 before 比对，并且只在 host 侧私有备份目录落布尔+key 名。
- `artifacts/chained-choice-deploy-20261016T083118Z-env-comparison.json` 为 `{"effectiveSecretValuesIdentical": true, "comparedKeyNames": [ … ]}`；
  **修正一处转述**：`hand-off`/`DEPLOYED_PATCH` 只点了两个 key 名，容易被读成“只比了 2 个”。实际 `comparedKeyNames` 是**全部匹配集合**（变量 `keynames`，过滤条件见 197 行），JSON 里列出多少就是脚本实际比较了多少。
- 因此“值级不变”在本 patch 上**可核**；keyname-only 断言只是冗余的第二道（且它是 `assert`，不是结论来源）。

### 5.3 其他澄清

- `compiled-diff` 日志是“两边 241 文件的 hash 清单对比”，足以证明“除这 2 个文件外无编译产物变化”，但不宜表述为“整镜像全部字节逐一比对”。
- `round2 REPORT` 中把 S1 第三跳写成“点支付宝”，与实际落库的 `input={type:"choice", source=66823722}`（选项点击）不符（用户手打「支付宝」的是 S2）。方向不变，但复现步骤应改。
- `android-retest-handoff.md` 把 `isGeometryAtBottom` 描述为“用户上滚则 false”——准确表述是“`isScrollInProgress` 为真，或最后一项底边未进入视口则 false”；“拖拽不夺取阅读”成立，“上滚后必然 false”不严格。

### 5.4 旧报告未被本 patch 修复、也不属于其范围

- `research/live-stream-diagnosis.md §11` 的 4 个 open item（含“把 keyname 断言换成 `.env` 字节哈希”）是**部署 #1** 的遗留；本 patch 已实际改了值级比较，但该文档未回改（不属我职责）。
- `ed63eb1c` 的 4000 字符上限（截断 vs 失败）仍未决策，本轮未触碰。

---

## 6. 剩余范围（未证实/未做，明确列出）

1. **流式 provisional 正文（原 device-status 缺陷 1）仍未证实**：round2 的提示词让模型直接出选择题，没有正文路径；本轮为只读，不能发 provider，也不能复现。源码侧可指认一条高概率机制供下一轮验证：`AssistantTab.kt:402-437` 的 `collect{}` **没有调用 `onDelta`** 之类的“增量改文本”路径，气泡文本只能来自 `currentState.provisionalMessages`（由 `Message`/`TextDelta` 事件或 `partialMessages` 快照填充）。因此**若**上游在出题前已产生正文但未落 `partialMessages`，气泡会一直显示 `正在生成回答…`。下一轮最小验证用例：受控 mock 上游（或一条稳定产出前置正文的提示），观察 a) `assistant_generations.partials_json` 是否随 delta 增长；b) 重连后气泡是否显示已持久化的 partial 文本。
2. **未验证**：真机 Stop/cancel、会话 A→B→A 代次隔离、导入幂等/100 行、余额图、`/confirm` 全流程；本轮没做，也没有替代证据。
3. **未做（遵守约束）**：未部署/未重启/未改 provider/未动账务/未改配置/未装依赖/未 stage/commit；未操作设备；未重编译 Android（APK 保持 `d2a37b55…`，避免与 phone-verifier 并行标识漂移）。
4. **写入范围合规**：只新增/修改
   `research/release-postfix-acceptance.md`、`artifacts/release-postfix-review/*`（probe、日志、evidence.txt）。
   `packages/server/dist` 未变（dist 的 mtime 仍为部署期 16:27，负对照副本已删除，`packages/server/dist-negative-control` 不存在）。

---

## 7. 复核命令与结果（可直接重跑）

```
# 部署物/产物 hash
sha256sum artifacts/jizhang-api-source-20261016T083118Z.tar.gz
sha256sum packages/server/dist/services/assistant-generation-service.js packages/server/dist/services/assistant-generation-service.js.map

# bundle vs 工作树
diff -rq /tmp/bundle0831/jizhang-api-source/packages/server/src packages/server/src

# 表集合/哈希
python … (见 artifacts/release-postfix-review/evidence.txt §6/§7)

# 后端不变量（独立 probe + 负对照）
node artifacts/release-postfix-review/independent-chained-choice-probe.mjs
ASSISTANT_PROBE_DIST=<pre-fix dist> node artifacts/release-postfix-review/independent-chained-choice-probe.mjs

# 现有 targeted tests（只读）
cd packages/server && npx vitest run test/assistant-stream-routes.test.ts test/assistant-generation-persistence.test.ts \
  test/assistant-stream.test.ts test/assistant-contracts.test.ts test/assistant.test.ts
```

结果汇总：bundle/hash **一致**；工作树与 bundle 仅差一个非运行时 README；probe **PASS**、负对照 **FAIL（复现原缺陷）**；targeted tests **110 passed / exit 0**；manifest 表集合 **22/22 无变化**；round2 设备窗口相对部署后基线 **非 assistant 业务表变化为 0**；APK 本地/设备 **hash 一致**。

---

## 8. 补充：Android 流式渲染全链路（SSE → reducer → Composable）只读走查

为把“0-delta 占位/滚动”放到完整渲染链路上判断，补做一次事件→UI 的全链路走查（仍为只读，未改任何 Android 文件）。

### 8.1 事件与消费者的确切形态（`grep -rn onDelta` 在 Android 源码 0 命中）

- `clients/android/app/src/main/java/com/yansuu1/jizhang/net/SseParser.kt`：解析上游 SSE，把 `text.delta` 映射为 `AssistantGenerationEvent.TextDelta`。
- `clients/android/app/src/main/java/com/yansuu1/jizhang/repo/AssistantRepository.kt:76-88`：`streamGenerationEvents(conversationId, generationId, afterSeq)` 返回 `Flow<AssistantGenerationEvent>`（`mapNotNull` 丢弃空帧）。**没有 `onDelta` 回调形参**。
- 因此 **`onDelta` 这个 API 在 Android 客户端不存在**（`grep -rn "onDelta"` = 0 命中）；`AssistantTab.kt:402-437` 的 `collect{}` 是唯一消费者，事件一律进 reducer。
- `clients/android/app/src/main/java/com/yansuu1/jizhang/ui/feature/assistant/AssistantStreamReducer.kt:125-148`（`reduceEvent` 的 `TextDelta` 分支）：
  做 **offset 连续性校验**（`event.offset != currentText.length` → `requiresReconcile = true`，125-133），通过后把文本**追加**进 `provisionalMessages[messageId]` 并置 `visualState = RECEIVING`。
- `clients/android/app/src/main/java/com/yansuu1/jizhang/ui/AssistantTab.kt:402-437`（`subscribeToGenerationEventsImpl` 的 `collect{}`）：
  **只调用 `AssistantStreamReducer.reduceEvent`，没有行内文本直改**；`buildAssistantMergedItems(messages, currentState)`（1036）从 reducer 状态派生 `Items`；因此气泡文本只能来自 `currentState.provisionalMessages`（由 `Message`/`TextDelta` 事件或快照 `partialMessages` 填充），气泡本身**没有** `onDelta` 参数。

### 8.2 逐 delta 的重建成本（量化）

- 第 131-133 行每次 delta 都执行
  `state.copy(lastSeq=…, provisionalMessages = state.provisionalMessages + (messageId to updated), visualState=RECEIVING)` —— 即对**单条消息**的 text 做 `currentText + event.text` 字符串拼接（O(n²) 累计，n 为已累积字符数）。
- 每次 delta 之后，`AssistantTab.kt:410` 与 `428` 各调用一次 `buildAssistantMergedItems(messages, currentState)`；该函数（`AssistantConversationHelper.kt:466-613`）在每次调用时遍历全部历史消息、全部 `validatedMessages`，并构建 `historyActionStatuses` / `currentGenCards` 等临时集合——**每次 delta 重建两遍全量列表**。
- 同帧内 `remember(messages, currentGen)`（1036）只在 `currentGen` 引用变化时失效，而 `activeGenerations = activeGenerations + (targetConvId to currentState)`（414）每次 delta 都产生新引用 → **每次 delta 都会真实重算两遍**，不是缓存命中。
- 以 `research/live-stream-diagnosis.md §9.2` 记录的真实 provider 行为（单代次 10/118/143/109 个 delta）估：一次 143-delta 的回答 ≈ 286 次全量列表重建；结合“每个 delta 一次无条件 `scrollToItem`”（§4.3），单会话在一次回答内会产生数十次布局请求。**这是可量化的性能余量问题**（非正确性缺陷，本轮设备未观察到卡顿/ANR，故不作为 FAIL 项），可选优化：把气泡文本改为 `onDelta` 直写 + 只对“结构性变化”重建列表，或在 `collect{}` 里对 `wasAtBottom` 只在首/末帧判断。

### 8.3 结论

- **不是回归**：两条路径（占位兜底 + reducer 追加 + 派生列表）在状态机上是自洽的；round2 的 `*/xml` 未见渲染缺失或重复（`37/40/44` 均为“正文行 + 单张 live 卡 + 单张历史卡”结构）。
- **与本 patch 的关系**：后端修复只影响“代次出生时 answered 列是否 NULL”，不改变事件数量与增量语义；因此上述 UI 特性在本 patch 前后行为一致，不构成该 patch 的回归。
- **仍需设备侧确认的唯一 UI 项**：带**真实正文**的流式（0-delta → 首段正文）能否稳定“逐块增长”，以及 §4.3 的药丸常驻是否在真人操作下造成误解。这两项都需要一次允许 provider 的受控设备轮，本轮不做。

### 8.4 最终判定

| 项 | 结果 |
|---|---|
| 后端 patch（本部署唯一 delta）部署与运行时正确性 | **PASS**（bundle/产物 hash、独立 probe + 负对照、110 targeted tests、manifest 无表变化） |
| 后端 new-answer NULL / 原 source 原子 consume / dedup | **PASS**（源码逐行 + 事务级 + 独立不变量） |
| Android 4 项修复（占位+Stop / 滚动 / 单实例 / Text supersede） | **PASS（源码实现层）**，设备层沿用并复核了 round2 证据 |
| Android UI 回归/生命周期 | **未发现实质回归**；1 项交互缺陷（药丸常驻，中低危）+ 1 项性能余量（逐 delta 双重建） |
| 20 vs 21 表 | **笔误，非 migration nuance**；实际部署 #2 before/after 均为 **22/22 且 changed=[]** |
| env 值级比较 | **可核且已核**（`effectiveSecretValuesIdentical:true` + 全量 key 逐值 sha256） |
| 剩余 | 流式正文稳定性（需 provider 的受控设备轮）、Stop/cancel、A→B→A 隔离、导入幂等、`/confirm` |
