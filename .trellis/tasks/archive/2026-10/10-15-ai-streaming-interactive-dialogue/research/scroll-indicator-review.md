# scroll-indicator-review.md — 滚动药丸清除与观察机制终态复核

- 任务：`.trellis/tasks/10-15-ai-streaming-interactive-dialogue`
- 模块：Android `AssistantTab.kt`、`AssistantConversationHelper.kt`、`AssistantConversationHelperTest.kt`
- 状态：COMPLETE
- 日期：2026-10-16

---

## 1. 机制核对与根因分析

### 1.1 根因：`snapshotFlow` 抑制未被观测的 pending 状态变化
在此前实现中，`AssistantTab.kt` 中的滚动状态观察为：
```kotlin
snapshotFlow {
    val totalCount = buildAssistantMergedItems(
        messages,
        conversationId?.let { activeGenerations[it] }
    ).size
    val atBottom = isAtBottom(listState, totalCount)
    atBottom to listState.isScrollInProgress
}.collect { (atBottom, isScrolling) ->
    if (newMessagesAvailable && shouldClearNewMessagesAvailable(atBottom, isScrolling)) {
        newMessagesAvailable = false
    }
}
```
其存在确切逻辑漏洞：
1. `snapshotFlow` 仅观察块内读取的状态。块内仅读取了 `messages`、`activeGenerations`、`conversationId`、`listState` 派生的 `atBottom` 和 `isScrollInProgress`，产生一个 `Pair(atBottom, isScrolling)`；
2. `newMessagesAvailable` 变量未在 `snapshotFlow` 内部读取，而仅在后续的 `.collect` 回调中读取；
3. `snapshotFlow` 内置 `distinctUntilChanged` 过滤机制。当用户停留在底部（`atBottom = true, isScrolling = false`）时，`snapshotFlow` 已产出 `(true, false)`；
4. 当新卡片或文本插入并触发 `newMessagesAvailable` 从 `false` 变为 `true` 时，若视口几何状态未发生跳变（仍为 `atBottom = true, isScrolling = false`），`snapshotFlow` 内部求得的 Pair 依然是 `(true, false)`；
5. 由于输出与上一帧相同，`snapshotFlow` **完全不发射事件**，`.collect` 根本不执行，导致 `newMessagesAvailable` 保持 `true` 无法自动清除，药丸常驻。

### 1.2 最小修正：引入 `Triple(newMessagesAvailable, atBottom, isScrollInProgress)`
在 `AssistantTab.kt` 的 `snapshotFlow` 中将 `newMessagesAvailable` 纳入发射元组：
```kotlin
snapshotFlow {
    val totalCount = buildAssistantMergedItems(
        messages,
        conversationId?.let { activeGenerations[it] }
    ).size
    val atBottom = isAtBottom(listState, totalCount)
    Triple(newMessagesAvailable, atBottom, listState.isScrollInProgress)
}.collect { (hasNew, atBottom, isScrolling) ->
    if (hasNew && shouldClearNewMessagesAvailable(atBottom, isScrolling)) {
        newMessagesAvailable = false
    }
}
```
- 当 `newMessagesAvailable` 单独从 `false` 变为 `true` 时，Compose 快照系统立即捕获该状态变更，重新评估 `snapshotFlow` 并发射 `Triple(true, atBottom, isScrolling)`；
- `.collect` 触发后，若当前已在底部且未在拖拽（`isAtBottom == true && !isScrolling`），立即重置 `newMessagesAvailable = false`，药丸自然消退；
- 绝不改动 `send` 逻辑、不改动追问协议、不改动用户上滑阅读机制、不在每个 text-delta 强制执行 `scrollToItem` 抢夺焦点。

---

## 2. 单元测试回归与 XML 真实计数校正

### 2.1 历史报告偏差核对
- 旧文档 `research/scroll-indicator-fix.md` 记录“88 passed”，经实际磁盘 `clients/android/app/build/test-results/testDebugUnitTest/TEST-*.xml` 解析核验：
  - `TEST-com.yansuu1.jizhang.net.CancellableBlockingFlowTest.xml`: 1
  - `TEST-com.yansuu1.jizhang.net.NetworkContractTest.xml`: 10
  - `TEST-com.yansuu1.jizhang.net.SseParserTest.xml`: 12
  - `TEST-com.yansuu1.jizhang.ui.InputContractTest.xml`: 4
  - `TEST-com.yansuu1.jizhang.ui.ProviderSettingsHelperTest.xml`: 5
  - `TEST-com.yansuu1.jizhang.ui.feature.assistant.AssistantConversationHelperTest.xml`: 23
  - `TEST-com.yansuu1.jizhang.ui.feature.assistant.AssistantDuplicateStateTest.xml`: 5
  - `TEST-com.yansuu1.jizhang.ui.feature.assistant.AssistantIdentityCoordinatorTest.xml`: 6
  - `TEST-com.yansuu1.jizhang.ui.feature.assistant.AssistantImportStateTest.xml`: 10
  - `TEST-com.yansuu1.jizhang.ui.feature.assistant.AssistantStreamReducerTest.xml`: 13
  - **实际真实基线计数值为 89 项**（旧 report 88 系手民之误少计 1 项）。

### 2.2 本轮补充回归单测
在 `AssistantConversationHelperTest.kt` 中利用现有 Compose runtime 依赖补充纯 JVM 状态与流式响应测试（不引入外部依赖）：
1. `testSnapshotFlowEmitsWhenNewMessagesAvailableChangesWithUnchangedGeometry`:
   - 验证几何状态保持 `(isAtBottom=true, isScrollInProgress=false)` 不变，仅 `newMessagesAvailable` 发生 `false -> true` 跃迁时，`snapshotFlow` 能够感知快照通知并成功发射第 2 个元素 `Triple(true, true, false)`，随后正确触发清理决策；
2. `testContrastOldPairVersusNewTripleOnPendingStateChange`:
   - 对比基准测试：在同一状态变化过程中，旧 `Pair(isAtBottom, isScrollInProgress)` 发射数停留在 1（被静默吞掉），新 `Triple(newMessagesAvailable, isAtBottom, isScrollInProgress)` 发射数递增为 2，严格证明了旧机制的缺陷与新机制的有效性；
3. `AssistantConversationHelper.kt` 补充重载 `shouldClearNewMessagesAvailable(hasNewMessages, isAtBottom, isScrollInProgress)` 保持判定纯函数可测。

- **最终单元测试计数**：
  `AssistantConversationHelperTest` 用例数由 23 增加至 25，总测试用例数提升为 **91 passed / 0 failed / 0 skipped**（10 个 testsuite 全部绿色通过）。

---

## 3. 验证执行与产物日志

所有构建均在单进程 `--no-parallel` 模式下执行，日志归档于 `artifacts/`：

| 校验步骤 | 执行命令 | 结果 | 归档日志文件 |
| :--- | :--- | :--- | :--- |
| **Unit Tests** | `./gradlew testDebugUnitTest --no-parallel` | **91 passed / 0 failed** | `artifacts/scroll-indicator-final-test.log` |
| **Android Lint** | `./gradlew lintDebug --no-parallel` | **BUILD SUCCESSFUL (0 errors)** | `artifacts/scroll-indicator-final-lint.log` |
| **Android Assemble** | `./gradlew assembleDebug --no-parallel` | **BUILD SUCCESSFUL** | `artifacts/scroll-indicator-final-assemble.log` |

### 最终产物指纹
- APK 路径：`clients/android/app/build/outputs/apk/debug/app-debug.apk`
- APK SHA-256：`5c004350fefcfe7b3b284f94a5972fba03c6e28ce23f99b5ad8b7176d083896e`

### 边界说明
- 本轮未连接物理设备、未执行真实安装与真机操作；
- 未调用真实外部 AI Provider，未发生真实数据库账本写入；
- 未操作 git stage/commit；
- 本产物交付为后续独立 `phone-verifier` 进行真机安装与 UI 动效核验。
