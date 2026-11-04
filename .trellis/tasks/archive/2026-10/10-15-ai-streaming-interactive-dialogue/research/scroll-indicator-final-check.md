# scroll-indicator-final-check.md — 最终Android药丸修复独立只读核验

- 任务：`.trellis/tasks/10-15-ai-streaming-interactive-dialogue`
- 范围：只读核验，不改 source/test、不编译、不碰设备/provider/部署/配置/stage/commit
- 状态：COMPLETE
- 日期：2026-10-16
- 依据：`research/scroll-indicator-review.md`（COMPLETE）、`research/scroll-indicator-fix.md`（历史）、`research/protocol-v1.md`（冻结契约）、`check.jsonl`/`implement.jsonl`（上下文索引）、磁盘 XML（10 suites）与 `artifacts/phone-verifier-scroll-final/` 日志

---

## 1. 核验对象（文件行号，实际磁盘）

### 1.1 `clients/android/app/src/main/java/com/yansuu1/jizhang/ui/AssistantTab.kt`（全长 2258 行）
- 修复核心 `LaunchedEffect(listState, conversationId)` + `snapshotFlow`：**L840–852**
  - L841 `snapshotFlow {`；L842–845 由 `messages` + `conversationId?.let { activeGenerations[it] }` 经 `buildAssistantMergedItems(...).size` 求 `totalCount`，再 `isAtBottom(listState, totalCount)`；
  - L847 `Triple(newMessagesAvailable, atBottom, listState.isScrollInProgress)`；
  - L848–852 `.collect { (hasNew, atBottom, isScrolling) -> if (hasNew && shouldClearNewMessagesAvailable(atBottom, isScrolling)) newMessagesAvailable = false }`。
- 私有 `isAtBottom(state, count)`：**L2235–2247** —— `layoutInfo.visibleItemsInfo` 映射为 `ScrollItemGeometry(index, offset, size)`，委托 `isGeometryAtBottom(..., isScrollInProgress = state.isScrollInProgress)`。
- 药丸 UI：**L1270–1283** —— `if (newMessagesAvailable) OutlinedButton("有新消息，跳到最新")`，点击滚动到底并置 `false`（L1279）。
- `newMessagesAvailable` 全部写点：L228（selectConversation 切会话清零）、L328/L331（installMessages：离底置 true / 需滚动清零）、L435（流式 `!wasAtBottom` 置 true）、L606（send 后清零）、L694（选项追问清零）、L741（refresh 后清零）、L835（`LaunchedEffect(conversationId)` 切会话清零）、L850（本轮修复的自发清除）、L1279（点击药丸清零）。

### 1.2 `clients/android/app/src/main/java/com/yansuu1/jizhang/ui/feature/assistant/AssistantConversationHelper.kt`（全长 717 行）
- `shouldClearNewMessagesAvailable(isAtBottom, isScrollInProgress)`：**L374–379**，`return isAtBottom && !isScrollInProgress`。
- 重载 `shouldClearNewMessagesAvailable(hasNewMessages, isAtBottom, isScrollInProgress)`：**L381–386**，`return hasNewMessages && isAtBottom && !isScrollInProgress`。
- `isGeometryAtBottom(...)`：**L398–422** —— `if (isScrollInProgress) return false`；`totalCount == 0 -> true`；空视口 `false`；要求末项 `index >= totalCount - 1` 且 `offset + size <= viewportEndOffset + tolerancePx(4)`。
- `ScrollItemGeometry`：**L368–372**。

### 1.3 `clients/android/app/src/test/java/com/yansuu1/jizhang/ui/feature/assistant/AssistantConversationHelperTest.kt`（全长 849 行）
- 四象限 + 无 pending 否定用例：**L746–765**（覆盖两重载 2×5 断言，含 `hasNewMessages=false -> false`）。
- `testSnapshotFlowEmitsWhenNewMessagesAvailableChangesWithUnchangedGeometry`：**L768–805** —— 真实 `snapshotFlow { Triple(...) }` + `mutableStateOf` + `Snapshot.withMutableSnapshot { newMessagesAvailable = true }` + `sendApplyNotifications()`，断言发射数 1→2 且第二元为 `Triple(true, true, false)`，再断言两重载清理判定均为 true。
- `testContrastOldPairVersusNewTripleOnPendingStateChange`：**L807–848** —— 同一状态跃迁下旧 `Pair(isAtBottom, isScrollInProgress)`（L821）停留 1 个发射（被去重吞掉），新 `Triple(...)`（L822）递增为 2（L837–842 断言）。

---

## 2. Triple 观察正确性 / 无限 loop / pending-only 触发

- **观察正确**：`newMessagesAvailable`（`remember { mutableStateOf }`，L176）在 `snapshotFlow` 块内被读取（L847），Compose 快照系统将其纳入追踪；`false -> true` 跃迁即使几何 `(atBottom, isScrolling)` 不变也会产生新 `Triple`并发射。`review.md §1.1` 对旧 `Pair` 被 `distinctUntilChanged` 吞掉的根因分析成立，与测试负对照一致。
- **无无限 loop**：清除写 `true -> false` 只再产生一次 distinct 发射 `Triple(false, atBottom, scrolling)`，collect 第二次进入时 `hasNew == false` 不再写，静止收敛。写点在 collect 回调内对同一被观察状态单调清零，无回弹路径（其他置 true 路径均需新事件/离底条件）。
- **pending-only 更新触发**：由 L807–848 负对照证明——几何冻结时旧 Pair 零发射、新 Triple 恰增一发射；L768–805 证明 `Triple(true, true, false)` 到达 collect 并触发两重载清理判定。
- **副作用边界**：`snapshotFlow` 块内每次重算调用 `buildAssistantMergedItems`（L842–845）；text-delta 每次更新 `activeGenerations` 都会触发重算，但 `Triple` structural equality 下文本增长不改变三元组则不发射、不写状态，仅几何翻转或 pending 翻转才发射。本轮不做性能重构（任务明确禁止无关重构），此处仅记录事实。

## 3. 会话 keys / drag / bottom 几何不吞用户离底提示

- **会话键**：`LaunchedEffect(listState, conversationId)`（L840）——切会话自动 cancel 重启；且 `LaunchedEffect(conversationId)`（L828–838）在 L835 置 `newMessagesAvailable = false`，`selectConversation`（L228）同样清零。跨会话 A→B→A 不会把旧会话药丸带到新会话。
- **drag 保护**：`isGeometryAtBottom` 在 `isScrollInProgress == true` 时直接返回 false（helper L406）；两重载 `shouldClear` 均要求 `!isScrollInProgress`。手指仍在拖拽时即使几何到底也不自发清除，药丸保留。
- **bottom 几何严格**：要求末项索引到位 + 底边 `offset + size <= viewportEndOffset + 4px`（helper L414–421），大 item 顶部可见但底部溢出视口时返回 false，不误判到底。合法离底（上翻历史 / 新内容溢出未到底）药丸保留；仅“真到底 + 静止 + 有 pending”才清除。
- **流式写入侧一致**：`subscribeToGenerationEventsImpl` L412–435 —— `wasAtBottom` 则 `scrollToItem` 跟随，`!wasAtBottom` 且文本增量到达则置 true；与 L848 自发清除形成“离底提示 / 到底消退”闭环，不抢用户上滑阅读（delta 不强制滚动除非本来就在底部）。

## 4. 新测试真实性（非假模拟）

- 两新增测试使用**真实** `androidx.compose.runtime.snapshotFlow` + `mutableStateOf` + `Snapshot.withMutableSnapshot/sendApplyNotifications`（L768–805，L807–848），非手写 fake emitter。
- 负对照是同一跃迁下并行的旧 `Pair` 流（L821）与新 `Triple` 流（L822），断言 `old==1, new==2`（L831–842），直接复现了线上“几何不变 + pending 翻转被吞”缺陷形状，而非仅断言纯函数。
- 纯函数重载（3 参版供测试 / 2 参版供生产调用 L849）语义一致：`hasNew=false` 时 3 参版返回 false（L764），生产 2 参版调用前已有 `hasNew &&` 短路（L849），无语义漂移。

## 5. Gradle XML 与日志/SHA 只读解析

- 磁盘 `clients/android/app/build/test-results/testDebugUnitTest/TEST-*.xml`（10 suites）header 只读解析：
  - CancellableBlockingFlow 1 / NetworkContract 10 / SseParser 12 / InputContract 4 / ProviderSettingsHelper 5 / **AssistantConversationHelper 25** / AssistantDuplicateState 5 / AssistantIdentityCoordinator 6 / AssistantImportState 10 / AssistantStreamReducer 13 —— 合计 **91 tests / 0 failures / 0 errors / 0 skipped**（1+10+12+4+5+25+5+6+10+13=91），与 `review.md §2.2`（23→25，基线 89→91）一致；旧 `fix.md` 的 88 系少计 1 项的手民之误（`review.md §2.1` 已更正）。
  - Helper XML 内 `testcase` 计数 25，含 `testSnapshotFlowEmitsWhenNewMessagesAvailableChangesWithUnchangedGeometry` 与 `testContrastOldPairVersusNewTripleOnPendingStateChange`。
- `artifacts/scroll-indicator-final-{test,lint,assemble}.log` 尾部：`testDebugUnitTest UP-TO-DATE / BUILD SUCCESSFUL`、`lintDebug BUILD SUCCESSFUL`、`assembleDebug BUILD SUCCESSFUL`。本轮未重新执行构建（手机正在测最终 APK，按任务要求不编译），仅只读复核既有日志。
- SHA-256（只读复核 `artifacts/phone-verifier-scroll-final/`）：
  - 本地产物 `02-local-apk-sha256.txt`：`5c004350fefcfe7b3b284f94a5972fba03c6e28ce23f99b5ad8b7176d083896e`。
  - `12-byte-equality.txt`：`cmp: IDENTICAL`，本地 APK 与设备 pull 回的 `base.apk` hash 同为 `5c004350…`。
  - `00-preinstall-installed-sha256.txt`：`d2a37b55…` 为安装前旧包，与本轮 `5c004350…` 不同，属预期（旧版残留 → 新版覆盖安装）。

## 6. 结论与阻断

- **结论**：Triple 修复机制正确、无限 loop 不成立、pending-only 触发得证、会话/drag/几何保护用户离底提示、两新增测试为真实 `snapshotFlow` 含 Pair 负对照。`protocol-v1.md` 为后端/SSE 契约，本 UI 药丸清除为纯客户端视觉状态，不触达协议字段，无契约变更。
- **阻断**：无实质 bug，无最小 repro 需要。本轮未发现 P0/P1 级缺陷；真机动效验收由 phone-verifier 既有产物覆盖，不在本只读核验范围内重复断言。
- **未做事项**（按任务约束）：未改任何 source/test、未编译、未碰设备/provider/部署/配置、未 stage/commit；唯一写入为本文件（RUNNING→COMPLETE 语义的终态记录）。
