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
import com.yansuu1.jizhang.repo.MetaRepository
import com.yansuu1.jizhang.repo.RecurringRepository
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 * 周期账单规则 (A7). Rules + frequencies; due-date math stays server-side
 * (`anchorDate` anchor rule). Enable toggle + delete per rule.
 */
@Composable
fun RecurringRulesTab(
    api: ApiClient,
    onAuthExpired: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val repo = remember(api) { RecurringRepository(api) }
    val meta = remember(api) { MetaRepository(api) }
    var rules by remember { mutableStateOf(listOf<JSONObject>()) }
    var catNames by remember { mutableStateOf(mapOf<String, String>()) }
    var accNames by remember { mutableStateOf(mapOf<String, String>()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var editing by remember { mutableStateOf<JSONObject?>(null) }

    suspend fun reload() {
        loading = true
        try {
            val res = repo.rules()
            val arr = res.optJSONArray("items")
            val list = mutableListOf<JSONObject>()
            for (i in 0 until (arr?.length() ?: 0)) list.add(arr!!.optJSONObject(i))
            rules = list
            val cats = meta.categories().optJSONArray("items")
            val cn = mutableMapOf<String, String>()
            for (i in 0 until (cats?.length() ?: 0)) {
                val c = cats!!.optJSONObject(i)
                cn[c.optString("id")] = c.optString("name")
            }
            catNames = cn
            val accs = meta.accounts().optJSONArray("items")
            val an = mutableMapOf<String, String>()
            for (i in 0 until (accs?.length() ?: 0)) {
                val a = accs!!.optJSONObject(i)
                an[a.optString("id")] = a.optString("name")
            }
            accNames = an
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

    if (editing != null) {
        RuleEditor(
            api = api,
            initial = editing,
            catNames = catNames,
            accNames = accNames,
            onAuthExpired = onAuthExpired,
            onSaved = {
                editing = null
                scope.launch { reload() }
            },
            onClose = { editing = null },
        )
        return
    }

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Text("周期账单", style = MaterialTheme.typography.titleLarge)
        Spacer(Modifier.height(8.dp))
        OutlinedButton(onClick = { editing = JSONObject() }) { Text("新建规则") }
        Spacer(Modifier.height(8.dp))
        if (loading) {
            Text("加载中…")
        } else if (error != null) {
            Text(error!!, color = MaterialTheme.colorScheme.error)
        } else {
            LazyColumn(Modifier.fillMaxSize()) {
                items(rules, key = { it.optString("id") }) { r ->
                    Column(Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
                        Row(Modifier.fillMaxWidth()) {
                            Text(
                                r.optString("name") + if (!r.optBoolean("enabled")) "（已停用）" else "",
                                modifier = Modifier.weight(1f),
                            )
                            Text(formatYuan(r.optLong("amountCents")))
                        }
                        Text(
                            "${freqLabel(r.optString("frequency"))} · " +
                                "${catNames[r.optString("categoryId")].orEmpty()} · " +
                                "${accNames[r.optString("accountId")].orEmpty()}",
                            style = MaterialTheme.typography.bodySmall,
                        )
                        Row {
                            OutlinedButton(onClick = { editing = r }) { Text("编辑") }
                            OutlinedButton(onClick = {
                                scope.launch {
                                    try {
                                        repo.setEnabled(r.optString("id"), !r.optBoolean("enabled"))
                                        reload()
                                    } catch (e: Exception) {
                                        error = e.message
                                    }
                                }
                            }) { Text(if (r.optBoolean("enabled")) "停用" else "启用") }
                            OutlinedButton(onClick = {
                                scope.launch {
                                    try {
                                        repo.removeRule(r.optString("id"))
                                        reload()
                                    } catch (e: Exception) {
                                        error = e.message
                                    }
                                }
                            }) { Text("删除") }
                        }
                    }
                }
            }
        }
    }
}

private fun freqLabel(f: String): String = when (f) {
    "daily" -> "每天"
    "weekly" -> "每周"
    "monthly" -> "每月"
    "quarterly" -> "每季"
    "yearly" -> "每年"
    else -> f
}

@Composable
private fun RuleEditor(
    api: ApiClient,
    initial: JSONObject?,
    catNames: Map<String, String>,
    accNames: Map<String, String>,
    onAuthExpired: () -> Unit,
    onSaved: () -> Unit,
    onClose: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val repo = remember(api) { RecurringRepository(api) }
    val isNew = initial == null || !initial.has("id")
    var name by remember { mutableStateOf(initial?.optString("name").orEmpty()) }
    var type by remember { mutableStateOf(initial?.optInt("type") ?: 0) }
    var amountText by remember { mutableStateOf(if (isNew) "" else "%.2f".format((initial?.optLong("amountCents") ?: 0) / 100.0)) }
    var categoryId by remember { mutableStateOf(initial?.optString("categoryId").orEmpty()) }
    var accountId by remember { mutableStateOf(initial?.optString("accountId").orEmpty()) }
    var frequency by remember { mutableStateOf(initial?.optString("frequency") ?: "monthly") }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    Column(
        Modifier.fillMaxSize().padding(16.dp).verticalScroll(rememberScrollState()),
    ) {
        Text(if (isNew) "新建周期账单" else "编辑周期账单", style = MaterialTheme.typography.titleLarge)
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(
            value = name,
            onValueChange = { name = it },
            label = { Text("名称") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
        )
        Spacer(Modifier.height(8.dp))
        Row {
            OutlinedButton(onClick = { type = 0 }) { Text(if (type == 0) "● 支出" else "支出") }
            OutlinedButton(onClick = { type = 1 }) { Text(if (type == 1) "● 收入" else "收入") }
        }
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(
            value = amountText,
            onValueChange = { amountText = it },
            label = { Text("金额（元）") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
        )
        Spacer(Modifier.height(8.dp))
        Text("频率", style = MaterialTheme.typography.bodySmall)
        Row {
            for ((v, l) in listOf("daily" to "每天", "weekly" to "每周", "monthly" to "每月", "quarterly" to "每季", "yearly" to "每年")) {
                OutlinedButton(onClick = { frequency = v }) {
                    Text(if (frequency == v) "● $l" else l)
                }
            }
        }
        Spacer(Modifier.height(8.dp))
        Text("分类：${catNames[categoryId].orEmpty()}", style = MaterialTheme.typography.bodySmall)
        for ((id, n) in catNames.entries.take(20)) {
            OutlinedButton(onClick = { categoryId = id }, modifier = Modifier.fillMaxWidth()) {
                Text(if (id == categoryId) "● $n" else n)
            }
        }
        Spacer(Modifier.height(8.dp))
        Text("账户：${accNames[accountId].orEmpty()}", style = MaterialTheme.typography.bodySmall)
        for ((id, n) in accNames.entries) {
            OutlinedButton(onClick = { accountId = id }, modifier = Modifier.fillMaxWidth()) {
                Text(if (id == accountId) "● $n" else n)
            }
        }
        if (error != null) {
            Text(error!!, color = MaterialTheme.colorScheme.error)
        }
        Spacer(Modifier.height(8.dp))
        Button(
            enabled = !saving,
            modifier = Modifier.fillMaxWidth(),
            onClick = {
                scope.launch {
                    val cents = parseYuanToCents(amountText)
                    if (name.isBlank() || cents == null || cents <= 0 || categoryId.isEmpty() || accountId.isEmpty()) {
                        error = "请完整填写名称、金额、分类、账户"
                        return@launch
                    }
                    saving = true
                    try {
                        val body = mapOf(
                            "name" to name,
                            "type" to type,
                            "amountCents" to cents,
                            "categoryId" to categoryId,
                            "accountId" to accountId,
                            "frequency" to frequency,
                        )
                        if (isNew) repo.createRule(body)
                        else repo.updateRule(initial!!.optString("id"), body)
                        onSaved()
                    } catch (e: AuthExpiredException) {
                        onAuthExpired()
                    } catch (e: Exception) {
                        error = e.message
                    } finally {
                        saving = false
                    }
                }
            },
        ) { Text("保存") }
        Spacer(Modifier.height(4.dp))
        OutlinedButton(onClick = onClose, modifier = Modifier.fillMaxWidth()) { Text("取消") }
    }
}
