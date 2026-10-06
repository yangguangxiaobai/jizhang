package com.yansuu1.jizhang.ui

import androidx.compose.foundation.layout.Column
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
import com.yansuu1.jizhang.repo.BudgetRepository
import com.yansuu1.jizhang.repo.MetaRepository
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 * 记工资 (A4). Salary funds a cycle and auto-allocates by template on the server;
 * this screen only collects amount/date/account (+note). `accountId` is REQUIRED —
 * the server answers 400 without it, never a silent default (backend spec).
 */
@Composable
fun SalarySheet(
    api: ApiClient,
    onAuthExpired: () -> Unit,
    onSaved: () -> Unit,
    onClose: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val repo = remember(api) { BudgetRepository(api) }
    val meta = remember(api) { MetaRepository(api) }
    var amountText by remember { mutableStateOf("") }
    var dateText by remember { mutableStateOf(todayStr()) }
    var note by remember { mutableStateOf("") }
    var accountId by remember { mutableStateOf("") }
    var accounts by remember { mutableStateOf(listOf<JSONObject>()) }
    var pastSalaries by remember { mutableStateOf(listOf<JSONObject>()) }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        try {
            val accs = meta.accounts().optJSONArray("items")
            val al = mutableListOf<JSONObject>()
            for (i in 0 until (accs?.length() ?: 0)) al.add(accs!!.optJSONObject(i))
            accounts = al
            accountId = al.firstOrNull()?.optString("id").orEmpty()
            val sals = repo.salaries().optJSONArray("items")
            val sl = mutableListOf<JSONObject>()
            for (i in 0 until (sals?.length() ?: 0)) sl.add(sals!!.optJSONObject(i))
            pastSalaries = sl
        } catch (e: AuthExpiredException) {
            onAuthExpired()
        } catch (e: Exception) {
            error = e.message
        }
    }

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Text("记工资", style = MaterialTheme.typography.titleLarge)
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(
            value = amountText,
            onValueChange = { amountText = it },
            label = { Text("金额（元）") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
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
        Text("到账账户", style = MaterialTheme.typography.bodySmall)
        for (a in accounts) {
            OutlinedButton(
                onClick = { accountId = a.optString("id") },
                modifier = Modifier.fillMaxWidth(),
            ) { Text(if (a.optString("id") == accountId) "● ${a.optString("name")}" else a.optString("name")) }
        }
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(
            value = note,
            onValueChange = { note = it },
            label = { Text("备注") },
            modifier = Modifier.fillMaxWidth(),
        )
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
                    if (cents == null || cents <= 0) {
                        error = "金额须为大于 0 的数字"
                        return@launch
                    }
                    if (accountId.isEmpty()) {
                        error = "请选择到账账户"
                        return@launch
                    }
                    saving = true
                    try {
                        repo.createSalary(
                            mapOf(
                                "amountCents" to cents,
                                "date" to parseDate(dateText),
                                "accountId" to accountId,
                                "note" to note,
                            ),
                        )
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
        ) { Text(if (saving) "保存中…" else "保存") }
        Spacer(Modifier.height(4.dp))
        OutlinedButton(onClick = onClose, modifier = Modifier.fillMaxWidth()) { Text("取消") }
        Spacer(Modifier.height(12.dp))
        Text("历史工资", style = MaterialTheme.typography.titleMedium)
        LazyColumn(Modifier.fillMaxSize()) {
            items(pastSalaries, key = { it.optString("id") }) { s ->
                Column(Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
                    Text("${formatYuan(s.optLong("amountCents"))} · ${formatDay(s.optLong("date"))}")
                    if (s.optString("note").isNotEmpty()) {
                        Text(s.optString("note"), style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }
    }
}

private fun todayStr(): String =
    SimpleDateFormat("yyyy-MM-dd", Locale.CHINA).format(Date())

private fun parseDate(text: String): Long {
    return try {
        SimpleDateFormat("yyyy-MM-dd", Locale.CHINA).parse(text.trim())?.time
            ?: System.currentTimeMillis()
    } catch (_: Exception) {
        System.currentTimeMillis()
    }
}
