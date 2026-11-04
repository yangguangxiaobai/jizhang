package com.yansuu1.jizhang.ui.feature.assistant

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.yansuu1.jizhang.ui.SelectedDocument
import com.yansuu1.jizhang.ui.formatYuan
import org.json.JSONArray
import org.json.JSONObject

internal fun requireAssistantDocument(document: SelectedDocument) {
    require(document.name.endsWith(".csv", true) || document.name.endsWith(".xlsx", true)) { "请选择 CSV 或 XLSX 账单文件" }
    require(document.bytes.isNotEmpty() && document.bytes.size <= 5 * 1024 * 1024) { "账单文件须非空且不超过 5MiB" }
}

@Composable
internal fun AssistantImportWorkspace(
    card: JSONObject, selected: Set<String>, overrides: Map<String, String>, notes: Map<String, String>, busy: Boolean,
    sourceReady: Boolean, fileError: String?, uncertain: Boolean, onRefresh: () -> Unit, onBack: () -> Unit,
    onSelection: (Set<String>) -> Unit, onCategory: (String, String) -> Unit, onNote: (String, String) -> Unit, onRetryAnalysis: () -> Unit,
    onChooseSource: () -> Unit, onContinue: () -> Unit, onCancel: () -> Unit,
) {
    val actionId = card.optString("actionId")
    var query by remember(actionId) { mutableStateOf("") }
    var filter by remember(actionId) { mutableStateOf("全部") }
    var editing by remember(actionId) { mutableStateOf<AssistantImportRow?>(null) }
    var categoryDraft by remember(actionId) { mutableStateOf("") }
    var noteDraft by remember(actionId) { mutableStateOf("") }
    val categories = assistantImportCategories(card)
    val rows = assistantImportRows(card)
    val visible = filterImportRows(rows, query, filter)
    val pending = card.optString("status") == "pending"
    BackHandler(editing != null) { editing = null }
    Column(Modifier.fillMaxSize().imePadding().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { if (editing != null) editing = null else onBack() }, modifier = Modifier.size(48.dp)) { Icon(Icons.Filled.ArrowBack, "返回${if (editing != null) "导入预览" else "聊天"}") }
            Text(if (editing != null) "编辑导入分类" else "账单导入", style = MaterialTheme.typography.titleLarge)
        }
        val rowToEdit = editing
        if (rowToEdit != null) {
            Column(Modifier.weight(1f).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(rowToEdit.title)
                Text("${rowToEdit.dateLabel} · ${formatYuan(rowToEdit.amountCents)}")
                Text("来源备注：${rowToEdit.sourceNote.ifBlank { "（空）" }}")
                Text("请选择现有同类型叶分类；不创建或恢复分类。")
                val choices = categories.filter { it.type == rowToEdit.type }
                if (choices.isEmpty()) Text("缺少可用分类，请先在分类管理中添加，然后重新预览。", color = MaterialTheme.colorScheme.error)
                choices.forEach { category ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        RadioButton(selected = categoryDraft == category.id, onClick = { categoryDraft = category.id }, enabled = pending && !busy)
                        Text(category.name)
                    }
                }
                OutlinedTextField(noteDraft, { noteDraft = it }, label = { Text("保存备注（可清空，最多200字符）") }, modifier = Modifier.fillMaxWidth(), enabled = pending && !busy, isError = noteDraft.length > 200)
            }
            Button(onClick = { onCategory(rowToEdit.id, categoryDraft); if (noteDraft != reviewedImportNote(rowToEdit, notes)) onNote(rowToEdit.id, noteDraft); editing = null }, enabled = pending && !busy && noteDraft.length <= 200 && categories.any { it.id == categoryDraft && it.type == rowToEdit.type }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("保存审核修改") }
        } else {
            LazyColumn(Modifier.weight(1f).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp), contentPadding = PaddingValues(vertical = 8.dp)) {
                item {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            val analysis = card.optJSONObject("preview")?.optJSONObject("analysis")
            Text(if (analysis?.optString("status") == "complete") "AI已分析 ${analysis.optInt("analysed")} 行；建议可由您改变。" else "AI分析未完成：${analysis?.optString("message").orEmpty()}")
            TextButton(onClick = onRetryAnalysis, enabled = pending && !busy && sourceReady && !uncertain) { Text("重新分析（新预览将重置审核草稿）") }
            Text("${rows.size} 行预览 · 已选 ${selected.size}/100 · 只导入显式选中行", style = MaterialTheme.typography.bodySmall)
            Text("可导入 ${rows.count { it.eligible }} · 已存在 ${rows.count { it.status == "已存在" }} · 来源禁止 ${rows.count { !it.eligible && it.status != "已存在" }}", style = MaterialTheme.typography.bodySmall)
            val selectedRows = rows.filter { it.id in selected }
            Text("已选收入 ${formatYuan(selectedRows.filter { it.type == 1 }.sumOf { it.amountCents })} · 已选支出 ${formatYuan(selectedRows.filter { it.type == 0 }.sumOf { it.amountCents })}", style = MaterialTheme.typography.bodySmall)
            val total = card.optJSONObject("preview")?.optInt("total", -1) ?: -1
            if (total > rows.size) Text("文件共 $total 行，仅展示前200行中的有效预览；未展示行不会导入。", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
            OutlinedTextField(query, { query = it }, label = { Text("搜索当前预览") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
            // Wrap instead of squeezing chips into a fixed-height row at 200% font.
            @OptIn(ExperimentalLayoutApi::class)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("全部", "可导入", "疑似重复", "不可导入").forEach { label -> FilterChip(selected = filter == label, onClick = { filter = label }, label = { Text(label) }) }
                TextButton(onClick = { onSelection(selectVisibleImportRows(selected, visible)) }, enabled = pending && !busy && selected.size < 100) { Text("选择筛选结果（最多100）") }
                TextButton(onClick = { onSelection(emptySet()) }, enabled = pending && !busy && selected.isNotEmpty()) { Text("清空选择") }
            }
                    }
                }
                if (visible.isEmpty()) item { Text("当前筛选没有账单；可修改搜索或筛选。") }
                items(visible, key = { it.id }) { row ->
                    Surface(color = MaterialTheme.colorScheme.surfaceVariant, shape = MaterialTheme.shapes.medium) {
                        Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.Top) {
                            Checkbox(checked = row.id in selected, onCheckedChange = { checked -> onSelection(if (checked) selectVisibleImportRows(selected, listOf(row)) else selected - row.id) }, enabled = pending && !busy && row.eligible && (row.id in selected || selected.size < 100), modifier = Modifier.size(48.dp).semantics { contentDescription = "选择账单 ${row.title} ${row.status}" })
                            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                Text(row.title, style = MaterialTheme.typography.bodyLarge)
                                Text("${when (row.type) { 1 -> "收入"; 0 -> "支出"; else -> "方向待核对" }} ${formatYuan(row.amountCents)} · ${row.dateLabel}", style = MaterialTheme.typography.bodyMedium)
                                Text("来源备注：${row.sourceNote.ifBlank { "（空）" }}")
                                Text("审核备注：${reviewedImportNote(row, notes).ifBlank { "（已清空）" }}")
                                if (row.reason.isNotBlank()) Text("AI${if (row.recommendation) "建议选入" else "建议排除"}：${row.reason}")
                                if (row.isRefund) Text("独立退款收入（实际流水金额）")
                                if (row.refundWarning.isNotBlank()) Text(row.refundWarning)
                                if (!pending || busy || (!selected.contains(row.id) && selected.size >= 100)) Text(when { !pending -> "操作已关闭"; busy -> "请求处理中，暂不可修改"; else -> "已达到100行上限，先取消其他选择" })
                                if (row.rawStatus.isNotBlank()) Text("来源状态：${row.rawStatus}")
                                Text(row.status, color = if (row.softDuplicate) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)
                                TextButton(onClick = { editing = row; categoryDraft = reviewedImportCategory(row, overrides); noteDraft = reviewedImportNote(row, notes) }, enabled = pending && !busy && row.eligible, modifier = Modifier.heightIn(min = 48.dp)) { Text("分类：${categories.firstOrNull { it.id == reviewedImportCategory(row, overrides) }?.name ?: "未选择分类"} · 编辑") }
                            }
                        }
                    }
                }
            }
            Column(Modifier.fillMaxWidth().heightIn(max = 220.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                fileError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                if (uncertain) TextButton(onClick = onRefresh, modifier = Modifier.heightIn(min = 48.dp)) { Text("刷新核对执行结果") }
                if (!pending) Text("当前状态：${card.optString("status")}，执行已关闭。")
                if (busy) Text("正在提交；返回不代表服务器取消。")
                OutlinedButton(onClick = onChooseSource, enabled = pending && !busy, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text(if (sourceReady) "重新核对原文件" else "选择原文件（CSV/XLSX ≤5MiB）") }
                if (rows.any { it.id in selected && reviewedImportCategory(it, overrides).isBlank() }) Text("所选行缺少分类，请先编辑。", color = MaterialTheme.colorScheme.error)
                Button(onClick = onContinue, enabled = pending && !busy && !uncertain && sourceReady && selected.size in 1..100 && rows.filter { it.id in selected }.all { row -> categories.any { it.id == reviewedImportCategory(row, overrides) && it.type == row.type } }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("继续核对 ${selected.size} 行") }
                TextButton(onClick = onCancel, enabled = pending && !busy, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("取消导入操作") }
            }
        }
    }
}

/** Explicit operation details, including nested before/after and arrays; never render attachment secrets. */
@Composable
internal fun AssistantOperationDetails(value: JSONObject) {
    var expanded by remember(value.toString()) { mutableStateOf(false) }
    TextButton(onClick = { expanded = !expanded }, modifier = Modifier.heightIn(min = 48.dp)) { Text(if (expanded) "收起操作详情" else "查看完整操作详情 / 前后值") }
    if (expanded) {
        val lines = mutableListOf<String>()
        fun visit(raw: Any?, path: String) {
            when (raw) {
                is JSONObject -> raw.keys().forEach { key -> if (key.lowercase() !in setOf("secret", "apikey", "token", "password", "filebase64", "sha256", "fingerprint")) visit(raw.opt(key), if (path.isEmpty()) key else "$path.$key") }
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
                    IconButton(onClick = onDismissRequest, modifier = Modifier.size(48.dp)) { Icon(Icons.Filled.ArrowBack, "返回核对") }
                    Box(Modifier.weight(1f)) { title() }
                }
                Box(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState())) { text() }
                Column(Modifier.fillMaxWidth()) { confirmButton(); dismissButton() }
            }
        }
    }
}
