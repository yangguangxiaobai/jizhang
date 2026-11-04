package com.yansuu1.jizhang.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import com.yansuu1.jizhang.net.ApiClient
import com.yansuu1.jizhang.net.AuthExpiredException
import com.yansuu1.jizhang.repo.LedgerRepository
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 * Select an existing transaction for a refund or item relation. The list keeps
 * the existing type/limit/offset API query and selection is committed explicitly
 * for multi-select so closing the sheet cannot silently change the form.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun LedgerLinkPicker(
    api: ApiClient,
    type: Int,
    selected: Set<String>,
    onSelect: (Set<String>) -> Unit,
    multiple: Boolean = false,
    onAuthExpired: (() -> Unit)? = null,
) {
    val scope = rememberCoroutineScope()
    val repository = remember(api) { LedgerRepository(api) }
    var expanded by remember { mutableStateOf(false) }
    var draftSelected by remember { mutableStateOf(selected) }
    var rows by remember { mutableStateOf(listOf<JSONObject>()) }
    var selectedRows by remember { mutableStateOf(emptyMap<String, JSONObject>()) }
    var offset by remember { mutableStateOf(0) }
    var total by remember { mutableStateOf(0) }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val typeName = if (type == 0) "支出" else "收入"

    suspend fun load() {
        loading = true
        error = null
        try {
            val data = repository.listTransactions(
                mapOf("type" to type.toString(), "limit" to "50", "offset" to offset.toString()),
            )
            val array = data.optJSONArray("items")
            val loaded = List(array?.length() ?: 0) { index -> array!!.getJSONObject(index) }
            rows = loaded
            selectedRows = selectedRows + loaded.filter { it.optString("id") in selected }.associateBy { it.optString("id") }
            total = data.optInt("total", loaded.size)
        } catch (e: CancellationException) {
            throw e
        } catch (e: AuthExpiredException) {
            if (onAuthExpired != null) onAuthExpired()
            else error = "登录已过期，请重新登录后再选择账单。"
        } catch (e: Exception) {
            error = e.message ?: "关联账单加载失败"
        } finally {
            loading = false
        }
    }

    LaunchedEffect(expanded, offset, type) {
        if (expanded) load()
    }
    LaunchedEffect(expanded, selected) {
        if (!expanded) {
            draftSelected = selected
        } else {
            val missing = selected - selectedRows.keys
            for (id in missing) {
                try {
                    val transaction = repository.getTransaction(id)
                    selectedRows = selectedRows + (id to transaction)
                } catch (e: CancellationException) {
                    throw e
                } catch (e: AuthExpiredException) {
                    if (onAuthExpired != null) onAuthExpired()
                } catch (_: Exception) {
                    // Keep the selected ID and show an unavailable-detail row.
                }
            }
        }
    }

    OutlinedButton(
        onClick = {
            draftSelected = selected
            offset = 0
            expanded = true
        },
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(if (selected.isEmpty()) "关联已有${typeName}账单（可选）" else "已关联 ${selected.size} 笔${typeName}账单", fontWeight = FontWeight.Medium)
            Text(
                if (selected.isEmpty()) "选择后可从记录详情跳转核对" else "点按查看或修改关联记录",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Text(if (selected.isEmpty()) "选择" else "修改")
    }

    if (expanded) {
        ModalBottomSheet(
            onDismissRequest = {
                draftSelected = selected
                expanded = false
            },
            sheetState = sheetState,
        ) {
            Column(
                modifier = Modifier.fillMaxWidth().heightIn(max = 680.dp).padding(horizontal = 20.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text("选择关联${typeName}", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
                Text(
                    if (multiple) "可以关联多笔原始支出；确认后再返回表单。" else "选择一笔已有${typeName}账单，或保持不关联。",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )

                if (draftSelected.isNotEmpty()) {
                    Text("已选 ${draftSelected.size} 笔", style = MaterialTheme.typography.titleSmall)
                    draftSelected.forEach { id ->
                        val tx = selectedRows[id] ?: rows.firstOrNull { it.optString("id") == id }
                        if (tx == null) {
                            SelectedUnavailableRow(
                                onRemove = { draftSelected = draftSelected - id },
                            )
                        } else {
                            SelectedTransactionRow(
                                tx = tx,
                                type = type,
                                onRemove = { draftSelected = draftSelected - id },
                            )
                        }
                    }
                }

                if (loading && rows.isEmpty()) {
                    Box(Modifier.fillMaxWidth().padding(vertical = 28.dp), contentAlignment = Alignment.Center) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            CircularProgressIndicator()
                            Text("正在加载${typeName}账单")
                        }
                    }
                } else if (error != null && rows.isEmpty()) {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth().padding(vertical = 16.dp)) {
                        Text(error.orEmpty(), color = MaterialTheme.colorScheme.error)
                        OutlinedButton(onClick = { scope.launch { load() } }) { Text("重试") }
                    }
                } else if (rows.isEmpty()) {
                    Text("没有可关联的${typeName}账单。", modifier = Modifier.padding(vertical = 20.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
                } else {
                    if (loading) LinearProgressIndicator(Modifier.fillMaxWidth())
                    if (error != null) Text("更新失败：${error}", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                    LazyColumn(
                        modifier = Modifier.weight(1f, fill = false).heightIn(min = 120.dp, max = 360.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        items(rows, key = { it.optString("id") }) { row ->
                            val id = row.optString("id")
                            val checked = id in draftSelected
                            TransactionChoiceRow(
                                tx = row,
                                type = type,
                                checked = checked,
                                multiple = multiple,
                                enabled = !loading,
                                onClick = {
                                    if (multiple) {
                                        draftSelected = if (checked) draftSelected - id else draftSelected + id
                                    } else {
                                        onSelect(setOf(id))
                                        expanded = false
                                    }
                                },
                            )
                        }
                    }
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        OutlinedButton(
                            enabled = !loading && offset > 0,
                            onClick = { offset = (offset - 50).coerceAtLeast(0) },
                        ) { Text("上一页") }
                        Text("第 ${offset / 50 + 1} 页 · 共 $total 笔", style = MaterialTheme.typography.bodySmall)
                        OutlinedButton(
                            enabled = !loading && offset + 50 < total,
                            onClick = { offset += 50 },
                        ) { Text("下一页") }
                    }
                }

                Row(
                    modifier = Modifier.fillMaxWidth().padding(top = 4.dp, bottom = 20.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    TextButton(
                        enabled = selected.isNotEmpty() || draftSelected.isNotEmpty(),
                        onClick = {
                            onSelect(emptySet())
                            draftSelected = emptySet()
                            expanded = false
                        },
                    ) { Text("不关联") }
                    Spacer(Modifier.weight(1f))
                    OutlinedButton(onClick = {
                        draftSelected = selected
                        expanded = false
                    }) { Text("取消") }
                    if (multiple) {
                        Button(onClick = {
                            onSelect(draftSelected)
                            expanded = false
                        }) { Text("确认 ${draftSelected.size} 笔") }
                    }
                }
            }
        }
    }
}

@Composable
private fun TransactionChoiceRow(
    tx: JSONObject,
    type: Int,
    checked: Boolean,
    multiple: Boolean,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    Surface(
        modifier = Modifier.fillMaxWidth().selectable(
            selected = checked,
            enabled = enabled,
            role = if (multiple) Role.Checkbox else Role.RadioButton,
            onClick = onClick,
        ),
        shape = RoundedCornerShape(14.dp),
        color = if (checked) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, if (checked) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (multiple) Checkbox(checked = checked, onCheckedChange = null)
            else RadioButton(selected = checked, onClick = null)
            Column(Modifier.weight(1f).padding(start = 4.dp)) {
                Text(tx.optString("note").ifEmpty { "（无备注）" }, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(
                    "${if (type == 0) "支出" else "收入"} · ${formatDay(tx.optLong("date"))}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Text("${formatYuan(tx.optLong("amountCents"))} 元", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Medium)
        }
    }
}

@Composable
private fun SelectedTransactionRow(tx: JSONObject, type: Int, onRemove: () -> Unit) {
    Surface(
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.secondaryContainer,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(start = 12.dp, end = 4.dp, top = 4.dp, bottom = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text(tx.optString("note").ifEmpty { "（无备注）" }, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(
                    "${if (type == 0) "支出" else "收入"} · ${formatDay(tx.optLong("date"))} · ${formatYuan(tx.optLong("amountCents"))} 元",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSecondaryContainer,
                )
            }
            TextButton(onClick = onRemove) { Text("移除") }
        }
    }
}

@Composable
private fun SelectedUnavailableRow(onRemove: () -> Unit) {
    Surface(
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.surfaceVariant,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(start = 12.dp, end = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("关联账单详情未显示，关系仍保留", modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
            TextButton(onClick = onRemove) { Text("移除") }
        }
    }
}
