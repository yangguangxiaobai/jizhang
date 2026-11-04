package com.yansuu1.jizhang.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.yansuu1.jizhang.net.ApiClient
import com.yansuu1.jizhang.net.AuthExpiredException
import com.yansuu1.jizhang.repo.FinancialCycleKind
import com.yansuu1.jizhang.repo.FinancialExecutionRepository
import com.yansuu1.jizhang.repo.FinancialPeriod
import com.yansuu1.jizhang.repo.FinancialPeriodSourceState
import com.yansuu1.jizhang.ui.theme.LocalWebTokens
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

private const val PAGE_SIZE = 10

/**
 * 历史方案查看弹窗（只读）
 *
 * 接入既有的 FinancialExecutionRepository:
 * - getPeriods(limit, offset): 分页获取历史确认周期列表
 * - getPeriodRevisions(periodId, limit, offset): 查看周期的不可变修订版本列表
 * - 支持下钻查看某版本的冻结分配、来源快照、规则参数与警告
 * - 明确说明已确认历史周期 vs 遗留测算预估单份保存的区别
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FinancialExecutionHistorySheet(
    api: ApiClient,
    onAuthExpired: () -> Unit,
    onClose: () -> Unit,
) {
    val repo = remember(api) { FinancialExecutionRepository(api) }
    val scope = rememberCoroutineScope()
    val tokens = LocalWebTokens.current
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    var mode by remember { mutableStateOf(HistoryViewMode.PERIODS_LIST) }
    var previousMode by remember { mutableStateOf(HistoryViewMode.PERIODS_LIST) }
    var selectedPeriod by remember { mutableStateOf<FinancialPeriod?>(null) }
    var selectedRevision by remember { mutableStateOf<FinancialPeriod?>(null) }

    val periodsTracker = remember { HistoryWorkTracker() }
    val revisionsTracker = remember { HistoryWorkTracker() }

    var periodsState by remember {
        mutableStateOf(HistoryPeriodsState(pagination = HistoryPaginationState(limit = PAGE_SIZE, offset = 0, total = 0L)))
    }
    var revisionsState by remember {
        mutableStateOf(HistoryRevisionsState(pagination = HistoryPaginationState(limit = PAGE_SIZE, offset = 0, total = 0L)))
    }

    DisposableEffect(periodsTracker, revisionsTracker) {
        onDispose {
            periodsTracker.cancel()
            revisionsTracker.cancel()
        }
    }

    fun handleClose() {
        periodsTracker.cancel()
        revisionsTracker.cancel()
        onClose()
    }

    fun handleBack() {
        if (mode == HistoryViewMode.REVISIONS_LIST) {
            revisionsTracker.cancel()
            revisionsState = revisionsState.copy(loading = false)
            mode = HistoryViewMode.PERIODS_LIST
        } else if (mode == HistoryViewMode.PERIOD_DETAIL) {
            mode = previousMode
        } else {
            mode = HistoryViewMode.PERIODS_LIST
        }
    }

    fun loadPeriods(offset: Int) {
        val currentTicket = periodsTracker.nextTicket()
        periodsState = periodsState.onStartLoading(offset)
        scope.launch {
            try {
                val resp = repo.getPeriods(limit = PAGE_SIZE, offset = offset)
                val (next, accepted) = periodsState.onApplySuccess(
                    requestTicket = currentTicket,
                    activeTicket = periodsTracker.current(),
                    newItems = resp.items,
                    newCurrentPeriodId = resp.currentPeriodId,
                    newPagination = HistoryPaginationState(limit = resp.limit, offset = resp.offset, total = resp.total),
                )
                if (accepted) periodsState = next
            } catch (e: CancellationException) {
                throw e
            } catch (e: AuthExpiredException) {
                if (periodsTracker.isCurrent(currentTicket)) {
                    periodsState = periodsState.copy(loading = false)
                    onAuthExpired()
                }
            } catch (e: Exception) {
                val (next, accepted) = periodsState.onApplyError(
                    requestTicket = currentTicket,
                    activeTicket = periodsTracker.current(),
                    errorMessage = e.message ?: "加载历史周期方案失败",
                )
                if (accepted) periodsState = next
            }
        }
    }

    fun loadRevisions(periodId: String, offset: Int) {
        val currentTicket = revisionsTracker.nextTicket()
        revisionsState = revisionsState.onStartLoading(periodId, offset)
        scope.launch {
            try {
                val resp = repo.getPeriodRevisions(periodId = periodId, limit = PAGE_SIZE, offset = offset)
                val (next, accepted) = revisionsState.onApplySuccess(
                    requestTicket = currentTicket,
                    activeTicket = revisionsTracker.current(),
                    newItems = resp.items,
                    newPagination = HistoryPaginationState(limit = resp.limit, offset = resp.offset, total = resp.total),
                )
                if (accepted) revisionsState = next
            } catch (e: CancellationException) {
                throw e
            } catch (e: AuthExpiredException) {
                if (revisionsTracker.isCurrent(currentTicket)) {
                    revisionsState = revisionsState.copy(loading = false)
                    onAuthExpired()
                }
            } catch (e: Exception) {
                val (next, accepted) = revisionsState.onApplyError(
                    requestTicket = currentTicket,
                    activeTicket = revisionsTracker.current(),
                    errorMessage = e.message ?: "加载版本记录失败",
                )
                if (accepted) revisionsState = next
            }
        }
    }

    LaunchedEffect(api) {
        periodsTracker.cancel()
        revisionsTracker.cancel()
        periodsState = HistoryPeriodsState(pagination = HistoryPaginationState(limit = PAGE_SIZE, offset = 0, total = 0L))
        revisionsState = HistoryRevisionsState(pagination = HistoryPaginationState(limit = PAGE_SIZE, offset = 0, total = 0L))
        loadPeriods(0)
    }

    ModalBottomSheet(
        onDismissRequest = ::handleClose,
        sheetState = sheetState,
        dragHandle = null,
        shape = RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp),
        containerColor = MaterialTheme.colorScheme.surface,
        modifier = Modifier.fillMaxHeight(0.92f),
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 16.dp, vertical = 12.dp),
        ) {
            // 顶栏（触控区域规范 >=48dp）
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 48.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.weight(1f),
                ) {
                    if (mode != HistoryViewMode.PERIODS_LIST) {
                        IconButton(
                            onClick = ::handleBack,
                            modifier = Modifier
                                .size(48.dp)
                                .defaultMinSize(minWidth = 48.dp, minHeight = 48.dp),
                        ) {
                            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回上一级", tint = tokens.fg)
                        }
                    }
                    Text(
                        text = when (mode) {
                            HistoryViewMode.PERIODS_LIST -> "历史执行方案"
                            HistoryViewMode.REVISIONS_LIST -> "${selectedPeriod?.window?.groupMonth ?: ""} 版本记录"
                            HistoryViewMode.PERIOD_DETAIL -> "${selectedRevision?.window?.groupMonth ?: ""} (r${selectedRevision?.revision ?: 0}) 冻结详情"
                        },
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                        color = tokens.fg,
                    )
                }

                IconButton(
                    onClick = ::handleClose,
                    modifier = Modifier
                        .size(48.dp)
                        .defaultMinSize(minWidth = 48.dp, minHeight = 48.dp),
                ) {
                    Icon(Icons.Filled.Close, contentDescription = "关闭", tint = tokens.fg)
                }
            }

            HorizontalDivider(color = tokens.muted.copy(alpha = 0.2f), modifier = Modifier.padding(vertical = 4.dp))

            when (mode) {
                HistoryViewMode.PERIODS_LIST -> {
                    Surface(
                        color = tokens.accent.copy(alpha = 0.08f),
                        shape = RoundedCornerShape(8.dp),
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 6.dp),
                    ) {
                        Row(
                            modifier = Modifier.padding(10.dp),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalAlignment = Alignment.Top,
                        ) {
                            Icon(Icons.Filled.Info, contentDescription = null, tint = tokens.accent, modifier = Modifier.size(18.dp))
                            Text(
                                text = FinancialHistoryLabels.LEGACY_SCENARIO_NOTE,
                                fontSize = 11.5.sp,
                                color = tokens.fg,
                                lineHeight = 16.sp,
                            )
                        }
                    }

                    if (periodsState.loading && periodsState.items.isEmpty()) {
                        HistoryLoadingBox()
                    } else if (periodsState.error != null && periodsState.items.isEmpty()) {
                        HistoryErrorBox(periodsState.error!!) { loadPeriods(periodsState.requestedOffset) }
                    } else if (periodsState.items.isEmpty()) {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(240.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            Column(
                                horizontalAlignment = Alignment.CenterHorizontally,
                                verticalArrangement = Arrangement.spacedBy(8.dp),
                                modifier = Modifier.padding(horizontal = 16.dp),
                            ) {
                                Icon(Icons.Filled.Info, contentDescription = null, tint = tokens.muted, modifier = Modifier.size(40.dp))
                                Text("暂无已确认的历史方案", fontWeight = FontWeight.Bold, color = tokens.fg)
                                Text(
                                    text = "在发薪日记录工资并确认方案后，执行快照将保留在此处。\n若您此前在「测算预估」保存过方案，可在上方的「测算预估」标签页中查看当前保存的试算参数。",
                                    fontSize = 12.sp,
                                    color = tokens.muted,
                                    textAlign = TextAlign.Center,
                                )
                                OutlinedButton(onClick = { loadPeriods(0) }, modifier = Modifier.heightIn(min = 48.dp)) {
                                    Text("刷新")
                                }
                            }
                        }
                    } else {
                        LazyColumn(
                            modifier = Modifier
                                .weight(1f)
                                .fillMaxWidth(),
                            verticalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            if (periodsState.error != null) {
                                item {
                                    Surface(
                                        color = tokens.danger.copy(alpha = 0.1f),
                                        shape = RoundedCornerShape(8.dp),
                                        modifier = Modifier.fillMaxWidth(),
                                    ) {
                                        Row(
                                            modifier = Modifier.padding(10.dp),
                                            horizontalArrangement = Arrangement.SpaceBetween,
                                            verticalAlignment = Alignment.CenterVertically,
                                        ) {
                                            Text(periodsState.error!!, color = tokens.danger, fontSize = 12.sp, modifier = Modifier.weight(1f))
                                            OutlinedButton(onClick = { loadPeriods(periodsState.requestedOffset) }, modifier = Modifier.heightIn(min = 48.dp)) {
                                                Text("重试", fontSize = 11.sp)
                                            }
                                        }
                                    }
                                }
                            }

                            items(periodsState.items, key = { it.id }) { period ->
                                FinanceCard(modifier = Modifier.fillMaxWidth()) {
                                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                        Row(
                                            modifier = Modifier.fillMaxWidth(),
                                            horizontalArrangement = Arrangement.SpaceBetween,
                                            verticalAlignment = Alignment.CenterVertically,
                                        ) {
                                            Row(
                                                verticalAlignment = Alignment.CenterVertically,
                                                horizontalArrangement = Arrangement.spacedBy(6.dp),
                                            ) {
                                                Text(period.window.groupMonth, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = tokens.fg)
                                                if (period.id == periodsState.currentPeriodId) {
                                                    Surface(color = tokens.accent.copy(alpha = 0.15f), shape = RoundedCornerShape(4.dp)) {
                                                        Text("当前周期", color = tokens.accent, fontSize = 10.5.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp))
                                                    }
                                                }
                                                Surface(color = Color(0xFFF0EFEA), shape = RoundedCornerShape(4.dp)) {
                                                    Text("r${period.revision}", color = tokens.fg, fontSize = 10.5.sp, modifier = Modifier.padding(horizontal = 5.dp, vertical = 2.dp))
                                                }
                                            }
                                            Text("¥${formatYuan(period.confirmedIncomeCents)}", fontWeight = FontWeight.Bold, fontFamily = FontFamily.Monospace, color = tokens.fg)
                                        }

                                        Text(
                                            text = "窗口：${FinancialHistoryLabels.formatWindowRange(period.window)} · 确认于 ${FinancialHistoryLabels.formatDateTimeInZone(period.confirmedAt, period.window.timeZone)}",
                                            fontSize = 11.sp,
                                            color = tokens.muted,
                                        )
                                        Text(
                                            text = "来源状态：${FinancialHistoryLabels.sourceStateDescription(period.sourceState)}（当前核对）",
                                            fontSize = 11.sp,
                                            color = if (period.sourceState == FinancialPeriodSourceState.VALID) tokens.muted else tokens.warning,
                                        )

                                        Row(
                                            modifier = Modifier.fillMaxWidth(),
                                            horizontalArrangement = Arrangement.End,
                                            verticalAlignment = Alignment.CenterVertically,
                                        ) {
                                            OutlinedButton(
                                                onClick = {
                                                    selectedPeriod = period
                                                    mode = HistoryViewMode.REVISIONS_LIST
                                                    loadRevisions(period.id, 0)
                                                },
                                                modifier = Modifier.heightIn(min = 48.dp),
                                            ) {
                                                Text("版本历史", fontSize = 12.sp)
                                            }
                                            Spacer(Modifier.width(8.dp))
                                            Button(
                                                onClick = {
                                                    selectedRevision = period
                                                    previousMode = HistoryViewMode.PERIODS_LIST
                                                    mode = HistoryViewMode.PERIOD_DETAIL
                                                },
                                                modifier = Modifier.heightIn(min = 48.dp),
                                            ) {
                                                Text("冻结详情", fontSize = 12.sp)
                                            }
                                        }
                                    }
                                }
                            }

                            item {
                                HistoryPaginationBar(
                                    pagination = periodsState.pagination,
                                    loading = periodsState.loading,
                                    onPrev = { loadPeriods(periodsState.pagination.prevPage().offset) },
                                    onNext = { loadPeriods(periodsState.pagination.nextPage().offset) },
                                )
                            }
                        }
                    }
                }

                HistoryViewMode.REVISIONS_LIST -> {
                    Text("该周期的历史修订版本（每次确认追加写入，不可变历史）", fontSize = 11.5.sp, color = tokens.muted, modifier = Modifier.padding(vertical = 4.dp))

                    if (revisionsState.loading && revisionsState.items.isEmpty()) {
                        HistoryLoadingBox()
                    } else if (revisionsState.error != null && revisionsState.items.isEmpty()) {
                        HistoryErrorBox(revisionsState.error!!) {
                            selectedPeriod?.id?.let { loadRevisions(it, revisionsState.requestedOffset) }
                        }
                    } else if (revisionsState.items.isEmpty()) {
                        Box(modifier = Modifier.fillMaxWidth().height(200.dp), contentAlignment = Alignment.Center) {
                            Text("暂无版本记录。", color = tokens.muted)
                        }
                    } else {
                        LazyColumn(
                            modifier = Modifier
                                .weight(1f)
                                .fillMaxWidth(),
                            verticalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            if (revisionsState.error != null) {
                                item {
                                    Surface(
                                        color = tokens.danger.copy(alpha = 0.1f),
                                        shape = RoundedCornerShape(8.dp),
                                        modifier = Modifier.fillMaxWidth(),
                                    ) {
                                        Row(
                                            modifier = Modifier.padding(10.dp),
                                            horizontalArrangement = Arrangement.SpaceBetween,
                                            verticalAlignment = Alignment.CenterVertically,
                                        ) {
                                            Column(modifier = Modifier.weight(1f)) {
                                                Text("刷新失败: ${revisionsState.error!!}", color = tokens.danger, fontSize = 12.sp)
                                                Text("当前展示之前加载的版本列表", color = tokens.muted, fontSize = 11.sp)
                                            }
                                            OutlinedButton(
                                                onClick = {
                                                    selectedPeriod?.id?.let { loadRevisions(it, revisionsState.requestedOffset) }
                                                },
                                                modifier = Modifier.heightIn(min = 48.dp),
                                            ) {
                                                Text("重试", fontSize = 11.sp)
                                            }
                                        }
                                    }
                                }
                            }

                            items(revisionsState.items, key = { it.revision }) { rev ->
                                FinanceCard(modifier = Modifier.fillMaxWidth()) {
                                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                        Row(
                                            modifier = Modifier.fillMaxWidth(),
                                            horizontalArrangement = Arrangement.SpaceBetween,
                                            verticalAlignment = Alignment.CenterVertically,
                                        ) {
                                            Text("版本 r${rev.revision}", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, color = tokens.fg)
                                            Text("¥${formatYuan(rev.confirmedIncomeCents)}", fontWeight = FontWeight.Bold, fontFamily = FontFamily.Monospace, color = tokens.fg)
                                        }

                                        Text("确认时间：${FinancialHistoryLabels.formatDateTimeInZone(rev.confirmedAt, rev.window.timeZone)}", fontSize = 11.sp, color = tokens.muted)
                                        Text("发薪来源：${rev.sources.size} 笔 · 状态：${FinancialHistoryLabels.sourceStateDescription(rev.sourceState)}（当前核对）", fontSize = 11.sp, color = tokens.muted)

                                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                                            Button(
                                                onClick = {
                                                    selectedRevision = rev
                                                    previousMode = HistoryViewMode.REVISIONS_LIST
                                                    mode = HistoryViewMode.PERIOD_DETAIL
                                                },
                                                modifier = Modifier.heightIn(min = 48.dp),
                                            ) {
                                                Text("查看此版本冻结详情", fontSize = 12.sp)
                                            }
                                        }
                                    }
                                }
                            }

                            item {
                                HistoryPaginationBar(
                                    pagination = revisionsState.pagination,
                                    loading = revisionsState.loading,
                                    onPrev = { selectedPeriod?.id?.let { loadRevisions(it, revisionsState.pagination.prevPage().offset) } },
                                    onNext = { selectedPeriod?.id?.let { loadRevisions(it, revisionsState.pagination.nextPage().offset) } },
                                )
                            }
                        }
                    }
                }

                HistoryViewMode.PERIOD_DETAIL -> {
                    val p = selectedRevision
                    if (p == null) {
                        Text("未选择方案版本", color = tokens.danger)
                    } else {
                        LazyColumn(
                            modifier = Modifier
                                .weight(1f)
                                .fillMaxWidth(),
                            verticalArrangement = Arrangement.spacedBy(12.dp),
                        ) {
                            item {
                                FinanceCard(modifier = Modifier.fillMaxWidth()) {
                                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                        Text("周期信息与时间窗口", fontWeight = FontWeight.Bold, color = tokens.fg)
                                        Text("周期标识：${p.window.groupMonth} (版本 r${p.revision})", fontSize = 12.sp)
                                        Text("确认时间：${FinancialHistoryLabels.formatDateTimeInZone(p.confirmedAt, p.window.timeZone)}", fontSize = 12.sp)
                                        Text("创建时间：${FinancialHistoryLabels.formatDateTimeInZone(p.createdAt, p.window.timeZone)}", fontSize = 12.sp)
                                        Text("时间范围：${FinancialHistoryLabels.formatWindowRange(p.window)}", fontSize = 12.sp)
                                        Text("分组规则：${p.window.groupingRule}", fontSize = 11.sp, color = tokens.muted)
                                        Text(
                                            "周期模式：${if (p.window.cycle.kind == FinancialCycleKind.NATURAL_MONTH) "自然月" else "起算日 (每月 ${p.window.cycle.day} 日)"}",
                                            fontSize = 11.sp,
                                            color = tokens.muted,
                                        )
                                    }
                                }
                            }

                            item {
                                FinanceCard(modifier = Modifier.fillMaxWidth()) {
                                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                        Text("冻结收入与四用途指标", fontWeight = FontWeight.Bold, color = tokens.fg)
                                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                            Text("确认冻结总收入：¥${formatYuan(p.confirmedIncomeCents)}", fontWeight = FontWeight.SemiBold)
                                            Text("当前有效来源核对金额：¥${formatYuan(p.verifiedIncomeCents)}", fontSize = 11.5.sp, color = tokens.muted)
                                        }

                                        HorizontalDivider(color = tokens.muted.copy(alpha = 0.2f))

                                        // 四用途动态百分比与目标展示
                                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                            Text("必要开支 (${FinancialHistoryLabels.formatBpsPercent(p.decision.ratiosBps.essentials)})", fontSize = 12.sp)
                                            Text("限额 ¥${formatYuan(p.decision.targets.essentials)}", fontWeight = FontWeight.SemiBold)
                                        }
                                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                            Text("随心消费 (${FinancialHistoryLabels.formatBpsPercent(p.decision.ratiosBps.joy)})", fontSize = 12.sp)
                                            Text("限额 ¥${formatYuan(p.decision.targets.joy)}", fontWeight = FontWeight.SemiBold)
                                        }
                                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                            Text("成长积累 (${FinancialHistoryLabels.formatBpsPercent(p.decision.ratiosBps.growth)})", fontSize = 12.sp, color = tokens.muted)
                                            Text("目标 ¥${formatYuan(p.decision.targets.growth)} (未接入实际划拨)", fontSize = 11.5.sp, color = tokens.muted)
                                        }
                                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                            Text("应急储备 (${FinancialHistoryLabels.formatBpsPercent(p.decision.ratiosBps.reserve)})", fontSize = 12.sp, color = tokens.muted)
                                            Text("目标 ¥${formatYuan(p.decision.targets.reserve)} (未接入实际划拨)", fontSize = 11.5.sp, color = tokens.muted)
                                        }

                                        HorizontalDivider(color = tokens.muted.copy(alpha = 0.2f))

                                        Text("规则版本：r${p.decision.configRevision} · 映射版本：r${p.decision.mappingRevision}", fontSize = 11.sp, color = tokens.muted)
                                        if (p.decision.essentialMonthlyCents != null) {
                                            Text("必要月开支基准：¥${formatYuan(p.decision.essentialMonthlyCents)} · 储备目标：${p.decision.targetMonths} 个月", fontSize = 11.sp, color = tokens.muted)
                                        }
                                    }
                                }
                            }

                            item {
                                FinanceCard(modifier = Modifier.fillMaxWidth()) {
                                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                        Text("发薪来源快照 (${p.sources.size} 笔)", fontWeight = FontWeight.Bold, color = tokens.fg)
                                        Text(
                                            text = "来源状态：${FinancialHistoryLabels.sourceStateDescription(p.sourceState)}（当前事实核对，非历史冻结值）",
                                            fontSize = 11.5.sp,
                                            color = if (p.sourceState == FinancialPeriodSourceState.VALID) tokens.muted else tokens.warning,
                                        )
                                        Text(
                                            text = "（注：来源状态与有效收入反映数据库当前事实与冻结快照的一致性检验；历史版本的快照与目标金额保持确认时的冻结状态，不作篡改）",
                                            fontSize = 10.5.sp,
                                            color = tokens.muted,
                                            lineHeight = 14.sp,
                                        )

                                        p.sources.forEach { s ->
                                            Surface(
                                                color = Color(0xFFF9F8F6),
                                                shape = RoundedCornerShape(6.dp),
                                                modifier = Modifier.fillMaxWidth(),
                                            ) {
                                                Column(Modifier.padding(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                                        Text("工资 ¥${formatYuan(s.amountCents)}", fontWeight = FontWeight.SemiBold)
                                                        Text(
                                                            text = FinancialHistoryLabels.sourceStatusDescription(s.status),
                                                            fontSize = 11.sp,
                                                            color = if (s.status == com.yansuu1.jizhang.repo.FinancialSourceStatus.VALID) tokens.accent else tokens.warning,
                                                        )
                                                    }
                                                    Text("日期：${FinancialHistoryLabels.formatDateInZone(s.date, p.window.timeZone)} · 账户: ${s.accountId.take(8)}...", fontSize = 11.sp, color = tokens.muted)
                                                    Text("校验 Token: ${s.sourceToken.take(12)}...", fontSize = 10.sp, color = tokens.muted)
                                                    if (s.current != null) {
                                                        Text(
                                                            "当前库内事实：¥${formatYuan(s.current.amountCents)} · 日期 ${FinancialHistoryLabels.formatDateInZone(s.current.date, p.window.timeZone)}",
                                                            fontSize = 10.5.sp,
                                                            color = tokens.warning,
                                                        )
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }

                            if (p.warnings.isNotEmpty()) {
                                item {
                                    Surface(
                                        color = tokens.warning.copy(alpha = 0.1f),
                                        shape = RoundedCornerShape(8.dp),
                                        modifier = Modifier.fillMaxWidth(),
                                    ) {
                                        Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                            Text("周期关联提示与告警", fontWeight = FontWeight.Bold, color = tokens.warning, fontSize = 12.sp)
                                            p.warnings.forEach { w -> Text("· $w", fontSize = 11.sp, color = tokens.warning) }
                                        }
                                    }
                                }
                            }

                            item { Spacer(Modifier.height(16.dp)) }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun HistoryLoadingBox() {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(200.dp),
        contentAlignment = Alignment.Center,
    ) {
        CircularProgressIndicator()
    }
}

@Composable
private fun HistoryErrorBox(
    message: String,
    onRetry: () -> Unit,
) {
    val tokens = LocalWebTokens.current
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(200.dp),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Icon(Icons.Filled.Warning, contentDescription = null, tint = tokens.danger, modifier = Modifier.size(36.dp))
            Text(message, color = tokens.danger, fontSize = 13.sp)
            OutlinedButton(
                onClick = onRetry,
                modifier = Modifier.heightIn(min = 48.dp),
            ) {
                Text("重试加载")
            }
        }
    }
}

@Composable
private fun HistoryPaginationBar(
    pagination: HistoryPaginationState,
    loading: Boolean,
    onPrev: () -> Unit,
    onNext: () -> Unit,
) {
    val tokens = LocalWebTokens.current
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 8.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        OutlinedButton(
            onClick = onPrev,
            enabled = pagination.hasPrev && !loading,
            modifier = Modifier.heightIn(min = 48.dp),
        ) {
            Text("上一页", fontSize = 12.sp)
        }
        Text(
            text = pagination.summaryText(),
            fontSize = 11.5.sp,
            color = tokens.muted,
        )
        OutlinedButton(
            onClick = onNext,
            enabled = pagination.hasNext && !loading,
            modifier = Modifier.heightIn(min = 48.dp),
        ) {
            Text("下一页", fontSize = 12.sp)
        }
    }
}
