package com.yansuu1.jizhang.ui.feature.assistant

import org.json.JSONObject

/**
 * Encapsulates the UI state of the Assistant screen.
 * Decouples mutable state holding, navigation leave protection, and work owner
 * tracking from Compose rendering (Task 6).
 */
data class AssistantScreenState(
    val activeWorkOwner: String? = null,
    val pendingCard: JSONObject? = null,
    val pendingActionId: String? = null,
    val pendingConversationId: String? = null,
    val streamState: Map<String, ActiveGenerationState> = emptyMap(),
    val sendingConversationIds: Set<String> = emptySet(),
    val errorMessage: String? = null,
    val conversationErrors: Map<String, String> = emptyMap(),
    val showHistory: Boolean = false,
    val showOrganization: Boolean = false,
    val workspaceActionId: String? = null,
    val workspaceBatchId: String? = null,
) {
    val isSecondaryScreen: Boolean
        get() = showHistory || showOrganization || workspaceActionId != null || workspaceBatchId != null || pendingActionId != null

    fun dismissSecondary(): AssistantScreenState = copy(
        showHistory = false,
        showOrganization = false,
        workspaceActionId = null,
        workspaceBatchId = null,
        pendingActionId = null,
        pendingCard = null,
        pendingConversationId = null,
        activeWorkOwner = null,
    )
}
