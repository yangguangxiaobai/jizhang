package com.yansuu1.jizhang.ui.feature.assistant

import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.CompareArrows
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.yansuu1.jizhang.net.ApiClient
import com.yansuu1.jizhang.net.AuthExpiredException
import com.yansuu1.jizhang.repo.AssistantRepository
import com.yansuu1.jizhang.ui.ActiveNavigationHandlers
import com.yansuu1.jizhang.ui.FinancialPrefs
import com.yansuu1.jizhang.ui.feature.imports.PlatformImportOwnerKey
import com.yansuu1.jizhang.ui.feature.imports.PlatformImportRequestGate
import com.yansuu1.jizhang.ui.feature.imports.PlatformImportRequestTicket
import com.yansuu1.jizhang.ui.feature.imports.PlatformImportSource
import com.yansuu1.jizhang.ui.FinanceCategoryIcon
import com.yansuu1.jizhang.ui.SelectedDocument
import com.yansuu1.jizhang.ui.feature.imports.canTriggerOptionalAiAnalysis
import com.yansuu1.jizhang.ui.formatYuan
import com.yansuu1.jizhang.ui.readDocument
import com.yansuu1.jizhang.ui.readMultipleDocuments
import com.yansuu1.jizhang.ui.theme.LocalWebTokens
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.security.MessageDigest
import java.util.UUID

private fun computeSha256Hex(bytes: ByteArray): String {
    val md = MessageDigest.getInstance("SHA-256")
    val digest = md.digest(bytes)
    return digest.joinToString("") { "%02x".format(it) }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun AssistantBatchImportWorkspace(
    conversationId: String,
    initialBatchId: String,
    repo: AssistantRepository,
    api: ApiClient,
    initialOwnerKey: PlatformImportOwnerKey? = null,
    initialMemoryFiles: List<SelectedDocument>,
    onAuthExpired: () -> Unit,
    onBack: () -> Unit,
    onImportConfirmed: (ImportBatchResult) -> Unit,
    onRecoveryStateChanged: ((AssistantBatchRecoveryState) -> Unit)? = null,
    onRegisterNavigation: ((ActiveNavigationHandlers?) -> Unit)? = null,
    onDirtyStateChanged: ((Boolean) -> Unit)? = null,
) {
    val t = LocalWebTokens.current
    val scope = rememberCoroutineScope()
    val context = LocalContext.current

    // Batch and data states
    var batchId by remember(initialBatchId) { mutableStateOf(initialBatchId) }
    var batch by remember(initialBatchId) { mutableStateOf<ImportBatch?>(null) }
    var allRows by remember(initialBatchId) { mutableStateOf<List<ImportBatchRow>>(emptyList()) }
    var activeLeaves by remember(initialBatchId) { mutableStateOf<List<ImportActiveCategory>>(emptyList()) }
    var suggestions by remember(initialBatchId) { mutableStateOf<List<CategorySuggestion>>(emptyList()) }
    var memoryFiles by remember(initialBatchId) { mutableStateOf(initialMemoryFiles) }

    // User draft states (keyed by itemId)
    var selectedItemIds by remember(initialBatchId) { mutableStateOf<Set<String>>(emptySet()) }
    var userExcludedItemIds by remember(initialBatchId) { mutableStateOf<Set<String>>(emptySet()) }
    var categoryAssignments by remember(initialBatchId) { mutableStateOf<Map<String, CategoryAssignment>>(emptyMap()) }
    var noteOverrides by remember(initialBatchId) { mutableStateOf<Map<String, String>>(emptyMap()) }
    var approvedCategories by remember(initialBatchId) { mutableStateOf<Map<String, ApprovedCategory>>(emptyMap()) }

    // View & operation states
    var loading by remember(initialBatchId) { mutableStateOf(true) }
    var busy by remember(initialBatchId) { mutableStateOf(false) }
    var errorMessage by remember(initialBatchId) { mutableStateOf<String?>(null) }
    var noticeMessage by remember(initialBatchId) { mutableStateOf<String?>(null) }
    var viewRevision by remember(initialBatchId) { mutableStateOf("") }
    var providerReady by remember(initialBatchId) { mutableStateOf(false) }
    var providerStatusKnown by remember(initialBatchId) { mutableStateOf(false) }
    var providerStatusMessage by remember(initialBatchId) { mutableStateOf<String?>(null) }
    var analysisNeedsQuery by remember(initialBatchId) { mutableStateOf(false) }
    var originalFilesReady by remember(initialBatchId) { mutableStateOf(false) }

    // Review & Confirm states (Review token ONLY in memory)
    var reviewResponse by remember(initialBatchId) { mutableStateOf<ReviewResponse?>(null) }
    var showReviewModal by remember(initialBatchId) { mutableStateOf(false) }

    // Sub-screens: Editing row or comparing duplicate
    var editingRow by remember(initialBatchId) { mutableStateOf<ImportBatchRow?>(null) }
    var comparingRow by remember(initialBatchId) { mutableStateOf<ImportBatchRow?>(null) }
    var comparisonPage by remember(initialBatchId) { mutableStateOf<BatchRowDuplicatePage?>(null) }
    var comparisonLoading by remember(initialBatchId) { mutableStateOf(false) }
    var comparisonError by remember(initialBatchId) { mutableStateOf<String?>(null) }

    // Suggestion proposal actions
    var candidatePickerSuggestion by remember(initialBatchId) { mutableStateOf<CategorySuggestion?>(null) }
    var renameProposalSuggestion by remember(initialBatchId) { mutableStateOf<CategorySuggestion?>(null) }
    var proposalNewName by remember(initialBatchId) { mutableStateOf("") }

    // Filter and search
    var filter by remember(initialBatchId) { mutableStateOf("待核对") }
    var query by remember(initialBatchId) { mutableStateOf("") }

    val listState = rememberLazyListState()
    // Exact SHA-256 one-to-one match against the server batch file order; a same
    // count is not enough because a replaced file keeps the count but changes bytes.
    val matchedOriginals = remember(batch?.files, memoryFiles) {
        batch?.files?.let { matchBatchOriginals(it, memoryFiles) }
    }
    val filesMismatch = batch != null && batch!!.files.isNotEmpty() && matchedOriginals == null

    val recoveryStore = remember(context) { SharedPreferencesAssistantBatchRecoveryStore(context) }
    var recoveryState by remember(initialBatchId) {
        mutableStateOf(AssistantBatchRecoveryState())
    }

    LaunchedEffect(recoveryState) {
        onRecoveryStateChanged?.invoke(recoveryState)
    }

    // Every async request is tied to the financial owner, protocol conversation and this composition.
    val gate = remember(api, conversationId, initialBatchId, initialOwnerKey) { PlatformImportRequestGate() }
    var requestOwner by remember(api, conversationId, initialBatchId, initialOwnerKey) {
        mutableStateOf(initialOwnerKey)
    }

    DisposableEffect(gate) {
        onDispose { gate.invalidate() }
    }

    // T12: leaving the workspace must not silently discard drafts, selected originals, an
    // in-flight submit or an unresolved (UNKNOWN) mutation. A deliberate leave keeps all of
    // them: it only stops local waiting, never cancels a possibly-committed server operation
    // and never deletes the replay/recovery metadata written before the request was sent.
    var leavePrompt by remember(initialBatchId) { mutableStateOf<(() -> Unit)?>(null) }
    val hasDraftState = selectedItemIds.isNotEmpty() ||
        userExcludedItemIds.isNotEmpty() ||
        categoryAssignments.isNotEmpty() ||
        noteOverrides.isNotEmpty() ||
        memoryFiles.isNotEmpty()
    val hasUnsafeLeaveState = busy || editingRow != null || showReviewModal || hasDraftState ||
        recoveryState.hasUnresolvedMutation

    LaunchedEffect(hasUnsafeLeaveState) { onDirtyStateChanged?.invoke(hasUnsafeLeaveState) }

    DisposableEffect(hasUnsafeLeaveState) {
        onRegisterNavigation?.invoke(
            ActiveNavigationHandlers(
                requestBack = {
                    when {
                        editingRow != null -> editingRow = null
                        showReviewModal -> showReviewModal = false
                        else -> onBack()
                    }
                },
                requestLeave = { onAllowLeave ->
                    if (hasUnsafeLeaveState) leavePrompt = onAllowLeave else onAllowLeave()
                },
            ),
        )
        onDispose { onRegisterNavigation?.invoke(null) }
    }

    leavePrompt?.let { onAllowLeave ->
        AlertDialog(
            onDismissRequest = { leavePrompt = null },
            title = { Text("离开导入工作区？") },
            text = {
                Text(
                    if (recoveryState.hasUnresolvedMutation) {
                        "有操作结果待核对。离开只会停止本地等待，不会撤销可能已提交的服务端操作；" +
                            "下次进入仍可按原请求恢复。已选文件与草稿将保留在本次会话中。"
                    } else {
                        "已选文件、行选择与分类/备注草稿会保留在本次会话中；" +
                            "离开只停止本地等待，不会撤销已提交的服务端操作。"
                    },
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    leavePrompt = null
                    onAllowLeave()
                }) { Text("继续离开") }
            },
            dismissButton = {
                TextButton(onClick = { leavePrompt = null }) { Text("继续编辑") }
            },
        )
    }

    // Lint forbids reading StateFlow.value during composition; collect it as Compose state.
    val sessionExpired by api.sessionExpired.collectAsState()
    LaunchedEffect(api, conversationId, initialBatchId, initialOwnerKey, sessionExpired) {
        gate.invalidate()
        try {
            if (sessionExpired) {
                requestOwner = null
                return@LaunchedEffect
            }
            val identity = api.captureRequestIdentity()
            val scope = FinancialPrefs.resolveAuthenticatedScope(api)
            val owner = initialOwnerKey ?: PlatformImportOwnerKey(
                scope = scope,
                identity = identity,
                source = PlatformImportSource.ASSISTANT,
                entryConversationId = conversationId,
            )
            val ownerMatches = owner.scope == scope && owner.identity == identity &&
                scope.serverBaseUrl.trimEnd('/') == identity.baseUrl.trimEnd('/') &&
                (owner.source != PlatformImportSource.ASSISTANT || owner.entryConversationId == conversationId)
            requestOwner = owner.takeIf { ownerMatches && api.isCurrent(identity) }
        } catch (e: CancellationException) {
            throw e
        } catch (e: AuthExpiredException) {
            requestOwner = null
            onAuthExpired()
        } catch (_: Exception) {
            requestOwner = null
        }
    }

    fun beginRequest(lane: String): PlatformImportRequestTicket? {
        val owner = requestOwner ?: return null
        if (!api.isCurrent(owner.identity) || owner != requestOwner) return null
        return gate.begin(lane, owner, conversationId)
    }

    fun acceptsRequest(ticket: PlatformImportRequestTicket): Boolean {
        val owner = requestOwner ?: return false
        return owner == ticket.owner && conversationId == ticket.conversationId &&
            api.isCurrent(owner.identity) && gate.accepts(ticket, owner, conversationId)
    }

    // Local invalidation on any user modification
    fun invalidateLocalReview() {
        reviewResponse = null
    }

    // Load full batch data (all pages bounded up to 500)
    suspend fun loadFullBatch(targetBatchId: String, attempt: Int = 1) {
        val ticket = beginRequest("batch-load:$targetBatchId") ?: return
        loading = true
        errorMessage = null
        try {
            val b = repo.getImportBatch(conversationId, targetBatchId)
            if (!acceptsRequest(ticket)) return

            // Load categories and suggestions
            val catsResp = repo.getBatchCategories(conversationId, targetBatchId, b.version)
            if (!acceptsRequest(ticket)) return

            // Check version & analysisRevision consistency between batch and categories (no blank wildcard)
            val catsConsistent = catsResp.version == b.version &&
                    catsResp.analysisRevision == b.analysis.analysisRevision &&
                    b.viewRevision.isNotBlank() &&
                    catsResp.viewRevision.isNotBlank() &&
                    catsResp.viewRevision == b.viewRevision

            if (!catsConsistent) {
                // Inconsistency detected: drop whole snapshot and retry bounded up to 2 times
                if (attempt <= 2) {
                    delay(500)
                    if (acceptsRequest(ticket)) {
                        loadFullBatch(targetBatchId, attempt + 1)
                    }
                    return
                } else {
                    errorMessage = "账单批次分析状态发生变化，请刷新重试"
                    return
                }
            }

            // Load rows up to 5 pages (<=500 items bounded)
            val pages = mutableListOf<ImportBatchRowsPage>()
            var cursor: String? = null

            while (pages.size < 5) {
                val pageResp = repo.getBatchRows(
                    conversationId = conversationId,
                    batchId = targetBatchId,
                    limit = MERGED_PAGE_SIZE,
                    cursor = cursor,
                    includeVersion = b.version,
                )
                if (!acceptsRequest(ticket)) return

                pages.add(pageResp)
                cursor = pageResp.nextCursor
                if (cursor.isNullOrBlank()) {
                    break
                }
            }

            val pageValidation = validateAndReduceBatchPages(
                declaredTotal = b.summary.totalItems,
                expectedVersion = b.version,
                expectedAnalysisRevision = b.analysis.analysisRevision,
                expectedViewRevision = b.viewRevision,
                pages = pages,
                maxPages = 5,
            )

            if (!pageValidation.isValid) {
                if (attempt <= 2) {
                    delay(500)
                    if (acceptsRequest(ticket)) {
                        loadFullBatch(targetBatchId, attempt + 1)
                    }
                    return
                } else {
                    errorMessage = pageValidation.errorMessage ?: "账单批次分页数据不完整或存在异常，请刷新重试"
                    return
                }
            }

            // ATOMIC COMMIT only after all batch, categories, and rows succeed and are consistent!
            batch = b
            analysisNeedsQuery = b.analysis.state == "unknown"
            viewRevision = b.viewRevision
            activeLeaves = catsResp.categories
            suggestions = catsResp.items
            allRows = pageValidation.loadedRows

            // If selected items not initialized yet, initialize default selection
            if (selectedItemIds.isEmpty() && userExcludedItemIds.isEmpty()) {
                val initialSelected = mutableSetOf<String>()
                allRows.forEach { row ->
                    val ai = row.ai
                    if (row.isEligible && !row.possibleDuplicate && !row.legacyLedgerMatch && !row.ignored) {
                        if (ai?.include == true || ai == null || ai.include == null) {
                            if (initialSelected.size < MERGED_MAX_BATCH_ITEMS) {
                                initialSelected.add(row.itemId)
                            }
                        }
                    }
                }
                selectedItemIds = initialSelected
            }

            // Clean up stale suggestion approvals: suggestions from previous revisions
            // must NOT carry over or auto-rebind. All suggestions must remain UNAPPROVED
            // by default until explicit user manual approval (R4/frozen protocol).
            val currentSugIds = suggestions.map { it.suggestionId }.toSet()
            val nextApproved = approvedCategories.filterKeys { it in currentSugIds }
            approvedCategories = nextApproved

            // Clean up category assignments that point to removed/stale suggestions
            val staleSugAssignments = categoryAssignments.filterValues { it is CategoryAssignment.Suggestion && it.suggestionId !in currentSugIds }
            if (staleSugAssignments.isNotEmpty()) {
                categoryAssignments = categoryAssignments.filterKeys { it !in staleSugAssignments.keys }
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: AuthExpiredException) {
            if (acceptsRequest(ticket)) {
                onAuthExpired()
            }
        } catch (e: Exception) {
            if (acceptsRequest(ticket)) {
                errorMessage = e.message ?: "读取账单批次失败"
            }
        } finally {
            if (acceptsRequest(ticket)) {
                loading = false
            }
        }
    }

    fun originalFilesMatch(snapshot: ImportBatch, documents: List<SelectedDocument>): Boolean {
        val serverFiles = snapshot.files.sortedBy { it.fileIndex }
        if (serverFiles.isEmpty() || serverFiles.size != documents.size) return false
        return serverFiles.indices.all { index ->
            val remote = serverFiles[index]
            remote.fileIndex == index && remote.sha256.isNotBlank() &&
                remote.sha256.equals(computeSha256Hex(documents[index].bytes), ignoreCase = true)
        }
    }

    LaunchedEffect(api, conversationId, batch?.batchId, batch?.version, memoryFiles, requestOwner) {
        originalFilesReady = false
        val snapshot = batch ?: return@LaunchedEffect
        val documents = memoryFiles
        val ticket = beginRequest("original-files") ?: return@LaunchedEffect
        val matches = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
            originalFilesMatch(snapshot, documents)
        }
        if (acceptsRequest(ticket) && batch?.version == snapshot.version && memoryFiles === documents) {
            originalFilesReady = matches
        }
    }

    fun startOptionalAiAnalysis() {
        val snapshot = batch ?: return
        val documents = memoryFiles
        val ticket = beginRequest("optional-ai") ?: return
        if (!acceptsRequest(ticket) || !canTriggerOptionalAiAnalysis(
                analysisState = snapshot.analysis.state,
                batchState = snapshot.status,
                hasMemoryFiles = documents.isNotEmpty() && snapshot.files.size == documents.size,
                providerEnabled = providerReady,
            ) || snapshot.status !in setOf("prepared", "reviewed")
        ) return

        scope.launch {
            if (!acceptsRequest(ticket)) return@launch
            busy = true
            var analysisMayHaveBeenSent = false
            try {
                val originalsMatch = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                    originalFilesMatch(snapshot, documents)
                }
                if (!acceptsRequest(ticket) || memoryFiles !== documents || batch?.version != snapshot.version) return@launch
                if (!originalsMatch) {
                    errorMessage = "内存原件与服务器批次摘要不匹配；请重新匹配原文件后再启动 AI。"
                    return@launch
                }

                val config = repo.providerConfig()
                if (!acceptsRequest(ticket)) return@launch
                providerReady = config.optBoolean("configured") && config.optBoolean("enabled")
                providerStatusKnown = true
                providerStatusMessage = if (providerReady) null else "AI Provider 尚未配置或未启用；仍可继续人工核对。"
                if (!providerReady) {
                    errorMessage = providerStatusMessage
                    return@launch
                }

                val latest = repo.getImportBatch(conversationId, batchId)
                if (!acceptsRequest(ticket)) return@launch
                val latestOriginalsMatch = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                    originalFilesMatch(latest, documents)
                }
                if (!acceptsRequest(ticket)) return@launch
                batch = latest
                originalFilesReady = latestOriginalsMatch
                if (!canTriggerOptionalAiAnalysis(
                        analysisState = latest.analysis.state,
                        batchState = latest.status,
                        hasMemoryFiles = latestOriginalsMatch,
                        providerEnabled = providerReady,
                    ) || latest.status !in setOf("prepared", "reviewed")
                ) {
                    analysisNeedsQuery = latest.analysis.state == "unknown"
                    noticeMessage = if (analysisNeedsQuery) {
                        "分析状态未知；已查询批次状态，请勿重复启动 AI。"
                    } else {
                        "批次状态已变化；已重新读取，仍可继续人工核对。"
                    }
                    return@launch
                }

                val clientRequestId = UUID.randomUUID().toString()
                val metadata = BatchMutationMetadata(
                    conversationId = conversationId,
                    batchId = batchId,
                    kind = BatchMutationKind.ANALYSE,
                    clientRequestId = clientRequestId,
                    expectedVersion = latest.version,
                    analysisRevision = latest.analysis.analysisRevision,
                    targetFileIndex = null,
                    files = latest.files.map {
                        BatchFileFingerprint(it.fileIndex, it.fileName, it.sha256)
                    },
                )
                val ownerScope = requestOwner?.scope
                recoveryState = AssistantBatchRecoveryState(
                    metadata = metadata,
                    state = BatchMutationState.SENDING,
                    candidateFiles = documents,
                )
                if (ownerScope != null) {
                    try {
                        recoveryStore.record(ownerScope, metadata)
                    } catch (_: Exception) {
                        recoveryState = AssistantBatchRecoveryState(
                            metadata = metadata,
                            state = BatchMutationState.IDLE,
                            candidateFiles = documents,
                            message = "无法安全记录 AI 分析请求，已阻止发送。",
                        )
                        errorMessage = "无法安全记录 AI 分析请求，已阻止发送。"
                        return@launch
                    }
                }

                analysisMayHaveBeenSent = true
                val started = repo.analyseImportBatch(
                    conversationId = conversationId,
                    batchId = batchId,
                    clientRequestId = clientRequestId,
                    files = documents.mapIndexed { idx, doc -> idx to doc.bytes },
                )
                if (!acceptsRequest(ticket)) return@launch
                if (ownerScope != null) {
                    runCatching { recoveryStore.remove(ownerScope, metadata) }
                }
                recoveryState = AssistantBatchRecoveryState(
                    metadata = metadata,
                    state = BatchMutationState.CONFIRMED,
                    candidateFiles = documents,
                )
                analysisNeedsQuery = started.analysis.state == "unknown"
                loadFullBatch(batchId)
            } catch (e: CancellationException) {
                throw e
            } catch (e: AuthExpiredException) {
                if (acceptsRequest(ticket)) {
                    if (analysisMayHaveBeenSent) {
                        analysisNeedsQuery = true
                        recoveryState = recoveryState.copy(
                            state = BatchMutationState.UNKNOWN,
                            message = "登录过期；AI 分析结果未知，请重新登录后查询批次状态。",
                        )
                    }
                    onAuthExpired()
                }
            } catch (e: Exception) {
                if (acceptsRequest(ticket)) {
                    if (analysisMayHaveBeenSent) {
                        analysisNeedsQuery = true
                        recoveryState = recoveryState.copy(
                            state = BatchMutationState.UNKNOWN,
                            message = "AI 分析结果未知：${e.message ?: "请求未完成"}。请先查询批次状态，不要重复触发。",
                        )
                        errorMessage = "AI 分析结果待核对，请先查询批次状态，不要重复触发。"
                    } else {
                        val rejection = e.message ?: "启动 AI 分析失败"
                        recoveryState = recoveryState.copy(
                            state = BatchMutationState.REJECTED,
                            message = rejection,
                        )
                        errorMessage = "启动 AI 分析失败：$rejection"
                    }
                }
            } finally {
                if (acceptsRequest(ticket)) busy = false
            }
        }
    }

    // Initial load
    LaunchedEffect(api, conversationId, batchId, requestOwner) {
        loadFullBatch(batchId)
    }

    LaunchedEffect(api, conversationId, batchId, requestOwner) {
        val ticket = beginRequest("provider-status") ?: return@LaunchedEffect
        providerStatusKnown = false
        try {
            val config = repo.providerConfig()
            if (!acceptsRequest(ticket)) return@LaunchedEffect
            providerReady = config.optBoolean("configured") && config.optBoolean("enabled")
            providerStatusMessage = if (providerReady) null else "AI Provider 尚未配置或未启用；仍可继续人工核对。"
            providerStatusKnown = true
        } catch (e: CancellationException) {
            throw e
        } catch (e: AuthExpiredException) {
            if (acceptsRequest(ticket)) {
                providerReady = false
                providerStatusKnown = true
                providerStatusMessage = "无法读取 AI Provider 状态；仍可继续人工核对。"
                onAuthExpired()
            }
        } catch (_: Exception) {
            if (acceptsRequest(ticket)) {
                providerReady = false
                providerStatusKnown = true
                providerStatusMessage = "暂无法确认 AI Provider 配置；仍可继续人工核对。"
            }
        }
    }

    // Polling for AI analysis when running
    LaunchedEffect(api, requestOwner, conversationId, batchId, batch?.analysis?.state, batch?.analysis?.analysisRevision) {
        val currentAnalysis = batch?.analysis
        if (currentAnalysis?.state == "running") {
            val pollTicket = beginRequest("poll-analysis") ?: return@LaunchedEffect
            while (true) {
                delay(2000)
                if (!acceptsRequest(pollTicket)) break
                try {
                    val updated = repo.getImportBatch(conversationId, batchId)
                    if (!acceptsRequest(pollTicket)) break
                    batch = updated
                    if (updated.analysis.state != "running") {
                        // Analysis finished or failed, reload rows and categories atomically
                        loadFullBatch(batchId)
                        break
                    }
                } catch (e: CancellationException) {
                    throw e
                } catch (e: AuthExpiredException) {
                    if (acceptsRequest(pollTicket)) {
                        onAuthExpired()
                    }
                    break
                } catch (e: Exception) {
                    break
                }
            }
        }
    }

    // Duplicate Comparison Loader
    fun loadComparison(row: ImportBatchRow, cursor: String? = null) {
        val ticket = beginRequest("comparison") ?: return
        comparisonLoading = true
        comparisonError = null
        scope.launch {
            try {
                val page = repo.batchRowDuplicateCandidates(conversationId, batchId, row.itemId, cursor)
                if (acceptsRequest(ticket) && comparingRow?.itemId == row.itemId) {
                    comparisonPage = page
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: AuthExpiredException) {
                if (acceptsRequest(ticket) && comparingRow?.itemId == row.itemId) {
                    comparingRow = null
                    onAuthExpired()
                }
            } catch (e: Exception) {
                if (acceptsRequest(ticket) && comparingRow?.itemId == row.itemId) {
                    comparisonError = e.message ?: "读取候选重复账单失败"
                }
            } finally {
                if (acceptsRequest(ticket) && comparingRow?.itemId == row.itemId) {
                    comparisonLoading = false
                }
            }
        }
    }

    // File picker for replacing a failed file
    var targetReplaceIndex by remember { mutableIntStateOf(-1) }
    val replaceFilePicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri == null || targetReplaceIndex < 0) return@rememberLauncherForActivityResult
        val replaceIndex = targetReplaceIndex
        val ticket = beginRequest("replace-file:$replaceIndex") ?: return@rememberLauncherForActivityResult
        scope.launch {
            if (!acceptsRequest(ticket)) return@launch
            busy = true
            errorMessage = null
            try {
                val newDoc = readDocument(context, uri)
                if (!acceptsRequest(ticket) || targetReplaceIndex != replaceIndex) return@launch
                val currentFiles = memoryFiles.toMutableList()
                if (replaceIndex in currentFiles.indices) {
                    currentFiles[replaceIndex] = newDoc
                } else {
                    currentFiles.add(newDoc)
                }
                val mutation = repo.replaceBatchFile(
                    conversationId = conversationId,
                    batchId = batchId,
                    targetFileIndex = replaceIndex,
                    expectedVersion = batch?.version ?: 1L,
                    clientRequestId = UUID.randomUUID().toString(),
                    allFiles = currentFiles.map { it.name to it.bytes },
                )
                if (!acceptsRequest(ticket)) return@launch
                memoryFiles = currentFiles
                val remapped = remapBatchDrafts(selectedItemIds, userExcludedItemIds, categoryAssignments, noteOverrides, mutation)
                selectedItemIds = remapped.selected
                userExcludedItemIds = remapped.userExcluded
                categoryAssignments = remapped.assignments
                noteOverrides = remapped.notes
                invalidateLocalReview()
                noticeMessage = "文件已成功替换，版本已更新至 v${mutation.batch.version}"
                loadFullBatch(batchId)
            } catch (e: CancellationException) {
                throw e
            } catch (e: AuthExpiredException) {
                if (acceptsRequest(ticket)) {
                    onAuthExpired()
                }
            } catch (e: Exception) {
                if (acceptsRequest(ticket)) {
                    errorMessage = "替换文件失败：${e.message}"
                }
            } finally {
                if (acceptsRequest(ticket)) {
                    busy = false
                }
            }
        }
    }

    // File picker for restoring lost in-memory files (matched by SHA-256)
    val restoreMemoryPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        if (uris.isNullOrEmpty()) return@rememberLauncherForActivityResult
        val ticket = beginRequest("restore-memory") ?: return@rememberLauncherForActivityResult
        val serverFiles = batch?.files ?: emptyList()
        scope.launch {
            if (!acceptsRequest(ticket)) return@launch
            busy = true
            errorMessage = null
            try {
                val docs = readMultipleDocuments(context, uris)
                if (!acceptsRequest(ticket)) return@launch
                val matched = matchBatchOriginals(serverFiles, docs)
                if (matched != null) {
                    memoryFiles = matched
                    noticeMessage = "原文件已成功重新绑定核对！"
                } else {
                    errorMessage = "所选文件未能完全匹配批次中的 ${serverFiles.size} 个原件（需按 SHA-256 哈希一一对应）"
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: AuthExpiredException) {
                if (acceptsRequest(ticket)) onAuthExpired()
            } catch (e: Exception) {
                if (acceptsRequest(ticket)) errorMessage = "读取文件失败：${e.message}"
            } finally {
                if (acceptsRequest(ticket)) busy = false
            }
        }
    }

    // Back handling
    BackHandler(comparingRow != null || editingRow != null || showReviewModal) {
        when {
            comparingRow != null -> {
                comparingRow = null
                comparisonPage = null
            }
            editingRow != null -> editingRow = null
            showReviewModal -> showReviewModal = false
            else -> onBack()
        }
    }

    // ── Screen Rendering ────────────────────────────────────────────────────────

    if (comparingRow != null) {
        val sourceRow = comparingRow!!
        val currentAssign = categoryAssignments[sourceRow.itemId] ?: resolveInitialCategoryAssignment(sourceRow)
        val categoryName = when (currentAssign) {
            is CategoryAssignment.Existing -> activeLeaves.firstOrNull { it.id == currentAssign.categoryId }?.name ?: "已选分类"
            is CategoryAssignment.Suggestion -> approvedCategories[currentAssign.suggestionId]?.name ?: "建议分类"
            null -> "未指定"
        }
        val note = noteOverrides[sourceRow.itemId] ?: sourceRow.note

        Surface(modifier = Modifier.fillMaxSize(), color = t.bg) {
            Column(Modifier.fillMaxSize()) {
                Surface(
                    color = t.surface,
                    border = BorderStroke(1.dp, t.border.copy(alpha = 0.5f)),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        IconButton(
                            onClick = { comparingRow = null; comparisonPage = null },
                            modifier = Modifier.size(44.dp),
                        ) {
                            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回工作区", tint = t.fg)
                        }
                        Column(Modifier.weight(1f)) {
                            Text("疑似重复账单核对", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = t.fg)
                            Text("当前行：${sourceRow.note.ifBlank { sourceRow.dateLabel }} · ¥${formatYuan(sourceRow.amountCents)}", style = MaterialTheme.typography.labelSmall, color = t.muted)
                        }
                    }
                }

                Column(
                    modifier = Modifier.weight(1f).fillMaxWidth().padding(16.dp).verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    Card(
                        colors = CardDefaults.cardColors(containerColor = t.surface),
                        border = BorderStroke(1.dp, t.border.copy(alpha = 0.7f)),
                        shape = RoundedCornerShape(14.dp),
                    ) {
                        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text("当前待导入账单", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, color = t.fg)
                            Text("日期：${sourceRow.dateLabel} · 金额：¥${formatYuan(sourceRow.amountCents)} · ${if (sourceRow.type == 1) "收入" else "支出"}", style = MaterialTheme.typography.bodyMedium, color = t.fg)
                            Text("分类：$categoryName · 备注：$note", style = MaterialTheme.typography.bodySmall, color = t.muted)
                            if (sourceRow.sources.isNotEmpty()) {
                                Text("来源：${sourceRow.sources.joinToString { "${it.fileName} (第${it.sourceRow}行)" }}", style = MaterialTheme.typography.bodySmall, color = t.muted)
                            }
                        }
                    }

                    if (comparisonLoading) {
                        Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) {
                            CircularProgressIndicator()
                        }
                    } else if (comparisonError != null) {
                        Text(comparisonError!!, color = t.danger, style = MaterialTheme.typography.bodyMedium)
                        Button(onClick = { loadComparison(sourceRow) }) { Text("重试") }
                    } else if (comparisonPage != null) {
                        val page = comparisonPage!!
                        Text("账本中找到 ${page.total} 笔相似账单（同日/同类型/同金额）：", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, color = t.fg)
                        if (page.rationale.isNotBlank()) {
                            Text(page.rationale, style = MaterialTheme.typography.bodySmall, color = t.muted)
                        }
                        if (page.items.isEmpty()) {
                            Text("暂无完全重合的已入账账单记录", style = MaterialTheme.typography.bodyMedium, color = t.muted)
                        } else {
                            page.items.forEach { cand ->
                                Card(
                                    colors = CardDefaults.cardColors(containerColor = t.surface),
                                    border = BorderStroke(1.dp, t.border.copy(alpha = 0.5f)),
                                    shape = RoundedCornerShape(12.dp),
                                    modifier = Modifier.fillMaxWidth(),
                                ) {
                                    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                        Text("已入账：${cand.accountName ?: "未指定账户"} · 分类：${cand.categoryName ?: "未分类"}", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium, color = t.fg)
                                        Text("金额：¥${formatYuan(cand.amountCents)} · 备注：${cand.note}", style = MaterialTheme.typography.bodySmall, color = t.muted)
                                    }
                                }
                            }
                        }
                    }

                    Row(
                        modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        OutlinedButton(
                            onClick = {
                                val (newSel, newEx) = excludeBatchRow(sourceRow, selectedItemIds, userExcludedItemIds)
                                selectedItemIds = newSel
                                userExcludedItemIds = newEx
                                invalidateLocalReview()
                                comparingRow = null
                            },
                            modifier = Modifier.weight(1f).height(48.dp),
                            shape = RoundedCornerShape(12.dp),
                        ) {
                            Icon(Icons.Default.Close, contentDescription = null, tint = t.danger)
                            Spacer(Modifier.width(6.dp))
                            Text("暂不导入此笔", color = t.danger)
                        }

                        Button(
                            onClick = {
                                val (newSel, newEx) = reincludeBatchRow(sourceRow, selectedItemIds, userExcludedItemIds, allRows)
                                selectedItemIds = newSel
                                userExcludedItemIds = newEx
                                invalidateLocalReview()
                                comparingRow = null
                            },
                            modifier = Modifier.weight(1f).height(48.dp),
                            shape = RoundedCornerShape(12.dp),
                            enabled = sourceRow.isEligible,
                            colors = ButtonDefaults.buttonColors(containerColor = t.accent, contentColor = t.onAccent),
                        ) {
                            Icon(Icons.Default.Check, contentDescription = null)
                            Spacer(Modifier.width(6.dp))
                            Text("仍选入此笔")
                        }
                    }
                }
            }
        }
        return
    }

    if (editingRow != null) {
        val row = editingRow!!
        var currentAssign by remember(row.itemId) {
            mutableStateOf(categoryAssignments[row.itemId] ?: resolveInitialCategoryAssignment(row))
        }
        var noteDraft by remember(row.itemId) {
            mutableStateOf(noteOverrides[row.itemId] ?: row.note)
        }

        Surface(modifier = Modifier.fillMaxSize().imePadding(), color = t.bg) {
            Column(Modifier.fillMaxSize()) {
                Surface(
                    color = t.surface,
                    border = BorderStroke(1.dp, t.border.copy(alpha = 0.5f)),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        IconButton(onClick = { editingRow = null }, modifier = Modifier.size(44.dp)) {
                            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回工作区", tint = t.fg)
                        }
                        Text("编辑分类与备注", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = t.fg)
                    }
                }

                Column(
                    modifier = Modifier.weight(1f).fillMaxWidth().padding(16.dp).verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    Card(
                        shape = RoundedCornerShape(14.dp),
                        colors = CardDefaults.cardColors(containerColor = t.surface),
                        border = BorderStroke(1.dp, t.border.copy(alpha = 0.7f)),
                    ) {
                        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text(row.note.ifBlank { "未命名账单" }, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = t.fg)
                            Text("${row.dateLabel} · ${if (row.type == 1) "收入" else "支出"} · ¥${formatYuan(row.amountCents)}", style = MaterialTheme.typography.bodyMedium, color = t.muted)
                        }
                    }

                    // Approved suggestions choices for this row
                    val relevantSuggestions = suggestions.filter { it.type == row.type }
                    if (relevantSuggestions.isNotEmpty()) {
                        Card(
                            shape = RoundedCornerShape(14.dp),
                            colors = CardDefaults.cardColors(containerColor = t.surface),
                            border = BorderStroke(1.dp, t.border.copy(alpha = 0.7f)),
                        ) {
                            Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                Text("建议新分类（已批准）", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, color = t.fg)
                                relevantSuggestions.forEach { sug ->
                                    val isSelected = currentAssign is CategoryAssignment.Suggestion && (currentAssign as CategoryAssignment.Suggestion).suggestionId == sug.suggestionId
                                    Surface(
                                        modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).clickable {
                                            currentAssign = CategoryAssignment.Suggestion(sug.suggestionId)
                                        },
                                        color = if (isSelected) t.accentSubtle else Color.Transparent,
                                        border = BorderStroke(1.dp, if (isSelected) t.accent else t.border.copy(alpha = 0.4f)),
                                        shape = RoundedCornerShape(8.dp),
                                    ) {
                                        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                                            Text(sug.name, modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, color = t.fg)
                                            RadioButton(selected = isSelected, onClick = { currentAssign = CategoryAssignment.Suggestion(sug.suggestionId) })
                                        }
                                    }
                                }
                            }
                        }
                    }

                    // Active Leaf Categories
                    Card(
                        shape = RoundedCornerShape(14.dp),
                        colors = CardDefaults.cardColors(containerColor = t.surface),
                        border = BorderStroke(1.dp, t.border.copy(alpha = 0.7f)),
                    ) {
                        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text("选择账本已有分类（${if (row.type == 1) "收入" else "支出"}）", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, color = t.fg)
                            val leaves = activeLeaves.filter { it.type == row.type }
                            leaves.forEach { cat ->
                                val isSelected = currentAssign is CategoryAssignment.Existing && (currentAssign as CategoryAssignment.Existing).categoryId == cat.id
                                Surface(
                                    modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).clickable {
                                        currentAssign = CategoryAssignment.Existing(cat.id)
                                    },
                                    color = if (isSelected) t.accentSubtle else Color.Transparent,
                                    border = BorderStroke(1.dp, if (isSelected) t.accent else t.border.copy(alpha = 0.4f)),
                                    shape = RoundedCornerShape(8.dp),
                                ) {
                                    Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                                        FinanceCategoryIcon(categoryName = cat.name, size = 26.dp, iconSize = 14.dp)
                                        Spacer(Modifier.width(10.dp))
                                        Text(cat.name, modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, color = t.fg)
                                        RadioButton(selected = isSelected, onClick = { currentAssign = CategoryAssignment.Existing(cat.id) })
                                    }
                                }
                            }
                        }
                    }

                    // Note override field
                    Card(
                        shape = RoundedCornerShape(14.dp),
                        colors = CardDefaults.cardColors(containerColor = t.surface),
                        border = BorderStroke(1.dp, t.border.copy(alpha = 0.7f)),
                    ) {
                        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text("审核备注（空表示清空来源备注，最多200字）", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, color = t.fg)
                            OutlinedTextField(
                                value = noteDraft,
                                onValueChange = { noteDraft = it },
                                placeholder = { Text("清空后将保存为空备注") },
                                modifier = Modifier.fillMaxWidth(),
                                isError = noteDraft.length > 200,
                            )
                            Text("${noteDraft.length}/200", style = MaterialTheme.typography.labelSmall, color = if (noteDraft.length > 200) t.danger else t.muted, modifier = Modifier.align(Alignment.End))
                        }
                    }

                    // Original per-source notes preserved by the server
                    if (row.noteAlternatives.isNotEmpty()) {
                        Card(
                            shape = RoundedCornerShape(14.dp),
                            colors = CardDefaults.cardColors(containerColor = t.surface),
                            border = BorderStroke(1.dp, t.border.copy(alpha = 0.7f)),
                        ) {
                            Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                Text("不同来源原备注", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, color = t.fg)
                                Text(
                                    "以下为各来源文件保存的原始备注，可直接采用；空备注会覆盖为真正空值，不回退主备注。",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = t.muted,
                                )
                                row.noteAlternatives.forEach { alt ->
                                    Surface(
                                        modifier = Modifier.fillMaxWidth(),
                                        color = t.bg,
                                        border = BorderStroke(1.dp, t.border.copy(alpha = 0.4f)),
                                        shape = RoundedCornerShape(8.dp),
                                    ) {
                                        Row(Modifier.padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
                                            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                                Text(alt.fileName, style = MaterialTheme.typography.labelSmall, color = t.muted)
                                                Text(
                                                    if (alt.note.isBlank()) "(原备注为空)" else alt.note,
                                                    style = MaterialTheme.typography.bodyMedium,
                                                    color = t.fg,
                                                )
                                            }
                                            TextButton(
                                                onClick = {
                                                    noteDraft = alt.note
                                                    noteOverrides = noteOverrides + (row.itemId to alt.note)
                                                    invalidateLocalReview()
                                                },
                                            ) {
                                                Text("采用此备注")
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }

                    Button(
                        onClick = {
                            if (currentAssign != null) {
                                categoryAssignments = categoryAssignments + (row.itemId to currentAssign!!)
                            }
                            noteOverrides = noteOverrides + (row.itemId to noteDraft)
                            invalidateLocalReview()
                            editingRow = null
                        },
                        enabled = currentAssign != null && noteDraft.length <= 200,
                        modifier = Modifier.fillMaxWidth().height(48.dp),
                        shape = RoundedCornerShape(12.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = t.accent, contentColor = t.onAccent),
                    ) {
                        Text("保存修改", fontWeight = FontWeight.Bold)
                    }
                }
            }
        }
        return
    }

    // ── Main Workspace List ─────────────────────────────────────────────────────

    val currentBatch = batch
    val knownBatchStatuses = setOf("prepared", "reviewed", "confirmed", "cancelled", "expired", "failed", "draft", "analysing", "ready", "confirming")
    val unknownBatchState = currentBatch != null && currentBatch.status !in knownBatchStatuses
    val pending = currentBatch?.status == "prepared" || currentBatch?.status == "reviewed"
    val hasFailedFiles = currentBatch?.files?.any { it.parseStatus == "failed" } == true
    val visibleRows = remember(allRows, query, filter, selectedItemIds, userExcludedItemIds, categoryAssignments, approvedCategories, activeLeaves) {
        filterBatchRows(
            allRows,
            query,
            filter,
            selectedItemIds,
            userExcludedItemIds,
            assignments = categoryAssignments,
            approvedCategories = approvedCategories,
            activeCategoryIds = activeLeaves.map { it.id }.toSet(),
        )
    }

    Surface(modifier = Modifier.fillMaxSize(), color = t.bg) {
        Column(Modifier.fillMaxSize()) {
            // Header Top Bar
            Surface(
                color = t.surface,
                border = BorderStroke(1.dp, t.border.copy(alpha = 0.5f)),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    IconButton(onClick = onBack, modifier = Modifier.size(44.dp)) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回对话", tint = t.fg)
                    }
                    Column(Modifier.weight(1f)) {
                        Text("合并账单导入与核对", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = t.fg)
                        Text(
                            "批次 v${currentBatch?.version ?: 1} · 共 ${allRows.size} 条流水 · 已选 ${selectedItemIds.size} 笔",
                            style = MaterialTheme.typography.labelSmall,
                            color = t.muted,
                        )
                    }
                    IconButton(
                        onClick = { scope.launch { loadFullBatch(batchId) } },
                        enabled = !busy && !loading,
                    ) {
                        Icon(Icons.Default.Refresh, contentDescription = "刷新批次", tint = t.fg)
                    }
                }
            }

            // Error / Notice Banners
            if (errorMessage != null) {
                Surface(
                    color = MaterialTheme.colorScheme.errorContainer,
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
                    shape = RoundedCornerShape(8.dp),
                ) {
                    Row(Modifier.padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.Warning, contentDescription = null, tint = MaterialTheme.colorScheme.error)
                        Spacer(Modifier.width(8.dp))
                        Text(errorMessage!!, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onErrorContainer, modifier = Modifier.weight(1f))
                    }
                }
            }

            if (noticeMessage != null) {
                Surface(
                    color = t.accentSubtle,
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
                    shape = RoundedCornerShape(8.dp),
                ) {
                    Row(Modifier.padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.Info, contentDescription = null, tint = t.accent)
                        Spacer(Modifier.width(8.dp))
                        Text(noticeMessage!!, style = MaterialTheme.typography.bodySmall, color = t.fg, modifier = Modifier.weight(1f))
                    }
                }
            }

            // Failed files warning banner
            if (hasFailedFiles) {
                val failedFiles = currentBatch?.files?.filter { it.parseStatus == "failed" } ?: emptyList()
                Surface(
                    color = Color(0xFFFEE2E2),
                    border = BorderStroke(1.dp, Color(0xFFFCA5A5)),
                    shape = RoundedCornerShape(10.dp),
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
                ) {
                    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Default.Warning, contentDescription = null, tint = Color(0xFFDC2626))
                            Spacer(Modifier.width(6.dp))
                            Text("存在解析失败的文件（阻断入账确认）", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, color = Color(0xFF991B1B))
                        }
                        failedFiles.forEach { f ->
                            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                                Text("「${f.fileName}」: ${f.error ?: "格式解析失败"}", style = MaterialTheme.typography.bodySmall, color = Color(0xFF991B1B), modifier = Modifier.weight(1f))
                                TextButton(
                                    onClick = {
                                        targetReplaceIndex = f.fileIndex
                                        replaceFilePicker.launch("*/*")
                                    },
                                    enabled = !busy,
                                ) {
                                    Text("替换", color = Color(0xFFB91C1C), style = MaterialTheme.typography.labelSmall)
                                }
                                TextButton(
                                    onClick = {
                                        val ticket = beginRequest("remove-file") ?: return@TextButton
                                        scope.launch {
                                            busy = true
                                            errorMessage = null
                                            try {
                                                val remaining = memoryFiles.filterIndexed { idx, _ -> idx != f.fileIndex }
                                                val mutation = repo.removeBatchFile(
                                                    conversationId = conversationId,
                                                    batchId = batchId,
                                                    targetFileIndex = f.fileIndex,
                                                    expectedVersion = currentBatch?.version ?: 1L,
                                                    clientRequestId = UUID.randomUUID().toString(),
                                                    remainingFiles = remaining.map { it.name to it.bytes },
                                                )
                                                if (!acceptsRequest(ticket)) return@launch
                                                memoryFiles = remaining
                                                val remapped = remapBatchDrafts(selectedItemIds, userExcludedItemIds, categoryAssignments, noteOverrides, mutation)
                                                selectedItemIds = remapped.selected
                                                userExcludedItemIds = remapped.userExcluded
                                                categoryAssignments = remapped.assignments
                                                noteOverrides = remapped.notes
                                                invalidateLocalReview()
                                                noticeMessage = "已移除失败文件「${f.fileName}」"
                                                loadFullBatch(batchId)
                                            } catch (e: CancellationException) {
                                                throw e
                                            } catch (e: AuthExpiredException) {
                                                if (acceptsRequest(ticket)) {
                                                    onAuthExpired()
                                                }
                                            } catch (e: Exception) {
                                                if (acceptsRequest(ticket)) {
                                                    errorMessage = "移除失败文件失败：${e.message}"
                                                }
                                            } finally {
                                                if (acceptsRequest(ticket)) {
                                                    busy = false
                                                }
                                            }
                                        }
                                    },
                                    enabled = !busy && (currentBatch?.files?.size ?: 0) > 1,
                                ) {
                                    Text("移除", color = Color(0xFFB91C1C), style = MaterialTheme.typography.labelSmall)
                                }
                            }
                        }
                    }
                }
            }

            // Memory files lost notice (process death recovery)
            if (filesMismatch && pending) {
                Surface(
                    color = Color(0xFFFEF3C7),
                    border = BorderStroke(1.dp, Color(0xFFFDE68A)),
                    shape = RoundedCornerShape(10.dp),
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
                ) {
                    Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.Info, contentDescription = null, tint = Color(0xFFD97706))
                        Spacer(Modifier.width(8.dp))
                        Column(Modifier.weight(1f)) {
                            Text("内存中的原始账单文件已释放", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, color = Color(0xFF92400E))
                            Text("最终确认入账需重新校验原件摘要，请重新选择原文件：", style = MaterialTheme.typography.bodySmall, color = Color(0xFF92400E))
                        }
                        Button(
                            onClick = { restoreMemoryPicker.launch(arrayOf("*/*")) },
                            shape = RoundedCornerShape(8.dp),
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFD97706)),
                        ) {
                            Text("匹配原件")
                        }
                    }
                }
            }

            // AI Status & Suggestions Banner
            val aiState = currentBatch?.analysis?.state ?: "idle"
            if (unknownBatchState) {
                Surface(
                    color = Color(0xFFFEF3C7),
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
                    shape = RoundedCornerShape(10.dp),
                ) {
                    Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text("批次状态未知；先查询服务端状态，不会自动重试确认或AI操作。", style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
                        TextButton(onClick = { scope.launch { loadFullBatch(batchId) } }, enabled = !busy) {
                            Text("查询状态")
                        }
                    }
                }
            } else if (aiState == "running") {
                Surface(
                    color = t.accentSubtle,
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
                    shape = RoundedCornerShape(10.dp),
                ) {
                    Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                        Spacer(Modifier.width(10.dp))
                        Text("AI 正在分片分析账单分类... 离开页面不会中断服务端分析", style = MaterialTheme.typography.bodySmall, color = t.fg, modifier = Modifier.weight(1f))
                    }
                }
            } else if (analysisNeedsQuery || aiState == "unknown" || aiState !in setOf("idle", "running", "complete", "failed")) {
                Surface(
                    color = Color(0xFFFEF3C7),
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
                    shape = RoundedCornerShape(10.dp),
                ) {
                    Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.Info, contentDescription = null, tint = Color(0xFFD97706))
                        Spacer(Modifier.width(8.dp))
                        Text("AI 分析结果未知；先查询批次状态，不会自动重试或再次调用模型。", style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
                        TextButton(onClick = { scope.launch { loadFullBatch(batchId) } }, enabled = !busy) {
                            Text("查询状态")
                        }
                    }
                }
            } else if (aiState == "idle" && !analysisNeedsQuery && pending &&
                canTriggerOptionalAiAnalysis(aiState, currentBatch?.status, originalFilesReady, providerEnabled = providerReady)
            ) {
                Surface(
                    color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
                    shape = RoundedCornerShape(10.dp),
                ) {
                    Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text("当前为人工核对模式", style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.SemiBold)
                            Text("如需智能推荐分类，可按需启动 AI 整理", style = MaterialTheme.typography.labelSmall, color = t.muted)
                        }
                        OutlinedButton(
                            onClick = { startOptionalAiAnalysis() },
                            enabled = !busy,
                        ) {
                            Text("AI 整理（可选）")
                        }
                    }
                }
            } else if (aiState == "idle" && pending) {
                Surface(
                    color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
                    shape = RoundedCornerShape(10.dp),
                ) {
                    Column(Modifier.padding(12.dp)) {
                        Text("当前为人工核对模式", style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.SemiBold)
                        Text(
                            providerStatusMessage ?: if (!providerStatusKnown) "正在读取 AI Provider 状态；人工核对不受影响。" else "当前批次缺少可匹配的原始文件；可继续人工核对。",
                            style = MaterialTheme.typography.labelSmall,
                            color = t.muted,
                        )
                    }
                }
            } else if (aiState == "failed") {
                Surface(
                    color = Color(0xFFFEF2F2),
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
                    shape = RoundedCornerShape(10.dp),
                ) {
                    Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.Info, contentDescription = null, tint = Color(0xFFDC2626))
                        Spacer(Modifier.width(8.dp))
                        Column(Modifier.weight(1f)) {
                            Text("AI 分析未完全成功：${currentBatch?.analysis?.message ?: "部分分片失败"}", style = MaterialTheme.typography.bodySmall, color = Color(0xFF991B1B))
                            Text("您仍可继续手动分配分类完成入账", style = MaterialTheme.typography.labelSmall, color = Color(0xFF991B1B))
                            if (!providerReady) {
                                Text(providerStatusMessage ?: "正在读取 AI Provider 状态；人工核对不受影响。", style = MaterialTheme.typography.labelSmall, color = Color(0xFF991B1B))
                            }
                        }
                        if (pending && !analysisNeedsQuery && providerReady &&
                            canTriggerOptionalAiAnalysis("failed", currentBatch?.status, originalFilesReady, providerEnabled = providerReady)
                        ) {
                            TextButton(
                                onClick = { startOptionalAiAnalysis() },
                                enabled = !busy,
                            ) {
                                Text("重试分析")
                            }
                        }
                    }
                }
            }

            // Filter Tabs Row
            val filterOptions = listOf("待核对", "全部", "已选入", "未选", "暂不导入", "疑似重复", "事实冲突", "规则排除")
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                filterOptions.forEach { opt ->
                    FilterChip(
                        selected = filter == opt,
                        onClick = { filter = opt },
                        label = { Text(opt, style = MaterialTheme.typography.labelSmall) },
                        colors = FilterChipDefaults.filterChipColors(
                            selectedContainerColor = t.accent,
                            selectedLabelColor = t.onAccent,
                        ),
                    )
                }
            }

            // Quick Selection Action Row
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 2.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(
                        "显示 ${visibleRows.size} 条 · 已选入 ${selectedItemIds.size} / 500",
                        style = MaterialTheme.typography.labelSmall,
                        color = t.muted,
                    )
                    if (filter == "待核对" && visibleRows.isEmpty() && allRows.isNotEmpty()) {
                        TextButton(
                            onClick = { filter = "全部" },
                            contentPadding = PaddingValues(horizontal = 4.dp, vertical = 0.dp),
                        ) {
                            Text("查看全部 ${allRows.size} 条", style = MaterialTheme.typography.labelSmall)
                        }
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    TextButton(
                        onClick = {
                            val eligibleAll = allRows.filter { it.isEligible }.map { it.itemId }.take(MERGED_MAX_BATCH_ITEMS).toSet()
                            selectedItemIds = eligibleAll
                            userExcludedItemIds = emptySet()
                            invalidateLocalReview()
                        },
                        enabled = pending && !busy,
                        contentPadding = PaddingValues(horizontal = 6.dp, vertical = 2.dp),
                    ) {
                        Text("全选有效", style = MaterialTheme.typography.labelSmall)
                    }
                    TextButton(
                        onClick = {
                            userExcludedItemIds = userExcludedItemIds + selectedItemIds
                            selectedItemIds = emptySet()
                            invalidateLocalReview()
                        },
                        enabled = pending && !busy && selectedItemIds.isNotEmpty(),
                        contentPadding = PaddingValues(horizontal = 6.dp, vertical = 2.dp),
                    ) {
                        Text("全部不选", style = MaterialTheme.typography.labelSmall, color = t.danger)
                    }
                }
            }

            // Bounded Row List
            if (loading) {
                Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
            } else {
                LazyColumn(
                    modifier = Modifier.weight(1f).fillMaxWidth(),
                    state = listState,
                    contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    // New Category Suggestions Card Section (if any suggestions exist)
                    if (suggestions.isNotEmpty()) {
                        item(key = "suggestions-header") {
                            Card(
                                shape = RoundedCornerShape(14.dp),
                                colors = CardDefaults.cardColors(containerColor = t.surface),
                                border = BorderStroke(1.dp, t.border.copy(alpha = 0.8f)),
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Icon(Icons.Default.AutoAwesome, contentDescription = null, tint = t.accent, modifier = Modifier.size(18.dp))
                                        Spacer(Modifier.width(6.dp))
                                        Text("新分类建议审核 (${suggestions.size} 项)", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, color = t.fg)
                                    }
                                    Text("仅在确认入账时，被实际勾选账单所引用的已批准建议才会创建；未引用或未批准的不会创建。", style = MaterialTheme.typography.bodySmall, color = t.muted)

                                    suggestions.forEach { sug ->
                                        val approved = approvedCategories[sug.suggestionId]
                                        val selectedUsingCount = selectedItemIds.count { itemId ->
                                            val a = categoryAssignments[itemId] ?: resolveInitialCategoryAssignment(allRows.firstOrNull { it.itemId == itemId } ?: return@count false)
                                            a is CategoryAssignment.Suggestion && a.suggestionId == sug.suggestionId
                                        }
                                        val leafCandidates = sug.candidates.filter { it.isLeaf }

                                        Surface(
                                            color = if (approved != null) t.accentSubtle.copy(alpha = 0.4f) else Color.Transparent,
                                            border = BorderStroke(1.dp, if (approved != null) t.accent else t.border.copy(alpha = 0.5f)),
                                            shape = RoundedCornerShape(8.dp),
                                            modifier = Modifier.fillMaxWidth(),
                                        ) {
                                            Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                                                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                                        Text("「${sug.name}」 (${if (sug.type == 1) "收入" else "支出"})", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, color = t.fg)
                                                        Text(
                                                            "关联 ${sug.relatedItemCount} 笔流水 (已选入 $selectedUsingCount 笔) · 来源: ${if (sug.origin == "ai") "AI分析" else "其他兜底"}",
                                                            style = MaterialTheme.typography.labelSmall,
                                                            color = t.muted,
                                                        )
                                                        if (leafCandidates.size == 1 && approved == null) {
                                                            Text(
                                                                "可复用现有分类: 「${leafCandidates[0].name}」",
                                                                style = MaterialTheme.typography.labelSmall,
                                                                color = t.muted,
                                                            )
                                                        } else if (leafCandidates.size > 1 && approved == null) {
                                                            Text(
                                                                "匹配到 ${leafCandidates.size} 个同名/同类型候选分类，需明确选择",
                                                                style = MaterialTheme.typography.labelSmall,
                                                                color = Color(0xFFD97706),
                                                            )
                                                        }
                                                        if (approved != null) {
                                                            val reuseName = if (approved.reuseCategoryId != null) {
                                                                activeLeaves.firstOrNull { it.id == approved.reuseCategoryId }?.name
                                                                    ?: sug.candidates.firstOrNull { it.categoryId == approved.reuseCategoryId }?.name
                                                                    ?: approved.name
                                                            } else null
                                                            Text(
                                                                "状态: 已批准${if (reuseName != null) "（复用现有类「$reuseName」）" else "（新建为「${approved.name}」）"}",
                                                                style = MaterialTheme.typography.labelSmall,
                                                                color = t.accent,
                                                            )
                                                        } else {
                                                            Text("状态: 未批准（入账不会创建）", style = MaterialTheme.typography.labelSmall, color = t.danger)
                                                        }
                                                    }
                                                    if (approved != null) {
                                                        OutlinedButton(
                                                            onClick = {
                                                                approvedCategories = approvedCategories - sug.suggestionId
                                                                invalidateLocalReview()
                                                            },
                                                            contentPadding = PaddingValues(horizontal = 10.dp, vertical = 4.dp),
                                                        ) {
                                                            Text("撤回", style = MaterialTheme.typography.labelSmall)
                                                        }
                                                    }
                                                }

                                                if (approved == null) {
                                                    Row(
                                                        modifier = Modifier.fillMaxWidth(),
                                                        horizontalArrangement = Arrangement.End,
                                                        verticalAlignment = Alignment.CenterVertically,
                                                    ) {
                                                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                                            if (leafCandidates.size > 1) {
                                                                OutlinedButton(
                                                                    onClick = { candidatePickerSuggestion = sug },
                                                                    contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp),
                                                                ) {
                                                                    Text("选择复用候选...", style = MaterialTheme.typography.labelSmall)
                                                                }
                                                            } else if (leafCandidates.size == 1) {
                                                                val cand = leafCandidates[0]
                                                                OutlinedButton(
                                                                    onClick = {
                                                                        approvedCategories = approvedCategories + (sug.suggestionId to ApprovedCategory(
                                                                            suggestionId = sug.suggestionId,
                                                                            resolution = "create",
                                                                            reuseCategoryId = cand.categoryId,
                                                                            name = cand.name,
                                                                            type = cand.type,
                                                                            parentId = cand.parentId,
                                                                        ))
                                                                        invalidateLocalReview()
                                                                    },
                                                                    contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp),
                                                                ) {
                                                                    Text("复用「${cand.name}」", style = MaterialTheme.typography.labelSmall)
                                                                }
                                                            }

                                                            OutlinedButton(
                                                                onClick = {
                                                                    proposalNewName = sug.name
                                                                    renameProposalSuggestion = sug
                                                                },
                                                                contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp),
                                                            ) {
                                                                Text("改名新建", style = MaterialTheme.typography.labelSmall)
                                                            }

                                                            Button(
                                                                onClick = {
                                                                    approvedCategories = approvedCategories + (sug.suggestionId to ApprovedCategory(
                                                                        suggestionId = sug.suggestionId,
                                                                        resolution = "create",
                                                                        reuseCategoryId = null,
                                                                        name = sug.name,
                                                                        type = sug.type,
                                                                        parentId = sug.parentId,
                                                                    ))
                                                                    invalidateLocalReview()
                                                                },
                                                                contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp),
                                                            ) {
                                                                Text("新建", style = MaterialTheme.typography.labelSmall)
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }

                    // Rows Items
                    items(visibleRows, key = { it.itemId }) { row ->
                        val isSelected = row.itemId in selectedItemIds
                        val isUserExcluded = row.itemId in userExcludedItemIds
                        val lockReason = getBatchRowLockReason(row)
                        val statusText = getBatchRowStatusText(row, isSelected, isUserExcluded)

                        val currentAssign = categoryAssignments[row.itemId] ?: resolveInitialCategoryAssignment(row)
                        val categoryName = when (currentAssign) {
                            is CategoryAssignment.Existing -> activeLeaves.firstOrNull { it.id == currentAssign.categoryId }?.name ?: "已分配"
                            is CategoryAssignment.Suggestion -> approvedCategories[currentAssign.suggestionId]?.name ?: "建议新分类"
                            null -> "缺少分类"
                        }
                        val note = noteOverrides[row.itemId] ?: row.note

                        Card(
                            shape = RoundedCornerShape(12.dp),
                            colors = CardDefaults.cardColors(containerColor = t.surface),
                            border = BorderStroke(
                                1.dp,
                                if (isSelected) t.accent.copy(alpha = 0.8f) else t.border.copy(alpha = 0.5f),
                            ),
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Checkbox(
                                        checked = isSelected,
                                        onCheckedChange = {
                                            val (newSel, newEx) = toggleBatchRowSelection(row, selectedItemIds, userExcludedItemIds, allRows)
                                            selectedItemIds = newSel
                                            userExcludedItemIds = newEx
                                            invalidateLocalReview()
                                        },
                                        enabled = pending && !busy && lockReason == null,
                                    )
                                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                            Text(
                                                "${row.dateLabel} · ${if (row.type == 1) "收入" else "支出"}",
                                                style = MaterialTheme.typography.labelSmall,
                                                color = t.muted,
                                            )
                                            Surface(
                                                color = if (isSelected) t.accentSubtle else Color.Transparent,
                                                border = BorderStroke(0.5.dp, if (isSelected) t.accent else t.border),
                                                shape = RoundedCornerShape(4.dp),
                                            ) {
                                                Text(statusText, style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(horizontal = 4.dp, vertical = 1.dp), color = t.fg)
                                            }
                                            if (row.isRefund) {
                                                Surface(color = Color(0xFFE0F2FE), shape = RoundedCornerShape(4.dp)) {
                                                    Text("退款", style = MaterialTheme.typography.labelSmall, color = Color(0xFF0369A1), modifier = Modifier.padding(horizontal = 4.dp, vertical = 1.dp))
                                                }
                                            }
                                        }
                                        Text(note.ifBlank { "未命名账单" }, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, color = t.fg)
                                    }
                                    Text(
                                        "¥${formatYuan(row.amountCents)}",
                                        style = MaterialTheme.typography.titleMedium,
                                        fontWeight = FontWeight.Bold,
                                        color = if (row.type == 1) Color(0xFF16A34A) else t.fg,
                                    )
                                }

                                if (lockReason != null) {
                                    Text("● $lockReason", style = MaterialTheme.typography.labelSmall, color = t.danger)
                                }

                                // Category & Note Display Row
                                Row(
                                    modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(6.dp)).background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f)).padding(horizontal = 8.dp, vertical = 4.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                ) {
                                    Text("分类：$categoryName", style = MaterialTheme.typography.labelSmall, color = if (categoryName == "缺少分类") t.danger else t.fg)
                                    if (row.sources.isNotEmpty()) {
                                        Text("源自: ${row.sources.first().fileName}", style = MaterialTheme.typography.labelSmall, color = t.muted)
                                    }
                                }

                                // Action Buttons on Row
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.End,
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    if (row.possibleDuplicate || row.legacyLedgerMatch) {
                                        TextButton(
                                            onClick = {
                                                comparingRow = row
                                                loadComparison(row)
                                            },
                                            contentPadding = PaddingValues(horizontal = 6.dp, vertical = 2.dp),
                                        ) {
                                            Icon(Icons.AutoMirrored.Filled.CompareArrows, contentDescription = null, modifier = Modifier.size(16.dp))
                                            Spacer(Modifier.width(4.dp))
                                            Text("对比已有账单", style = MaterialTheme.typography.labelSmall)
                                        }
                                    }

                                    TextButton(
                                        onClick = { editingRow = row },
                                        contentPadding = PaddingValues(horizontal = 6.dp, vertical = 2.dp),
                                    ) {
                                        Icon(Icons.Default.Edit, contentDescription = null, modifier = Modifier.size(16.dp))
                                        Spacer(Modifier.width(4.dp))
                                        Text("编辑分类/备注", style = MaterialTheme.typography.labelSmall)
                                    }

                                    if (isSelected) {
                                        TextButton(
                                            onClick = {
                                                val (newSel, newEx) = excludeBatchRow(row, selectedItemIds, userExcludedItemIds)
                                                selectedItemIds = newSel
                                                userExcludedItemIds = newEx
                                                invalidateLocalReview()
                                            },
                                            contentPadding = PaddingValues(horizontal = 6.dp, vertical = 2.dp),
                                        ) {
                                            Text("暂不导入", style = MaterialTheme.typography.labelSmall, color = t.danger)
                                        }
                                    } else if (row.isEligible) {
                                        TextButton(
                                            onClick = {
                                                val (newSel, newEx) = reincludeBatchRow(row, selectedItemIds, userExcludedItemIds, allRows)
                                                selectedItemIds = newSel
                                                userExcludedItemIds = newEx
                                                invalidateLocalReview()
                                            },
                                            contentPadding = PaddingValues(horizontal = 6.dp, vertical = 2.dp),
                                        ) {
                                            Text("重新选入", style = MaterialTheme.typography.labelSmall, color = t.accent)
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // Bottom Action Dock
            Surface(
                color = t.surface,
                border = BorderStroke(1.dp, t.border.copy(alpha = 0.5f)),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    OutlinedButton(
                        onClick = {
                            val ticket = beginRequest("cancel-batch") ?: return@OutlinedButton
                            scope.launch {
                                if (!acceptsRequest(ticket)) return@launch
                                busy = true
                                errorMessage = null
                                try {
                                    val cancelled = repo.cancelImportBatch(
                                        conversationId = conversationId,
                                        batchId = batchId,
                                        expectedVersion = currentBatch?.version ?: 1L,
                                        clientRequestId = UUID.randomUUID().toString(),
                                    )
                                    if (!acceptsRequest(ticket)) return@launch
                                    batch = cancelled
                                    noticeMessage = "已取消本次账单导入（未写入任何账务）"
                                    onBack()
                                } catch (e: CancellationException) {
                                    throw e
                                } catch (e: AuthExpiredException) {
                                    if (acceptsRequest(ticket)) onAuthExpired()
                                } catch (e: Exception) {
                                    if (acceptsRequest(ticket)) errorMessage = "取消导入失败：${e.message}"
                                } finally {
                                    if (acceptsRequest(ticket)) busy = false
                                }
                            }
                        },
                        enabled = pending && !busy,
                        modifier = Modifier.weight(1f).height(48.dp),
                        shape = RoundedCornerShape(12.dp),
                    ) {
                        Text("取消批次", color = t.danger)
                    }

                    Button(
                        onClick = {
                            val activeLeafIds = activeLeaves.map { it.id }.toSet()
                            val approvedSugIds = approvedCategories.keys.toSet()
                            val validationError = validateBatchForReview(
                                selectedIds = selectedItemIds,
                                rows = allRows,
                                assignments = categoryAssignments,
                                approvedSuggestionIds = approvedSugIds,
                                activeLeafCategoryIds = activeLeafIds,
                            )
                            if (validationError != null) {
                                errorMessage = validationError
                                return@Button
                            }

                            // Build explicit assignment for EVERY selected row (no silent Other fallback)
                            val fullAssignments = mutableMapOf<String, CategoryAssignment>()
                            for (id in selectedItemIds) {
                                val row = allRows.firstOrNull { it.itemId == id } ?: continue
                                val a = categoryAssignments[id] ?: resolveInitialCategoryAssignment(row)
                                if (a != null) fullAssignments[id] = a
                            }

                            // Request review from server
                            val ticket = beginRequest("review") ?: return@Button
                            scope.launch {
                                if (!acceptsRequest(ticket)) return@launch
                                busy = true
                                errorMessage = null
                                try {
                                    val currentVersion = currentBatch?.version ?: 1L
                                    val currentAnalysisRev = currentBatch?.analysis?.analysisRevision ?: 0L

                                    // Build conflict decisions
                                    val conflictDecisionsList = mutableListOf<ConflictDecision>()
                                    val conflictGroups = allRows.filter { it.conflictGroup != null && it.conflictKind == "fact_conflict" }
                                        .groupBy { it.conflictGroup!! }
                                    conflictGroups.forEach { (group, groupRows) ->
                                        val chosen = groupRows.firstOrNull { it.itemId in selectedItemIds }
                                        conflictDecisionsList.add(ConflictDecision(group, chosen?.itemId))
                                    }

                                    val resp = repo.reviewImportBatch(
                                        conversationId = conversationId,
                                        batchId = batchId,
                                        version = currentVersion,
                                        analysisRevision = currentAnalysisRev,
                                        viewRevision = viewRevision,
                                        selectedItemIds = selectedItemIds.toList(),
                                        categoryAssignments = fullAssignments,
                                        noteOverrides = noteOverrides,
                                        approvedCategories = approvedCategories.values.toList(),
                                        conflictDecisions = conflictDecisionsList,
                                    )
                                    if (!acceptsRequest(ticket)) return@launch
                                    reviewResponse = resp
                                    showReviewModal = true
                                } catch (e: CancellationException) {
                                    throw e
                                } catch (e: AuthExpiredException) {
                                    if (acceptsRequest(ticket)) onAuthExpired()
                                } catch (e: Exception) {
                                    if (acceptsRequest(ticket)) errorMessage = "生成审核摘要失败：${e.message}"
                                } finally {
                                    if (acceptsRequest(ticket)) busy = false
                                }
                            }
                        },
                        enabled = pending && !busy && selectedItemIds.isNotEmpty() && !hasFailedFiles,
                        modifier = Modifier.weight(2f).height(48.dp),
                        shape = RoundedCornerShape(12.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = t.accent, contentColor = t.onAccent),
                    ) {
                        if (busy) {
                            CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp, color = t.onAccent)
                        } else {
                            Text("审核并核对金额 (${selectedItemIds.size} 笔)", fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }
        }
    }

    // ── Review & Confirm Modal Bottom Sheet ──────────────────────────────────────

    if (showReviewModal && reviewResponse != null) {
        val review = reviewResponse!!
        val sum = review.summary
        ModalBottomSheet(
            onDismissRequest = { if (!busy) showReviewModal = false },
            containerColor = t.surface,
            shape = RoundedCornerShape(topStart = 20.dp, topEnd = 20.dp),
        ) {
            LazyColumn(
                modifier = Modifier
                    .fillMaxWidth()
                    .fillMaxHeight(0.88f)
                    .padding(horizontal = 20.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                item {
                    Text("确认导入并记账", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = t.fg)
                    Text("服务端权威核算汇总（客户端仅格式化展示，不重算规则）：", style = MaterialTheme.typography.bodySmall, color = t.muted)
                }

                item {
                    Card(
                        shape = RoundedCornerShape(12.dp),
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                Text("选中入账笔数", style = MaterialTheme.typography.bodyMedium, color = t.muted)
                                Text("${sum.selected} 笔", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Bold, color = t.fg)
                            }
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                Text("支出总计", style = MaterialTheme.typography.bodyMedium, color = t.muted)
                                Text("¥${formatYuan(sum.expenseCents)}", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Bold, color = t.fg)
                            }
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                Text("收入总计", style = MaterialTheme.typography.bodyMedium, color = t.muted)
                                Text("¥${formatYuan(sum.incomeCents)}", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Bold, color = Color(0xFF16A34A))
                            }
                            if (sum.refundIncomeCents > 0) {
                                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                    Text("退款入账", style = MaterialTheme.typography.bodyMedium, color = t.muted)
                                    Text("¥${formatYuan(sum.refundIncomeCents)}", style = MaterialTheme.typography.bodyMedium, color = Color(0xFF0369A1))
                                }
                            }
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                Text("金额合计", style = MaterialTheme.typography.bodyMedium, color = t.muted)
                                Text("¥${formatYuan(sum.amountCents)}", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Bold, color = t.fg)
                            }
                            val c = sum.counts
                            if (c != null) {
                                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                    Text("批次记录总数", style = MaterialTheme.typography.bodyMedium, color = t.muted)
                                    Text("${c.total} 笔", style = MaterialTheme.typography.bodyMedium, color = t.fg)
                                }
                                if (c.notSelected > 0) {
                                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                        Text("未选入笔数", style = MaterialTheme.typography.bodyMedium, color = t.muted)
                                        Text("${c.notSelected} 笔", style = MaterialTheme.typography.bodyMedium, color = t.muted)
                                    }
                                }
                                if (c.ruleIgnored > 0) {
                                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                        Text("规则忽略账单", style = MaterialTheme.typography.bodyMedium, color = t.muted)
                                        Text("${c.ruleIgnored} 笔", style = MaterialTheme.typography.bodyMedium, color = t.muted)
                                    }
                                }
                                if (c.preexisting > 0) {
                                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                        Text("账本已存在账单", style = MaterialTheme.typography.bodyMedium, color = t.muted)
                                        Text("${c.preexisting} 笔", style = MaterialTheme.typography.bodyMedium, color = t.muted)
                                    }
                                }
                                if (c.conflictRows > 0) {
                                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                        Text("冲突账单笔数", style = MaterialTheme.typography.bodyMedium, color = t.muted)
                                        Text("${c.conflictRows} 笔", style = MaterialTheme.typography.bodyMedium, color = t.danger)
                                    }
                                }
                                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                    Text("用户主动排除", style = MaterialTheme.typography.bodyMedium, color = t.muted)
                                    val userExLabel = if (c.userExcluded != null) "${c.userExcluded} 笔" else "未提供"
                                    Text(userExLabel, style = MaterialTheme.typography.bodyMedium, color = t.muted)
                                }
                            } else {
                                if (sum.excluded > 0) {
                                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                        Text("未选入/排除账单", style = MaterialTheme.typography.bodyMedium, color = t.muted)
                                        Text("${sum.excluded} 笔", style = MaterialTheme.typography.bodyMedium, color = t.muted)
                                    }
                                }
                                if (sum.existing > 0) {
                                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                        Text("账本已存在账单", style = MaterialTheme.typography.bodyMedium, color = t.muted)
                                        Text("${sum.existing} 笔", style = MaterialTheme.typography.bodyMedium, color = t.muted)
                                    }
                                }
                                if (sum.conflicts > 0) {
                                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                        Text("冲突账单笔数", style = MaterialTheme.typography.bodyMedium, color = t.muted)
                                        Text("${sum.conflicts} 笔", style = MaterialTheme.typography.bodyMedium, color = t.danger)
                                    }
                                }
                            }
                        }
                    }
                }

                // Source files breakdown
                if (sum.files.isNotEmpty()) {
                    item {
                        Card(
                            shape = RoundedCornerShape(12.dp),
                            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.35f)),
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                Text("来源文件分项 (${sum.files.size} 个文件)：", fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyMedium, color = t.fg)
                                sum.files.forEach { f ->
                                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                        Text(f.fileName, style = MaterialTheme.typography.bodySmall, color = t.muted, modifier = Modifier.weight(1f))
                                        Text("${f.selectedRows} 笔", style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Bold, color = t.fg)
                                    }
                                }
                            }
                        }
                    }
                }

                // Category plans
                item {
                    Card(
                        shape = RoundedCornerShape(12.dp),
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.35f)),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text("分类处理方案：", fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyMedium, color = t.fg)
                            if (sum.categoriesToCreate.isNotEmpty()) {
                                Text("拟新建分类 (${sum.categoriesToCreate.size} 个):", style = MaterialTheme.typography.labelSmall, color = t.accent)
                                sum.categoriesToCreate.forEach { c ->
                                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                        Text("「${c.name}」 (${if (c.type == 1) "收入" else "支出"})", style = MaterialTheme.typography.bodySmall, color = t.fg)
                                        Text("关联 ${c.selectedRows} 笔", style = MaterialTheme.typography.bodySmall, color = t.muted)
                                    }
                                }
                            } else {
                                Text("拟新建分类: 无", style = MaterialTheme.typography.bodySmall, color = t.muted)
                            }

                            if (sum.categoriesToReuse.isNotEmpty()) {
                                Text("拟复用现有分类 (${sum.categoriesToReuse.size} 个):", style = MaterialTheme.typography.labelSmall, color = Color(0xFF16A34A))
                                sum.categoriesToReuse.forEach { r ->
                                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                        Text("「${r.name}」", style = MaterialTheme.typography.bodySmall, color = t.fg)
                                        Text("关联 ${r.selectedRows} 笔", style = MaterialTheme.typography.bodySmall, color = t.muted)
                                    }
                                }
                            } else {
                                Text("拟复用现有分类: 无", style = MaterialTheme.typography.bodySmall, color = t.muted)
                            }
                        }
                    }
                }

                // Selected rows details header
                item {
                    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text("选中入账明细 (${sum.selectedRows.size} 笔)：", fontWeight = FontWeight.Bold, style = MaterialTheme.typography.bodyMedium, color = t.fg)
                        Text("滑动查看每笔账单的完整记账信息（日期/方向/金额/分类/备注）：", style = MaterialTheme.typography.labelSmall, color = t.muted)
                    }
                }

                // Selected rows list (LazyColumn items, supports up to 500 rows smoothly)
                items(sum.selectedRows, key = { it.itemId }) { r ->
                    val loadedRow = allRows.firstOrNull { it.itemId == r.itemId }
                    val date = r.dateLabel ?: loadedRow?.dateLabel ?: "未知日期"
                    val direction = if (r.type == 1) "收入" else "支出"
                    val isIncome = r.type == 1

                    val isPlannedNew = r.approvedNewCategoryName != null
                    val catName = r.approvedNewCategoryName
                        ?: r.categoryName
                        ?: if (r.categoryId != null) {
                            activeLeaves.firstOrNull { it.id == r.categoryId }?.name
                                ?: sum.categoriesToReuse.firstOrNull { it.categoryId == r.categoryId }?.name
                                ?: r.categoryId
                        } else if (r.suggestionId != null) {
                            approvedCategories[r.suggestionId]?.name
                                ?: sum.categoriesToCreate.firstOrNull { it.name.isNotBlank() }?.name
                                ?: suggestions.firstOrNull { it.suggestionId == r.suggestionId }?.name
                                ?: r.suggestionId
                        } else "未指定分类"

                    val catType = r.categoryType
                        ?: loadedRow?.let { activeLeaves.firstOrNull { c -> c.id == r.categoryId }?.type }
                    val catTypeLabel = when (catType) {
                        1 -> "收入分类"
                        0 -> "支出分类"
                        else -> null
                    }

                    // Server note takes precedence and retains exact empty string if present
                    val note = r.note
                        ?: r.resolvedNote
                        ?: noteOverrides[r.itemId]
                        ?: loadedRow?.note
                        ?: ""

                    Surface(
                        shape = RoundedCornerShape(8.dp),
                        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.25f),
                        border = BorderStroke(0.5.dp, t.border.copy(alpha = 0.3f)),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Text(date, style = MaterialTheme.typography.labelSmall, color = t.muted)
                                    Surface(
                                        color = if (isIncome) Color(0xFF16A34A).copy(alpha = 0.15f) else t.accent.copy(alpha = 0.15f),
                                        shape = RoundedCornerShape(4.dp),
                                    ) {
                                        Text(
                                            direction,
                                            style = MaterialTheme.typography.labelSmall,
                                            color = if (isIncome) Color(0xFF16A34A) else t.accent,
                                            modifier = Modifier.padding(horizontal = 4.dp, vertical = 2.dp),
                                        )
                                    }
                                    Text(
                                        "分类: $catName${if (catTypeLabel != null) " ($catTypeLabel)" else ""}",
                                        style = MaterialTheme.typography.bodySmall,
                                        fontWeight = FontWeight.SemiBold,
                                        color = t.fg,
                                    )
                                    if (isPlannedNew) {
                                        Surface(
                                            color = t.accent.copy(alpha = 0.15f),
                                            shape = RoundedCornerShape(4.dp),
                                        ) {
                                            Text(
                                                "拟新建",
                                                style = MaterialTheme.typography.labelSmall,
                                                color = t.accent,
                                                modifier = Modifier.padding(horizontal = 4.dp, vertical = 2.dp),
                                            )
                                        }
                                    }
                                }
                                Text(
                                    "${if (isIncome) "+" else "-"}¥${formatYuan(r.amountCents)}",
                                    style = MaterialTheme.typography.bodyMedium,
                                    fontWeight = FontWeight.Bold,
                                    color = if (isIncome) Color(0xFF16A34A) else t.fg,
                                )
                            }
                            if (note.isNotBlank()) {
                                Text("备注: $note", style = MaterialTheme.typography.bodySmall, color = t.muted)
                            } else {
                                Text("备注: (空备注)", style = MaterialTheme.typography.bodySmall, color = t.muted.copy(alpha = 0.6f))
                            }
                        }
                    }
                }

                item {
                    if (filesMismatch) {
                        Text("⚠️ 内存原件与服务端批次文件不匹配 (需 SHA-256 哈希完全一致)，无法确认入账。请在工作区匹配原件。", color = t.danger, style = MaterialTheme.typography.bodySmall)
                    }

                    Row(
                        modifier = Modifier.fillMaxWidth().padding(top = 8.dp, bottom = 16.dp),
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        OutlinedButton(
                            onClick = { showReviewModal = false },
                            enabled = !busy,
                            modifier = Modifier.weight(1f).height(48.dp),
                            shape = RoundedCornerShape(12.dp),
                        ) {
                            Text("返回修改")
                        }

                        Button(
                            onClick = {
                                val ticket = beginRequest("confirm") ?: return@Button
                                scope.launch {
                                    if (!acceptsRequest(ticket)) return@launch
                                    busy = true
                                    errorMessage = null
                                    try {
                                        val filesToSend = (matchedOriginals ?: memoryFiles).mapIndexed { idx, doc -> idx to doc.bytes }
                                        val confirmResult = repo.confirmImportBatch(
                                            conversationId = conversationId,
                                            batchId = batchId,
                                            reviewToken = review.reviewToken,
                                            expectedVersion = review.version,
                                            files = filesToSend,
                                        )
                                        if (!acceptsRequest(ticket)) return@launch
                                        showReviewModal = false
                                        onImportConfirmed(confirmResult)
                                    } catch (e: CancellationException) {
                                        throw e
                                    } catch (e: AuthExpiredException) {
                                        if (acceptsRequest(ticket)) onAuthExpired()
                                    } catch (e: Exception) {
                                        if (!acceptsRequest(ticket)) return@launch
                                        val recheckTicket = beginRequest("confirm-recheck") ?: return@launch
                                        try {
                                            val recheck = repo.getImportBatch(conversationId, batchId)
                                            if (!acceptsRequest(recheckTicket)) return@launch
                                            if (recheck.status == "confirmed" && recheck.result != null) {
                                                showReviewModal = false
                                                onImportConfirmed(recheck.result)
                                                return@launch
                                            }
                                            errorMessage = "确认结果尚未确认；请查询同一批次后再继续，不要重新创建批次。"
                                        } catch (e: CancellationException) {
                                            throw e
                                        } catch (e: AuthExpiredException) {
                                            if (acceptsRequest(recheckTicket)) onAuthExpired()
                                        } catch (recheckError: Exception) {
                                            if (acceptsRequest(recheckTicket)) {
                                                errorMessage = "确认结果待核对：${recheckError.message ?: e.message}。请查询同一批次，不要重复创建。"
                                            }
                                        }
                                    } finally {
                                        if (acceptsRequest(ticket)) busy = false
                                    }
                                }
                            },
                            enabled = !busy && !filesMismatch,
                            modifier = Modifier.weight(2f).height(48.dp),
                            shape = RoundedCornerShape(12.dp),
                            colors = ButtonDefaults.buttonColors(containerColor = t.accent, contentColor = t.onAccent),
                        ) {
                            if (busy) {
                                CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp, color = t.onAccent)
                            } else {
                                Text("最终确认入账", fontWeight = FontWeight.Bold)
                            }
                        }
                    }
                }
            }
        }
    }

    // ── Candidate Selection Dialog (Multiple same-name/same-type candidates) ────────

    if (candidatePickerSuggestion != null) {
        val sug = candidatePickerSuggestion!!
        val leafCandidates = sug.candidates.filter { it.isLeaf }
        AlertDialog(
            onDismissRequest = { candidatePickerSuggestion = null },
            title = { Text("选择要复用的现有分类", fontWeight = FontWeight.Bold) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("建议「${sug.name}」匹配到多个候选，请指定复用哪一个：", style = MaterialTheme.typography.bodySmall, color = t.muted)
                    leafCandidates.forEach { cand ->
                        Surface(
                            onClick = {
                                approvedCategories = approvedCategories + (sug.suggestionId to ApprovedCategory(
                                    suggestionId = sug.suggestionId,
                                    resolution = "create",
                                    reuseCategoryId = cand.categoryId,
                                    name = cand.name,
                                    type = cand.type,
                                    parentId = cand.parentId,
                                ))
                                invalidateLocalReview()
                                candidatePickerSuggestion = null
                            },
                            shape = RoundedCornerShape(8.dp),
                            color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
                            border = BorderStroke(1.dp, t.border.copy(alpha = 0.5f)),
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Column(Modifier.padding(10.dp)) {
                                Text("「${cand.name}」", fontWeight = FontWeight.Bold, color = t.fg)
                                val parentName = if (cand.parentId != null) {
                                    activeLeaves.firstOrNull { it.id == cand.parentId }?.name ?: "一级分类"
                                } else "顶级分类"
                                Text("收支类型: ${if (cand.type == 1) "收入" else "支出"} · 父级: $parentName", style = MaterialTheme.typography.labelSmall, color = t.muted)
                            }
                        }
                    }
                }
            },
            confirmButton = {},
            dismissButton = {
                TextButton(onClick = { candidatePickerSuggestion = null }) {
                    Text("取消")
                }
            },
        )
    }

    // ── Rename Proposal Dialog ────────────────────────────────────────────────────

    if (renameProposalSuggestion != null) {
        val sug = renameProposalSuggestion!!
        AlertDialog(
            onDismissRequest = { renameProposalSuggestion = null },
            title = { Text("编辑拟新建分类名称", fontWeight = FontWeight.Bold) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("建议分类原名: 「${sug.name}」 (${if (sug.type == 1) "收入" else "支出"})", style = MaterialTheme.typography.bodySmall, color = t.muted)
                    Text("收支类型与父级继承自建议（不可越级或改变类型）：", style = MaterialTheme.typography.labelSmall, color = t.muted)
                    OutlinedTextField(
                        value = proposalNewName,
                        onValueChange = { proposalNewName = it },
                        label = { Text("新分类名称") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        val trimmed = proposalNewName.trim()
                        if (trimmed.isNotBlank()) {
                            approvedCategories = approvedCategories + (sug.suggestionId to ApprovedCategory(
                                suggestionId = sug.suggestionId,
                                resolution = "create",
                                reuseCategoryId = null,
                                name = trimmed,
                                type = sug.type,
                                parentId = sug.parentId,
                            ))
                            invalidateLocalReview()
                            renameProposalSuggestion = null
                        }
                    },
                    enabled = proposalNewName.trim().isNotBlank(),
                ) {
                    Text("确认并新建")
                }
            },
            dismissButton = {
                TextButton(onClick = { renameProposalSuggestion = null }) {
                    Text("取消")
                }
            },
        )
    }
}
