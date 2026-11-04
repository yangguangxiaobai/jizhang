# Android & UX Investigation: AI Bill Import Improvements

- **Status**: COMPLETED (Investigation finished; evidence captured for parent task planning)
- **Investigator**: yansuu1 (ReadOnly Investigation Specialist)
- **Task**: `.trellis/tasks/10-17-ai-bill-import-improvements`
- **Methodology**: Static codebase analysis across Android UI/Repo layers, Shared parsing utilities, and Server Assistant/Portability engines. No device execution claimed; all observations grounded in source `file:line` facts. No production/test/spec code modified.

---

## 1. Executive Summary & Core Findings

1. **"AI 分类没有而归其他" 的代码级根因**：
   - **服务端解析层兜底**：`packages/shared/src/platform-bills.ts:246, 254` 在解析微信/支付宝账单时，基于静态关键词列表（`EXPENSE_KEYWORDS` / `INCOME_KEYWORDS`）推导分类。若未匹配任何关键词，则硬编码直接返回 `"其他"` 或 `"其他收入"`。
   - **AI 建议的脆弱性熔断（全批丢弃）**：`packages/server/src/services/bill-import-analysis.ts:28` 校验大模型返回的 `categoryId`，要求必须严格是用户既有同类型分类之一。若大模型返回了分类名称（如 `"餐饮"` 而非 UUID）、建议了新分类、或给出了跨类型 ID，`normalizeBillRecommendations` 直接抛出 `AiResponseInvalidError`；在外层 `packages/server/src/services/assistant-orchestrator.ts:161` 中被 `catch` 吞没，导致整批 25 条甚至全文件的 recommendations 被重置为空列表（`status: failed`），导致 AI 分类建议被彻底丢弃。
   - **Android 客户端的空值展现**：在 `AssistantImportState.kt:33` 与 `AssistantImportWorkspace.kt:682` 中，若 AI 建议未返回有效 `categoryId` 且用户未手动 override，展示为 `"未选分类"`，并由于 `canContinue` 校验阻断用户继续核对，提示 `"所选行中存在未指定分类的账单，请先点击编辑分类"`。
2. **"排除按钮不可用或含义不明" 的代码级根因**：
   - **主工作区列表无独立"排除"按钮**：主列表行卡片（`AssistantImportRowCard`）仅有勾选框（`Checkbox`）与状态展示。虽然 AI 提示框中写有 `"AI建议：建议排除 · <理由>"`，但卡片上没有对应的"排除"操作按钮，造成认知断层。
   - **唯一带有"排除"文案的按钮在疑似重复对比页**：`AssistantDuplicateComparisonScreen` 中提供 `"排除此笔（不导入，防止重复入账）"`（`AssistantImportWorkspace.kt:1223, 1257`）。
   - **交互本质仅为内存集合减法（语义模糊）**：点击该按钮的实现为 `onSelection(selected - source.id)`。若该行本就未被勾选，点击后界面无任何变化与反馈，用户会误以为"按钮不可用/失效"；且该操作并不建立持久规则，仅取消单次入账选择。
   - **硬性禁用条件**：当行事实为 `!source.eligible`（如金额无效或硬重复已入账）、或处于 `busy`（提交中）、`uncertain`（状态不确定）时，该按钮被代码显式禁用。
3. **"单文件限制" 的代码级现状**：
   - **Android 侧**：`AssistantTab.kt:770` 使用单选契约 `ActivityResultContracts.GetContent()`，草稿数据结构 `AssistantComposerDraft`（`AssistantTab.kt:116`）仅持有一个 `attachment: SelectedDocument?`，无论 UI 还是草稿均只支持单个文件。
   - **协议与服务端**：`assistant.ts` 及 `platform-import.prepare` 工具以单文件哈希 `sha256` 绑定单次操作生命周期与 200 行预览 / 100 行选择硬上限。
4. **"新建分类" 入口现状（R4 探索）**：
   - 当前 Android 导入界面（`AssistantImportWorkspace.kt:236`）明确标注 `"请选择现有同类型分类；不创建新分类"`；无任何新建分类按钮或跳转入口，严格遵守既有稳定契约 `A028`。

---

## 2. 关联稳定 IDs、字段、验证与入口契约

依据 `clients/android/README.md` 与实际源码对照：

| 稳定 ID | 规范要求与字段约束 | 源码实现位置 |
| :--- | :--- | :--- |
| **A015** | 系统选单附件并显示文件名/KB；上传完成核对 ticket、会话、草稿一致性；取消不改草稿；字节仅保存在当前进程内存 | `AssistantTab.kt:770-785` |
| **A016** | 只接受非空 CSV/XLSX、≤5MiB；微信 XLSX / 支付宝 CSV 由服务端解析；Android source 固定 auto；无来源选择 UI | `DocumentFiles.kt:20-34`；`AssistantImportWorkspace.kt:50-53` |
| **A017** | 每次只附一个文件；无通用多文档同时分析入口 | `AssistantTab.kt:116, 1293` |
| **A021** | 导入操作卡提供全屏工作区入口按钮 | `AssistantTab.kt:2043` |
| **A023** | 全屏二次核对所选收支合计、退款标签、每行现有分类与审核备注（空值明确）；返回不写账，0选择禁止确认 | `AssistantTab.kt:1490-1538`；`AssistantImportWorkspace.kt:491` |
| **A024** | 平台导入始终传非空显式 `selectedIds`（1–100），不省略全文件；仅传所选行覆盖；未知结果提示并刷新 | `AssistantRepository.kt:114-132`；`AssistantTab.kt:1554` |
| **A026** | 全屏最多前 200 行预览；本地搜索/筛选（全部/已选入/未选/疑似重复）；未展示行不导入 | `AssistantImportWorkspace.kt:348`；`AssistantImportState.kt:9, 39` |
| **A027** | 初始选择来自完成的 AI 建议，最多 100；AI 失败初始不选；仅已存在/非正金额硬锁定无法选入 | `AssistantImportState.kt:20, 36` |
| **A028** | 编辑页仅选择现有活跃同类型可记账分类 ID，不创建/恢复分类；审核备注≤200字符；缺分类阻断继续 | `AssistantImportWorkspace.kt:233-270` |
| **A029** | 显式选择及发送覆盖最多 100，预览 200；审核草稿保留已编辑分类；0 禁继续，缺分类禁继续 | `AssistantImportWorkspace.kt:488`；`AssistantImportState.kt:6, 7` |
| **A030** | 原件仍需长度 + SHA-256 匹配本 action 才允许绑定与确认；离开页面/进程丢附件需重新选原件 | `AssistantTab.kt:758-765, 870-875` |
| **A031** | 原件不一致不执行；终态后清理本地行选择/附件/分类覆盖 | `AssistantTab.kt:800-808, 1389` |
| **A101** | 疑似重复行对比现有账单：来源日期/整数分金额/类型/独立退款/账户/分类/备注 | `AssistantImportWorkspace.kt:940-1320`；`AssistantDuplicateState.kt` |
| **A102** | 对比候选分页展示；显式保留/排除只改来源 ID，遵守有效未导入/忙碌/未知结果/100 行上限 | `AssistantImportWorkspace.kt:1208-1275`；`AssistantDuplicateState.kt:30` |

---

## 3. 文件 Picker、SAF、DocumentFiles 与附件草稿调查

### 3.1 文件选择器机制
- **当前 Contract**：
  - `AssistantTab.kt:770`：`val composerPicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri: Uri? -> ... }`
  - 采用 Android 系统 `GetContent()` 单选契约，**不是** `OpenMultipleDocuments` 也不是 `GetMultipleContents`。
  - 调用入口（`AssistantTab.kt:1335`）：`composerPicker.launch("*/*")`。
- **文件校验与限制（`DocumentFiles.kt` & `AssistantImportWorkspace.kt`）**：
  - `DocumentFiles.kt:20-34`（`readDocument`）：
    - 通过 `context.contentResolver.query(uri, [OpenableColumns.DISPLAY_NAME], ...)` 获取原始文件名（无则回退为 `"attachment"`）。
    - 内存中读取流，硬限制单文件大小不得超过 `5 * 1024 * 1024` 字节（5MiB）。
  - `AssistantImportWorkspace.kt:50-53`（`requireAssistantDocument`）：
    - 后缀校验：`document.name.endsWith(".csv", true) || document.name.endsWith(".xlsx", true)`。
    - 大小校验：`document.bytes.isNotEmpty() && document.bytes.size <= 5 * 1024 * 1024`。
- **易失内存草稿（`AssistantComposerDraft`）**：
  - 定义（`AssistantTab.kt:116`）：
    ```kotlin
    private data class AssistantComposerDraft(
        val text: String = "",
        val attachment: SelectedDocument? = null,
        val requestId: String? = null,
    )
    ```
  - 状态容器（`AssistantTab.kt:148`）：`var drafts by remember { mutableStateOf(mapOf<String, AssistantComposerDraft>()) }`。
  - **关键特征**：
    - 仅支持单附件（`val attachment: SelectedDocument?`）。
    - 仅保存在 Compose 内存状态中，未持久化到 SQLite 或 DataStore。
    - 跨对话切换保留（通过 `conversationId` 索引），但进程被杀或切出父级 Tab 卸载时丢弃（符合 A007/A033 契约）。
- **二次核对时的原件重选（`actionFilePicker`）**：
  - 定义在 `AssistantTab.kt:790`，同样使用 `ActivityResultContracts.GetContent()`。
  - 当进程重启或离开过页面导致 `actionFiles[actionId] == null` 时触发，要求用户重新选取同一文件，并在 `AssistantTab.kt:800` 进行严密哈希核验：`document.bytes.size.toLong() == expectedSize && sha256Hex(document.bytes).equals(expectedHash, ignoreCase = true)`。

---

## 4. 全量按钮与交互元素台账（逐按钮审计）

本节逐一列出导入全链路涉及的所有按钮、标签、`onClick` 数据流、`enabled` 条件、硬阻断因素及视觉来源。

### 4.1 导入工作区主界面（`AssistantImportWorkspace.kt`）

| # | 按钮/组件名称 | 代码位置 | 标签文案 / 图标 | `onClick` 数据流 | `enabled` 判定条件 | 硬阻断因素 (Hard Blockers) | 视觉说明来源 / Token |
|---|---|---|---|---|---|---|---|
| **1** | 返回导航按钮 | `178-185` | `Icons.AutoMirrored.Filled.ArrowBack`，描述："返回导入预览/返回聊天" | `if (editing != null) editing = null else onBack()` | 始终为 `true`（未设 enabled 参数） | 无 | 顶部 App Bar；44dp 触摸区；`t.fg` |
| **2** | 分类筛选标签 (FilterChip) | `348-372` | "全部 ($count)"、"已选入 ($count)"、"未选 ($count)"、"疑似重复 ($count)" | `filter = label` | 始终为 `true` | 无 | `FilterChip`；选中有色高亮；疑似重复使用黄色预警调 |
| **3** | 全选筛选结果 | `385-390` | "全选筛选结果 (最多100)" | `onSelection(selectVisibleImportRows(selected, visible))` | `pending && !busy && selected.size < 100 && visible.any { it.eligible }` | 1. `selected.size >= 100`<br>2. 筛选结果中无任何有效行（全部为硬重复或非正金额）<br>3. `busy` 或非 `pending` | `TextButton`；`MaterialTheme.typography.labelMedium` |
| **4** | 清空选择 | `391-396` | "清空选择" | `onSelection(emptySet())` | `pending && !busy && selected.isNotEmpty()` | 1. 当前已选集合为空（`selected.isEmpty()`）<br>2. `busy` 或非 `pending` | `TextButton`；`MaterialTheme.typography.labelMedium` |
| **5** | 重新分析账单 | `639-644` | `Icons.Filled.Refresh` + "重新分析账单" | `onRetryAnalysis()` -> 调用 `repo.analyseAction(actionId, bytes)` | 仅在 `pending && !busy && sourceReady && !uncertain` 时渲染 | 1. 原件未就绪（`sourceReady == false`）<br>2. 结果待核对（`uncertain == true`）<br>3. `busy` | `TextButton`；高度 32dp；次级辅助操作 |
| **6** | 刷新核对执行结果 | `469-478` | `Icons.Filled.Refresh` + "刷新核对执行结果" | `onRefresh()` -> 刷新当前对话消息与卡片 | 仅在 `uncertain == true` 时渲染，默认 `true` | 无（专门用于解除 uncertain 锁死） | 警告色 `t.warning` 容器；高度 42dp；全宽主按钮 |
| **7** | 继续核对账单 (主执行) | `491-499` | "继续核对 ${selected.size} 行账单" | `onContinue()` -> 进入确认弹窗（`requestConfirm(actionId, true)`） | `pending && !busy && !uncertain && sourceReady && selected.size in 1..100 && rows.filter { it.id in selected }.all { row -> categories.any { it.id == reviewedImportCategory(row, overrides) && it.type == row.type } }` | 1. **所选账单存在缺失分类**（最常见阻断原因！）<br>2. 选中数量为 0 或 > 100<br>3. 原始账单文件丢失未重选（`!sourceReady`）<br>4. 操作正在提交中或状态不确定 | 底部吸底面板主 CTA；`t.accent` 背景，高度 48dp |
| **8** | 重新核对原件 / 选择原件 | `506-511` | `if (sourceReady) "重新核对原件" else "选择原件(≤5MiB)"` | `onChooseSource()` -> 打开文件选择器核对原件摘要 | `pending && !busy` | 处于提交中（`busy`）或非 `pending` 状态 | 底部次要 `TextButton` |
| **9** | 取消导入 | `512-517` | "取消导入" | `onCancel()` -> 调用 `repo.cancelAction(actionId)` | `pending && !busy` | 处于提交中（`busy`）或非 `pending` 状态 | 底部次要 `TextButton`；字体为 `t.muted` |

### 4.2 账单卡片与行内操作（`AssistantImportWorkspace.kt: AssistantImportRowCard`）

| # | 按钮/组件名称 | 代码位置 | 标签文案 / 图标 | `onClick` 数据流 | `enabled` 判定条件 | 硬阻断因素 (Hard Blockers) | 视觉说明来源 / Token |
|---|---|---|---|---|---|---|---|
| **10** | 分类胶囊（行内编辑入口） | `704-716` | 当前分类名称 + `Icons.Filled.Edit` (若 eligible) | `onEdit()` -> 设置 `editing = row`，打开分类与备注编辑卡片 | `pending && !busy && row.eligible` | 行本身为已存在账单或非正金额（`!row.eligible`），不可编辑分类 | 胶囊背景 `t.surfaceSoft`，边框 `t.border`，8dp 圆角 |
| **11** | 行勾选框 (Checkbox) | `763-768` | Checkbox 勾选框 | `onToggleSelection(checked)` -> 选中加入集合，取消则移出 | `pending && !busy && row.eligible && (isSelected || selected.size < 100)` | 1. 达到 100 笔上限时无法再勾选未选项<br>2. 行不可导入（`!row.eligible`）<br>3. `busy` | 原生 `Checkbox`，36dp 尺寸，带无障碍语义 |
| **12** | 对比账单（疑似重复条） | `887-900` | `Icons.AutoMirrored.Filled.CompareArrows` + "对比账单" | `onCompare()` -> 设置 `comparing = row`，加载对比候选数据 | `pending && !busy`，仅在 `row.softDuplicate == true` 时渲染 | 仅在有同日同额账单且非 `busy` 时可用 | 黄色警示色容器（`0xFFFEF3C7`），36dp 高度 `FilledTonalButton` |

### 4.3 分类与备注编辑界面（`AssistantImportWorkspace.kt: rowToEdit != null`）

| # | 按钮/组件名称 | 代码位置 | 标签文案 / 图标 | `onClick` 数据流 | `enabled` 判定条件 | 硬阻断因素 (Hard Blockers) | 视觉说明来源 / Token |
|---|---|---|---|---|---|---|---|
| **13** | 分类项 Radio / Surface | `244-263` | 分类图标 + 分类名 + `RadioButton` | `categoryDraft = category.id` | `pending && !busy` | 处于提交中或终态 | 10dp 圆角卡片，选中态为 `t.accentSubtle` 背景高亮 |
| **14** | 保存修改 | `289-301` | "保存修改" | `onCategory(rowToEdit.id, categoryDraft)` + `onNote(...)` -> 关闭编辑页 | `pending && !busy && noteDraft.length <= 200 && categories.any { it.id == categoryDraft && it.type == rowToEdit.type }` | 1. **未选择分类或所选分类跨类型**<br>2. 备注超出 200 字<br>3. `busy` | 全宽 `Button`，高度 48dp，`t.accent` 背景 |

### 4.4 疑似重复比对页（`AssistantDuplicateComparisonScreen`）

| # | 按钮/组件名称 | 代码位置 | 标签文案 / 图标 | `onClick` 数据流 | `enabled` 判定条件 | 硬阻断因素 (Hard Blockers) | 视觉说明来源 / Token |
|---|---|---|---|---|---|---|---|
| **15** | 返回 / 完成 | `952, 959` | 返回箭头 / "完成" | `onClose()` -> 清理比对状态返回列表 | 始终为 `true` | 无 | 顶部栏两端标准操作 |
| **16** | 候选翻页切换 (左/右箭头) | `1131, 1145` | `KeyboardArrowLeft` / `KeyboardArrowRight` | `candidateIndex--` / `candidateIndex++` | `candidateIndex > 0` / `< items.size - 1` | 到达首条或末条候选记录 | 28dp 小图标按钮 |
| **17** | 加载下一页候选 | `1175-1180` | "加载下一页候选账单" | `onNextPage(page.nextCursor)` | 仅在 `page.nextCursor != null` 时渲染 | 无后续游标 | 居中全宽 `TextButton` |
| **18** | 重新加载 | `1096-1100` | "重新加载" | `onRetry()` -> 重新拉取重复候选 | 仅在 `error != null` 时渲染 | 请求未失败时不展示 | `OutlinedButton` |
| **19** | 仍然导入此笔（页面中 + 吸底） | `1208, 1270` | `Icons.Filled.Check` + "仍然导入此笔（确认不是重复账单）" / "已选入待导入" | `onSelect()` -> `onSelection(selectVisibleImportRows(selected, listOf(source)))` | `editable && source.eligible && (isSelected || selected.size < 100)`，其中 `editable = pending && !busy && !uncertain` | 1. 达到 100 笔上限且当前未选<br>2. 账单本身不可导入（`!eligible`）<br>3. 处于 `busy` 或 `uncertain` | `Button`；已选中为成功绿 `t.ok`，未选中为主题色 `t.accent` |
| **20** | 排除此笔（页面中 + 吸底） | `1223, 1257` | `Icons.Filled.Close` + "排除此笔（不导入，防止重复入账）" / "排除此笔" | `onExclude()` -> `onSelection(selected - source.id)` | `editable && source.eligible`，其中 `editable = pending && !busy && !uncertain` | 1. 账单本身不可导入（`!eligible`）<br>2. 处于 `busy` 或 `uncertain` | 危险警示色 `t.danger` 描边；`OutlinedButton` |

### 4.5 聊天卡片与独立二次确认弹窗（`AssistantTab.kt`）

| # | 按钮/组件名称 | 代码位置 | 标签文案 / 图标 | `onClick` 数据流 | `enabled` 判定条件 | 硬阻断因素 (Hard Blockers) | 视觉说明来源 / Token |
|---|---|---|---|---|---|---|---|
| **21** | 查看并选择账单 (聊天操作卡) | `2043, 2125` | "查看并选择账单" | `workspaceActionId = actionId` 打开全屏导入工作区 | `pending && !actionBusy` | 非 pending 状态或提交进行中 | 卡片内全宽操作按钮 |
| **22** | 确认执行 (二次确认弹窗) | `1533-1575` | "确认执行" | `repo.confirmAction(...)` 发送最终导入请求 | `actionId !in actionBusyIds && card.optString("status") == "pending" && !uncertain && selectedRows[actionId].orEmpty().size in 1..100` | 1. **所选数量为 0 或 > 100**<br>2. 操作已过期/取消/确认（非 pending）<br>3. 正在提交中 | 确认弹窗 Primary CTA |
| **23** | 再核对 (二次确认弹窗) | `1584-1589` | "再核对" | `actionConfirmation = null`（关闭确认弹窗） | `actionId !in actionBusyIds` | 正在向服务端提交确认中 | 确认弹窗 Dismiss Button |

---

## 5. "排除" 按钮不可用或含义不明专项调查（事实对比与根因剖析）

### 5.1 证实的事实（Ground Truth from Code）
1. **主列表行卡片没有"排除"按钮**：
   - 检查 `AssistantImportWorkspace.kt:660-925`（`AssistantImportRowCard`），卡片上只有：
     - 分类编辑入口（`onEdit()`）
     - 疑似重复提示下的"对比账单"（`onCompare()`）
     - 选择复选框（`Checkbox`）
   - **事实**：用户在主列表浏览账单时，**根本找不到标有"排除"的按钮**。
2. **AI 建议与规则文案产生了强烈的视觉暗示**：
   - 当大模型给出建议排除时，卡片展示（行 833）：`"AI建议：建议排除 · 理由..."`。
   - 当平台交易为退款/零额/提现时，状态标签展示（行 749）：`"规则排除"`。
   - **事实**：用户看到卡片赫然写着"建议排除"或"规则排除"，直觉会寻找"点击排除"的操作入口，但卡片上仅有一个普通 Checkbox。如果不理解"不勾选 = 不导入 = 排除"，会产生强烈困惑。
3. **"排除此笔"按钮仅存在于"疑似重复账单核对"二级页面中**：
   - 位置：`AssistantImportWorkspace.kt:1223, 1257`。
   - 点击逻辑：`onExclude = { onSelection(selected - source.id) }`。
   - **事实**：其底层实现**仅仅是将当前账单 ID 从选定集合（`selected`）中移除**。
   - **副作用**：若用户打开对比页时，该账单本来就处于未勾选状态，点击"排除此笔"后，集合无变化，页面无任何 Toast 或状态变更反馈。用户因此产生"按钮按了没反应 / 按钮坏了"的真切感受。
4. **按钮不可用（Disabled）的触发条件代码查证**：
   - 在比对页中：`enabled = editable && source.eligible`。
   - `editable` 由 `pending && !busy && !uncertain` 决定。
   - 当后台网络未决（`uncertain == true`）或正在向服务端发送分析请求（`busy == true`）时，**该按钮会被强制置灰禁用**。
   - 若账单为无效金额（`row.amountCents <= 0`）或硬重复（`alreadyExists == true`），`eligible` 为 `false`，按钮亦被代码硬性禁用。
5. **筛选标签命名断层**：
   - 顶部筛选标签为：`"全部"`、`"已选入"`、`"未选"`、`"疑似重复"`（`AssistantImportWorkspace.kt:351`）。
   - 没有命名为 `"已排除"` 的标签，虽然 `"未选"` 实质承载了未导入项，但术语未对齐。

### 5.2 合理推断与非代码因素（Hypotheses & UX Gaps）
- 用户所说的"排除按钮不可用"，极大概率是在以下三种场景之一触发：
  - **场景 A**：在疑似重复对比页点击"排除此笔"，由于该笔未选入，界面无任何显式变化，误以为按钮不可用。
  - **场景 B**：在主列表中寻找"排除"功能，看到"建议排除"却找不到按钮，认为功能缺失。
  - **场景 C**：因分类缺失导致底部"继续核对"主按钮置灰无法点击，将主按钮的阻断误认为"排除处理后无法继续"。

---

## 6. AI 分类建议流转与丢弃路径审计（Reader 到 UI 全链路）

追踪数据流：`导入账单上传 -> 服务端预解析 -> 大模型分类推断 -> 校验规整 -> 存入 pending card -> 客户端拉取卡片 -> 客户端状态映射 -> 界面渲染`。

```
[原始 CSV/XLSX]
      │
      ▼
decodeBillFile & parsePlatformBills (packages/shared/src/platform-bills.ts)
  ├─ 静态关键词正则匹配: EXPENSE_KEYWORDS / INCOME_KEYWORDS
  └─ ⚠️ 无匹配时直接硬编码赋值: row.categoryName = "其他" 或 "其他收入" (行 246, 254)
      │
      ▼
assistant-orchestrator.ts: handleMessage
  ├─ prepared.preview 生成完毕 (包含 preview.rows 与 preview.categories)
  └─ 调用大模型分析账单 (按 25 行分批调用 provider.complete)
      │
      ▼
normalizeBillRecommendations (packages/server/src/services/bill-import-analysis.ts:24-29)
  │
  ├─ 检查每个 recommendation 的 categoryId:
  │    if (categoryId !== null && (typeof categoryId !== 'string' ||
  │        !categories.some((category) => category.id === categoryId && category.type === row.type)))
  │        return fail(); ───► 抛出 AiResponseInvalidError()
  │
  ▼ (若抛出异常)
assistant-orchestrator.ts: catch 块 (行 161)
  └─ ⚠️ 致命熔断: analysis = { status: 'failed', analysed: 0, recommendations: [] }
       整批/全文件的 AI 建议被直接丢弃清空！
      │
      ▼
客户端 AssistantImportState.kt: assistantImportRows (行 20)
  ├─ analysis.status == "complete" 才能读出 suggestion
  ├─ 若 analysis 失败: row.categoryId 为空 ("")
  └─ 仅保留 row.category ("其他") 作为搜索文本，不作为分类 ID！
      │
      ▼
客户端 AssistantImportWorkspace.kt: reviewedCategoryName (行 682)
  ├─ categories.firstOrNull { it.id == reviewedImportCategory(...) }?.name ?: "未选分类"
  └─ ⚠️ 界面显示为 "未选分类"，且阻断底部继续按钮！
```

### 关键丢弃路径总结：
1. **路径 1（关键词未命中兜底）**：`platform-bills.ts` 中的静态解析器完全没有机器学习或模糊匹配能力，关键词表非常有限（仅几十个词）。任何新兴商户或非标准描述一律归入 `"其他"`。
2. **路径 2（服务端校验过严导致的整批丢弃）**：大模型极易输出分类名称（如 `"餐饮美食"`）而不是服务端下发的 UUID，或者大模型尝试推荐一个更合理的分类但不在现存 `categories` 中。此时 `bill-import-analysis.ts` 的 `fail()` 会导致整批 25 条账单的建议全部化为乌有，且没有任何局部容错回退机制。
3. **路径 3（客户端对建议分类 ID 与名称的解耦断裂）**：客户端的 `reviewedImportCategory` 仅认 UUID；若服务端未能在 `recommendations` 中输出精准 UUID，客户端完全不会尝试使用静态解析的 `categoryName` 去模糊反查 `categories`，而是直接置空为 `""`，展示为 `"未选分类"`。

---

## 7. 现有分类选择器新建入口现状（R4 调查）

针对用户最后一句提出的“疑似允许 AI 创建分类”：

1. **当前代码显式禁止新建**：
   - `AssistantImportWorkspace.kt:236` 界面文案明示：`"请选择现有同类型（支出/收入）分类；不创建新分类。"`
   - `AssistantImportWorkspace.kt:239` 若无可用分类，提示：`"缺少可用分类，请先在分类管理中添加，然后重新预览。"`
   - 界面上**没有任何**跳转至分类管理、创建分类的 Input 或弹窗组件。
2. **底层安全契约保护（A028 / 服务端 Strict 校验）**：
   - 客户端契约 `A028`："编辑页仅选择现有活跃同类型可记账分类 ID，不创建/恢复分类。"
   - 服务端校验 `portability-service.ts:896`：
     ```ts
     const category = this.db.prepare('SELECT id, type FROM categories WHERE id = ? AND deleted = 0').get(id ?? '');
     const child = category?.type === 0 && this.db.prepare('SELECT id FROM categories WHERE parent_id = ? AND deleted = 0 LIMIT 1').get(id);
     if (!category || category.type !== row.type || child) throw new ValidationError('请为所选账单选择有效的同类型现有叶分类。');
     ```
     在账单确认入账阶段，服务端会对提交的每个 `categoryOverride` 执行硬性数据库校验。如果 ID 不存在或为父级分类，直接抛出 `ValidationError` 拒绝入账。
3. **现状结论**：
   - 当前无论 Android 还是服务端，在账单导入流程中**均未开放动态创建分类的能力**。任何新分类的建立必须先通过主账本的分类管理功能完成。

---

## 8. 多文件 Picker、草稿保存与单文件限额策略（架构方案深度推演）

### 8.1 选单协议与草稿现状
- 目前使用 `ActivityResultContracts.GetContent()` 单选。
- 若支持多文件选择，Android 原生标准 API 应切换为：
  - `ActivityResultContracts.GetMultipleContents()`（MIME 通用）或 `ActivityResultContracts.OpenMultipleDocuments()`（SAF 推荐）。
- `AssistantComposerDraft` 必须升级为：
  `val attachments: List<SelectedDocument> = emptyList()`。

### 8.2 两种多文件处理策略的权衡（Merged Workspace vs Per-File Queue）

| 维度 | 方案 A：合并为一个巨型工作区 (Merged Workspace) | 方案 B：分文件独立工作区队列 (Per-File Queue Workspace) ⭐【推荐】 |
| :--- | :--- | :--- |
| **工作模式** | 将用户选择的 N 个文件内容在服务端或客户端合并为一个虚拟的单一账单预览。 | 每个选中的文件独立生成一个操作卡（`platform-import.prepare`），用户逐个文件核对导入。 |
| **契约兼容性 (A015–A031)** | **极差**。严重打破 A016、A030（原件 SHA-256 核验）。若多个文件合并，二次核对时无法用单一文件的哈希校验。 | **极佳**。完全兼容现有 A015–A031 稳定契约。每个文件保持其独立的 SHA-256、actionId 与确认闭环。 |
| **行数上限策略 (200预览 / 100选择)** | **冲突严重**。若用户选 3 个各 100 行的文件（共 300 行），合并后直接撞破 200 行预览硬限制，导致最后 100 行被静默丢弃，违背数据完整性原则。若静默放大到 600 行，则严重增加内存与移动端卡顿风险。 | **自然适配**。每个文件各自拥有完整的 200 行预览与 100 行选择配额，互不挤占，边界清晰。 |
| **容错与故障隔离** | **低**。若 N 个文件中只有 1 个格式损坏或加密，会导致整个合并任务解析失败，阻断其他正常文件的导入。 | **高**。文件之间强隔离。文件 1 成功则生成操作卡；文件 2 损坏则单独提示错误，不影响文件 1 和文件 3 的核对入账。 |
| **AI 分析与 Token 开销** | **风险高**。一次性合并数百行账单给大模型分批分析，长上下文耗时极长，网关超时和熔断丢弃的概率成倍上升。 | **平稳可控**。单文件 200 行上限天然保障了大模型批处理的稳定性，失败仅需单文件重试。 |
| **跨文件重复核对** | 可以在合并预览中直接做交叉去重对比。 | 需借助现有已有账本排重逻辑：文件 1 入账后，文件 2 核对时自然能比对出重复。 |
| **用户体验与操作成本** | 用户一次性确认全部，但列表过长，审核心智负担大。 | 用户目标明确，逐份账单审核确认，进度可感知（如"正在核对微信账单 (1/2)"）。 |

**推荐结论**：
强烈推荐 **方案 B（分文件独立操作队列 / Per-File Queue）**。不仅对现有服务端协议和 Android 稳定契约（A015–A031）改动最小、破坏性最低，而且严格守住了 200 行预览 / 100 行选择的安全红线，提供了最优的故障隔离保障。

---

## 9. 可复用纯单元测试资源与后端协议需求

### 9.1 可复用的 Android 纯 JVM 单元测试（无需 Android 设备/真机）
经源码审计，下列测试均位于 `clients/android/app/src/test`，无需 Robolectric 或 Android 设备，测试执行迅速且覆盖度极高：
1. `AssistantImportStateTest.kt`（10 项测试）：
   - `initialSelectionExcludesHardAndSoftDuplicatesAndStopsAt100`: 验证 100 项上限截断及软硬重复排除。
   - `selectVisibleNeverExceeds100ButCanExplicitlySelectSoftDuplicates`: 验证选择数量硬限制。
   - `filtersAreLocalAndDateLabelIsSearchable`: 验证搜索与筛选逻辑。
   - `ignoredRowsAreEligibleAndStatusShowsRuleReason`: 验证规则排除行的状态展示。
   - `decoderReadsDateLabelCaps200AndRejectsMalformedIds`: 验证 200 行安全截断。
   - `reviewedNotesPreserveUntouchedAndExplicitClearAndCategoryUsesId`: 验证覆盖值隔离。
2. `AssistantDuplicateStateTest.kt`（5 项测试）：
   - `decoderPreservesSourceFactsPaginationEmptyNotesAndRefundIdentity`: 验证候选比对行事实解码。
   - `decoderRejectsFractionalOverflowAndStringIntegerFacts`: 验证账务事实防溢出。
   - `explicitSelectionPreservesOtherRowsAndDraftsAndHardBlockAnd100Cap`: 验证对比页中的显式选择与排除行为。

### 9.2 后端协议与服务端改进需求（供后续规划参考）
1. **AI 建议容错规整（Fault-Tolerant Recommendations）**：
   - 改进 `bill-import-analysis.ts`：大模型返回单项分类 ID 异常时，不要直接 `fail()` 丢弃整批 25 条建议；应对单项降级（如置为 `categoryId: null` 并保留 `include` 与 `reason`），确保其他有效建议能正常送达客户端。
   - 增加按分类名称匹配的容错机制：当大模型输出了分类名称（如 `"餐饮"`）而非 UUID 时，服务端在同类型分类中进行名称反查匹配。
2. **多文件接口支持**：
   - 客户端分次调用现有 `POST /assistant/conversations/:id/messages`，或服务端提供多附件批处理能力。

---

## 10. 核心产品待决策问题（供 Parent / 用户决策）

在进入下一步规划前，需优先明确以下产品意图：

1. **【P1 关键决策】关于“允许 AI 创建分类”（R4）的产品边界与审核时机**：
   - *意图确认*：用户最后一句“运行爱创建分类”是否明确要求支持由 AI 建议新分类并写入账本？
   - *审核时机*：若允许创建新分类，该操作是在账单确认导入时**静默连带创建**，还是必须**作为显式独立步骤由用户逐个确认新分类的名称、收支类型和父级分类**？（注：静默创建会破坏既有财务基线，推荐必须人工独立审核）。
2. **【P1 关键决策】多文件导入的审核组织形态**：
   - 在一次选择多个账单文件后，用户期望的体验是：
     - **选项 A（推荐）**：会话内按文件依次生成独立的“账单导入核对卡片”，逐个文件核对、确认并入账；
     - **选项 B**：在客户端维护一个“文件队列步进器”，在同一个工作区内分步完成“文件 1/N -> 文件 2/N”的流转；
     - **选项 C**：强行合并为一个界面（存在超出 200 行截断丢弃的风险）。
3. **【P2 体验决策】“排除”操作的用户心智与视觉反馈**：
   - 当前“排除”仅为内存中取消勾选。是否需要为“排除”赋予更明确的交互状态（如：在主列表卡片上增加显式的“暂不导入/排除”标记按钮，并在筛选器中对齐“已排除”概念，与纯粹的“未选”区分开）？

---

## 11. 规划建议与下一步输入

- 本调查已全面梳理 Android 侧与服务端关联的核心代码与瓶颈。
- 建议 Parent Agent 在 PRD/Design 阶段采纳 **方案 B（Per-File Queue）**，并对 **“AI 建议容错规整”** 与 **“排除操作视觉反馈对齐”** 制定针对性改进计划，在获得用户关于 R4 新分类权限的明确确认后再进入实施阶段。
