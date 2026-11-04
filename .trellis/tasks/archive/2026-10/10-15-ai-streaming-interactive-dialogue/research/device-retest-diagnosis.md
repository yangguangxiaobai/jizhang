# Device Retest Diagnosis & Root Cause Analysis

**Task**: `.trellis/tasks/10-15-ai-streaming-interactive-dialogue`  
**Date**: 2026-10-16  
**Auditor**: Frontend Android Implementation Specialist  
**Target**: `clients/android` (Kotlin, Jetpack Compose, Unit Tests)

---

## 1. Background & Rejection Findings

真机全项验收被父代理驳回，降级为 `PARTIAL/FAILED`。通过比对真实物理截图（`screen-01` ~ `screen-20`）与 Android 源码，确认以下四大实际故障及根因：

1. **screen-03 / screen-04 无 partial 流式正文，中间出现大空白；screen-05 突发一次性全量答案**：
   - 用户发送问题后，顶部徽章变为 `● 实时流式响应`（`RECEIVING`），底部显示“正在实时流式响应…可在上方随时停止生成”，但中间整屏为白屏空白。
   - `screen-05` 突然渲染出完整的答案，缺乏流式文本逐渐增长的可见过程。
2. **screen-15 自由文本报错 `409 ASSISTANT_CHOICE_STALE: 该追问已被回答。`**：
   - 用户在单选追问卡点击“Dining”并成功进入下一轮追问后，在底部输入普通自由文本“This is only a test, do not book any expense”并发送。
   - 客户端弹出红色报警“发送结果尚未核对：该追问已被回答。。请先刷新本对话，避免重复发送。”，服务端返回 HTTP 409。
3. **Stop 按钮为何屏幕提示“可在上方随时停止生成”但无按钮可点**：
   - 底部提示用户可在上方停止，但界面上方列表中既无正在生成的卡片，也无任何 Stop 按钮。
4. **会话 A -> B -> A 代次隔离混淆为 Tab 切换**：
   - 此前测试仅切换了底部导航栏 Tab（首页 <-> AI 助手），未在“会话管理”抽屉/页面中执行真实 Conversation A -> Conversation B -> Conversation A 切换。

---

## 2. In-Depth Root Cause Analysis

### 根因 1：`ProvisionalBubble` 仅在 `provisionalMessages` 非空时才添加，导致 TTFT 期间界面白屏且无 Stop 按钮
- **代码位置**：`AssistantConversationHelper.kt` 中的 `buildAssistantMergedItems`
  ```kotlin
  // 3. Provisional streaming messages (only if not yet replaced by validated message)
  val sortedProvisionals = activeGen.provisionalMessages.values.sortedBy { it.step }
  for (prov in sortedProvisionals) {
      if (prov.messageId !in renderedMessageIds) {
          items.add(AssistantMergedItem.ProvisionalBubble(prov.messageId, prov.text))
      }
  }
  ...
  when (activeGen.visualState) {
      StreamVisualState.CONNECTING -> items.add(AssistantMergedItem.Connecting(activeGen.generationId))
      StreamVisualState.AWAITING_CHOICE -> ...
      // 注意：这里没有 RECEIVING 分支！
  }
  ```
- **机理剖析**：
  1. 当发起流式请求后，服务端返回 202 并下发 `State(status='running')` 事件。
  2. 客户端 Reducer 将 `visualState` 变为 `RECEIVING`（显示 `● 实时流式响应`）。
  3. 但在上游大模型输出首个 token 之前（TTFT 延迟阶段，通常 1–3 秒），服务端的 `text-delta` 尚未到达，`activeGen.provisionalMessages` 为空。
  4. `buildAssistantMergedItems` 遍历 `sortedProvisionals` 为空，且 `when (activeGen.visualState)` 中完全没有 `RECEIVING` 分支。
  5. 结果：**在整个生成初期的 1–3 秒内，UI 列表项中没有任何对应的占位气泡或进度指示器，呈现为大片纯白空间**。
  6. 此外，Stop 按钮被硬编码嵌套在 `StreamingGrowingBubble` 内部。因为 `StreamingGrowingBubble` 根本没有被加入到 `items`，用户自然“无 Stop 按钮可点”！
  7. 一旦上游模型生成完毕，服务端几乎紧接着发出 `Message` 和 `Terminal` 事件，Reducer 立即把 provisional 清理并加入 final message，于是界面表现为“空白 2 秒后突然跳出完整答案”。

### 根因 2：发送消息后未滚动到底部，导致 `isAtBottom` 误判为 `false`，增量更新被丢入“跳到最新”而不在视口内自动伸长
- **代码位置**：`AssistantTab.kt` 中的 `startStreamingGeneration` 与 `subscribeToGenerationEventsImpl`
  ```kotlin
  val wasAtBottom = conversationId == targetConvId && isAtBottom(listState, countBefore)
  ...
  if (wasAtBottom && countAfter > 0 && conversationId == targetConvId) {
      withFrameNanos {}
      listState.scrollToItem(countAfter - 1)
  } else if (!wasAtBottom) {
      if (event is AssistantGenerationEvent.TextDelta || countAfter > countBefore) {
          newMessagesAvailable = true
      }
  }
  ```
- **机理剖析**：
  1. 用户在输入框点击“发送”时，`startStreamingGeneration` 并没有立即调用 `listState.scrollToItem`。
  2. 此时界面的 `lastVisibleItem` 依然停留在上一条历史消息或顶部位置。
  3. 当首个 SSE 事件到达时，`isAtBottom(listState, countBefore)` 计算返回 `false`。
  4. 随后所有的 `text-delta` 事件全部走入 `else if (!wasAtBottom)` 分支，触发 `newMessagesAvailable = true`（显示悬浮胶囊“有新消息，跳到最新”），**完全不再自动向下平滑滚动**！
  5. 用户留在上方视野，下面的气泡就算有文字增长也被遮挡在屏幕可视区域之外（或者即使在视口内，也因为前述根因 1 未添加占位）。

### 根因 3：自由文本在 `AWAITING_CHOICE` 下被强行打包为 `ChoiceText`，且 `activeGenerations` 状态锁导致使用已消费的旧 source
- **代码位置**：`AssistantTab.kt` 行 1391 附近：
  ```kotlin
  val activeGen = activeGenerations[id]
  val input = if (activeGen?.visualState == StreamVisualState.AWAITING_CHOICE && activeGen.clarification != null) {
      GenerationInput.ChoiceText(
          sourceGenerationId = activeGen.generationId,
          questionId = activeGen.clarification.id,
          text = capturedDraft.text,
      )
  } else {
      GenerationInput.Text(capturedDraft.text)
  }
  ```
- **机理剖析**：
  1. 协议规定（`protocol-v1.md` §Clarification）：**“For user ordinary text while awaiting choice, supersede and proceed normally.”**——用户在底部主输入框输入普通自由文本时，应当作为新的 `Text` 提问，服务端会自动将旧的待选追问置为 superseded（过期）并正常继续对话。
  2. 但前端将底部主输入框的所有输入盲目包裹成了 `GenerationInput.ChoiceText`。
  3. 更关键的是：在追问选项点击（`selectClarificationChoice`）后，`activeGenerations[targetConvId]` 被 `AssistantStreamReducer.lockChoice` 上锁（绑定了 `opt_dining` 和 `gen_1`）。如果下一代生成 `gen_2` 的 snapshot 或事件未能完全清除该锁定标记，或者自由文本直接取了未换新的 `activeGen`，其引用的 `sourceGenerationId` 便是已被消费的 `gen_1`。
  4. 服务端收到携带已回答 `sourceGenerationId` 的 `choice-text`，由于 `source.answered_at !== null`，严格按照规约返回：
     `409 ASSISTANT_CHOICE_STALE: 该追问已被回答。`
  5. 从而导致 `screen-15` 的红条报错。

### 根因 4：追问卡在 `MessageCard` 和 `LiveClarification` 中双重渲染，且非活动历史卡混淆为活动卡
- **代码位置**：`AssistantTab.kt` 行 1938 附近：
  ```kotlin
  val msgClar = extractClarification(message)
  if (msgClar != null && card == null) {
      ClarificationCard(
          clarification = msgClar,
          isLive = false,
          selectedOptionId = null,
          onSelectOption = {},
      )
  }
  ```
- **机理剖析**：
  - 历史消息中已经包含了带 `clarification` 的消息气泡。
  - 同时 `buildAssistantMergedItems` 在 `activeGen.visualState == AWAITING_CHOICE` 时，又在列表最下方插入了一个 `LiveClarification`。
  - 导致屏幕上出现两个一模一样的单选追问卡（见 `screen-12`），视觉与层级严重混乱。

---

## 3. 修复方案实施细节

### 修复 1：流式与连接状态立即渲染 `StreamingGrowingBubble` 并暴露 Stop 按钮
- 在 `buildAssistantMergedItems` 中：
  - 当 `activeGen.visualState` 处于 `CONNECTING` 或 `RECEIVING` 时：
    - 如果 `activeGen.provisionalMessages` 已有增量内容，正常按 step 排序渲染 `ProvisionalBubble`；
    - 如果 `activeGen.provisionalMessages` 尚为空（上游首包等待中），**插入占位 `ProvisionalBubble(messageId = "provisional_${activeGen.generationId}", text = "")`**。
    - `StreamingGrowingBubble` 自身具备 `text.ifBlank { "正在生成回答…" }` 及 `LinearProgressIndicator` 进度条与 **Stop 停止按钮**。
    - 这样用户从点击发送的第一秒起，就能看到规范的“流式生成中 · 结构化草案”卡片与明确的“停止生成”按钮，杜绝大片空白！

### 修复 2：发送消息与首包到达时强制平滑滚动到底部
- 在 `startStreamingGeneration` 触发后，立即触发 `listState.scrollToItem` 滚动到当前最新输入项底部，确保列表视野跟随最新消息。
- 在 `subscribeToGenerationEventsImpl` 中，首个事件到达或气泡生成时，确保视野锁定底部，使得流式文本的实时动态生长直接对用户可见。

### 修复 3：解耦底部通用输入框与特定追问，正确实现普通自由文本的 Supersede 语义
- 根据 `protocol-v1.md` §Clarification：普通用户自由文本输入属于覆盖/继续对话，发送 `GenerationInput.Text`，由服务端自动执行 supersede；
- 只有明确关联到追问卡输入时才构造 `ChoiceText`。
- 同时在 `selectClarificationChoice` 后，新 generation 产生时清空旧的 `selectedOptionId` 与 `pendingChoiceRequestId`，确保代次彻底换新。

### 修复 4：消除追问卡双重渲染
- 当代次已经处于最新活体状态并在底部渲染 `LiveClarification` 时，历史消息中同一代次的追问卡不重复以单独组件二次绘制，保持单实例清晰交互。

---

## 4. 验证与回归测试策略
1. **单元测试回归**：
   - 更新 `AssistantConversationHelperTest` 与 `AssistantStreamReducerTest`，覆盖：
     - 空 provisional 时 `buildAssistantMergedItems` 正确输出带 Stop 按钮的占位 `ProvisionalBubble`；
     - 自由文本发送正确使用 `GenerationInput.Text` 规避 `409 ASSISTANT_CHOICE_STALE`；
     - `StreamingGrowingBubble` 的 Stop 点击事件连通性；
     - 真正 Conversation A -> B -> A 切换时的代次重置与隔离。
2. **构建与签名产物核验**：
   - 运行 `./gradlew testDebugUnitTest lintDebug assembleDebug`；
   - 记录新构建 APK 的 SHA-256 哈希值；
3. **真机部署与逐项严格实测**：
   - 采用 `adb install -r` 升级至真机；
   - 针对驳回的 4 个要点（流式字符增长录制、自由文本追问、Stop 服务端取消、Conversation A->B->A 切换）重新采集证据。
