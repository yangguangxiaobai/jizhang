# scroll-indicator-fix.md — 短专项：阅读到最新后药丸清除与底部可见性机制

- 任务：`.trellis/tasks/10-15-ai-streaming-interactive-dialogue`
- 模块：Android `AssistantTab.kt`、`AssistantConversationHelper.kt`、`AssistantConversationHelperTest.kt`
- 产出时间：2026-10-16
- 约束已严格遵守：
  - 未连接/未操作真实设备，未安装 APK，未部署服务端；
  - 未请求 AI Provider，未执行真实记账/账本写入；
  - 未改动 backend / spec / README / task prd / implement；
  - 纯 helper/reducer 单元回归与源码最小修复。

---

## 1. 问题复核与 Source 机制分析

### 1.1 现状与已报告常驻问题
在 `research/release-postfix-acceptance.md` §4.3 及实机日志（`round2/44-s2-pending-card.xml` 等）中观察到：
- 终局（clarification 卡或 pending 卡作为新项插入）时，若最后一项底边未完全进入视口，`isGeometryAtBottom` 返回 `false`，触发 `else if (!wasAtBottom)` 分支将 `newMessagesAvailable = true`；
- 此时屏幕上出现浮动药丸“有新消息，跳到最新”；
- 随后用户阅读或下滚，内容已经完全进入视口且用户到达底部，但因为 `newMessagesAvailable` 状态的重置在此前只绑定在：
  1. 用户主动点击药丸（`AssistantTab.kt:1256-1264`）；
  2. 用户主动点击发送（`AssistantTab.kt:605`）；
  3. 点击选项追问（`AssistantTab.kt:693`）；
  4. 切换/新建会话（`AssistantTab.kt:227, 835`）；
  5. 以及仅在列表刷新时 `shouldScroll` 且主动触发过 `scrollToItem` 的极少分支。
- **缺乏在布局真实处于底部且非用户拖拽状态时的自发清除机制**。导致一旦药丸被置为 true，即使用户已经自然滑到底部并正在阅读完整最新内容，药丸依然常驻在屏幕上方，必须手动点一次才能消退。

### 1.2 区分合法用户离底与真实到达底部
1. **合法用户离底显示**：
   用户正在往上翻阅历史消息、或者新内容超出视口底部且未到底，`isGeometryAtBottom(...) == false`，此时保留药丸是合法且预期的。
2. **真实到达底部后清除**：
   当视口最后一项完全可见且底边 `offset + size <= viewportEndOffset + tolerancePx`（即 `isGeometryAtBottom == true`），并且用户当前没有处于拖拽手势中（`isScrollInProgress == false`），证明用户已经处于最新内容底部，药丸应安全自动消退。

---

## 2. 最小修复实现

### 2.1 纯辅助函数（可单元测试）
在 `AssistantConversationHelper.kt` 中引入纯判定函数：
```kotlin
fun shouldClearNewMessagesAvailable(
    isAtBottom: Boolean,
    isScrollInProgress: Boolean,
): Boolean {
    return isAtBottom && !isScrollInProgress
}
```
保证判定与 Compose 运行时解耦，满足各种边界情况的确定性单测。

### 2.2 响应式清除监听
在 `AssistantTab.kt` 中添加轻量 Compose 效应：
```kotlin
LaunchedEffect(listState, conversationId) {
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
}
```
- 严格 scoped 到 `listState` 与当前 `conversationId`，切换会话时自动 cancel 并重置；
- 不在每次 delta 时强行抢夺视口滚动（`scrollToItem`），完全保留现有流式平滑阅读逻辑；
- 保持 `send`、`selectOption`、`refreshMessages` 原有语义不变。

---

## 3. 单元回归测试与验证

在 `AssistantConversationHelperTest.kt` 中补充完整覆盖用例：
1. `isAtBottom = true, isScrollInProgress = false` -> `true`（到达底部且停止拖拽，正常清除药丸）；
2. `isAtBottom = true, isScrollInProgress = true` -> `false`（虽然到底但手指还在拖拽中，防抖暂不清除）；
3. `isAtBottom = false, isScrollInProgress = false` -> `false`（未到底且静止，保留药丸）；
4. `isAtBottom = false, isScrollInProgress = true` -> `false`（未到底且在滑动，保留药丸）；
5. 包含已有的 `isGeometryAtBottom` 大气泡边界、部分可见与用户 drag 回归用例（共 23 项单测）。

---

## 4. 验证结果与产物指纹

- **Android Unit Tests**：
  `./gradlew testDebugUnitTest --no-parallel`
  - 测试套件：10 个 testsuite
  - 通过测试数：**88 passed / 0 failed / 0 skipped**（较原 87 项新增 1 项 4 分支覆盖用例）
- **Android Lint**：
  `./gradlew lintDebug --no-parallel`
  - 结果：**BUILD SUCCESSFUL**，无新 Lint 错误。
- **Android Assemble**：
  `./gradlew assembleDebug --no-parallel`
  - 产物路径：`clients/android/app/build/outputs/apk/debug/app-debug.apk`
  - 产物 SHA-256：`111960aa06f721ba0acb3317b702b2cd11f4736d5526d92c809eb316fd30aef0`
  - 说明：由于修改了客户端源码并重新编译，产生了全新 APK 产物。此产物**尚未在物理设备上安装验证**，后续真机验收需作为独立流程进行，不得声称已完成实机验证。
