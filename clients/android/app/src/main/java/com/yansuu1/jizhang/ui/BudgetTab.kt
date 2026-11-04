package com.yansuu1.jizhang.ui

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.yansuu1.jizhang.net.ApiClient
import com.yansuu1.jizhang.net.AuthExpiredException
import com.yansuu1.jizhang.repo.BudgetRepository
import com.yansuu1.jizhang.repo.RecurringRepository
import com.yansuu1.jizhang.ui.theme.LocalWebTokens
import kotlinx.coroutines.CancellationException
import org.json.JSONArray
import org.json.JSONObject

/** Budget display. Amounts and module values come directly from the server overview. */
@Composable
fun BudgetTab(
    api: ApiClient,
    onAuthExpired: () -> Unit,
    onNewSalary: () -> Unit,
    onTemplates: () -> Unit,
    onOpenFinancialPlan: () -> Unit = {},
    onBack: () -> Unit = {},
    showHeader: Boolean = true,
) {
    val repo = remember(api) { BudgetRepository(api) }
    val recurring = remember(api) { RecurringRepository(api) }
    var overview by remember(api) { mutableStateOf<JSONObject?>(null) }
    var periods by remember(api) { mutableStateOf(listOf<Long>()) }
    var currentStart by remember(api) { mutableStateOf<Long?>(null) }
    var selected by remember(api) { mutableStateOf<Long?>(null) }
    var displayedPeriod by remember(api) { mutableStateOf<Long?>(null) }
    var displayedPeriodIsCurrent by remember(api) { mutableStateOf(true) }
    var loading by remember(api) { mutableStateOf(true) }
    var error by remember(api) { mutableStateOf<String?>(null) }
    var pendingCount by remember(api) { mutableIntStateOf(0) }
    var pendingError by remember(api) { mutableStateOf<String?>(null) }
    var reloadKey by remember(api) { mutableIntStateOf(0) }
    var expandedModuleId by remember(api) { mutableStateOf<String?>(null) }

    suspend fun reload(requestedPeriod: Long?) {
        loading = true
        error = null
        try {
            val response = repo.periods()
            val periodArray = response.optJSONArray("periods")
            val nextPeriods = buildList {
                for (index in 0 until (periodArray?.length() ?: 0)) {
                    add(periodArray!!.optLong(index))
                }
            }
            val nextCurrentStart = if (response.isNull("currentPeriodStart")) {
                null
            } else {
                response.optLong("currentPeriodStart")
            }
            val nextOverview = repo.overview(requestedPeriod)

            // Publish the selected period and its overview together so an older
            // response can never label one cycle with another cycle's numbers.
            periods = nextPeriods
            currentStart = nextCurrentStart
            overview = nextOverview
            displayedPeriod = requestedPeriod ?: nextCurrentStart
            displayedPeriodIsCurrent = requestedPeriod == null
            expandedModuleId = null

            try {
                val pending = recurring.pending()
                pendingCount = pending.optInt(
                    "total",
                    pending.optJSONArray("items")?.length() ?: 0,
                )
                pendingError = null
            } catch (e: AuthExpiredException) {
                throw e
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                pendingError = e.message ?: "请稍后重试"
            }
        } catch (e: AuthExpiredException) {
            onAuthExpired()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            error = e.message ?: "预算加载失败，请重试。"
        } finally {
            loading = false
        }
    }

    LaunchedEffect(repo, selected, reloadKey) {
        reload(selected)
    }

    val tokens = LocalWebTokens.current
    val data = overview
    val hasBudget = data?.optBoolean("hasBudget", false) == true
    val modules = remember(data) { data?.optJSONArray("modules").toJsonObjects() ?: emptyList() }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (showHeader) {
            item {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                    }
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text("预算", style = MaterialTheme.typography.headlineSmall)
                        Text(
                            "按预算周期查看分类额度、实际支出和结余池。预算周期由服务端起算日决定，与自然月不同。",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }

        item {
            JzCard {
                Text("工资与分配", style = MaterialTheme.typography.titleMedium)
                Text(
                    "记录到账日期与分配；预算结果以服务端为准。",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(8.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    OutlinedButton(onClick = onTemplates, modifier = Modifier.weight(1f)) {
                        Text("分配模板")
                    }
                    Button(onClick = onNewSalary, modifier = Modifier.weight(1f)) {
                        Text("记工资")
                    }
                }
            }
        }

        item {
            JzCard {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text("四账户理财计划", style = MaterialTheme.typography.titleMedium)
                        Text(
                            "基于 25/15/50/10 资产用途规划与5个月必要开支应急储备测算。",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Spacer(Modifier.width(8.dp))
                    OutlinedButton(onClick = onOpenFinancialPlan) {
                        Text("查看计划")
                    }
                }
            }
        }

        if (periods.size > 1) {
            item {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("预算周期", style = MaterialTheme.typography.titleMedium)
                    Row(
                        modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        FilterChip(
                            selected = selected == null,
                            onClick = {
                                expandedModuleId = null
                                selected = null
                            },
                            label = { Text("当前周期") },
                        )
                        // Preserve the server's period order. The current cycle is
                        // represented by the pinned current chip above.
                        periods.filter { it != currentStart }.forEach { period ->
                            FilterChip(
                                selected = selected == period,
                                onClick = {
                                    expandedModuleId = null
                                    selected = period
                                },
                                label = { Text("历史 · ${periodLabel(period)}") },
                            )
                        }
                    }
                }
            }
        }

        if (loading && data == null) {
            item { BudgetStateCard(title = "正在加载预算", message = "正在读取预算周期与服务端汇总。") }
        }

        if (error != null) {
            item {
                BudgetErrorCard(
                    message = if (data == null) error!! else "周期切换失败，仍显示上次成功的预算。${error!!}",
                    onRetry = { reloadKey += 1 },
                )
            }
        }

        if (loading && data != null && error == null) {
            item {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    LinearProgressIndicator(Modifier.fillMaxWidth())
                    Text("正在更新预算数据…", style = MaterialTheme.typography.bodySmall)
                }
            }
        }

        if (data != null) {
            item {
                JzCard {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(
                                if (displayedPeriodIsCurrent) "当前预算周期" else "历史预算周期",
                                style = MaterialTheme.typography.titleMedium,
                            )
                            displayedPeriod?.let { period ->
                                Text(
                                    "周期起始 ${periodLabel(period)}",
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                        if (!displayedPeriodIsCurrent) {
                            Text(
                                "历史",
                                modifier = Modifier.semantics {
                                    contentDescription = "正在查看历史预算周期"
                                },
                                style = MaterialTheme.typography.labelLarge,
                                color = tokens.accent,
                            )
                        }
                    }
                    if (!displayedPeriodIsCurrent) {
                        Spacer(Modifier.height(8.dp))
                        Text(
                            "这是历史周期的只读预算。新增工资请核对到账日期与分配周期。",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }

            if (!hasBudget) {
                item {
                    JzCard {
                        Text("还没有预算周期", style = MaterialTheme.typography.titleMedium)
                        Spacer(Modifier.height(4.dp))
                        Text(
                            "记录一笔工资并配置分配后，服务端会生成预算模块。",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Spacer(Modifier.height(12.dp))
                        Button(onClick = onNewSalary) { Text("记录第一笔工资") }
                    }
                }
            } else {
                item {
                    val totalBudget = data.optLong("totalBudgetCents")
                    val totalSpent = data.optLong("totalSpentCents")
                    JzCard {
                        Text("周期概览", style = MaterialTheme.typography.titleMedium)
                        Spacer(Modifier.height(12.dp))
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(16.dp),
                        ) {
                            BudgetMetric(
                                label = "总预算",
                                value = formatYuan(totalBudget),
                                modifier = Modifier.weight(1f),
                            )
                            BudgetMetric(
                                label = "已用",
                                value = formatYuan(totalSpent),
                                modifier = Modifier.weight(1f),
                            )
                        }
                    }
                }

                item {
                    val carryover = data.optLong("carryoverPoolCents")
                    JzCard {
                        Text("结余池", style = MaterialTheme.typography.titleMedium)
                        Spacer(Modifier.height(4.dp))
                        Text(
                            formatYuan(carryover),
                            style = MaterialTheme.typography.headlineSmall,
                            color = if (carryover < 0) tokens.danger else MaterialTheme.colorScheme.onSurface,
                        )
                        Text(
                            if (carryover < 0) "负结转金额，按服务端当前周期数据展示。"
                            else "可结转金额按服务端预算汇总展示。",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }

        if (pendingError != null) {
            item {
                JzCard {
                    Text("待确认账单暂时无法读取", style = MaterialTheme.typography.titleSmall)
                    Text(
                        pendingError!!,
                        color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodySmall,
                    )
                    Spacer(Modifier.height(8.dp))
                    OutlinedButton(onClick = { reloadKey += 1 }) { Text("重试提醒") }
                }
            }
        } else if (pendingCount > 0) {
            item {
                JzCard {
                    Text("待处理", style = MaterialTheme.typography.titleSmall)
                    Text(
                        "$pendingCount 笔周期账单待确认",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.primary,
                    )
                    Text(
                        "确认结果会由服务端写入账本。",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }

        if (data != null && hasBudget && modules.isEmpty()) {
            item {
                BudgetStateCard(
                    title = "当前周期没有模块明细",
                    message = "服务端尚未返回可展示的预算模块。",
                )
            }
        } else if (data != null && hasBudget) {
            item {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("分类模块", style = MaterialTheme.typography.titleLarge)
                    Text(
                        "进度条会在额度处封顶；金额与剩余值保留服务端原数。",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            items(modules, key = { it.optString("categoryId") }) { module ->
                val id = module.optString("categoryId")
                BudgetModuleCard(
                    module = module,
                    expanded = expandedModuleId == id,
                    onToggle = {
                        expandedModuleId = if (expandedModuleId == id) null else id
                    },
                )
            }
        }
        item(key = "advanced-pool-trend") { AdvancedPoolTrend(api, onAuthExpired) }
    }
}

/** C3 keeps the legacy series available only in the advanced envelope tool. */
@Composable
private fun AdvancedPoolTrend(api: ApiClient, onAuthExpired: () -> Unit) {
    var expanded by remember(api) { mutableStateOf(false) }
    var showChart by remember(api) { mutableStateOf(true) }
    var points by remember(api) { mutableStateOf<List<JSONObject>?>(null) }
    var error by remember(api) { mutableStateOf<String?>(null) }
    var loading by remember(api) { mutableStateOf(false) }
    var retry by remember(api) { mutableIntStateOf(0) }
    LaunchedEffect(api, expanded, retry) {
        if (!expanded) return@LaunchedEffect
        loading = true
        error = null
        try {
            val response = com.yansuu1.jizhang.repo.StatsRepository(api).poolTrend()
            val array = response.getJSONArray("points")
            points = List(array.length()) { array.getJSONObject(it) }
        } catch (e: CancellationException) { throw e
        } catch (e: AuthExpiredException) { onAuthExpired()
        } catch (e: Exception) { error = e.message ?: "结余池趋势加载失败"
        } finally { loading = false }
    }
    JzCard {
        OutlinedButton(onClick = { expanded = !expanded }, modifier = Modifier.fillMaxWidth()) {
            Text(if (expanded) "收起高级预算 · 结余池趋势" else "高级预算 · 查看结余池趋势")
        }
        if (expanded) {
            Text("旧信封周期的结转参考，不是当前月消费预算，也不代表实际存钱。", style = MaterialTheme.typography.bodySmall)
            if (loading) LinearProgressIndicator(Modifier.fillMaxWidth())
            error?.let { Text(it, color = MaterialTheme.colorScheme.error); OutlinedButton(onClick = { retry++ }) { Text("重试") } }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(selected = showChart, onClick = { showChart = true }, label = { Text("图表") })
                FilterChip(selected = !showChart, onClick = { showChart = false }, label = { Text("逐期明细") })
            }
            points?.let { PoolSparkline(it, showChart) }
        }
    }
}

@Composable
private fun BudgetMetric(label: String, value: String, modifier: Modifier = Modifier) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(label, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, style = MaterialTheme.typography.titleLarge)
    }
}

@Composable
private fun BudgetModuleCard(
    module: JSONObject,
    expanded: Boolean,
    onToggle: () -> Unit,
) {
    val tokens = LocalWebTokens.current
    val motion = LocalMotionTokens.current
    val budget = module.optLong("budgetCents")
    val spent = module.optLong("spentCents")
    val remaining = module.optLong("remainingCents")
    val progress by animateFloatAsState(
        targetValue = barRatio(spent, budget),
        animationSpec = tween(durationMillis = motion.baseMillis),
        label = "budget-progress",
    )
    val status = when {
        budget <= 0 && spent > 0 -> "零预算 · 已超支"
        budget <= 0 -> "零预算"
        spent > budget -> "已超支"
        spent >= budget * 0.8 -> "提醒 · 将超支"
        else -> "正常"
    }
    val statusColor = when {
        status.contains("已超支") -> tokens.danger
        status.contains("将超支") -> tokens.warning
        else -> MaterialTheme.colorScheme.onSurfaceVariant
    }
    val children = remember(module) { module.optJSONArray("children").toJsonObjects() }
    val hasChildren = children.isNotEmpty()

    FinanceCard(
        modifier = Modifier.fillMaxWidth(),
        cornerRadius = 20.dp,
        contentPadding = 16.dp,
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Row(
                modifier = Modifier.weight(1f),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                FinanceCategoryIcon(
                    iconName = module.optString("categoryIcon", "other"),
                    backgroundColor = parseCategoryColor(module.optLong("categoryColor", 0L)),
                    size = 38.dp,
                    iconSize = 20.dp,
                )
                Text(
                    module.optString("categoryName", "未命名模块"),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                )
            }
            Text(
                status,
                color = statusColor,
                style = MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.Medium,
            )
        }
        Spacer(Modifier.height(14.dp))
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            BudgetMetric("已用", formatYuan(spent), Modifier.weight(1f))
            BudgetMetric("预算", formatYuan(budget), Modifier.weight(1f))
        }
        Spacer(Modifier.height(12.dp))
        LinearProgressIndicator(
            progress = { progress },
            modifier = Modifier.fillMaxWidth().height(6.dp).clip(RoundedCornerShape(3.dp)).semantics {
                contentDescription = "${module.optString("categoryName")}使用进度，${usedPercent(spent, budget)}%"
            },
            color = when {
                status.contains("已超支") -> tokens.danger
                status.contains("将超支") -> tokens.warning
                else -> tokens.accent
            },
            trackColor = tokens.surfaceSoft,
        )
        Spacer(Modifier.height(8.dp))
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("剩余 ${formatYuan(remaining)}", style = MaterialTheme.typography.bodyMedium)
            if (budget > 0 && spent >= 0) {
                Text("已用 ${usedPercent(spent, budget)}%", style = MaterialTheme.typography.bodySmall, color = statusColor)
            }
        }
        if (hasChildren) {
            Spacer(Modifier.height(6.dp))
            OutlinedButton(onClick = onToggle) {
                Text(if (expanded) "收起子分类明细" else "查看子分类明细")
            }
            if (expanded) {
                Spacer(Modifier.height(4.dp))
                Text("子分类支出", style = MaterialTheme.typography.labelLarge)
                children.forEach { child ->
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Text(child.optString("categoryName"), style = MaterialTheme.typography.bodyMedium)
                        Text(formatYuan(child.optLong("spentCents")), style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }
        }
    }
}

@Composable
private fun BudgetStateCard(title: String, message: String) {
    JzCard {
        Text(title, style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.height(4.dp))
        Text(message, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun BudgetErrorCard(message: String, onRetry: () -> Unit) {
    JzCard {
        Text("预算暂时不可用", style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.error)
        Spacer(Modifier.height(4.dp))
        Text(message, style = MaterialTheme.typography.bodyMedium)
        Spacer(Modifier.height(8.dp))
        OutlinedButton(onClick = onRetry) { Text("重试") }
    }
}

private fun JSONArray?.toJsonObjects(): List<JSONObject> = buildList {
    for (index in 0 until (this@toJsonObjects?.length() ?: 0)) {
        this@toJsonObjects?.optJSONObject(index)?.let(::add)
    }
}

/** The progress graphic is capped; the displayed server amount is never capped. */
fun barRatio(spent: Long, budget: Long): Float {
    if (budget <= 0) return if (spent > 0) 1f else 0f
    return (spent.toFloat() / budget.toFloat()).coerceIn(0f, 1f)
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
    return formatDay(periodStart)
}
