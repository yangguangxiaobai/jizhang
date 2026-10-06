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
import com.yansuu1.jizhang.repo.RecurringRepository
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 * 待确认账单 (A5). Due dates become PENDING, never bills; `confirm` is the only
 * call that puts money in the ledger and is idempotent (`created:false` repeats
 * return the same bill). Ignoring a confirmed occurrence is a server 409.
 */
@Composable
fun PendingTab(
    api: ApiClient,
    onAuthExpired: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val repo = remember(api) { RecurringRepository(api) }
    var items by remember { mutableStateOf(listOf<JSONObject>()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }

    suspend fun reload() {
        loading = true
        try {
            // Explicit generate (idempotent), then read the queue.
            try {
                repo.generate()
            } catch (_: Exception) {
            }
            val res = repo.pending()
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

    LaunchedEffect(Unit) {
        reload()
    }

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Text("待确认账单", style = MaterialTheme.typography.titleLarge)
        Spacer(Modifier.height(8.dp))
        if (loading) {
            Text("加载中…")
        } else if (error != null) {
            Text(error!!, color = MaterialTheme.colorScheme.error)
            OutlinedButton(onClick = { scope.launch { reload() } }) { Text("重试") }
        } else if (items.isEmpty()) {
            Text("暂无待确认账单")
        } else {
            LazyColumn(Modifier.fillMaxSize()) {
                items(items, key = { it.optString("id") }) { occ ->
                    Column(Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
                        Row(Modifier.fillMaxWidth()) {
                            Text(
                                occ.optString("note").ifEmpty { "周期账单" },
                                modifier = Modifier.weight(1f),
                            )
                            Text(formatYuan(occ.optLong("amountCents")))
                        }
                        Text(
                            formatDay(occ.optLong("plannedDate")),
                            style = MaterialTheme.typography.bodySmall,
                        )
                        Row {
                            OutlinedButton(onClick = {
                                scope.launch {
                                    try {
                                        repo.confirm(occ.optString("id"))
                                        reload()
                                    } catch (e: Exception) {
                                        error = e.message
                                    }
                                }
                            }) { Text("确认入账") }
                            OutlinedButton(onClick = {
                                scope.launch {
                                    try {
                                        repo.ignore(occ.optString("id"))
                                        reload()
                                    } catch (e: Exception) {
                                        error = e.message
                                    }
                                }
                            }) { Text("忽略") }
                        }
                    }
                }
            }
        }
    }
}
