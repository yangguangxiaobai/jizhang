package com.yansuu1.jizhang.ui

import android.net.Uri
import com.yansuu1.jizhang.net.ApiException
import androidx.activity.compose.BackHandler
import androidx.compose.runtime.DisposableEffect
import androidx.compose.material.icons.filled.ChatBubbleOutline
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material.icons.filled.ArrowBack
import com.yansuu1.jizhang.ui.feature.assistant.*
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.animation.core.tween
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Archive
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Send
import androidx.compose.material.icons.filled.SmartToy
import androidx.compose.material.icons.filled.Warning
import com.yansuu1.jizhang.ui.ActiveNavigationHandlers
import com.yansuu1.jizhang.ui.feature.assistant.AssistantProgressDisplayState
import com.yansuu1.jizhang.ui.feature.assistant.extractSafeErrorMessage
import com.yansuu1.jizhang.ui.feature.assistant.filterVisibleAssistantMessages
import com.yansuu1.jizhang.ui.feature.assistant.formatOperationDetails
import com.yansuu1.jizhang.ui.feature.assistant.formatSafeSummaryFields
import com.yansuu1.jizhang.ui.feature.assistant.getProgressState
import com.yansuu1.jizhang.ui.feature.assistant.isProgressOnlyMessage
import com.yansuu1.jizhang.ui.feature.assistant.resolveProgressDisplayState
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.yansuu1.jizhang.net.ApiClient
import com.yansuu1.jizhang.net.AuthExpiredException
import com.yansuu1.jizhang.repo.AssistantGenerationEvent
import com.yansuu1.jizhang.repo.AssistantRepository
import com.yansuu1.jizhang.repo.Clarification
import com.yansuu1.jizhang.repo.ClarificationOption
import com.yansuu1.jizhang.repo.GenerationInput
import com.yansuu1.jizhang.repo.GenerationSnapshot
import com.yansuu1.jizhang.repo.OrganizationRepository
import com.yansuu1.jizhang.repo.extractClarification
import com.yansuu1.jizhang.ui.LocalMotionTokens
import com.yansuu1.jizhang.ui.feature.imports.PlatformImportEntryContext
import com.yansuu1.jizhang.ui.feature.imports.PlatformImportHost
import com.yansuu1.jizhang.ui.feature.imports.PlatformImportSource
import androidx.compose.foundation.background
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import com.yansuu1.jizhang.ui.theme.LocalWebTokens
import java.security.MessageDigest
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

private data class AssistantComposerDraft(
    val text: String = "",
    val attachment: SelectedDocument? = null,
    val requestId: String? = null,
)

private data class ActionConfirmationRequest(
    val conversationId: String,
    val actionId: String,
)

/**
 * Server-backed AI conversations. Message and action results are rendered only
 * from the server response; attachment bytes and unsent drafts stay in memory.
 */
@Composable
@OptIn(ExperimentalFoundationApi::class)
fun AssistantTab(
    api: ApiClient,
    onAuthExpired: () -> Unit,
    onDataChanged: () -> Unit = {},
    onSecondaryScreen: (Boolean) -> Unit = {},
    onProviderSettings: () -> Unit = {},
    onRegisterNavigation: ((ActiveNavigationHandlers?) -> Unit)? = null,
) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val repo = remember(api) { AssistantRepository(api) }
    val organizationRepo = remember(api) { OrganizationRepository(api) }
    val listState = rememberLazyListState()
    val motion = LocalMotionTokens.current

    var conversations by remember { mutableStateOf(listOf<JSONObject>()) }
    var conversationId by remember { mutableStateOf<String?>(null) }
    var messages by remember { mutableStateOf(listOf<JSONObject>()) }
    var drafts by remember { mutableStateOf(mapOf<String, AssistantComposerDraft>()) }
    var activeGenerations by remember { mutableStateOf(mapOf<String, ActiveGenerationState>()) }
    var selectedRows by remember { mutableStateOf(mapOf<String, Set<String>>()) }
    var notes by remember { mutableStateOf(mapOf<String, Map<String, String>>()) }
    var overrides by remember { mutableStateOf(mapOf<String, Map<String, String>>()) }
    var actionFiles by remember { mutableStateOf(mapOf<String, SelectedDocument>()) }
    var actionFileErrors by remember { mutableStateOf(mapOf<String, String>()) }
    var actionConversationIds by remember { mutableStateOf(mapOf<String, String>()) }
    var sendingConversationIds by remember { mutableStateOf(setOf<String>()) }
    var actionBusyIds by remember { mutableStateOf(setOf<String>()) }
    var loadedConversationIds by remember { mutableStateOf(setOf<String>()) }

    var loadingConversations by remember { mutableStateOf(true) }
    var loadingMessagesFor by remember { mutableStateOf<String?>(null) }
    var creatingConversation by remember { mutableStateOf(false) }
    var archivingConversationId by remember { mutableStateOf<String?>(null) }
    var conversationError by remember { mutableStateOf<String?>(null) }
    var providerStatus by remember { mutableStateOf("正在读取 AI 配置状态…") }
    var providerStatusError by remember { mutableStateOf(false) }
    var conversationNotices by remember { mutableStateOf(mapOf<String, String>()) }
    var actionConfirmation by remember { mutableStateOf<ActionConfirmationRequest?>(null) }
    var archiveTargetId by remember { mutableStateOf<String?>(null) }
    var expandedMenuConversationId by remember { mutableStateOf<String?>(null) }
    var attachmentPickTicket by remember { mutableStateOf<AssistantRequestTicket?>(null) }
    var confirmationPickTicket by remember { mutableStateOf<AssistantRequestTicket?>(null) }
    var attachmentPickConversationId by remember { mutableStateOf<String?>(null) }
    var confirmationFileActionId by remember { mutableStateOf<String?>(null) }
    var confirmationFileCard by remember { mutableStateOf<JSONObject?>(null) }
    var newMessagesAvailable by remember { mutableStateOf(false) }
    var showHistory by remember { mutableStateOf(false) }
    var showOrganization by remember { mutableStateOf(false) }
    var workspaceActionId by remember { mutableStateOf<String?>(null) }
    var workspaceBatchId by remember { mutableStateOf<String?>(null) }
    var batchMemoryFiles by remember { mutableStateOf(mapOf<String, List<SelectedDocument>>()) }
    var platformImportEntryContext by remember { mutableStateOf<PlatformImportEntryContext?>(null) }
    var platformImportInitialDocs by remember { mutableStateOf<List<SelectedDocument>>(emptyList()) }
    val requests = remember(api) { AssistantRequestGate() }
    val alive = remember(api) { booleanArrayOf(true) }
    var activeStreamJobs by remember { mutableStateOf(mapOf<String, kotlinx.coroutines.Job>()) }

    fun cancelStreamJob(convId: String) {
        activeStreamJobs[convId]?.cancel()
        activeStreamJobs = activeStreamJobs - convId
    }

    DisposableEffect(api) {
        onDispose {
            alive[0] = false
            activeStreamJobs.values.forEach { it.cancel() }
            requests.invalidate()
            platformImportEntryContext = null
            platformImportInitialDocs = emptyList()
            onSecondaryScreen(false)
        }
    }
    val secondary = showHistory || showOrganization || workspaceActionId != null || workspaceBatchId != null || platformImportEntryContext != null
    LaunchedEffect(secondary, actionConfirmation) { onSecondaryScreen(secondary || actionConfirmation != null) }
    BackHandler(secondary) {
        showHistory = false
        showOrganization = false
        workspaceActionId = null
        workspaceBatchId = null
        platformImportEntryContext = null
        platformImportInitialDocs = emptyList()
    }
    suspend fun requestScope(): String = "${api.getBaseUrl()}|${conversationId.orEmpty()}"
    suspend fun accepts(ticket: AssistantRequestTicket): Boolean =
        alive[0] && !api.sessionExpired.value && requests.accepts(ticket, requestScope())


    val activeDraft = conversationId?.let { drafts[it] } ?: AssistantComposerDraft()
    val activeConversationIsSending = conversationId?.let(sendingConversationIds::contains) == true
    val activeMessageError = conversationId?.let { conversationNotices[it] }
    val archiveTarget = conversations.firstOrNull { it.optString("id") == archiveTargetId }

    fun updateNotice(id: String, message: String?) {
        conversationNotices = if (message == null) {
            conversationNotices - id
        } else {
            conversationNotices + (id to message)
        }
    }

    fun selectConversation(id: String) {
        if (id == conversationId) return
        conversationId?.let {
            cancelStreamJob(it)
            sendingConversationIds = sendingConversationIds - it
        }
        requests.invalidateDisplay()
        showOrganization = false
        workspaceActionId = null
        workspaceBatchId = null
        platformImportEntryContext = null
        platformImportInitialDocs = emptyList()
        conversationId = id
        messages = emptyList()
        loadingMessagesFor = null
        newMessagesAvailable = false
        actionConfirmation = null
        expandedMenuConversationId = null
        updateNotice(id, null)
    }

    suspend fun refreshProviderStatus() {
        val ticket = requests.begin("provider", api.getBaseUrl().orEmpty())
        try {
            val config = repo.providerConfig()
            if (!alive[0] || !requests.accepts(ticket, api.getBaseUrl().orEmpty())) return
            providerStatus = when {
                !config.optBoolean("configured") -> "AI 接口尚未配置；可在“我的 → AI 接口设置”中设置。"
                !config.optBoolean("enabled") -> "AI 接口已配置，但当前处于关闭状态。"
                else -> "AI 接口已启用；连接测试需在设置页手动运行。"
            }
            providerStatusError = false
        } catch (e: AuthExpiredException) {
            if (!alive[0] || !requests.accepts(ticket, api.getBaseUrl().orEmpty())) return
            providerStatus = "登录状态已过期，请重新登录。"
            providerStatusError = true
            onAuthExpired()
        } catch (e: Exception) {
            if (!alive[0] || !requests.accepts(ticket, api.getBaseUrl().orEmpty())) return
            providerStatus = e.message ?: "AI 配置状态暂时无法读取。"
            providerStatusError = true
        }
    }

    suspend fun refreshConversations() {
        val ticket = requests.begin("conversations", api.getBaseUrl().orEmpty())
        try {
            val response = repo.conversations()
            if (!alive[0] || api.sessionExpired.value || !requests.accepts(ticket, api.getBaseUrl().orEmpty())) return
            val array = response.optJSONArray("items")
                ?: throw IllegalStateException("服务器没有返回对话列表。")
            val refreshed = jsonObjects(array)
            conversations = refreshed
            val current = conversationId
            if (current == null && refreshed.isNotEmpty()) {
                conversationId = refreshed.first().optString("id").takeIf { it.isNotBlank() }
            }
            conversationError = null
        } catch (e: AuthExpiredException) {
            if (!alive[0] || !requests.accepts(ticket, api.getBaseUrl().orEmpty())) return
            conversationError = "登录状态已过期，请重新登录。"
            onAuthExpired()
        } catch (e: Exception) {
            if (!alive[0] || !requests.accepts(ticket, api.getBaseUrl().orEmpty())) return
            conversationError = e.message ?: "无法读取对话列表，请重试。"
        }
    }

    suspend fun installMessages(
        targetId: String,
        incoming: List<JSONObject>,
        wasAtBottom: Boolean,
        forceToBottom: Boolean = false,
    ) {
        if (conversationId != targetId) return
        val previousVisible = filterVisibleAssistantMessages(messages)
        val incomingVisible = filterVisibleAssistantMessages(incoming)
        val previousCount = previousVisible.size
        messages = incoming

        val nextRows = selectedRows.toMutableMap()
        val nextOwners = actionConversationIds.toMutableMap()
        val expiredActionIds = mutableSetOf<String>()
        for (message in incoming) {
            val card = message.optJSONObject("content")?.optJSONObject("card") ?: continue
            val actionId = card.optString("actionId")
            if (actionId.isBlank()) continue
            nextOwners[actionId] = targetId
            val pending = card.optString("status") == "pending"
            if (!pending) {
                expiredActionIds += actionId
                nextRows.remove(actionId)
                continue
            }
            if (card.optString("toolName") == "platform-import.prepare") {
                val rows = assistantImportRows(card)
                nextRows[actionId] = reconcileImportSelection(nextRows[actionId], rows)
                val ids = rows.filter { it.eligible }.map { it.id }.toSet()
                overrides = overrides + (actionId to overrides[actionId].orEmpty().filterKeys { it in ids })
            }
        }
        selectedRows = nextRows
        actionConversationIds = nextOwners
        if (expiredActionIds.isNotEmpty()) {
            actionFiles = actionFiles - expiredActionIds
            actionFileErrors = actionFileErrors - expiredActionIds
            overrides = overrides - expiredActionIds
            notes = notes - expiredActionIds
        }

        val shouldScroll = incomingVisible.isNotEmpty() && (
            forceToBottom || targetId !in loadedConversationIds ||
                (incomingVisible.size > previousCount && wasAtBottom)
            )
        if (incomingVisible.size > previousCount && !wasAtBottom && !forceToBottom) {
            newMessagesAvailable = true
        }
        if (shouldScroll) {
            newMessagesAvailable = false
            loadedConversationIds = loadedConversationIds + targetId
            withFrameNanos { }
            if (conversationId == targetId && !showHistory && workspaceActionId == null && incomingVisible.isNotEmpty()) {
                listState.scrollToItem(incomingVisible.lastIndex)
            }
        } else {
            loadedConversationIds = loadedConversationIds + targetId
        }
    }

    var subscribeToGenerationEvents: (String, ActiveGenerationState, String) -> Unit = { _, _, _ -> }

    suspend fun refreshMessages(targetId: String, explicit: Boolean = false) {
        if (conversationId != targetId) return
        if (targetId in sendingConversationIds) return
        val ticket = requests.begin("messages", requestScope())
        loadingMessagesFor = targetId
        try {
            val response = repo.messages(targetId)
            if (!accepts(ticket) || conversationId != targetId) return
            val items = response.optJSONArray("items")
                ?: throw IllegalStateException("服务器没有返回消息列表。请重试核对。")
            val incoming = jsonObjects(items)
            val currentVisible = filterVisibleAssistantMessages(messages)
            val atBottomWhenResponseArrived = conversationId == targetId && isAtBottom(listState, currentVisible.size)
            installMessages(targetId, incoming, atBottomWhenResponseArrived)
            if (explicit) updateNotice(targetId, null)

            // Verify full identity before reading latest generation to avoid ABA race
            if (!accepts(ticket) || conversationId != targetId) return
            try {
                val latest = repo.getLatestGeneration(targetId)
                if (!accepts(ticket) || conversationId != targetId) return
                if (latest != null) {
                    val existing = activeGenerations[targetId]
                    if (existing == null || existing.generationId != latest.id || existing.lastSeq < latest.lastSeq) {
                        val restored = AssistantStreamReducer.initFromSnapshot(latest, existing?.clientRequestId.orEmpty())
                        activeGenerations = activeGenerations + (targetId to restored)
                    }
                    val resumable = activeGenerations[targetId]
                    if (resumable != null && latest.status in listOf("accepted", "running") &&
                        activeStreamJobs[targetId]?.isActive != true
                    ) {
                        subscribeToGenerationEvents(targetId, resumable, resumable.clientRequestId)
                    }
                }
            } catch (_: Exception) {}
        } catch (e: AuthExpiredException) {
            if (!accepts(ticket) || conversationId != targetId) return
            updateNotice(targetId, "登录状态已过期，请重新登录。")
            onAuthExpired()
        } catch (e: Exception) {
            if (!accepts(ticket) || conversationId != targetId) return
            updateNotice(targetId, e.message ?: "无法读取当前对话，请重试。")
        } finally {
            if (accepts(ticket) && loadingMessagesFor == targetId) loadingMessagesFor = null
        }
    }

    fun subscribeToGenerationEventsImpl(
        targetConvId: String,
        initialGen: ActiveGenerationState,
        clientRequestId: String,
    ) {
        cancelStreamJob(targetConvId)
        val job = scope.launch {
            val ticket = requests.begin("messages", requestScope())
            val operation = requests.begin("gen:$targetConvId:${initialGen.generationId}", api.getBaseUrl().orEmpty())
            var currentState = initialGen
            try {
                sendingConversationIds = sendingConversationIds + targetConvId
                repo.streamGenerationEvents(targetConvId, initialGen.generationId, afterSeq = initialGen.lastSeq)
                    .collect { event ->
                        if (!alive[0] || !requests.accepts(operation, api.getBaseUrl().orEmpty()) ||
                            api.sessionExpired.value || conversationId != targetConvId
                        ) {
                            throw CancellationException("Stream cancelled due to identity/lifecycle change")
                        }

                        val countBefore = buildAssistantMergedItems(messages, currentState).size
                        val wasAtBottom = conversationId == targetConvId && isAtBottom(listState, countBefore)

                        currentState = AssistantStreamReducer.reduceEvent(currentState, event)
                        activeGenerations = activeGenerations + (targetConvId to currentState)

                        if (currentState.requiresReconcile) {
                            try {
                                val snap = repo.getGeneration(targetConvId, currentState.generationId)
                                if (alive[0] && requests.accepts(operation, api.getBaseUrl().orEmpty()) &&
                                    !api.sessionExpired.value && conversationId == targetConvId
                                ) {
                                    currentState = AssistantStreamReducer.applyReconciledSnapshot(currentState, snap)
                                    activeGenerations = activeGenerations + (targetConvId to currentState)
                                }
                            } catch (_: Exception) {}
                        }

                        val countAfter = buildAssistantMergedItems(messages, currentState).size
                        if (wasAtBottom && countAfter > 0 && conversationId == targetConvId) {
                            withFrameNanos {}
                            listState.scrollToItem(countAfter - 1)
                        } else if (!wasAtBottom) {
                            if (event is AssistantGenerationEvent.TextDelta || countAfter > countBefore) {
                                newMessagesAvailable = true
                            }
                        }

                        if (event is AssistantGenerationEvent.Terminal) {
                            sendingConversationIds = sendingConversationIds - targetConvId
                            if (accepts(ticket) && conversationId == targetConvId) {
                                refreshMessages(targetConvId)
                            }
                        }
                    }
                // Stream collection finished normally (EOF reached).
                // If the stream ended without a terminal event while generation is still active,
                // reconcile with latest snapshot via GET (no model POST) to prevent running forever.
                if (shouldReconcileAfterStreamEof(currentState)) {
                    try {
                        val snap = repo.getGeneration(targetConvId, currentState.generationId)
                        if (alive[0] && requests.accepts(operation, api.getBaseUrl().orEmpty()) &&
                            !api.sessionExpired.value && conversationId == targetConvId
                        ) {
                            currentState = reconcileStreamCompletion(currentState, snap)
                            activeGenerations = activeGenerations + (targetConvId to currentState)
                            if (currentState.status !in listOf("accepted", "running")) {
                                sendingConversationIds = sendingConversationIds - targetConvId
                                if (accepts(ticket) && conversationId == targetConvId) {
                                    refreshMessages(targetConvId)
                                }
                            }
                        }
                    } catch (_: Exception) {
                        if (alive[0] && requests.accepts(operation, api.getBaseUrl().orEmpty()) &&
                            !api.sessionExpired.value && conversationId == targetConvId
                        ) {
                            currentState = reconcileStreamCompletion(currentState, null)
                            activeGenerations = activeGenerations + (targetConvId to currentState)
                        }
                    }
                }
            } catch (_: CancellationException) {
                // Subscription cancelled by switch/dispose/reconnect.
                // Server generation continues uninterrupted!
            } catch (e: Exception) {
                if (alive[0] && requests.accepts(operation, api.getBaseUrl().orEmpty()) &&
                    !api.sessionExpired.value && conversationId == targetConvId
                ) {
                    val cur = activeGenerations[targetConvId]
                    if (cur != null && cur.status in listOf("accepted", "running")) {
                        activeGenerations = activeGenerations + (targetConvId to cur.copy(
                            visualState = StreamVisualState.RECONCILE,
                            requiresReconcile = true,
                        ))
                    }
                }
            } finally {
                if (alive[0] && requests.accepts(operation, api.getBaseUrl().orEmpty())) {
                    sendingConversationIds = sendingConversationIds - targetConvId
                    activeStreamJobs = activeStreamJobs - targetConvId
                    refreshConversations()
                }
            }
        }
        activeStreamJobs = activeStreamJobs + (targetConvId to job)
    }
    subscribeToGenerationEvents = ::subscribeToGenerationEventsImpl

    fun stopGeneration(targetConvId: String, currentGen: ActiveGenerationState) {
        cancelStreamJob(targetConvId)
        scope.launch {
            val operation = requests.begin("cancel:${currentGen.generationId}", api.getBaseUrl().orEmpty())
            try {
                val cancelledSnapshot = repo.cancelGeneration(targetConvId, currentGen.generationId)
                if (!alive[0] || !requests.accepts(operation, api.getBaseUrl().orEmpty()) ||
                    api.sessionExpired.value || conversationId != targetConvId
                ) return@launch
                val liveGen = activeGenerations[targetConvId]
                val updated = reconcileStopSuccess(liveGen, currentGen.generationId, cancelledSnapshot)
                if (updated != null) {
                    activeGenerations = activeGenerations + (targetConvId to updated)
                }
                refreshMessages(targetConvId)
            } catch (e: AuthExpiredException) {
                if (!alive[0] || !requests.accepts(operation, api.getBaseUrl().orEmpty())) return@launch
                updateNotice(targetConvId, "登录状态已过期，请重新登录。")
                onAuthExpired()
            } catch (e: Exception) {
                if (!alive[0] || !requests.accepts(operation, api.getBaseUrl().orEmpty()) ||
                    api.sessionExpired.value || conversationId != targetConvId
                ) return@launch
                val liveGen = activeGenerations[targetConvId]
                val failedState = reconcileStopFailure(liveGen, currentGen.generationId)
                if (failedState != null) {
                    activeGenerations = activeGenerations + (targetConvId to failedState)
                }
                updateNotice(targetConvId, "停止生成请求未完成：${e.message}。请刷新核对。")
            } finally {
                if (alive[0] && requests.accepts(operation, api.getBaseUrl().orEmpty())) {
                    val liveGen = activeGenerations[targetConvId]
                    if (liveGen == null || liveGen.generationId == currentGen.generationId ||
                        liveGen.status !in listOf("accepted", "running")
                    ) {
                        sendingConversationIds = sendingConversationIds - targetConvId
                    }
                }
            }
        }
    }

    fun reconnectGeneration(targetConvId: String, currentGen: ActiveGenerationState) {
        cancelStreamJob(targetConvId)
        scope.launch {
            val operation = requests.begin("reconnect:${currentGen.generationId}", api.getBaseUrl().orEmpty())
            try {
                val snapshot = repo.getGeneration(targetConvId, currentGen.generationId)
                if (!alive[0] || !requests.accepts(operation, api.getBaseUrl().orEmpty()) ||
                    api.sessionExpired.value || conversationId != targetConvId
                ) return@launch
                val liveGen = activeGenerations[targetConvId]
                val state = reconcileReconnectSuccess(liveGen, currentGen.generationId, snapshot)
                    ?: return@launch
                activeGenerations = activeGenerations + (targetConvId to state)
                if (snapshot.status in listOf("accepted", "running")) {
                    subscribeToGenerationEvents(targetConvId, state, currentGen.clientRequestId)
                } else {
                    sendingConversationIds = sendingConversationIds - targetConvId
                    refreshMessages(targetConvId)
                }
            } catch (e: AuthExpiredException) {
                if (!alive[0] || !requests.accepts(operation, api.getBaseUrl().orEmpty())) return@launch
                updateNotice(targetConvId, "登录状态已过期，请重新登录。")
                onAuthExpired()
            } catch (e: Exception) {
                if (!alive[0] || !requests.accepts(operation, api.getBaseUrl().orEmpty()) ||
                    api.sessionExpired.value || conversationId != targetConvId
                ) return@launch
                updateNotice(targetConvId, "核对状态失败：${e.message}。请稍后重试。")
            } finally {
                if (alive[0] && requests.accepts(operation, api.getBaseUrl().orEmpty())) {
                    val liveGen = activeGenerations[targetConvId]
                    if (liveGen == null || (liveGen.generationId == currentGen.generationId && liveGen.status !in listOf("accepted", "running"))) {
                        sendingConversationIds = sendingConversationIds - targetConvId
                    }
                }
            }
        }
    }

    fun startStreamingGeneration(
        targetConvId: String,
        clientRequestId: String,
        input: GenerationInput,
    ) {
        cancelStreamJob(targetConvId)
        sendingConversationIds = sendingConversationIds + targetConvId
        updateNotice(targetConvId, null)

        scope.launch {
            val ticket = requests.begin("messages", requestScope())
            loadingMessagesFor = null
            val operation = requests.begin("gen:$targetConvId", api.getBaseUrl().orEmpty())
            try {
                val createResult = repo.createGeneration(targetConvId, clientRequestId, input)
                if (!alive[0] || !requests.accepts(operation, api.getBaseUrl().orEmpty()) ||
                    api.sessionExpired.value || conversationId != targetConvId
                ) return@launch

                if (drafts[targetConvId]?.requestId == clientRequestId) {
                    drafts = drafts + (targetConvId to AssistantComposerDraft())
                }

                val currentState = AssistantStreamReducer.initFromSnapshot(createResult.generation, clientRequestId)
                activeGenerations = activeGenerations + (targetConvId to currentState)
                newMessagesAvailable = false
                val countAfterCreate = buildAssistantMergedItems(messages, currentState).size
                if (countAfterCreate > 0 && conversationId == targetConvId) {
                    withFrameNanos {}
                    listState.scrollToItem(countAfterCreate - 1)
                }

                if (createResult.generation.status in listOf("accepted", "running")) {
                    subscribeToGenerationEvents(targetConvId, currentState, clientRequestId)
                } else {
                    sendingConversationIds = sendingConversationIds - targetConvId
                    if (accepts(ticket) && conversationId == targetConvId) {
                        refreshMessages(targetConvId)
                    }
                }
            } catch (e: AuthExpiredException) {
                if (!alive[0] || !requests.accepts(operation, api.getBaseUrl().orEmpty()) ||
                    conversationId != targetConvId
                ) return@launch
                updateNotice(targetConvId, "登录状态已过期，请重新登录。")
                onAuthExpired()
            } catch (e: ApiException) {
                if (!alive[0] || !requests.accepts(operation, api.getBaseUrl().orEmpty()) ||
                    conversationId != targetConvId
                ) return@launch
                if (shouldUnlockChoiceOnError(e)) {
                    val cur = activeGenerations[targetConvId]
                    if (cur != null) {
                        activeGenerations = activeGenerations + (targetConvId to AssistantStreamReducer.unlockChoice(cur))
                    }
                }
                updateNotice(
                    targetConvId,
                    "发送结果尚未核对：${e.message ?: "请求未完成"}。请先刷新本对话，避免重复发送。",
                )
            } catch (e: Exception) {
                if (!alive[0] || !requests.accepts(operation, api.getBaseUrl().orEmpty()) ||
                    conversationId != targetConvId
                ) return@launch
                updateNotice(
                    targetConvId,
                    "发送结果尚未核对：${e.message ?: "请求未完成"}。请先刷新本对话，避免重复发送。",
                )
            } finally {
                if (alive[0] && requests.accepts(operation, api.getBaseUrl().orEmpty())) {
                    val gen = activeGenerations[targetConvId]
                    if (gen == null || gen.status !in listOf("accepted", "running")) {
                        sendingConversationIds = sendingConversationIds - targetConvId
                    }
                    refreshConversations()
                }
            }
        }
    }

    fun selectClarificationChoice(
        targetConvId: String,
        currentGen: ActiveGenerationState,
        option: ClarificationOption,
    ) {
        if (targetConvId in sendingConversationIds) return
        val liveGen = activeGenerations[targetConvId] ?: currentGen
        if (!canSelectChoiceOption(liveGen, option.id)) return
        val choiceRequestId = liveGen.pendingChoiceRequestId ?: UUID.randomUUID().toString()
        val locked = AssistantStreamReducer.lockChoice(liveGen, option.id, choiceRequestId)
        activeGenerations = activeGenerations + (targetConvId to locked)
        val input = GenerationInput.Choice(
            sourceGenerationId = liveGen.generationId,
            questionId = liveGen.clarification?.id.orEmpty(),
            optionId = option.id,
        )
        startStreamingGeneration(targetConvId, choiceRequestId, input)
    }

    suspend fun createConversation() {
        if (creatingConversation) return
        creatingConversation = true
        val operation = requests.begin("create", api.getBaseUrl().orEmpty())
        try {
            val created = repo.createConversation()
            if (!alive[0] || !requests.accepts(operation, api.getBaseUrl().orEmpty()) || api.sessionExpired.value) return
            val id = created.optString("id").takeIf { it.isNotBlank() }
                ?: throw IllegalStateException("服务器没有返回对话编号。")
            requests.invalidateDisplay()
            showHistory = false
            drafts = drafts + (id to AssistantComposerDraft())
            conversationId = id
            messages = emptyList()
            newMessagesAvailable = false
            conversationError = null
            refreshConversations()
        } catch (e: AuthExpiredException) {
            if (!alive[0] || !requests.accepts(operation, api.getBaseUrl().orEmpty())) return
            conversationError = "登录状态已过期，请重新登录。"
            onAuthExpired()
        } catch (e: Exception) {
            if (!alive[0] || !requests.accepts(operation, api.getBaseUrl().orEmpty())) return
            conversationError = e.message ?: "新建对话失败，请重试。"
        } finally {
            if (alive[0] && requests.accepts(operation, api.getBaseUrl().orEmpty())) creatingConversation = false
        }
    }

    fun clearConversationLocalState(id: String) {
        cancelStreamJob(id)
        val ownedActions = actionConversationIds.filterValues { it == id }.keys
        actionFiles = actionFiles - ownedActions
        actionFileErrors = actionFileErrors - ownedActions
        selectedRows = selectedRows - ownedActions
        overrides = overrides - ownedActions
        notes = notes - ownedActions
        actionConversationIds = actionConversationIds - ownedActions
        actionBusyIds = actionBusyIds - ownedActions
        drafts = drafts - id
        activeGenerations = activeGenerations - id
        conversationNotices = conversationNotices - id
        if (actionConfirmation?.conversationId == id) actionConfirmation = null
    }

    suspend fun archiveConversation(id: String) {
        val actionInFlight = actionBusyIds.any { actionConversationIds[it] == id }
        if (id in sendingConversationIds || actionInFlight || archivingConversationId != null) return
        archivingConversationId = id
        val operation = requests.begin("archive", api.getBaseUrl().orEmpty())
        try {
            repo.archiveConversation(id)
            if (!alive[0] || !requests.accepts(operation, api.getBaseUrl().orEmpty()) || api.sessionExpired.value) return
            clearConversationLocalState(id)
            conversations = conversations.filterNot { it.optString("id") == id }
            if (conversationId == id) {
                messages = emptyList()
                loadingMessagesFor = null
                workspaceActionId = null
                requests.invalidateDisplay()
                conversationId = conversations.firstOrNull()?.optString("id")?.takeIf { it.isNotBlank() }
                newMessagesAvailable = false
            }
            archiveTargetId = null
            conversationError = null
            refreshConversations()
        } catch (e: AuthExpiredException) {
            if (!alive[0] || !requests.accepts(operation, api.getBaseUrl().orEmpty())) return
            conversationError = "登录状态已过期，请重新登录。"
            onAuthExpired()
        } catch (e: Exception) {
            if (!alive[0] || !requests.accepts(operation, api.getBaseUrl().orEmpty())) return
            conversationError = e.message ?: "归档失败，对话仍保留在列表中。"
        } finally {
            if (alive[0] && requests.accepts(operation, api.getBaseUrl().orEmpty())) archivingConversationId = null
        }
    }

    suspend fun matchesActionAttachment(document: SelectedDocument, card: JSONObject): Boolean = withContext(Dispatchers.IO) {
        val attachment = card.optJSONObject("attachment") ?: return@withContext false
        val expectedSize = attachment.optLong("sizeBytes", -1L)
        val expectedHash = attachment.optString("sha256")
        document.bytes.size.toLong() == expectedSize &&
            expectedHash.isNotBlank() && sha256Hex(document.bytes).equals(expectedHash, ignoreCase = true)
    }

    val composerBatchPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris: List<Uri>? ->
        val ticket = attachmentPickTicket
        val targetConversationId = attachmentPickConversationId
        attachmentPickConversationId = null
        if (uris.isNullOrEmpty() || targetConversationId == null || ticket == null) return@rememberLauncherForActivityResult
        scope.launch {
            try {
                val previous = drafts[targetConversationId]
                val docs = readMultipleDocuments(context, uris)
                if (!accepts(ticket) || targetConversationId in sendingConversationIds || previous != drafts[targetConversationId] || conversations.none { it.optString("id") == targetConversationId }) return@launch
                platformImportInitialDocs = docs
                platformImportEntryContext = PlatformImportEntryContext(
                    source = PlatformImportSource.ASSISTANT,
                    existingConversationId = targetConversationId,
                )
                updateNotice(targetConversationId, null)
            } catch (e: Exception) {
                if (!accepts(ticket)) return@launch
                updateNotice(targetConversationId, e.message ?: "无法读取所选账单文件。")
            }
        }
    }

    val composerPicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri: Uri? ->
        val ticket = attachmentPickTicket
        val targetConversationId = attachmentPickConversationId
        attachmentPickConversationId = null
        if (uri == null || targetConversationId == null || ticket == null) return@rememberLauncherForActivityResult
        scope.launch {
            try {
                val previous = drafts[targetConversationId]
                val document = readDocument(context, uri)
                requireAssistantDocument(document)
                if (!accepts(ticket) || targetConversationId in sendingConversationIds || previous != drafts[targetConversationId] || conversations.none { it.optString("id") == targetConversationId }) return@launch
                val current = drafts[targetConversationId] ?: AssistantComposerDraft()
                drafts = drafts + (targetConversationId to current.copy(attachment = document, requestId = null))
                updateNotice(targetConversationId, null)
            } catch (e: Exception) {
                if (!accepts(ticket)) return@launch
                updateNotice(targetConversationId, e.message ?: "无法读取附件。")
            }
        }
    }

    val actionFilePicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri: Uri? ->
        val ticket = confirmationPickTicket
        val actionId = confirmationFileActionId
        val expectedCard = confirmationFileCard
        confirmationFileActionId = null
        confirmationFileCard = null
        if (uri == null || actionId == null || expectedCard == null || ticket == null) return@rememberLauncherForActivityResult
        scope.launch {
            try {
                val document = readDocument(context, uri)
                requireAssistantDocument(document)
                val liveCard = messages.firstNotNullOfOrNull { it.optJSONObject("content")?.optJSONObject("card")?.takeIf { c -> c.optString("actionId") == actionId } }
                if (!accepts(ticket) || liveCard?.optString("status") != "pending" || actionId in actionBusyIds) return@launch
                if (actionId !in actionConversationIds || liveCard.optString("status") != "pending") {
                    actionFileErrors = actionFileErrors + (actionId to "此操作已不是待确认状态，请刷新后核对。")
                    return@launch
                }
                if (!matchesActionAttachment(document, expectedCard)) {
                    actionFileErrors = actionFileErrors + (
                        actionId to "所选文件与本次预览不一致。请重新选择预览中的原文件，或取消后重新准备导入。"
                        )
                    return@launch
                }
                if (!accepts(ticket) || messages.none { it.optJSONObject("content")?.optJSONObject("card")?.let { c -> c.optString("actionId") == actionId && c.optString("status") == "pending" } == true }) return@launch
                actionFiles = actionFiles + (actionId to document)
                actionFileErrors = actionFileErrors - actionId
                actionConversationIds[actionId]?.let { id -> refreshMessages(id) }
            } catch (e: Exception) {
                if (!accepts(ticket)) return@launch
                actionFileErrors = actionFileErrors + (actionId to (e.message ?: "无法读取原始账单文件。"))
            }
        }
    }

    LaunchedEffect(repo) {
        loadingConversations = true
        launch { refreshProviderStatus() }
        refreshConversations()
        loadingConversations = false
    }

    LaunchedEffect(conversationId) {
        val id = conversationId
        if (id == null) {
            messages = emptyList()
            loadingMessagesFor = null
        } else {
            messages = emptyList()
            newMessagesAvailable = false
            refreshMessages(id)
        }
    }

    LaunchedEffect(listState, conversationId) {
        snapshotFlow {
            val totalCount = buildAssistantMergedItems(
                messages,
                conversationId?.let { activeGenerations[it] }
            ).size
            val atBottom = isAtBottom(listState, totalCount)
            Triple(newMessagesAvailable, atBottom, listState.isScrollInProgress)
        }.collect { (hasNew, atBottom, isScrolling) ->
            if (hasNew && shouldClearNewMessagesAvailable(atBottom, isScrolling)) {
                newMessagesAvailable = false
            }
        }
    }

    fun requestConfirm(actionId: String, continueImport: Boolean = false) {
        if (conversationId?.let { conversationNotices[it]?.contains("结果待核对") } == true && continueImport) return
        val card = messages.firstNotNullOfOrNull { item ->
            item.optJSONObject("content")?.optJSONObject("card")
                ?.takeIf { it.optString("actionId") == actionId }
        }
        if (card == null || card.optString("status") != "pending") {
            conversationId?.let { id -> scope.launch { refreshMessages(id, explicit = true) } }
        } else {
            if (card.optString("toolName") == "platform-import.prepare" && !continueImport) {
                workspaceActionId = actionId
                return
            }
            if (card.optString("toolName") == "platform-import.prepare" && selectedRows[actionId].orEmpty().isEmpty()) return
            val attachmentRequired = card.optJSONObject("attachment") != null
            if (attachmentRequired && actionFiles[actionId] == null) {
                confirmationFileActionId = actionId
                confirmationFileCard = card
                scope.launch { confirmationPickTicket = requests.begin("action-file", requestScope()); actionFilePicker.launch("*/*") }
            } else {
                actionConfirmation = conversationId?.let { ActionConfirmationRequest(it, actionId) }
            }
        }
    }
    fun cancelAction(actionId: String) {
        if (messages.none { it.optJSONObject("content")?.optJSONObject("card")?.let { c -> c.optString("actionId") == actionId && c.optString("status") == "pending" } == true }) return
        val id = conversationId
        if (id != null && actionId !in actionBusyIds) {
            scope.launch {
                val operation = requests.begin("action:$actionId", api.getBaseUrl().orEmpty())
                requests.begin("messages", requestScope())
                actionBusyIds = actionBusyIds + actionId
                try {
                    repo.cancelAction(actionId)
                    if (!alive[0] || !requests.accepts(operation, api.getBaseUrl().orEmpty())) return@launch
                    refreshMessages(id)
                } catch (e: AuthExpiredException) {
                    if (!alive[0] || !requests.accepts(operation, api.getBaseUrl().orEmpty())) return@launch
                    updateNotice(id, "登录状态已过期，请重新登录。")
                    onAuthExpired()
                } catch (e: Exception) {
                    if (!alive[0] || !requests.accepts(operation, api.getBaseUrl().orEmpty())) return@launch
                    updateNotice(id, "取消结果待核对：${e.message ?: "请求未完成"}。请刷新对话，不要重复操作。")
                    refreshMessages(id)
                } finally {
                    if (alive[0] && requests.accepts(operation, api.getBaseUrl().orEmpty())) actionBusyIds = actionBusyIds - actionId
                }
            }
        }
    }
    fun chooseSource(actionId: String) {
        val card = messages.firstNotNullOfOrNull { item ->
            item.optJSONObject("content")?.optJSONObject("card")
                ?.takeIf { it.optString("actionId") == actionId }
        }
        if (card != null && card.optString("status") == "pending") {
            confirmationFileActionId = actionId
            confirmationFileCard = card
            scope.launch { confirmationPickTicket = requests.begin("action-file", requestScope()); actionFilePicker.launch("*/*") }
        }
    }
    val workspaceCard = messages.firstNotNullOfOrNull { it.optJSONObject("content")?.optJSONObject("card")?.takeIf { c -> c.optString("actionId") == workspaceActionId } }
    if (workspaceActionId != null && workspaceCard != null) {
        val actionId = workspaceActionId!!
        val comparisonConversationId = conversationId.orEmpty()
        AssistantImportWorkspace(
            loadDuplicates = { rowId, cursor -> repo.duplicateCandidates(comparisonConversationId, actionId, rowId, cursor) },
            onAuthExpired = onAuthExpired,
            card = workspaceCard,
            selected = selectedRows[actionId].orEmpty(),
            overrides = overrides[actionId].orEmpty(),
            notes = notes[actionId].orEmpty(),
            busy = actionId in actionBusyIds,
            sourceReady = actionFiles[actionId] != null,
            fileError = actionFileErrors[actionId] ?: activeMessageError,
            uncertain = activeMessageError?.contains("结果待核对") == true || actionFileErrors[actionId]?.contains("结果待核对") == true,
            onRefresh = { conversationId?.let { id -> scope.launch {
                refreshMessages(id, explicit = true)
                if (conversationId == id && conversationNotices[id] == null) actionFileErrors = actionFileErrors - actionId
            } } },
            onBack = { workspaceActionId = null },
            onSelection = { selectedRows = selectedRows + (actionId to it) },
            onCategory = { rowId, category ->
                val current = overrides[actionId].orEmpty().toMutableMap()
                if (category.isBlank()) current.remove(rowId) else current[rowId] = category.trim()
                overrides = overrides + (actionId to current)
            },
            onNote = { rowId, note -> notes = notes + (actionId to (notes[actionId].orEmpty() + (rowId to note))) },
            onRetryAnalysis = {
                val target = conversationId
                val file = actionFiles[actionId]
                if (target != null && file != null) scope.launch {
                    if (!matchesActionAttachment(file, workspaceCard)) return@launch
                    val ticket = requests.begin("analyse:$actionId", api.getBaseUrl().orEmpty())
                    actionBusyIds = actionBusyIds + actionId
                    try {
                        repo.analyseAction(actionId, file.bytes)
                        if (alive[0] && requests.accepts(ticket, api.getBaseUrl().orEmpty())) {
                            if (conversationId == target && workspaceActionId == actionId) workspaceActionId = null
                            refreshMessages(target)
                        }
                    } catch (e: Exception) {
                        if (alive[0] && requests.accepts(ticket, api.getBaseUrl().orEmpty())) actionFileErrors = actionFileErrors + (actionId to "分析结果待核对，请刷新后再重试。")
                    } finally { if (alive[0] && requests.accepts(ticket, api.getBaseUrl().orEmpty())) actionBusyIds = actionBusyIds - actionId }
                }
            },
            onChooseSource = { chooseSource(actionId) },
            onContinue = { requestConfirm(actionId, true) },
            onCancel = { cancelAction(actionId) },
        )
    } else if (workspaceBatchId != null) {
        val currentBatchId = workspaceBatchId!!
        val convId = conversationId.orEmpty()
        AssistantBatchImportWorkspace(
            conversationId = convId,
            initialBatchId = currentBatchId,
            repo = repo,
            api = api,
            initialMemoryFiles = batchMemoryFiles[currentBatchId].orEmpty(),
            onAuthExpired = onAuthExpired,
            onBack = { workspaceBatchId = null },
            onImportConfirmed = { _ ->
                if (conversationId == convId) onDataChanged()
                workspaceBatchId = null
                batchMemoryFiles = batchMemoryFiles - currentBatchId
                scope.launch {
                    refreshMessages(convId, explicit = true)
                    refreshConversations()
                }
            },
        )
    } else if (platformImportEntryContext != null) {
        val entryContext = platformImportEntryContext!!
        PlatformImportHost(
            api = api,
            entryContext = entryContext,
            initialDocuments = platformImportInitialDocs,
            onAuthExpired = onAuthExpired,
            onClose = {
                platformImportEntryContext = null
                platformImportInitialDocs = emptyList()
            },
            onImportFinished = { _ ->
                if (platformImportEntryContext == entryContext) onDataChanged()
                platformImportEntryContext = null
                platformImportInitialDocs = emptyList()
                conversationId?.let { convId ->
                    scope.launch {
                        refreshMessages(convId, explicit = true)
                        refreshConversations()
                    }
                }
            },
            onRegisterNavigation = onRegisterNavigation,
        )
    } else if (showOrganization) {
        AssistantOrganizationWorkspace(
            api = api,
            repo = organizationRepo,
            scopeProvider = { api.getBaseUrl().orEmpty() },
            onAuthExpired = onAuthExpired,
            onBack = { showOrganization = false },
        )
    } else if (showHistory) {
        Column(Modifier.fillMaxSize().padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { showHistory = false }) { Icon(Icons.Filled.ArrowBack, "返回聊天") }
                Text("会话管理", Modifier.weight(1f), style = MaterialTheme.typography.titleLarge)
            }
            Button(onClick = { scope.launch { createConversation() } }, enabled = !creatingConversation, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("新建对话") }
            conversationError?.let { AssistantNotice(it, true, { scope.launch { refreshConversations() } }, "重试") }
            TextButton(onClick = { scope.launch { refreshConversations() } }) { Text("刷新会话列表") }
            LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(conversations, key = { it.optString("id") }) { conversation ->
                    ConversationChoice(
                        conversation = conversation, selected = conversation.optString("id") == conversationId,
                        menuExpanded = expandedMenuConversationId == conversation.optString("id"),
                        archiving = archivingConversationId == conversation.optString("id"),
                        archiveEnabled = conversation.optString("id") !in sendingConversationIds &&
                            !actionBusyIds.any { actionConversationIds[it] == conversation.optString("id") } && archivingConversationId == null,
                        onSelect = { selectConversation(conversation.optString("id")); showHistory = false },
                        onMenu = { expandedMenuConversationId = conversation.optString("id") },
                        onDismissMenu = { expandedMenuConversationId = null },
                        onArchive = { archiveTargetId = conversation.optString("id"); expandedMenuConversationId = null },
                    )
                }
                if (conversations.isEmpty()) item { Text(if (loadingConversations) "正在读取会话…" else "暂无会话") }
            }
        }
    }
    if (!secondary) {
    Column(
        modifier = Modifier.fillMaxSize().imePadding().padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text("AI 助理", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                val currentGen = conversationId?.let { activeGenerations[it] }
                if (currentGen != null) {
                    Spacer(Modifier.height(4.dp))
                    StreamStatusBadge(state = currentGen.visualState, delivery = currentGen.delivery)
                } else {
                    Text("账本整理 · 会话管理", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            TextButton(onClick = { showHistory = true }, modifier = Modifier.heightIn(min = 48.dp)) {
                Icon(Icons.Filled.ChatBubbleOutline, contentDescription = null, modifier = Modifier.size(20.dp))
                Spacer(Modifier.size(6.dp))
                Text("会话")
            }
            Box {
                var menuOpen by remember { mutableStateOf(false) }
                IconButton(onClick = { menuOpen = true }) { Icon(Icons.Filled.MoreVert, "更多对话操作") }
                DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                    DropdownMenuItem(text = { Text("智能整理旧账") }, leadingIcon = { Icon(Icons.Filled.SmartToy, null) }, onClick = { menuOpen = false; showOrganization = true })
                    DropdownMenuItem(text = { Text("新建对话") }, leadingIcon = { Icon(Icons.Filled.Add, null) }, enabled = !creatingConversation && archivingConversationId == null, onClick = { menuOpen = false; scope.launch { createConversation() } })
                    DropdownMenuItem(text = { Text("刷新消息") }, leadingIcon = { Icon(Icons.Filled.Refresh, null) }, enabled = conversationId != null && !activeConversationIsSending, onClick = { menuOpen = false; conversationId?.let { id -> scope.launch { refreshMessages(id, explicit = true) } } })
                    DropdownMenuItem(text = { Text("AI 接口设置") }, onClick = { menuOpen = false; onProviderSettings() })
                }
            }
        }
        if (providerStatusError || providerStatus.contains("尚未配置") || providerStatus.contains("关闭")) {
            AssistantNotice(providerStatus, providerStatusError, onProviderSettings, "设置")
        }

        if (conversationError != null) {
            AssistantNotice(
                message = conversationError!!,
                isError = true,
                onAction = { scope.launch { refreshConversations() } },
                actionLabel = "重试",
            )
        }



        val messageError = activeMessageError
        if (messageError != null && conversationId != null) {
            AssistantNotice(
                message = messageError,
                isError = true,
                onAction = { conversationId?.let { id -> scope.launch { refreshMessages(id, explicit = true) } } },
                actionLabel = "刷新核对",
            )
        }

        val currentGen = conversationId?.let { activeGenerations[it] }
        val mergedItems = remember(messages, currentGen) { buildAssistantMergedItems(messages, currentGen) }

        Box(modifier = Modifier.weight(1f).fillMaxWidth().clip(RoundedCornerShape(0.dp))) {
            when {
                conversationId == null && conversationError != null -> AssistantEmptyState(
                    title = "对话列表暂不可用",
                    body = "请重试读取服务器对话。",
                    actionLabel = "重新加载",
                    onAction = { scope.launch { refreshConversations() } },
                )
                conversationId == null && !loadingConversations -> AssistantEmptyState(
                    title = "还没有可用对话",
                    body = "新建对话后，消息和待确认操作会保存在服务器。",
                    actionLabel = "新建对话",
                    onAction = { scope.launch { createConversation() } },
                )
                conversationId != null && loadingMessagesFor == conversationId && mergedItems.isEmpty() -> {
                    Column(
                        modifier = Modifier.align(Alignment.Center),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        CircularProgressIndicator()
                        Text("正在读取消息…", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                conversationId != null && activeMessageError != null && mergedItems.isEmpty() -> AssistantEmptyState(
                    title = "消息未能读取",
                    body = "重试后再继续这段对话。",
                    actionLabel = "刷新对话",
                    onAction = { conversationId?.let { id -> scope.launch { refreshMessages(id, explicit = true) } } },
                )
                conversationId != null && mergedItems.isEmpty() -> {
                    val welcomeId = conversationId
                    if (welcomeId == null) {
                        AssistantEmptyState(
                            title = "还没有可用对话",
                            body = "新建对话后继续。",
                            actionLabel = "新建对话",
                            onAction = { scope.launch { createConversation() } },
                        )
                    } else {
                        AssistantWelcome(
                            onQuickMemo = { template ->
                                val current = drafts[welcomeId] ?: AssistantComposerDraft()
                                drafts = drafts + (welcomeId to current.copy(text = template, requestId = null))
                            },
                            onOpenOrganization = { showOrganization = true },
                        )
                    }
                }
                else -> LazyColumn(
                    state = listState,
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(vertical = 8.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    items(mergedItems, key = { it.key }) { item ->
                        when (item) {
                            is AssistantMergedItem.Message -> {
                                val messageActionId = item.message.optJSONObject("content")
                                    ?.optJSONObject("card")?.optString("actionId").orEmpty()
                                MessageCard(
                                    modifier = Modifier,
                                    message = item.message,
                                    selectedRows = selectedRows,
                                    overrides = overrides,
                                    actionFile = actionFiles[messageActionId],
                                    actionFileError = actionFileErrors[messageActionId],
                                    actionBusy = messageActionId in actionBusyIds,
                                    liveClarificationId = currentGen?.takeIf { it.visualState == StreamVisualState.AWAITING_CHOICE }?.clarification?.id,
                                    onToggleRow = { actionId, rowId, checked ->
                                        val current = selectedRows[actionId].orEmpty()
                                        selectedRows = selectedRows + (
                                            actionId to if (checked && current.size < 100) current + rowId else if (!checked) current - rowId else current
                                        )
                                    },
                                    onOverride = { actionId, rowId, category ->
                                        val current = overrides[actionId].orEmpty().toMutableMap()
                                        if (category.isBlank()) current.remove(rowId) else current[rowId] = category
                                        overrides = overrides + (actionId to current)
                                    },
                                    onOpenBatchWorkspace = { batchId ->
                                        workspaceBatchId = batchId
                                    },
                                    onRequestConfirm = { requestConfirm(it) },
                                    onCancel = { cancelAction(it) },
                                    onChooseSourceFile = { chooseSource(it) },
                                )
                            }
                            is AssistantMergedItem.ProvisionalBubble -> {
                                StreamingGrowingBubble(
                                    text = item.text,
                                    onStop = { conversationId?.let { id -> currentGen?.let { gen -> stopGeneration(id, gen) } } },
                                )
                            }
                            is AssistantMergedItem.Connecting -> {
                                Row(
                                    modifier = Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 6.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                                ) {
                                    CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
                                    Text(
                                        "● 正在连接 AI 服务…",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                            }
                            is AssistantMergedItem.LiveClarification -> {
                                ClarificationCard(
                                    clarification = item.clarification,
                                    isLive = true,
                                    selectedOptionId = item.selectedOptionId,
                                    allowRetrySelected = conversationId !in sendingConversationIds,
                                    onSelectOption = { opt ->
                                        conversationId?.let { id ->
                                            currentGen?.let { gen ->
                                                selectClarificationChoice(id, gen, opt)
                                            }
                                        }
                                    },
                                )
                            }
                            is AssistantMergedItem.PendingFinancialNotice -> {
                                Surface(
                                    color = TitaniumBlue.copy(alpha = 0.08f),
                                    shape = RoundedCornerShape(10.dp),
                                    border = BorderStroke(1.dp, TitaniumBlue.copy(alpha = 0.25f)),
                                    modifier = Modifier.fillMaxWidth(),
                                ) {
                                    Row(
                                        modifier = Modifier.padding(12.dp),
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                                    ) {
                                        Icon(
                                            Icons.Default.SmartToy,
                                            contentDescription = null,
                                            tint = TitaniumBlue,
                                            modifier = Modifier.size(18.dp),
                                        )
                                        Text(
                                            "已生成待确认记账卡片，请在上方卡片中核对明细后手动确认。未确认前不会写入任何账目。",
                                            style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.onSurface,
                                        )
                                    }
                                }
                            }
                            is AssistantMergedItem.AnsweredSignal -> {
                                AnsweredSignalBox()
                            }
                            is AssistantMergedItem.FailureAlert -> {
                                Card(
                                    colors = CardDefaults.cardColors(
                                        containerColor = MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.5f),
                                    ),
                                    shape = RoundedCornerShape(12.dp),
                                    modifier = Modifier.fillMaxWidth(),
                                ) {
                                    Row(
                                        modifier = Modifier.padding(12.dp),
                                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                                        verticalAlignment = Alignment.CenterVertically,
                                    ) {
                                        Icon(
                                            Icons.Default.Warning,
                                            contentDescription = null,
                                            tint = MaterialTheme.colorScheme.error,
                                            modifier = Modifier.size(20.dp),
                                        )
                                        Column(modifier = Modifier.weight(1f)) {
                                            Text(
                                                "生成未完成（${item.error?.code ?: "AI_ERROR"}）",
                                                style = MaterialTheme.typography.titleSmall,
                                                fontWeight = FontWeight.Bold,
                                                color = MaterialTheme.colorScheme.error,
                                            )
                                            Text(
                                                formatAssistantErrorMessage(item.error?.code),
                                                style = MaterialTheme.typography.bodySmall,
                                                color = MaterialTheme.colorScheme.onErrorContainer,
                                            )
                                        }
                                    }
                                }
                            }
                            is AssistantMergedItem.CancelledAlert -> {
                                Surface(
                                    color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
                                    shape = RoundedCornerShape(8.dp),
                                    modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                                ) {
                                    Text(
                                        "● 已由用户手动停止生成（未执行记账）",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                                    )
                                }
                            }
                            is AssistantMergedItem.ReconcileAlert -> {
                                ReconcileAlertCard(
                                    partialSnippet = item.snippet,
                                    onReconnect = {
                                        conversationId?.let { id ->
                                            currentGen?.let { gen -> reconnectGeneration(id, gen) }
                                        }
                                    },
                                    onDismiss = {
                                        conversationId?.let { id -> activeGenerations = activeGenerations - id }
                                    },
                                )
                            }
                        }
                    }
                }
            }
        }

        if (newMessagesAvailable) {
            OutlinedButton(
                onClick = {
                    scope.launch {
                        val lastIndex = mergedItems.lastIndex
                        if (lastIndex >= 0) {
                            if (motion.reduced) listState.scrollToItem(lastIndex)
                            else listState.animateScrollToItem(lastIndex)
                        }
                        newMessagesAvailable = false
                    }
                },
                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
            ) { Text("有新消息，跳到最新") }
        }

        Surface(
            color = MaterialTheme.colorScheme.surface,
            shape = RoundedCornerShape(18.dp),
            border = BorderStroke(1.dp, LocalWebTokens.current.border),
            modifier = Modifier.fillMaxWidth(),
        ) {
        Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            activeDraft.attachment?.let { attachment ->
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    color = MaterialTheme.colorScheme.surfaceVariant,
                    shape = MaterialTheme.shapes.small,
                    border = BorderStroke(1.dp, LocalWebTokens.current.border),
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(start = 12.dp, top = 6.dp, bottom = 6.dp, end = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Icon(Icons.Filled.AttachFile, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                        Column(Modifier.weight(1f)) {
                            Text(attachment.name, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text("${attachment.bytes.size / 1024} KB · 仅保留在当前进程", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        IconButton(
                            enabled = !activeConversationIsSending,
                            onClick = {
                                val id = conversationId ?: return@IconButton
                                val current = drafts[id] ?: AssistantComposerDraft()
                                drafts = drafts + (id to current.copy(attachment = null, requestId = null))
                            },
                            modifier = Modifier.size(48.dp),
                        ) { Icon(Icons.Filled.Close, contentDescription = "移除附件") }
                    }
                }
            }

        Row(
            modifier = Modifier.fillMaxWidth().padding(bottom = 4.dp),
            verticalAlignment = Alignment.Bottom,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            IconButton(
                enabled = conversationId != null && !activeConversationIsSending,
                onClick = {
                    scope.launch {
                        attachmentPickConversationId = conversationId
                        attachmentPickTicket = requests.begin("composer-file", requestScope())
                        composerBatchPicker.launch(arrayOf("*/*"))
                    }
                },
                modifier = Modifier.size(48.dp).background(MaterialTheme.colorScheme.primaryContainer, RoundedCornerShape(12.dp)),
            ) { Icon(Icons.Filled.AttachFile, contentDescription = "上传微信或支付宝账单", tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(24.dp)) }
            OutlinedTextField(
                value = activeDraft.text,
                onValueChange = { value ->
                    val id = conversationId ?: return@OutlinedTextField
                    val current = drafts[id] ?: AssistantComposerDraft()
                    drafts = drafts + (id to current.copy(text = value, requestId = null))
                },
                modifier = Modifier.weight(1f).heightIn(min = 52.dp, max = 132.dp),
                enabled = conversationId != null && !activeConversationIsSending,
                placeholder = { Text("问问账本，或上传账单…", style = MaterialTheme.typography.bodySmall) },
                minLines = 1,
                maxLines = 4,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Default),
            )
            Button(
                enabled = conversationId != null && !activeConversationIsSending &&
                    (activeDraft.text.isNotBlank() || activeDraft.attachment != null),
                onClick = {
                    val id = conversationId ?: return@Button
                    val capturedDraft = activeDraft
                    val requestId = capturedDraft.requestId ?: UUID.randomUUID().toString()
                    drafts = drafts + (id to capturedDraft.copy(requestId = requestId))

                    if (capturedDraft.attachment != null) {
                        scope.launch {
                            val ticket = requests.begin("messages", requestScope())
                            loadingMessagesFor = null
                            val operation = requests.begin("send:$id", api.getBaseUrl().orEmpty())
                            sendingConversationIds = sendingConversationIds + id
                            updateNotice(id, null)
                            try {
                                val response = repo.sendMessage(
                                    id,
                                    capturedDraft.text,
                                    requestId,
                                    Triple(capturedDraft.attachment.name, "auto", capturedDraft.attachment.bytes),
                                )
                                if (!alive[0] || !requests.accepts(operation, api.getBaseUrl().orEmpty()) || api.sessionExpired.value) return@launch
                                val items = response.optJSONArray("items")
                                    ?: throw IllegalStateException("服务器没有返回消息列表。请刷新核对后再发送。")
                                val incoming = jsonObjects(items)
                                for (message in incoming) {
                                    val card = message.optJSONObject("content")?.optJSONObject("card") ?: continue
                                    if (card.optString("toolName") == "platform-import.prepare" &&
                                        card.optString("status") == "pending" && card.optJSONObject("attachment") != null && matchesActionAttachment(capturedDraft.attachment, card)
                                    ) {
                                        if (alive[0] && requests.accepts(operation, api.getBaseUrl().orEmpty())) actionFiles = actionFiles + (card.optString("actionId") to capturedDraft.attachment)
                                    }
                                }
                                if (!alive[0] || !requests.accepts(operation, api.getBaseUrl().orEmpty()) || api.sessionExpired.value) return@launch
                                if (drafts[id]?.requestId == requestId) drafts = drafts + (id to AssistantComposerDraft())
                                if (accepts(ticket)) {
                                    val currentVisible = filterVisibleAssistantMessages(messages)
                                    val atBottomWhenResponseArrived = isAtBottom(listState, currentVisible.size)
                                    installMessages(id, incoming, atBottomWhenResponseArrived)
                                }
                                refreshConversations()
                            } catch (e: AuthExpiredException) {
                                if (!alive[0] || !requests.accepts(operation, api.getBaseUrl().orEmpty())) return@launch
                                updateNotice(id, "登录状态已过期，请重新登录。")
                                onAuthExpired()
                            } catch (e: Exception) {
                                if (!alive[0] || !requests.accepts(operation, api.getBaseUrl().orEmpty())) return@launch
                                updateNotice(
                                    id,
                                    "发送结果尚未核对：${e.message ?: "请求未完成"}。请先刷新本对话，避免重复发送。",
                                )
                            } finally {
                                if (alive[0] && requests.accepts(operation, api.getBaseUrl().orEmpty())) {
                                    sendingConversationIds = sendingConversationIds - id
                                    if (!api.sessionExpired.value && conversationId == id && !accepts(ticket)) refreshMessages(id)
                                }
                            }
                        }
                    } else {
                        // User ordinary free text input continues/supersedes per protocol-v1 §Clarification
                        startStreamingGeneration(id, requestId, GenerationInput.Text(capturedDraft.text))
                    }
                },
                modifier = Modifier.heightIn(min = 48.dp),
                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 10.dp),
            ) {
                if (activeConversationIsSending) {
                    CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                } else {
                    Icon(Icons.Filled.Send, contentDescription = "发送消息")
                }
            }
        }
        val currentGenBottom = conversationId?.let { activeGenerations[it] }
        if (activeConversationIsSending && currentGenBottom != null && currentGenBottom.visualState in listOf(StreamVisualState.CONNECTING, StreamVisualState.RECEIVING)) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(bottom = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(
                    "正在实时流式响应…可在上方随时停止生成。",
                    style = MaterialTheme.typography.bodySmall,
                    color = TitaniumBlue,
                )
                TextButton(
                    onClick = { conversationId?.let { id -> currentGenBottom.let { gen -> stopGeneration(id, gen) } } },
                    contentPadding = PaddingValues(horizontal = 8.dp, vertical = 2.dp),
                ) {
                    Text("停止生成", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.labelSmall)
                }
            }
        } else if (activeConversationIsSending) {
            Text(
                "正在等待完整回复…不会模拟逐字输出。",
                modifier = Modifier.fillMaxWidth().padding(bottom = 4.dp),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    } // composer column
        } // composer surface
    } // chat column
    } // primary chat

    if (archiveTargetId != null) {
        val title = archiveTarget?.optString("title")?.ifBlank { "新对话" } ?: "该对话"
        AlertDialog(
            onDismissRequest = { if (archivingConversationId == null) archiveTargetId = null },
            title = { Text("归档对话？") },
            text = {
                Text("“$title”将从当前列表归档。归档不删除账本记录；当前服务没有归档恢复列表，未发送草稿也会清除。")
            },
            confirmButton = {
                TextButton(
                    enabled = archivingConversationId == null,
                    onClick = { archiveTargetId?.let { id -> scope.launch { archiveConversation(id) } } },
                ) { Text(if (archivingConversationId != null) "正在归档…" else "确认归档") }
            },
            dismissButton = {
                TextButton(
                    enabled = archivingConversationId == null,
                    onClick = { archiveTargetId = null },
                ) { Text("取消") }
            },
        )
    }

    val confirmation = actionConfirmation
    val confirmationCard = confirmation?.let { target ->
        if (target.conversationId != conversationId) null else messages.firstNotNullOfOrNull { message ->
            message.optJSONObject("content")?.optJSONObject("card")
                ?.takeIf { it.optString("actionId") == target.actionId }
        }
    }
    if (confirmation != null && confirmationCard != null) {
        val card = confirmationCard
        val actionId = confirmation.actionId
        val importCount = selectedRows[actionId]?.size
        AssistantConfirmationScreen(
            onDismissRequest = { if (actionId !in actionBusyIds) actionConfirmation = null },
            title = { Text(card.optString("operation").ifBlank { "确认执行操作" }) },
            text = {
                Column(Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(card.optString("summary").ifBlank { "请核对服务器提供的操作内容。" })
                    val affectedCount = card.optJSONObject("affected")?.optInt("count", -1) ?: -1
                    if (affectedCount >= 0) Text("影响 ${affectedCount} 项", style = MaterialTheme.typography.bodyMedium)
                    if (importCount != null) Text("当前选择导入 $importCount 行。", style = MaterialTheme.typography.bodyMedium)
                    overrides[actionId]?.filterKeys { it in selectedRows[actionId].orEmpty() }?.forEach { (id, category) -> Text("${assistantImportRows(card).firstOrNull { it.id == id }?.title ?: id} → $category") }
                    if (card.optString("toolName") == "platform-import.prepare") Column {
                        Text("只导入显式选择行；分类必须是现有叶分类，不新建或恢复。")
                        val categories = assistantImportCategories(card)
                        val reviewed = assistantImportRows(card).filter { it.id in selectedRows[actionId].orEmpty() }
                        Text("收入 ${formatYuan(reviewed.filter { it.type == 1 }.sumOf { it.amountCents })} · 支出 ${formatYuan(reviewed.filter { it.type == 0 }.sumOf { it.amountCents })}")
                        reviewed.forEach { row -> Text("${row.dateLabel} · ${formatYuan(row.amountCents)}${if (row.isRefund) " 退款收入" else ""} · ${categories.firstOrNull { it.id == reviewedImportCategory(row, overrides[actionId].orEmpty()) }?.name ?: "分类缺失"} · 备注：${reviewedImportNote(row, notes[actionId].orEmpty()).ifBlank { "（空）" }}") }
                    }
                    card.optJSONObject("values")?.let { AssistantOperationDetails(it) }
                    if (card.optString("toolName") != "platform-import.prepare") card.optJSONObject("preview")?.let { AssistantOperationDetails(it) }
                    val warnings = card.optJSONArray("warnings")
                    if (warnings != null && warnings.length() > 0) {
                        warnings.forEachString { warning ->
                            Text(warning, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(
                    enabled = actionId !in actionBusyIds && card.optString("status") == "pending" &&
                        conversationNotices[confirmation.conversationId]?.contains("结果待核对") != true &&
                        (card.optString("toolName") != "platform-import.prepare" || selectedRows[actionId].orEmpty().size in 1..100),
                    onClick = {
                        actionConfirmation = null
                        scope.launch {
                            if (card.optString("status") != "pending") {
                                updateNotice(confirmation.conversationId, "此操作已不是待确认状态，请刷新后核对。")
                                refreshMessages(confirmation.conversationId)
                                return@launch
                            }
                            val operation = requests.begin("action:$actionId", requestScope())
                            requests.begin("messages", requestScope())
                            actionBusyIds = actionBusyIds + actionId
                            try {
                                val importing = card.optString("toolName") == "platform-import.prepare"
                                val explicitSelection = if (importing) reconcileImportSelection(selectedRows[actionId].orEmpty(), assistantImportRows(card)).toList() else null
                                if (importing && explicitSelection.orEmpty().isEmpty()) return@launch
                                val file = actionFiles[actionId]
                                if (card.optJSONObject("attachment") != null && file == null) {
                                    actionFileErrors = actionFileErrors + (actionId to "请重新选择此预览对应的原始账单文件。")
                                    return@launch
                                }
                                if (file != null && card.optJSONObject("attachment") != null &&
                                    !matchesActionAttachment(file, card)
                                ) {
                                    actionFiles = actionFiles - actionId
                                    actionFileErrors = actionFileErrors + (actionId to "原文件摘要不匹配，请重新选择原件或取消并重新准备。")
                                    return@launch
                                }
                                if (!accepts(operation) || conversationId != confirmation.conversationId || messages.none { it.optJSONObject("content")?.optJSONObject("card")?.let { c -> c.optString("actionId") == actionId && c.optString("status") == "pending" } == true }) return@launch
                                val confirmResponse = repo.confirmAction(
                                    actionId,
                                    fileBytes = file?.bytes,
                                    selectedIds = explicitSelection,
                                    categoryOverrides = if (importing) assistantImportRows(card).filter { it.id in explicitSelection.orEmpty() }.associate { it.id to reviewedImportCategory(it, overrides[actionId].orEmpty()) } else null,
                                    noteOverrides = notes[actionId]?.filterKeys { it in explicitSelection.orEmpty() },
                                )
                                if (!accepts(operation) || conversationId != confirmation.conversationId) return@launch
                                val confirmedAction = confirmResponse.optJSONObject("action")
                                if (importing && confirmedAction?.let {
                                        it.optString("id") == actionId && it.optString("status") == "confirmed"
                                    } == true
                                ) {
                                    onDataChanged()
                                }
                                refreshMessages(confirmation.conversationId)
                            } catch (e: AuthExpiredException) {
                                if (!alive[0] || !requests.accepts(operation, requestScope()) || conversationId != confirmation.conversationId) return@launch
                                updateNotice(confirmation.conversationId, "登录状态已过期，请重新登录。")
                                onAuthExpired()
                            } catch (e: Exception) {
                                if (!accepts(operation) || conversationId != confirmation.conversationId) return@launch
                                updateNotice(
                                    confirmation.conversationId,
                                    "操作结果待核对：${e.message ?: "请求未完成"}。请刷新卡片，不要重复执行。",
                                )
                                refreshMessages(confirmation.conversationId)
                            } finally {
                                if (accepts(operation) && conversationId == confirmation.conversationId) actionBusyIds = actionBusyIds - actionId
                            }
                        }
                    },
                ) { Text("确认执行") }
            },
            dismissButton = {
                TextButton(
                    enabled = actionId !in actionBusyIds,
                    onClick = { actionConfirmation = null },
                ) { Text("再核对") }
            },
        )
    }
}

@Composable
private fun AssistantWelcome(
    onQuickMemo: (String) -> Unit,
    onOpenOrganization: () -> Unit,
) {
    // Welcome only when there are truly no server messages. Cards only prefill
    // the composer or fill import text; none execute writes or skip confirmation.
    val quicks = listOf(
        Triple("帮我记一笔", "记录支出/收入", "请帮我记一笔支出：金额__，分类__，账户__，备注__。"),
        Triple("分析本月消费", "按分类与趋势分析", "请分析本月消费：按分类汇总、最大三项及异常波动。"),
        Triple("查看预算结余", "核对预算与风险", "请查看本周期预算结余：剩余、可花、超支风险。"),
        Triple("导入微信/支付宝账单", "账单文件核对引导", "我想导入微信/支付宝账单，请告诉我需要准备哪个文件、怎么导出、怎么发给你核对。"),
    )
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        item {
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(16.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                border = BorderStroke(1.dp, LocalWebTokens.current.border.copy(alpha = 0.6f)),
                elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
            ) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        FinanceAiSparkleIcon(
                            modifier = Modifier.size(28.dp),
                            primaryColor = MaterialTheme.colorScheme.primary,
                            accentColor = MaterialTheme.colorScheme.secondary,
                        )
                        Text(
                            "你好！我可以帮你：",
                            style = MaterialTheme.typography.bodyLarge,
                            fontWeight = FontWeight.Bold,
                            color = LocalWebTokens.current.fg,
                        )
                    }
                    Text("• 记录收支、查询账单\n• 分析消费、查看预算\n• 导入微信/支付宝账单\n• 管理分类、账户和周期账单", style = MaterialTheme.typography.bodyMedium, color = LocalWebTokens.current.muted)
                    Text("有什么可以帮你的吗？", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, color = LocalWebTokens.current.accent)
                }
            }
        }
        item {
            FinanceCard(
                modifier = Modifier.fillMaxWidth(),
                cornerRadius = 14.dp,
                contentPadding = 14.dp,
                onClick = onOpenOrganization,
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Box(
                        modifier = Modifier
                            .size(38.dp)
                            .background(LocalWebTokens.current.accentSubtle, RoundedCornerShape(11.dp)),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            Icons.Filled.SmartToy,
                            contentDescription = null,
                            tint = LocalWebTokens.current.accent,
                            modifier = Modifier.size(21.dp),
                        )
                    }
                    Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        Text(
                            "智能整理旧账",
                            style = MaterialTheme.typography.bodyLarge,
                            fontWeight = FontWeight.SemiBold,
                            color = LocalWebTokens.current.fg,
                        )
                        Text(
                            "按时间段检查分类与标签，逐笔核对后应用",
                            style = MaterialTheme.typography.bodySmall,
                            color = LocalWebTokens.current.muted,
                        )
                    }
                    Text(
                        "进入 ›",
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.Medium,
                        color = LocalWebTokens.current.accent,
                    )
                }
            }
        }
        item {
            Text(
                "快捷提问",
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.Bold,
                color = LocalWebTokens.current.fg,
                modifier = Modifier.padding(top = 4.dp),
            )
        }
        items(quicks, key = { it.first }) { (title, subtitle, template) ->
            FinanceCard(
                modifier = Modifier.fillMaxWidth(),
                cornerRadius = 14.dp,
                contentPadding = 14.dp,
                onClick = { onQuickMemo(template) },
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        Text(
                            title,
                            style = MaterialTheme.typography.bodyLarge,
                            fontWeight = FontWeight.SemiBold,
                            color = LocalWebTokens.current.fg,
                        )
                        Text(
                            subtitle,
                            style = MaterialTheme.typography.bodySmall,
                            color = LocalWebTokens.current.muted,
                        )
                    }
                    Text(
                        "填入 ›",
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.Medium,
                        color = LocalWebTokens.current.accent,
                    )
                }
            }
        }
        item {
            Text(
                "导入账单只会把文字填入输入框并提示你选择原文件，不会绕过预览、勾选与二次确认。",
                style = MaterialTheme.typography.bodySmall,
                color = LocalWebTokens.current.muted,
            )
        }
    }
}

@Composable
private fun ConversationChoice(
    conversation: JSONObject,
    selected: Boolean,
    menuExpanded: Boolean,
    archiving: Boolean,
    archiveEnabled: Boolean,
    onSelect: () -> Unit,
    onMenu: () -> Unit,
    onDismissMenu: () -> Unit,
    onArchive: () -> Unit,
) {
    val tokens = LocalWebTokens.current
    val title = conversation.optString("title").ifBlank { "新对话" }
    Surface(
        modifier = Modifier.widthIn(min = 148.dp, max = 240.dp),
        color = if (selected) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surface,
        shape = MaterialTheme.shapes.medium,
        border = BorderStroke(1.dp, if (selected) MaterialTheme.colorScheme.primary else tokens.border),
    ) {
        Row(
            modifier = Modifier.padding(start = 12.dp, top = 6.dp, bottom = 6.dp, end = 2.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(
                modifier = Modifier.weight(1f).heightIn(min = 48.dp).padding(vertical = 6.dp),
                verticalArrangement = Arrangement.Center,
            ) {
                TextButton(onClick = onSelect, contentPadding = PaddingValues(0.dp)) {
                    Text(
                        title,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        color = if (selected) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurface,
                    )
                }
                Text(
                    if (selected) "当前对话" else "打开对话",
                    style = MaterialTheme.typography.bodySmall,
                    color = if (selected) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                )
            }
            Box {
                IconButton(
                    enabled = archiveEnabled,
                    onClick = onMenu,
                    modifier = Modifier.size(48.dp),
                ) {
                    if (archiving) CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                    else Icon(Icons.Filled.MoreVert, contentDescription = "${title}的对话菜单")
                }
                DropdownMenu(expanded = menuExpanded, onDismissRequest = onDismissMenu) {
                    DropdownMenuItem(
                        text = { Text("归档对话") },
                        leadingIcon = { Icon(Icons.Filled.Archive, contentDescription = null) },
                        enabled = archiveEnabled,
                        onClick = onArchive,
                    )
                }
            }
        }
    }
}

@Composable
private fun AssistantEmptyState(
    title: String,
    body: String,
    actionLabel: String?,
    onAction: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 28.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Surface(
            color = MaterialTheme.colorScheme.surfaceVariant,
            shape = CircleShape,
        ) {
            Icon(Icons.Filled.Send, contentDescription = null, modifier = Modifier.padding(16.dp), tint = MaterialTheme.colorScheme.primary)
        }
        Text(title, style = MaterialTheme.typography.titleMedium)
        Text(body, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
        if (actionLabel != null) {
            Button(onClick = onAction, modifier = Modifier.heightIn(min = 48.dp)) { Text(actionLabel) }
        }
    }
}

@Composable
private fun AssistantNotice(
    message: String,
    isError: Boolean,
    onAction: (() -> Unit)? = null,
    actionLabel: String? = null,
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = if (isError) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.surfaceVariant,
        shape = MaterialTheme.shapes.small,
        border = if (isError) null else BorderStroke(1.dp, LocalWebTokens.current.border),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(start = 12.dp, top = 6.dp, bottom = 6.dp, end = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                message,
                modifier = Modifier.weight(1f),
                color = if (isError) MaterialTheme.colorScheme.onErrorContainer else MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodySmall,
            )
            if (onAction != null && actionLabel != null) {
                TextButton(onClick = onAction, modifier = Modifier.heightIn(min = 48.dp)) { Text(actionLabel) }
            }
        }
    }
}

@Composable
private fun MessageCard(
    modifier: Modifier = Modifier,
    message: JSONObject,
    selectedRows: Map<String, Set<String>>,
    overrides: Map<String, Map<String, String>>,
    actionFile: SelectedDocument?,
    actionFileError: String?,
    actionBusy: Boolean,
    liveClarificationId: String? = null,
    onToggleRow: (String, String, Boolean) -> Unit,
    onOverride: (String, String, String) -> Unit,
    onOpenBatchWorkspace: (String) -> Unit = {},
    onRequestConfirm: (String) -> Unit,
    onCancel: (String) -> Unit,
    onChooseSourceFile: (String) -> Unit,
) {
    if (isProgressOnlyMessage(message)) {
        val progressState = resolveProgressDisplayState(getProgressState(message))
        val isFailed = progressState == AssistantProgressDisplayState.FAILED
        val isRunning = progressState == AssistantProgressDisplayState.RUNNING

        Row(
            modifier = modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.Start,
        ) {
            Surface(
                shape = RoundedCornerShape(12.dp),
                color = if (isFailed) MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.5f)
                else MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.7f),
                border = BorderStroke(
                    1.dp,
                    if (isFailed) MaterialTheme.colorScheme.error.copy(alpha = 0.4f)
                    else LocalWebTokens.current.border,
                ),
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    if (isRunning) {
                        CircularProgressIndicator(modifier = Modifier.size(14.dp), strokeWidth = 2.dp)
                        Text(
                            "服务器正在处理请求…",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    } else if (isFailed) {
                        Icon(
                            Icons.Filled.Warning,
                            contentDescription = "处理失败",
                            modifier = Modifier.size(14.dp),
                            tint = MaterialTheme.colorScheme.error,
                        )
                        Text(
                            "处理未完成，请查看错误说明",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.error,
                        )
                    } else {
                        Text(
                            "处理状态待核对",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }
        return
    }

    val role = message.optString("role")
    val kind = message.optString("kind")
    val content = message.optJSONObject("content")
    val text = content?.optString("text").orEmpty()
    val card = content?.optJSONObject("card")
    val result = content?.optJSONObject("result")
    val error = content?.optJSONObject("error")
    val progress = content?.optJSONObject("progress")
    val isUser = role == "user"
    val hasError = kind == "error" || error != null
    val safeErrorMessage = if (hasError) extractSafeErrorMessage(error, error?.optString("code") ?: content?.optString("code")?.takeIf { it.isNotBlank() }) else null
    val background = if (isUser) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant
    val foreground = if (isUser) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurfaceVariant
    val bubbleShape = if (isUser) RoundedCornerShape(16.dp, 16.dp, 4.dp, 16.dp) else RoundedCornerShape(16.dp, 16.dp, 16.dp, 4.dp)

    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = if (isUser) Arrangement.End else Arrangement.Start,
    ) {
        Card(
            modifier = if (isUser) Modifier.fillMaxWidth(0.92f) else Modifier.fillMaxWidth(),
            shape = bubbleShape,
            colors = CardDefaults.cardColors(containerColor = background, contentColor = foreground),
            border = if (isUser) null else BorderStroke(1.dp, LocalWebTokens.current.border),
        ) {
            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text(
                        when (role) {
                            "user" -> "我"
                            "tool" -> "处理状态"
                            else -> "AI 助理"
                        },
                        style = MaterialTheme.typography.labelLarge,
                    )
                }

                val shouldRenderText = text.isNotBlank() && card == null && !hasError
                if (shouldRenderText) {
                    Text(text, style = MaterialTheme.typography.bodyMedium)
                }
                if (progress?.optString("state") == "running") {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        CircularProgressIndicator(modifier = Modifier.size(14.dp), strokeWidth = 2.dp)
                        Text("服务器仍在处理请求…", style = MaterialTheme.typography.bodySmall)
                    }
                }
                if (hasError && safeErrorMessage != null) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Icon(
                            Icons.Filled.Warning,
                            contentDescription = "错误",
                            modifier = Modifier.size(16.dp),
                            tint = MaterialTheme.colorScheme.error,
                        )
                        Text(
                            safeErrorMessage,
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.error,
                        )
                    }
                }
                content?.optJSONObject("attachment")?.let { attachment ->
                    Text("附件：${attachment.optString("fileName").ifBlank { "文件" }}", style = MaterialTheme.typography.bodySmall)
                }
                if (result != null) {
                    AssistantResultCard(result)
                }
                val msgClar = extractClarification(message)
                if (msgClar != null && card == null && (liveClarificationId == null || msgClar.id != liveClarificationId)) {
                    ClarificationCard(
                        clarification = msgClar,
                        isLive = false,
                        selectedOptionId = null,
                        onSelectOption = {},
                    )
                }
                if (card != null) {
                    AssistantActionCard(
                        card = card,
                        selectedRows = selectedRows,
                        overrides = overrides,
                        actionFile = actionFile,
                        actionFileError = actionFileError,
                        actionBusy = actionBusy,
                        onToggleRow = onToggleRow,
                        onOverride = onOverride,
                        onRequestConfirm = onRequestConfirm,
                        onCancel = onCancel,
                        onChooseSourceFile = onChooseSourceFile,
                    )
                }
                val importBatch = content?.optJSONObject("importBatch")
                if (importBatch != null) {
                    ImportBatchCard(
                        importBatch = importBatch,
                        onOpenWorkspace = onOpenBatchWorkspace,
                    )
                }
            }
        }
    }
}

@Composable
private fun ImportBatchCard(
    importBatch: JSONObject,
    onOpenWorkspace: (String) -> Unit,
) {
    val batchId = importBatch.optString("batchId")
    val status = importBatch.optString("status", "prepared")
    val summary = importBatch.optJSONObject("summary")
    val totalItems = summary?.optInt("totalItems") ?: 0
    val expenseCents = summary?.optLong("expenseCents") ?: 0L
    val incomeCents = summary?.optLong("incomeCents") ?: 0L
    val files = importBatch.optJSONArray("files")
    val filesCount = files?.length() ?: 0
    val analysis = importBatch.optJSONObject("analysis")
    val analysisState = analysis?.optString("state", "idle")
    val result = importBatch.optJSONObject("result")

    val statusText = when (status) {
        "prepared", "reviewed" -> if (analysisState == "running") "AI分析中" else "待审核"
        "confirmed" -> "已入账"
        "cancelled" -> "已取消"
        "expired" -> "已过期"
        "failed" -> "处理失败"
        else -> status
    }

    Surface(
        Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(18.dp),
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, LocalWebTokens.current.border),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(
                    "$statusText / 合并账单导入",
                    style = MaterialTheme.typography.labelMedium,
                    color = if (status == "confirmed") Color(0xFF16A34A) else MaterialTheme.colorScheme.primary,
                )
                if (filesCount > 0) {
                    Surface(
                        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.6f),
                        shape = RoundedCornerShape(6.dp),
                    ) {
                        Text(
                            "$filesCount 个账单文件",
                            style = MaterialTheme.typography.labelSmall,
                            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                        )
                    }
                }
            }

            Text(
                "共 $totalItems 笔交易 · 支出 ¥${formatYuan(expenseCents)} · 收入 ¥${formatYuan(incomeCents)}",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
            )

            if (status == "confirmed" && result != null) {
                val inserted = result.optInt("inserted")
                Text(
                    "已全部成功写入账本（共入账 $inserted 笔），未批准分类未创建。",
                    style = MaterialTheme.typography.bodySmall,
                    color = Color(0xFF16A34A),
                )
            } else if (status in setOf("prepared", "reviewed")) {
                Text(
                    "多文件交易已融合为统一清单。请核对分类、排除项及冲突，确认后一次性入账。",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            } else if (status == "cancelled") {
                Text(
                    "本次导入已被取消，未向账本写入任何账目。",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                )
            }

            Button(
                onClick = { onOpenWorkspace(batchId) },
                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                shape = RoundedCornerShape(12.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = if (status == "confirmed") MaterialTheme.colorScheme.surfaceVariant else LocalWebTokens.current.accent,
                    contentColor = if (status == "confirmed") MaterialTheme.colorScheme.onSurfaceVariant else LocalWebTokens.current.onAccent,
                ),
            ) {
                Text(if (status == "confirmed") "查看导入清单与明细" else "打开账单审核工作区", fontWeight = FontWeight.Bold)
            }
        }
    }
}

@Composable
private fun AssistantResultCard(result: JSONObject) {
    val summary = result.optString("summary")
    val data = result.optJSONObject("data")
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.surface,
        shape = MaterialTheme.shapes.small,
        border = BorderStroke(1.dp, LocalWebTokens.current.border),
    ) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("服务端结果", style = MaterialTheme.typography.titleSmall)
            if (summary.isNotBlank()) Text(summary, style = MaterialTheme.typography.bodyMedium)
            data?.let { JsonSummaryFields(it) }
        }
    }
}

@Composable
private fun AssistantActionCard(
    card: JSONObject,
    selectedRows: Map<String, Set<String>>,
    overrides: Map<String, Map<String, String>>,
    actionFile: SelectedDocument?,
    actionFileError: String?,
    actionBusy: Boolean,
    onToggleRow: (String, String, Boolean) -> Unit,
    onOverride: (String, String, String) -> Unit,
    onRequestConfirm: (String) -> Unit,
    onCancel: (String) -> Unit,
    onChooseSourceFile: (String) -> Unit,
) {
    val actionId = card.optString("actionId")
    val toolName = card.optString("toolName")
    val status = card.optString("status")
    val pending = status == "pending"
    val knownTerminal = status in setOf("confirmed", "cancelled", "expired")
    val rows = if (toolName == "platform-import.prepare") assistantImportRows(card) else emptyList()
    val attachment = card.optJSONObject("attachment")
    val needsSource = attachment != null
    val sourceReady = !needsSource || actionFile != null
    val operation = card.optString("operation").ifBlank { "需要确认的操作" }
    val summary = card.optString("summary")
    val affectedCount = card.optJSONObject("affected")?.optInt("count", -1) ?: -1

    if (toolName == "platform-import.prepare") {
        Surface(Modifier.fillMaxWidth(), shape = RoundedCornerShape(18.dp), color = MaterialTheme.colorScheme.surface, border = BorderStroke(1.dp, LocalWebTokens.current.border)) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("${actionStatusLabel(status, actionBusy)} / 账单导入", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                Text("${rows.size} 行预览 · 已选 ${selectedRows[actionId].orEmpty().size} 行", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                Text(if (pending) "逐条核对金额、重复提示和分类；确认后才写入账本。" else "${actionStatusLabel(status, actionBusy)}，不会重复执行。", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (pending) Button(onClick = { onRequestConfirm(actionId) }, enabled = !actionBusy, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp), shape = RoundedCornerShape(12.dp)) { Text("查看并选择账单") }
                if (pending && actionFileError != null) Text(actionFileError, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
            }
        }
        return
    }

    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.surface,
        shape = MaterialTheme.shapes.medium,
        border = BorderStroke(1.dp, LocalWebTokens.current.border),
    ) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Column(Modifier.weight(1f)) {
                    Text(operation, style = MaterialTheme.typography.titleSmall)
                    Text(
                        actionStatusLabel(status, actionBusy),
                        style = MaterialTheme.typography.bodySmall,
                        color = if (pending) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                if (actionBusy) CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
            }
            if (summary.isNotBlank()) Text(summary, style = MaterialTheme.typography.bodyMedium)
            if (affectedCount >= 0) {
                Text("影响 $affectedCount 项", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            card.optJSONObject("values")?.let { AssistantOperationDetails(it) }
            if (toolName != "platform-import.prepare") card.optJSONObject("preview")?.let { AssistantOperationDetails(it) }

            val warnings = card.optJSONArray("warnings")
            if (warnings != null && warnings.length() > 0) {
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    color = MaterialTheme.colorScheme.errorContainer,
                    shape = MaterialTheme.shapes.small,
                ) {
                    Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text("请留意", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onErrorContainer)
                        warnings.forEachString { warning ->
                            Text(warning, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onErrorContainer)
                        }
                    }
                }
            }

            if (needsSource) {
                val expectedName = attachment?.optString("fileName").orEmpty().ifBlank { "原始账单文件" }
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("预览来源：$expectedName", style = MaterialTheme.typography.bodySmall)
                    Text(
                        if (sourceReady) "生成此预览的原文件仍在当前进程中。"
                        else "确认导入前需要重新选择原文件，并核对文件摘要。",
                        style = MaterialTheme.typography.bodySmall,
                        color = if (sourceReady) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.error,
                    )
                    if (actionFileError != null) {
                        Text(actionFileError, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                    }
                    OutlinedButton(
                        enabled = pending && !actionBusy,
                        onClick = { onChooseSourceFile(actionId) },
                        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                    ) { Text(if (sourceReady) "重新核对原文件" else "选择预览中的原文件") }
                }
            }

            if (toolName == "platform-import.prepare") {
                Text("预览 ${rows.size} 行 · 已选 ${selectedRows[actionId].orEmpty().size}/100", style = MaterialTheme.typography.bodySmall)
                OutlinedButton(onClick = { onRequestConfirm(actionId) }, enabled = pending && !actionBusy, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("查看并选择账单") }
            }

            if (!pending) {
                Text(
                    when {
                        status == "confirmed" -> "服务器已确认此操作；操作按钮已关闭。"
                        status == "cancelled" -> "此操作已取消，不会继续执行。"
                        status == "expired" -> "此预览已过期，请重新发起并核对。"
                        knownTerminal -> "此操作已结束。"
                        else -> "操作状态未知，请刷新对话后核对。"
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (pending && toolName != "platform-import.prepare") {
                Surface(
                    shape = RoundedCornerShape(8.dp),
                    color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
                    border = BorderStroke(0.5.dp, LocalWebTokens.current.border),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(
                        text = "点击“核对并继续”将进入独立二次确认流程，核对要素无误后正式记入账本。当前仅为生成草案，未发生记账",
                        modifier = Modifier.padding(10.dp),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(
                        enabled = !actionBusy && sourceReady,
                        onClick = { onRequestConfirm(actionId) },
                        modifier = Modifier.weight(1f).heightIn(min = 48.dp),
                    ) { Text(if (actionBusy) "处理中…" else "核对并继续 →") }
                    OutlinedButton(
                        enabled = !actionBusy,
                        onClick = { onCancel(actionId) },
                        modifier = Modifier.weight(1f).heightIn(min = 48.dp),
                    ) { Text("取消此草稿") }
                }
            }
            Text(
                "操作类型：$toolName",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun JsonSummaryFields(value: JSONObject) {
    val fields = formatSafeSummaryFields(value)
    if (fields.isEmpty()) return
    Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
        fields.forEach { (label, display) ->
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(label, modifier = Modifier.widthIn(min = 88.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(display, modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

@Composable
private fun AssistantOperationDetails(value: JSONObject) {
    var expanded by remember(value.toString()) { mutableStateOf(false) }
    TextButton(onClick = { expanded = !expanded }, modifier = Modifier.heightIn(min = 48.dp)) {
        Text(if (expanded) "收起操作详情" else "查看完整操作详情 / 前后值")
    }
    if (expanded) {
        val lines = formatOperationDetails(value)
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            lines.forEach { Text(it, style = MaterialTheme.typography.bodySmall) }
        }
    }
}

private fun actionStatusLabel(status: String, busy: Boolean): String = when {
    busy -> "正在执行"
    status == "pending" -> "待你核对"
    status == "confirmed" -> "已由服务器确认"
    status == "cancelled" -> "已取消"
    status == "expired" -> "预览已过期"
    else -> "状态未知"
}

private fun importRowStatus(row: JSONObject): String = when {
    row.optBoolean("alreadyExists") -> "已存在，不能重复导入"
    row.optBoolean("ignored") -> "已忽略"
    row.optBoolean("possibleDuplicate") -> "可能重复，默认未选"
    else -> "可导入"
}

private fun cardRows(card: JSONObject): List<JSONObject> {
    val rows = card.optJSONObject("preview")?.optJSONArray("rows") ?: return emptyList()
    return List(rows.length()) { index -> rows.optJSONObject(index) ?: JSONObject() }
}

private fun jsonObjects(array: JSONArray?): List<JSONObject> {
    if (array == null) return emptyList()
    return List(array.length()) { index -> array.optJSONObject(index) ?: JSONObject() }
}

private inline fun JSONArray.forEachString(block: (String) -> Unit) {
    for (index in 0 until length()) {
        val value = optString(index).takeIf { it.isNotBlank() } ?: continue
        block(value)
    }
}

private fun isAtBottom(state: LazyListState, count: Int): Boolean {
    val layoutInfo = state.layoutInfo
    val geometries = layoutInfo.visibleItemsInfo.map {
        ScrollItemGeometry(it.index, it.offset, it.size)
    }
    return isGeometryAtBottom(
        items = geometries,
        viewportEndOffset = layoutInfo.viewportEndOffset,
        totalCount = count,
        isScrollInProgress = state.isScrollInProgress,
    )
}

private fun sha256Hex(bytes: ByteArray): String {
    val digits = "0123456789abcdef"
    val digest = MessageDigest.getInstance("SHA-256").digest(bytes)
    return buildString(digest.size * 2) {
        digest.forEach { byte ->
            val value = byte.toInt() and 0xff
            append(digits[value ushr 4])
            append(digits[value and 0x0f])
        }
    }
}
