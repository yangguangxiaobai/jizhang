package com.yansuu1.jizhang.ui.feature.assistant

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.SmartToy
import androidx.compose.material.icons.filled.Undo
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.yansuu1.jizhang.net.ApiClient
import com.yansuu1.jizhang.ui.TransactionDetailScreen
import com.yansuu1.jizhang.net.ApiException
import com.yansuu1.jizhang.net.AuthExpiredException
import com.yansuu1.jizhang.repo.OrganizationRepository
import com.yansuu1.jizhang.ui.FinanceCard
import com.yansuu1.jizhang.ui.FinanceEmptyState
import com.yansuu1.jizhang.ui.JzGhostButton
import com.yansuu1.jizhang.ui.JzPrimaryButton
import com.yansuu1.jizhang.ui.formatYuan
import com.yansuu1.jizhang.ui.theme.LocalWebTokens
import java.time.LocalDate
import kotlin.math.roundToInt
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.isActive
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Full-screen review flow for AI-assisted organization of historical bills.
 *
 * One explicit "确认应用" authorizes exactly the selected category/tag actions.
 * Notes are shown as advice only and are never applied. No generic assistant
 * confirmation screen is chained after this workspace.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun AssistantOrganizationWorkspace(
    api: ApiClient,
    repo: OrganizationRepository,
    scopeProvider: suspend () -> String,
    onAuthExpired: () -> Unit,
    onBack: () -> Unit,
) {
    val t = LocalWebTokens.current
    val coroutineScope = rememberCoroutineScope()
    val owner = remember(repo) { OrganizationWorkOwner() }
    val today = remember { LocalDate.now() }

    var preset by remember { mutableStateOf(OrganizationRangePreset.THIS_MONTH) }
    val initialRange = remember { organizationRangeForPreset(OrganizationRangePreset.THIS_MONTH, today)!! }
    var startDate by remember { mutableStateOf(initialRange.startDate) }
    var endDate by remember { mutableStateOf(initialRange.endDate) }
    var showStartPicker by remember { mutableStateOf(false) }
    var showEndPicker by remember { mutableStateOf(false) }

    var loading by remember { mutableStateOf(false) }
    var analysisError by remember { mutableStateOf<String?>(null) }
    var run by remember { mutableStateOf<OrganizationRun?>(null) }
    var pendingStart by remember { mutableStateOf<OrganizationStartRequest?>(null) }
    var pendingResume by remember { mutableStateOf<OrganizationResumeRequest?>(null) }
    var pendingScope by remember { mutableStateOf<String?>(null) }
    var card by remember { mutableStateOf<OrganizationCard?>(null) }
    var selected by remember { mutableStateOf<Set<String>>(emptySet()) }
    var selectionNotice by remember { mutableStateOf<String?>(null) }
    var detailTransactionId by remember(api, card?.runId) { mutableStateOf<String?>(null) }

    var applying by remember { mutableStateOf(false) }
    var applyError by remember { mutableStateOf<String?>(null) }
    var pendingApplyIds by remember { mutableStateOf<List<String>?>(null) }
    var showApplyConfirm by remember { mutableStateOf(false) }
    var applied by remember { mutableStateOf<OrganizationApplyResult?>(null) }

    var undoBusy by remember { mutableStateOf(false) }
    var undoError by remember { mutableStateOf<String?>(null) }
    var undone by remember { mutableStateOf(false) }

    var alive by remember { mutableStateOf(true) }
    DisposableEffect(repo) {
        onDispose {
            alive = false
            owner.invalidate()
        }
    }

    val busy = loading || applying || undoBusy
    BackHandler {
        if (!applying && !undoBusy) onBack()
    }

    fun applyScopePreset(next: OrganizationRangePreset) {
        preset = next
        organizationRangeForPreset(next, today)?.let { range ->
            startDate = range.startDate
            endDate = range.endDate
        }
        analysisError = null
    }

    fun changeScope() {
        if (loading || applying || undoBusy || pendingResume != null) return
        card = null
        run = null
        pendingStart = null
        pendingScope = null
        applied = null
        undone = false
        selected = emptySet()
        selectionNotice = null
        applyError = null
        pendingApplyIds = null
        undoError = null
        analysisError = null
    }

    suspend fun accepts(ticket: Long, requestScope: String, allowExpired: Boolean = false): Boolean {
        currentCoroutineContext().ensureActive()
        val currentScope = scopeProvider()
        currentCoroutineContext().ensureActive()
        return owner.accepts(ticket, requestScope, currentScope, alive, allowExpired || repo.sessionValid())
    }

    suspend fun loadCard(startedRun: OrganizationRun, requestScope: String, ticket: Long) {
        require(startedRun.canLoadCard) { "整理尚未完整完成。" }
        if (!accepts(ticket, requestScope)) return
        val loaded = repo.getCard(startedRun.runId)
        if (!accepts(ticket, requestScope)) return
        require(loaded.runId == startedRun.runId && loaded.startDate == startedRun.startDate &&
            loaded.endDate == startedRun.endDate && loaded.eligibleCount == startedRun.eligibleCount &&
            loaded.completedCount == startedRun.completedCount) { "审查卡片与本次分析不一致。" }
        card = loaded
        val defaults = defaultOrganizationSelection(loaded.actions)
        selected = defaults.actionIds
        selectionNotice = if (defaults.truncated) {
            "单次最多应用 $ORGANIZATION_MAX_APPLY_ACTIONS 项，已默认选择前 $ORGANIZATION_MAX_APPLY_ACTIONS 项。"
        } else null
    }

    // Observation uses GET only. Starts and checkpoint resumes POST only after an
    // explicit tap; uncertain requests retain immutable identity for exact replay.
    fun observeAnalysis(replayUnknownStart: Boolean = false, resumeExplicitly: Boolean = false) {
        if (loading || applying || undoBusy) return
        val existingRun = run
        if (resumeExplicitly) {
            val failed = existingRun ?: return
            pendingResume = organizationResumeRequest(failed, pendingResume) { UUID.randomUUID().toString() }
        }
        val resumeRequest = pendingResume
        if (existingRun == null && pendingStart == null) {
            val validation = organizationRangeValidationError(startDate, endDate)
            if (validation != null) { analysisError = validation; return }
            pendingStart = OrganizationStartRequest(OrganizationDateRange(startDate, endDate), UUID.randomUUID().toString())
        }
        if (existingRun == null && pendingStart != null && !replayUnknownStart && analysisError != null) return
        val request = pendingStart
        val ticket = owner.begin() ?: return
        loading = true // Set synchronously, before launch/scope lookup, to reject double taps.
        analysisError = null
        coroutineScope.launch {
            var requestScope: String? = null
            try {
                val capturedScope = scopeProvider()
                requestScope = capturedScope
                if (!accepts(ticket, capturedScope)) return@launch
                if (pendingScope != null && pendingScope != capturedScope) {
                    analysisError = "服务地址或会话已改变，不能在新服务上恢复旧请求。请退出本页后重新开始。"
                    return@launch
                }
                pendingScope = capturedScope
                var current = if (existingRun != null) {
                    val next = if (resumeExplicitly) {
                        requireNotNull(resumeRequest)
                        repo.resumeAnalysis(resumeRequest.runId, resumeRequest.clientRequestId)
                    } else repo.getRun(existingRun.runId)
                    if (!accepts(ticket, capturedScope)) return@launch
                    validateOrganizationRunUpdate(existingRun, next, resumeRequest)
                } else {
                    requireNotNull(request)
                    val next = repo.startAnalysis(request.range.startDate, request.range.endDate, request.clientRequestId)
                    if (!accepts(ticket, capturedScope)) return@launch
                    require(next.startDate == request.range.startDate && next.endDate == request.range.endDate) { "分析范围不一致。" }
                    validateOrganizationRunUpdate(null, next)
                }
                run = current
                if (resumeRequest != null && current.attempt > resumeRequest.fromAttempt) pendingResume = null
                val deadline = android.os.SystemClock.elapsedRealtime() + ORGANIZATION_OBSERVATION_MS
                while (current.status == "running" && android.os.SystemClock.elapsedRealtime() < deadline) {
                    delay(ORGANIZATION_POLL_MS)
                    if (!accepts(ticket, capturedScope)) return@launch
                    val next = repo.getRun(current.runId)
                    if (!accepts(ticket, capturedScope)) return@launch
                    current = validateOrganizationRunUpdate(current, next)
                    run = current
                }
                if (!accepts(ticket, capturedScope)) return@launch
                when (current.status) {
                    "ready" -> loadCard(current, capturedScope, ticket)
                    "failed" -> analysisError = if (pendingResume != null)
                        "继续请求尚未确认。已保留任务编号与请求 UUID；可核对同一继续请求，不会新建全量分析。"
                        else organizationFailureMessage(current)
                    "cancelled" -> analysisError = "服务端报告分析已取消，本次没有可应用结果。"
                    else -> analysisError = "已观察15分钟，服务端尚未报告完成。可继续查看进度，不会重新发起分析。"
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: AuthExpiredException) {
                val expected = requestScope
                if (expected != null && accepts(ticket, expected, allowExpired = true)) onAuthExpired()
            } catch (e: Exception) {
                val expected = requestScope
                if (expected != null && accepts(ticket, expected)) {
                    if (organizationStartDefinitelyRejected(run, (e as? ApiException)?.status)) {
                        // A definite rejection did not accept this analysis. Let the
                        // user fix its range; transport uncertainty keeps exact replay.
                        pendingStart = null
                        pendingScope = null
                    }
                    if (resumeExplicitly && organizationResumeDefinitelyRejected((e as? ApiException)?.status)) {
                        pendingResume = null
                        // Rejected resume cannot remain advertised from a stale failed summary.
                        run = run?.copy(canResume = false)
                    }
                    analysisError = if (pendingResume != null)
                        "继续请求结果尚未确认。已保留任务编号与原请求 UUID；请核对同一继续请求，不会创建新的全量分析。"
                        else if (e is ApiException) organizationApplyErrorMessage(e.code, null) else
                        if (run != null) "进度读取中断或数据校验未通过。已保留任务编号，可继续查看进度；不会重新发起分析。"
                        else "开始请求结果尚未确认。已保留原日期范围和请求编号；可显式核对同一请求，不会创建新的分析请求。"
                }
            } finally {
                // Ownership is checked even for finalization; never let stale work clear a newer lock.
                val expected = requestScope
                if (expected != null && currentCoroutineContext().isActive && accepts(ticket, expected)) loading = false
                owner.finish(ticket)
            }
        }
    }

    fun startAnalysis() {
        if (pendingResume != null) return // Never replace an uncertain resume with a new start.
        if (run?.terminal == true && run?.status != "ready") {
            if (loading || applying || undoBusy) return
            changeScope() // Explicit new analysis only after terminal failure/cancellation.
        }
        observeAnalysis(replayUnknownStart = pendingStart != null && run == null)
    }

    fun applyActions(ids: List<String>) {
        val currentRun = run ?: return
        if (loading || applying || undoBusy || ids.isEmpty() || !currentRun.canLoadCard) return
        val ticket = owner.begin() ?: return
        applying = true
        applyError = null
        pendingApplyIds = ids
        coroutineScope.launch {
            var requestScope: String? = null
            try {
                val capturedScope = scopeProvider()
                requestScope = capturedScope
                if (!accepts(ticket, capturedScope) || pendingScope != capturedScope) return@launch
                val result = repo.apply(currentRun.runId, ids)
                if (!accepts(ticket, capturedScope)) return@launch
                applied = result
                undone = false
                pendingApplyIds = null
                selectionNotice = null
            } catch (e: CancellationException) { throw e
            } catch (e: AuthExpiredException) {
                val expected = requestScope
                if (expected != null && accepts(ticket, expected, allowExpired = true)) onAuthExpired()
            } catch (e: Exception) {
                val expected = requestScope
                if (expected != null && accepts(ticket, expected)) {
                    applyError = if (e is ApiException) organizationApplyErrorMessage(e.code, null)
                        else "应用结果尚未确认，可重试同一请求核对；服务端按相同动作幂等处理。"
                    pendingApplyIds = if (e is ApiException && e.status in 400..499) null else ids
                }
            } finally {
                val expected = requestScope
                if (expected != null && currentCoroutineContext().isActive && accepts(ticket, expected)) applying = false
                owner.finish(ticket)
            }
        }
    }

    fun undoApplied() {
        val operation = applied ?: return
        if (loading || applying || undoBusy) return
        val ticket = owner.begin() ?: return
        undoBusy = true
        undoError = null
        coroutineScope.launch {
            var requestScope: String? = null
            try {
                val capturedScope = scopeProvider()
                requestScope = capturedScope
                if (!accepts(ticket, capturedScope) || pendingScope != capturedScope) return@launch
                val result = repo.undo(operation.operationId)
                if (!accepts(ticket, capturedScope)) return@launch
                applied = result
                undone = result.status == "undone"
            } catch (e: CancellationException) { throw e
            } catch (e: AuthExpiredException) {
                val expected = requestScope
                if (expected != null && accepts(ticket, expected, allowExpired = true)) onAuthExpired()
            } catch (e: Exception) {
                val expected = requestScope
                if (expected != null && accepts(ticket, expected)) {
                    undoError = if (e is ApiException) organizationApplyErrorMessage(e.code, null)
                        else "撤销结果尚未确认，请重试同一撤销请求核对。"
                }
            } finally {
                val expected = requestScope
                if (expected != null && currentCoroutineContext().isActive && accepts(ticket, expected)) undoBusy = false
                owner.finish(ticket)
            }
        }
    }

    val currentCard = card
    val selectedIds = currentCard?.let { selectedOrganizationActionIds(it.actions, selected) }.orEmpty()
    val scopeEditable = currentCard == null && applied == null && !busy && pendingResume == null &&
        ((pendingStart == null && run == null) || run?.status in setOf("failed", "cancelled"))

    Column(Modifier.fillMaxSize().background(t.bg)) {
        Surface(color = t.surface, tonalElevation = 0.dp) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = { if (!applying && !undoBusy) onBack() }) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回 AI 助手")
                }
                Column(Modifier.weight(1f)) {
                    Text("智能整理旧账", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                    Text(
                        "AI 分类与标签建议 · 逐笔确认",
                        style = MaterialTheme.typography.bodySmall,
                        color = t.muted,
                    )
                }
            }
        }

        LazyColumn(
            modifier = Modifier.weight(1f),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            if (applied == null) {
                item {
                    ScopeCard(
                        startDate = startDate,
                        endDate = endDate,
                        preset = preset,
                        editable = scopeEditable,
                        loading = loading,
                        hasReview = currentCard != null,
                        onPreset = ::applyScopePreset,
                        onChangeScope = { if (pendingApplyIds == null && !applying) changeScope() },
                        onStartDate = { showStartPicker = true },
                        onEndDate = { showEndPicker = true },
                        onAnalyze = ::startAnalysis,
                    )
                }
            }

            if (applied == null && (loading || run != null)) {
                item { AnalysisProgressCard(run) }
            }

            analysisError?.let { message ->
                item {
                    ErrorCard(
                        message = message,
                        actionLabel = when {
                            loading -> null
                            pendingResume != null -> "核对同一继续请求"
                            run?.resumableTimeout == true -> "继续未完成批次（可能产生 AI 调用费用）"
                            run?.status == "ready" -> "重新读取卡片"
                            run != null && run?.terminal != true -> "继续查看进度"
                            run == null && pendingStart != null -> "核对同一开始请求"
                            else -> "新建全量分析（可能产生 AI 调用费用）"
                        },
                        onAction = {
                            when {
                                pendingResume != null || run?.resumableTimeout == true -> observeAnalysis(resumeExplicitly = true)
                                run != null && run?.terminal != true || run?.status == "ready" -> observeAnalysis()
                                else -> startAnalysis()
                            }
                        },
                    )
                }
            }

            if (currentCard != null && applied == null) {
                item {
                    ReviewSummaryCard(
                        card = currentCard,
                        selectedCount = selectedIds.size,
                    )
                }

                val categoryActions = currentCard.categoryActions
                val tagActions = currentCard.tagActions
                val categorySuggestions = currentCard.categorySuggestions

                if (categoryActions.isNotEmpty()) {
                    item { SectionTitle("分类调整", "${categoryActions.size} 项") }
                    items(categoryActions, key = { it.actionId }) { action ->
                        OrganizationActionCard(
                            action = action,
                            checked = action.actionId in selected,
                            enabled = !busy && pendingApplyIds == null,
                            onOpenDetail = if (!busy) action.transactionId?.let { id ->
                                { detailTransactionId = id }
                            } else null,
                            onCheckedChange = { checked ->
                                val before = selected.size
                                selected = updateOrganizationSelection(selected, action, checked)
                                if (checked && selected.size == before) {
                                    selectionNotice = "单次最多应用 $ORGANIZATION_MAX_APPLY_ACTIONS 项。"
                                }
                            },
                        )
                    }
                }

                if (tagActions.isNotEmpty()) {
                    item { SectionTitle("标签调整", "${tagActions.size} 项") }
                    items(tagActions, key = { it.actionId }) { action ->
                        OrganizationActionCard(
                            action = action,
                            checked = action.actionId in selected,
                            enabled = !busy && pendingApplyIds == null,
                            onOpenDetail = if (!busy) action.transactionId?.let { id ->
                                { detailTransactionId = id }
                            } else null,
                            onCheckedChange = { checked ->
                                val before = selected.size
                                selected = updateOrganizationSelection(selected, action, checked)
                                if (checked && selected.size == before) {
                                    selectionNotice = "单次最多应用 $ORGANIZATION_MAX_APPLY_ACTIONS 项。"
                                }
                            },
                        )
                    }
                }

                if (currentCard.selectableActions.isEmpty()) {
                    item {
                        FinanceEmptyState(
                            text = "这个时间段没有需要调整的分类或标签",
                            subtext = "账单已完整分析；以下建议仅供查看，不会自动改动账本。",
                            icon = Icons.Filled.CheckCircle,
                        )
                    }
                }

                if (currentCard.noteSuggestions.isNotEmpty()) {
                    item { SectionTitle("备注建议", "${currentCard.noteSuggestions.size} 条") }
                    item {
                        Text(
                            "仅作参考，不会修改原备注；应用整理时也不会写入备注。",
                            style = MaterialTheme.typography.bodySmall,
                            color = t.muted,
                        )
                    }
                    items(currentCard.noteSuggestions, key = { "note-${it.actionId}" }) { note ->
                        NoteSuggestionCard(
                            note = note,
                            onOpenDetail = if (!busy) ({ detailTransactionId = note.transactionId }) else null,
                        )
                    }
                }

                if (categorySuggestions.isNotEmpty()) {
                    item { SectionTitle("AI 建议的新分类", "${categorySuggestions.size} 项") }
                    item {
                        Text(
                            "这些只是分类结构建议，不会自动创建；本次可应用的动作只有上方分类调整与标签调整。",
                            style = MaterialTheme.typography.bodySmall,
                            color = t.muted,
                        )
                    }
                    items(categorySuggestions, key = { "suggestion-${it.actionId}" }) { suggestion ->
                        CategorySuggestionCard(suggestion)
                    }
                }

                if (currentCard.templateProposalCount > 0) {
                    item {
                        Text(
                            "AI 还生成了 ${currentCard.templateProposalCount} 个预算模板建议；本次只处理分类与标签，预算建议未应用。",
                            style = MaterialTheme.typography.bodySmall,
                            color = t.muted,
                        )
                    }
                }

                applyError?.let { message ->
                    item {
                        ErrorCard(
                            message = message,
                            actionLabel = if (pendingApplyIds != null) "重试同一应用请求" else null,
                            onAction = { pendingApplyIds?.let(::applyActions) },
                        )
                    }
                }
            }

            if (applied != null) {
                item {
                    AppliedResultCard(
                        result = applied!!,
                        undone = undone,
                        undoBusy = undoBusy,
                        undoError = undoError,
                        onUndo = ::undoApplied,
                        onDone = onBack,
                    )
                }
            }
        }

        if (currentCard != null && applied == null) {
            Surface(color = t.surface, shadowElevation = 8.dp) {
                Column(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    selectionNotice?.let {
                        Text(it, style = MaterialTheme.typography.bodySmall, color = t.warning)
                    }
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text("已选 ${selectedIds.size} 项", fontWeight = FontWeight.SemiBold)
                            Text(
                                "只应用分类与标签；备注和金额不变",
                                style = MaterialTheme.typography.bodySmall,
                                color = t.muted,
                            )
                        }
                        Button(
                            onClick = {
                                val retryIds = pendingApplyIds
                                if (retryIds != null) applyActions(retryIds) else showApplyConfirm = true
                            },
                            enabled = selectedIds.isNotEmpty() && !busy,
                            modifier = Modifier.heightIn(min = 48.dp),
                        ) {
                            Text(
                                when {
                                    applying -> "正在应用…"
                                    pendingApplyIds != null -> "重试同一应用"
                                    else -> "确认应用"
                                },
                            )
                        }
                    }
                }
            }
        }
    }

    // Keep the review mounted underneath: dismissing details must not reset
    // scroll position, selection or the pending apply request.
    detailTransactionId?.let { transactionId ->
        TransactionDetailScreen(
            api = api,
            transactionId = transactionId,
            onAuthExpired = onAuthExpired,
            onBack = { detailTransactionId = null },
            onEdit = {},
            readOnly = true,
        )
    }

    if (showStartPicker) {
        OrganizationDatePicker(
            initialDate = startDate,
            onDismiss = { showStartPicker = false },
            onPicked = {
                startDate = it
                preset = OrganizationRangePreset.CUSTOM
                showStartPicker = false
            },
        )
    }
    if (showEndPicker) {
        OrganizationDatePicker(
            initialDate = endDate,
            onDismiss = { showEndPicker = false },
            onPicked = {
                endDate = it
                preset = OrganizationRangePreset.CUSTOM
                showEndPicker = false
            },
        )
    }

    if (showApplyConfirm) {
        AlertDialog(
            onDismissRequest = { if (!applying) showApplyConfirm = false },
            title = { Text("应用所选整理？") },
            text = {
                Text(
                    "将修改 ${selectedIds.size} 项账单分类或标签。原备注、金额、账户、日期和退款事实不会改变。应用后可在结果页条件撤销。",
                )
            },
            confirmButton = {
                TextButton(
                    enabled = !applying && selectedIds.isNotEmpty(),
                    onClick = {
                        showApplyConfirm = false
                        applyActions(selectedIds)
                    },
                ) { Text("确认应用") }
            },
            dismissButton = {
                TextButton(enabled = !applying, onClick = { showApplyConfirm = false }) { Text("再检查") }
            },
        )
    }
}

@Composable
private fun ScopeCard(
    startDate: String,
    endDate: String,
    preset: OrganizationRangePreset,
    editable: Boolean,
    loading: Boolean,
    hasReview: Boolean,
    onPreset: (OrganizationRangePreset) -> Unit,
    onChangeScope: () -> Unit,
    onStartDate: () -> Unit,
    onEndDate: () -> Unit,
    onAnalyze: () -> Unit,
) {
    val t = LocalWebTokens.current
    FinanceCard(modifier = Modifier.fillMaxWidth()) {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Icon(Icons.Filled.SmartToy, contentDescription = null, tint = t.accent)
                Column(Modifier.weight(1f)) {
                    Text("选择要整理的旧账", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                    Text(
                        "按服务端本地日历，起止日期均包含；单次最多分析 500 笔。",
                        style = MaterialTheme.typography.bodySmall,
                        color = t.muted,
                    )
                }
            }

            if (hasReview) {
                Text("当前审查范围：${startDate} 至 ${endDate}", fontWeight = FontWeight.SemiBold)
                TextButton(onClick = onChangeScope, enabled = !loading) { Text("更改分析范围") }
            } else {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf(
                    OrganizationRangePreset.THIS_MONTH,
                    OrganizationRangePreset.LAST_MONTH,
                    OrganizationRangePreset.LAST_THREE_MONTHS,
                    OrganizationRangePreset.THIS_YEAR,
                ).forEach { option ->
                    FilterChip(
                        selected = preset == option,
                        onClick = { if (editable) onPreset(option) },
                        enabled = editable,
                        label = { Text(option.label, style = MaterialTheme.typography.labelMedium) },
                    )
                }
            }

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                DateField(
                    label = "开始日期",
                    value = startDate,
                    enabled = editable,
                    modifier = Modifier.weight(1f),
                    onClick = onStartDate,
                )
                DateField(
                    label = "结束日期",
                    value = endDate,
                    enabled = editable,
                    modifier = Modifier.weight(1f),
                    onClick = onEndDate,
                )
            }

            Text(
                "已选范围：$startDate 至 $endDate",
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Medium,
            )

                JzPrimaryButton(
                    text = if (loading) "正在观察服务端进度…" else "开始全量分析（可能产生 AI 调用费用）",
                    onClick = onAnalyze,
                    enabled = editable && !loading,
                )
            }
        }
    }
}

@Composable
private fun DateField(
    label: String,
    value: String,
    enabled: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    val t = LocalWebTokens.current
    Surface(
        modifier = modifier
            .heightIn(min = 52.dp)
            .clickable(enabled = enabled, role = androidx.compose.ui.semantics.Role.Button, onClick = onClick),
        shape = RoundedCornerShape(12.dp),
        color = if (enabled) t.surfaceSoft else t.surfaceSoft.copy(alpha = 0.55f),
        border = BorderStroke(1.dp, t.border),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Column(Modifier.weight(1f)) {
                Text(label, style = MaterialTheme.typography.labelSmall, color = t.muted)
                Text(value, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
            }
            Icon(
                Icons.Filled.CalendarMonth,
                contentDescription = null,
                tint = if (enabled) t.accent else t.muted,
                modifier = Modifier.size(20.dp),
            )
        }
    }
}

@Composable
private fun AnalysisProgressCard(run: OrganizationRun?) {
    val t = LocalWebTokens.current
    val projection = organizationProgressProjection(run)
    FinanceCard(modifier = Modifier.fillMaxWidth()) {
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                if (run?.terminal != true) CircularProgressIndicator(modifier = Modifier.size(24.dp), strokeWidth = 2.dp)
                Text(projection.stage, fontWeight = FontWeight.SemiBold)
            }
            Text(projection.batches, style = MaterialTheme.typography.bodyMedium)
            Text(projection.processed, style = MaterialTheme.typography.bodyMedium)
            Text(projection.suggestions, style = MaterialTheme.typography.bodyMedium)
            Text(projection.elapsed, style = MaterialTheme.typography.bodySmall, color = t.muted)
            run?.let { Text("任务编号 ${it.runId} · 第 ${it.attempt} 次尝试", style = MaterialTheme.typography.labelSmall, color = t.muted) }
            projection.diagnosis?.let { Text(it, color = t.danger, style = MaterialTheme.typography.bodySmall) }
            if (projection.timeline.isNotEmpty()) {
                Text("服务端进度记录（不是模型思考）", fontWeight = FontWeight.Medium)
                projection.timeline.forEach { Text(it, style = MaterialTheme.typography.bodySmall, color = t.muted) }
            }
            Text("仅全部批次成功后生成审查卡片。离开只停止本页观察，不会取消服务端分析；本页状态不保证跨页面或进程恢复。", style = MaterialTheme.typography.bodySmall, color = t.muted)
        }
    }
}

@Composable
private fun ReviewSummaryCard(card: OrganizationCard, selectedCount: Int) {
    val t = LocalWebTokens.current
    FinanceCard(modifier = Modifier.fillMaxWidth()) {
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(Icons.Filled.CheckCircle, contentDescription = null, tint = t.ok)
                Text("分析完成", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            }
            Text(
                "范围 ${card.startDate} 至 ${card.endDate} · 已完整分析 ${card.completedCount}/${card.eligibleCount} 笔",
                style = MaterialTheme.typography.bodyMedium,
            )
            Text(
                "可应用分类/标签 ${card.selectableActions.size} 项 · 备注建议 ${card.noteSuggestions.size} 条 · 已选 $selectedCount 项",
                style = MaterialTheme.typography.bodySmall,
                color = t.muted,
            )
        }
    }
}

@Composable
private fun SectionTitle(title: String, count: String) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
        Text(count, style = MaterialTheme.typography.bodySmall, color = LocalWebTokens.current.muted)
    }
}

@Composable
private fun OrganizationActionCard(
    action: OrganizationAction,
    checked: Boolean,
    enabled: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    onOpenDetail: (() -> Unit)?,
) {
    val t = LocalWebTokens.current
    FinanceCard(
        modifier = Modifier.fillMaxWidth(),
        onClick = onOpenDetail,
        borderColor = if (checked) t.accent.copy(alpha = 0.55f) else t.border,
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Top) {
            Checkbox(
                checked = checked,
                onCheckedChange = onCheckedChange,
                enabled = enabled,
                modifier = Modifier.size(48.dp),
            )
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        action.transactionDateLabel ?: "账单",
                        style = MaterialTheme.typography.labelMedium,
                        color = t.muted,
                    )
                    Text(
                        buildString {
                            append(if (action.transactionType == 1) "收入" else "支出")
                            action.transactionAmountCents?.let { append(" · ¥${formatYuan(it)}") }
                        },
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = FontWeight.SemiBold,
                    )
                }
                when (action.kind) {
                    OrganizationActionKind.CATEGORY -> Text(
                        "${action.beforeCategoryName ?: action.beforeCategoryId?.take(8) ?: "原分类"} → " +
                            "${action.afterCategoryName ?: action.afterCategoryId?.take(8) ?: "新分类"}",
                        style = MaterialTheme.typography.bodyLarge,
                        fontWeight = FontWeight.SemiBold,
                    )
                    OrganizationActionKind.TAG -> {
                        Text(
                            "标签：${action.beforeTags.joinToString("、").ifBlank { "无" }} → " +
                                action.afterTags.joinToString("、").ifBlank { "无" },
                            style = MaterialTheme.typography.bodyLarge,
                            fontWeight = FontWeight.SemiBold,
                        )
                    }
                    else -> Unit
                }
                if (action.reason.isNotBlank()) {
                    Text(action.reason, style = MaterialTheme.typography.bodySmall, color = t.muted)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        "置信度 ${(action.confidence * 100).roundToInt()}%",
                        style = MaterialTheme.typography.labelSmall,
                        color = t.accent,
                    )
                    action.transactionId?.let {
                        Text("#${it.take(8)}", style = MaterialTheme.typography.labelSmall, color = t.muted)
                    }
                }
                if (onOpenDetail != null) {
                    Text("点击卡片查看原账单详情 ›", style = MaterialTheme.typography.labelMedium, color = t.accent)
                }
            }
        }
    }
}

@Composable
private fun NoteSuggestionCard(note: OrganizationNoteSuggestion, onOpenDetail: (() -> Unit)?) {
    val t = LocalWebTokens.current
    FinanceCard(modifier = Modifier.fillMaxWidth(), onClick = onOpenDetail) {
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(
                buildString {
                    append(note.transactionDateLabel ?: "账单")
                    note.transactionAmountCents?.let { append(" · ¥${formatYuan(it)}") }
                },
                style = MaterialTheme.typography.labelMedium,
                color = t.muted,
            )
            Text(note.suggestedNote, style = MaterialTheme.typography.bodyMedium)
            Text("建议备注 · 原备注保持不变", style = MaterialTheme.typography.labelSmall, color = t.muted)
            if (onOpenDetail != null) {
                Text("点击卡片查看原账单详情 ›", style = MaterialTheme.typography.labelMedium, color = t.accent)
            }
        }
    }
}

@Composable
private fun CategorySuggestionCard(action: OrganizationAction) {
    val t = LocalWebTokens.current
    FinanceCard(modifier = Modifier.fillMaxWidth()) {
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(
                action.proposedCategoryName ?: "未命名分类",
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = FontWeight.SemiBold,
            )
            action.proposedParentCategoryName?.let {
                Text("父分类：$it", style = MaterialTheme.typography.bodySmall, color = t.muted)
            }
            if (action.reason.isNotBlank()) {
                Text(action.reason, style = MaterialTheme.typography.bodySmall, color = t.muted)
            }
            Text("仅建议，不会自动创建", style = MaterialTheme.typography.labelSmall, color = t.muted)
        }
    }
}

@Composable
private fun ErrorCard(message: String, actionLabel: String?, onAction: () -> Unit) {
    val t = LocalWebTokens.current
    FinanceCard(
        modifier = Modifier.fillMaxWidth(),
        backgroundColor = t.dangerSubtle,
        borderColor = t.danger.copy(alpha = 0.35f),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(Icons.Filled.ErrorOutline, contentDescription = null, tint = t.danger)
                Text("整理未完成", fontWeight = FontWeight.Bold, color = t.danger)
            }
            Text(message, style = MaterialTheme.typography.bodyMedium)
            if (actionLabel != null) {
                OutlinedButton(onClick = onAction, modifier = Modifier.heightIn(min = 48.dp)) {
                    Icon(Icons.Filled.Refresh, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.size(6.dp))
                    Text(actionLabel)
                }
            }
        }
    }
}

@Composable
private fun AppliedResultCard(
    result: OrganizationApplyResult,
    undone: Boolean,
    undoBusy: Boolean,
    undoError: String?,
    onUndo: () -> Unit,
    onDone: () -> Unit,
) {
    val t = LocalWebTokens.current
    FinanceCard(
        modifier = Modifier.fillMaxWidth(),
        backgroundColor = if (undone) t.surfaceSoft else t.accentSubtle,
        borderColor = if (undone) t.border else t.accent.copy(alpha = 0.4f),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(
                    if (undone) Icons.Filled.Undo else Icons.Filled.CheckCircle,
                    contentDescription = null,
                    tint = if (undone) t.muted else t.ok,
                )
                Text(
                    if (undone) "已撤销本次整理" else "已应用 ${result.appliedActions.size} 项整理",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                )
            }
            Text(
                if (undone) {
                    "本次分类与标签调整已恢复；若期间有人工修改，服务端会拒绝且有冲突提示。"
                } else {
                    "仅分类与标签已按审查结果更新；原备注、金额、账户、日期和退款事实未改变。"
                },
                style = MaterialTheme.typography.bodyMedium,
            )
            Text("操作编号 ${result.operationId.take(12)}", style = MaterialTheme.typography.labelSmall, color = t.muted)
            undoError?.let {
                Text(it, style = MaterialTheme.typography.bodySmall, color = t.danger)
            }
            if (!undone) {
                OutlinedButton(
                    onClick = onUndo,
                    enabled = !undoBusy,
                    modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                ) {
                    if (undoBusy) {
                        CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                    } else {
                        Icon(Icons.Filled.Undo, contentDescription = null, modifier = Modifier.size(18.dp))
                    }
                    Spacer(Modifier.size(8.dp))
                    Text(if (undoBusy) "正在撤销…" else "撤销本次整理")
                }
            }
            JzPrimaryButton(text = "完成", onClick = onDone)
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun OrganizationDatePicker(
    initialDate: String,
    onDismiss: () -> Unit,
    onPicked: (String) -> Unit,
) {
    val pickerState = rememberDatePickerState(
        initialSelectedDateMillis = organizationDatePickerMillis(initialDate),
    )
    DatePickerDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            TextButton(
                onClick = {
                    pickerState.selectedDateMillis?.let { onPicked(organizationDateFromPickerMillis(it)) }
                },
            ) { Text("确定") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("取消") }
        },
    ) {
        DatePicker(state = pickerState)
    }
}
