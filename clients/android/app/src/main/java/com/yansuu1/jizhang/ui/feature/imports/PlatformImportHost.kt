package com.yansuu1.jizhang.ui.feature.imports

import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.UploadFile
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.yansuu1.jizhang.net.ApiClient
import com.yansuu1.jizhang.net.AuthExpiredException
import com.yansuu1.jizhang.repo.AssistantRepository
import com.yansuu1.jizhang.ui.ActiveNavigationHandlers
import com.yansuu1.jizhang.ui.FinanceCard
import com.yansuu1.jizhang.ui.SelectedDocument
import com.yansuu1.jizhang.ui.feature.assistant.AssistantBatchImportWorkspace
import com.yansuu1.jizhang.ui.feature.assistant.ImportBatchResult
import com.yansuu1.jizhang.ui.readMultipleDocuments
import com.yansuu1.jizhang.ui.validateMergedDocuments
import com.yansuu1.jizhang.ui.theme.LocalWebTokens
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import java.util.UUID

enum class PlatformImportSource {
    DATA,
    ASSISTANT,
}

data class PlatformImportEntryContext(
    val source: PlatformImportSource,
    val existingConversationId: String? = null,
)

/**
 * 统一新平台账单导入宿主 (C5 / F10 / F11)。
 *
 * 核心契约：
 * 1. 统一入口：数据管理与 AI 助手的新平台导入均复用多文件批次工作区；
 * 2. 默认纯人工流程：创建批次时 analyse = false，全程 0 次 AI 模型调用；AI 仅在工作区内显式可选；
 * 3. 选文件取消不创建空批次/空会话；
 * 4. 严格限额：1-5 个文件，单文件 <= 5MiB，总大小 <= 8MiB，超出即时拦截；
 * 5. 权威汇总确认：由工作区完成 review-confirm，确认后回调并关闭。
 */
@Composable
internal fun PlatformImportHost(
    api: ApiClient,
    entryContext: PlatformImportEntryContext,
    initialDocuments: List<SelectedDocument> = emptyList(),
    onAuthExpired: () -> Unit,
    onClose: () -> Unit,
    onImportFinished: ((ImportBatchResult) -> Unit)? = null,
    onRegisterNavigation: ((ActiveNavigationHandlers?) -> Unit)? = null,
) {
    val repo = remember(api) { AssistantRepository(api) }
    val scope = rememberCoroutineScope()
    val localContext = LocalContext.current
    val tokens = LocalWebTokens.current

    var selectedDocs by remember(api, entryContext, initialDocuments) { mutableStateOf(initialDocuments) }
    var currentOwnerKey by remember(api, entryContext) { mutableStateOf<PlatformImportOwnerKey?>(null) }
    var workspaceRef by remember(api, entryContext) { mutableStateOf<PlatformImportWorkspaceRef?>(null) }
    var pendingStart by remember(api, entryContext) { mutableStateOf<PendingPlatformImportStart?>(null) }
    var isStarting by remember { mutableStateOf(false) }
    var conversationCreationUnknown by remember(api, entryContext) { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var selectionError by remember(api, entryContext, initialDocuments) { mutableStateOf<String?>(null) }
    val requests = remember(api, entryContext) { PlatformImportRequestGate() }
    var innerNavigationHandlers by remember { mutableStateOf<ActiveNavigationHandlers?>(null) }

    DisposableEffect(innerNavigationHandlers) {
        val handlers = innerNavigationHandlers ?: ActiveNavigationHandlers(
            requestBack = { onClose() },
            requestLeave = { onAllow -> onAllow() },
        )
        onRegisterNavigation?.invoke(handlers)
        onDispose { onRegisterNavigation?.invoke(null) }
    }

    DisposableEffect(requests) {
        onDispose { requests.invalidate() }
    }

    fun acceptsHostRequest(
        ticket: PlatformImportRequestTicket,
        owner: PlatformImportOwnerKey,
        conversationId: String?,
    ): Boolean = currentOwnerKey == owner && api.isCurrent(owner.identity) &&
        requests.accepts(ticket, owner, conversationId)

    // Lint forbids reading StateFlow.value during composition; collect it as Compose state.
    val sessionExpired by api.sessionExpired.collectAsState()
    LaunchedEffect(api, entryContext, sessionExpired, initialDocuments) {
        requests.invalidate()
        try {
            if (sessionExpired) {
                currentOwnerKey = null
                workspaceRef = null
                pendingStart = null
                return@LaunchedEffect
            }
            val identity = api.captureRequestIdentity()
            val fScope = com.yansuu1.jizhang.ui.FinancialPrefs.resolveAuthenticatedScope(api)
            require(fScope.serverBaseUrl.trimEnd('/') == identity.baseUrl.trimEnd('/')) {
                "导入财务范围与网络请求服务地址不一致"
            }
            val owner = PlatformImportOwnerKey(
                scope = fScope,
                identity = identity,
                source = entryContext.source,
                entryConversationId = entryContext.existingConversationId,
            )
            if (currentOwnerKey != owner) {
                if (workspaceRef?.isCurrentFor(owner) != true) workspaceRef = null
                if (pendingStart?.matches(owner) != true) pendingStart = null
            }
            currentOwnerKey = owner.takeIf { api.isCurrent(identity) }
            selectionError = if (initialDocuments.isEmpty()) null else runCatching {
                validateMergedDocuments(initialDocuments)
            }.exceptionOrNull()?.message
        } catch (e: CancellationException) {
            throw e
        } catch (e: AuthExpiredException) {
            currentOwnerKey = null
            workspaceRef = null
            onAuthExpired()
        } catch (e: Exception) {
            currentOwnerKey = null
            workspaceRef = null
            selectionError = e.message ?: "无法确认当前导入用户，请重新登录后重试。"
        }
    }

    val filePicker = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.OpenMultipleDocuments(),
    ) { uris: List<Uri> ->
        if (uris.isEmpty()) return@rememberLauncherForActivityResult
        errorMessage = null
        if (uris.size > 5) {
            errorMessage = "单次最多支持选择 5 个账单文件 (当前选择 ${uris.size} 个)。"
            return@rememberLauncherForActivityResult
        }
        val owner = currentOwnerKey ?: return@rememberLauncherForActivityResult
        if (pendingStart != null) {
            errorMessage = "上次批次创建结果待核对；请继续重试原请求，不要更换文件。"
            return@rememberLauncherForActivityResult
        }
        val expectedConversationId = owner.entryConversationId
        val ticket = requests.begin("file-read", owner, expectedConversationId)
        scope.launch {
            try {
                val docs = readMultipleDocuments(localContext, uris)
                validateMergedDocuments(docs)
                if (!acceptsHostRequest(ticket, owner, expectedConversationId)) return@launch
                selectedDocs = docs
                selectionError = null
            } catch (e: CancellationException) {
                throw e
            } catch (e: AuthExpiredException) {
                if (acceptsHostRequest(ticket, owner, expectedConversationId)) onAuthExpired()
            } catch (e: Exception) {
                if (acceptsHostRequest(ticket, owner, expectedConversationId)) {
                    errorMessage = e.message ?: "读取文件失败，请重试。"
                }
            } finally {
                // No UI state is changed here: picker read tickets are invalidated with owner/dispose.
            }
        }
    }

    // 如果已有活跃批次且属于当前所有者，直接渲染多文件批次工作区
    if (workspaceRef != null && currentOwnerKey != null && workspaceRef!!.isCurrentFor(currentOwnerKey!!)) {
        val activeRef = workspaceRef!!
        val workspaceTicket = remember(activeRef) {
            requests.begin("workspace", activeRef.owner, activeRef.conversationId)
        }
        AssistantBatchImportWorkspace(
            conversationId = activeRef.conversationId,
            initialBatchId = activeRef.batchId,
            repo = repo,
            api = api,
            initialOwnerKey = activeRef.owner,
            initialMemoryFiles = selectedDocs,
            onAuthExpired = onAuthExpired,
            onBack = {
                if (workspaceTicket != null && acceptsHostRequest(workspaceTicket, activeRef.owner, activeRef.conversationId)) {
                    workspaceRef = null
                }
            },
            onImportConfirmed = { result ->
                if (workspaceTicket != null && acceptsHostRequest(workspaceTicket, activeRef.owner, activeRef.conversationId)) {
                    onImportFinished?.invoke(result)
                    onClose()
                }
            },
            onRegisterNavigation = { innerNavigationHandlers = it },
        )
        return
    }

    BackHandler { onClose() }

    Surface(modifier = Modifier.fillMaxSize(), color = tokens.bg) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                IconButton(onClick = onClose) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                }
                Column(Modifier.weight(1f)) {
                    Text("账单平台融合导入", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                    Text(
                        "支持 1–5 个微信/支付宝账单 · 默认人工核对",
                        style = MaterialTheme.typography.bodySmall,
                        color = tokens.muted,
                    )
                }
            }

            FinanceCard(modifier = Modifier.fillMaxWidth()) {
                Text("导入规格与限制说明", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.height(4.dp))
                Text(
                    "• 文件支持：微信支付账单 (.csv / .xlsx)、支付宝账单 (.csv)\n" +
                    "• 数量与大小：支持 1–5 个文件，单文件 ≤ 5 MiB，合并总大小 ≤ 8 MiB，整批最多 500 条\n" +
                    "• 默认无 AI 调用：解析与核对默认纯人工流程，零外部模型费用；如需 AI 整理可在工作区内按需点选\n" +
                    "• 权威核验：由服务端校验原件哈希与两阶段 reviewToken 原子入账，不产生重复账单",
                    style = MaterialTheme.typography.bodySmall,
                    color = tokens.muted,
                )
            }

            (errorMessage ?: selectionError)?.let { msg ->
                FinanceCard(modifier = Modifier.fillMaxWidth(), backgroundColor = MaterialTheme.colorScheme.errorContainer) {
                    Text(msg, color = MaterialTheme.colorScheme.onErrorContainer, style = MaterialTheme.typography.bodySmall)
                }
            }
            if (conversationCreationUnknown) {
                FinanceCard(modifier = Modifier.fillMaxWidth(), backgroundColor = MaterialTheme.colorScheme.errorContainer) {
                    Text("数据导入会话创建结果未知，服务端没有按请求键查询能力。为避免重复创建会话，已停止重试；请关闭后重新进入。", color = MaterialTheme.colorScheme.onErrorContainer, style = MaterialTheme.typography.bodySmall)
                }
            }

            FinanceCard(modifier = Modifier.fillMaxWidth()) {
                Text("选择待导入账单文件", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.height(8.dp))

                OutlinedButton(
                    onClick = { filePicker.launch(arrayOf("*/*")) },
                    modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                    enabled = !isStarting && currentOwnerKey != null && pendingStart == null,
                ) {
                    Icon(Icons.Filled.UploadFile, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text(if (selectedDocs.isEmpty()) "从手机选择账单文件 (可多选)" else "重新选择文件")
                }

                if (selectedDocs.isNotEmpty()) {
                    Spacer(Modifier.height(12.dp))
                    Text(
                        "已选择 ${selectedDocs.size} 个文件 (共 ${(selectedDocs.sumOf { it.bytes.size.toLong() } / 1024.0 / 1024.0).format(2)} MiB)：",
                        style = MaterialTheme.typography.bodySmall,
                        fontWeight = FontWeight.SemiBold,
                    )
                    Spacer(Modifier.height(6.dp))
                    selectedDocs.forEach { doc ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(vertical = 4.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween,
                        ) {
                            Row(modifier = Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Icon(Icons.Filled.Description, contentDescription = null, modifier = Modifier.size(20.dp), tint = tokens.accent)
                                Text(
                                    doc.name,
                                    style = MaterialTheme.typography.bodyMedium,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                            Text(
                                "${(doc.bytes.size / 1024.0).format(1)} KB",
                                style = MaterialTheme.typography.bodySmall,
                                color = tokens.muted,
                            )
                        }
                    }

                    Spacer(Modifier.height(12.dp))
                    Button(
                        onClick = {
                            val ownerKey = currentOwnerKey ?: return@Button
                            if (conversationCreationUnknown) return@Button
                            if (selectionError != null) {
                                errorMessage = selectionError
                                return@Button
                            }
                            val documents = selectedDocs.toList()
                            val validationError = runCatching { validateMergedDocuments(documents) }.exceptionOrNull()
                            if (validationError != null) {
                                selectionError = validationError.message ?: "所选文件不符合导入要求。"
                                return@Button
                            }
                            val previous = pendingStart
                            if (previous != null && !previous.matchesSameRequest(ownerKey, documents)) {
                                errorMessage = "批次创建结果待核对，只能使用原始文件和请求键继续。"
                                return@Button
                            }
                            val clientRequestId = previous?.clientRequestId ?: UUID.randomUUID().toString()
                            val initialConversationId = previous?.conversationId ?: ownerKey.entryConversationId
                            val start = previous ?: PendingPlatformImportStart(
                                owner = ownerKey,
                                conversationId = initialConversationId,
                                clientRequestId = clientRequestId,
                                files = documents,
                            )
                            pendingStart = start.copy(conversationId = initialConversationId, files = documents)
                            val initialTicket = requests.begin("batch-start", ownerKey, initialConversationId)
                            isStarting = true
                            errorMessage = null
                            scope.launch {
                                var activeTicket = initialTicket
                                var protocolConversationId = initialConversationId
                                fun ticketIsCurrent(): Boolean = acceptsHostRequest(activeTicket, ownerKey, protocolConversationId)
                                try {
                                    if (!ticketIsCurrent()) return@launch
                                    if (protocolConversationId == null) {
                                        val created = repo.createConversation()
                                        if (!ticketIsCurrent()) return@launch
                                        protocolConversationId = created.optString("id").takeIf { it.isNotBlank() }
                                            ?: throw IllegalStateException("服务器未返回导入会话 ID；创建结果待核对。")
                                        val latestPending = pendingStart ?: return@launch
                                        if (!latestPending.matchesSameRequest(ownerKey, documents) || latestPending.conversationId != null) return@launch
                                        pendingStart = latestPending.copy(conversationId = protocolConversationId)
                                        activeTicket = requests.begin("batch-start", ownerKey, protocolConversationId)
                                    }
                                    val convId = protocolConversationId ?: return@launch
                                    if (ownerKey.entryConversationId != null && convId != ownerKey.entryConversationId) {
                                        throw IllegalStateException("导入会话与入口对话不一致，已停止创建批次。")
                                    }
                                    if (!ticketIsCurrent()) return@launch
                                    val currentPending = pendingStart ?: return@launch
                                    if (!currentPending.matchesSameRequest(ownerKey, documents) || currentPending.conversationId != convId) return@launch
                                    val batch = repo.createImportBatch(
                                        conversationId = convId,
                                        clientRequestId = clientRequestId,
                                        files = documents.map { it.name to it.bytes },
                                        analyse = false,
                                    )
                                    if (!ticketIsCurrent()) return@launch
                                    require(batch.conversationId == convId) {
                                        "服务器返回批次与请求会话不一致。"
                                    }
                                    workspaceRef = PlatformImportWorkspaceRef(
                                        owner = ownerKey,
                                        conversationId = convId,
                                        batchId = batch.batchId,
                                    )
                                    pendingStart = null
                                    conversationCreationUnknown = false
                                } catch (e: CancellationException) {
                                    throw e
                                } catch (e: AuthExpiredException) {
                                    if (ticketIsCurrent()) onAuthExpired()
                                } catch (e: Exception) {
                                    if (ticketIsCurrent()) {
                                        if (protocolConversationId == null && ownerKey.entryConversationId == null) {
                                            conversationCreationUnknown = true
                                            errorMessage = "导入会话创建结果未知；为避免重复创建，已停止重试，请先核对服务器会话列表。"
                                        } else {
                                            errorMessage = "批次创建结果待核对；已保留原会话、请求键和文件，请继续重试原请求。${e.message.orEmpty()}"
                                        }
                                    }
                                } finally {
                                    if (ticketIsCurrent()) isStarting = false
                                }
                            }
                        },
                        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                        enabled = !isStarting && currentOwnerKey != null && selectionError == null && !conversationCreationUnknown &&
                            (pendingStart == null || pendingStart?.matchesSameRequest(currentOwnerKey!!, selectedDocs) == true),
                    ) {
                        if (isStarting) {
                            CircularProgressIndicator(modifier = Modifier.size(20.dp), color = MaterialTheme.colorScheme.onPrimary)
                            Spacer(Modifier.width(8.dp))
                            Text("正在解析账单文件…")
                        } else {
                            Text(if (pendingStart != null) "继续核对原请求" else "开始解析并核对账单 (无需 AI)")
                        }
                    }
                }
            }
        }
    }
}

private fun Double.format(digits: Int): String = String.format(java.util.Locale.US, "%.${digits}f", this)
