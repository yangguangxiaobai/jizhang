package com.yansuu1.jizhang.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.yansuu1.jizhang.net.ApiClient
import com.yansuu1.jizhang.net.AuthExpiredException
import com.yansuu1.jizhang.repo.FinancialGoalRepository
import com.yansuu1.jizhang.repo.FinancialGoalUnsupportedException
import com.yansuu1.jizhang.repo.FinancialGoalView
import com.yansuu1.jizhang.repo.MonthlyPlanCategoryPurpose
import com.yansuu1.jizhang.repo.MonthlyPlanLegacyEnvelope
import com.yansuu1.jizhang.repo.MonthlyPlanPurposeRow
import com.yansuu1.jizhang.repo.MonthlyPlanRepository
import com.yansuu1.jizhang.repo.MonthlyPlanState
import com.yansuu1.jizhang.repo.MonthlyPlanSummaryStatus
import com.yansuu1.jizhang.repo.MonthlyPlanUnsupportedException
import com.yansuu1.jizhang.repo.MonthlyPlanView
import com.yansuu1.jizhang.repo.SpendingPurpose
import com.yansuu1.jizhang.ui.theme.LocalWebTokens
import kotlinx.coroutines.CancellationException

/**
 * Default read-only C2 surface. It renders the server's cents and never recomputes
 * consumption from categories or adds the legacy envelope to the spending budget.
 */
@Composable
fun MonthlyPlanWorkspace(
    api: ApiClient,
    onAuthExpired: () -> Unit,
    onNewSalary: () -> Unit,
    onOpenExecution: () -> Unit,
    onOpenBudget: () -> Unit,
    onOpenScenario: () -> Unit,
    onDataChanged: () -> Unit = {},
    refreshToken: Long = 0L,
    onRegisterGuard: (((onAllowLeave: () -> Unit) -> Unit)?) -> Unit = {},
) {
    val repository = remember(api) { MonthlyPlanRepository(api) }
    val goalRepo = remember(api) { FinancialGoalRepository(api) }
    var view by remember(api) { mutableStateOf<MonthlyPlanView?>(null) }
    var goalView by remember(api) { mutableStateOf<FinancialGoalView?>(null) }
    var loading by remember(api) { mutableStateOf(true) }
    var loadError by remember(api) { mutableStateOf<String?>(null) }
    var goalLoading by remember(api) { mutableStateOf(false) }
    var goalError by remember(api) { mutableStateOf<String?>(null) }
    var unsupported by remember(api) { mutableStateOf(false) }
    var retry by remember(api) { mutableIntStateOf(0) }
    var categoriesExpanded by remember(api) { mutableStateOf(false) }
    var showingManualGoals by remember(api) { mutableStateOf(false) }

    DisposableEffect(showingManualGoals) {
        if (showingManualGoals) {
            onRegisterGuard { onAllowLeave ->
                showingManualGoals = false
                onAllowLeave()
            }
        } else {
            onRegisterGuard(null)
        }
        onDispose { onRegisterGuard(null) }
    }

    val windowContext = view?.window?.let { w ->
        ManualGoalWindowContext(
            from = w.from,
            to = w.to,
            label = w.label,
            timeZone = w.timeZone,
        )
    }

    if (showingManualGoals) {
        ManualGoalProgressWorkspace(
            api = api,
            onAuthExpired = onAuthExpired,
            onBack = {
                showingManualGoals = false
                retry++
            },
            onDataChanged = {
                retry++
                onDataChanged()
            },
            window = windowContext,
        )
        return
    }

    val readOwner = remember(api) { FinancialExecutionWorkOwner() }
    DisposableEffect(readOwner) { onDispose { readOwner.cancel() } }
    LaunchedEffect(repository, retry, refreshToken) {
        val ticket = readOwner.nextTicket()
        loading = true
        loadError = null
        unsupported = false
        try {
            val response = scopedStatsRead({ FinancialPrefs.resolveAuthenticatedScope(api) }) { repository.load() }
            if (readOwner.isCurrent(ticket)) view = response
        } catch (error: CancellationException) {
            throw error
        } catch (error: AuthExpiredException) {
            if (readOwner.isCurrent(ticket)) onAuthExpired()
        } catch (error: MonthlyPlanUnsupportedException) {
            // Never reuse a previously loaded plan after the server capability changes.
            if (readOwner.isCurrent(ticket)) { view = null; unsupported = true }
        } catch (error: Exception) {
            // A transient failure may keep the same owner's last good read, but is labeled stale.
            if (readOwner.isCurrent(ticket)) loadError = error.message ?: "月计划读取失败，请重试。"
        } finally {
            if (readOwner.isCurrent(ticket)) loading = false
        }
    }

    LaunchedEffect(view?.window?.from, view?.window?.to, retry, refreshToken) {
        val currentWindow = windowContext
        if (currentWindow == null) {
            goalView = null
            goalLoading = false
            goalError = null
            return@LaunchedEffect
        }
        val ticket = readOwner.nextTicket()
        goalLoading = true
        goalError = null
        try {
            val response = scopedStatsRead({ FinancialPrefs.resolveAuthenticatedScope(api) }) {
                goalRepo.load(from = currentWindow.from, to = currentWindow.to)
            }
            if (readOwner.isCurrent(ticket)) {
                requireManualGoalWindow(response, currentWindow)
                goalView = response
            }
        } catch (error: CancellationException) {
            throw error
        } catch (error: AuthExpiredException) {
            if (readOwner.isCurrent(ticket)) onAuthExpired()
        } catch (error: FinancialGoalUnsupportedException) {
            if (readOwner.isCurrent(ticket)) {
                goalView = null
                goalError = "服务端未支持手动目标接口 (404)"
            }
        } catch (error: Exception) {
            if (readOwner.isCurrent(ticket)) {
                goalError = error.message ?: "读取实际存投失败"
            }
        } finally {
            if (readOwner.isCurrent(ticket)) goalLoading = false
        }
    }

    val tokens = LocalWebTokens.current
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text("本月计划", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                view?.window?.label?.let {
                    Text(it, style = MaterialTheme.typography.bodySmall, color = tokens.muted)
                }
            }
            OutlinedButton(
                onClick = { retry++ },
                enabled = !loading,
                modifier = Modifier.heightIn(min = 48.dp),
            ) {
                Text(if (loading) "读取中…" else "刷新")
            }
        }

        if (unsupported) {
            StatusCard(
                title = "当前服务不支持月计划",
                message = "请升级服务端，或暂时使用旧版分类预算与理财明细。没有把不支持误显示为 0 元。",
            )
            DetailTools(onOpenExecution, onOpenBudget, onOpenScenario, onOpenManualGoals = { showingManualGoals = true })
            return@Column
        }

        if (loading && view == null) {
            FinanceCard(modifier = Modifier.fillMaxWidth()) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    CircularProgressIndicator()
                    Text("正在读取服务端本月计划…", color = tokens.muted)
                }
            }
            return@Column
        }

        if (view == null) {
            StatusCard(
                title = "月计划暂时不可用",
                message = loadError ?: "尚未读取到月计划。",
            )
            OutlinedButton(onClick = { retry++ }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                Text("重试")
            }
            DetailTools(onOpenExecution, onOpenBudget, onOpenScenario, onOpenManualGoals = { showingManualGoals = true })
            return@Column
        }

        if (loading || loadError != null) {
            val message = if (loading) "正在刷新；当前保留上次成功结果。" else "刷新失败，当前显示上次成功结果：${loadError.orEmpty()}"
            StatusCard("计划数据可能过期", message)
        }

        when (val current = view) {
            null -> Unit
            else -> when (current.state) {
                MonthlyPlanState.NO_PERIOD -> {
                    StatusCard(
                        title = "本月还没有已确认计划",
                        message = "这里不会借用旧月份或预测金额。可从已有工资开启计划，或先记录工资。",
                    )
                    OutlinedButton(onClick = onOpenExecution, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                        Text("从已有工资开启计划")
                    }
                    OutlinedButton(onClick = onNewSalary, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                        Text("记录工资")
                    }
                    DetailTools(onOpenExecution, onOpenBudget, onOpenScenario, onOpenManualGoals = { showingManualGoals = true })
                }
                MonthlyPlanState.DISABLED -> {
                    StatusCard(
                        title = "四用途计划未启用",
                        message = "当前服务没有发布消费预算或实际消费金额；可在计划明细中查看并调整设置。",
                    )
                    OutlinedButton(onClick = onOpenExecution, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                        Text("打开计划设置")
                    }
                    DetailTools(onOpenExecution, onOpenBudget, onOpenScenario, onOpenManualGoals = { showingManualGoals = true })
                }
                MonthlyPlanState.READY -> ReadyPlan(
                    view = current,
                    goalView = goalView,
                    goalLoading = goalLoading,
                    goalError = goalError,
                    categoriesExpanded = categoriesExpanded,
                    onToggleCategories = { categoriesExpanded = !categoriesExpanded },
                    onNewSalary = onNewSalary,
                    onOpenExecution = onOpenExecution,
                    onOpenBudget = onOpenBudget,
                    onOpenScenario = onOpenScenario,
                    onOpenManualGoals = { showingManualGoals = true },
                )
            }
        }
    }
}

@Composable
private fun ReadyPlan(
    view: MonthlyPlanView,
    goalView: FinancialGoalView?,
    goalLoading: Boolean,
    goalError: String?,
    categoriesExpanded: Boolean,
    onToggleCategories: () -> Unit,
    onNewSalary: () -> Unit,
    onOpenExecution: () -> Unit,
    onOpenBudget: () -> Unit,
    onOpenScenario: () -> Unit,
    onOpenManualGoals: () -> Unit,
) {
    val tokens = LocalWebTokens.current
    val summary = requireNotNull(view.summary)
    val targets = requireNotNull(view.targets)

    if (summary.status == MonthlyPlanSummaryStatus.REVIEW_REQUIRED || !view.unresolved.isEmpty) {
        StatusCard(
            title = "部分账目待核对",
            message = buildString {
                append("已确认消费仍可查看，但数据不完整，暂不显示精确预算剩余。")
                if (view.unresolved.reasons.isNotEmpty()) {
                    append("\n")
                    append(view.unresolved.reasons.joinToString("、") { monthlyPlanReasonLabel(it) })
                }
            },
            error = true,
        )
    }

    FinanceCard(modifier = Modifier.fillMaxWidth(), contentPadding = 16.dp) {
        Text("消费预算", style = MaterialTheme.typography.labelLarge, color = tokens.muted)
        Text(
            planMoney(summary.consumptionBudgetCents),
            style = MaterialTheme.typography.headlineMedium,
            fontWeight = FontWeight.Bold,
            color = tokens.fg,
        )
        Spacer(Modifier.height(8.dp))
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            MoneyMetric(
                label = "已确认消费",
                amount = planMoney(summary.confirmedNetSpentCents),
                modifier = Modifier.weight(1f),
            )
            MoneyMetric(
                label = "预算剩余",
                amount = summary.remainingCents?.let(::planMoney) ?: "待核对",
                modifier = Modifier.weight(1f),
                highlight = summary.remainingCents != null && summary.remainingCents < 0,
            )
        }
        view.confirmedIncomeCents?.let { income ->
            Text("本期确认收入 ${planMoney(income)}", style = MaterialTheme.typography.bodySmall, color = tokens.muted)
        }
    }

    FinanceCard(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("本月分配参考", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Text(
                "实际存钱与投资进度 →",
                style = MaterialTheme.typography.bodySmall,
                color = tokens.accent,
                modifier = Modifier.clickable(onClick = onOpenManualGoals),
            )
        }
        Text("应急与成长是计划预留，不代表已存款或已投资。", style = MaterialTheme.typography.bodySmall, color = tokens.muted)
        Spacer(Modifier.height(8.dp))
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            MoneyMetric("应急预留", planMoney(targets.reserve), Modifier.weight(1f))
            MoneyMetric("成长预留", planMoney(targets.growth), Modifier.weight(1f))
        }

        Spacer(Modifier.height(8.dp))
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            val reserveNetStr = when {
                goalLoading -> "读取中…"
                goalError != null -> "暂不可用"
                goalView == null -> "—"
                goalView.window != null -> {
                    val net = goalView.window!!.reserve.netAdditionsCents
                    "${if (net >= 0L) "+" else ""}¥${formatYuan(net)}"
                }
                else -> "—"
            }
            val investmentNetStr = when {
                goalLoading -> "读取中…"
                goalError != null -> "暂不可用"
                goalView == null -> "—"
                goalView.window != null -> {
                    val net = goalView.window!!.investment.netAdditionsCents
                    "${if (net >= 0L) "+" else ""}¥${formatYuan(net)}"
                }
                else -> "—"
            }
            MoneyMetric("本期手动净存入", reserveNetStr, Modifier.weight(1f))
            MoneyMetric("本期本金净投入", investmentNetStr, Modifier.weight(1f))
        }
        if (goalView != null && goalView.state == "not-configured") {
            Text("尚未确认手动目标起始值，点击右上角进入确认起始基准。", style = MaterialTheme.typography.bodySmall, color = tokens.muted)
        }
    }

    FinanceCard(modifier = Modifier.fillMaxWidth()) {
        Text("消费用途", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        view.purposes.forEach { purpose -> PurposeRow(purpose) }
    }

    FinanceCard(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = 48.dp)
                .clickable(onClick = onToggleCategories),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("分类明细（${view.categories.size}）", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Text(if (categoriesExpanded) "收起 ↑" else "展开 ↓", color = tokens.accent)
        }
        if (categoriesExpanded) {
            if (view.categories.isEmpty()) {
                Text("当前区间没有分类消费。", style = MaterialTheme.typography.bodySmall, color = tokens.muted)
            } else {
                view.categories.forEach { row ->
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            val categoryLabel = row.categoryName ?: when {
                                row.categoryId != null -> "分类名称暂不可用"
                                row.purpose == MonthlyPlanCategoryPurpose.UNRESOLVED -> "待归类账单"
                                else -> "无分类的用途覆盖账单"
                            }
                            Text(categoryLabel, fontWeight = FontWeight.Medium)
                            Text(
                                "${categoryPurposeLabel(row.purpose)} · 毛额 ${planMoney(row.grossCents)} · 退款 ${planMoney(row.refundCents)}",
                                style = MaterialTheme.typography.bodySmall,
                                color = tokens.muted,
                            )
                        }
                        Text(planMoney(row.netCents), fontWeight = FontWeight.SemiBold)
                    }
                }
            }
        }
    }

    view.legacyEnvelope?.let { LegacyEnvelopeCard(it) }

    OutlinedButton(onClick = onNewSalary, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
        Text("记录工资")
    }
    DetailTools(onOpenExecution, onOpenBudget, onOpenScenario, onOpenManualGoals)
}

@Composable
private fun PurposeRow(purpose: MonthlyPlanPurposeRow) {
    val label = when (purpose.purpose) {
        SpendingPurpose.ESSENTIALS -> "必要"
        SpendingPurpose.JOY -> "随心"
    }
    Column(modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(label, fontWeight = FontWeight.Medium)
            Text("剩余 ${purpose.remainingCents?.let(::planMoney) ?: "待核对"}", fontWeight = FontWeight.Medium)
        }
        Text(
            "预算 ${planMoney(purpose.budgetCents)} · 毛支出 ${planMoney(purpose.grossCents)} · 退款 ${planMoney(purpose.refundCents)} · 净消费 ${planMoney(purpose.netCents)}",
            style = MaterialTheme.typography.bodySmall,
            color = LocalWebTokens.current.muted,
        )
    }
}

@Composable
private fun LegacyEnvelopeCard(reference: MonthlyPlanLegacyEnvelope) {
    FinanceCard(modifier = Modifier.fillMaxWidth()) {
        Text("旧分类信封预算参考", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
        Text("此金额仅用于对照，不计入本月消费预算。", style = MaterialTheme.typography.bodySmall, color = LocalWebTokens.current.muted)
        Text("旧信封总额 ${planMoney(reference.totalBudgetCents)} · 用途消费上限 ${planMoney(reference.purposeSpendingCeilingCents)}")
        Text("差额 ${planMoney(reference.differenceCents)} · ${if (reference.windowMatches) "区间相同" else "区间不同"}", style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
private fun DetailTools(
    onOpenExecution: () -> Unit,
    onOpenBudget: () -> Unit,
    onOpenScenario: () -> Unit,
    onOpenManualGoals: () -> Unit,
) {
    FinanceCard(modifier = Modifier.fillMaxWidth()) {
        Text("明细工具", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        Text("旧入口保留为明细，不会叠加到本月消费预算。", style = MaterialTheme.typography.bodySmall, color = LocalWebTokens.current.muted)
        OutlinedButton(onClick = onOpenManualGoals, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
            Text("手动存钱与投资进度")
        }
        OutlinedButton(onClick = onOpenExecution, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
            Text("四用途执行与历史/退款复核")
        }
        OutlinedButton(onClick = onOpenBudget, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
            Text("分类信封预算与结余池")
        }
        OutlinedButton(onClick = onOpenScenario, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
            Text("测算预估")
        }
    }
}

@Composable
private fun MoneyMetric(
    label: String,
    amount: String,
    modifier: Modifier = Modifier,
    highlight: Boolean = false,
) {
    Column(modifier = modifier.padding(vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(label, style = MaterialTheme.typography.bodySmall, color = LocalWebTokens.current.muted)
        Text(
            amount,
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.SemiBold,
            color = if (highlight) MaterialTheme.colorScheme.error else LocalWebTokens.current.fg,
        )
    }
}

@Composable
private fun StatusCard(title: String, message: String, error: Boolean = false) {
    val colors = MaterialTheme.colorScheme
    FinanceCard(
        modifier = Modifier.fillMaxWidth(),
        backgroundColor = if (error) colors.errorContainer else colors.surfaceVariant,
    ) {
        Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        Text(message, style = MaterialTheme.typography.bodyMedium, color = if (error) colors.onErrorContainer else LocalWebTokens.current.muted)
    }
}

private fun monthlyPlanReasonLabel(reason: String): String = when (reason) {
    "not-mapped" -> "存在未配置用途的支出，请设置分类规则或单笔用途。"
    "explicit-unresolved" -> "有分类被明确设为待归类，请检查用途映射。"
    "category-not-in-snapshot" -> "分类资料与已确认计划不一致，请重新核对分类。"
    "invalid-topology" -> "分类层级存在异常，请检查分类与账户设置。"
    "salary-source-changed" -> "工资来源已变化，请重新核对本期计划。"
    "no-confirmed-salary-source" -> "本期没有已确认的工资来源。"
    "global-unassigned-refund" -> "存在尚未归属本期的退款，请复核退款。"
    "refund-unallocated" -> "存在尚未完成分摊的退款金额，请复核退款分摊。"
    "split-invalidated" -> "原退款分摊已失效，请重新核对并确认分摊。"
    "legacy-link-unconfirmed" -> "旧退款关联尚未确认用途分摊，请打开退款核对。"
    "over-refund" -> "归属退款超过原支出可扣减金额，请检查退款分摊。"
    "refund-purged", "refund-deleted" -> "退款账单已删除或清除，请复核原分摊。"
    "refund-not-refund" -> "原退款账单已不再标为退款，请复核分摊。"
    "refund-changed" -> "退款金额或类型已变化，请重新确认分摊。"
    "original-purged", "original-deleted" -> "关联的原支出已删除或清除，请复核退款归属。"
    "original-not-expense" -> "关联原单已不再是支出，请检查退款归属。"
    "original-changed" -> "关联原支出的金额或类型已变化，请重新确认分摊。"
    else -> "存在待核对的财务事实，请打开四用途明细查看。"
}

private fun categoryPurposeLabel(purpose: MonthlyPlanCategoryPurpose): String = when (purpose) {
    MonthlyPlanCategoryPurpose.ESSENTIALS -> "必要"
    MonthlyPlanCategoryPurpose.JOY -> "随心"
    MonthlyPlanCategoryPurpose.UNRESOLVED -> "待归类"
}

private fun planMoney(cents: Long): String = "¥${formatYuan(cents)}"
