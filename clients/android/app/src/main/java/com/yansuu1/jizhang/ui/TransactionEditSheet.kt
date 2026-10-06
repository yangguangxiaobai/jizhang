package com.yansuu1.jizhang.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
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
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 * 记一笔 / 编辑账单 (A3). Mirrors web `TransactionEditView.vue`:
 * - yuan text → integer cents via Math.round at the boundary (single float gate).
 * - type 支出/收入; refund checkbox only meaningful for 收入 (server enforces).
 * - category/account dropdowns from master data; date defaults today.
 * - after save: caller refreshes balances (Web: `balances.load(true)`).
 */
@Composable
fun TransactionEditSheet(
    api: ApiClient,
    editId: String?,
    onAuthExpired: () -> Unit,
    onSaved: () -> Unit,
    onClose: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val ledger = remember(api) { LedgerRepository(api) }
    val meta = remember(api) { MetaRepository(api) }
    var type by remember { mutableStateOf(0) }
    var amountText by remember { mutableStateOf("") }
    var parsedPreview by remember { mutableStateOf<Long?>(null) }
    var categoryId by remember { mutableStateOf("") }
    var accountId by remember { mutableStateOf("") }
    var dateText by remember { mutableStateOf(todayInput()) }
    var note by remember { mutableStateOf("") }
    var isRefund by remember { mutableStateOf(false) }
    var expenseCats by remember { mutableStateOf(listOf<JSONObject>()) }
    var incomeCats by remember { mutableStateOf(listOf<JSONObject>()) }
    var accounts by remember { mutableStateOf(listOf<JSONObject>()) }
    var loading by remember { mutableStateOf(editId != null) }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        try {
            val cats = meta.categories().optJSONArray("items")
            val ex = mutableListOf<JSONObject>()
            val inc = mutableListOf<JSONObject>()
            for (i in 0 until (cats?.length() ?: 0)) {
                val c = cats!!.optJSONObject(i)
                if (c.optInt("type") == 1) inc.add(c) else ex.add(c)
            }
            expenseCats = ex
            incomeCats = inc
            val accs = meta.accounts().optJSONArray("items")
            val al = mutableListOf<JSONObject>()
            for (i in 0 until (accs?.length() ?: 0)) al.add(accs!!.optJSONObject(i))
            accounts = al
            if (editId == null) {
                categoryId = ex.firstOrNull()?.optString("id").orEmpty()
                accountId = al.firstOrNull()?.optString("id").orEmpty()
            } else {
                val item = ledger.getTransaction(editId)
                type = item.optInt("type")
                amountText = "%.2f".format(item.optLong("amountCents") / 100.0)
                categoryId = item.optString("categoryId")
                accountId = item.optString("accountId")
                dateText = toDateInput(item.optLong("date"))
                note = item.optString("note")
                isRefund = item.optBoolean("isRefund")
            }
        } catch (e: AuthExpiredException) {
            onAuthExpired()
        } catch (e: Exception) {
            error = e.message
        } finally {
            loading = false
        }
    }

    if (loading) {
        Column(Modifier.fillMaxSize().padding(24.dp)) { Text("加载中…") }
        return
    }

    Column(
        modifier = Modifier.fillMaxSize().padding(16.dp).verticalScroll(rememberScrollState()),
    ) {
        Text(if (editId == null) "记一笔" else "编辑账单", style = MaterialTheme.typography.titleLarge)
        Spacer(Modifier.height(12.dp))
        Row {
            OutlinedButton(onClick = { type = 0 }) { Text(if (type == 0) "● 支出" else "支出") }
            OutlinedButton(onClick = { type = 1 }) { Text(if (type == 1) "● 收入" else "收入") }
        }
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(
            value = amountText,
            onValueChange = {
                amountText = it
                parsedPreview = parseYuanToCents(it)
            },
            label = { Text("金额（元）") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        if (parsedPreview != null) {
            Text("≈ ${formatYuan(parsedPreview!!)} 元", style = MaterialTheme.typography.bodySmall)
        }
        Spacer(Modifier.height(8.dp))
        CategoryPicker(
            label = "分类",
            items = (if (type == 1) incomeCats else expenseCats).map {
                it.optString("id") to it.optString("name")
            },
            selected = categoryId,
            onSelect = { categoryId = it },
        )
        Spacer(Modifier.height(8.dp))
        CategoryPicker(
            label = "账户",
            items = accounts.map { it.optString("id") to it.optString("name") },
            selected = accountId,
            onSelect = { accountId = it },
        )
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(
            value = dateText,
            onValueChange = { dateText = it },
            label = { Text("日期（YYYY-MM-DD）") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(
            value = note,
            onValueChange = { note = it },
            label = { Text("备注") },
            modifier = Modifier.fillMaxWidth(),
        )
        if (type == 1) {
            Spacer(Modifier.height(8.dp))
            Row {
                OutlinedButton(onClick = { isRefund = !isRefund }) {
                    Text(if (isRefund) "● 这是退款" else "这是退款")
                }
            }
        }
        if (error != null) {
            Spacer(Modifier.height(8.dp))
            Text(error!!, color = MaterialTheme.colorScheme.error)
        }
        Spacer(Modifier.height(16.dp))
        Button(
            enabled = !saving,
            modifier = Modifier.fillMaxWidth(),
            onClick = {
                scope.launch {
                    val cents = parseYuanToCents(amountText)
                    if (cents == null || cents <= 0) {
                        error = "金额须为大于 0 的数字"
                        return@launch
                    }
                    if (categoryId.isEmpty() || accountId.isEmpty()) {
                        error = "请选择分类与账户"
                        return@launch
                    }
                    saving = true
                    error = null
                    try {
                        val body = JSONObject()
                            .put("type", type)
                            .put("amountCents", cents)
                            .put("categoryId", categoryId)
                            .put("accountId", accountId)
                            .put("date", fromDateInput(dateText))
                            .put("note", note)
                            .put("isRefund", type == 1 && isRefund)
                        if (editId == null) ledger.createTransaction(jsonToMap(body))
                        else ledger.updateTransaction(editId, jsonToMap(body))
                        onSaved()
                    } catch (e: AuthExpiredException) {
                        onAuthExpired()
                    } catch (e: Exception) {
                        error = e.message ?: "保存失败"
                    } finally {
                        saving = false
                    }
                }
            },
        ) { Text(if (saving) "保存中…" else "保存") }
        Spacer(Modifier.height(8.dp))
        OutlinedButton(onClick = onClose, modifier = Modifier.fillMaxWidth()) { Text("取消") }
    }
}

@Composable
private fun CategoryPicker(
    label: String,
    items: List<Pair<String, String>>,
    selected: String,
    onSelect: (String) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    val current = items.firstOrNull { it.first == selected }?.second ?: "请选择$label"
    Column(Modifier.fillMaxWidth()) {
        Text(label, style = MaterialTheme.typography.bodySmall)
        OutlinedButton(onClick = { expanded = !expanded }, modifier = Modifier.fillMaxWidth()) {
            Text(current)
        }
        if (expanded) {
            for ((id, name) in items) {
                OutlinedButton(
                    onClick = {
                        onSelect(id)
                        expanded = false
                    },
                    modifier = Modifier.fillMaxWidth(),
                ) { Text(if (id == selected) "● $name" else name) }
            }
        }
    }
}

/** Web `parseYuanToCents` parity: Math.round once at the boundary, null when invalid. */
fun parseYuanToCents(text: String): Long? {
    val v = text.trim().toDoubleOrNull() ?: return null
    if (!v.isFinite() || v <= 0) return null
    return Math.round(v * 100)
}

private fun todayInput(): String =
    SimpleDateFormat("yyyy-MM-dd", Locale.CHINA).format(Date())

private fun toDateInput(epochMs: Long): String =
    SimpleDateFormat("yyyy-MM-dd", Locale.CHINA).format(Date(epochMs))

private fun fromDateInput(text: String): Long {
    return try {
        SimpleDateFormat("yyyy-MM-dd", Locale.CHINA).parse(text.trim())?.time
            ?: System.currentTimeMillis()
    } catch (_: Exception) {
        System.currentTimeMillis()
    }
}

private fun jsonToMap(o: JSONObject): Map<String, Any?> {
    val out = mutableMapOf<String, Any?>()
    val keys = o.keys()
    while (keys.hasNext()) {
        val k = keys.next()
        out[k] = o.opt(k)
    }
    return out
}
