package com.yansuu1.jizhang.ui.feature.assistant

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AssistantScreenStateTest {

    @Test
    fun defaultStateIsNotSecondary() {
        val state = AssistantScreenState()
        assertFalse(state.isSecondaryScreen)
        assertNull(state.activeWorkOwner)
        assertNull(state.pendingCard)
        assertNull(state.pendingActionId)
        assertTrue(state.streamState.isEmpty())
        assertTrue(state.sendingConversationIds.isEmpty())
    }

    @Test
    fun secondaryScreenDetectedFromMultipleTriggers() {
        assertFalse(AssistantScreenState().isSecondaryScreen)
        assertTrue(AssistantScreenState(showHistory = true).isSecondaryScreen)
        assertTrue(AssistantScreenState(showOrganization = true).isSecondaryScreen)
        assertTrue(AssistantScreenState(workspaceActionId = "act-1").isSecondaryScreen)
        assertTrue(AssistantScreenState(workspaceBatchId = "batch-1").isSecondaryScreen)
        assertTrue(AssistantScreenState(pendingActionId = "act-2").isSecondaryScreen)
    }

    @Test
    fun dismissSecondaryClearsWorkOwnerAndSecondarySheetsWhilePreservingStream() {
        val dummyCard = JSONObject().put("id", "card-1")
        val state = AssistantScreenState(
            activeWorkOwner = "owner-1",
            pendingCard = dummyCard,
            pendingActionId = "act-1",
            pendingConversationId = "conv-1",
            showHistory = true,
            showOrganization = true,
            workspaceActionId = "act-ws",
            workspaceBatchId = "batch-ws",
            sendingConversationIds = setOf("conv-1"),
            conversationErrors = mapOf("conv-1" to "network error"),
        )

        assertTrue(state.isSecondaryScreen)
        val dismissed = state.dismissSecondary()

        assertFalse(dismissed.isSecondaryScreen)
        assertNull(dismissed.activeWorkOwner)
        assertNull(dismissed.pendingCard)
        assertNull(dismissed.pendingActionId)
        assertNull(dismissed.pendingConversationId)
        assertFalse(dismissed.showHistory)
        assertFalse(dismissed.showOrganization)
        assertNull(dismissed.workspaceActionId)
        assertNull(dismissed.workspaceBatchId)

        // Preserved conversational state
        assertEquals(setOf("conv-1"), dismissed.sendingConversationIds)
        assertEquals(mapOf("conv-1" to "network error"), dismissed.conversationErrors)
    }
}
