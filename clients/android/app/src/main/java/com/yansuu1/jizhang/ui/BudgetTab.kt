package com.yansuu1.jizhang.ui

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
import androidx.compose.material3.LinearProgressIndicator
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
import com.yansuu1.jizhang.repo.BudgetRepository
import com.yansuu1.jizhang.repo.RecurringRepository
import java.util.Calendar
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 * 预算 tab (A4). Mirrors web `BudgetView.vue`:
 * - every figure server-computed (modules + carryover pool); this screen only renders.
 * - period switcher offered only when >1 cycle; history announces itself and never
 *   changes with new bills.
 * - empty state routes to salary entry.
 * - 80%–100% warning / overspend tone mirrors `budgetTone` intent (display only).
 */
@Composable
fun BudgetTab(
    api: ApiClient,
    onAuthExpired: () -> Unit,
    onNewSalary: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val repo = remember(api) { BudgetRepository(api) }
    val recurring = remember(api) { RecurringRepository(api) }
    var overview by remember { mutableStateOf<JSONObject?>(null) }
    var periods by remember { mutableStateOf(listOf<Long>()) }
    var currentStart by remember { mutableStateOf<Long?>(null) }
    var selected by remember { mutableStateOf<Long?>(null) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var pendingCount by remember { mutableStateOf(0) }

    suspend fun reload() {
        loading = true
        error = null
        try {
            val p = repo.periods()
            val arr = p.optJSONArray("periods")
            val list = mutableListOf<Long>()
            for (i in 0 until (arr?.length() ?: 0)) list.add(arr!!.optLong(i))
            periods = list
            currentStart = if (p.isNull("currentPeriodStart")) null else p.optLong("currentPeriodStart")
            overview = repo.overview(selected)
            try {
                val pend = recurring.pending()
                pendingCount = pend.optInt("total", pend.optJSONArray("items")?.length() ?: 0)
            } catch (_: Exception) {
                pendingCount = 0
            }
        } catch (e: AuthExpiredException) {
            onAuthExpired()
        } catch (e: Exception) {
            error = e.message ?: "加载失败"
        } finally {
            loading = false
        }
    }

    LaunchedEffect(selected) {
        reload()
    }

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Text("预算", style = MaterialTheme.typography.titleLarge)
        if (loading && overview == null) {
            Text("加载中…")
            return@Column
        }
        if (error != null) {
            Text(error!!, color = MaterialTheme.colorScheme.error)
            OutlinedButton(onClick = { scope.launch { reload() } }) { Text("重试") }
            return@Column
        }
        val ov = overview ?: return@Column
        if (pendingCount > 0) {
            Text("$pendingCount 笔周期账单待确认", color = MaterialTheme.colorScheme.primary)
            Spacer(Modifier.height(4.dp))
        }
        if (periods.size > 1) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = {
                    selected = null
                    scope.launch { reload() }
                }) { Text(if (selected == null) "● 当前周期" else "当前周期") }
                for (ps in periods.sortedDescending().take(6)) {
                    if (ps == currentStart && selected == null) continue
                    OutlinedButton(onClick = {
                        selected = ps
                        scope.launch { reload() }
                    }) { Text(if (selected == ps) "● ${periodLabel(ps)}" else periodLabel(ps)) }
                }
            }
            Spacer(Modifier.height(4.dp))
        }
        if (selected != null) {
            Text(
                "正在查看历史周期 ${periodLabel(selected!!)}，数据不会随新账单变化。",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.primary,
            )
            Spacer(Modifier.height(4.dp))
        }
        if (!ov.optBoolean("hasBudget", false)) {
            Text("还没有预算周期")
            Text("记一次工资，系统会按模板比例自动分配各模块预算。")
            Spacer(Modifier.height(8.dp))
            Button(onClick = onNewSalary) { Text("记工资") }
            return@Column
        }
        val pool = ov.optLong("carryoverPoolCents")
        Text("结余池：${formatYuan(pool)}", style = MaterialTheme.typography.titleMedium)
        Text(
            "总预算 ${formatYuan(ov.optLong("totalBudgetCents"))} · 已用 ${formatYuan(ov.optLong("totalSpentCents"))}",
            style = MaterialTheme.typography.bodySmall,
        )
        Spacer(Modifier.height(8.dp))
        val modules = ov.optJSONArray("modules")
        val list = mutableListOf<JSONObject>()
        for (i in 0 until (modules?.length() ?: 0)) list.add(modules!!.optJSONObject(i))
        LazyColumn(Modifier.fillMaxSize()) {
            items(list, key = { it.optString("categoryId") }) { m ->
                val budget = m.optLong("budgetCents")
                val spent = m.optLong("spentCents")
                val remaining = m.optLong("remainingCents")
                val ratio = barRatio(spent, budget)
                val tone = budgetTone(spent, budget)
                Column(Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Text(m.optString("categoryName"))
                        Text("${formatYuan(spent)} / ${formatYuan(budget)}")
                    }
                    LinearProgressIndicator(
                        progress = { ratio },
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Text(
                        "剩余 ${formatYuan(remaining)} · ${usedPercent(spent, budget)}%$tone",
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
        }
    }
}

/** Web `barRatio` parity: unit interval, overspend capped at 1. */
fun barRatio(spent: Long, budget: Long): Float {
    if (budget <= 0) return if (spent > 0) 1f else 0f
    return minOf(1f, spent.toFloat() / budget.toFloat())
}

fun usedPercent(spent: Long, budget: Long): Int {
    if (budget <= 0) return if (spent > 0) 100 else 0
    return Math.round(spent.toFloat() / budget.toFloat() * 100)
}

/** Display-only tone suffix (Web `budgetTone` intent: 80–100% warning, overspend alert). */
fun budgetTone(spent: Long, budget: Long): String {
    if (budget <= 0) return if (spent > 0) "（已超支）" else ""
    val pct = spent.toFloat() / budget.toFloat()
    return when {
        pct > 1 -> "（已超支）"
        pct >= 0.8 -> "（将超支）"
        else -> ""
    }
}

private fun periodLabel(periodStart: Long): String {
    val cal = Calendar.getInstance()
    cal.timeInMillis = periodStart
    return "${cal.get(Calendar.YEAR)}年${cal.get(Calendar.MONTH) + 1}月"
}
