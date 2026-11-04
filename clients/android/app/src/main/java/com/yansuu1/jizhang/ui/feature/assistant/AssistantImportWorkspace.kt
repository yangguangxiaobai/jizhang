package com.yansuu1.jizhang.ui.feature.assistant

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.CompareArrows
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.yansuu1.jizhang.net.AuthExpiredException
import com.yansuu1.jizhang.ui.FinanceCategoryIcon
import com.yansuu1.jizhang.ui.SelectedDocument
import com.yansuu1.jizhang.ui.dateInput
import com.yansuu1.jizhang.ui.formatYuan
import com.yansuu1.jizhang.ui.theme.LocalWebTokens
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

internal fun requireAssistantDocument(document: SelectedDocument) {
    require(document.name.endsWith(".csv", true) || document.name.endsWith(".xlsx", true)) { "请选择 CSV 或 XLSX 账单文件" }
    require(document.bytes.isNotEmpty() && document.bytes.size <= 5 * 1024 * 1024) { "账单文件须非空且不超过 5MiB" }
}

@Composable
internal fun AssistantImportWorkspace(
    loadDuplicates: suspend (String, String?) -> JSONObject,
    onAuthExpired: () -> Unit,
    card: JSONObject,
    selected: Set<String>,
    overrides: Map<String, String>,
    notes: Map<String, String>,
    busy: Boolean,
    sourceReady: Boolean,
    fileError: String?,
    uncertain: Boolean,
    onRefresh: () -> Unit,
    onBack: () -> Unit,
    onSelection: (Set<String>) -> Unit,
    onCategory: (String, String) -> Unit,
    onNote: (String, String) -> Unit,
    onRetryAnalysis: () -> Unit,
    onChooseSource: () -> Unit,
    onContinue: () -> Unit,
    onCancel: () -> Unit,
) {
    val t = LocalWebTokens.current
    val actionId = card.optString("actionId")
    val parentListState = rememberLazyListState()
    var comparing by remember(actionId) { mutableStateOf<AssistantImportRow?>(null) }
    var comparisonPage by remember(actionId) { mutableStateOf<AssistantDuplicatePage?>(null) }
    var comparisonError by remember(actionId) { mutableStateOf<String?>(null) }
    var comparisonLoading by remember(actionId) { mutableStateOf(false) }
    val comparisonGate = remember(actionId) { AssistantRequestGate() }
    val comparisonScope = rememberCoroutineScope()

    DisposableEffect(actionId) { onDispose { comparisonGate.invalidate() } }
    LaunchedEffect(actionId, card.optString("status")) {
        if (card.optString("status") != "pending") {
            comparisonGate.invalidate()
            comparing = null
            comparisonPage = null
            comparisonLoading = false
        }
    }

    fun closeComparison() {
        comparisonGate.invalidate()
        comparing = null
        comparisonPage = null
        comparisonError = null
        comparisonLoading = false
    }

    fun loadComparison(row: AssistantImportRow, cursor: String? = null) {
        val owner = "$actionId|${row.id}"
        val ticket = comparisonGate.begin("comparison", owner)
        comparisonLoading = true
        comparisonError = null
        comparisonScope.launch {
            try {
                val page = decodeAssistantDuplicatePage(loadDuplicates(row.id, cursor))
                require(page.sourceId == row.id) { "候选不属于当前来源账单，请重新预览" }
                if (comparisonGate.accepts(ticket, "$actionId|${comparing?.id}")) comparisonPage = page
            } catch (e: CancellationException) {
                throw e
            } catch (e: AuthExpiredException) {
                if (comparisonGate.accepts(ticket, "$actionId|${comparing?.id}")) {
                    closeComparison()
                    onAuthExpired()
                }
            } catch (e: Exception) {
                if (comparisonGate.accepts(ticket, "$actionId|${comparing?.id}")) comparisonError = e.message ?: "读取失败，请重试"
            } finally {
                if (comparisonGate.accepts(ticket, "$actionId|${comparing?.id}")) comparisonLoading = false
            }
        }
    }

    val categories = assistantImportCategories(card)
    val rows = assistantImportRows(card)
    val pending = card.optString("status") == "pending"

    var query by remember(actionId) { mutableStateOf("") }
    var filter by remember(actionId) { mutableStateOf("全部") }
    var editing by remember(actionId) { mutableStateOf<AssistantImportRow?>(null) }
    var categoryDraft by remember(actionId) { mutableStateOf("") }
    var noteDraft by remember(actionId) { mutableStateOf("") }
    val visible = filterImportRows(rows, query, filter, selected)

    BackHandler(comparing != null || editing != null) {
        if (comparing != null) closeComparison() else editing = null
    }

    if (comparing != null) {
        val source = comparing!!
        AssistantDuplicateComparisonScreen(
            source = source,
            page = comparisonPage,
            loading = comparisonLoading,
            error = comparisonError,
            selected = selected,
            categories = categories,
            overrides = overrides,
            notes = notes,
            pending = pending,
            busy = busy,
            uncertain = uncertain,
            onClose = { closeComparison() },
            onRetry = { loadComparison(source) },
            onNextPage = { cursor -> loadComparison(source, cursor) },
            onSelect = { onSelection(selectVisibleImportRows(selected, listOf(source))) },
            onExclude = { onSelection(selected - source.id) },
        )
    } else {
        Surface(
            modifier = Modifier.fillMaxSize().imePadding(),
            color = t.bg,
        ) {
            Column(Modifier.fillMaxSize()) {
                // Top Navigation Bar
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 8.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    IconButton(
                        onClick = { if (editing != null) editing = null else onBack() },
                        modifier = Modifier.size(44.dp),
                    ) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回${if (editing != null) "导入预览" else "聊天"}", tint = t.fg)
                    }
                    Text(
                        text = if (editing != null) "编辑账单分类与备注" else "AI 账单导入与核对",
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.Bold,
                        color = t.fg,
                        modifier = Modifier.weight(1f),
                    )
                }

                val rowToEdit = editing
                if (rowToEdit != null) {
                // Category & Note Edit Screen
                Column(
                    modifier = Modifier
                        .weight(1f)
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp)
                        .verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    Card(
                        shape = RoundedCornerShape(16.dp),
                        colors = CardDefaults.cardColors(containerColor = t.surface),
                        border = BorderStroke(1.dp, t.border.copy(alpha = 0.7f)),
                        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text(rowToEdit.title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = t.fg)
                            Text(
                                "${rowToEdit.dateLabel} · ${if (rowToEdit.type == 1) "收入" else "支出"} · ¥${formatYuan(rowToEdit.amountCents)}",
                                style = MaterialTheme.typography.bodyMedium,
                                color = t.muted,
                            )
                            if (rowToEdit.sourceNote.isNotBlank()) {
                                Text("来源备注：${rowToEdit.sourceNote}", style = MaterialTheme.typography.bodySmall, color = t.muted)
                            }
                        }
                    }

                    Card(
                        shape = RoundedCornerShape(16.dp),
                        colors = CardDefaults.cardColors(containerColor = t.surface),
                        border = BorderStroke(1.dp, t.border.copy(alpha = 0.7f)),
                        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            Text("选择账本分类", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, color = t.fg)
                            Text("请选择现有同类型（${if (rowToEdit.type == 1) "收入" else "支出"}）分类；不创建新分类。", style = MaterialTheme.typography.bodySmall, color = t.muted)

                            val choices = categories.filter { it.type == rowToEdit.type }
                            if (choices.isEmpty()) {
                                Text("缺少可用分类，请先在分类管理中添加，然后重新预览。", color = t.danger, style = MaterialTheme.typography.bodySmall)
                            }
                            choices.forEach { category ->
                                Surface(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .clip(RoundedCornerShape(10.dp))
                                        .clickable(enabled = pending && !busy) { categoryDraft = category.id },
                                    color = if (categoryDraft == category.id) t.accentSubtle else Color.Transparent,
                                    border = BorderStroke(1.dp, if (categoryDraft == category.id) t.accent else t.border.copy(alpha = 0.5f)),
                                    shape = RoundedCornerShape(10.dp),
                                ) {
                                    Row(
                                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
                                        verticalAlignment = Alignment.CenterVertically,
                                    ) {
                                        FinanceCategoryIcon(categoryName = category.name, size = 28.dp, iconSize = 14.dp)
                                        Spacer(Modifier.width(10.dp))
                                        Text(category.name, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium, color = t.fg, modifier = Modifier.weight(1f))
                                        RadioButton(
                                            selected = categoryDraft == category.id,
                                            onClick = { categoryDraft = category.id },
                                            enabled = pending && !busy,
                                        )
                                    }
                                }
                            }
                        }
                    }

                    Card(
                        shape = RoundedCornerShape(16.dp),
                        colors = CardDefaults.cardColors(containerColor = t.surface),
                        border = BorderStroke(1.dp, t.border.copy(alpha = 0.7f)),
                        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text("审核备注", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, color = t.fg)
                            OutlinedTextField(
                                value = noteDraft,
                                onValueChange = { noteDraft = it },
                                placeholder = { Text("保存备注（可清空，最多200字）") },
                                modifier = Modifier.fillMaxWidth(),
                                enabled = pending && !busy,
                                isError = noteDraft.length > 200,
                                shape = RoundedCornerShape(10.dp),
                            )
                            Text("${noteDraft.length}/200", style = MaterialTheme.typography.labelSmall, color = if (noteDraft.length > 200) t.danger else t.muted, modifier = Modifier.align(Alignment.End))
                        }
                    }

                    Button(
                        onClick = {
                            onCategory(rowToEdit.id, categoryDraft)
                            if (noteDraft != reviewedImportNote(rowToEdit, notes)) onNote(rowToEdit.id, noteDraft)
                            editing = null
                        },
                        enabled = pending && !busy && noteDraft.length <= 200 && categories.any { it.id == categoryDraft && it.type == rowToEdit.type },
                        shape = RoundedCornerShape(12.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = t.accent, contentColor = t.onAccent),
                        modifier = Modifier.fillMaxWidth().height(48.dp),
                    ) {
                        Text("保存修改", fontWeight = FontWeight.Bold)
                    }
                    Spacer(Modifier.height(16.dp))
                }
            } else {
                // Main Workspace List
                LazyColumn(
                    modifier = Modifier.weight(1f).fillMaxWidth(),
                    state = parentListState,
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                    contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 12.dp),
                ) {
                    item {
                        // AI & Status Overview Hero Card
                        AssistantImportOverviewCard(
                            card = card,
                            rows = rows,
                            selected = selected,
                            pending = pending,
                            busy = busy,
                            sourceReady = sourceReady,
                            uncertain = uncertain,
                            onRetryAnalysis = onRetryAnalysis,
                        )
                    }

                    item {
                        // Search & Filter Section
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedTextField(
                                value = query,
                                onValueChange = { query = it },
                                placeholder = { Text("搜索账单商户、分类或金额...") },
                                leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null, tint = t.muted) },
                                modifier = Modifier.fillMaxWidth(),
                                singleLine = true,
                                shape = RoundedCornerShape(12.dp),
                                colors = OutlinedTextFieldDefaults.colors(
                                    focusedContainerColor = t.surface,
                                    unfocusedContainerColor = t.surface,
                                    focusedBorderColor = t.accent,
                                    unfocusedBorderColor = t.border,
                                ),
                            )

                            @OptIn(ExperimentalLayoutApi::class)
                            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                val filterCounts = mapOf(
                                    "全部" to rows.size,
                                    "已选入" to rows.count { it.id in selected },
                                    "未选" to rows.count { it.id !in selected },
                                    "疑似重复" to rows.count { it.softDuplicate },
                                )
                                listOf("全部", "已选入", "未选", "疑似重复").forEach { label ->
                                    val count = filterCounts[label] ?: 0
                                    FilterChip(
                                        selected = filter == label,
                                        onClick = { filter = label },
                                        label = {
                                            Text(
                                                text = "$label ($count)",
                                                fontWeight = if (filter == label) FontWeight.Bold else FontWeight.Normal,
                                            )
                                        },
                                        shape = RoundedCornerShape(8.dp),
                                        colors = FilterChipDefaults.filterChipColors(
                                            selectedContainerColor = if (label == "疑似重复") Color(0xFFFEF3C7) else t.accentSubtle,
                                            selectedLabelColor = if (label == "疑似重复") Color(0xFF92400E) else t.accent,
                                            containerColor = t.surface,
                                            labelColor = t.muted,
                                        ),
                                        border = FilterChipDefaults.filterChipBorder(
                                            enabled = true,
                                            selected = filter == label,
                                            borderColor = if (filter == label && label == "疑似重复") Color(0xFFF59E0B) else if (filter == label) t.accent else t.border,
                                        ),
                                    )
                                }
                            }

                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                TextButton(
                                    onClick = { onSelection(selectVisibleImportRows(selected, visible)) },
                                    enabled = pending && !busy && selected.size < 100 && visible.any { it.eligible },
                                ) {
                                    Text("全选筛选结果 (最多100)", style = MaterialTheme.typography.labelMedium)
                                }
                                TextButton(
                                    onClick = { onSelection(emptySet()) },
                                    enabled = pending && !busy && selected.isNotEmpty(),
                                ) {
                                    Text("清空选择", style = MaterialTheme.typography.labelMedium)
                                }
                            }
                        }
                    }

                    if (visible.isEmpty()) {
                        item {
                            Card(
                                shape = RoundedCornerShape(14.dp),
                                colors = CardDefaults.cardColors(containerColor = t.surface),
                                border = BorderStroke(1.dp, t.border.copy(alpha = 0.5f)),
                                modifier = Modifier.fillMaxWidth().padding(vertical = 16.dp),
                            ) {
                                Column(
                                    modifier = Modifier.fillMaxWidth().padding(24.dp),
                                    horizontalAlignment = Alignment.CenterHorizontally,
                                    verticalArrangement = Arrangement.spacedBy(8.dp),
                                ) {
                                    Icon(Icons.Filled.Search, contentDescription = null, tint = t.muted, modifier = Modifier.size(36.dp))
                                    Text("当前筛选没有账单", style = MaterialTheme.typography.titleSmall, color = t.muted)
                                    Text("可尝试修改搜索关键词或切换上方分类筛选标签", style = MaterialTheme.typography.bodySmall, color = t.muted)
                                }
                            }
                        }
                    }

                    items(visible, key = { it.id }) { row ->
                        AssistantImportRowCard(
                            row = row,
                            selected = selected,
                            overrides = overrides,
                            notes = notes,
                            categories = categories,
                            pending = pending,
                            busy = busy,
                            onToggleSelection = { checked ->
                                onSelection(if (checked) selectVisibleImportRows(selected, listOf(row)) else selected - row.id)
                            },
                            onCompare = {
                                comparing = row
                                comparisonPage = null
                                loadComparison(row)
                            },
                            onEdit = {
                                editing = row
                                categoryDraft = reviewedImportCategory(row, overrides)
                                noteDraft = reviewedImportNote(row, notes)
                            },
                        )
                    }
                }

                // Sticky Bottom Action Panel
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    color = t.surface,
                    shadowElevation = 6.dp,
                    border = BorderStroke(1.dp, t.border.copy(alpha = 0.7f)),
                ) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 16.dp, vertical = 10.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        fileError?.let {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Filled.Warning, contentDescription = null, tint = t.danger, modifier = Modifier.size(16.dp))
                                Spacer(Modifier.width(6.dp))
                                Text(it, color = t.danger, style = MaterialTheme.typography.bodySmall)
                            }
                        }
                        if (uncertain) {
                            Button(
                                onClick = onRefresh,
                                shape = RoundedCornerShape(10.dp),
                                colors = ButtonDefaults.buttonColors(containerColor = t.warning, contentColor = Color.White),
                                modifier = Modifier.fillMaxWidth().height(42.dp),
                            ) {
                                Icon(Icons.Filled.Refresh, contentDescription = null, modifier = Modifier.size(16.dp))
                                Spacer(Modifier.width(6.dp))
                                Text("刷新核对执行结果", fontWeight = FontWeight.Bold)
                            }
                        }
                        if (busy) {
                            Text("正在提交；返回不代表服务器取消。", style = MaterialTheme.typography.bodySmall, color = t.muted)
                        }

                        if (rows.any { it.id in selected && reviewedImportCategory(it, overrides).isBlank() }) {
                            Text("所选行中存在未指定分类的账单，请先点击编辑分类。", color = t.danger, style = MaterialTheme.typography.bodySmall)
                        }

                        val canContinue = pending && !busy && !uncertain && sourceReady && selected.size in 1..100 &&
                            rows.filter { it.id in selected }.all { row -> categories.any { it.id == reviewedImportCategory(row, overrides) && it.type == row.type } }

                        Button(
                            onClick = onContinue,
                            enabled = canContinue,
                            shape = RoundedCornerShape(12.dp),
                            colors = ButtonDefaults.buttonColors(containerColor = t.accent, contentColor = t.onAccent),
                            modifier = Modifier.fillMaxWidth().height(48.dp),
                        ) {
                            Text("继续核对 ${selected.size} 行账单", fontWeight = FontWeight.Bold, fontSize = 15.sp)
                        }

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            TextButton(
                                onClick = onChooseSource,
                                enabled = pending && !busy,
                            ) {
                                Text(if (sourceReady) "重新核对原件" else "选择原件(≤5MiB)", style = MaterialTheme.typography.labelMedium)
                            }
                            TextButton(
                                onClick = onCancel,
                                enabled = pending && !busy,
                            ) {
                                Text("取消导入", style = MaterialTheme.typography.labelMedium, color = t.muted)
                            }
                        }
                    }
                }
            }
        }
    }
}
}

/**
 * AI & Status Overview Hero Card (Ardot Parity)
 */
@Composable
private fun AssistantImportOverviewCard(
    card: JSONObject,
    rows: List<AssistantImportRow>,
    selected: Set<String>,
    pending: Boolean,
    busy: Boolean,
    sourceReady: Boolean,
    uncertain: Boolean,
    onRetryAnalysis: () -> Unit,
) {
    val t = LocalWebTokens.current
    val analysis = card.optJSONObject("preview")?.optJSONObject("analysis")
    val isComplete = analysis?.optString("status") == "complete"
    val total = card.optJSONObject("preview")?.optInt("total", -1) ?: -1
    val selectedRows = rows.filter { it.id in selected }

    Card(
        shape = RoundedCornerShape(18.dp),
        colors = CardDefaults.cardColors(containerColor = t.surface),
        border = BorderStroke(1.dp, t.border.copy(alpha = 0.8f)),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            // Header Row: AI Badge & Re-analyze
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Surface(
                        color = t.accentSubtle,
                        shape = RoundedCornerShape(8.dp),
                        modifier = Modifier.size(28.dp),
                    ) {
                        Box(contentAlignment = Alignment.Center) {
                            Icon(Icons.Filled.AutoAwesome, contentDescription = null, tint = t.accent, modifier = Modifier.size(16.dp))
                        }
                    }
                    Spacer(Modifier.width(8.dp))
                    Text("AI 智能账单解析", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = t.fg)
                }

                Surface(
                    color = if (isComplete) t.ok.copy(alpha = 0.12f) else Color(0xFFFEF3C7),
                    shape = RoundedCornerShape(6.dp),
                ) {
                    Text(
                        text = if (isComplete) "已分析 ${analysis?.optInt("analysed")} 行" else "分析未就绪",
                        color = if (isComplete) t.ok else Color(0xFFB45309),
                        style = MaterialTheme.typography.labelSmall,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.padding(horizontal = 6.dp, vertical = 3.dp),
                    )
                }
            }

            if (!isComplete && analysis?.optString("message").isNullOrBlank().not()) {
                Text(
                    text = "提示：${analysis?.optString("message")}",
                    style = MaterialTheme.typography.bodySmall,
                    color = t.muted,
                )
            }

            // Stats grid in subtle container
            Surface(
                color = t.surfaceSoft,
                shape = RoundedCornerShape(12.dp),
                border = BorderStroke(1.dp, t.border.copy(alpha = 0.5f)),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Text("共 ${rows.size} 行预览", style = MaterialTheme.typography.bodySmall, color = t.muted)
                        Text("已选 ${selected.size}/100", style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Bold, color = t.accent)
                        Text("待选 ${rows.count { it.eligible && it.id !in selected }}", style = MaterialTheme.typography.bodySmall, color = t.fg)
                        val duplicateCount = rows.count { it.softDuplicate }
                        Text("疑似重复 $duplicateCount", style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Bold, color = if (duplicateCount > 0) Color(0xFFD97706) else t.muted)
                    }
                    HorizontalDivider(color = t.border.copy(alpha = 0.4f))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Text("已选支出: ¥${formatYuan(selectedRows.filter { it.type == 0 }.sumOf { it.amountCents })}", style = MaterialTheme.typography.bodySmall, color = t.fg)
                        Text("已选收入: ¥${formatYuan(selectedRows.filter { it.type == 1 }.sumOf { it.amountCents })}", style = MaterialTheme.typography.bodySmall, color = t.ok)
                    }
                }
            }

            if (total > rows.size) {
                Text(
                    text = "原文件共 $total 行，按安全限制仅展示前 200 行有效预览；未展示行不会被导入。",
                    style = MaterialTheme.typography.bodySmall,
                    color = t.warning,
                )
            }

            if (pending && !busy && sourceReady && !uncertain) {
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    TextButton(onClick = onRetryAnalysis, modifier = Modifier.height(32.dp)) {
                        Icon(Icons.Filled.Refresh, contentDescription = null, modifier = Modifier.size(14.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("重新分析账单", style = MaterialTheme.typography.labelSmall)
                    }
                }
            }
        }
    }
}

/**
 * Ardot-designed Row Card
 */
@Composable
private fun AssistantImportRowCard(
    row: AssistantImportRow,
    selected: Set<String>,
    overrides: Map<String, String>,
    notes: Map<String, String>,
    categories: List<AssistantImportCategory>,
    pending: Boolean,
    busy: Boolean,
    onToggleSelection: (Boolean) -> Unit,
    onCompare: () -> Unit,
    onEdit: () -> Unit,
) {
    val t = LocalWebTokens.current
    val reviewedCategoryName = categories.firstOrNull { it.id == reviewedImportCategory(row, overrides) }?.name ?: "未选分类"
    val reviewedNote = reviewedImportNote(row, notes)
    val isSelected = row.id in selected
    val canSelect = pending && !busy && row.eligible && (isSelected || selected.size < 100)

    Card(
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = t.surface),
        border = BorderStroke(
            1.dp,
            when {
                row.softDuplicate -> Color(0xFFF59E0B).copy(alpha = 0.6f)
                isSelected -> t.accent.copy(alpha = 0.6f)
                else -> t.border.copy(alpha = 0.7f)
            },
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(
            modifier = Modifier.padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            // Header Row: Category Tile, Chips & Checkbox
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                // Category Icon
                FinanceCategoryIcon(categoryName = reviewedCategoryName, size = 30.dp, iconSize = 15.dp)
                Spacer(Modifier.width(8.dp))

                // Category pill (clickable to edit)
                Surface(
                    shape = RoundedCornerShape(8.dp),
                    color = t.surfaceSoft,
                    border = BorderStroke(1.dp, t.border.copy(alpha = 0.6f)),
                    modifier = Modifier.clip(RoundedCornerShape(8.dp)).clickable(enabled = pending && !busy && row.eligible) { onEdit() },
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(reviewedCategoryName, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.SemiBold, color = t.fg)
                        if (row.eligible) {
                            Spacer(Modifier.width(4.dp))
                            Icon(Icons.Filled.Edit, contentDescription = "编辑分类", tint = t.muted, modifier = Modifier.size(11.dp))
                        }
                    }
                }

                Spacer(Modifier.width(6.dp))

                // Direction badge
                Surface(
                    shape = RoundedCornerShape(6.dp),
                    color = if (row.type == 1) t.ok.copy(alpha = 0.12f) else t.surfaceSoft,
                ) {
                    Text(
                        text = if (row.type == 1) "收入" else "支出",
                        color = if (row.type == 1) t.ok else t.muted,
                        style = MaterialTheme.typography.labelSmall,
                        modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                    )
                }

                if (row.isRefund) {
                    Spacer(Modifier.width(4.dp))
                    Surface(shape = RoundedCornerShape(6.dp), color = Color(0xFFE0F2FE)) {
                        Text("独立退款", color = Color(0xFF0369A1), style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp))
                    }
                }

                Spacer(Modifier.weight(1f))

                // Status chip
                when {
                    row.softDuplicate -> {
                        Surface(shape = RoundedCornerShape(6.dp), color = Color(0xFFFEF3C7)) {
                            Text("疑似重复", color = Color(0xFFB45309), style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold, modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp))
                        }
                    }
                    !row.eligible -> {
                        Surface(shape = RoundedCornerShape(6.dp), color = Color(0xFFF3F4F6)) {
                            Text(row.status, color = Color(0xFF6B7280), style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp))
                        }
                    }
                    row.status != "可导入" -> {
                        Surface(shape = RoundedCornerShape(6.dp), color = Color(0xFFF3F4F6)) {
                            Text(row.status, color = Color(0xFF6B7280), style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp))
                        }
                    }
                    else -> {
                        Surface(shape = RoundedCornerShape(6.dp), color = t.ok.copy(alpha = 0.12f)) {
                            Text("可导入", color = t.ok, style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp))
                        }
                    }
                }

                Spacer(Modifier.width(6.dp))

                Checkbox(
                    checked = isSelected,
                    onCheckedChange = { onToggleSelection(it) },
                    enabled = canSelect,
                    modifier = Modifier.size(36.dp).semantics { contentDescription = "选择账单 ${row.title} ${row.status}" },
                )
            }

            // Main Info Row: Title & Amount
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f).padding(end = 12.dp)) {
                    Text(
                        text = row.title,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                        color = t.fg,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        text = "${row.dateLabel}${if (row.rawStatus.isNotBlank()) " · ${row.rawStatus}" else ""}",
                        style = MaterialTheme.typography.bodySmall,
                        color = t.muted,
                    )
                }

                Text(
                    text = "${if (row.type == 1) "+" else "-"}¥${formatYuan(row.amountCents)}",
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold,
                    color = if (row.type == 1) t.ok else t.fg,
                )
            }

            // Notes Block (if any note exists)
            if (row.sourceNote.isNotBlank() || reviewedNote != row.sourceNote) {
                Surface(
                    color = t.surfaceSoft,
                    shape = RoundedCornerShape(8.dp),
                    border = BorderStroke(1.dp, t.border.copy(alpha = 0.4f)),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Column(Modifier.padding(horizontal = 10.dp, vertical = 6.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        if (row.sourceNote.isNotBlank()) {
                            Text("来源备注：${row.sourceNote}", style = MaterialTheme.typography.bodySmall, color = t.muted)
                        }
                        if (reviewedNote != row.sourceNote) {
                            Text("审核备注：${reviewedNote.ifBlank { "（已清空）" }}", style = MaterialTheme.typography.bodySmall, color = t.accent, fontWeight = FontWeight.Medium)
                        }
                    }
                }
            }

            // AI Recommendation Box (if any)
            if (row.reason.isNotBlank()) {
                Surface(
                    color = t.accentSubtle.copy(alpha = 0.5f),
                    shape = RoundedCornerShape(8.dp),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(Icons.Filled.AutoAwesome, contentDescription = null, tint = t.accent, modifier = Modifier.size(13.dp))
                        Spacer(Modifier.width(6.dp))
                        Text(
                            text = "AI建议：${if (row.recommendation) "建议选入" else "建议排除"} · ${row.reason}",
                            style = MaterialTheme.typography.bodySmall,
                            color = t.fg,
                        )
                    }
                }
            }

            // Refund warning (if any)
            if (row.refundWarning.isNotBlank()) {
                Surface(
                    color = Color(0xFFFEF3C7),
                    shape = RoundedCornerShape(8.dp),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(Icons.Filled.Info, contentDescription = null, tint = Color(0xFFD97706), modifier = Modifier.size(14.dp))
                        Spacer(Modifier.width(6.dp))
                        Text(row.refundWarning, style = MaterialTheme.typography.bodySmall, color = Color(0xFF92400E))
                    }
                }
            }

            // Suspected Duplicate Banner (Prominent Action!)
            if (row.softDuplicate) {
                Surface(
                    color = Color(0xFFFFFBEB),
                    shape = RoundedCornerShape(10.dp),
                    border = BorderStroke(1.dp, Color(0xFFFDE68A)),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Row(
                        modifier = Modifier.padding(10.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Row(modifier = Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Filled.Warning, contentDescription = null, tint = Color(0xFFD97706), modifier = Modifier.size(16.dp))
                            Spacer(Modifier.width(6.dp))
                            Column {
                                Text("发现同账户同日同额账单", style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold, color = Color(0xFF92400E))
                                Text("核对来源与账本细节，确认是否重复", style = MaterialTheme.typography.bodySmall, color = Color(0xFFB45309))
                            }
                        }
                        Spacer(Modifier.width(8.dp))
                        FilledTonalButton(
                            onClick = onCompare,
                            enabled = pending && !busy,
                            shape = RoundedCornerShape(8.dp),
                            colors = ButtonDefaults.filledTonalButtonColors(
                                containerColor = Color(0xFFFEF3C7),
                                contentColor = Color(0xFF92400E),
                            ),
                            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp),
                            modifier = Modifier.height(36.dp),
                        ) {
                            Icon(Icons.AutoMirrored.Filled.CompareArrows, contentDescription = null, modifier = Modifier.size(14.dp))
                            Spacer(Modifier.width(4.dp))
                            Text("对比账单", fontWeight = FontWeight.Bold, style = MaterialTheme.typography.labelMedium)
                        }
                    }
                }
            }
        }
    }
}

/**
 * Structured Duplicate Comparison Screen (Ardot Design)
 */
@Composable
private fun AssistantDuplicateComparisonScreen(
    source: AssistantImportRow,
    page: AssistantDuplicatePage?,
    loading: Boolean,
    error: String?,
    selected: Set<String>,
    categories: List<AssistantImportCategory>,
    overrides: Map<String, String>,
    notes: Map<String, String>,
    pending: Boolean,
    busy: Boolean,
    uncertain: Boolean,
    onClose: () -> Unit,
    onRetry: () -> Unit,
    onNextPage: (String) -> Unit,
    onSelect: () -> Unit,
    onExclude: () -> Unit,
) {
    val t = LocalWebTokens.current
    val reviewedCategoryName = categories.firstOrNull { it.id == reviewedImportCategory(source, overrides) }?.name ?: "未选分类"
    val reviewedNote = reviewedImportNote(source, notes)
    val isSelected = source.id in selected
    val editable = pending && !busy && !uncertain
    var candidateIndex by remember(source.id, page?.readAt) { mutableIntStateOf(0) }

    Surface(modifier = Modifier.fillMaxSize(), color = t.bg) {
        Column(Modifier.fillMaxSize()) {
            // Top Navigation Bar
            Surface(
                color = t.surface,
                border = BorderStroke(1.dp, t.border.copy(alpha = 0.5f)),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 8.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    IconButton(onClick = onClose, modifier = Modifier.size(44.dp)) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回导入审核", tint = t.fg)
                    }
                    Column(Modifier.weight(1f)) {
                        Text("疑似重复账单核对", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = t.fg)
                        Text("比对外部流水与账本已有记录", style = MaterialTheme.typography.labelSmall, color = t.muted)
                    }
                    TextButton(onClick = onClose) {
                        Text("完成", fontWeight = FontWeight.Bold, color = t.accent)
                    }
                }
            }

            // Scrollable Comparison Content
            Box(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState()),
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 12.dp),
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    // Rule / Reason Notice Box
                    Card(
                        shape = RoundedCornerShape(12.dp),
                        colors = CardDefaults.cardColors(containerColor = Color(0xFFFEF3C7)),
                        border = BorderStroke(1.dp, Color(0xFFFDE68A)),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Row(modifier = Modifier.padding(12.dp), verticalAlignment = Alignment.Top) {
                            Icon(Icons.Filled.Info, contentDescription = null, tint = Color(0xFFD97706), modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(8.dp))
                            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                Text("为什么提示疑似重复？", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, color = Color(0xFF92400E))
                                Text(
                                    "系统检测到此笔账单与已有记录在【账户】、【交易日】、【收支类型】和【金额】完全一致。\n请对比下方具体商户和备注，判断是同一笔账单被重复录入，还是在同一天产生的另一笔独立交易。",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = Color(0xFFB45309),
                                )
                            }
                        }
                    }

                    // Card A: 待导入流水 (来源文件)
                    Card(
                        shape = RoundedCornerShape(18.dp),
                        colors = CardDefaults.cardColors(containerColor = t.surface),
                        border = BorderStroke(1.dp, t.accent.copy(alpha = 0.5f)),
                        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            // Header badge
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Surface(shape = RoundedCornerShape(6.dp), color = t.accentSubtle) {
                                    Text("待导入文件流水", color = t.accent, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold, modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp))
                                }
                                Text(
                                    text = "${if (source.type == 1) "+" else "-"}¥${formatYuan(source.amountCents)}",
                                    style = MaterialTheme.typography.headlineSmall,
                                    fontWeight = FontWeight.Bold,
                                    color = if (source.type == 1) t.ok else t.fg,
                                )
                            }

                            HorizontalDivider(color = t.border.copy(alpha = 0.5f))

                            // Key-Value Table
                            ComparisonFieldRow(label = "交易日期", value = source.dateLabel, isMatched = true)
                            ComparisonFieldRow(label = "收支方向", value = "${if (source.type == 1) "收入" else "支出"}${if (source.isRefund) "（独立退款）" else ""}", isMatched = true)
                            ComparisonFieldRow(label = "交易金额", value = "¥${formatYuan(source.amountCents)}", isMatched = true)
                            ComparisonFieldRow(label = "所属账户", value = page?.sourceAccount?.ifBlank { "默认平台账户" } ?: "正在读取...", isMatched = true)
                            ComparisonFieldRow(label = "交易对方", value = page?.sourceCounterparty?.ifBlank { source.title } ?: source.title)
                            ComparisonFieldRow(label = "账单分类", value = "来源: ${source.sourceCategory.ifBlank { "未提供" }} → 拟入: $reviewedCategoryName")
                            ComparisonFieldRow(label = "完整备注", value = source.sourceNote.ifBlank { "（无备注）" }, isImportant = true)
                            if (reviewedNote != source.sourceNote) {
                                ComparisonFieldRow(label = "审核修改", value = reviewedNote.ifBlank { "（已清空）" }, isImportant = true)
                            }
                            if (page?.sourceOrder.isNullOrBlank().not()) {
                                ComparisonFieldRow(label = "来源单号", value = page?.sourceOrder.orEmpty())
                            }
                            if (page?.sourceStatus.isNullOrBlank().not()) {
                                ComparisonFieldRow(label = "来源状态", value = page?.sourceStatus.orEmpty())
                            }
                        }
                    }

                    // Visual VS Divider
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        HorizontalDivider(Modifier.weight(1f), color = t.border.copy(alpha = 0.6f))
                        Surface(
                            shape = RoundedCornerShape(12.dp),
                            color = t.surfaceSoft,
                            border = BorderStroke(1.dp, t.border.copy(alpha = 0.6f)),
                            modifier = Modifier.padding(horizontal = 8.dp),
                        ) {
                            Text(
                                text = "VS 账本已有记录 (${page?.items?.size ?: 0}/${page?.total ?: 0} 匹配)",
                                style = MaterialTheme.typography.labelSmall,
                                fontWeight = FontWeight.Bold,
                                color = t.muted,
                                modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
                            )
                        }
                        HorizontalDivider(Modifier.weight(1f), color = t.border.copy(alpha = 0.6f))
                    }

                    // Card B: 账本已有账单 (本地数据库)
                    Card(
                        shape = RoundedCornerShape(18.dp),
                        colors = CardDefaults.cardColors(containerColor = t.surface),
                        border = BorderStroke(1.dp, t.border.copy(alpha = 0.8f)),
                        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            if (loading) {
                                Row(
                                    modifier = Modifier.fillMaxWidth().padding(24.dp),
                                    horizontalArrangement = Arrangement.Center,
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    CircularProgressIndicator(modifier = Modifier.size(24.dp), color = t.accent)
                                    Spacer(Modifier.width(12.dp))
                                    Text("正在读取已有账本数据...", style = MaterialTheme.typography.bodyMedium, color = t.muted)
                                }
                            } else if (error != null) {
                                Column(
                                    modifier = Modifier.fillMaxWidth().padding(16.dp),
                                    horizontalAlignment = Alignment.CenterHorizontally,
                                    verticalArrangement = Arrangement.spacedBy(8.dp),
                                ) {
                                    Text("读取已有记录失败：$error", color = t.danger, style = MaterialTheme.typography.bodySmall)
                                    OutlinedButton(onClick = onRetry) {
                                        Text("重新加载")
                                    }
                                }
                            } else if (page != null && page.items.isEmpty()) {
                                Column(
                                    modifier = Modifier.fillMaxWidth().padding(16.dp),
                                    horizontalAlignment = Alignment.CenterHorizontally,
                                    verticalArrangement = Arrangement.spacedBy(6.dp),
                                ) {
                                    Text("账本中当前没有匹配账单", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, color = t.fg)
                                    Text("原有匹配候选可能已被删除或修改。", style = MaterialTheme.typography.bodySmall, color = t.muted)
                                }
                            } else if (page != null && page.items.isNotEmpty()) {
                                val items = page.items
                                val currentCandidate = items.getOrElse(candidateIndex) { items.first() }

                                // Candidate Multi-item Switcher Row
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Surface(shape = RoundedCornerShape(6.dp), color = t.ok.copy(alpha = 0.12f)) {
                                        Text(
                                            text = "账本已存在记录",
                                            color = t.ok,
                                            style = MaterialTheme.typography.labelSmall,
                                            fontWeight = FontWeight.Bold,
                                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
                                        )
                                    }

                                    if (items.size > 1 || page.total > 1) {
                                        Row(verticalAlignment = Alignment.CenterVertically) {
                                            IconButton(
                                                onClick = { if (candidateIndex > 0) candidateIndex-- },
                                                enabled = candidateIndex > 0,
                                                modifier = Modifier.size(28.dp),
                                            ) {
                                                Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft, contentDescription = "上一条", tint = if (candidateIndex > 0) t.fg else t.muted.copy(alpha = 0.4f))
                                            }
                                            Text(
                                                text = "${candidateIndex + 1} / ${page.total}",
                                                style = MaterialTheme.typography.labelSmall,
                                                fontWeight = FontWeight.Bold,
                                                color = t.fg,
                                                modifier = Modifier.padding(horizontal = 4.dp),
                                            )
                                            IconButton(
                                                onClick = { if (candidateIndex < items.size - 1) candidateIndex++ },
                                                enabled = candidateIndex < items.size - 1,
                                                modifier = Modifier.size(28.dp),
                                            ) {
                                                Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = "下一条", tint = if (candidateIndex < items.size - 1) t.fg else t.muted.copy(alpha = 0.4f))
                                            }
                                        }
                                    }

                                    Text(
                                        text = "${if (currentCandidate.type == 1) "+" else "-"}¥${formatYuan(currentCandidate.amountCents)}",
                                        style = MaterialTheme.typography.headlineSmall,
                                        fontWeight = FontWeight.Bold,
                                        color = if (currentCandidate.type == 1) t.ok else t.fg,
                                    )
                                }

                                HorizontalDivider(color = t.border.copy(alpha = 0.5f))

                                // Key-Value Table for Candidate
                                ComparisonFieldRow(label = "记账日期", value = dateInput(currentCandidate.date), isMatched = true)
                                ComparisonFieldRow(label = "收支方向", value = "${if (currentCandidate.type == 1) "收入" else "支出"}${if (currentCandidate.isRefund) "（独立退款）" else ""}", isMatched = true)
                                ComparisonFieldRow(label = "交易金额", value = "¥${formatYuan(currentCandidate.amountCents)}", isMatched = true)
                                ComparisonFieldRow(label = "所属账户", value = currentCandidate.accountName, isMatched = true)
                                ComparisonFieldRow(label = "记录分类", value = currentCandidate.categoryName)
                                ComparisonFieldRow(label = "完整备注", value = currentCandidate.note.ifBlank { "（无备注）" }, isImportant = true)
                                ComparisonFieldRow(label = "账单编号", value = currentCandidate.id)

                                if (page.nextCursor != null) {
                                    TextButton(
                                        onClick = { onNextPage(page.nextCursor) },
                                        modifier = Modifier.fillMaxWidth(),
                                    ) {
                                        Text("加载下一页候选账单")
                                    }
                                }
                            }
                        }
                    }
                    // Decision Tip Box
                    Card(
                        shape = RoundedCornerShape(10.dp),
                        colors = CardDefaults.cardColors(containerColor = t.surfaceSoft),
                        border = BorderStroke(1.dp, t.border.copy(alpha = 0.5f)),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Row(modifier = Modifier.padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Filled.Info, contentDescription = null, tint = t.muted, modifier = Modifier.size(14.dp))
                            Spacer(Modifier.width(6.dp))
                            Text(
                                text = "操作说明：若确认两笔交易互不相干，请点击「仍然导入」；若账本已有此记录，请点击「排除此笔」避免重复入账。",
                                style = MaterialTheme.typography.labelSmall,
                                color = t.muted,
                            )
                        }
                    }

                    // In-page Decision Action Buttons
                    Column(
                        modifier = Modifier.fillMaxWidth(),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        Button(
                            onClick = onSelect,
                            enabled = editable && source.eligible && (isSelected || selected.size < IMPORT_SELECTION_LIMIT),
                            shape = RoundedCornerShape(12.dp),
                            colors = ButtonDefaults.buttonColors(
                                containerColor = if (isSelected) t.ok else t.accent,
                                contentColor = Color.White,
                            ),
                            modifier = Modifier.fillMaxWidth().height(48.dp),
                        ) {
                            Icon(Icons.Filled.Check, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(6.dp))
                            Text(if (isSelected) "已选入待导入列表（确认非重复）" else "仍然导入此笔（确认不是重复账单）", fontWeight = FontWeight.Bold, fontSize = 15.sp)
                        }

                        OutlinedButton(
                            onClick = onExclude,
                            enabled = editable && source.eligible,
                            shape = RoundedCornerShape(12.dp),
                            colors = ButtonDefaults.outlinedButtonColors(contentColor = t.danger),
                            border = BorderStroke(1.dp, t.danger.copy(alpha = 0.5f)),
                            modifier = Modifier.fillMaxWidth().height(48.dp),
                        ) {
                            Icon(Icons.Filled.Close, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(6.dp))
                            Text("排除此笔（不导入，防止重复入账）", fontWeight = FontWeight.Bold, fontSize = 15.sp)
                        }
                    }

                    Spacer(Modifier.height(16.dp))
                }
            }

            // Fixed Bottom Decision Actions
            Surface(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(68.dp),
                color = t.surface,
                shadowElevation = 8.dp,
                border = BorderStroke(1.dp, t.border.copy(alpha = 0.7f)),
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(horizontal = 16.dp, vertical = 10.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    OutlinedButton(
                        onClick = onExclude,
                        enabled = editable && source.eligible,
                        shape = RoundedCornerShape(12.dp),
                        colors = ButtonDefaults.outlinedButtonColors(contentColor = t.danger),
                        border = BorderStroke(1.dp, t.danger.copy(alpha = 0.5f)),
                        modifier = Modifier.weight(1f).height(44.dp),
                    ) {
                        Icon(Icons.Filled.Close, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("排除此笔", fontWeight = FontWeight.Bold)
                    }

                    Button(
                        onClick = onSelect,
                        enabled = editable && source.eligible && (isSelected || selected.size < IMPORT_SELECTION_LIMIT),
                        shape = RoundedCornerShape(12.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = if (isSelected) t.ok else t.accent,
                            contentColor = Color.White,
                        ),
                        modifier = Modifier.weight(1.2f).height(44.dp),
                    ) {
                        Icon(Icons.Filled.Check, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(4.dp))
                        Text(if (isSelected) "已选入待导入" else "仍然导入此笔", fontWeight = FontWeight.Bold)
                    }
                }
            }
        }
    }
}

/**
 * Key-Value field comparison row with clear alignment and match indicator
 */
@Composable
private fun ComparisonFieldRow(
    label: String,
    value: String,
    isMatched: Boolean = false,
    isImportant: Boolean = false,
) {
    val t = LocalWebTokens.current
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 3.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.bodySmall,
            color = t.muted,
            modifier = Modifier.width(68.dp),
        )
        Text(
            text = value,
            style = if (isImportant) MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold) else MaterialTheme.typography.bodySmall,
            color = if (isImportant) t.fg else t.fg.copy(alpha = 0.9f),
            modifier = Modifier.weight(1f),
        )
        if (isMatched) {
            Surface(
                color = t.ok.copy(alpha = 0.12f),
                shape = RoundedCornerShape(4.dp),
                modifier = Modifier.padding(start = 6.dp),
            ) {
                Text(
                    text = "一致",
                    color = t.ok,
                    style = MaterialTheme.typography.labelSmall,
                    fontSize = 10.sp,
                    modifier = Modifier.padding(horizontal = 4.dp, vertical = 1.dp),
                )
            }
        }
    }
}

/** Explicit operation details, including nested before/after and arrays; never render attachment secrets. */
@Composable
internal fun AssistantOperationDetails(value: JSONObject) {
    var expanded by remember(value.toString()) { mutableStateOf(false) }
    TextButton(onClick = { expanded = !expanded }, modifier = Modifier.heightIn(min = 48.dp)) {
        Text(if (expanded) "收起操作详情" else "查看完整操作详情 / 前后值")
    }
    if (expanded) {
        val lines = mutableListOf<String>()
        fun visit(raw: Any?, path: String) {
            when (raw) {
                is JSONObject -> raw.keys().forEach { key ->
                    if (key.lowercase() !in setOf("secret", "apikey", "token", "password", "filebase64", "sha256", "fingerprint")) {
                        visit(raw.opt(key), if (path.isEmpty()) key else "$path.$key")
                    }
                }
                is JSONArray -> (0 until raw.length()).forEach { visit(raw.opt(it), "$path[${it + 1}]") }
                else -> lines += "$path：${if (path.endsWith("Cents")) raw.toString().toLongOrNull()?.let(::formatYuan) ?: raw else raw}"
            }
        }
        visit(value, "")
        lines.forEach { Text(it, style = MaterialTheme.typography.bodySmall) }
    }
}

/** Fullscreen secondary confirmation; system/top back have the same non-writing result. */
@Composable
internal fun AssistantConfirmationScreen(
    onDismissRequest: () -> Unit,
    title: @Composable () -> Unit,
    text: @Composable () -> Unit,
    confirmButton: @Composable () -> Unit,
    dismissButton: @Composable () -> Unit,
) {
    androidx.compose.ui.window.Dialog(
        onDismissRequest = onDismissRequest,
        properties = androidx.compose.ui.window.DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            Column(Modifier.fillMaxSize().imePadding().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = onDismissRequest, modifier = Modifier.size(48.dp)) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "返回核对") }
                    Box(Modifier.weight(1f)) { title() }
                }
                Box(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState())) { text() }
                Column(Modifier.fillMaxWidth()) { confirmButton(); dismissButton() }
            }
        }
    }
}
