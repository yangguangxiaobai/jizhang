package com.yansuu1.jizhang.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.ui.Alignment
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.yansuu1.jizhang.net.ApiClient
import com.yansuu1.jizhang.net.AuthExpiredException
import com.yansuu1.jizhang.repo.LedgerRepository
import kotlinx.coroutines.launch
import org.json.JSONObject
import com.yansuu1.jizhang.repo.MetaRepository
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.AlertDialog

/**
 * 转账 tab content (A3). Transfers are their own table — neither income nor
 * expense (backend spec: budget/stats need zero guards because of this).
 * Rendered from the 我的 › 账户 affordance and reachable here for parity.
 */
@Composable
fun TransfersTab(
    api: ApiClient,
    onAuthExpired: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val ledger = remember(api) { LedgerRepository(api) }
    var items by remember { mutableStateOf(listOf<JSONObject>()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var editor by remember { mutableStateOf<JSONObject?>(null) }
    var deleteId by remember { mutableStateOf<String?>(null) }
    var offset by remember { mutableStateOf(0) }
    var total by remember { mutableStateOf(0) }
    var accountNames by remember { mutableStateOf(emptyMap<String, String>()) }
    var accountLookupUnavailable by remember { mutableStateOf(false) }

    suspend fun reload() {
        loading = true
        try {
            val res = ledger.listTransfers(mapOf("limit" to "50", "offset" to offset.toString()))
            val arr = res.optJSONArray("items")
            val list = mutableListOf<JSONObject>()
            for (i in 0 until (arr?.length() ?: 0)) list.add(arr!!.optJSONObject(i))
            items = list
            total = res.getInt("total")
            try {
                val accountRows = MetaRepository(api).accounts().optJSONArray("items")
                accountNames = (0 until (accountRows?.length() ?: 0)).mapNotNull { index ->
                    accountRows?.optJSONObject(index)?.let { it.optString("id") to it.optString("name") }
                }.toMap()
                accountLookupUnavailable = false
            } catch (e: AuthExpiredException) {
                throw e
            } catch (_: Exception) {
                accountNames = emptyMap()
                accountLookupUnavailable = true
            }
            error = null
        } catch (e: AuthExpiredException) {
            onAuthExpired()
        } catch (e: Exception) {
            error = e.message
        } finally {
            loading = false
        }
    }

    LaunchedEffect(offset) { reload() }
    editor?.let { draft ->
        TransferEditor(api, draft, onAuthExpired, onSaved = { editor = null; scope.launch { reload() } }, onClose = { editor = null })
        return
    }

    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("转账", style = MaterialTheme.typography.headlineSmall)
        Text(
            "账户间资金转移，不计入收入或支出。删除的转账不会进入回收站。",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        OutlinedButton(
            onClick = { editor = JSONObject() },
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
        ) { Text("新建转账") }
        Spacer(Modifier.height(8.dp))
        if (loading) {
            JzCard(Modifier.fillMaxWidth()) {
                Text("正在加载转账记录…", style = MaterialTheme.typography.titleSmall)
                Text("第 51 条可通过下一页到达。", style = MaterialTheme.typography.bodySmall)
            }
        } else if (error != null) {
            JzCard(Modifier.fillMaxWidth()) {
                Text("转账暂时不可用", style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.error)
                Text(error!!, style = MaterialTheme.typography.bodyMedium)
                Spacer(Modifier.height(8.dp))
                OutlinedButton(
                    onClick = { scope.launch { reload() } },
                    modifier = Modifier.heightIn(min = 48.dp),
                ) { Text("重试") }
            }
        } else {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                OutlinedButton(
                    enabled = offset > 0,
                    onClick = { offset = maxOf(0, offset - 50) },
                    modifier = Modifier.heightIn(min = 48.dp),
                ) { Text("上一页") }
                Text("${offset / 50 + 1} 页 · 共 $total 笔", modifier = Modifier.weight(1f))
                OutlinedButton(
                    enabled = offset + items.size < total,
                    onClick = { offset += 50 },
                    modifier = Modifier.heightIn(min = 48.dp),
                ) { Text("下一页") }
            }
            if (items.isEmpty()) {
                JzCard(Modifier.fillMaxWidth()) {
                    Text("还没有转账记录", style = MaterialTheme.typography.titleSmall)
                    Text("新建转账后会按日期展示在这里。", style = MaterialTheme.typography.bodySmall)
                }
            } else LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                items(items, key = { it.optString("id") }) { t ->
                    JzCard(Modifier.fillMaxWidth()) {
                        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                Text(t.optString("note").ifEmpty { "(无备注)" }, style = MaterialTheme.typography.titleSmall)
                                val missingName = if (accountLookupUnavailable) "账户信息暂不可用" else "账户已删除"
                                val from = accountNames[t.optString("fromAccountId")] ?: missingName
                                val to = accountNames[t.optString("toAccountId")] ?: missingName
                                Text(from + " → " + to, style = MaterialTheme.typography.bodySmall)
                                Text(
                                    "${formatDay(t.optLong("date"))} · ${formatYuan(t.optLong("amountCents"))}",
                                    style = MaterialTheme.typography.bodySmall,
                                )
                            }
                            Row(
                                Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                OutlinedButton(
                                    onClick = { editor = t },
                                    modifier = Modifier.weight(1f).heightIn(min = 48.dp),
                                ) { Text("编辑") }
                                OutlinedButton(
                                    onClick = {
                                        deleteId = t.optString("id")
                                    },
                                    modifier = Modifier.weight(1f).heightIn(min = 48.dp),
                                ) { Text("删除", color = MaterialTheme.colorScheme.error) }
                            }
                        }
                    }
                }
            }
            Spacer(Modifier.height(8.dp))
            Button(
                onClick = { scope.launch { reload() } },
                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
            ) { Text("刷新") }
        }
    }
    deleteId?.let { id -> AlertDialog(onDismissRequest = { deleteId = null }, title = { Text("确认删除转账？转账没有回收站。") }, confirmButton = { Button(onClick = { scope.launch {
        try { ledger.removeTransfer(id); deleteId = null; reload() } catch (e: Exception) { error = e.message; deleteId = null }
    } }) { Text("删除") } }, dismissButton = { OutlinedButton(onClick = { deleteId = null }) { Text("取消") } }) }
}

@Composable
private fun TransferEditor(api: ApiClient, initial: JSONObject, onAuthExpired: () -> Unit, onSaved: () -> Unit, onClose: () -> Unit) {
    val scope = rememberCoroutineScope()
    val repo = remember(api) { LedgerRepository(api) }
    var accounts by remember { mutableStateOf(listOf<JSONObject>()) }
    var from by remember { mutableStateOf(initial.optString("fromAccountId")) }
    var to by remember { mutableStateOf(initial.optString("toAccountId")) }
    var amount by remember { mutableStateOf(if (initial.has("id")) formatYuan(initial.optLong("amountCents")) else "") }
    var date by remember { mutableStateOf(dateInput(initial.optLong("date", System.currentTimeMillis()))) }
    var note by remember { mutableStateOf(initial.optString("note")) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { try {
        val arr = MetaRepository(api).accounts().getJSONArray("items")
        accounts = List(arr.length()) { arr.getJSONObject(it) }
    } catch (e: AuthExpiredException) { onAuthExpired() } catch (e: Exception) { error = e.message } }
    Column(
        Modifier.fillMaxSize().padding(16.dp).verticalScroll(rememberScrollState()),
        verticalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(10.dp),
    ) {
        Text(if (initial.has("id")) "编辑转账" else "新建转账", style = MaterialTheme.typography.headlineSmall)
        Text("转账不计入收入或支出。交换只交换表单值，不自动提交。", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        val accountChoices = accounts.map { it.optString("id") to it.optString("name") }
        ListChoice("转出账户", accountChoices, from.takeIf { it.isNotBlank() }) { from = it }
        OutlinedButton(
            onClick = {
                val previousFrom = from
                from = to
                to = previousFrom
            },
            enabled = from.isNotBlank() && to.isNotBlank(),
        ) { Text("交换转出与转入账户") }
        ListChoice("转入账户", accountChoices, to.takeIf { it.isNotBlank() }) { to = it }
        OutlinedTextField(amount, { amount = it }, label = { Text("金额（元）") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(date, { date = it }, label = { Text("日期（YYYY-MM-DD）") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(note, { note = it }, label = { Text("备注") }, modifier = Modifier.fillMaxWidth())
        Button(
            enabled = !busy,
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).imePadding(),
            onClick = { scope.launch {
            busy = true
            try {
                val cents = parseYuanToCents(amount)
                require(cents != null && cents > 0 && from.isNotBlank() && to.isNotBlank() && from != to) { "请选择不同的转出/转入账户及有效金额" }
                val input = mapOf("fromAccountId" to from, "toAccountId" to to, "amountCents" to cents, "date" to parseDateInput(date), "note" to note)
                if (initial.has("id")) repo.updateTransfer(initial.getString("id"), input) else repo.createTransfer(input)
                onSaved()
            } catch (e: AuthExpiredException) { onAuthExpired() } catch (e: Exception) { error = e.message } finally { busy = false }
        } }) { Text("保存") }
        OutlinedButton(
            onClick = onClose,
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
        ) { Text("取消") }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
    }
}

/**
 * 回收站 (A3). Every row here is soft-deleted (server contract); restore/purge
 * map 1:1 to `api.trash`. Bulk actions mirror Web buttons.
 */
@Composable
fun TrashTab(
    api: ApiClient,
    onAuthExpired: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val ledger = remember(api) { LedgerRepository(api) }
    var items by remember { mutableStateOf(listOf<JSONObject>()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var confirmation by remember { mutableStateOf<String?>(null) }

    suspend fun reload() {
        loading = true
        try {
            val res = ledger.listTrash()
            val arr = res.optJSONArray("items")
            val list = mutableListOf<JSONObject>()
            for (i in 0 until (arr?.length() ?: 0)) list.add(arr!!.optJSONObject(i))
            items = list
            error = null
        } catch (e: AuthExpiredException) {
            onAuthExpired()
        } catch (e: Exception) {
            error = e.message
        } finally {
            loading = false
        }
    }

    LaunchedEffect(Unit) { reload() }

    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("回收站", style = MaterialTheme.typography.headlineSmall)
        Text(
            "只显示服务端返回的已删除账单；回收站不在服务端分页内。彻底删除后无法恢复。",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            OutlinedButton(
                enabled = !busy && items.isNotEmpty(),
                onClick = { confirmation = "restore_all" },
                modifier = Modifier.weight(1f).heightIn(min = 48.dp),
            ) { Text("全部恢复") }
            OutlinedButton(
                enabled = !busy && items.isNotEmpty(),
                onClick = { confirmation = "purge_all" },
                modifier = Modifier.weight(1f).heightIn(min = 48.dp),
            ) { Text("彻底清空", color = MaterialTheme.colorScheme.error) }
        }
        if (loading) {
            JzCard(Modifier.fillMaxWidth()) {
                Text("正在加载回收站…", style = MaterialTheme.typography.titleSmall)
            }
        } else if (error != null) {
            JzCard(Modifier.fillMaxWidth()) {
                Text("回收站暂时不可用", style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.error)
                Text(error!!, style = MaterialTheme.typography.bodyMedium)
                Spacer(Modifier.height(8.dp))
                OutlinedButton(
                    onClick = { scope.launch { reload() } },
                    modifier = Modifier.heightIn(min = 48.dp),
                ) { Text("重试") }
            }
        } else if (items.isEmpty()) {
            JzCard(Modifier.fillMaxWidth()) {
                Text("回收站是空的", style = MaterialTheme.typography.titleSmall)
                Text("已删除的账单会在这里等待恢复或彻底删除。", style = MaterialTheme.typography.bodySmall)
            }
        } else {
            LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                items(items, key = { it.optString("id") }) { t ->
                    JzCard(Modifier.fillMaxWidth()) {
                    Row(
                        Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text(t.optString("note").ifEmpty { "(无备注)" })
                            Text(
                                "${formatDay(t.optLong("date"))} · ${formatYuan(t.optLong("amountCents"))}",
                                style = MaterialTheme.typography.bodySmall,
                            )
                        }
                        Column(
                            Modifier.weight(1f).heightIn(min = 48.dp),
                            verticalArrangement = Arrangement.Center,
                        ) {
                            OutlinedButton(
                            onClick = {
                            scope.launch {
                                busy = true
                                try {
                                    ledger.restore(t.optString("id"))
                                    reload()
                                } catch (e: AuthExpiredException) {
                                    onAuthExpired()
                                } catch (e: Exception) {
                                    error = e.message
                                } finally {
                                    busy = false
                                }
                            }
                        },
                            enabled = !busy,
                            modifier = Modifier.fillMaxWidth(),
                        ) { Text("恢复") }
                        }
                        Column(
                            Modifier.weight(1f).heightIn(min = 48.dp),
                            verticalArrangement = Arrangement.Center,
                        ) {
                        OutlinedButton(
                            onClick = {
                            confirmation = "purge:" + t.optString("id")
                        },
                            enabled = !busy,
                            modifier = Modifier.fillMaxWidth(),
                        ) { Text("永久删除", color = MaterialTheme.colorScheme.error) }
                        }
                    }
                    }
                }
            }
        }
    }
    confirmation?.let { action ->
        val isPermanent = action == "purge_all" || action.startsWith("purge:")
        val title = when {
            action == "restore_all" -> "恢复所有返回的账单？"
            action == "purge_all" -> "彻底清空回收站？"
            else -> "永久删除这笔账单？"
        }
        val message = when {
            action == "restore_all" -> "所列账单将恢复到正常账单列表。"
            action == "purge_all" -> "所有回收站账单将被永久删除，无法恢复。"
            else -> "此账单将被永久删除，无法恢复。"
        }
        AlertDialog(
            onDismissRequest = { if (!busy) confirmation = null },
            title = { Text(title) },
            text = { Text(message) },
            confirmButton = {
                Button(
                    enabled = !busy,
                    onClick = {
                        scope.launch {
                            busy = true
                            try {
                                when {
                                    action == "restore_all" -> ledger.restoreAll()
                                    action == "purge_all" -> ledger.purgeAll()
                                    action.startsWith("purge:") -> ledger.purge(action.removePrefix("purge:"))
                                    else -> Unit
                                }
                                confirmation = null
                                reload()
                            } catch (e: AuthExpiredException) {
                                confirmation = null
                                onAuthExpired()
                            } catch (e: Exception) {
                                error = e.message
                                confirmation = null
                            } finally {
                                busy = false
                            }
                        }
                    },
                ) { Text(if (busy) "处理中…" else if (isPermanent) "永久删除" else "确认恢复") }
            },
            dismissButton = {
                OutlinedButton(onClick = { confirmation = null }, enabled = !busy) { Text("取消") }
            },
        )
    }
}
