package com.yansuu1.jizhang.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
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
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.yansuu1.jizhang.net.ApiClient
import com.yansuu1.jizhang.net.ApiException
import com.yansuu1.jizhang.net.AuthExpiredException
import com.yansuu1.jizhang.repo.FinancialPlanAnalysis
import com.yansuu1.jizhang.repo.FinancialPlanInputs
import com.yansuu1.jizhang.repo.FinancialPlanRepository
import com.yansuu1.jizhang.repo.FinancialPlanSaveRequest
import com.yansuu1.jizhang.repo.PlanPurpose
import com.yansuu1.jizhang.repo.SavedFinancialPlan
import com.yansuu1.jizhang.ui.theme.LocalWebTokens
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private fun formatDateTime(epochMs: Long): String {
    return SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.CHINA).format(Date(epochMs))
}

@Composable
fun FinancialPlanScreen(
    api: ApiClient,
    onAuthExpired: () -> Unit,
    onBack: () -> Unit,
    showHeader: Boolean = true,
    active: Boolean = true,
    onRequestBackAttempt: (() -> Boolean)? = null,
    onRegisterGuard: (((onAllowLeave: () -> Unit) -> Unit) -> Unit)? = null,
) {
    val repo = remember(api) { FinancialPlanRepository(api) }
    val scope = rememberCoroutineScope()
    val tokens = LocalWebTokens.current
    val owner = remember { FinancialPlanWorkOwner() }

    DisposableEffect(owner) {
        onDispose {
            owner.dispose()
        }
    }

    var initialLoading by remember { mutableStateOf(true) }
    var initialLoadError by remember { mutableStateOf<String?>(null) }

    var savedPlan by remember { mutableStateOf<SavedFinancialPlan?>(null) }
    var currentExpectedRevision by remember { mutableLongStateOf(0L) }

    var draft by remember { mutableStateOf(FinancialPlanDraft()) }

    var previewAnalysis by remember { mutableStateOf<FinancialPlanAnalysis?>(null) }
    var previewedInputs by remember { mutableStateOf<FinancialPlanInputs?>(null) }
    var isViewingPreview by remember { mutableStateOf(false) }

    var isBusy by remember { mutableStateOf(false) }
    var requestService by remember { mutableStateOf<String?>(null) }
    var actionError by remember { mutableStateOf<String?>(null) }
    var actionSuccessMessage by remember { mutableStateOf<String?>(null) }

    // CAS Conflict state
    var conflictOccurred by remember { mutableStateOf(false) }
    var showConflictReloadConfirmDialog by remember { mutableStateOf(false) }

    // Uncertain Save Replay state
    var retainedSaveRequest by remember { mutableStateOf<FinancialPlanSaveRequest?>(null) }

    // Back confirmation guards
    var showBackConfirmDialog by remember { mutableStateOf(false) }
    var showBusyBackConfirmDialog by remember { mutableStateOf(false) }

    val isDraftDirty: Boolean = remember(draft, savedPlan) {
        val baseInputs = savedPlan?.inputs
        if (baseInputs == null) {
            !draft.isBlank()
        } else {
            !draft.matchesInputs(baseInputs)
        }
    }

    val isPreviewStale: Boolean = remember(draft, previewedInputs, isViewingPreview) {
        if (!isViewingPreview || previewedInputs == null) false
        else !draft.matchesInputs(previewedInputs!!)
    }

    suspend fun accepts(ticket: FinancialPlanWorkOwner.Ticket, allowExpired: Boolean = false): Boolean {
        currentCoroutineContext().ensureActive()
        val currentBase = api.getBaseUrl().orEmpty()
        if (!owner.owns(ticket, currentBase)) return false
        val validSession = allowExpired || api.hasSession()
        currentCoroutineContext().ensureActive()
        return validSession && owner.owns(ticket, api.getBaseUrl().orEmpty())
    }

    suspend fun loadPlan() {
        if (isBusy || retainedSaveRequest != null) return
        val baseUrl = api.getBaseUrl() ?: run {
            initialLoadError = "请先配置服务端地址"
            initialLoading = false
            return
        }
        val ticket = owner.startLoad(baseUrl) ?: return
        isBusy = true
        requestService = baseUrl
        initialLoading = true
        initialLoadError = null
        actionError = null
        conflictOccurred = false
        // Retain any pending uncertain save request; reload must not blindly discard it
        try {
            val plan = repo.getPlan()
            if (!accepts(ticket)) return

            savedPlan = plan
            if (plan != null) {
                currentExpectedRevision = plan.revision
                draft = FinancialPlanDraft.fromInputs(plan.inputs)
                previewAnalysis = null
                previewedInputs = null
                isViewingPreview = false
            } else {
                currentExpectedRevision = 0L
                draft = FinancialPlanDraft()
                previewAnalysis = null
                previewedInputs = null
                isViewingPreview = false
            }
        } catch (e: AuthExpiredException) {
            if (accepts(ticket, allowExpired = true)) onAuthExpired()
        } catch (e: CancellationException) {
            throw e
        } catch (e: ApiException) {
            if (accepts(ticket, allowExpired = true)) {
                initialLoadError = e.message ?: "读取规划失败（${e.code}）"
            }
        } catch (e: Exception) {
            if (accepts(ticket, allowExpired = true)) {
                initialLoadError = e.message ?: "读取规划失败，请检查网络"
            }
        } finally {
            if (owner.owns(ticket, baseUrl)) {
                initialLoading = false
                isBusy = false
            }
            owner.finish(ticket)
        }
    }

    LaunchedEffect(repo) {
        loadPlan()
    }

    var pendingLeaveCallback by remember { mutableStateOf<(() -> Unit)?>(null) }

    fun requestLeave(onAllowLeave: () -> Unit) {
        when {
            isBusy -> {
                pendingLeaveCallback = onAllowLeave
                showBusyBackConfirmDialog = true
            }
            retainedSaveRequest != null || isDraftDirty -> {
                pendingLeaveCallback = onAllowLeave
                showBackConfirmDialog = true
            }
            else -> {
                onAllowLeave()
            }
        }
    }

    LaunchedEffect(onRegisterGuard) {
        onRegisterGuard?.invoke(::requestLeave)
    }

    fun handleBack(): Boolean {
        return when {
            isBusy -> {
                showBusyBackConfirmDialog = true
                false
            }
            retainedSaveRequest != null || isDraftDirty -> {
                showBackConfirmDialog = true
                false
            }
            else -> {
                onBack()
                true
            }
        }
    }

    BackHandler(enabled = active) {
        handleBack()
    }

    fun executePreview() {
        if (isBusy || retainedSaveRequest != null || initialLoading) return
        val validation = draft.validate()
        val validInputs = validation.getOrElse {
            actionError = it.message ?: "输入数据无效"
            return
        }
        val baseUrl = requestService ?: run {
            actionError = "缺少服务地址"
            return
        }
        val ticket = owner.startPreview(validInputs, baseUrl) ?: return
        isBusy = true

        actionError = null
        actionSuccessMessage = null
        scope.launch {
            try {
                check(accepts(ticket)) { "服务地址或会话已改变，请退出后重新进入。" }
                val analysis = repo.preview(validInputs)
                if (!accepts(ticket)) return@launch

                previewAnalysis = analysis
                previewedInputs = validInputs
                isViewingPreview = true
            } catch (e: AuthExpiredException) {
                if (accepts(ticket, allowExpired = true)) onAuthExpired()
            } catch (e: CancellationException) {
                throw e
            } catch (e: ApiException) {
                if (accepts(ticket, allowExpired = true)) {
                    actionError = e.message ?: "试算分析失败（${e.code}）"
                }
            } catch (e: Exception) {
                if (accepts(ticket, allowExpired = true)) {
                    actionError = e.message ?: "试算分析失败，请检查网络"
                }
            } finally {
                if (owner.owns(ticket, baseUrl)) isBusy = false
                owner.finish(ticket)
            }
        }
    }

    fun executeSave(requestToSave: FinancialPlanSaveRequest) {
        if (isBusy) return
        val baseUrl = requestService ?: run {
            actionError = "缺少服务地址"
            return
        }
        val ticket = owner.startSave(requestToSave, baseUrl) ?: return
        isBusy = true
        retainedSaveRequest = requestToSave

        actionError = null
        actionSuccessMessage = null
        scope.launch {
            try {
                check(accepts(ticket)) { "服务地址或会话已改变，请退出后重新进入。" }
                val saved = repo.savePlan(requestToSave)
                if (!accepts(ticket)) return@launch

                // Strict validation: returned inputs match submitted inputs, and revision advanced by 1
                FinancialPlanWorkOwner.validateSaveResult(requestToSave, saved)

                savedPlan = saved
                currentExpectedRevision = saved.revision
                draft = FinancialPlanDraft.fromInputs(saved.inputs)
                previewAnalysis = null
                previewedInputs = null
                isViewingPreview = false
                conflictOccurred = false
                retainedSaveRequest = null
                actionSuccessMessage = "规划方案已保存（版本 r${saved.revision}）"
            } catch (e: AuthExpiredException) {
                if (accepts(ticket, allowExpired = true)) onAuthExpired()
            } catch (e: CancellationException) {
                throw e
            } catch (e: ApiException) {
                if (!accepts(ticket, allowExpired = true)) return@launch
                if (e.status == 409 || e.code == "FINANCIAL_PLAN_CONFLICT") {
                    conflictOccurred = true
                    retainedSaveRequest = null
                    actionError = "保存冲突：云端方案已被更新。请重新加载最新方案。"
                } else if (e.status == 400 || e.code == "FINANCIAL_PLAN_INVALID") {
                    retainedSaveRequest = null
                    actionError = e.message ?: "输入参数不合法（400）"
                } else {
                    retainedSaveRequest = requestToSave
                    actionError = "保存出现异常（${e.code}）。已保留当前提交，可点击下方重试重放。"
                }
            } catch (e: Exception) {
                if (!accepts(ticket, allowExpired = true)) return@launch
                retainedSaveRequest = requestToSave
                actionError = "网络请求失败，结果未确定。已保留当前提交版本，可点击重试。"
            } finally {
                if (owner.owns(ticket, baseUrl)) isBusy = false
                owner.finish(ticket)
            }
        }
    }

    fun onSaveClicked() {
        if (isBusy || initialLoading || initialLoadError != null || retainedSaveRequest != null || conflictOccurred) return
        val validation = draft.validate()
        val validInputs = validation.getOrElse {
            actionError = it.message ?: "输入数据无效"
            return
        }
        val request = FinancialPlanSaveRequest(
            expectedRevision = currentExpectedRevision,
            inputs = validInputs,
        )
        executeSave(request)
    }

    fun onRetryRetainedSave() {
        val req = retainedSaveRequest ?: return
        executeSave(req)
    }

    fun onReloadLatestRequested() {
        if (isDraftDirty) {
            showConflictReloadConfirmDialog = true
        } else {
            scope.launch { loadPlan() }
        }
    }

    val displayedInputs = if (isViewingPreview) previewedInputs else savedPlan?.inputs
    val displayedAnalysis: FinancialPlanAnalysis? = if (isViewingPreview) {
        previewAnalysis
    } else {
        savedPlan?.analysis
    }

    Surface(
        modifier = Modifier.fillMaxSize(),
        color = tokens.bg,
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .imePadding(),
        ) {
            // Top Bar
            if (showHeader) {
                Surface(
                    color = tokens.surface,
                    modifier = Modifier.fillMaxWidth(),
                    shadowElevation = 1.dp,
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 8.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        IconButton(onClick = { handleBack() }) {
                            Icon(
                                imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                                contentDescription = "返回",
                                tint = tokens.fg,
                            )
                        }
                        Column(Modifier.weight(1f)) {
                            Text(
                                text = "四账户理财计划",
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.Bold,
                                color = tokens.fg,
                            )
                            Text(
                                text = "四用途非真实银行账户 · 25/15/50/10 资产用途规划与5个月必要开支应急储备测算",
                                style = MaterialTheme.typography.bodySmall,
                                color = tokens.muted,
                            )
                        }
                    }
                }
            }

            if (initialLoading) {
                LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(32.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        CircularProgressIndicator(modifier = Modifier.size(28.dp))
                        Text("正在加载云端方案…", style = MaterialTheme.typography.bodyMedium, color = tokens.muted)
                    }
                }
                return@Surface
            }

            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                // Initial Load Error Banner
                if (initialLoadError != null) {
                    item {
                        JzCard {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(12.dp),
                            ) {
                                Icon(Icons.Filled.Warning, contentDescription = null, tint = tokens.danger)
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(
                                        text = "无法读取云端规划方案",
                                        style = MaterialTheme.typography.titleSmall,
                                        fontWeight = FontWeight.Bold,
                                        color = tokens.danger,
                                    )
                                    Text(
                                        text = initialLoadError!!,
                                        style = MaterialTheme.typography.bodySmall,
                                        color = tokens.fg,
                                    )
                                    Text(
                                        text = "为防止覆盖未知方案，保存已被禁用。请检查网络后重试。",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = tokens.muted,
                                    )
                                }
                                Button(onClick = { scope.launch { loadPlan() } }) {
                                    Text("重试")
                                }
                            }
                        }
                    }
                }

                // Conflict Banner
                if (conflictOccurred) {
                    item {
                        JzCard {
                            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                                ) {
                                    Icon(Icons.Filled.Warning, contentDescription = null, tint = tokens.warning)
                                    Text(
                                        text = "方案版本冲突",
                                        style = MaterialTheme.typography.titleSmall,
                                        fontWeight = FontWeight.Bold,
                                        color = tokens.warning,
                                    )
                                }
                                Text(
                                    text = "服务端方案已被更新（版本冲突）。为避免覆盖新数据，请重新加载最新方案。",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = tokens.fg,
                                )
                                OutlinedButton(
                                    onClick = { onReloadLatestRequested() },
                                    modifier = Modifier.fillMaxWidth(),
                                ) {
                                    Text("重新加载最新方案")
                                }
                            }
                        }
                    }
                }

                // Uncertain Save Replay Banner
                if (retainedSaveRequest != null) {
                    item {
                        JzCard {
                            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                                ) {
                                    Icon(Icons.Filled.Info, contentDescription = null, tint = tokens.warning)
                                    Text(
                                        text = "保存状态未确认",
                                        style = MaterialTheme.typography.titleSmall,
                                        fontWeight = FontWeight.Bold,
                                        color = tokens.warning,
                                    )
                                }
                                Text(
                                    text = "上次保存遇到异常或超时，但已保留当时相同的提交参数。重试提交将重放同一版本请求，若服务端此前已处理成功将安全幂等返回。",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = tokens.fg,
                                )
                                Button(
                                    onClick = { onRetryRetainedSave() },
                                    enabled = !isBusy,
                                    modifier = Modifier.fillMaxWidth(),
                                ) {
                                    Text("重试保存（重放上次提交）")
                                }
                            }
                        }
                    }
                }

                // Status Toast/Banners
                if (actionError != null && retainedSaveRequest == null && !conflictOccurred) {
                    item {
                        JzCard {
                            Text(
                                text = actionError!!,
                                style = MaterialTheme.typography.bodySmall,
                                color = tokens.danger,
                            )
                        }
                    }
                }

                if (actionSuccessMessage != null) {
                    item {
                        JzCard {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                Icon(Icons.Filled.CheckCircle, contentDescription = null, tint = tokens.ok)
                                Text(
                                    text = actionSuccessMessage!!,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = tokens.ok,
                                )
                            }
                        }
                    }
                }

                // Current State Badge Card
                item {
                    val isSavedView = !isViewingPreview && savedPlan != null
                    val isPreviewView = isViewingPreview && previewAnalysis != null

                    JzCard {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                when {
                                    isSavedView -> {
                                        if (isDraftDirty) {
                                            Text(
                                                text = "历史已保存方案分析（非当前草稿）",
                                                style = MaterialTheme.typography.titleSmall,
                                                fontWeight = FontWeight.Bold,
                                                color = tokens.warning,
                                            )
                                            Text(
                                                text = "注意：上方草稿输入已修改，下方展示为云端已保存的历史分析（版本 r${savedPlan!!.revision}，更新于 ${formatDateTime(savedPlan!!.updatedAt)}）。点试算或保存后将更新。",
                                                style = MaterialTheme.typography.bodySmall,
                                                color = tokens.warning,
                                            )
                                        } else {
                                            Text(
                                                text = "已保存方案（版本 r${savedPlan!!.revision}）",
                                                style = MaterialTheme.typography.titleSmall,
                                                fontWeight = FontWeight.Bold,
                                                color = tokens.accent,
                                            )
                                            Text(
                                                text = "最后更新时间：${formatDateTime(savedPlan!!.updatedAt)}",
                                                style = MaterialTheme.typography.bodySmall,
                                                color = tokens.muted,
                                            )
                                        }
                                    }
                                    isPreviewView -> {
                                        if (isPreviewStale) {
                                            Text(
                                                text = "试算分析已过期（非当前草稿）",
                                                style = MaterialTheme.typography.titleSmall,
                                                fontWeight = FontWeight.Bold,
                                                color = tokens.danger,
                                            )
                                            Text(
                                                text = "输入已修改，当前试算分析结果已过期，请重新点击「试算预览」",
                                                style = MaterialTheme.typography.bodySmall,
                                                color = tokens.danger,
                                            )
                                        } else {
                                            Text(
                                                text = "未保存试算预览",
                                                style = MaterialTheme.typography.titleSmall,
                                                fontWeight = FontWeight.Bold,
                                                color = tokens.warning,
                                            )
                                            Text(
                                                text = "当前为输入参数模拟测算，点击下方「保存方案」可持久化",
                                                style = MaterialTheme.typography.bodySmall,
                                                color = tokens.muted,
                                            )
                                        }
                                    }
                                    else -> {
                                        Text(
                                            text = "尚未保存规划方案",
                                            style = MaterialTheme.typography.titleSmall,
                                            fontWeight = FontWeight.Bold,
                                            color = tokens.fg,
                                        )
                                        Text(
                                            text = "请填写下方月度参数后点击「试算预览」或直接「保存方案」",
                                            style = MaterialTheme.typography.bodySmall,
                                            color = tokens.muted,
                                        )
                                    }
                                }
                            }
                        }
                    }
                }

                // Input Form Card
                item {
                    val inputFieldsEnabled = !isBusy && retainedSaveRequest == null
                    JzCard {
                        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            Text(
                                text = "规划参数设置",
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.Bold,
                                color = tokens.fg,
                            )
                            Text(
                                text = "输入单位为元，最多支持2位小数的正数，备用金支持0或正数；服务端以整数分计算。",
                                style = MaterialTheme.typography.bodySmall,
                                color = tokens.muted,
                            )

                            OutlinedTextField(
                                value = draft.monthlyIncomeText,
                                onValueChange = { draft = draft.copy(monthlyIncomeText = it) },
                                label = { Text("税后月收入 (元)") },
                                placeholder = { Text("例如 10000.00") },
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                                singleLine = true,
                                enabled = inputFieldsEnabled,
                                modifier = Modifier.fillMaxWidth(),
                            )

                            OutlinedTextField(
                                value = draft.essentialMonthlyText,
                                onValueChange = { draft = draft.copy(essentialMonthlyText = it) },
                                label = { Text("每月必要开支 (元)") },
                                placeholder = { Text("例如 5000.00") },
                                supportingText = { Text("房租/房贷、饮食、基本水电等必要支出。用于计算5个月应急防线目标。") },
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                                singleLine = true,
                                enabled = inputFieldsEnabled,
                                modifier = Modifier.fillMaxWidth(),
                            )

                            OutlinedTextField(
                                value = draft.reserveBalanceText,
                                onValueChange = { draft = draft.copy(reserveBalanceText = it) },
                                label = { Text("现有应急储备金 (元)") },
                                placeholder = { Text("例如 0.00") },
                                supportingText = { Text("目前已隔离存放的活期/现金备用金。手动确认快照，不会自动随时间累加。") },
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                                singleLine = true,
                                enabled = inputFieldsEnabled,
                                modifier = Modifier.fillMaxWidth(),
                            )

                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                OutlinedButton(
                                    onClick = { executePreview() },
                                    enabled = !isBusy && !initialLoading && retainedSaveRequest == null && !draft.isBlank(),
                                    modifier = Modifier.weight(1f),
                                ) {
                                    Text(if (isBusy) "处理中…" else "试算预览")
                                }
                                Button(
                                    onClick = { onSaveClicked() },
                                    enabled = !isBusy && !initialLoading && initialLoadError == null && retainedSaveRequest == null && !conflictOccurred && !draft.isBlank(),
                                    modifier = Modifier.weight(1f),
                                ) {
                                    Text(if (isBusy) "保存中…" else "保存方案")
                                }
                            }
                        }
                    }
                }

                // If analysis is available, render sections
                if (displayedAnalysis != null) {
                    val analysis = displayedAnalysis

                    // 4-Purpose Allocation Cards
                    item {
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text(
                                text = "四笔钱用途分配 (25/15/50/10)",
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.Bold,
                                color = tokens.fg,
                            )
                            Text(
                                text = "按25/15/50/10分配，精确到分；合计等于计划月收入。",
                                style = MaterialTheme.typography.bodySmall,
                                color = tokens.muted,
                            )

                            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                analysis.allocations.forEach { alloc ->
                                    val purpose = PlanPurpose.fromWire(alloc.purpose)
                                    val title = purpose?.label ?: alloc.purpose
                                    val desc = purpose?.description ?: ""
                                    JzCard {
                                        Row(
                                            modifier = Modifier.fillMaxWidth(),
                                            horizontalArrangement = Arrangement.SpaceBetween,
                                            verticalAlignment = Alignment.CenterVertically,
                                        ) {
                                            Column(modifier = Modifier.weight(1f)) {
                                                Row(
                                                    verticalAlignment = Alignment.CenterVertically,
                                                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                                                ) {
                                                    Text(
                                                        text = "$title ${alloc.percent}%",
                                                        style = MaterialTheme.typography.titleSmall,
                                                        fontWeight = FontWeight.Bold,
                                                        color = tokens.fg,
                                                    )
                                                }
                                                if (desc.isNotEmpty()) {
                                                    Text(
                                                        text = desc,
                                                        style = MaterialTheme.typography.bodySmall,
                                                        color = tokens.muted,
                                                    )
                                                }
                                            }
                                            Text(
                                                text = "¥${formatYuan(alloc.amountCents)}",
                                                style = MaterialTheme.typography.titleMedium,
                                                fontWeight = FontWeight.Bold,
                                                color = tokens.accent,
                                            )
                                        }
                                    }
                                }
                            }
                        }
                    }

                    // Emergency Reserve Progress Card
                    item {
                        HeroCard {
                            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Text(
                                        text = "应急储备防线进度",
                                        style = MaterialTheme.typography.titleMedium,
                                        fontWeight = FontWeight.Bold,
                                        color = tokens.onHero,
                                    )
                                    if (analysis.targetReached) {
                                        Surface(
                                            shape = RoundedCornerShape(12.dp),
                                            color = tokens.ok,
                                        ) {
                                            Text(
                                                text = "目标已达成",
                                                style = MaterialTheme.typography.labelSmall,
                                                color = Color.White,
                                                modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
                                            )
                                        }
                                    }
                                }

                                Text(
                                    text = "储备金目标：¥${formatYuan(analysis.reserveTargetCents)}（按实际必要开支 × 5 测算）",
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = tokens.onHero,
                                )

                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                ) {
                                    Text(
                                        text = "本次方案储备: ¥${formatYuan(requireNotNull(displayedInputs).reserveBalanceCents)}",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = tokens.heroMuted,
                                    )
                                    if (analysis.targetReached) {
                                        Text(
                                            text = "超额储备: ¥${formatYuan(analysis.reserveSurplusCents)}",
                                            style = MaterialTheme.typography.bodySmall,
                                            color = tokens.heroMuted,
                                        )
                                    } else {
                                        Text(
                                            text = "尚缺: ¥${formatYuan(analysis.reserveGapCents)}",
                                            style = MaterialTheme.typography.bodySmall,
                                            color = tokens.heroDanger,
                                        )
                                    }
                                }

                                LinearProgressIndicator(
                                    progress = { analysis.reserveProgress.toFloat() },
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .height(8.dp)
                                        .clip(RoundedCornerShape(4.dp)),
                                    color = if (analysis.targetReached) tokens.ok else tokens.accent,
                                    trackColor = Color.White.copy(alpha = 0.25f),
                                )

                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Text(
                                        text = "进度 ${(analysis.reserveProgress * 100).toInt()}%",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = tokens.heroMuted,
                                    )
                                    val etaText = when {
                                        analysis.targetReached -> "目标已达成（0个月）"
                                        analysis.monthsToTarget == null -> "无法估算（每月储备贡献为0）"
                                        else -> "预计约需 ${analysis.monthsToTarget} 个月达成"
                                    }
                                    Text(
                                        text = etaText,
                                        style = MaterialTheme.typography.bodySmall,
                                        fontWeight = FontWeight.SemiBold,
                                        color = tokens.onHero,
                                    )
                                }
                            }
                        }
                    }

                    // System Warning Banners
                    if (analysis.warnings.isNotEmpty()) {
                        item {
                            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                Text(
                                    text = "财务风险与状态提示",
                                    style = MaterialTheme.typography.titleMedium,
                                    fontWeight = FontWeight.Bold,
                                    color = tokens.fg,
                                )
                                analysis.warnings.forEach { warningCode ->
                                    val (msg, isDanger) = when (warningCode) {
                                        "ESSENTIALS_OVER_HALF" -> "必要开支占比超过50%：固定生活成本较高，建议检视固定支出；当前规划具备假设性质，可能难以完全落实。" to false
                                        "ESSENTIALS_EXCEED_INCOME" -> "必要开支超过月收入：当前处于月度收支赤字状态，请优先缩减非必要固定开支或补充流动性，该规划方案仅供参考并非实际可负担方案。" to true
                                        "RESERVE_UNDER_ONE_MONTH" -> "你填写的备用金尚不足1个月必要开支，可优先评估基础安全垫，暂缓非必要大额开销与高风险投资。" to true
                                        "RESERVE_TARGET_REACHED" -> "储备目标已达成：当前应急资金已达到5个月必要开支防线。已有储备金请继续专款专用；后续每月15%储备资金可考虑在未来按需调整用于成长积累或其他用途（本系统不自动调整比例）。" to false
                                        "RESERVE_CONTRIBUTION_ZERO" -> "按当前收入比例分配并取整到分后为0，无法估算达成目标所需时间。" to true
                                        else -> "提示：$warningCode" to false
                                    }
                                    JzCard {
                                        Row(
                                            modifier = Modifier.fillMaxWidth(),
                                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                                            verticalAlignment = Alignment.Top,
                                        ) {
                                            Icon(
                                                imageVector = if (isDanger) Icons.Filled.Warning else Icons.Filled.Info,
                                                contentDescription = null,
                                                tint = if (isDanger) tokens.danger else tokens.warning,
                                                modifier = Modifier.size(20.dp),
                                            )
                                            Text(
                                                text = msg,
                                                style = MaterialTheme.typography.bodySmall,
                                                color = if (isDanger) tokens.danger else tokens.fg,
                                            )
                                        }
                                    }
                                }
                            }
                        }
                    }

                    // 12-Month Projection Forecast Table
                    item {
                        JzCard {
                            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                                Text(
                                    text = "12个月储备与成长测算 (假设模型)",
                                    style = MaterialTheme.typography.titleMedium,
                                    fontWeight = FontWeight.Bold,
                                    color = tokens.fg,
                                )
                                Text(
                                    text = "说明：测算基于等额月收入与无收益假设，成长投入仅反映计划投入累计（含投资与技能积累），不包含任何投资收益或利息；实际储备余额仅在手动录入时更新，不会随时间自动增长。",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = tokens.muted,
                                )

                                HorizontalDivider(color = tokens.border)

                                // Table Header
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                ) {
                                    Text("月份", style = MaterialTheme.typography.labelSmall, color = tokens.muted, modifier = Modifier.weight(0.8f))
                                    Text("预计储备金", style = MaterialTheme.typography.labelSmall, color = tokens.muted, modifier = Modifier.weight(1.3f))
                                    Text("累计成长投入", style = MaterialTheme.typography.labelSmall, color = tokens.muted, modifier = Modifier.weight(1.3f))
                                    Text("缺口/超额", style = MaterialTheme.typography.labelSmall, color = tokens.muted, modifier = Modifier.weight(1.3f))
                                    Text("达标", style = MaterialTheme.typography.labelSmall, color = tokens.muted, modifier = Modifier.weight(0.8f))
                                }

                                HorizontalDivider(color = tokens.border)

                                // 12 Rows
                                analysis.projection.forEach { p ->
                                    Row(
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .padding(vertical = 3.dp),
                                        horizontalArrangement = Arrangement.SpaceBetween,
                                        verticalAlignment = Alignment.CenterVertically,
                                    ) {
                                        Text("${p.month}月", style = MaterialTheme.typography.bodySmall, color = tokens.fg, modifier = Modifier.weight(0.8f))
                                        Text("¥${formatYuan(p.reserveProjectedCents)}", style = MaterialTheme.typography.bodySmall, color = tokens.fg, modifier = Modifier.weight(1.3f))
                                        Text("¥${formatYuan(p.growthContributionsCents)}", style = MaterialTheme.typography.bodySmall, color = tokens.fg, modifier = Modifier.weight(1.3f))
                                        val gapText = if (p.targetReached) {
                                            "+¥${formatYuan(p.reserveSurplusCents)}"
                                        } else {
                                            "-¥${formatYuan(p.reserveGapCents)}"
                                        }
                                        Text(
                                            text = gapText,
                                            style = MaterialTheme.typography.bodySmall,
                                            color = if (p.targetReached) tokens.ok else tokens.danger,
                                            modifier = Modifier.weight(1.3f),
                                        )
                                        Text(
                                            text = if (p.targetReached) "达标" else "未达",
                                            style = MaterialTheme.typography.bodySmall,
                                            fontWeight = if (p.targetReached) FontWeight.Bold else FontWeight.Normal,
                                            color = if (p.targetReached) tokens.ok else tokens.muted,
                                            modifier = Modifier.weight(0.8f),
                                        )
                                    }
                                }
                            }
                        }
                    }

                    // Educational Prompts Section
                    item {
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text(
                                text = "四账户理财计划核心指南",
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.Bold,
                                color = tokens.fg,
                            )
                            FinancialPlanPrompts.ALL.forEach { prompt ->
                                JzCard {
                                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                        Text(
                                            text = prompt.title,
                                            style = MaterialTheme.typography.titleSmall,
                                            fontWeight = FontWeight.Bold,
                                            color = tokens.accent,
                                        )
                                        Text(
                                            text = prompt.body,
                                            style = MaterialTheme.typography.bodySmall,
                                            color = tokens.fg,
                                        )
                                    }
                                }
                            }
                        }
                    }
                }

                item {
                    Spacer(modifier = Modifier.height(32.dp))
                }
            }
        }
    }

    // Dialog for Busy Back Confirmation
    if (showBusyBackConfirmDialog) {
        AlertDialog(
            onDismissRequest = { showBusyBackConfirmDialog = false },
            title = { Text("正在与服务器同步") },
            text = { Text("正在与服务器同步数据，退出无法保证云端操作结果。是否仍要离开当前页面？") },
            confirmButton = {
                Button(
                    onClick = {
                        showBusyBackConfirmDialog = false
                        onBack()
                    },
                ) {
                    Text("仍要离开")
                }
            },
            dismissButton = {
                TextButton(onClick = { showBusyBackConfirmDialog = false }) {
                    Text("等待完成")
                }
            },
        )
    }

    // Dialog for Discarding Draft on Back
    if (showBackConfirmDialog) {
        AlertDialog(
            onDismissRequest = { showBackConfirmDialog = false },
            title = { Text("放弃未保存的修改？") },
            text = { Text(if (retainedSaveRequest != null) "上次保存结果尚未确定，退出会丢失本页重试凭据，但不会撤销服务器可能已完成的保存。重新进入后请先核对已保存方案。仍要退出？" else "您在当前规划方案中有未保存的输入改动，退出将丢失这些修改。是否确认退出？") },
            confirmButton = {
                Button(
                    onClick = {
                        showBackConfirmDialog = false
                        onBack()
                    },
                ) {
                    Text("放弃并退出")
                }
            },
            dismissButton = {
                TextButton(onClick = { showBackConfirmDialog = false }) {
                    Text("继续编辑")
                }
            },
        )
    }

    // Dialog for Discarding Draft on Conflict Reload
    if (showConflictReloadConfirmDialog) {
        AlertDialog(
            onDismissRequest = { showConflictReloadConfirmDialog = false },
            title = { Text("重新加载将放弃当前草稿") },
            text = { Text("重新加载云端最新方案将覆盖您当前输入的草稿。是否确认重新加载？") },
            confirmButton = {
                Button(
                    onClick = {
                        showConflictReloadConfirmDialog = false
                        scope.launch { loadPlan() }
                    },
                ) {
                    Text("确认重新加载")
                }
            },
            dismissButton = {
                TextButton(onClick = { showConflictReloadConfirmDialog = false }) {
                    Text("取消")
                }
            },
        )
    }
}
