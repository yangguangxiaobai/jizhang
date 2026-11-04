package com.yansuu1.jizhang.ui

import org.json.JSONObject
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.yansuu1.jizhang.net.ApiClient
import com.yansuu1.jizhang.net.AuthExpiredException
import com.yansuu1.jizhang.repo.FinancialGoalEntryDto
import com.yansuu1.jizhang.repo.FinancialGoalProgressView
import com.yansuu1.jizhang.repo.FinancialGoalRepository
import com.yansuu1.jizhang.repo.FinancialGoalUnsupportedException
import com.yansuu1.jizhang.repo.FinancialGoalView
import com.yansuu1.jizhang.repo.FinancialGoalWindowSlice
import com.yansuu1.jizhang.repo.ManualGoal
import com.yansuu1.jizhang.repo.ManualGoalEntryKind
import com.yansuu1.jizhang.repo.ManualGoalTargetState
import com.yansuu1.jizhang.ui.theme.LocalWebTokens
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/**
 * C4: 手动存钱与投资进度工作区 (F08/F09).
 *
 * 核心设计规则：
 * 1. 明确展示“手动确认事实 (manual-confirmed)”，不作为银行实时余额或证券核验资产。
 * 2. 应急金：展示起始值、累计存取、当前记录余额、目标缺口和有条件估计投入次数；
 * 3. 投资：仅跟踪实际本金投入与取回，不包含收益/市值，不伪造增长；
 * 4. 历史期间在起始日前显示“尚未开始 (not-started)”，不伪造零余额；
 * 5. 编辑/删除整段历史逐步非负校验，防透支；操作幂等重放保护。
 */
@Composable
fun ManualGoalProgressWorkspace(
    api: ApiClient,
    onAuthExpired: () -> Unit,
    onBack: () -> Unit,
    onDataChanged: () -> Unit = {},
    window: ManualGoalWindowContext? = null,
) {
    val repo = remember(api) { FinancialGoalRepository(api) }
    val scope = rememberCoroutineScope()
    val tokens = LocalWebTokens.current
    val context = LocalContext.current
    val replayStore = remember(context) { OperationReplayStore(context) }
    val coordinator = remember(api, replayStore) {
        ManualGoalReplayCoordinator(
            gateway = ProductionManualGoalMutationGateway(repo),
            store = OperationReplayManualGoalStore(replayStore),
            scopeProvider = { FinancialPrefs.resolveAuthenticatedScope(api) },
        )
    }

    val owner = remember(api) { StatsReadOwner() }
    DisposableEffect(owner) { onDispose { owner.dispose() } }

    var view by remember(owner) { mutableStateOf<FinancialGoalView?>(null) }
    var viewAllHistory by remember(owner, window) { mutableStateOf(false) }
    var entryListState by remember(owner) {
        mutableStateOf(ManualGoalEntryListState(query = ManualGoalEntryQuery(window = window)))
    }
    var loadingMoreEntries by remember(owner) { mutableStateOf(false) }
    var loading by remember(owner) { mutableStateOf(true) }
    var error by remember(owner) { mutableStateOf<String?>(null) }
    var unsupported by remember(owner) { mutableStateOf(false) }
    var retry by remember(owner) { mutableIntStateOf(0) }
    var recoveryFeedback by remember(owner) { mutableStateOf<String?>(null) }
    var unresolvedOperation by remember(owner) { mutableStateOf<PendingFinancialOperation?>(null) }

    // Dialog 状态
    var showOpeningDialogFor by remember { mutableStateOf<ManualGoal?>(null) }
    var showCreateEntryDialogFor by remember { mutableStateOf<ManualGoal?>(null) }
    var editingEntry by remember { mutableStateOf<FinancialGoalEntryDto?>(null) }
    var deletingEntry by remember { mutableStateOf<FinancialGoalEntryDto?>(null) }

    BackHandler { onBack() }

    fun loadNextPage() {
        if (entryListState.loading || loadingMoreEntries || !entryListState.hasMore || entryListState.nextCursor == null) return
        scope.launch {
            val ticket = owner.start()
            loadingMoreEntries = true
            entryListState = markManualGoalEntryPageLoading(entryListState)
            try {
                val nextPage = scopedStatsRead({ FinancialPrefs.resolveAuthenticatedScope(api) }) {
                    repo.listEntries(
                        from = entryListState.query.window?.from,
                        to = entryListState.query.window?.to,
                        cursor = entryListState.nextCursor,
                        limit = 100,
                    )
                }
                if (owner.owns(ticket)) {
                    entryListState = appendManualGoalEntryPage(entryListState, nextPage)
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: AuthExpiredException) {
                if (owner.owns(ticket)) onAuthExpired()
            } catch (e: Exception) {
                if (owner.owns(ticket)) {
                    val msg = e.message ?: "加载下一页失败，请重试。"
                    entryListState = markManualGoalEntryPageError(entryListState, msg)
                }
            } finally {
                if (owner.owns(ticket)) loadingMoreEntries = false
            }
        }
    }

    LaunchedEffect(owner, retry, window, viewAllHistory) {
        val ticket = owner.start()
        loading = true
        error = null
        unsupported = false
        try {
            val report = coordinator.recover()
            if (report.recovered.isNotEmpty()) {
                recoveryFeedback = "先前未确认的操作已由服务端确认并入账。"
                onDataChanged()
            }
            if (report.failures.isNotEmpty()) {
                error = report.failures.joinToString("；")
            }
            unresolvedOperation = report.unresolved.firstOrNull()

            val loadedView = scopedStatsRead({ FinancialPrefs.resolveAuthenticatedScope(api) }) {
                repo.load(from = window?.from, to = window?.to)
            }
            if (window != null) {
                requireManualGoalWindow(loadedView, window)
            }
            val activeWindow = if (viewAllHistory) null else window
            val targetQuery = ManualGoalEntryQuery(window = activeWindow)
            val firstPage = scopedStatsRead({ FinancialPrefs.resolveAuthenticatedScope(api) }) {
                repo.listEntries(from = activeWindow?.from, to = activeWindow?.to, limit = 100)
            }
            if (owner.owns(ticket)) {
                view = loadedView
                entryListState = appendManualGoalEntryPage(ManualGoalEntryListState(query = targetQuery), firstPage)
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: AuthExpiredException) {
            if (owner.owns(ticket)) onAuthExpired()
        } catch (e: FinancialGoalUnsupportedException) {
            if (owner.owns(ticket)) {
                unsupported = true
                view = null
            }
        } catch (e: Exception) {
            if (owner.owns(ticket)) {
                error = e.message ?: "存钱与投资进度读取失败，请重试。"
            }
        } finally {
            if (owner.owns(ticket)) loading = false
        }
    }

    Surface(modifier = Modifier.fillMaxSize(), color = tokens.bg) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            // Header
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                IconButton(onClick = onBack) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                }
                Column(Modifier.weight(1f)) {
                    Text(
                        if (window != null) "存钱与投资 · ${window.label}" else "存钱与投资进度",
                        style = MaterialTheme.typography.headlineSmall,
                        fontWeight = FontWeight.Bold,
                    )
                    Text(
                        if (window != null) "本期手动实际存投 · ${window.timeZone}" else "手动确认事实 · 记录实际存入与本金投入",
                        style = MaterialTheme.typography.bodySmall,
                        color = tokens.muted,
                    )
                }
                OutlinedButton(
                    onClick = { retry++ },
                    enabled = !loading,
                    modifier = Modifier.heightIn(min = 44.dp),
                ) {
                    Text(if (loading) "读取中…" else "刷新")
                }
            }

            if (unsupported) {
                FinanceCard(modifier = Modifier.fillMaxWidth(), backgroundColor = MaterialTheme.colorScheme.errorContainer) {
                    Text("服务端未支持存钱与投资接口", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    Text(
                        "当前连接的服务端版本较低 (404)，请升级服务端后使用手动目标进度功能。未将不支持误显示为 0 元。",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onErrorContainer,
                    )
                }
                return@Column
            }

            if (loading && view == null) {
                FinanceCard(modifier = Modifier.fillMaxWidth()) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        CircularProgressIndicator(modifier = Modifier.size(24.dp))
                        Text("正在读取存钱与投资记录…", color = tokens.muted)
                    }
                }
                return@Column
            }

            if (error != null && view == null) {
                FinanceCard(modifier = Modifier.fillMaxWidth()) {
                    Text("进度暂时不可用", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    Text(error!!, style = MaterialTheme.typography.bodySmall, color = tokens.danger)
                    Spacer(Modifier.height(8.dp))
                    OutlinedButton(onClick = { retry++ }) { Text("重试") }
                }
                return@Column
            }

            recoveryFeedback?.let { msg ->
                FinanceCard(modifier = Modifier.fillMaxWidth(), backgroundColor = MaterialTheme.colorScheme.primaryContainer) {
                    Text(msg, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onPrimaryContainer)
                }
            }

            if (error != null && view != null) {
                FinanceCard(modifier = Modifier.fillMaxWidth(), backgroundColor = MaterialTheme.colorScheme.errorContainer) {
                    Text(error!!, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onErrorContainer)
                }
            }

            unresolvedOperation?.let { op ->
                FinanceCard(modifier = Modifier.fillMaxWidth(), backgroundColor = MaterialTheme.colorScheme.tertiaryContainer) {
                    Text("待核对操作记录", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    Text(
                        "检测到一笔先前可能已提交的操作（${op.method} ${op.path}），为防重复记账，请先核对或重试原操作。",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onTertiaryContainer,
                    )
                    Spacer(Modifier.height(8.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(onClick = {
                            scope.launch {
                                loading = true
                                val outcome = coordinator.retry(op)
                                when (outcome) {
                                    is ManualGoalMutationOutcome.Success -> {
                                        view = outcome.view
                                        unresolvedOperation = null
                                        recoveryFeedback = "操作重试成功并已入账。"
                                        retry++
                                        onDataChanged()
                                    }
                                    is ManualGoalMutationOutcome.DefinitiveFailure -> {
                                        error = outcome.message
                                        unresolvedOperation = null
                                        retry++
                                    }
                                    is ManualGoalMutationOutcome.Unknown -> {
                                        error = outcome.message
                                    }
                                }
                                loading = false
                            }
                        }) { Text("重试原操作") }
                        OutlinedButton(onClick = { retry++ }) { Text("核对未决结果") }
                    }
                }
            }

            view?.let { currentView ->
                // 说明提示条
                Text(
                    "说明：本页数据由手动确认记录驱动，不自动随时间增长，不包含证券收益或估算市值，不自动改动日常账单余额。",
                    style = MaterialTheme.typography.bodySmall,
                    color = tokens.muted,
                )

                // 1. 应急金实际进度卡片
                ReserveGoalCard(
                    progress = currentView.reserveProgress,
                    opening = currentView.reserveOpening,
                    periodPartition = currentView.window?.reserve,
                    isHistoricalWindow = window != null,
                    onAdjustOpening = { showOpeningDialogFor = ManualGoal.RESERVE },
                    onRecordEntry = { showCreateEntryDialogFor = ManualGoal.RESERVE },
                )

                // 2. 投资本金实际投入卡片
                InvestmentGoalCard(
                    progress = currentView.investmentProgress,
                    opening = currentView.investmentOpening,
                    periodPartition = currentView.window?.investment,
                    onAdjustOpening = { showOpeningDialogFor = ManualGoal.INVESTMENT },
                    onRecordEntry = { showCreateEntryDialogFor = ManualGoal.INVESTMENT },
                )

                // 3. 存取与投入历史明细
                FinanceCard(modifier = Modifier.fillMaxWidth()) {
                    val totalDisplay = entryListState.total ?: entryListState.items.size
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            "手动确认明细记录 (${entryListState.items.size}/$totalDisplay)",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.SemiBold,
                        )
                        if (window != null) {
                            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                FilterChip(
                                    selected = !viewAllHistory,
                                    onClick = { if (viewAllHistory) viewAllHistory = false },
                                    label = { Text("本期明细") },
                                )
                                FilterChip(
                                    selected = viewAllHistory,
                                    onClick = { if (!viewAllHistory) viewAllHistory = true },
                                    label = { Text("全部历史") },
                                )
                            }
                        }
                    }
                    Text("历史记录支持更正与删除，系统将自动核算后续每步余额非负。", style = MaterialTheme.typography.bodySmall, color = tokens.muted)
                    Spacer(Modifier.height(8.dp))

                    if (entryListState.restartRequired) {
                        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text("数据版本已变更，请重新加载首屏。", color = MaterialTheme.colorScheme.error)
                            OutlinedButton(onClick = { retry++ }) {
                                Text("重新加载首屏")
                            }
                        }
                    } else if (entryListState.items.isEmpty()) {
                        Text(
                            if (viewAllHistory || window == null) "暂无存取或投入记录。点击上方卡片开始记录。" else "本期暂无明细记录。可切换查看“全部历史”或在上方开始记录。",
                            style = MaterialTheme.typography.bodyMedium,
                            color = tokens.muted,
                        )
                    } else {
                        entryListState.items.forEach { entry ->
                            GoalEntryRow(
                                entry = entry,
                                onEdit = { editingEntry = entry },
                                onDelete = { deletingEntry = entry },
                            )
                        }

                        if (entryListState.hasMore) {
                            Spacer(Modifier.height(8.dp))
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.Center,
                            ) {
                                if (entryListState.loading || loadingMoreEntries) {
                                    CircularProgressIndicator(modifier = Modifier.size(24.dp))
                                } else {
                                    OutlinedButton(onClick = ::loadNextPage) {
                                        Text("加载更多")
                                    }
                                }
                            }
                        }
                        entryListState.error?.let { err ->
                            Spacer(Modifier.height(4.dp))
                            Text("加载失败：$err", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                            OutlinedButton(onClick = ::loadNextPage) {
                                Text("重试加载下一页")
                            }
                        }
                    }
                }
            }
        }
    }

    // ── Dialogs ───────────────────────────────────────────────────────────────

    // 起始值确认/调整 Dialog
    showOpeningDialogFor?.let { goal ->
        OpeningDialog(
            goal = goal,
            currentOpening = if (goal == ManualGoal.RESERVE) view?.reserveOpening else view?.investmentOpening,
            onDismiss = { showOpeningDialogFor = null },
            onSubmit = { openingCents, openingAt ->
                scope.launch {
                    val opId = UUID.randomUUID().toString()
                    val body = JSONObject().apply {
                        put("goal", goal.wireValue)
                        put("openingCents", openingCents)
                        put("openingAt", openingAt)
                    }
                    val op = buildManualGoalOperation(
                        method = "PUT",
                        path = "/api/v1/financial-goals/opening",
                        body = body,
                        operationId = opId,
                        expectedRevision = view?.revision ?: 0L,
                    )
                    when (val outcome = coordinator.submit(op)) {
                        is ManualGoalMutationOutcome.Success -> {
                            view = outcome.view
                            showOpeningDialogFor = null
                            retry++
                            onDataChanged()
                        }
                        is ManualGoalMutationOutcome.DefinitiveFailure -> {
                            error = outcome.message
                            showOpeningDialogFor = null
                        }
                        is ManualGoalMutationOutcome.Unknown -> {
                            error = outcome.message
                            showOpeningDialogFor = null
                            unresolvedOperation = op
                        }
                    }
                }
            },
        )
    }

    // 录入存取记录 Dialog
    showCreateEntryDialogFor?.let { goal ->
        val opening = if (goal == ManualGoal.RESERVE) view?.reserveOpening else view?.investmentOpening
        if (opening == null) {
            AlertDialog(
                onDismissRequest = { showCreateEntryDialogFor = null },
                title = { Text("请先确认起始值") },
                text = { Text("记录${if (goal == ManualGoal.RESERVE) "应急金存取" else "投资投入"}前，请先明确确认起始基准。") },
                confirmButton = {
                    Button(onClick = {
                        val g = showCreateEntryDialogFor
                        showCreateEntryDialogFor = null
                        showOpeningDialogFor = g
                    }) { Text("确认起始值") }
                },
                dismissButton = {
                    TextButton(onClick = { showCreateEntryDialogFor = null }) { Text("取消") }
                },
            )
        } else {
            CreateEntryDialog(
                goal = goal,
                openingAt = opening.openingAt,
                onDismiss = { showCreateEntryDialogFor = null },
                onSubmit = { kind, amountCents, date, note ->
                    scope.launch {
                        val opId = UUID.randomUUID().toString()
                        val body = JSONObject().apply {
                            put("goal", goal.wireValue)
                            put("kind", kind.wireValue)
                            put("amountCents", amountCents)
                            put("date", date)
                            put("note", note)
                        }
                        val op = buildManualGoalOperation(
                            method = "POST",
                            path = "/api/v1/financial-goals/entries",
                            body = body,
                            operationId = opId,
                            expectedRevision = view?.revision ?: 0L,
                        )
                        when (val outcome = coordinator.submit(op)) {
                            is ManualGoalMutationOutcome.Success -> {
                                view = outcome.view
                                showCreateEntryDialogFor = null
                                retry++
                                onDataChanged()
                            }
                            is ManualGoalMutationOutcome.DefinitiveFailure -> {
                                error = outcome.message
                                showCreateEntryDialogFor = null
                            }
                            is ManualGoalMutationOutcome.Unknown -> {
                                error = outcome.message
                                showCreateEntryDialogFor = null
                                unresolvedOperation = op
                            }
                        }
                    }
                },
            )
        }
    }

    // 编辑记录 Dialog
    editingEntry?.let { entry ->
        EditEntryDialog(
            entry = entry,
            onDismiss = { editingEntry = null },
            onSubmit = { amountCents, date, note ->
                scope.launch {
                    val opId = UUID.randomUUID().toString()
                    val body = JSONObject().apply {
                        put("amountCents", amountCents)
                        put("date", date)
                        put("note", note)
                    }
                    val op = buildManualGoalOperation(
                        method = "PATCH",
                        path = "/api/v1/financial-goals/entries/${entry.id}",
                        body = body,
                        operationId = opId,
                        expectedRevision = view?.revision ?: 0L,
                    )
                    when (val outcome = coordinator.submit(op)) {
                        is ManualGoalMutationOutcome.Success -> {
                            view = outcome.view
                            editingEntry = null
                            retry++
                            onDataChanged()
                        }
                        is ManualGoalMutationOutcome.DefinitiveFailure -> {
                            error = outcome.message
                            editingEntry = null
                        }
                        is ManualGoalMutationOutcome.Unknown -> {
                            error = outcome.message
                            editingEntry = null
                            unresolvedOperation = op
                        }
                    }
                }
            },
        )
    }

    // 删除确认 Dialog
    deletingEntry?.let { entry ->
        AlertDialog(
            onDismissRequest = { deletingEntry = null },
            title = { Text("确认删除记录？") },
            text = {
                Text("删除此条${if (entry.kind == ManualGoalEntryKind.DEPOSIT) "存入" else "取出"}记录 ¥${formatYuan(entry.amountCents)}。若删除会导致后续某一时刻余额为负，系统将整体拒绝。")
            },
            confirmButton = {
                Button(onClick = {
                    scope.launch {
                        val opId = UUID.randomUUID().toString()
                        val body = JSONObject()
                        val op = buildManualGoalOperation(
                            method = "DELETE",
                            path = "/api/v1/financial-goals/entries/${entry.id}",
                            body = body,
                            operationId = opId,
                            expectedRevision = view?.revision ?: 0L,
                        )
                        when (val outcome = coordinator.submit(op)) {
                            is ManualGoalMutationOutcome.Success -> {
                                view = outcome.view
                                deletingEntry = null
                                retry++
                                onDataChanged()
                            }
                            is ManualGoalMutationOutcome.DefinitiveFailure -> {
                                error = outcome.message
                                deletingEntry = null
                            }
                            is ManualGoalMutationOutcome.Unknown -> {
                                error = outcome.message
                                deletingEntry = null
                                unresolvedOperation = op
                            }
                        }
                    }
                }) { Text("确认删除") }
            },
            dismissButton = {
                TextButton(onClick = { deletingEntry = null }) { Text("取消") }
            },
        )
    }
}

@Composable
private fun ReserveGoalCard(
    progress: FinancialGoalProgressView?,
    opening: com.yansuu1.jizhang.repo.FinancialGoalOpeningView?,
    periodPartition: FinancialGoalWindowSlice? = null,
    isHistoricalWindow: Boolean = false,
    onAdjustOpening: () -> Unit,
    onRecordEntry: () -> Unit,
) {
    val tokens = LocalWebTokens.current
    FinanceCard(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("应急金实际进度", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Text("按确认存取记录", style = MaterialTheme.typography.bodySmall, color = tokens.muted)
        }
        Spacer(Modifier.height(8.dp))

        if (opening == null) {
            Text("尚未确认应急金起始基准。", color = tokens.muted, style = MaterialTheme.typography.bodyMedium)
            Spacer(Modifier.height(8.dp))
            Button(onClick = onAdjustOpening, modifier = Modifier.fillMaxWidth()) {
                Text("确认应急金起始值")
            }
        } else {
            val balanceStr = progress?.balanceCents?.let { "¥${formatYuan(it)}" } ?: "尚未开始"
            Text(balanceStr, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)

            Spacer(Modifier.height(4.dp))
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Column(Modifier.weight(1f)) {
                    Text("起始确认", style = MaterialTheme.typography.bodySmall, color = tokens.muted)
                    Text("¥${formatYuan(opening.openingCents)} (${formatDay(opening.openingAt)})", style = MaterialTheme.typography.bodySmall)
                }
                Column(Modifier.weight(1f)) {
                    Text("累计存入/取出", style = MaterialTheme.typography.bodySmall, color = tokens.muted)
                    Text("+¥${formatYuan(progress?.depositCents ?: 0L)} / −¥${formatYuan(progress?.withdrawalCents ?: 0L)}", style = MaterialTheme.typography.bodySmall)
                }
            }

            if (periodPartition != null) {
                Spacer(Modifier.height(4.dp))
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(tokens.bg, shape = RoundedCornerShape(8.dp))
                        .padding(8.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Text("本期净存入", style = MaterialTheme.typography.bodySmall, color = tokens.muted)
                    Text(
                        "${if (periodPartition.netAdditionsCents >= 0L) "+" else ""}¥${formatYuan(periodPartition.netAdditionsCents)} (+¥${formatYuan(periodPartition.depositCents)} / −¥${formatYuan(periodPartition.withdrawalCents)})",
                        style = MaterialTheme.typography.bodySmall,
                        fontWeight = FontWeight.SemiBold,
                    )
                }
            }

            Spacer(Modifier.height(8.dp))
            when (progress?.targetState) {
                ManualGoalTargetState.READY -> {
                    Text(
                        "目标储备：¥${formatYuan(progress.targetCents ?: 0L)} (${progress.targetMonths}个月必要开支 · 进度 ${progress.progressPercent}%)",
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.SemiBold,
                    )
                    val gap = progress.gapCents ?: 0L
                    if (gap > 0L) {
                        Text("当前缺口 ¥${formatYuan(gap)}", color = tokens.danger, style = MaterialTheme.typography.bodySmall)
                        if (!isHistoricalWindow && progress.conditionalContributionCount != null && progress.monthlyReferenceCents != null) {
                            Text(
                                "按当前月计划预留 ¥${formatYuan(progress.monthlyReferenceCents)}/月（无收益与投入不变假设下），预计还需 ${progress.conditionalContributionCount} 次投入。",
                                style = MaterialTheme.typography.bodySmall,
                                color = tokens.muted,
                            )
                        } else if (!isHistoricalWindow) {
                            Text("月计划未配置应急预留参考额，不估算完成月数。", style = MaterialTheme.typography.bodySmall, color = tokens.muted)
                        }
                    } else {
                        Text("应急金储备已达标！", color = tokens.ok, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Bold)
                    }
                }
                ManualGoalTargetState.NO_BASELINE -> {
                    Text("尚未在计划设置中确认必要月度开支基线，无法计算目标金额与缺口。", style = MaterialTheme.typography.bodySmall, color = tokens.muted)
                }
                ManualGoalTargetState.NOT_STARTED -> {
                    Text("当前查询区间早于起始确认日期，在此期间尚未开始记录。", style = MaterialTheme.typography.bodySmall, color = tokens.muted)
                }
                else -> {}
            }

            Spacer(Modifier.height(10.dp))
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = onAdjustOpening, modifier = Modifier.weight(1f)) {
                    Text("更正起始值")
                }
                Button(onClick = onRecordEntry, modifier = Modifier.weight(1f)) {
                    Text("记录存入/取出")
                }
            }
        }
    }
}

@Composable
private fun InvestmentGoalCard(
    progress: FinancialGoalProgressView?,
    opening: com.yansuu1.jizhang.repo.FinancialGoalOpeningView?,
    periodPartition: FinancialGoalWindowSlice? = null,
    onAdjustOpening: () -> Unit,
    onRecordEntry: () -> Unit,
) {
    val tokens = LocalWebTokens.current
    FinanceCard(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("投资本金实际投入", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Text("仅记录本金 · 无虚构收益", style = MaterialTheme.typography.bodySmall, color = tokens.muted)
        }
        Spacer(Modifier.height(8.dp))

        if (opening == null) {
            Text("尚未确认投资本金起始基准。", color = tokens.muted, style = MaterialTheme.typography.bodyMedium)
            Spacer(Modifier.height(8.dp))
            Button(onClick = onAdjustOpening, modifier = Modifier.fillMaxWidth()) {
                Text("确认投资本金起始值")
            }
        } else {
            val balanceStr = progress?.balanceCents?.let { "¥${formatYuan(it)}" } ?: "尚未开始"
            Text(balanceStr, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)

            Spacer(Modifier.height(4.dp))
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Column(Modifier.weight(1f)) {
                    Text("起始本金", style = MaterialTheme.typography.bodySmall, color = tokens.muted)
                    Text("¥${formatYuan(opening.openingCents)} (${formatDay(opening.openingAt)})", style = MaterialTheme.typography.bodySmall)
                }
                Column(Modifier.weight(1f)) {
                    Text("实际累计投入 / 取回", style = MaterialTheme.typography.bodySmall, color = tokens.muted)
                    Text("+¥${formatYuan(progress?.depositCents ?: 0L)} / −¥${formatYuan(progress?.withdrawalCents ?: 0L)}", style = MaterialTheme.typography.bodySmall)
                }
            }

            if (periodPartition != null) {
                Spacer(Modifier.height(4.dp))
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(tokens.bg, shape = RoundedCornerShape(8.dp))
                        .padding(8.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Text("本期净投入", style = MaterialTheme.typography.bodySmall, color = tokens.muted)
                    Text(
                        "${if (periodPartition.netAdditionsCents >= 0L) "+" else ""}¥${formatYuan(periodPartition.netAdditionsCents)} (+¥${formatYuan(periodPartition.depositCents)} / −¥${formatYuan(periodPartition.withdrawalCents)})",
                        style = MaterialTheme.typography.bodySmall,
                        fontWeight = FontWeight.SemiBold,
                    )
                }
            }

            Spacer(Modifier.height(8.dp))
            Text(
                "注意：仅记录用户实际投入与取回的本金金额，不包含市场涨跌波动与分红收益，技能成长消费不自动记作投资。",
                style = MaterialTheme.typography.bodySmall,
                color = tokens.muted,
            )

            Spacer(Modifier.height(10.dp))
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = onAdjustOpening, modifier = Modifier.weight(1f)) {
                    Text("更正起始本金")
                }
                Button(onClick = onRecordEntry, modifier = Modifier.weight(1f)) {
                    Text("记录投入/取回")
                }
            }
        }
    }
}

@Composable
private fun GoalEntryRow(
    entry: FinancialGoalEntryDto,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
) {
    val tokens = LocalWebTokens.current
    val isDeposit = entry.kind == ManualGoalEntryKind.DEPOSIT
    val isReserve = entry.goal == ManualGoal.RESERVE
    val sign = if (isDeposit) "+" else "−"
    val color = if (isDeposit) tokens.ok else tokens.danger
    val actionName = when {
        isReserve && isDeposit -> "应急存入"
        isReserve && !isDeposit -> "应急取出"
        !isReserve && isDeposit -> "投资投入"
        else -> "投资取回"
    }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 6.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(actionName, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
                Text(formatDay(entry.date), style = MaterialTheme.typography.bodySmall, color = tokens.muted)
            }
            if (entry.note.isNotBlank()) {
                Text(entry.note, style = MaterialTheme.typography.bodySmall, color = tokens.fg)
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(
                "$sign¥${formatYuan(entry.amountCents)}",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                fontFamily = FontFamily.Monospace,
                color = color,
            )
            if (entry.deletedAt != null) {
                Text(
                    "已删除",
                    style = MaterialTheme.typography.bodySmall,
                    color = tokens.muted,
                    modifier = Modifier.padding(horizontal = 4.dp),
                )
            } else {
                IconButton(onClick = onEdit) {
                    Icon(Icons.Filled.Edit, contentDescription = "编辑", modifier = Modifier.size(18.dp), tint = tokens.muted)
                }
                IconButton(onClick = onDelete) {
                    Icon(Icons.Filled.Delete, contentDescription = "删除", modifier = Modifier.size(18.dp), tint = tokens.muted)
                }
            }
        }
    }
}

// ── Dialog implementations ───────────────────────────────────────────────────

@Composable
private fun OpeningDialog(
    goal: ManualGoal,
    currentOpening: com.yansuu1.jizhang.repo.FinancialGoalOpeningView?,
    onDismiss: () -> Unit,
    onSubmit: (openingCents: Long, openingAt: Long) -> Unit,
) {
    var amountYuan by remember { mutableStateOf(currentOpening?.let { formatYuan(it.openingCents) } ?: "") }
    var inputError by remember { mutableStateOf<String?>(null) }
    val title = if (goal == ManualGoal.RESERVE) "应急金起始基准" else "投资本金起始基准"

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("输入明确确认拥有的起始金额（元）。起始值不计入普通账本收入。", style = MaterialTheme.typography.bodySmall)
                OutlinedTextField(
                    value = amountYuan,
                    onValueChange = { amountYuan = it; inputError = null },
                    label = { Text("起始金额 (元)") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    modifier = Modifier.fillMaxWidth(),
                    isError = inputError != null,
                )
                inputError?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
            }
        },
        confirmButton = {
            Button(onClick = {
                val cents = try {
                    parseManualGoalYuanCents(amountYuan, allowZero = true)
                } catch (e: Exception) {
                    inputError = e.message ?: "金额格式无效"
                    return@Button
                }
                val openingAt = currentOpening?.openingAt ?: System.currentTimeMillis()
                onSubmit(cents, openingAt)
            }) { Text("确认起始值") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("取消") }
        },
    )
}

@Composable
private fun CreateEntryDialog(
    goal: ManualGoal,
    openingAt: Long,
    onDismiss: () -> Unit,
    onSubmit: (kind: ManualGoalEntryKind, amountCents: Long, date: Long, note: String) -> Unit,
) {
    val isReserve = goal == ManualGoal.RESERVE
    var kind by remember { mutableStateOf(ManualGoalEntryKind.DEPOSIT) }
    var amountYuan by remember { mutableStateOf("") }
    var note by remember { mutableStateOf("") }
    var inputError by remember { mutableStateOf<String?>(null) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (isReserve) "记录应急金变动" else "记录投资本金变动") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(
                        selected = kind == ManualGoalEntryKind.DEPOSIT,
                        onClick = { kind = ManualGoalEntryKind.DEPOSIT },
                        label = { Text(if (isReserve) "存入 (+)" else "投入 (+)") },
                    )
                    FilterChip(
                        selected = kind == ManualGoalEntryKind.WITHDRAWAL,
                        onClick = { kind = ManualGoalEntryKind.WITHDRAWAL },
                        label = { Text(if (isReserve) "取出 (−)" else "取回 (−)") },
                    )
                }
                OutlinedTextField(
                    value = amountYuan,
                    onValueChange = { amountYuan = it; inputError = null },
                    label = { Text("金额 (元)") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    modifier = Modifier.fillMaxWidth(),
                    isError = inputError != null,
                )
                OutlinedTextField(
                    value = note,
                    onValueChange = { note = it },
                    label = { Text("备注 (可选)") },
                    modifier = Modifier.fillMaxWidth(),
                )
                inputError?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
            }
        },
        confirmButton = {
            Button(onClick = {
                val cents = try {
                    parseManualGoalYuanCents(amountYuan, allowZero = false)
                } catch (e: Exception) {
                    inputError = e.message ?: "金额格式无效"
                    return@Button
                }
                val now = System.currentTimeMillis()
                if (now < openingAt) {
                    inputError = "记录日期不能早于起始确认日期"
                    return@Button
                }
                onSubmit(kind, cents, now, note.trim())
            }) { Text("保存记录") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("取消") }
        },
    )
}

@Composable
private fun EditEntryDialog(
    entry: FinancialGoalEntryDto,
    onDismiss: () -> Unit,
    onSubmit: (amountCents: Long, date: Long, note: String) -> Unit,
) {
    var amountYuan by remember { mutableStateOf(formatYuan(entry.amountCents)) }
    var note by remember { mutableStateOf(entry.note) }
    var inputError by remember { mutableStateOf<String?>(null) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("编辑记录") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(
                    value = amountYuan,
                    onValueChange = { amountYuan = it; inputError = null },
                    label = { Text("金额 (元)") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    modifier = Modifier.fillMaxWidth(),
                    isError = inputError != null,
                )
                OutlinedTextField(
                    value = note,
                    onValueChange = { note = it },
                    label = { Text("备注 (可选)") },
                    modifier = Modifier.fillMaxWidth(),
                )
                inputError?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
            }
        },
        confirmButton = {
            Button(onClick = {
                val cents = try {
                    parseManualGoalYuanCents(amountYuan, allowZero = false)
                } catch (e: Exception) {
                    inputError = e.message ?: "金额格式无效"
                    return@Button
                }
                onSubmit(cents, entry.date, note.trim())
            }) { Text("保存修改") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("取消") }
        },
    )
}
