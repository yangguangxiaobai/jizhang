# 编辑器/退款/顶部错误：子代理实现状态（2026-10-22）

本文件只记录本子代理在 [账单体验任务](prd.md) 中「编辑器部分」的实际交付与证据；Shell/详情/刷新接线由父代理负责，未在本轮修改。

## 1. 范围与边界

已实现（仅这些文件）：

| 文件 | 说明 |
|---|---|
| `clients/android/app/src/main/java/com/yansuu1/jizhang/ui/TransactionEditSheet.kt` | 重写：退款 seed、统一保存、固定金额/键盘/保存 + 独立滚动元数据、顶部错误事件、insets |
| `clients/android/app/src/main/java/com/yansuu1/jizhang/ui/TransactionEditorHelper.kt` | 新增：草稿快照、校验、完整 payload、单次同步门控提交 |
| `clients/android/app/src/main/java/com/yansuu1/jizhang/ui/TransactionRefundSeedHelper.kt` | 新增：退款 seed（原支出校验、到账账户可用性、收入叶子分类） |
| `clients/android/app/src/main/java/com/yansuu1/jizhang/ui/TransactionTopErrorHelper.kt` | 新增：顶部错误事件 id/时长/关闭归属 |

未修改：`MainShell.kt`、`TransactionsTab.kt`、`DashboardTab.kt`、`TransactionDetailScreen.kt`、`ItemsTab.kt`、`clients/android/README.md`、Manifest/资源、`build.gradle.kts`。未运行 Gradle、未安装、未部署、未提交、无服务端改动。

## 2. 对外签名（父代理接线用）

```kotlin
@Composable
fun TransactionEditSheet(
    api: ApiClient,
    editId: String?,
    onAuthExpired: () -> Unit,
    onSaved: () -> Unit,
    onClose: () -> Unit,
    refundOriginalId: String? = null,   // 新增，位于既有参数之后带默认值
)
```

- `editId != null`：编辑既有账单，`refundOriginalId` 被忽略（编辑/退款互斥，由同一个身份键 `(editId, refundOriginalId)` 约束）。
- `editId == null && refundOriginalId != null`：记退款。先 GET 原账单并校验为可退款支出；不可退款时进入持久阻断状态（错误文案 + 重试/返回），不写入任何 seed。
- 可退款时 seed：`type=1`、`isRefund=true`、关联原支出 ID、金额空白、日期今天（设备本地）、可见收入叶子分类（无叶子则留空，不捏造）、原到账账户仅在仍属活跃账户时填入（否则留空并要求显式选择）。
- seed 在 `baseline` 之前应用，未改动的退款草稿不算“未保存修改”。
- 保存始终 `POST /api/v1/transactions` 新建收入；原支出从不 PATCH。

辅助 API（均在 `com.yansuu1.jizhang.ui`，JVM 可测）：

- `data class TransactionEditorDraft(type, amountText, categoryId, accountId, dateText, note, tagsText, refundLinks, isRefund)`
- `object TransactionEditorHelper`：`EXPENSE_TYPE/INCOME_TYPE`、`AMOUNT_ERROR/TARGET_ERROR/PARENT_CATEGORY_ERROR/SAVE_ERROR/REFUND_ACCOUNT_UNAVAILABLE_ERROR`、`firstLeafCategoryId`、`splitMultiValue`、`draftFromTransaction`、`validate(draft, parentIds, refundAccountUnavailable=false)`、`buildPayload(draft): JSONObject`、`buildPayloadMap(draft)`
- `class TransactionEditorSubmitter(isSaving, setSaving, onError, onAuthExpired, write, onSaved)` / `submit(scope, create, draft, parentIds, refundAccountUnavailable=false): Boolean`
- `data class TransactionRefundSeed(...).toDraft()`；`object TransactionRefundSeedHelper { NOT_REFUNDABLE_EXPENSE_ERROR, isRefundableExpense(JSONObject), buildRefundSeed(original, incomeCategories, incomeParentIds, activeAccountIds, todayText) }`
- `data class TransactionTopErrorEvent(eventId, message, durationMs)`；`object TransactionTopErrorTiming { DEFAULT_DURATION_MS = 4500L, effectiveDurationMs(Int?) }`；`class TransactionTopErrorController { show, dismiss, clear }`

保留未改的公共函数：`appendKeypadInput`、`parseYuanToCents`、`parentCategoryIds`（签名与语义不变，其他页面继续复用）。

## 3. 行为对照

- **C2 seed**：见上；`refundSeededFrom` 提示条说明“原账单不会被修改”。不预填原全额，不猜已退金额。
- **C3 回归**：多关联（`LedgerLinkPicker` multiple）保留；编辑既有账单发送完整 9 字段 payload（含 isRefund/关联）；普通新建不残留 seed（类型切换回支出时清 `isRefund`，与既有 L04.02 一致）。未新增封顶政策、未新增第三类型。
- **C4 布局**：顶部栏 + 金额区 + 数字键盘 + 保存区固定；元数据（类型段控/分类/账户/日期/备注/标签/退款关联）独立滚动。备注或标签获得焦点时隐藏自定义键盘并让出 IME 空间，金额与保存始终可见。`BoxWithConstraints` 在 `maxHeight < 600dp` 或 `fontScale >= 1.3` 时进入紧凑模式，`< 460dp` 进入更密的回退（键高 34dp、金额 22sp），避免压到不可触达。insets 使用 `WindowInsets.safeDrawing` 的 **bottom + horizontal**（safeDrawing 已包含 IME，消费后自动为 0，避免与 sheet 双重 padding）；顶部 inset 留给宿主。
- **C5 错误**：验证/保存失败进顶部浮层（编辑器自身根 Box 内，`liveRegion = Assertive`，可手动 ✕ 关闭，默认 4500ms，API 29+ 用 `getRecommendedTimeoutMillis(FLAG_CONTENT_CONTROLS)` 延长且永不缩短）。同文重发递增 `eventId` 并重置计时；旧计时器携带旧 id 调用 `dismiss` 会被拒绝，不能关闭新事件。加载阻断仍是持久文案 + 重试，不会被浮层替代；401 仍走 `onAuthExpired`。
- **C6 单次提交**：顶栏“保存”和底部按钮都调用同一个 `submit()`；校验、payload 构建、`saving=true` 全部在启动协程之前同步完成，第二次点击直接返回 false，避免重复写入；保存中拦截关闭并保留放弃草稿确认。

## 4. 本地验证（未用 Gradle，父代理统一执行）

在不修改仓库、全部在 `%TEMP%\editor-verify` 的临时目录中完成：

1. 用本机 Gradle 缓存内 `kotlin-compiler-embeddable 1.9.24` 编译 **真实 helper 源码** + 从 `TransactionEditSheet.kt` **逐字抽取**的纯函数 + 4 个新测试文件（junit 4.13.2 / org.json 20240303 / coroutines 1.7.3 / okhttp+mockwebserver 4.12.0），**0 error**。
2. `JUnitCore` 运行四个测试类：**29 tests, OK (29)**。
   - `TransactionEditorHelperTest`：金额/分类/账户/父分类/日期校验、9 字段完整 payload、非退款与支出强制空关联、中文逗号拆分、`buildPayloadMap` 与 JSON 等价、编辑重建全字段、叶子分类、键盘输入边界（单小数点/两位小数/12 字符/空退格）、双击门控（第二次点击返回 false 且只写一次）、失败后草稿可重试、401 走会话处理。
   - `TransactionRefundSeedHelperTest`：seed 预关联/空金额/今天/收入叶子/原账户复用；原账户失效留空并给出显式选择文案；无收入叶子不捏造；seed 即 baseline；seed payload 为新收入；非支出/已退款记录拒绝。
   - `TransactionTopErrorTest`：4500ms 基线、推荐时长只延长不缩短、同文新 id、旧 timer 不能关闭新事件、手动关闭与重置后 id 不回收。
   - `TransactionEditorNetworkContractTest`（MockWebServer）：退款 POST 路径/方法/`X-Requested-With`/9 字段正文，且**之后没有第二个请求**（原支出未被 PATCH）；编辑 PATCH 完整字段；普通新建无残留退款字段。
3. 用真实 Compose 编译器（`androidx.compose.compiler 1.5.14`）+ `android-34/android.jar` + 本机缓存内全部 androidx/okhttp/coroutines 产物，编译 **整个 app main 源集**：仅剩 4 个 error，全部位于 `ui/TransactionDetailScreen.kt`（父代理在改的文件）：`:173` 使用尚未声明的 `item`/`isIncome`，`:195` 调用 `reload()` 缺少 `ticket` 参数。本轮四个编辑器文件 **0 error / 0 warning**。
   - 临时编译使用了仅存在于临时目录的 `R` stub（真实构建由 AGP 生成），未写入仓库。

未执行，仍待验：`./gradlew.bat :app:testDebugUnitTest :app:assembleDebug :app:lintDebug`（父代理统一串行执行）；任何真机/模拟器表现。

## 5. 设备待验项（不在本轮声明通过）

- 小屏/横屏/超大字体下金额、键盘、保存三者同时可见与可触达；
- IME 弹出时金额与保存可见、备注/标签不叠两套键盘、收起后键盘恢复；
- 顶部错误浮层在 ModalBottomSheet/对话框窗口内可见、TalkBack 朗读与自动关闭时序、手动关闭；
- 退款路径的端到端交互（详情卡点“记录退款”→ 表单 → 保存 → 来源刷新）；
- 键盘遮挡/insets 在真实 ROM 与鸿蒙 4 上的表现。

## 6. 已知取舍与风险

- 类型切到“支出”会按既有 L04.02 清 `isRefund`；此时 seed 的关联 ID 仍留在内存（不发送），需要重新勾选“标记为退款”才生效。此为本轮保留的既有行为，未擅自改动。
- 编辑器只处理 bottom/horizontal insets，宿主（底部 sheet 或顶栏）必须负责顶部 inset；错误浮层要求把 `TransactionEditSheet` 放在承载它的最高模态宿主内部。
- 未在真机验证，故不声明任何设备侧通过项。

## 7. 回滚

只撤本文件所列 4 个 main 文件与 4 个 test 文件的差异即可；不触碰工作区既有的约 249 项混合改动，不 `reset`/`clean`。
