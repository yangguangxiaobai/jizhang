package com.yansuu1.jizhang.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.material3.CircularProgressIndicator
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
import com.yansuu1.jizhang.repo.MetaRepository
import java.util.Calendar
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 * 账单 tab (A3). Month view with type filter; totals come from the rows'
 * server-computed月度 view is NOT built here — the list endpoint returns items
 * and this screen only renders them. Display sign parity with Web
 * `signedAmount`: income `+`, refund `+`, expense `-`.
 *
 * NOTE: this list is a MONTH view while balances are all-time (Web parity note
 * "仅显示X月"); the account-filter note says so explicitly.
 */
@Composable
fun TransactionsTab(
    api: ApiClient,
    onAuthExpired: () -> Unit,
    onNew: () -> Unit,
    onEdit: (String) -> Unit,
) {
    val scope = rememberCoroutineScope()
    val ledger = remember(api) { LedgerRepository(api) }
    val meta = remember(api) { MetaRepository(api) }
    var items by remember { mutableStateOf(listOf<JSONObject>()) }
    var total by remember { mutableStateOf(0) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var monthOffset by remember { mutableStateOf(0) }
    var typeFilter by remember { mutableStateOf<Int?>(null) }
    var accountFilter by remember { mutableStateOf<String?>(null) }
    var accountName by remember { mutableStateOf<String?>(null) }
    var categoryNames by remember { mutableStateOf(mapOf<String, String>()) }
    var accountNames by remember { mutableStateOf(mapOf<String, String>()) }
    var confirmDelete by remember { mutableStateOf<JSONObject?>(null) }

    suspend fun reload() {
        loading = true
        error = null
        try {
            val (from, to) = monthRange(monthOffset)
            val q = mutableMapOf("from" to from.toString(), "to" to to.toString(), "limit" to "500")
            if (typeFilter != null) q["type"] = typeFilter.toString()
            if (accountFilter != null) q["accountId"] = accountFilter!!
            val res = ledger.listTransactions(q)
            val arr = res.optJSONArray("items")
            val list = mutableListOf<JSONObject>()
            for (i in 0 until (arr?.length() ?: 0)) {
                (arr?.optJSONObject(i))?.let { list.add(it) }
            }
            items = list
            total = res.optInt("total", list.size)
            val cats = meta.categories().optJSONArray("items")
            val cn = mutableMapOf<String, String>()
            for (i in 0 until (cats?.length() ?: 0)) {
                val c = cats?.optJSONObject(i) ?: continue
                cn[c.optString("id")] = c.optString("name")
            }
            categoryNames = cn
            val accs = meta.accounts().optJSONArray("items")
            val an = mutableMapOf<String, String>()
            for (i in 0 until (accs?.length() ?: 0)) {
                val a = accs?.optJSONObject(i) ?: continue
                an[a.optString("id")] = a.optString("name")
            }
            accountNames = an
            accountName = accountFilter?.let { an[it] }
        } catch (e: AuthExpiredException) {
            onAuthExpired()
        } catch (e: Exception) {
            error = e.message ?: "加载失败"
        } finally {
            loading = false
        }
    }

    LaunchedEffect(monthOffset, typeFilter, accountFilter) {
        reload()
    }

    Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            OutlinedButton(onClick = { monthOffset-- }) { Text("‹") }
            Text(monthLabel(monthOffset), style = MaterialTheme.typography.titleMedium)
            OutlinedButton(onClick = { monthOffset++ }) { Text("›") }
        }
        Spacer(Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = { typeFilter = null }) { Text("全部") }
            OutlinedButton(onClick = { typeFilter = 0 }) { Text("支出") }
            OutlinedButton(onClick = { typeFilter = 1 }) { Text("收入") }
            if (accountFilter != null) {
                OutlinedButton(onClick = {
                    accountFilter = null
                    accountName = null
                }) { Text("清除筛选") }
            }
        }
        if (accountName != null) {
            Text(
                "正在按「$accountName」筛选 · 仅显示${monthLabel(monthOffset)}的账单",
                style = MaterialTheme.typography.bodySmall,
            )
        }
        Spacer(Modifier.height(8.dp))
        Button(onClick = onNew, modifier = Modifier.fillMaxWidth()) { Text("记一笔") }
        Spacer(Modifier.height(8.dp))
        Text("共 $total 笔", style = MaterialTheme.typography.bodySmall)
        Spacer(Modifier.height(8.dp))
        if (loading) {
            CircularProgressIndicator()
        } else if (error != null) {
            Text(error!!, color = MaterialTheme.colorScheme.error)
            OutlinedButton(onClick = { scope.launch { reload() } }) { Text("重试") }
        } else {
            LazyColumn(modifier = Modifier.fillMaxSize()) {
                items(items, key = { it.optString("id") }) { tx ->
                    val type = tx.optInt("type")
                    val refund = tx.optBoolean("isRefund")
                    val amount = tx.optLong("amountCents")
                    val sign = if (type == 1 || refund) "+" else "-"
                    Column(
                        modifier = Modifier.fillMaxWidth()
                            .clickable { onEdit(tx.optString("id")) }
                            .padding(vertical = 8.dp),
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                        ) {
                            Text(tx.optString("note").ifEmpty { "(无备注)" })
                            Text(
                                "$sign${formatYuan(amount)}",
                                color = if (sign == "+") MaterialTheme.colorScheme.primary
                                else MaterialTheme.colorScheme.error,
                            )
                        }
                        Text(
                            listOf(
                                categoryNames[tx.optString("categoryId")].orEmpty(),
                                accountNames[tx.optString("accountId")].orEmpty(),
                                formatDay(tx.optLong("date")),
                            ).filter { it.isNotEmpty() }.joinToString(" · "),
                            style = MaterialTheme.typography.bodySmall,
                        )
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedButton(onClick = { onEdit(tx.optString("id")) }) {
                                Text("编辑")
                            }
                            OutlinedButton(onClick = { confirmDelete = tx }) {
                                Text("删除")
                            }
                        }
                    }
                }
            }
        }
    }

    if (confirmDelete != null) {
        val label = confirmDelete!!.optString("note").ifEmpty { "这笔账单" }
        androidx.compose.material3.AlertDialog(
            onDismissRequest = { confirmDelete = null },
            title = { Text("删除$label？") },
            text = { Text("删除后可在回收站恢复") },
            confirmButton = {
                Button(onClick = {
                    val id = confirmDelete!!.optString("id")
                    confirmDelete = null
                    scope.launch {
                        try {
                            ledger.removeTransaction(id)
                            reload()
                        } catch (e: AuthExpiredException) {
                            onAuthExpired()
                        } catch (e: Exception) {
                            error = e.message
                        }
                    }
                }) { Text("删除") }
            },
            dismissButton = {
                OutlinedButton(onClick = { confirmDelete = null }) { Text("取消") }
            },
        )
    }
}

private fun monthRange(offset: Int): Pair<Long, Long> {
    val cal = Calendar.getInstance()
    cal.set(Calendar.DAY_OF_MONTH, 1)
    cal.set(Calendar.HOUR_OF_DAY, 0)
    cal.set(Calendar.MINUTE, 0)
    cal.set(Calendar.SECOND, 0)
    cal.set(Calendar.MILLISECOND, 0)
    cal.add(Calendar.MONTH, offset)
    val from = cal.timeInMillis
    cal.add(Calendar.MONTH, 1)
    return from to cal.timeInMillis
}

private fun monthLabel(offset: Int): String {
    val cal = Calendar.getInstance()
    cal.add(Calendar.MONTH, offset)
    return "${cal.get(Calendar.YEAR)}年${cal.get(Calendar.MONTH) + 1}月"
}
