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
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
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
import com.yansuu1.jizhang.repo.LedgerRepository
import com.yansuu1.jizhang.repo.MetaRepository
import com.yansuu1.jizhang.repo.RecurringRepository
import com.yansuu1.jizhang.repo.StatsRepository
import com.yansuu1.jizhang.ui.theme.LocalWebTokens
import kotlinx.coroutines.async
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 * 首页仪表盘 (A5). Mirrors web `DashboardView.vue`:
 * - asset card (STOCK, all-time balances) separate from month summary (FLOW).
 * - month income/net from `monthlyTrend(1)` last point — never summed from rows.
 * - budget remaining/percent/alert from `budget/overview` (server figures).
 * - recent 5 rows from `transactions.list({limit:5})`.
 * - recurring reminder card: explicit `generate` then pending count; failures
 *   swallowed so they cannot blank the dashboard.
 */
@Composable
fun DashboardTab(
    api: ApiClient,
    onAuthExpired: () -> Unit,
    onSeeAllTransactions: () -> Unit,
    onNewTransaction: () -> Unit,
    onPending: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val stats = remember(api) { StatsRepository(api) }
    val ledger = remember(api) { LedgerRepository(api) }
    val budget = remember(api) { BudgetRepository(api) }
    val meta = remember(api) { MetaRepository(api) }
    val recurring = remember(api) { RecurringRepository(api) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var totalBalance by remember { mutableStateOf<Long?>(null) }
    var monthLabelText by remember { mutableStateOf("本月概览") }
    var income by remember { mutableStateOf(0L) }
    var netExpense by remember { mutableStateOf(0L) }
    var budgetRemain by remember { mutableStateOf<Long?>(null) }
    var budgetPct by remember { mutableStateOf<Int?>(null) }
    var budgetAlert by remember { mutableStateOf<String?>(null) }
    var budgetAlertDanger by remember { mutableStateOf(false) }
    var recents by remember { mutableStateOf(listOf<JSONObject>()) }
    var catNames by remember { mutableStateOf(mapOf<String, String>()) }
    var pendingCount by remember { mutableStateOf(0) }

    suspend fun reload() {
        loading = true
        error = null
        try {
            val trendD = scope.async {
                stats.monthlyTrend(1)
            }
            val listD = scope.async {
                ledger.listTransactions(mapOf("limit" to "5"))
            }
            val budgetD = scope.async {
                budget.overview()
            }
            val metaD = scope.async {
                meta.categories()
            }
            val balD = scope.async {
                ledger.let { MetaRepository(api).balances() }
            }
            val trend = trendD.await()
            val list = listD.await()
            val ov = budgetD.await()
            val cats = metaD.await()
            val bals = try {
                balD.await()
            } catch (_: Exception) {
                null
            }
            val items = trend.optJSONArray("items")
            val cur = if ((items?.length() ?: 0) > 0) items!!.optJSONObject(items.length() - 1) else null
            if (cur != null) {
                monthLabelText = "${formatMonth(cur.optLong("monthStart"))}概览"
                income = cur.optLong("incomeCents")
                netExpense = cur.optLong("netExpenseCents")
            }
            val arr = list.optJSONArray("items")
            val rl = mutableListOf<JSONObject>()
            for (i in 0 until (arr?.length() ?: 0)) rl.add(arr!!.optJSONObject(i))
            recents = rl
            val cn = mutableMapOf<String, String>()
            val car = cats.optJSONArray("items")
            for (i in 0 until (car?.length() ?: 0)) {
                val c = car!!.optJSONObject(i)
                cn[c.optString("id")] = c.optString("name")
            }
            catNames = cn
            if (bals != null) {
                totalBalance = bals.optLong("totalBalanceCents")
            }
            if (ov.optBoolean("hasBudget", false)) {
                val tb = ov.optLong("totalBudgetCents")
                val ts = ov.optLong("totalSpentCents")
                budgetRemain = tb - ts
                budgetPct = if (tb <= 0) 0 else Math.round(ts.toFloat() / tb.toFloat() * 100)
                val mods = ov.optJSONArray("modules")
                var over = 0
                var near = 0
                for (i in 0 until (mods?.length() ?: 0)) {
                    val m = mods!!.optJSONObject(i)
                    val b = m.optLong("budgetCents")
                    val s = m.optLong("spentCents")
                    if (b > 0) {
                        val p = s.toFloat() / b.toFloat()
                        if (p > 1) over++ else if (p >= 0.8) near++
                    } else if (s > 0) {
                        over++
                    }
                }
                val poolNeg = ov.optLong("carryoverPoolCents") < 0
                if (over > 0 && poolNeg) {
                    budgetAlert = "有 $over 个模块超支，已从结余池借用"
                    budgetAlertDanger = true
                } else if (over > 0) {
                    budgetAlert = "有 $over 个模块超支"
                    budgetAlertDanger = true
                } else if (poolNeg) {
                    budgetAlert = "结余池已被透支，本周期支出超过了预算"
                    budgetAlertDanger = true
                } else if (near > 0) {
                    budgetAlert = "有 $near 个模块接近上限"
                    budgetAlertDanger = false
                } else {
                    budgetAlert = null
                }
            }
            // Recurring must not break the dashboard: swallow errors.
            try {
                recurring.generate()
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

    LaunchedEffect(Unit) {
        reload()
    }

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        if (loading) {
            CircularProgressIndicator()
            return@Column
        }
        if (error != null) {
            Text(error!!, color = MaterialTheme.colorScheme.error)
            JzGhostButton(text = "重试", onClick = { scope.launch { reload() } })
            return@Column
        }
        if (totalBalance != null) {
            // Web parity: asset card is the deep hero tone, not a pastel surface.
            HeroCard(Modifier.fillMaxWidth()) {
                Text("总余额 · 所有账户", color = LocalWebTokens.current.heroMuted)
                Text(
                    formatYuan(totalBalance!!),
                    style = MaterialTheme.typography.headlineMedium,
                    color = if (totalBalance!! < 0) LocalWebTokens.current.heroDanger
                    else LocalWebTokens.current.onHero,
                )
            }
            Spacer(Modifier.height(8.dp))
        }
        if (pendingCount > 0) {
            JzCard(Modifier.fillMaxWidth().clickable { onPending() }) {
                Text(
                    "$pendingCount 笔周期账单待确认 →",
                    color = MaterialTheme.colorScheme.primary,
                )
            }
            Spacer(Modifier.height(8.dp))
        }
        JzCard(Modifier.fillMaxWidth()) {
                Text(monthLabelText, style = MaterialTheme.typography.titleMedium)
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Column {
                        Text("收入", style = MaterialTheme.typography.bodySmall)
                        Text(formatYuan(income))
                    }
                    Column {
                        Text("净支出", style = MaterialTheme.typography.bodySmall)
                        Text(formatYuan(netExpense))
                    }
                    Column {
                        Text("结余", style = MaterialTheme.typography.bodySmall)
                        Text(formatYuan(income - netExpense))
                    }
                }
                if (budgetRemain != null) {
                    Spacer(Modifier.height(4.dp))
                    Text("预算剩余 ${formatYuan(budgetRemain!!)} · 已用 ${budgetPct ?: 0}%")
                    if (budgetAlert != null) {
                        Text(
                            budgetAlert!!,
                            color = if (budgetAlertDanger) MaterialTheme.colorScheme.error
                            else MaterialTheme.colorScheme.primary,
                        )
                    }
                }
        }
        Spacer(Modifier.height(8.dp))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("最近账单", style = MaterialTheme.typography.titleMedium)
            JzGhostButton(text = "查看全部", onClick = onSeeAllTransactions)
        }
        for (tx in recents) {
            val type = tx.optInt("type")
            val sign = if (type == 1) "+" else "-"
            Row(Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
                Column(Modifier.weight(1f)) {
                    Text(tx.optString("note").ifEmpty { catNames[tx.optString("categoryId")].orEmpty() })
                    Text(
                        "${formatDay(tx.optLong("date"))} · ${catNames[tx.optString("categoryId")].orEmpty()}",
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
                Text("$sign${formatYuan(tx.optLong("amountCents"))}")
            }
        }
        Spacer(Modifier.height(8.dp))
        JzPrimaryButton(text = "记一笔", onClick = onNewTransaction)
    }
}
