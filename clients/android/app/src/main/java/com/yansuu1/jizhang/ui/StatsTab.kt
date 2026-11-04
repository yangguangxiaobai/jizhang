package com.yansuu1.jizhang.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.yansuu1.jizhang.net.ApiClient
import com.yansuu1.jizhang.net.ApiException
import com.yansuu1.jizhang.net.AuthExpiredException
import com.yansuu1.jizhang.repo.AdminRepository
import com.yansuu1.jizhang.repo.FinancialGoalRepository
import com.yansuu1.jizhang.repo.FinancialGoalUnsupportedException
import com.yansuu1.jizhang.repo.FinancialGoalView
import com.yansuu1.jizhang.repo.MonthlyPlanRepository
import com.yansuu1.jizhang.repo.MonthlyPlanState
import com.yansuu1.jizhang.repo.MonthlyPlanView
import com.yansuu1.jizhang.repo.StatsRepository
import com.yansuu1.jizhang.ui.theme.LocalWebTokens
import java.util.Calendar
import java.util.Locale
import kotlinx.coroutines.CancellationException
import org.json.JSONArray
import org.json.JSONObject

private data class CategoryStatsRead(val window: StatsWindow, val items: List<JSONObject>, val total: Long, val refund: Long?)

/** C3: server-owned ranges and gross totals; opening bills does not dispose the source scroll. */
@Composable
fun StatsTab(
    api: ApiClient,
    onAuthExpired: () -> Unit,
    onBack: () -> Unit = {},
    refreshToken: Long = 0L,
) {
    val repo = remember(api) { StatsRepository(api) }
    val admin = remember(api) { AdminRepository(api) }
    var windowKind by remember(api) { mutableStateOf("thisMonth") }
    var selectedMonth by remember(api) { mutableStateOf<String?>(null) }
    var accountId by remember(api) { mutableStateOf<String?>(null) }
    var months by remember(api) { mutableIntStateOf(6) }
    var showCharts by remember(api) { mutableStateOf(true) }
    var moreOpen by remember(api) { mutableStateOf(false) }
    var monthPickerOpen by remember(api) { mutableStateOf(false) }
    var pickerYear by remember { mutableIntStateOf(Calendar.getInstance().get(Calendar.YEAR)) }
    var pickerMonth by remember { mutableIntStateOf(Calendar.getInstance().get(Calendar.MONTH) + 1) }
    var drilldown by remember(api) { mutableStateOf<TransactionDrilldownQuery?>(null) }
    val scroll = rememberScrollState()
    BackHandler(enabled = drilldown == null) { onBack() }

    // Scope keys isolate old rows immediately, not one frame after a new effect begins.
    val categoryOwner = remember(api, windowKind, selectedMonth, accountId) { StatsReadOwner() }
    DisposableEffect(categoryOwner) { onDispose { categoryOwner.dispose() } }
    var category by remember(categoryOwner) { mutableStateOf<CategoryStatsRead?>(null) }
    var categoryLoading by remember(categoryOwner) { mutableStateOf(true) }
    var categoryError by remember(categoryOwner) { mutableStateOf<String?>(null) }
    var categoryRetry by remember(categoryOwner) { mutableIntStateOf(0) }
    LaunchedEffect(categoryOwner, categoryRetry, refreshToken) {
        val ticket = categoryOwner.start()
        categoryLoading = true
        categoryError = null
        try {
            val result = scopedStatsRead({ FinancialPrefs.resolveAuthenticatedScope(api) }) {
            val window = decodeStatsWindow(repo.window(
                if (windowKind == "last30") "last30" else "month",
                if (windowKind == "month") selectedMonth else null,
            ))
            val response = repo.categoryShare(window.from, window.to, accountId)
            if (accountId != null) require(response.opt("accountId") == accountId) {
                "服务端未确认所选账户筛选，请升级服务端后重试。"
            }
            require(statsRequiredLong(response, "from") == window.from && statsRequiredLong(response, "to") == window.to) {
                "分类统计与服务端区间不一致"
            }
            val items = statsObjects(response, "items")
            items.forEach { statsRequiredText(it, "categoryId"); statsRequiredText(it, "categoryName"); statsRequiredLong(it, "amountCents") }
            CategoryStatsRead(window, items, statsRequiredLong(response, "totalCents"), optionalRefundIncomeCents(response))
            }
            if (categoryOwner.owns(ticket)) category = result
        } catch (e: CancellationException) {
            throw e
        } catch (e: AuthExpiredException) {
            if (categoryOwner.owns(ticket)) onAuthExpired()
        } catch (e: Exception) {
            if (categoryOwner.owns(ticket)) categoryError = if (e is ApiException && e.status == 404) {
                "当前服务不支持统计区间，请升级服务端。未使用设备时间猜测范围。"
            } else e.message ?: "分类统计读取失败"
        } finally {
            if (categoryOwner.owns(ticket)) categoryLoading = false
        }
    }

    val endMonth = if (windowKind == "month") selectedMonth else null
    val trendOwner = remember(api, months, endMonth) { StatsReadOwner() }
    DisposableEffect(trendOwner) { onDispose { trendOwner.dispose() } }
    var trend by remember(trendOwner) { mutableStateOf<List<JSONObject>?>(null) }
    var trendCaption by remember(trendOwner) { mutableStateOf<String?>(null) }
    var trendLoading by remember(trendOwner) { mutableStateOf(true) }
    var trendError by remember(trendOwner) { mutableStateOf<String?>(null) }
    var trendRetry by remember(trendOwner) { mutableIntStateOf(0) }
    LaunchedEffect(trendOwner, trendRetry, refreshToken) {
        val ticket = trendOwner.start()
        trendLoading = true
        trendError = null
        try {
            val (items, caption) = scopedStatsRead({ FinancialPrefs.resolveAuthenticatedScope(api) }) {
            val items = statsObjects(repo.monthlyTrend(months, endMonth), "items")
            items.forEach { statsRequiredLong(it, "incomeCents"); statsRequiredLong(it, "netExpenseCents"); optionalRefundIncomeCents(it) }
            val caption = monthlyTrendCaption(items)
            require(items.size == months) { "服务端趋势月份不完整" }
            if (endMonth != null) require(items.last().getString("month") == endMonth) { "服务端不支持所选趋势月份，请升级后再查看历史趋势。" }
            items to caption
            }
            if (trendOwner.owns(ticket)) { trend = items; trendCaption = caption }
        } catch (e: CancellationException) {
            throw e
        } catch (e: AuthExpiredException) {
            if (trendOwner.owns(ticket)) onAuthExpired()
        } catch (e: Exception) {
            if (trendOwner.owns(ticket)) trendError = e.message ?: "月度趋势读取失败"
        } finally {
            if (trendOwner.owns(ticket)) trendLoading = false
        }
    }

    val accountsOwner = remember(api) { StatsReadOwner() }
    DisposableEffect(accountsOwner) { onDispose { accountsOwner.dispose() } }
    var accountNames by remember(accountsOwner) { mutableStateOf<Map<String, String>>(emptyMap()) }
    var accountsError by remember(accountsOwner) { mutableStateOf<String?>(null) }
    var accountsRetry by remember(accountsOwner) { mutableIntStateOf(0) }
    LaunchedEffect(accountsOwner, accountsRetry) {
        val ticket = accountsOwner.start()
        accountsError = null
        try {
            val names = scopedStatsRead({ FinancialPrefs.resolveAuthenticatedScope(api) }) {
                statsObjects(admin.accounts(includeDeleted = true), "items").associate {
                    statsRequiredText(it, "id") to statsRequiredText(it, "name")
                }
            }
            if (accountsOwner.owns(ticket)) accountNames = names
        } catch (e: CancellationException) { throw e
        } catch (e: AuthExpiredException) { if (accountsOwner.owns(ticket)) onAuthExpired()
        } catch (e: Exception) { if (accountsOwner.owns(ticket)) accountsError = e.message ?: "账户选项读取失败" }
    }

    // The review names its distinct confirmed-plan window instead of comparing unrelated gross scopes.
    val reviewOwner = remember(api, endMonth) { StatsReadOwner() }
    DisposableEffect(reviewOwner) { onDispose { reviewOwner.dispose() } }
    var plan by remember(reviewOwner) { mutableStateOf<MonthlyPlanView?>(null) }
    var planError by remember(reviewOwner) { mutableStateOf<String?>(null) }
    LaunchedEffect(reviewOwner, categoryRetry, refreshToken) {
        val ticket = reviewOwner.start()
        try {
            val read = scopedStatsRead({ FinancialPrefs.resolveAuthenticatedScope(api) }) {
                MonthlyPlanRepository(api).load(month = endMonth)
            }
            if (reviewOwner.owns(ticket)) { plan = read; planError = null }
        } catch (e: CancellationException) { throw e
        } catch (e: AuthExpiredException) { if (reviewOwner.owns(ticket)) onAuthExpired()
        } catch (e: Exception) { if (reviewOwner.owns(ticket)) planError = e.message ?: "计划预算提示不可用" }
    }

    val goalOwner = remember(api, category?.window?.from, category?.window?.to) { StatsReadOwner() }
    DisposableEffect(goalOwner) { onDispose { goalOwner.dispose() } }
    var goalView by remember(goalOwner) { mutableStateOf<FinancialGoalView?>(null) }
    var goalError by remember(goalOwner) { mutableStateOf<String?>(null) }
    var goalLoading by remember(goalOwner) { mutableStateOf(false) }

    val catWindow = category?.window
    LaunchedEffect(catWindow?.from, catWindow?.to, categoryRetry, refreshToken) {
        val w = catWindow
        if (w == null) {
            goalView = null
            goalError = null
            goalLoading = false
            return@LaunchedEffect
        }
        val ticket = goalOwner.start()
        goalLoading = true
        try {
            val expectedContext = ManualGoalWindowContext(
                from = w.from,
                to = w.to,
                label = w.label,
                timeZone = w.timeZone,
            )
            val response = scopedStatsRead({ FinancialPrefs.resolveAuthenticatedScope(api) }) {
                FinancialGoalRepository(api).load(from = expectedContext.from, to = expectedContext.to)
            }
            if (goalOwner.owns(ticket)) {
                requireManualGoalWindow(response, expectedContext)
                goalView = response
                goalError = null
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: AuthExpiredException) {
            if (goalOwner.owns(ticket)) onAuthExpired()
        } catch (e: FinancialGoalUnsupportedException) {
            if (goalOwner.owns(ticket)) {
                goalView = null
                goalError = "服务端未支持手动目标接口 (404)"
            }
        } catch (e: Exception) {
            if (goalOwner.owns(ticket)) {
                goalError = e.message ?: "读取实际存投失败"
            }
        } finally {
            if (goalOwner.owns(ticket)) goalLoading = false
        }
    }

    Column(Modifier.fillMaxSize().verticalScroll(scroll).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "返回") }
            Column(Modifier.weight(1f)) {
                Text("费用统计", style = MaterialTheme.typography.headlineSmall)
                Text("支出保持毛额；退款是收入，不抵减此处支出。", style = MaterialTheme.typography.bodySmall)
            }
            OutlinedButton(onClick = { categoryRetry++; trendRetry++ }, enabled = !categoryLoading && !trendLoading) { Text("刷新") }
        }
        JzCard {
            Text("分类排行", style = MaterialTheme.typography.titleLarge)
            Text(category?.window?.label ?: if (windowKind == "last30") "近 30 天" else if (windowKind == "month") selectedMonth.orEmpty() else "本月", style = MaterialTheme.typography.titleSmall)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(selected = windowKind == "thisMonth", onClick = { windowKind = "thisMonth" }, label = { Text("本月") })
                TextButton(onClick = { moreOpen = !moreOpen }) { Text(if (moreOpen) "收起选项" else "更多范围与显示") }
            }
            if (moreOpen) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(selected = windowKind == "last30", onClick = { windowKind = "last30" }, label = { Text("近 30 天") })
                    OutlinedButton(onClick = { monthPickerOpen = true }) { Text("指定月份") }
                }
                ListChoice("分类账户", TransactionQueryHelper.buildAccountChoices(accountNames, accountId), accountId.orEmpty()) { accountId = it.ifBlank { null } }
                accountsError?.let { Text(it, color = MaterialTheme.colorScheme.error); TextButton(onClick = { accountsRetry++ }) { Text("重试账户") } }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(selected = showCharts, onClick = { showCharts = true }, label = { Text("图表") })
                    FilterChip(selected = !showCharts, onClick = { showCharts = false }, label = { Text("明细") })
                }
            }
            if (categoryLoading) LinearProgressIndicator(Modifier.fillMaxWidth())
            categoryError?.let { StatsError(it, category != null) { categoryRetry++ } }
            category?.let { read ->
                Text(statsWindowCaption(read.window), style = MaterialTheme.typography.bodySmall)
                Text("${TransactionQueryHelper.accountDisplayLabel(accountId, accountNames)} · 同范围退款收入 ${read.refund?.let { "¥${formatYuan(it)}（已计收入）" } ?: "未提供"}", style = MaterialTheme.typography.bodySmall)
                DonutChart(read.items, read.total, showCharts, onCategoryClick = { row ->
                    drilldown = TransactionDrilldownQuery(read.window.from, read.window.to, row.getString("categoryId"), row.getString("categoryName"), accountId, statsWindowCaption(read.window), row.getLong("amountCents"))
                })
            }
        }
        JzCard {
            Text("收支月趋势", style = MaterialTheme.typography.titleLarge)
            Text(trendCaption ?: "正在读取服务端真实月份范围…", style = MaterialTheme.typography.bodySmall)
            Text("收入包括工资和退款；支出为毛支出。账面结余不等于实际存钱。", style = MaterialTheme.typography.bodySmall)
            if (moreOpen) Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf(3, 6, 12).forEach { count -> FilterChip(selected = months == count, onClick = { months = count }, label = { Text("$count 个月") }) }
            }
            Text("趋势为全部账户，独立于上方分类账户；指定月份时以该月为末月。", style = MaterialTheme.typography.bodySmall)
            if (trendLoading) LinearProgressIndicator(Modifier.fillMaxWidth())
            trendError?.let { StatsError(it, trend != null) { trendRetry++ } }
            trend?.let { MonthlyBars(it, showCharts) }
        }
        JzCard {
            Text("消费复盘 · 无需 AI", style = MaterialTheme.typography.titleLarge)
            val read = category
            if (read == null) Text("分类数据尚不可用，暂不生成消费结论。")
            else {
                Text("来源：分类毛支出统计 · ${read.window.label} · ${TransactionQueryHelper.accountDisplayLabel(accountId, accountNames)}", style = MaterialTheme.typography.bodySmall)
                if (read.items.isEmpty()) Text("本范围没有支出记录，暂无消费最多分类。")
                else {
                    val top = read.items.first()
                    Text("消费最多：${top.getString("categoryName")} · ¥${formatYuan(top.getLong("amountCents"))}")
                    Text("下月可优先检查该分类的大额或重复消费；这里不自动改预算。", style = MaterialTheme.typography.bodySmall)
                }
                if (categoryLoading || categoryError != null) Text("分类数据更新中或已过期，上述结论仅对应上次成功范围。", color = MaterialTheme.colorScheme.error)
            }
            planError?.let { Text("计划预算提示不可用：$it", style = MaterialTheme.typography.bodySmall) }
            plan?.let { view ->
                if (view.state != MonthlyPlanState.READY) Text("没有可用的已确认计划，暂不判断预算超支。")
                else {
                    Text("独立计划来源：${view.window?.label}；为用途净消费，范围和退款口径不同于上方分类排行。", style = MaterialTheme.typography.bodySmall)
                    val remaining = view.summary?.remainingCents
                    Text(when {
                        planError != null -> "计划提示已过期，请到计划页刷新核对。"
                        remaining == null -> "计划存在待核对事实，暂不判断精确剩余或超支。"
                        remaining < 0 -> "已确认计划预算超支，请到计划页检查消费与退款归属。"
                        else -> "已确认计划尚未超支；不代表账户可用余额或实际储蓄。"
                    })
                }
            }
            goalView?.window?.let { gw ->
                val accountPrefix = if (accountId != null) "手动存投（全部目标，未按账户筛选）" else "同周期手动存投"
                val reserveNet = gw.reserve.netAdditionsCents
                val investNet = gw.investment.netAdditionsCents
                Text(
                    "$accountPrefix：本期手动净存入 ${if (reserveNet >= 0) "+" else ""}¥${formatYuan(reserveNet)} · 本期本金净投入 ${if (investNet >= 0) "+" else ""}¥${formatYuan(investNet)}",
                    style = MaterialTheme.typography.bodySmall,
                )
                if (accountId != null) {
                    Text("提示：存钱与投资目标不关联单个账户，不计入上方账户筛选总额或净储蓄率。", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            } ?: run {
                if (goalLoading) {
                    Text("正在读取同周期手动存钱与投资进度…", style = MaterialTheme.typography.bodySmall)
                } else if (goalError != null) {
                    Text("同周期手动存投进度不可用：$goalError", style = MaterialTheme.typography.bodySmall)
                } else {
                    Text("实际存钱与投资投入不由收支差额推算；请以手动确认进度记录为准。", style = MaterialTheme.typography.bodySmall)
                }
            }
        }
        Text("结余池已移至：计划 → 明细工具 → 分类信封预算 → 高级预算。", style = MaterialTheme.typography.bodySmall)
        Spacer(Modifier.height(8.dp))
    }

    if (monthPickerOpen) AlertDialog(
        onDismissRequest = { monthPickerOpen = false }, title = { Text("选择统计月份") },
        text = { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = { pickerYear = (pickerYear - 1).coerceAtLeast(2000) }) { Text("上一年") }
                Text("${pickerYear}年")
                OutlinedButton(onClick = { pickerYear = (pickerYear + 1).coerceAtMost(9998) }) { Text("下一年") }
            }
            (1..12).toList().chunked(3).forEach { row -> Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                row.forEach { month -> FilterChip(selected = pickerMonth == month, onClick = { pickerMonth = month }, label = { Text("${month}月") }, modifier = Modifier.weight(1f)) }
            } }
        } },
        confirmButton = { TextButton(onClick = { selectedMonth = "%04d-%02d".format(Locale.ROOT, pickerYear, pickerMonth); windowKind = "month"; monthPickerOpen = false }) { Text("应用月份") } },
        dismissButton = { TextButton(onClick = { monthPickerOpen = false }) { Text("取消") } },
    )
    drilldown?.let { query -> Dialog(onDismissRequest = { drilldown = null }, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = true)) {
        TransactionDrilldownScreen(api, query, onAuthExpired, onBack = { drilldown = null })
    } }
}

@Composable
private fun StatsError(message: String, retaining: Boolean, onRetry: () -> Unit) {
    Text(message, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
    if (retaining) Text("仍显示同条件上次成功的数据与范围，不是本次最新结果。", style = MaterialTheme.typography.bodySmall)
    OutlinedButton(onClick = onRetry) { Text("重试") }
}

private fun statsObjects(json: JSONObject, key: String): List<JSONObject> {
    val array = json.opt(key) as? JSONArray ?: throw IllegalArgumentException("统计响应缺少数组 $key")
    return List(array.length()) { array.getJSONObject(it) }
}
