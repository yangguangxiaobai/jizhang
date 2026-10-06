package com.yansuu1.jizhang.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
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

    suspend fun reload() {
        loading = true
        try {
            val res = ledger.listTransfers(mapOf("limit" to "200"))
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

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Text("转账", style = MaterialTheme.typography.titleLarge)
        Text(
            "只在两个账户之间搬钱，不算收入也不算支出",
            style = MaterialTheme.typography.bodySmall,
        )
        Spacer(Modifier.height(8.dp))
        if (loading) {
            Text("加载中…")
        } else if (error != null) {
            Text(error!!, color = MaterialTheme.colorScheme.error)
            OutlinedButton(onClick = { scope.launch { reload() } }) { Text("重试") }
        } else {
            LazyColumn(Modifier.fillMaxSize()) {
                items(items, key = { it.optString("id") }) { t ->
                    Row(Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
                        Column(Modifier.weight(1f)) {
                            Text(t.optString("note").ifEmpty { "(无备注)" })
                            Text(
                                "${formatDay(t.optLong("date"))} · ${formatYuan(t.optLong("amountCents"))}",
                                style = MaterialTheme.typography.bodySmall,
                            )
                        }
                        OutlinedButton(onClick = {
                            scope.launch {
                                try {
                                    ledger.removeTransfer(t.optString("id"))
                                    reload()
                                } catch (e: Exception) {
                                    error = e.message
                                }
                            }
                        }) { Text("删除") }
                    }
                }
            }
            Spacer(Modifier.height(8.dp))
            Button(
                onClick = { scope.launch { reload() } },
                modifier = Modifier.fillMaxWidth(),
            ) { Text("刷新") }
        }
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

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Text("回收站", style = MaterialTheme.typography.titleLarge)
        Spacer(Modifier.height(8.dp))
        Row {
            OutlinedButton(onClick = {
                scope.launch {
                    try {
                        ledger.restoreAll()
                        reload()
                    } catch (e: Exception) {
                        error = e.message
                    }
                }
            }) { Text("全部恢复") }
            OutlinedButton(onClick = {
                scope.launch {
                    try {
                        ledger.purgeAll()
                        reload()
                    } catch (e: Exception) {
                        error = e.message
                    }
                }
            }) { Text("彻底清空") }
        }
        Spacer(Modifier.height(8.dp))
        if (loading) {
            Text("加载中…")
        } else if (error != null) {
            Text(error!!, color = MaterialTheme.colorScheme.error)
        } else {
            LazyColumn(Modifier.fillMaxSize()) {
                items(items, key = { it.optString("id") }) { t ->
                    Row(Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
                        Column(Modifier.weight(1f)) {
                            Text(t.optString("note").ifEmpty { "(无备注)" })
                            Text(
                                "${formatDay(t.optLong("date"))} · ${formatYuan(t.optLong("amountCents"))}",
                                style = MaterialTheme.typography.bodySmall,
                            )
                        }
                        OutlinedButton(onClick = {
                            scope.launch {
                                try {
                                    ledger.restore(t.optString("id"))
                                    reload()
                                } catch (e: Exception) {
                                    error = e.message
                                }
                            }
                        }) { Text("恢复") }
                        OutlinedButton(onClick = {
                            scope.launch {
                                try {
                                    ledger.purge(t.optString("id"))
                                    reload()
                                } catch (e: Exception) {
                                    error = e.message
                                }
                            }
                        }) { Text("彻底删除") }
                    }
                }
            }
        }
    }
}
